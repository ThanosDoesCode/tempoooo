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

async function freshDatabase() {
  const database = new PGlite();
  await database.exec(platformSchema);
  const files = (await readdir(migrations)).filter((f) => f.endsWith(".sql")).sort();
  for (const file of files) {
    const sql = await readFile(new URL(file, migrations), "utf8");
    try {
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

test("all accumulated migrations apply; Community has no notification or Challenge backfill", async () => {
  assert.ok(db);
  const { rows } = await db.query("SELECT count(*)::int AS n FROM public.community_relationships");
  assert.equal(rows[0].n, 0);
  assert.equal(
    (await db.query("SELECT count(*)::int AS n FROM public.account_notification_events")).rows[0].n,
    0,
  );
});
test("A requests B twice: one pair, same row and request token", async () => {
  const [a, b, t] = await pending();
  await send(a, b, t);
  await send(a, b);
  assert.equal(await state(a, b), "outgoing_pending");
  assert.equal(await state(b, a), "incoming_pending");
  const rows = (
    await db.query("SELECT * FROM public.community_relationships WHERE requester_id=$1", [a])
  ).rows;
  assert.equal(rows.length, 1);
  assert.equal(rows[0].request_id, t);
});
test("reciprocal requests in either serialized arrival order remain one pending request, never automatic friends", async () => {
  for (let i = 0; i < 2; i++) {
    const [a, b] = await pair();
    await send(a, b);
    await send(b, a);
    assert.equal(await state(a, b), "outgoing_pending");
    assert.equal(await state(b, a), "incoming_pending");
  }
});
test("B accepts twice: mutual friendship, no duplicate", async () => {
  const [a, b, t] = await friends();
  await call(b, "accept_community_friend_request", [a, t]);
  assert.equal(await state(a, b), "friends");
  assert.equal(await state(b, a), "friends");
});
test("only recipient can accept or decline; actor cannot be impersonated", async () => {
  const [a, b, t] = await pending();
  for (const fn of ["accept_community_friend_request", "decline_community_friend_request"])
    await assert.rejects(call(a, fn, [b, t]), /Not authorized/);
  await assert.rejects(call(b, "cancel_community_friend_request", [a, t]), /Not authorized/);
  assert.equal(await state(a, b), "outgoing_pending");
});
test("decline twice is safe and request disappears from active lists/count", async () => {
  const [a, b, t] = await pending();
  await call(b, "decline_community_friend_request", [a, t]);
  await call(b, "decline_community_friend_request", [a, t]);
  assert.equal(await state(a, b), "none");
  assert.equal((await call(b, "list_community_people", ["incoming"])).length, 0);
  assert.equal((await call(b, "community_incoming_count"))[0].community_incoming_count, 0);
});
test("accept wins cancel race: later cancel cannot undo friendship", async () => {
  const [a, b, t] = await friends();
  await assert.rejects(call(a, "cancel_community_friend_request", [b, t]), /no longer pending/);
  assert.equal(await state(a, b), "friends");
});
test("cancel wins accept race: later accept cannot resurrect request", async () => {
  const [a, b, t] = await pending();
  await call(a, "cancel_community_friend_request", [b, t]);
  await call(a, "cancel_community_friend_request", [b, t]);
  await assert.rejects(call(b, "accept_community_friend_request", [a, t]), /no longer pending/);
  assert.equal(await state(a, b), "none");
});
test("either friend can remove twice; later re-request independent of stale send/response retries", async () => {
  const [a, b, t] = await friends();
  await call(b, "remove_community_friend", [a, t]);
  await call(b, "remove_community_friend", [a, t]);
  await send(a, b, t);
  assert.equal(await state(a, b), "none");
  const next = randomUUID();
  await send(b, a, next);
  await send(a, b, t);
  assert.equal((await profile(a, b)).request_id, next);
  await assert.rejects(call(b, "accept_community_friend_request", [a, t]), /Request changed/);
});
test("send request id cannot be reused for a different target", async () => {
  const [a, b, t] = await pending();
  const c = await user();
  await assert.rejects(send(a, c, t), /Request ID already used/);
});
test("block neutralizes pending request; blocked sends denied in both directions", async () => {
  const [a, b, t] = await pending();
  await call(a, "block_community_user", [b]);
  await call(a, "block_community_user", [b]);
  assert.equal(await profile(a, b), undefined);
  assert.equal(await profile(b, a), undefined);
  await assert.rejects(send(a, b), /Person unavailable/);
  await assert.rejects(send(b, a), /Person unavailable/);
  await assert.rejects(call(b, "accept_community_friend_request", [a, t]), /Request changed/);
  assert.equal((await call(b, "community_incoming_count"))[0].community_incoming_count, 0);
});
test("block accepted friend removes friendship; unblock never restores it", async () => {
  const [a, b] = await friends();
  await call(a, "block_community_user", [b]);
  await call(a, "unblock_community_user", [b]);
  await call(a, "unblock_community_user", [b]);
  assert.equal(await state(a, b), "none");
  await send(a, b);
  assert.equal(await state(a, b), "outgoing_pending");
});
test("directional unblock cannot remove somebody else’s block", async () => {
  const [a, b] = await pair();
  await call(a, "block_community_user", [b]);
  await call(b, "unblock_community_user", [a]);
  assert.equal(await profile(b, a), undefined);
  assert.equal((await call(a, "list_community_people", ["blocked"])).length, 1);
  assert.equal((await call(b, "list_community_people", ["blocked"])).length, 0);
});
test("block vs send has safe outcomes in both serialized arrival orders", async () => {
  for (const first of ["block", "send"]) {
    const [a, b] = await pair();
    if (first === "send") await send(a, b);
    await call(b, "block_community_user", [a]);
    if (first === "block") await assert.rejects(send(a, b), /Person unavailable/);
    assert.equal(await profile(a, b), undefined);
    const { rows } = await db.query(
      "SELECT count(*)::int n FROM public.community_relationships WHERE pair_low=least($1::uuid,$2::uuid) AND pair_high=greatest($1::uuid,$2::uuid) AND status IN ('pending','accepted')",
      [a, b],
    );
    assert.equal(rows[0].n, 0);
  }
});
test("self requests/blocks, null tokens and absent users are rejected", async () => {
  const [a, b] = await pair();
  await assert.rejects(send(a, a), /Person unavailable/);
  await assert.rejects(call(a, "block_community_user", [a]), /Person unavailable/);
  await assert.rejects(send(a, b, null), /Request ID required/);
  await assert.rejects(send(a, randomUUID()), /Person unavailable/);
});
test("unrelated user cannot act on another pair", async () => {
  const [a, b, t] = await pending(),
    c = await user();
  for (const fn of [
    "accept_community_friend_request",
    "decline_community_friend_request",
    "cancel_community_friend_request",
    "remove_community_friend",
  ])
    await assert.rejects(call(c, fn, [a, t]), /Request changed/);
  assert.equal(await state(a, b), "outgoing_pending");
});
test("RLS participant reads; no direct authenticated writes; blocks visible only to blocker", async () => {
  const [a, b, t] = await pending(),
    c = await user();
  await asUser(db, a);
  assert.equal(
    (await db.query("SELECT * FROM public.community_relationships WHERE request_id=$1", [t])).rows
      .length,
    1,
  );
  await assert.rejects(
    db.query("UPDATE public.community_relationships SET status='accepted' WHERE request_id=$1", [
      t,
    ]),
    /permission denied/,
  );
  await assert.rejects(
    db.query("INSERT INTO public.community_blocks(blocker_id,blocked_id) VALUES($1,$2)", [a, b]),
    /permission denied/,
  );
  await asUser(db, c);
  assert.equal(
    (await db.query("SELECT * FROM public.community_relationships WHERE request_id=$1", [t])).rows
      .length,
    0,
  );
  await asService(db);
  await call(a, "block_community_user", [b]);
  await asUser(db, b);
  assert.equal(
    (await db.query("SELECT * FROM public.community_blocks WHERE blocker_id=$1", [a])).rows.length,
    0,
  );
  await asUser(db, a);
  assert.equal(
    (await db.query("SELECT * FROM public.community_blocks WHERE blocker_id=$1", [a])).rows.length,
    1,
  );
  await asService(db);
});
test("anon lacks table and public/private RPC access; null auth cannot use definer RPCs", async () => {
  const a = await user();
  await asService(db);
  await db.exec("SET ROLE anon");
  await assert.rejects(
    db.query("SELECT * FROM public.community_relationships"),
    /permission denied/,
  );
  await assert.rejects(
    db.query("SELECT public.search_community_people('ab')"),
    /permission denied/,
  );
  await db.exec("RESET ROLE");
  for (const [fn, args] of [
    ["search_community_people", ["ab"]],
    ["get_community_profile", [a]],
    ["list_community_people", ["friends"]],
    ["community_incoming_count", []],
    ["send_community_friend_request", [a, randomUUID()]],
    ["block_community_user", [a]],
    ["unblock_community_user", [a]],
  ])
    await assert.rejects(call(null, fn, args), /Not authenticated/);
});
test("all Community RPCs use empty search_path, definer and authenticated-only grants; helpers private", async () => {
  const names = [
    "send_community_friend_request",
    "accept_community_friend_request",
    "decline_community_friend_request",
    "cancel_community_friend_request",
    "remove_community_friend",
    "block_community_user",
    "unblock_community_user",
    "search_community_people",
    "get_community_profile",
    "list_community_people",
    "community_incoming_count",
  ];
  for (const name of names) {
    const r = (
      await db.query(
        "SELECT p.oid,p.prosecdef,p.proconfig,has_function_privilege('anon',p.oid,'execute') AS anon,has_function_privilege('authenticated',p.oid,'execute') AS authed FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname=$1",
        [name],
      )
    ).rows[0];
    assert.equal(r.prosecdef, true, name);
    assert.ok(r.proconfig.includes('search_path=""'));
    assert.equal(r.anon, false, name);
    assert.equal(r.authed, true, name);
  }
  assert.equal(
    (
      await db.query(
        "SELECT has_function_privilege('authenticated','private.community_transition(uuid,uuid,text)','execute') AS ok",
      )
    ).rows[0].ok,
    false,
  );
  assert.equal(
    (
      await db.query(
        "SELECT has_table_privilege('service_role','public.community_relationships','INSERT,UPDATE,DELETE') AS ok",
      )
    ).rows[0].ok,
    true,
  );
});
test("search trims, is case insensitive, exact before prefix, excludes self and returns no private fields", async () => {
  const a = await user("zqalpha"),
    b = await user("zqalphabet"),
    c = await user("zqalpha_b"),
    observer = await user();
  const rows = await call(observer, "search_community_people", ["  ZQALPHA  "]);
  assert.deepEqual(
    rows.map((r) => r.user_id),
    [a, c, b],
  );
  assert.deepEqual(Object.keys(rows[0]).sort(), [
    "relationship_state",
    "request_id",
    "user_id",
    "username",
  ]);
  assert.equal(
    (await call(a, "search_community_people", ["zqalpha"])).some((r) => r.user_id === a),
    false,
  );
});
test("search short/empty/huge/percent/backslash queries are bounded/empty, underscore is literal", async () => {
  const a = await user();
  await user("zw_under");
  await user("zwxunder");
  for (const q of ["", " ", "z", "%", "zw%", "zw\\", "a".repeat(100000)])
    assert.equal((await call(a, "search_community_people", [q])).length, 0);
  assert.deepEqual(
    (await call(a, "search_community_people", ["zw_"])).map((r) => r.username),
    ["zw_under"],
  );
});
test("either-direction blocks disappear from search/profile and match missing-user behavior", async () => {
  const a = await user("zyalice"),
    b = await user("zybob");
  await call(a, "block_community_user", [b]);
  assert.equal((await call(a, "search_community_people", ["zybob"])).length, 0);
  assert.equal((await call(b, "search_community_people", ["zyalice"])).length, 0);
  assert.deepEqual(
    await call(b, "get_community_profile", [a]),
    await call(b, "get_community_profile", [randomUUID()]),
  );
});
test("search relationship projections cover all states; lists are bounded keyset pages, incoming count caps at 10", async () => {
  const a = await user();
  const others = [];
  for (let i = 0; i < 23; i++) {
    const b = await user("zx" + String(i).padStart(3, "0"));
    others.push(b);
    await send(b, a);
  }
  const first = await call(a, "list_community_people", ["incoming"]);
  const second = await call(a, "list_community_people", ["incoming", first.at(-1).user_id]);
  await asUser(db, a);
  const envelope = (await db.query("SELECT public.list_community_people('incoming') AS page"))
    .rows[0].page;
  await asService(db);
  assert.equal(envelope.next_cursor, first.at(-1).user_id);
  assert.equal(first.length, 20);
  assert.equal(second.length, 3);
  assert.equal(new Set([...first, ...second].map((p) => p.user_id)).size, 23);
  assert.equal((await call(a, "search_community_people", ["zx"])).length, 20);
  assert.equal((await call(a, "community_incoming_count"))[0].community_incoming_count, 10);
  assert.equal((await profile(a, others[0])).relationship_state, "incoming_pending");
  assert.equal((await profile(others[0], a)).relationship_state, "outgoing_pending");
  const token = (await profile(a, others[0])).request_id;
  await call(a, "accept_community_friend_request", [others[0], token]);
  assert.equal((await call(a, "list_community_people", ["friends"]))[0].user_id, others[0]);
  assert.equal((await call(others[0], "list_community_people", ["friends"]))[0].user_id, a);
});
test("profile table privacy unchanged; reads cannot dump other users’ private profiles", async () => {
  const [a, b] = await pair();
  await asUser(db, a);
  assert.equal(
    (await db.query("SELECT email,avatar_url FROM public.profiles WHERE id=$1", [b])).rows.length,
    0,
  );
  await assert.rejects(
    db.query("SELECT * FROM private.community_send_receipts"),
    /permission denied/,
  );
  await asService(db);
});
test("all pair writers share one transaction-scoped advisory lock; no dynamic SQL or Challenge mutation", async () => {
  const sql = await readFile(new URL("20261023120000_tempo_community.sql", migrations), "utf8");
  assert.match(sql, /pg_advisory_xact_lock/);
  assert.match(sql, /community_pair_unique UNIQUE/);
  for (const name of [
    "send_community_friend_request",
    "community_transition",
    "block_community_user",
    "unblock_community_user",
  ])
    assert.ok(
      sql
        .split("FUNCTION ")
        .find(
          (part) =>
            part.startsWith("public." + name + "(") || part.startsWith("private." + name + "("),
        )
        .includes("PERFORM private.community_lock_pair"),
    );
  assert.doesNotMatch(
    sql,
    /EXECUTE\s+(?!ON\b)|INSERT INTO public\.challenge|UPDATE public\.challenge/i,
  );
});

test("list RPC provides bounded JSON lookahead and honest terminal cursor", async () => {
  const [a, b] = await pair();
  await send(b, a);
  await asUser(db, a);
  try {
    const page = (await db.query("SELECT public.list_community_people('incoming') AS page")).rows[0]
      .page;
    assert.equal(page.people.length, 1);
    assert.equal(page.next_cursor, null);
    assert.deepEqual(Object.keys(page.people[0]).sort(), [
      "relationship_state",
      "request_id",
      "user_id",
      "username",
    ]);
  } finally {
    await asService(db);
  }
});

test("two directional blocks require each blocker to undo their own block", async () => {
  const [a, b] = await pair();
  await call(a, "block_community_user", [b]);
  await call(b, "block_community_user", [a]);
  await call(a, "unblock_community_user", [b]);
  assert.equal(await profile(a, b), undefined);
  await call(b, "unblock_community_user", [a]);
  assert.equal(await state(a, b), "none");
});
test("account deletion cascades Community graph/receipts without modifying the other account", async () => {
  const [a, b] = await pending();
  await call(a, "block_community_user", [b]);
  await asService(db);
  await db.query("DELETE FROM public.profiles WHERE id=$1", [a]);
  for (const [table, column] of [
    ["public.community_relationships", "requester_id"],
    ["public.community_blocks", "blocker_id"],
    ["private.community_send_receipts", "actor_id"],
  ])
    assert.equal(
      (await db.query(`SELECT count(*)::int n FROM ${table} WHERE ${column}=$1`, [a])).rows[0].n,
      0,
    );
  assert.equal((await db.query("SELECT id FROM public.profiles WHERE id=$1", [b])).rows.length, 1);
});
