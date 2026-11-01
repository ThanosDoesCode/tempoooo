import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { PGlite } from "@electric-sql/pglite";
const migrations = new URL("../supabase/migrations/", import.meta.url);

const platformSchema = `SET TIME ZONE 'UTC';
  CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role BYPASSRLS;
  CREATE SCHEMA auth; CREATE SCHEMA storage; CREATE SCHEMA extensions;
  CREATE TABLE auth.users(id uuid PRIMARY KEY);
  CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
  CREATE FUNCTION auth.jwt() RETURNS jsonb LANGUAGE sql STABLE AS $$ SELECT '{}'::jsonb $$;
  CREATE TABLE storage.buckets(id text PRIMARY KEY, public boolean NOT NULL DEFAULT false, file_size_limit bigint, allowed_mime_types text[]);
  INSERT INTO storage.buckets(id, public) VALUES ('challenge-evidence', true),('bulk-progress-photos', true),('payment-evidence', true);
  CREATE TABLE storage.objects(id uuid PRIMARY KEY, bucket_id text, name text);
  ALTER TABLE storage.objects ENABLE ROW LEVEL SECURITY;
  CREATE FUNCTION storage.foldername(text) RETURNS text[] LANGUAGE sql AS $$ SELECT string_to_array($1, '/') $$;
  GRANT SELECT, INSERT, UPDATE, DELETE ON storage.objects TO authenticated, service_role;
  GRANT USAGE ON SCHEMA auth, public, storage TO authenticated, anon, service_role;
  GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA auth TO authenticated, anon, service_role;`;

const historical = [];
let historicalChallengeEvent;

async function freshDatabase() {
  const database = new PGlite();
  await database.exec(platformSchema);
  const files = (await readdir(migrations)).filter((f) => f.endsWith(".sql")).sort();
  for (const file of files) {
    const sql = await readFile(new URL(file, migrations), "utf8");
    try {
      if (file === "20261024120000_community_account_notifications.sql")
        await seedHistorical(database);
      await database.exec(sql);
    } catch (error) {
      throw new Error(`migration ${file} failed: ${error.message}`);
    }
  }
  return database;
}

const asService = async (db) => {
  await db.exec("RESET ROLE");
  await db.query("SELECT set_config('request.jwt.claim.sub','',false)");
};
const asUser = async (db, uid) => {
  await db.exec("RESET ROLE");
  await db.query("SELECT set_config('request.jwt.claim.sub',$1,false)", [uid]);
  await db.exec("SET ROLE authenticated");
};

let db;
before(async () => {
  db = await freshDatabase();
});
after(async () => {
  await db?.close();
});
async function user(name) {
  await asService(db);
  const id = randomUUID();
  await db.query("INSERT INTO auth.users(id) VALUES ($1)", [id]);
  await db.query(
    "INSERT INTO public.profiles(id,username,email,display_name,avatar_url) VALUES ($1,$2,$3,$4,$5)",
    [
      id,
      name ?? "u_" + id.replaceAll("-", "").slice(0, 17),
      "private@example.test",
      "Private Name",
      "https://private.test/avatar",
    ],
  );
  return id;
}
async function call(uid, fn, args = []) {
  await asUser(db, uid);
  try {
    const rows = (
      await db.query(
        `SELECT * FROM public.${fn}(${args.map((_, i) => "$" + (i + 1)).join(",")})`,
        args,
      )
    ).rows;
    return fn === "list_community_people" ? rows[0].list_community_people.people : rows;
  } finally {
    await asService(db);
  }
}
const send = (a, b, token = randomUUID()) => call(a, "send_community_friend_request", [b, token]);
const profile = async (a, b) => (await call(a, "get_community_profile", [b]))[0];
const state = async (a, b) => (await profile(a, b))?.relationship_state;
const pair = async () => [await user(), await user()];
async function pending() {
  const [a, b] = await pair();
  const token = randomUUID();
  await send(a, b, token);
  return [a, b, token];
}
async function friends() {
  const [a, b, t] = await pending();
  await call(b, "accept_community_friend_request", [a, t]);
  return [a, b, t];
}

async function seedHistorical(database) {
  for (const status of ["pending", "accepted", "declined", "cancelled"]) {
    const a = randomUUID(),
      b = randomUUID(),
      token = randomUUID();
    await database.query("INSERT INTO auth.users VALUES ($1),($2)", [a, b]);
    await database.query("INSERT INTO public.profiles(id,username) VALUES ($1,$2),($3,$4)", [
      a,
      "old_" + a.slice(0, 8),
      b,
      "old_" + b.slice(0, 8),
    ]);
    const row = (
      await database.query(
        "INSERT INTO public.community_relationships(requester_id,recipient_id,request_id,status) VALUES($1,$2,$3,$4) RETURNING id",
        [a, b, token, status],
      )
    ).rows[0];
    historical.push({ a, b, token, id: row.id, status });
  }
  const { a, b } = historical[0],
    challenge = randomUUID();
  await database.query(
    "INSERT INTO public.challenges(id,created_by,name,start_date) VALUES($1,$2,'Existing challenge',CURRENT_DATE)",
    [challenge, a],
  );
  const invitation = (
    await database.query(
      "INSERT INTO public.challenge_invitations(challenge_id,created_by,invited_user_id,invited_username_snapshot,token_hash,expires_at) VALUES($1,$2,$3,$4,$5,now()+interval '1 day') RETURNING id",
      [challenge, a, b, "old_" + b.slice(0, 8), randomUUID()],
    )
  ).rows[0].id;
  historicalChallengeEvent = (
    await database.query(
      "SELECT * FROM public.account_notification_events WHERE invitation_id=$1",
      [invitation],
    )
  ).rows[0];
}
const relationship = async (a, b) =>
  (
    await db.query(
      "SELECT * FROM public.community_relationships WHERE pair_low=least($1::uuid,$2::uuid) AND pair_high=greatest($1::uuid,$2::uuid)",
      [a, b],
    )
  ).rows[0];
const events = async (id) =>
  (
    await db.query(
      "SELECT * FROM public.account_notification_events WHERE community_relationship_id=$1 ORDER BY created_at,id",
      [id],
    )
  ).rows;
async function received() {
  const [a, b, t] = await pending();
  const r = await relationship(a, b);
  return { a, b, t, r, e: (await events(r.id))[0] };
}
const queueCount = async () =>
  (await db.query("SELECT count(*)::int n FROM public.challenge_notification_events")).rows[0].n;

test("sequential migration preserves existing Challenge event and does not backfill old Community rows", async () => {
  assert.equal(
    (
      await db.query(
        "SELECT count(*)::int n FROM public.account_notification_events WHERE event_type LIKE 'friend_%'",
      )
    ).rows[0].n,
    0,
  );
  assert.deepEqual(
    (
      await db.query("SELECT * FROM public.account_notification_events WHERE id=$1", [
        historicalChallengeEvent.id,
      ])
    ).rows[0],
    { ...historicalChallengeEvent, community_relationship_id: null, community_request_id: null },
  );
  for (const row of historical) assert.equal((await relationship(row.a, row.b)).status, row.status);
});
test("new successful send creates exactly one received event with authenticated actor, recipient and public handle", async () => {
  const f = await received();
  const rows = await events(f.r.id);
  assert.equal(rows.length, 1);
  const e = rows[0];
  assert.equal(e.event_type, "friend_request_received");
  assert.equal(e.actor_user_id, f.a);
  assert.equal(e.recipient_user_id, f.b);
  assert.equal(
    e.actor_username,
    (await db.query("SELECT username FROM public.profiles WHERE id=$1", [f.a])).rows[0].username,
  );
  assert.equal(e.community_request_id, f.t);
  assert.equal(e.challenge_id, null);
  assert.equal(e.invitation_id, null);
  assert.equal(e.read_at, null);
  assert.notEqual(e.actor_username, "Private Name");
  assert.notEqual(e.actor_username, "private@example.test");
});
test("send retry, double tap with another token and reciprocal send never duplicate or misdirect events", async () => {
  const f = await received();
  await send(f.a, f.b, f.t);
  await send(f.a, f.b);
  await send(f.b, f.a);
  assert.equal((await events(f.r.id)).length, 1);
  assert.equal((await events(f.r.id))[0].recipient_user_id, f.b);
});
test("accept emits one accepted event, reverses actor/recipient, and resolves received event atomically", async () => {
  const f = await received();
  await call(f.b, "accept_community_friend_request", [f.a, f.t]);
  await call(f.b, "accept_community_friend_request", [f.a, f.t]);
  const rows = await events(f.r.id);
  assert.equal(rows.length, 2);
  const accepted = rows.find((e) => e.event_type === "friend_request_accepted");
  assert.equal(accepted.actor_user_id, f.b);
  assert.equal(accepted.recipient_user_id, f.a);
  assert.equal(accepted.community_request_id, f.t);
  assert.equal(accepted.read_at, null);
  assert.ok(rows.find((e) => e.event_type === "friend_request_received").read_at);
});
for (const action of ["decline", "cancel"])
  test(action + " resolves received event without creating a response notification", async () => {
    const f = await received();
    await call(action === "cancel" ? f.a : f.b, action + "_community_friend_request", [
      action === "cancel" ? f.b : f.a,
      f.t,
    ]);
    const rows = await events(f.r.id);
    assert.equal(rows.length, 1);
    assert.ok(rows[0].read_at);
  });
for (const direction of ["requester", "recipient"])
  test(direction + " block resolves received event and repeated block is idempotent", async () => {
    const f = await received();
    const actor = direction === "requester" ? f.a : f.b,
      target = actor === f.a ? f.b : f.a;
    await call(actor, "block_community_user", [target]);
    const first = (await events(f.r.id))[0].read_at;
    assert.ok(first);
    await call(actor, "block_community_user", [target]);
    assert.equal((await events(f.r.id)).length, 1);
    assert.deepEqual((await events(f.r.id))[0].read_at, first);
    await call(actor, "unblock_community_user", [target]);
    assert.equal((await events(f.r.id)).length, 1);
  });
test("new lifecycle on same pair creates a new received event; delayed old sends/responses do not resurrect old events", async () => {
  const f = await received();
  await call(f.b, "decline_community_friend_request", [f.a, f.t]);
  const next = randomUUID();
  await send(f.b, f.a, next);
  await send(f.a, f.b, f.t);
  await assert.rejects(call(f.b, "accept_community_friend_request", [f.a, f.t]), /Request changed/);
  let rows = await events(f.r.id);
  assert.equal(rows.length, 2);
  assert.ok(rows.find((e) => e.community_request_id === f.t).read_at);
  const current = rows.find((e) => e.community_request_id === next);
  assert.equal(current.read_at, null);
  assert.equal(current.recipient_user_id, f.a);
  await call(f.a, "accept_community_friend_request", [f.b, next]);
  rows = await events(f.r.id);
  assert.equal(rows.length, 3);
  assert.ok(rows.find((e) => e.id === current.id).read_at);
});
test("historical pending retry makes no received event; new acceptance after migration emits only accepted", async () => {
  const f = historical.find((e) => e.status === "pending");
  await send(f.a, f.b, f.token);
  assert.equal((await events(f.id)).length, 0);
  await call(f.b, "accept_community_friend_request", [f.a, f.token]);
  assert.deepEqual(
    (await events(f.id)).map((e) => e.event_type),
    ["friend_request_accepted"],
  );
});
test("failed unauthorized, self, blocked and stale actions create no notifications or read receipts", async () => {
  const f = await received(),
    c = await user();
  await assert.rejects(call(f.a, "accept_community_friend_request", [f.b, f.t]), /Not authorized/);
  await assert.rejects(call(c, "accept_community_friend_request", [f.a, f.t]), /Request changed/);
  await assert.rejects(send(f.a, f.a), /Person unavailable/);
  assert.equal((await events(f.r.id)).length, 1);
  assert.equal((await events(f.r.id))[0].read_at, null);
  await call(f.b, "cancel_community_friend_request", [f.a, f.t]).then(
    () => assert.fail("unauthorized cancel succeeded"),
    () => {},
  );
  assert.equal((await events(f.r.id))[0].read_at, null);
  await call(f.a, "block_community_user", [f.b]);
  await assert.rejects(send(f.b, f.a), /Person unavailable/);
  assert.equal((await events(f.r.id)).length, 1);
});
test("send transaction rolls back relationship, notification and receipt when a later write fails", async () => {
  const [a, b] = await pair(),
    t = randomUUID();
  await db.exec(
    "CREATE FUNCTION public.test_fail_send_receipt() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'forced receipt failure'; END; $$; CREATE TRIGGER test_fail_send_receipt BEFORE INSERT ON private.community_send_receipts FOR EACH ROW EXECUTE FUNCTION public.test_fail_send_receipt();",
  );
  try {
    await assert.rejects(send(a, b, t), /forced receipt failure/);
  } finally {
    await db.exec(
      "DROP TRIGGER test_fail_send_receipt ON private.community_send_receipts; DROP FUNCTION public.test_fail_send_receipt()",
    );
  }
  assert.equal(await relationship(a, b), undefined);
  assert.equal(
    (
      await db.query(
        "SELECT id FROM public.account_notification_events WHERE community_request_id=$1",
        [t],
      )
    ).rows.length,
    0,
  );
  await send(a, b, t);
  assert.equal((await events((await relationship(a, b)).id)).length, 1);
});
test("accepted-event failure rolls back acceptance and received read receipt together", async () => {
  const f = await received();
  await db.exec(
    "CREATE FUNCTION public.test_fail_friend_accept() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.event_type='friend_request_accepted' THEN RAISE EXCEPTION 'forced notification failure'; END IF; RETURN NEW; END; $$; CREATE TRIGGER test_fail_friend_accept BEFORE INSERT ON public.account_notification_events FOR EACH ROW EXECUTE FUNCTION public.test_fail_friend_accept();",
  );
  try {
    await assert.rejects(
      call(f.b, "accept_community_friend_request", [f.a, f.t]),
      /forced notification failure/,
    );
  } finally {
    await db.exec(
      "DROP TRIGGER test_fail_friend_accept ON public.account_notification_events; DROP FUNCTION public.test_fail_friend_accept()",
    );
  }
  assert.equal((await relationship(f.a, f.b)).status, "pending");
  assert.equal((await events(f.r.id)).length, 1);
  assert.equal((await events(f.r.id))[0].read_at, null);
});
test("RLS restricts reads and mark-read to recipient; clients cannot forge or mutate identity/context", async () => {
  const f = await received(),
    c = await user();
  for (const uid of [f.a, c]) {
    await asUser(db, uid);
    assert.equal(
      (await db.query("SELECT * FROM public.account_notification_events WHERE id=$1", [f.e.id]))
        .rows.length,
      0,
    );
    await asService(db);
    assert.equal(
      (await call(uid, "mark_account_notification_read", [f.e.id]))[0]
        .mark_account_notification_read,
      false,
    );
  }
  await asUser(db, f.b);
  try {
    assert.equal(
      (await db.query("SELECT * FROM public.account_notification_events WHERE id=$1", [f.e.id]))
        .rows.length,
      1,
    );
    await assert.rejects(
      db.query(
        "INSERT INTO public.account_notification_events SELECT * FROM public.account_notification_events WHERE id=$1",
        [f.e.id],
      ),
      /permission denied/,
    );
    for (const col of [
      "actor_user_id",
      "recipient_user_id",
      "community_relationship_id",
      "community_request_id",
    ])
      await assert.rejects(
        db.query(`UPDATE public.account_notification_events SET ${col}=$1 WHERE id=$2`, [
          c,
          f.e.id,
        ]),
        /permission denied/,
      );
    await assert.rejects(
      db.query("SELECT private.notify_community_relationship_change()"),
      /permission denied/,
    );
  } finally {
    await asService(db);
  }
  assert.equal(
    (await call(f.b, "mark_account_notification_read", [f.e.id]))[0].mark_account_notification_read,
    true,
  );
  assert.ok((await events(f.r.id))[0].read_at);
});
test("anon denied; service role retains access; trigger is private and hardened, mark-read stays invoker", async () => {
  const f = await received();
  await db.exec("SET ROLE anon");
  try {
    await assert.rejects(
      db.query("SELECT * FROM public.account_notification_events"),
      /permission denied/,
    );
    await assert.rejects(
      db.query("SELECT public.mark_account_notification_read($1)", [f.e.id]),
      /permission denied/,
    );
  } finally {
    await db.exec("RESET ROLE");
  }
  const fn = (
    await db.query(
      "SELECT p.prosecdef,p.proconfig,has_function_privilege('authenticated',p.oid,'EXECUTE') AS client,has_function_privilege('anon',p.oid,'EXECUTE') AS anon FROM pg_proc p WHERE oid='private.notify_community_relationship_change()'::regprocedure",
    )
  ).rows[0];
  assert.equal(fn.prosecdef, true);
  assert.ok(fn.proconfig.includes('search_path=""'));
  assert.equal(fn.client, false);
  assert.equal(fn.anon, false);
  const mark = (
    await db.query(
      "SELECT prosecdef FROM pg_proc WHERE oid='public.mark_account_notification_read(uuid)'::regprocedure",
    )
  ).rows[0];
  assert.equal(mark.prosecdef, false);
  await db.exec("SET ROLE service_role");
  try {
    assert.equal(
      (await db.query("SELECT id FROM public.account_notification_events WHERE id=$1", [f.e.id]))
        .rows.length,
      1,
    );
  } finally {
    await db.exec("RESET ROLE");
  }
});
test("friend contexts reject missing, mixed and unknown kinds; lifecycle uniqueness cannot be bypassed with another dedupe key", async () => {
  const f = await received();
  const base = {
    recipient_user_id: f.b,
    actor_user_id: f.a,
    event_type: "friend_request_received",
    community_relationship_id: f.r.id,
    community_request_id: randomUUID(),
  };
  const insert = async (changes) => {
    const v = { ...base, ...changes, dedupe_key: randomUUID() };
    return db.query(
      `INSERT INTO public.account_notification_events(${Object.keys(v).join(",")}) VALUES(${Object.keys(
        v,
      )
        .map((_, i) => "$" + (i + 1))
        .join(",")})`,
      Object.values(v),
    );
  };
  for (const overrides of [
    { community_relationship_id: null },
    { community_request_id: null },
    { community_relationship_id: null, community_request_id: null },
    { challenge_id: historicalChallengeEvent.challenge_id },
    { invitation_id: historicalChallengeEvent.invitation_id },
  ])
    await assert.rejects(insert(overrides), /account_notification_context_ck/);
  await assert.rejects(
    insert({ event_type: "friend_removed" }),
    /account_notification_(?:events_event_type_check|context_ck)/,
  );
  await assert.rejects(
    insert({ community_request_id: f.t }),
    /account_notification_community_event_uidx/,
  );
});
test("Challenge contexts remain required and reject Community references", async () => {
  const f = await received();
  const base = {
    recipient_user_id: f.b,
    actor_user_id: f.a,
    event_type: "challenge_invitation_received",
    challenge_id: historicalChallengeEvent.challenge_id,
    invitation_id: historicalChallengeEvent.invitation_id,
  };
  const insert = async (changes) => {
    const v = { ...base, ...changes, dedupe_key: randomUUID() };
    return db.query(
      `INSERT INTO public.account_notification_events(${Object.keys(v).join(",")}) VALUES(${Object.keys(
        v,
      )
        .map((_, i) => "$" + (i + 1))
        .join(",")})`,
      Object.values(v),
    );
  };
  for (const overrides of [
    { challenge_id: null },
    { invitation_id: null },
    { community_relationship_id: f.r.id },
    { community_request_id: f.t },
  ])
    await assert.rejects(insert(overrides), /account_notification_context_ck/);
  await insert({});
});
test("friend events never enter the push queue; existing Challenge invitation emission and push remain working", async () => {
  const before = await queueCount();
  const f = await received();
  await call(f.b, "accept_community_friend_request", [f.a, f.t]);
  assert.equal(await queueCount(), before);
  const challenge = randomUUID();
  await db.query(
    "INSERT INTO public.challenges(id,created_by,name,start_date) VALUES($1,$2,'New challenge',CURRENT_DATE)",
    [challenge, f.a],
  );
  await db.query("INSERT INTO public.challenge_members(challenge_id,user_id) VALUES($1,$2)", [
    challenge,
    f.a,
  ]);
  const username = (await db.query("SELECT username FROM public.profiles WHERE id=$1", [f.b]))
    .rows[0].username;
  const invitation = (
    await db.query("SELECT public.send_challenge_username_invitation($1,$2,$3) AS id", [
      f.a,
      challenge,
      username,
    ])
  ).rows[0].id;
  assert.equal(await queueCount(), before + 1);
  await db.query("SELECT public.accept_challenge_invitation_by_id($1,$2)", [f.b, invitation]);
  assert.equal(await queueCount(), before + 2);
  const rows = (
    await db.query("SELECT * FROM public.account_notification_events WHERE invitation_id=$1", [
      invitation,
    ])
  ).rows;
  assert.deepEqual(rows.map((e) => e.event_type).sort(), [
    "challenge_invitation_accepted",
    "challenge_invitation_received",
  ]);
  assert.ok(
    rows.every((e) => e.community_relationship_id === null && e.community_request_id === null),
  );
});
test("privileged maintenance without auth does not manufacture new friend events", async () => {
  const [a, b] = await pair();
  await asService(db);
  const id = (
    await db.query(
      "INSERT INTO public.community_relationships(requester_id,recipient_id,request_id,status) VALUES($1,$2,$3,'pending') RETURNING id",
      [a, b, randomUUID()],
    )
  ).rows[0].id;
  await db.query("UPDATE public.community_relationships SET status='accepted' WHERE id=$1", [id]);
  assert.equal((await events(id)).length, 0);
});
test("migration contains no backfill, public event writer, policy/grant weakening or push changes", async () => {
  const sql = await readFile(
    new URL("20261024120000_community_account_notifications.sql", migrations),
    "utf8",
  );
  assert.doesNotMatch(
    sql,
    /CREATE (?:OR REPLACE )?FUNCTION public\.|INSERT INTO public\.challenge_notification_events|ALTER TABLE public\.challenge_notification_events|CREATE POLICY|GRANT .*INSERT/i,
  );
  assert.match(sql, /AFTER INSERT OR UPDATE ON public\.community_relationships/);
});

test("resolution preserves an existing read timestamp", async () => {
  const f = await received();
  await db.query(
    "UPDATE public.account_notification_events SET read_at='2001-01-01T00:00:00Z' WHERE id=$1",
    [f.e.id],
  );
  await call(f.b, "accept_community_friend_request", [f.a, f.t]);
  assert.equal(
    new Date((await events(f.r.id)).find((e) => e.id === f.e.id).read_at).toISOString(),
    "2001-01-01T00:00:00.000Z",
  );
});
test("failed received-event resolution also rolls back a pending block", async () => {
  const f = await received();
  await db.exec(
    "CREATE FUNCTION public.test_fail_friend_resolution() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.event_type='friend_request_received' THEN RAISE EXCEPTION 'forced resolution failure'; END IF; RETURN NEW; END; $$; CREATE TRIGGER test_fail_friend_resolution BEFORE UPDATE ON public.account_notification_events FOR EACH ROW EXECUTE FUNCTION public.test_fail_friend_resolution();",
  );
  try {
    await assert.rejects(call(f.a, "block_community_user", [f.b]), /forced resolution failure/);
  } finally {
    await db.exec(
      "DROP TRIGGER test_fail_friend_resolution ON public.account_notification_events; DROP FUNCTION public.test_fail_friend_resolution()",
    );
  }
  assert.equal((await relationship(f.a, f.b)).status, "pending");
  assert.equal((await events(f.r.id))[0].read_at, null);
  assert.equal(
    (
      await db.query(
        "SELECT * FROM public.community_blocks WHERE blocker_id=$1 AND blocked_id=$2",
        [f.a, f.b],
      )
    ).rows.length,
    0,
  );
});
test("accept/cancel competing outcomes never create a false acceptance or leave a pending unread received event", async () => {
  for (const first of ["accept", "cancel"]) {
    const f = await received();
    if (first === "accept") {
      await call(f.b, "accept_community_friend_request", [f.a, f.t]);
      await assert.rejects(
        call(f.a, "cancel_community_friend_request", [f.b, f.t]),
        /no longer pending/,
      );
    } else {
      await call(f.a, "cancel_community_friend_request", [f.b, f.t]);
      await assert.rejects(
        call(f.b, "accept_community_friend_request", [f.a, f.t]),
        /no longer pending/,
      );
    }
    const rows = await events(f.r.id);
    assert.ok(rows.find((e) => e.event_type === "friend_request_received").read_at);
    assert.equal(
      rows.filter((e) => e.event_type === "friend_request_accepted").length,
      first === "accept" ? 1 : 0,
    );
  }
});
