import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { PGlite } from "@electric-sql/pglite";

const db = new PGlite();
const me = randomUUID(),
  opponent = randomUUID(),
  other = randomUUID(),
  outsider = randomUUID();
const challenge = randomUUID(),
  another = randomUUID();
const saved = [];
before(async () => {
  // Only platform services are stubbed. Authorization, triggers and grants are
  // loaded unchanged from every committed application migration, in memory.
  await db.exec(`SET TIME ZONE 'UTC';
    CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role BYPASSRLS;
    CREATE SCHEMA auth; CREATE SCHEMA storage; CREATE SCHEMA extensions;
    CREATE TABLE auth.users(id uuid PRIMARY KEY);
    CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
    CREATE FUNCTION auth.jwt() RETURNS jsonb LANGUAGE sql STABLE AS $$ SELECT '{}'::jsonb $$;
    CREATE TABLE storage.buckets(id text PRIMARY KEY, public boolean NOT NULL DEFAULT false, file_size_limit bigint, allowed_mime_types text[]);
    INSERT INTO storage.buckets(id) VALUES ('challenge-evidence'),('bulk-progress-photos'),('payment-evidence');
    CREATE TABLE storage.objects(id uuid PRIMARY KEY, bucket_id text, name text);
    ALTER TABLE storage.objects ENABLE ROW LEVEL SECURITY;
    CREATE FUNCTION storage.foldername(text) RETURNS text[] LANGUAGE sql AS $$ SELECT string_to_array($1, '/') $$;
    GRANT SELECT, INSERT, UPDATE, DELETE ON storage.objects TO authenticated, service_role;
    GRANT USAGE ON SCHEMA auth, public, storage TO authenticated, anon, service_role;
    GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA auth TO authenticated, anon, service_role;`);
  const root = new URL("../supabase/migrations/", import.meta.url);
  for (const filename of (await readdir(root)).filter((name) => name.endsWith(".sql")).sort())
    await db.exec(await readFile(new URL(filename, root), "utf8"));
  for (const uid of [me, opponent, other, outsider]) {
    await db.query("INSERT INTO auth.users VALUES ($1)", [uid]);
    await db.query("INSERT INTO public.profiles(id) VALUES ($1)", [uid]);
  }
  for (const [id, owner] of [
    [challenge, me],
    [another, other],
  ]) {
    await db.query(
      "INSERT INTO public.challenges(id,created_by,name,start_date,timezone) VALUES ($1,$2,'Private',CURRENT_DATE,'UTC')",
      [id, owner],
    );
    await db.query(
      "INSERT INTO public.challenge_members(challenge_id,user_id,role) VALUES ($1,$2,'owner')",
      [id, owner],
    );
  }
  await db.query("INSERT INTO public.challenge_members(challenge_id,user_id) VALUES ($1,$2)", [
    challenge,
    opponent,
  ]);
  for (const [cid, uid, type, distance] of [
    [challenge, me, "run", 3.1],
    [challenge, opponent, "cycle", 9],
    [another, other, "run", 5],
  ]) {
    const path = `${cid}/${uid}/${randomUUID()}.webp`;
    const result = await asUser(uid, () =>
      db.query(
        `INSERT INTO public.challenge_activities(challenge_id,user_id,activity_type,distance_km,duration_seconds,activity_date,evidence_path)
      VALUES ($1,$2,$3,$4,930,CURRENT_DATE,$5) RETURNING id,qualifying_equivalent_km`,
        [cid, uid, type, distance, path],
      ),
    );
    saved.push({ ...result.rows[0], cid, uid, path });
    await db.query(
      "INSERT INTO storage.objects(id,bucket_id,name) VALUES ($1,'challenge-evidence',$2)",
      [randomUUID(), path],
    );
  }
});
after(async () => {
  await db.close();
});
async function asUser(uid, action) {
  await db.query("SELECT set_config('request.jwt.claim.sub',$1,false)", [uid]);
  await db.exec("SET ROLE authenticated");
  try {
    return await action();
  } finally {
    await db.exec("RESET ROLE");
  }
}
const activities = (uid) =>
  asUser(uid, () =>
    db.query(
      "SELECT id,user_id FROM public.challenge_activities WHERE challenge_id=$1 ORDER BY user_id",
      [challenge],
    ),
  );

test("both real participants can read both sides of their Challenge, with unchanged run/ride contributions", async () => {
  for (const uid of [me, opponent]) {
    const result = await activities(uid);
    assert.deepEqual(new Set(result.rows.map((row) => row.user_id)), new Set([me, opponent]));
  }
  assert.equal(Number(saved[0].qualifying_equivalent_km), 3.1);
  assert.equal(Number(saved[1].qualifying_equivalent_km), 3);
});

test("existing evidence policy explicitly authorizes participants but never unrelated users", async () => {
  for (const uid of [me, opponent]) {
    const result = await asUser(uid, () =>
      db.query(
        "SELECT name FROM storage.objects WHERE bucket_id='challenge-evidence' ORDER BY name",
      ),
    );
    assert.deepEqual(
      new Set(result.rows.map((row) => row.name)),
      new Set(saved.filter((row) => row.cid === challenge).map((row) => row.path)),
    );
  }
  assert.equal(
    (await asUser(outsider, () => db.query("SELECT name FROM storage.objects"))).rows.length,
    0,
  );
  assert.equal(
    (await db.query("SELECT public FROM storage.buckets WHERE id='challenge-evidence'")).rows[0]
      .public,
    false,
  );
});

test("outsiders and other-Challenge participants cannot read these activities or their evidence", async () => {
  for (const uid of [outsider, other]) {
    assert.equal((await activities(uid)).rows.length, 0);
    assert.equal(
      (
        await asUser(uid, () =>
          db.query("SELECT name FROM storage.objects WHERE name=$1", [saved[1].path]),
        )
      ).rows.length,
      0,
    );
  }
  assert.equal(
    (
      await asUser(me, () =>
        db.query("SELECT id FROM public.challenge_activities WHERE challenge_id=$1", [another]),
      )
    ).rows.length,
    0,
  );
});

test("seeing an opponent activity never grants mutation rights", async () => {
  const result = await asUser(me, () =>
    db.query("UPDATE public.challenge_activities SET note='forged' WHERE id=$1 RETURNING id", [
      saved[1].id,
    ]),
  );
  assert.equal(result.rows.length, 0);
  const removed = await asUser(me, () =>
    db.query("DELETE FROM public.challenge_activities WHERE id=$1 RETURNING id", [saved[1].id]),
  );
  assert.equal(removed.rows.length, 0);
});

test("anon cannot read Challenge activities or private evidence", async () => {
  await db.exec("SET ROLE anon");
  try {
    await assert.rejects(
      db.query("SELECT id FROM public.challenge_activities"),
      /permission denied/,
    );
    await assert.rejects(db.query("SELECT name FROM storage.objects"), /permission denied/);
  } finally {
    await db.exec("RESET ROLE");
  }
});
