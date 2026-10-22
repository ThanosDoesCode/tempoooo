import { test } from "node:test";
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
  const db = new PGlite();
  await db.exec(platformSchema);
  for (const file of (await readdir(migrations)).filter((f) => f.endsWith(".sql")).sort()) {
    try {
      await db.exec(await readFile(new URL(file, migrations), "utf8"));
    } catch (error) {
      throw new Error(`migration ${file} failed: ${error.message}`);
    }
  }
  return db;
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

// A challenge with one member who also has one seeded adjustment row. Returns ids.
async function seedChallengeWithAdjustment(db, name) {
  const member = randomUUID();
  await asService(db);
  await db.query("INSERT INTO auth.users(id) VALUES($1)", [member]);
  await db.query("INSERT INTO public.profiles(id) VALUES($1)", [member]);
  const challenge = (
    await db.query(
      "INSERT INTO public.challenges(created_by,name,start_date) VALUES($1,$2,CURRENT_DATE-14) RETURNING id",
      [member, name],
    )
  ).rows[0].id;
  await db.query(
    "INSERT INTO public.challenge_members(challenge_id,user_id,role) VALUES($1,$2,'owner')",
    [challenge, member],
  );
  const adjustment = (
    await db.query(
      `INSERT INTO public.challenge_week_adjustments(challenge_id,user_id,week_number,kind,status,requested_by)
       VALUES($1,$2,1,'sick','pending',$2) RETURNING id`,
      [challenge, member],
    )
  ).rows[0].id;
  return { member, challenge, adjustment };
}

const visibleIds = async (db, uid) => {
  await asUser(db, uid);
  try {
    return (
      await db.query("SELECT id FROM public.challenge_week_adjustments ORDER BY created_at")
    ).rows.map((r) => r.id);
  } finally {
    await asService(db);
  }
};

test("a user can read only their own challenge's week adjustments, never another challenge's", async () => {
  const db = await freshDatabase();
  const A = await seedChallengeWithAdjustment(db, "Alpha");
  const B = await seedChallengeWithAdjustment(db, "Bravo");
  const outsider = randomUUID();
  await asService(db);
  await db.query("INSERT INTO auth.users(id) VALUES($1)", [outsider]);
  await db.query("INSERT INTO public.profiles(id) VALUES($1)", [outsider]);

  const aSees = await visibleIds(db, A.member);
  assert.deepEqual(aSees, [A.adjustment], "member of A sees only A's adjustment");

  const bSees = await visibleIds(db, B.member);
  assert.deepEqual(bSees, [B.adjustment], "member of B sees only B's adjustment");

  assert.deepEqual(await visibleIds(db, outsider), [], "unrelated user sees nothing");
});

test("anon cannot read challenge week adjustments", async () => {
  const db = await freshDatabase();
  await seedChallengeWithAdjustment(db, "Alpha");
  await asService(db);
  await db.exec("SET ROLE anon");
  await assert.rejects(
    db.query("SELECT id FROM public.challenge_week_adjustments"),
    /permission denied/i,
  );
  await asService(db);
});

test("authenticated users have no direct write grants; writes go through RPCs only", async () => {
  const db = await freshDatabase();
  await asService(db);
  const priv = async (p) =>
    (
      await db.query(
        "SELECT has_table_privilege('authenticated','public.challenge_week_adjustments',$1) AS ok",
        [p],
      )
    ).rows[0].ok;
  assert.equal(await priv("SELECT"), true);
  assert.equal(await priv("INSERT"), false);
  assert.equal(await priv("UPDATE"), false);
  assert.equal(await priv("DELETE"), false);
  assert.equal(
    (
      await db.query(
        "SELECT relrowsecurity FROM pg_class WHERE oid='public.challenge_week_adjustments'::regclass",
      )
    ).rows[0].relrowsecurity,
    true,
    "RLS remains enabled",
  );
});

test("the read policy correlates to the outer challenge and is not a self-comparison tautology", async () => {
  const db = await freshDatabase();
  await asService(db);
  const qual = (
    await db.query(
      "SELECT qual FROM pg_policies WHERE schemaname='public' AND tablename='challenge_week_adjustments' AND policyname='week adjustments read members'",
    )
  ).rows[0].qual;
  assert.match(
    qual,
    /challenge_week_adjustments\.challenge_id/,
    "correlated to the adjustment's challenge",
  );
  assert.doesNotMatch(qual, /m\.challenge_id = m\.challenge_id/, "no tautological self-comparison");
});

test("RPC behavior is unchanged: a requested adjustment is readable by its challenge's member", async () => {
  const db = await freshDatabase();
  const A = await seedChallengeWithAdjustment(db, "Alpha");
  // The subject requests a sick exception via the RPC (unchanged by this migration).
  await asUser(db, A.member);
  const created = (
    await db.query("SELECT public.request_challenge_week_exception($1,2,'sick') AS id", [
      A.challenge,
    ])
  ).rows[0].id;
  await asService(db);
  assert.ok(created);
  // It is visible to the member, and remains invisible to an outsider.
  assert.ok((await visibleIds(db, A.member)).includes(created));
  const outsider = randomUUID();
  await asService(db);
  await db.query("INSERT INTO auth.users(id) VALUES($1)", [outsider]);
  await db.query("INSERT INTO public.profiles(id) VALUES($1)", [outsider]);
  assert.equal((await visibleIds(db, outsider)).includes(created), false);
});
