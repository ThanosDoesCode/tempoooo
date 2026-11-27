import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";

const migration = "20261127120000_community_v2_privacy_foundation.sql";
const root = new URL("../supabase/migrations/", import.meta.url);
const db = new PGlite();
let existingPolicies;
let historical;
const json = (sql, args = []) => db.query(sql, args).then((r) => Object.values(r.rows[0])[0]);

async function service() {
  await db.exec("RESET ROLE");
  await db.query("SELECT set_config('request.jwt.claim.sub','',false)");
}
async function as(uid, sql, args = [], role = "authenticated") {
  await service();
  await db.query("SELECT set_config('request.jwt.claim.sub',$1,false)", [uid ?? ""]);
  await db.exec(`SET ROLE ${role}`);
  try {
    return await db.query(sql, args);
  } finally {
    await service();
  }
}
async function rpc(uid, fn, args = []) {
  return (
    await as(
      uid,
      `SELECT public.${fn}(${args.map((_, i) => `$${i + 1}`).join(",")}) AS result`,
      args,
    )
  ).rows[0].result;
}
async function user() {
  await service();
  const id = randomUUID();
  await db.query("INSERT INTO auth.users VALUES($1)", [id]);
  await db.query(
    "INSERT INTO public.profiles(id,username,email,display_name,avatar_url) VALUES($1,$2,'secret@example.test','Private Name','private-avatar')",
    [id, "u_" + id.replaceAll("-", "").slice(0, 17)],
  );
  return id;
}
async function pending(a, b) {
  const token = randomUUID();
  await rpc(a, "send_community_friend_request", [b, token]);
  return token;
}
async function friends(a, b, backdate = true) {
  const token = await pending(a, b);
  await rpc(b, "accept_community_friend_request", [a, token]);
  if (backdate) {
    // Fixture time travel only. The production RPC timestamp is tested separately below.
    await db.query(
      "UPDATE public.community_relationships SET responded_at=now()-interval '1 day' WHERE request_id=$1",
      [token],
    );
  }
  return token;
}
async function profile(uid) {
  await service();
  let id = (await db.query("SELECT id FROM public.bulk_profiles WHERE owner_id=$1", [uid])).rows[0]
    ?.id;
  if (id) return id;
  id = (await db.query("INSERT INTO public.bulk_profiles(owner_id) VALUES($1) RETURNING id", [uid]))
    .rows[0].id;
  await db.query(
    "INSERT INTO public.bulk_members(bulk_profile_id,user_id,role) VALUES($1,$2,'owner')",
    [id, uid],
  );
  return id;
}
async function workout(uid, { completed = true, hoursAgo = 2 } = {}) {
  const bulk = await profile(uid);
  return (
    await db.query(
      `INSERT INTO public.bulk_training_sessions(bulk_profile_id,plan_name_snapshot,workout_day_name_snapshot,
        workout_day_order_snapshot,workout_date,status,started_at,completed_at,bodyweight_kg)
       VALUES($1,'PRIVATE PLAN','PRIVATE WORKOUT',1,CURRENT_DATE,$2,
         now()-$3::integer*interval '1 hour',
         CASE WHEN $2='completed' THEN now()-$3::integer*interval '1 hour'+interval '5 minutes' END,72)
       RETURNING id`,
      [bulk, completed ? "completed" : "in_progress", hoursAgo],
    )
  ).rows[0].id;
}
async function event(uid, options) {
  const session = await workout(uid, options);
  const id = (
    await db.query(
      "INSERT INTO private.community_activity_events(workout_session_id) VALUES($1) RETURNING id",
      [session],
    )
  ).rows[0].id;
  return { id, session };
}
const detail = async (uid, id) =>
  (await as(uid, "SELECT * FROM public.get_community_activity_event($1)", [id])).rows;
const feed = (uid, ...args) => rpc(uid, "list_community_activity_events", args);
const board = (uid, type = "run", tz = "UTC", ...args) =>
  rpc(uid, "community_weekly_leaderboard", [type, tz, ...args]);

// Only trusted fixture insertion bypasses activity-write triggers, to create arbitrary historical
// dates without changing production logging rules. All reads and relationship actions use real RLS/RPCs.
async function activity(uid, km, type = "run", date = null) {
  await service();
  const challenge = randomUUID();
  await db.query(
    "INSERT INTO public.challenges(id,created_by,name,start_date) VALUES($1,$2,'Private challenge',CURRENT_DATE)",
    [challenge, uid],
  );
  await db.exec("ALTER TABLE public.challenge_activities DISABLE TRIGGER USER");
  try {
    return (
      await db.query(
        `INSERT INTO public.challenge_activities(challenge_id,user_id,activity_type,distance_km,duration_seconds,
          activity_date,evidence_path,note) VALUES($1,$2,$3,$4,7200,coalesce($5::date,CURRENT_DATE),
          'PRIVATE EVIDENCE','PRIVATE NOTE') RETURNING id`,
        [challenge, uid, type, km, date],
      )
    ).rows[0].id;
  } finally {
    await db.exec("ALTER TABLE public.challenge_activities ENABLE TRIGGER USER");
  }
}
const policies = () =>
  db
    .query(
      `SELECT * FROM pg_policies WHERE schemaname='public'
       AND tablename IN ('challenge_activities','bulk_training_sessions','community_relationships','community_blocks')
       ORDER BY tablename,policyname`,
    )
    .then((r) => r.rows);

before(async () => {
  await db.exec(`SET TIME ZONE 'UTC';
    CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role BYPASSRLS;
    CREATE SCHEMA auth; CREATE SCHEMA storage; CREATE SCHEMA extensions;
    CREATE TABLE auth.users(id uuid PRIMARY KEY);
    CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$
      SELECT nullif(current_setting('request.jwt.claim.sub', true),'')::uuid $$;
    CREATE FUNCTION auth.jwt() RETURNS jsonb LANGUAGE sql STABLE AS $$ SELECT '{}'::jsonb $$;
    CREATE TABLE storage.buckets(id text PRIMARY KEY,public boolean NOT NULL DEFAULT false,
      file_size_limit bigint,allowed_mime_types text[]);
    INSERT INTO storage.buckets(id,public) VALUES('challenge-evidence',true),('bulk-progress-photos',true),('payment-evidence',true);
    CREATE TABLE storage.objects(id uuid PRIMARY KEY,bucket_id text,name text);
    ALTER TABLE storage.objects ENABLE ROW LEVEL SECURITY;
    CREATE FUNCTION storage.foldername(text) RETURNS text[] LANGUAGE sql AS $$ SELECT string_to_array($1,'/') $$;
    GRANT SELECT,INSERT,UPDATE,DELETE ON storage.objects TO authenticated,service_role;
    GRANT USAGE ON SCHEMA auth,public,storage TO authenticated,anon,service_role;
    GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA auth TO authenticated,anon,service_role;`);
  for (const file of (await readdir(root)).filter((f) => f.endsWith(".sql")).sort()) {
    if (file === migration) {
      existingPolicies = await policies();
      const a = await user(),
        b = await user();
      await friends(a, b);
      historical = { a, b, session: await workout(a) };
      // Existing accepted legacy row with an unknown timestamp must remain unknown.
      await db.query(
        "UPDATE public.community_relationships SET responded_at=NULL WHERE requester_id=$1",
        [a],
      );
    }
    try {
      await db.exec(await readFile(new URL(file, root), "utf8"));
    } catch (cause) {
      throw new Error(`Migration failed: ${file}`, { cause });
    }
  }
});
after(() => db.close());

test("additive migration changes no existing access policies, backfills no events, invents no acceptance timestamps", async () => {
  assert.deepEqual(await policies(), existingPolicies);
  assert.equal(await json("SELECT count(*)::int FROM private.community_activity_events"), 0);
  const stamp = await json(
    "SELECT responded_at FROM public.community_relationships WHERE requester_id=$1",
    [historical.a],
  );
  assert.equal(stamp, null);
  assert.deepEqual((await feed(historical.b)).events, []);
});

test("acceptance timestamp is server assigned, stable on retry, reset for a new request lifecycle", async () => {
  const a = await user(),
    b = await user(),
    token = await friends(a, b, false);
  const stamp = () =>
    json("SELECT responded_at::text FROM public.community_relationships WHERE request_id=$1", [
      token,
    ]);
  const first = await stamp();
  assert.ok(first);
  await rpc(b, "accept_community_friend_request", [a, token]);
  assert.equal(await stamp(), first);
  await assert.rejects(
    as(
      a,
      "UPDATE public.community_relationships SET responded_at='2000-01-01' WHERE request_id=$1",
      [token],
    ),
    /permission denied/,
  );
  await rpc(a, "remove_community_friend", [b, token]);
  const next = await pending(b, a);
  assert.equal(
    await json("SELECT responded_at FROM public.community_relationships WHERE request_id=$1", [
      next,
    ]),
    null,
  );
  await rpc(a, "accept_community_friend_request", [b, next]);
  assert.ok(
    await json("SELECT responded_at FROM public.community_relationships WHERE request_id=$1", [
      next,
    ]),
  );
});

test("leaderboard includes accepted friends plus self, excludes pending, declined, cancelled and strangers", async () => {
  const [me, friend, incoming, outgoing, declined, cancelled, stranger] = await Promise.all(
    Array.from({ length: 7 }, () => user()),
  );
  await friends(me, friend);
  await pending(incoming, me);
  await pending(me, outgoing);
  const d = await pending(me, declined);
  await rpc(declined, "decline_community_friend_request", [me, d]);
  const c = await pending(me, cancelled);
  await rpc(me, "cancel_community_friend_request", [cancelled, c]);
  await activity(me, 2);
  await activity(friend, 5);
  await activity(stranger, 999);
  const result = await board(me);
  assert.equal(result.participants, 2);
  assert.deepEqual(
    result.rows.map((r) => r.user_id),
    [friend, me],
  );
  assert.equal(result.self.rank, 2);
  assert.equal(result.self.distance_to_next_rank_km, 3.01);
});

test("Run and Ride aggregate raw recorded distance across sources, never equivalent or qualification distance", async () => {
  const me = await user();
  await activity(me, 2.25);
  await activity(me, 3.5);
  await activity(me, 30, "cycle");
  assert.equal((await board(me)).self.distance_km, 5.75);
  assert.equal((await board(me, "ride")).self.distance_km, 30);
  assert.equal((await board(me)).participants, 1);
  assert.equal((await board(me)).self.distance_to_next_rank_km, null);
});

test("zero-distance users share rank; positive ties share rank with stable UUID ordering and precise overtake distances", async () => {
  const me = await user(),
    a = await user(),
    b = await user(),
    zero = await user();
  for (const other of [a, b, zero]) await friends(me, other);
  await activity(a, 7.25);
  await activity(b, 7.25);
  await activity(me, 6.99);
  const result = await board(me);
  assert.deepEqual(
    result.rows.slice(0, 2).map((r) => r.user_id),
    [a, b].sort(),
  );
  assert.deepEqual(
    result.rows.map((r) => r.rank),
    [1, 1, 3, 4],
  );
  assert.equal(result.self.position, 3);
  assert.equal(result.self.distance_to_next_rank_km, 0.27);
  const tied = await board(me, "ride");
  assert.deepEqual(
    tied.rows.map((r) => r.rank),
    [1, 1, 1, 1],
  );
  assert.equal(tied.self.distance_to_break_tie_km, 0.01);
  assert.equal(tied.self.distance_to_next_rank_km, null);
});

test("leaderboard pages preserve global ranks and always return self outside the page", async () => {
  const me = await user(),
    a = await user(),
    b = await user();
  await friends(me, a);
  await friends(me, b);
  await activity(a, 4);
  await activity(b, 4);
  const first = await board(me, "run", "UTC", null, null, 1);
  const second = await board(
    me,
    "run",
    "UTC",
    first.next_cursor.distance_km,
    first.next_cursor.user_id,
    1,
  );
  const third = await board(
    me,
    "run",
    "UTC",
    second.next_cursor.distance_km,
    second.next_cursor.user_id,
    1,
  );
  assert.equal(first.self.user_id, me);
  assert.equal(first.self.rank, 3);
  assert.deepEqual([first.rows[0].rank, second.rows[0].rank, third.rows[0].rank], [1, 1, 3]);
  assert.equal(
    new Set([first.rows[0].user_id, second.rows[0].user_id, third.rows[0].user_id]).size,
    3,
  );
  assert.equal(third.next_cursor, null);
});

test("self rank remains available before a public profile exists and auth subjects never reuse another account's audience", async () => {
  const fresh = randomUUID();
  await db.query("INSERT INTO auth.users VALUES($1)", [fresh]);
  const empty = await board(fresh);
  assert.equal(empty.self.user_id, fresh);
  assert.equal(empty.self.username, null);
  assert.equal(empty.self.rank, 1);
  const a = await user(),
    b = await user(),
    friend = await user();
  await friends(a, friend);
  await activity(friend, 4);
  assert.equal((await board(a)).participants, 2);
  assert.equal((await board(b)).participants, 1);
  assert.equal((await board(b)).self.user_id, b);
  assert.equal((await board(a)).participants, 2);
});

test("server aggregation includes more than 1,000 activities without a PostgREST row-cap dependency", async () => {
  const owner = await user();
  const source = await activity(owner, 1);
  await db.exec("ALTER TABLE public.challenge_activities DISABLE TRIGGER USER");
  try {
    await db.query(
      `INSERT INTO public.challenge_activities(challenge_id,user_id,activity_type,distance_km,
        duration_seconds,activity_date,evidence_path)
      SELECT c.challenge_id,c.user_id,'run',1,600,CURRENT_DATE,'private-cap-fixture'
      FROM public.challenge_activities c CROSS JOIN generate_series(1,1100) WHERE c.id=$1`,
      [source],
    );
  } finally {
    await db.exec("ALTER TABLE public.challenge_activities ENABLE TRIGGER USER");
  }
  assert.equal((await board(owner)).self.distance_km, 1101);
});

test("current local week includes Monday and today, excludes previous Sunday, next Monday and future dates", async () => {
  const me = await user();
  const dates = (
    await db.query(`SELECT date_trunc('week',now() AT TIME ZONE 'UTC')::date::text AS monday,
      (date_trunc('week',now() AT TIME ZONE 'UTC')::date-1)::text AS previous_sunday,
      (date_trunc('week',now() AT TIME ZONE 'UTC')::date+7)::text AS next_monday,
      (CURRENT_DATE+1)::text AS tomorrow`)
  ).rows[0];
  await activity(me, 1, "run", dates.monday);
  await activity(me, 2);
  for (const date of [dates.previous_sunday, dates.next_monday, dates.tomorrow])
    await activity(me, 100, "run", date);
  const result = await board(me);
  assert.equal(result.week_start, dates.monday);
  assert.equal(result.self.distance_km, 3);
});

test("Monday-to-Sunday calendar bounds handle UTC crossover, DST, year boundaries and invalid zones", async () => {
  for (const [zone, instant, start, end] of [
    ["America/Los_Angeles", "2026-11-02T00:30:00Z", "2026-10-26", "2026-11-01"],
    ["Pacific/Kiritimati", "2026-11-01T12:00:00Z", "2026-11-02", "2026-11-08"],
    ["Europe/Stockholm", "2026-10-25T01:30:00Z", "2026-10-19", "2026-10-25"],
    ["UTC", "2027-01-01T12:00:00Z", "2026-12-28", "2027-01-03"],
  ]) {
    const r = (
      await db.query(
        "SELECT week_start::text,week_end::text FROM private.community_week_bounds($1,$2)",
        [zone, instant],
      )
    ).rows[0];
    assert.deepEqual(r, { week_start: start, week_end: end });
  }
  await assert.rejects(board(await user(), "run", "invented/zone"), /Invalid timezone/);
});

test("accepted friends can read safe workout events; pending, declined and unrelated users cannot read known IDs", async () => {
  const owner = await user(),
    friend = await user(),
    stranger = await user(),
    waiting = await user(),
    rejected = await user();
  await friends(owner, friend);
  await pending(owner, waiting);
  const token = await pending(owner, rejected);
  await rpc(rejected, "decline_community_friend_request", [owner, token]);
  const e = await event(owner);
  assert.equal((await detail(owner, e.id)).length, 1);
  assert.equal((await detail(friend, e.id)).length, 1);
  for (const denied of [stranger, waiting, rejected]) {
    assert.deepEqual(await detail(denied, e.id), []);
    assert.deepEqual((await feed(denied)).events, []);
    await assert.rejects(rpc(denied, "set_community_flame", [e.id, true]), /Event unavailable/);
  }
});

test("workouts before acceptance, begun before acceptance, and unknown acceptance timestamps fail closed", async () => {
  const owner = await user(),
    viewer = await user();
  await friends(owner, viewer);
  const old = await event(owner, { hoursAgo: 48 });
  const current = await event(owner);
  assert.deepEqual(await detail(viewer, old.id), []);
  assert.equal((await detail(viewer, current.id)).length, 1);
  await db.query(
    "UPDATE public.community_relationships SET responded_at=now()-interval '1 hour' WHERE requester_id=$1",
    [owner],
  );
  assert.deepEqual(await detail(viewer, current.id), []);
  await db.query(
    "UPDATE public.community_relationships SET responded_at=NULL WHERE requester_id=$1",
    [owner],
  );
  assert.deepEqual(await detail(viewer, current.id), []);
  assert.equal((await detail(owner, current.id)).length, 1);
  await db.query(
    "UPDATE public.community_relationships SET responded_at='-infinity' WHERE requester_id=$1",
    [owner],
  );
  assert.deepEqual(await detail(viewer, current.id), []);
});

for (const action of ["remove", "block by owner", "block by viewer"]) {
  test(`${action} immediately revokes leaderboard, feed, known event and reaction access`, async () => {
    const owner = await user(),
      viewer = await user(),
      token = await friends(owner, viewer);
    const e = await event(owner);
    await rpc(viewer, "set_community_flame", [e.id, true]);
    assert.equal((await detail(viewer, e.id))[0].has_flame, true);
    if (action === "remove") await rpc(viewer, "remove_community_friend", [owner, token]);
    else
      await rpc(action === "block by owner" ? owner : viewer, "block_community_user", [
        action === "block by owner" ? viewer : owner,
      ]);
    assert.equal((await board(viewer)).participants, 1);
    assert.deepEqual(await detail(viewer, e.id), []);
    assert.deepEqual((await feed(viewer)).events, []);
    await assert.rejects(
      rpc(viewer, "set_community_flame", [e.id, false]),
      /Event unavailable|Person unavailable/,
    );
  });
}

test("block wins even for an inconsistent accepted row; unblock/re-friend does not reveal the old lifecycle", async () => {
  const owner = await user(),
    viewer = await user();
  await friends(owner, viewer);
  const e = await event(owner);
  await rpc(viewer, "block_community_user", [owner]);
  await db.query(
    "UPDATE public.community_relationships SET status='accepted' WHERE requester_id=$1",
    [owner],
  );
  assert.equal((await board(viewer)).participants, 1);
  assert.deepEqual(await detail(viewer, e.id), []);
  await db.query(
    "UPDATE public.community_relationships SET status='removed' WHERE requester_id=$1",
    [owner],
  );
  await rpc(viewer, "unblock_community_user", [owner]);
  await friends(viewer, owner, false);
  assert.deepEqual(await detail(viewer, e.id), []);
});

test("sanitized responses have exact allowlists and no private values, source IDs or workout metadata", async () => {
  const owner = await user(),
    viewer = await user();
  await friends(owner, viewer);
  await activity(owner, 3);
  const e = await event(owner);
  const expected = [
    "id",
    "actor_user_id",
    "username",
    "event_type",
    "activity_date",
    "occurred_at",
    "published_at",
    "duration_seconds",
    "flame_count",
    "has_flame",
  ].sort();
  const one = (await detail(viewer, e.id))[0];
  const listed = (await feed(viewer)).events[0];
  assert.deepEqual(Object.keys(one).sort(), expected);
  assert.deepEqual(Object.keys(listed).sort(), expected);
  assert.equal(one.duration_seconds, 300);
  const ranking = await board(viewer);
  assert.deepEqual(Object.keys(ranking.rows[0]).sort(), [
    "distance_km",
    "position",
    "rank",
    "user_id",
    "username",
  ]);
  const serialized = JSON.stringify({ one, listed, ranking });
  assert.doesNotMatch(
    serialized,
    /PRIVATE|secret@|private-avatar|bodyweight|evidence|note|plan_name|source_|nutrition|payment/,
  );
  assert.ok(!serialized.includes(e.session));
  assert.deepEqual(
    (await as(viewer, "SELECT * FROM public.bulk_training_sessions WHERE id=$1", [e.session])).rows,
    [],
  );
  assert.deepEqual(
    (await as(viewer, "SELECT * FROM public.challenge_activities WHERE user_id=$1", [owner])).rows,
    [],
  );
});

test("feed keyset pagination handles equal timestamps with no duplicate or missing events", async () => {
  const owner = await user(),
    viewer = await user();
  await friends(owner, viewer);
  const ids = [];
  for (let i = 0; i < 5; i++) ids.push((await event(owner)).id);
  await db.query(
    "UPDATE private.community_activity_events SET published_at=now()-interval '1 minute' WHERE id=ANY($1::uuid[])",
    [ids],
  );
  const found = [];
  let cursor = null;
  do {
    const page = await feed(viewer, cursor?.published_at ?? null, cursor?.id ?? null, 2);
    found.push(...page.events.map((e) => e.id));
    cursor = page.next_cursor;
  } while (cursor);
  assert.deepEqual(found, ids.sort().reverse());
});

test("flames are idempotent, owner-scoped, account-isolated and never grant event access", async () => {
  const owner = await user(),
    a = await user(),
    b = await user();
  await friends(owner, a);
  await friends(owner, b);
  const e = await event(owner);
  await rpc(a, "set_community_flame", [e.id, true]);
  await rpc(a, "set_community_flame", [e.id, true]);
  assert.equal((await detail(a, e.id))[0].flame_count, 1);
  assert.equal((await detail(b, e.id))[0].has_flame, false);
  await rpc(b, "set_community_flame", [e.id, true]);
  await rpc(a, "set_community_flame", [e.id, false]);
  await rpc(a, "set_community_flame", [e.id, false]);
  assert.equal((await detail(b, e.id))[0].flame_count, 1);
  assert.equal((await detail(b, e.id))[0].has_flame, true);
});

test("RLS remains restrictive even if private table SELECT is accidentally granted; direct writes stay denied", async () => {
  const owner = await user(),
    friend = await user(),
    stranger = await user(),
    token = await friends(owner, friend);
  const e = await event(owner);
  await rpc(friend, "set_community_flame", [e.id, true]);
  await db.exec(
    "GRANT USAGE ON SCHEMA private TO authenticated; GRANT SELECT ON private.community_activity_events,private.community_flames TO authenticated",
  );
  try {
    assert.equal(
      (await as(friend, "SELECT * FROM private.community_activity_events WHERE id=$1", [e.id])).rows
        .length,
      1,
    );
    assert.equal(
      (await as(stranger, "SELECT * FROM private.community_activity_events WHERE id=$1", [e.id]))
        .rows.length,
      0,
    );
    assert.equal(
      (await as(owner, "SELECT * FROM private.community_flames WHERE event_id=$1", [e.id])).rows
        .length,
      0,
    );
    assert.equal(
      (await as(friend, "SELECT * FROM private.community_flames WHERE event_id=$1", [e.id])).rows
        .length,
      1,
    );
    for (const sql of [
      "INSERT INTO private.community_activity_events(workout_session_id) VALUES($1)",
      "DELETE FROM private.community_activity_events WHERE workout_session_id=$1",
      "UPDATE private.community_activity_events SET published_at=now() WHERE workout_session_id=$1",
    ])
      await assert.rejects(as(friend, sql, [e.session]), /permission denied/);
    await assert.rejects(
      as(friend, "INSERT INTO private.community_flames VALUES($1,$2)", [e.id, stranger]),
      /permission denied/,
    );
    await rpc(owner, "remove_community_friend", [friend, token]);
    assert.equal(
      (await as(friend, "SELECT * FROM private.community_activity_events WHERE id=$1", [e.id])).rows
        .length,
      0,
    );
    assert.equal(
      (await as(friend, "SELECT * FROM private.community_flames WHERE event_id=$1", [e.id])).rows
        .length,
      0,
    );
  } finally {
    await db.exec(
      "REVOKE SELECT ON private.community_activity_events,private.community_flames FROM authenticated",
    );
  }
});

test("anonymous, null-auth and forged-viewer calls cannot use V2 contracts", async () => {
  const me = await user();
  for (const sql of [
    "SELECT public.community_weekly_leaderboard('run','UTC')",
    "SELECT public.list_community_activity_events()",
    `SELECT public.get_community_activity_event('${randomUUID()}')`,
    `SELECT public.set_community_flame('${randomUUID()}',true)`,
  ]) {
    await assert.rejects(as(null, sql, [], "anon"), /permission denied/);
    await assert.rejects(as(null, sql), /Not authenticated/);
  }
  await assert.rejects(
    as(me, "SELECT public.community_weekly_leaderboard('run','UTC',_viewer=>$1)", [randomUUID()]),
    /does not exist/,
  );
  await assert.rejects(
    as(me, "SELECT public.set_community_flame($1,true,_user=>$2)", [randomUUID(), randomUUID()]),
    /does not exist/,
  );
  await assert.rejects(
    as(me, "SELECT * FROM private.community_v2_audience()"),
    /permission denied/,
  );
  await assert.rejects(
    as(me, "SELECT * FROM private.community_workout_event_details"),
    /permission denied/,
  );
});

test("limits and cursors reject malformed input without opening broader reads", async () => {
  const me = await user();
  for (const args of [
    ["cycle", "UTC"],
    ["run", "UTC", null, null, 51],
    ["run", "UTC", 1],
    ["run", "UTC", "NaN", randomUUID()],
    ["run", "UTC", 0.001, randomUUID()],
  ])
    await assert.rejects(rpc(me, "community_weekly_leaderboard", args), /Invalid leaderboard/);
  for (const args of [[null, null, 0], [new Date().toISOString()], ["infinity", randomUUID()]])
    await assert.rejects(feed(me, ...args), /Invalid feed/);
});

test("source deletion cascades events/flames, in-progress sources are hidden, and no client completion publication exists", async () => {
  const owner = await user();
  const active = await event(owner, { completed: false });
  assert.deepEqual(await detail(owner, active.id), []);
  const e = await event(owner);
  await rpc(owner, "set_community_flame", [e.id, true]);
  await db.query("DELETE FROM public.bulk_training_sessions WHERE id=$1", [e.session]);
  assert.deepEqual(await detail(owner, e.id), []);
  assert.equal(
    await json("SELECT count(*)::int FROM private.community_flames WHERE event_id=$1", [e.id]),
    0,
  );
  const count = await json("SELECT count(*)::int FROM private.community_activity_events");
  await workout(owner);
  await activity(owner, 1);
  assert.equal(await json("SELECT count(*)::int FROM private.community_activity_events"), count);
});

test("all new exposed RPCs are locked-search-path definers with no anon/PUBLIC execute or client table writes", async () => {
  const rows = (
    await db.query(`SELECT p.proname,p.prosecdef,p.proconfig,
      has_function_privilege('anon',p.oid,'EXECUTE') AS anon,
      has_function_privilege('authenticated',p.oid,'EXECUTE') AS authenticated
    FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
    WHERE n.nspname='public' AND p.proname IN
      ('community_weekly_leaderboard','get_community_activity_event','list_community_activity_events','set_community_flame')`)
  ).rows;
  assert.equal(rows.length, 4);
  for (const row of rows) {
    assert.equal(row.prosecdef, true);
    assert.deepEqual(row.proconfig, ['search_path=""']);
    assert.equal(row.anon, false);
    assert.equal(row.authenticated, true);
  }
  for (const table of ["community_activity_events", "community_flames"]) {
    for (const privilege of ["INSERT", "UPDATE", "DELETE", "SELECT"])
      assert.equal(
        await json("SELECT has_table_privilege('authenticated',$1,$2)", [
          `private.${table}`,
          privilege,
        ]),
        false,
      );
    assert.equal(
      await json("SELECT has_table_privilege('service_role',$1,'INSERT')", [`private.${table}`]),
      true,
    );
  }
});

test("local query-plan review compares the cross-Challenge actor/date aggregate before and after its candidate index", async (t) => {
  const owner = await user();
  const source = await activity(owner, 1);
  await db.exec("ALTER TABLE public.challenge_activities DISABLE TRIGGER USER");
  try {
    await db.query(
      `INSERT INTO public.challenge_activities(challenge_id,user_id,activity_type,distance_km,
        duration_seconds,activity_date,evidence_path)
      SELECT c.challenge_id,gen_random_uuid(),'run',1,600,CURRENT_DATE,'private-plan-fixture'
      FROM public.challenge_activities c CROSS JOIN generate_series(1,12000) WHERE c.id=$1`,
      [source],
    );
  } finally {
    await db.exec("ALTER TABLE public.challenge_activities ENABLE TRIGGER USER");
  }
  await db.exec("ANALYZE public.challenge_activities");
  const explain = () =>
    json(
      `EXPLAIN (ANALYZE,BUFFERS,FORMAT JSON)
    SELECT user_id,sum(distance_km) FROM public.challenge_activities
    WHERE user_id=$1 AND activity_type='run'
      AND activity_date BETWEEN date_trunc('week',CURRENT_DATE)::date AND CURRENT_DATE GROUP BY user_id`,
      [owner],
    );
  const index = "community_activity_actor_type_day_idx";
  await db.exec(`DROP INDEX IF EXISTS public.${index}`);
  const before = await explain();
  await db.exec(
    `CREATE INDEX ${index} ON public.challenge_activities(user_id,activity_type,activity_date) INCLUDE(distance_km)`,
  );
  const after = await explain();
  t.diagnostic("Before candidate index: " + JSON.stringify(before[0].Plan));
  t.diagnostic("After candidate index: " + JSON.stringify(after[0].Plan));
  assert.match(JSON.stringify(after), new RegExp(index));
  assert.equal((await board(owner)).self.distance_km, 1);
});
