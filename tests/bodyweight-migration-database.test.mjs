import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { PGlite } from "@electric-sql/pglite";

const migrations = new URL("../supabase/migrations/", import.meta.url);
const targetMigration = "20260923120000_snapshot_public_workout_bodyweight.sql";

const platformSchema = `SET TIME ZONE 'UTC';
  CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role BYPASSRLS;
  CREATE SCHEMA auth; CREATE SCHEMA storage; CREATE SCHEMA extensions;
  CREATE TABLE auth.users(id uuid PRIMARY KEY);
  CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
  CREATE FUNCTION auth.jwt() RETURNS jsonb LANGUAGE sql STABLE AS $$ SELECT '{}'::jsonb $$;
  CREATE TABLE storage.buckets(id text PRIMARY KEY, public boolean NOT NULL DEFAULT false);
  INSERT INTO storage.buckets(id, public) VALUES
    ('challenge-evidence', true),('bulk-progress-photos', true),('payment-evidence', true);
  CREATE TABLE storage.objects(id uuid PRIMARY KEY, bucket_id text, name text);
  ALTER TABLE storage.objects ENABLE ROW LEVEL SECURITY;
  CREATE FUNCTION storage.foldername(text) RETURNS text[] LANGUAGE sql AS $$ SELECT string_to_array($1, '/') $$;
  GRANT SELECT, INSERT, UPDATE, DELETE ON storage.objects TO authenticated, service_role;
  GRANT USAGE ON SCHEMA auth, public, storage TO authenticated, anon, service_role;
  GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA auth TO authenticated, anon, service_role;`;

test("bodyweight snapshot migration applies sequentially without fabricating completed history", async () => {
  const database = new PGlite();
  const owner = randomUUID();
  let completedSession;
  try {
    await database.exec(platformSchema);
    const files = (await readdir(migrations)).filter((file) => file.endsWith(".sql")).sort();
    for (const file of files) {
      if (file === targetMigration) {
        await database.query("INSERT INTO auth.users(id) VALUES($1)", [owner]);
        await database.query(
          "INSERT INTO public.profiles(id,display_name) VALUES($1,'Historical athlete')",
          [owner],
        );
        await database.query("SELECT set_config('request.jwt.claim.sub',$1,false)", [owner]);
        await database.exec("SET ROLE authenticated");
        await database.query(
          `SELECT public.complete_goal_onboarding(
             'gain',70,78,0.25,'intermediate',4,
             ARRAY['dumbbells','cables','bench'],'custom',2900,140,360,90
           )`,
        );
        await database.exec("RESET ROLE");
        const profile = (
          await database.query("SELECT id FROM public.bulk_profiles WHERE owner_id=$1", [owner])
        ).rows[0].id;
        completedSession = (
          await database.query(
            `INSERT INTO public.bulk_training_sessions(
               bulk_profile_id,plan_name_snapshot,workout_day_name_snapshot,
               workout_day_order_snapshot,status,started_at,completed_at
             ) VALUES(
               $1,'Historical plan','Historical day',1,'completed',
               '2026-01-01T23:30:00-08:00'::timestamptz,
               '2026-01-02T09:00:00Z'::timestamptz
             ) RETURNING id`,
            [profile],
          )
        ).rows[0].id;
      }
      try {
        await database.exec(await readFile(new URL(file, migrations), "utf8"));
      } catch (error) {
        throw new Error(`Migration failed: ${file}`, { cause: error });
      }
    }

    assert.ok(completedSession, "historical fixture was inserted before the target migration");
    assert.deepEqual(
      (
        await database.query(
          `SELECT workout_date::text,bodyweight_kg::text,status
           FROM public.bulk_training_sessions WHERE id=$1`,
          [completedSession],
        )
      ).rows[0],
      { workout_date: "2026-01-02", bodyweight_kg: null, status: "completed" },
    );
  } finally {
    await database.close();
  }
});
