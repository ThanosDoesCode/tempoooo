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

async function fitnessProfile(db) {
  const uid = randomUUID();
  await asService(db);
  await db.query("INSERT INTO auth.users(id) VALUES($1)", [uid]);
  await db.query("INSERT INTO public.profiles(id,display_name) VALUES($1,'Athlete')", [uid]);
  await asUser(db, uid);
  await db.query(
    `SELECT public.complete_goal_onboarding('gain',70,78,0.25,'intermediate',4,
       ARRAY['dumbbells','cables','bench'],'custom',2900,140,360,90)`,
  );
  await asService(db);
  const profile = (await db.query("SELECT id FROM public.bulk_profiles WHERE owner_id=$1", [uid]))
    .rows[0].id;
  return { uid, profile };
}

// A signed-in account with NO bulk profile (Challenge-only / core).
async function coreUser(db) {
  const uid = randomUUID();
  await asService(db);
  await db.query("INSERT INTO auth.users(id) VALUES($1)", [uid]);
  await db.query("INSERT INTO public.profiles(id,display_name) VALUES($1,'Challenger')", [uid]);
  return { uid };
}

const seedSystemExercise = async (db, id = "system:bench-press", supportsUnilateral = false) => {
  await asService(db);
  await db.query(
    `INSERT INTO public.bulk_exercises(id,slug,name,primary_muscle,equipment,movement_pattern,is_system,supports_unilateral)
     VALUES($1,$2,$3,'chest',ARRAY['barbell','bench'],'horizontal_push',true,$4)
     ON CONFLICT (id) DO NOTHING`,
    [id, id.replace("system:", ""), "Bench press", supportsUnilateral],
  );
  return id;
};

const seedCustomExercise = async (db, ownerUid, id, supportsUnilateral = false) => {
  await asService(db);
  await db.query(
    `INSERT INTO public.bulk_exercises(id,owner_id,slug,name,primary_muscle,equipment,movement_pattern,is_system,supports_unilateral)
     VALUES($1,$2,$3,$4,'biceps',ARRAY['dumbbell'],'elbow_flexion',false,$5)`,
    [id, ownerUid, id.replace("custom:", ""), "My curl", supportsUnilateral],
  );
  return id;
};

// RPC helpers (run as the owning user).
const createWorkout = async (db, uid, title, reqId) => {
  await asUser(db, uid);
  try {
    const sql = reqId
      ? "SELECT public.create_workout_template($1,$2) AS id"
      : "SELECT public.create_workout_template($1) AS id";
    const { rows } = await db.query(sql, reqId ? [title, reqId] : [title]);
    return rows[0].id;
  } finally {
    await asService(db);
  }
};
// Read/return updated_at as text so full microsecond precision round-trips through _expected_updated_at
// (a JS Date param would truncate to milliseconds and spuriously fail the optimistic-concurrency check).
const updatedAtOf = async (db, templateId) =>
  (
    await db.query(
      "SELECT updated_at::text AS updated_at FROM public.workout_templates WHERE id=$1",
      [templateId],
    )
  ).rows[0].updated_at;
const saveWorkout = async (db, uid, template, expected, title, exercises) => {
  await asUser(db, uid);
  try {
    const { rows } = await db.query(
      "SELECT public.save_workout_template_exercises($1,$2,$3,$4::jsonb)::text AS updated_at",
      [template, expected, title, JSON.stringify(exercises)],
    );
    return rows[0].updated_at;
  } finally {
    await asService(db);
  }
};
const duplicateWorkout = async (db, uid, templateId, reqId) => {
  await asUser(db, uid);
  try {
    const sql = reqId
      ? "SELECT public.duplicate_workout_template($1,$2) AS id"
      : "SELECT public.duplicate_workout_template($1) AS id";
    const { rows } = await db.query(sql, reqId ? [templateId, reqId] : [templateId]);
    return rows[0].id;
  } finally {
    await asService(db);
  }
};
const delWorkout = async (db, uid, templateId) => {
  await asUser(db, uid);
  try {
    const { rows } = await db.query("SELECT public.delete_workout_template($1) AS ok", [
      templateId,
    ]);
    return rows[0].ok;
  } finally {
    await asService(db);
  }
};
const templates = async (db, profile) =>
  (
    await db.query(
      "SELECT id,title,visibility,is_system,bulk_profile_id FROM public.workout_templates WHERE bulk_profile_id=$1 ORDER BY created_at",
      [profile],
    )
  ).rows;
const exercisesOf = async (db, templateId) =>
  (
    await db.query(
      "SELECT id,exercise_id,source_system_exercise_id,exercise_name,exercise_order,sets,rep_min,rep_max,intended_unilateral_mode,notes FROM public.workout_template_exercises WHERE workout_template_id=$1 ORDER BY exercise_order",
      [templateId],
    )
  ).rows;
const ex = (exerciseId, over = {}) => ({
  exerciseId,
  sets: 3,
  repMin: 5,
  repMax: 8,
  executionMode: "bilateral",
  notes: null,
  ...over,
});

// ------------------------------------------------------------------- schema
test("schema: tables, constraints, indexes and RLS exist; authenticated has SELECT but no write grants", async () => {
  const db = await freshDatabase();
  await asService(db);
  const tableExists = async (name) =>
    (await db.query("SELECT to_regclass($1) IS NOT NULL AS ok", [`public.${name}`])).rows[0].ok;
  assert.equal(await tableExists("workout_templates"), true);
  assert.equal(await tableExists("workout_template_exercises"), true);

  const rls = async (name) =>
    (
      await db.query("SELECT relrowsecurity FROM pg_class WHERE oid=$1::regclass", [
        `public.${name}`,
      ])
    ).rows[0].relrowsecurity;
  assert.equal(await rls("workout_templates"), true);
  assert.equal(await rls("workout_template_exercises"), true);

  const index = async (name) =>
    (await db.query("SELECT to_regclass($1) IS NOT NULL AS ok", [`public.${name}`])).rows[0].ok;
  assert.equal(await index("workout_templates_owner_idx"), true);
  assert.equal(await index("workout_template_exercises_template_idx"), true);

  // Origin check: a user row needs a profile; a system row must have none.
  await assert.rejects(
    db.query(
      "INSERT INTO public.workout_templates(bulk_profile_id,title,is_system) VALUES(NULL,'Bad',false)",
    ),
    /workout_templates_origin_ck/,
  );

  const priv = async (p) =>
    (
      await db.query(
        "SELECT has_table_privilege('authenticated','public.workout_templates',$1) AS ok",
        [p],
      )
    ).rows[0].ok;
  assert.equal(await priv("SELECT"), true);
  assert.equal(await priv("INSERT"), false);
  assert.equal(await priv("UPDATE"), false);
  assert.equal(await priv("DELETE"), false);
  const childPriv = async (p) =>
    (
      await db.query(
        "SELECT has_table_privilege('authenticated','public.workout_template_exercises',$1) AS ok",
        [p],
      )
    ).rows[0].ok;
  assert.equal(await childPriv("SELECT"), true);
  assert.equal(await childPriv("INSERT"), false);
  assert.equal(await childPriv("UPDATE"), false);
  assert.equal(await childPriv("DELETE"), false);
});

// ------------------------------------------------------------------- create
test("create: first workout is private/non-system under the caller's profile", async () => {
  const db = await freshDatabase();
  const { uid, profile } = await fitnessProfile(db);
  const id = await createWorkout(db, uid, "Push");
  const rows = await templates(db, profile);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].id, id);
  assert.equal(rows[0].visibility, "private");
  assert.equal(rows[0].is_system, false);
  assert.equal(rows[0].bulk_profile_id, profile);
  assert.equal((await exercisesOf(db, id)).length, 0);
});

test("create: duplicate titles allowed; title is not identity", async () => {
  const db = await freshDatabase();
  const { uid, profile } = await fitnessProfile(db);
  await createWorkout(db, uid, "Legs");
  await createWorkout(db, uid, "Legs");
  assert.equal((await templates(db, profile)).filter((t) => t.title === "Legs").length, 2);
});

test("create: same request id replays the same row; a different id is independent", async () => {
  const db = await freshDatabase();
  const { uid, profile } = await fitnessProfile(db);
  const req = randomUUID();
  const first = await createWorkout(db, uid, "Once", req);
  const second = await createWorkout(db, uid, "Once", req);
  assert.equal(first, second);
  assert.equal((await templates(db, profile)).length, 1);
  const third = await createWorkout(db, uid, "Twice", randomUUID());
  assert.notEqual(third, first);
  assert.equal((await templates(db, profile)).length, 2);
});

test("create: core/no-fitness user is rejected; workouts land in each caller's own profile", async () => {
  const db = await freshDatabase();
  const a = await fitnessProfile(db);
  const b = await fitnessProfile(db);
  const core = await coreUser(db);
  await assert.rejects(createWorkout(db, core.uid, "Nope"), /Active Bulk profile required/);
  await createWorkout(db, a.uid, "A-push");
  await createWorkout(db, b.uid, "B-push");
  assert.equal((await templates(db, a.profile)).length, 1);
  assert.equal((await templates(db, b.profile)).length, 1);
  assert.equal((await templates(db, a.profile))[0].title, "A-push");
});

// ------------------------------------------------------------------- save
test("save: title + exercises, ordering, names snapshotted, system + own custom allowed", async () => {
  const db = await freshDatabase();
  const { uid, profile } = await fitnessProfile(db);
  const sys = await seedSystemExercise(db);
  const own = await seedCustomExercise(db, uid, "custom:mine");
  const id = await createWorkout(db, uid, "Draft");
  const u0 = await updatedAtOf(db, id);
  await saveWorkout(db, uid, id, u0, "Upper", [ex(sys), ex(own)]);
  const rows = await exercisesOf(db, id);
  assert.equal(rows.length, 2);
  assert.deepEqual(
    rows.map((r) => r.exercise_order),
    [1, 2],
  );
  assert.equal(rows[0].exercise_name, "Bench press"); // snapshotted from bulk_exercises
  assert.equal(rows[0].source_system_exercise_id, sys); // set for system only
  assert.equal(rows[1].source_system_exercise_id, null); // null for custom
  assert.equal((await templates(db, profile))[0].title, "Upper");
});

test("save: reorder, change prescription/mode/notes, and remove exercises", async () => {
  const db = await freshDatabase();
  const { uid } = await fitnessProfile(db);
  const sys = await seedSystemExercise(db, "system:bench-press", true);
  const own = await seedCustomExercise(db, uid, "custom:mine", true);
  const id = await createWorkout(db, uid, "Draft");
  let u = await saveWorkout(db, uid, id, await updatedAtOf(db, id), "Wk", [ex(sys), ex(own)]);
  // Reorder (own first), change sets/reps/mode/notes, then shrink to one exercise.
  u = await saveWorkout(db, uid, id, u, "Wk", [
    ex(own, { sets: 4, repMin: 6, repMax: 10, executionMode: "unilateral", notes: "tempo" }),
  ]);
  const rows = await exercisesOf(db, id);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].exercise_id, own);
  assert.equal(rows[0].sets, 4);
  assert.equal(rows[0].rep_min, 6);
  assert.equal(rows[0].rep_max, 10);
  assert.equal(rows[0].intended_unilateral_mode, "unilateral");
  assert.equal(rows[0].notes, "tempo");
});

test("save: an empty workout is allowed", async () => {
  const db = await freshDatabase();
  const { uid } = await fitnessProfile(db);
  const sys = await seedSystemExercise(db);
  const id = await createWorkout(db, uid, "Draft");
  let u = await saveWorkout(db, uid, id, await updatedAtOf(db, id), "Wk", [ex(sys)]);
  u = await saveWorkout(db, uid, id, u, "Wk", []);
  assert.equal((await exercisesOf(db, id)).length, 0);
});

test("save: foreign custom, missing/inactive exercise and unsupported unilateral are rejected", async () => {
  const db = await freshDatabase();
  const a = await fitnessProfile(db);
  const b = await fitnessProfile(db);
  const sys = await seedSystemExercise(db); // supports_unilateral = false
  const foreign = await seedCustomExercise(db, b.uid, "custom:bs");
  const id = await createWorkout(db, a.uid, "Draft");
  const u0 = await updatedAtOf(db, id);
  await assert.rejects(
    saveWorkout(db, a.uid, id, u0, "Wk", [ex(foreign)]),
    /Exercise is unavailable/,
  );
  await assert.rejects(
    saveWorkout(db, a.uid, id, u0, "Wk", [ex("system:ghost")]),
    /Exercise is unavailable/,
  );
  await assert.rejects(
    saveWorkout(db, a.uid, id, u0, "Wk", [ex(sys, { executionMode: "unilateral" })]),
    /does not support unilateral mode/,
  );
  // Inactive exercise is also unavailable.
  await asService(db);
  await db.query("UPDATE public.bulk_exercises SET active=false WHERE id=$1", [sys]);
  await assert.rejects(saveWorkout(db, a.uid, id, u0, "Wk", [ex(sys)]), /Exercise is unavailable/);
});

test("save: failed validation leaves the original structure intact (atomic)", async () => {
  const db = await freshDatabase();
  const { uid } = await fitnessProfile(db);
  const sys = await seedSystemExercise(db);
  const id = await createWorkout(db, uid, "Draft");
  const u = await saveWorkout(db, uid, id, await updatedAtOf(db, id), "Good", [ex(sys)]);
  // A payload whose second exercise is invalid must not delete the first.
  await assert.rejects(
    saveWorkout(db, uid, id, u, "Broken", [ex(sys), ex("system:ghost")]),
    /Exercise is unavailable/,
  );
  const rows = await exercisesOf(db, id);
  assert.equal(rows.length, 1, "original single exercise survives the failed save");
  assert.equal(await updatedAtOf(db, id), u, "updated_at unchanged after a failed save");
});

test("save: a stale _expected_updated_at is rejected", async () => {
  const db = await freshDatabase();
  const { uid } = await fitnessProfile(db);
  const sys = await seedSystemExercise(db);
  const id = await createWorkout(db, uid, "Draft");
  const u0 = await updatedAtOf(db, id);
  await saveWorkout(db, uid, id, u0, "Wk", [ex(sys)]); // advances updated_at
  await assert.rejects(saveWorkout(db, uid, id, u0, "Wk", [ex(sys)]), /changed on another device/);
});

test("save: an exercise-only edit still advances updated_at", async () => {
  const db = await freshDatabase();
  const { uid } = await fitnessProfile(db);
  const sys = await seedSystemExercise(db);
  const id = await createWorkout(db, uid, "Same Title");
  const u1 = await saveWorkout(db, uid, id, await updatedAtOf(db, id), "Same Title", [ex(sys)]);
  // Title identical, only exercises change -> updated_at must still advance.
  const u2 = await saveWorkout(db, uid, id, u1, "Same Title", [ex(sys, { sets: 5 })]);
  assert.notEqual(String(u2), String(u1));
});

test("save: system workouts cannot be edited by a user", async () => {
  const db = await freshDatabase();
  const { uid } = await fitnessProfile(db);
  const sys = await seedSystemExercise(db);
  await asService(db);
  const systemWorkout = (
    await db.query(
      "INSERT INTO public.workout_templates(bulk_profile_id,title,is_system) VALUES(NULL,'Tempo PPL',true) RETURNING id",
    )
  ).rows[0].id;
  // Owner lookup never matches a system row -> 'Workout not found'.
  await assert.rejects(
    saveWorkout(db, uid, systemWorkout, new Date().toISOString(), "Hacked", [ex(sys)]),
    /Workout not found/,
  );
});

// ------------------------------------------------------------------- duplicate
test("duplicate: deep-copies with independent ids, '(copy)' title, private; source untouched", async () => {
  const db = await freshDatabase();
  const { uid, profile } = await fitnessProfile(db);
  const sys = await seedSystemExercise(db);
  const own = await seedCustomExercise(db, uid, "custom:mine");
  const src = await createWorkout(db, uid, "Original");
  await saveWorkout(db, uid, src, await updatedAtOf(db, src), "Original", [ex(sys), ex(own)]);

  const copy = await duplicateWorkout(db, uid, src);
  const copyRow = (await templates(db, profile)).find((t) => t.id === copy);
  assert.equal(copyRow.title, "Original (copy)");
  assert.equal(copyRow.visibility, "private");
  assert.equal(copyRow.is_system, false);

  const srcEx = await exercisesOf(db, src);
  const copyEx = await exercisesOf(db, copy);
  assert.equal(copyEx.length, 2);
  assert.deepEqual(
    copyEx.map((r) => [r.exercise_id, r.exercise_order, r.sets]),
    srcEx.map((r) => [r.exercise_id, r.exercise_order, r.sets]),
  );
  assert.notEqual(copyEx[0].id, srcEx[0].id, "copied exercise rows have independent ids");

  // Editing the copy does not touch the source.
  await saveWorkout(db, uid, copy, await updatedAtOf(db, copy), "Original (copy)", [ex(sys)]);
  assert.equal((await exercisesOf(db, src)).length, 2, "source unchanged after editing the copy");
});

test("duplicate: request-id retry dedupes to one copy", async () => {
  const db = await freshDatabase();
  const { uid, profile } = await fitnessProfile(db);
  const src = await createWorkout(db, uid, "Original");
  const req = randomUUID();
  const a = await duplicateWorkout(db, uid, src, req);
  const b = await duplicateWorkout(db, uid, src, req);
  assert.equal(a, b);
  assert.equal(
    (await templates(db, profile)).filter((t) => t.title === "Original (copy)").length,
    1,
  );
});

test("duplicate: an unavailable source exercise aborts before any insert (no partial copy)", async () => {
  const db = await freshDatabase();
  const { uid, profile } = await fitnessProfile(db);
  const sys = await seedSystemExercise(db);
  const src = await createWorkout(db, uid, "Has unavailable");
  await saveWorkout(db, uid, src, await updatedAtOf(db, src), "Has unavailable", [ex(sys)]);
  await asService(db);
  await db.query("UPDATE public.bulk_exercises SET active=false WHERE id=$1", [sys]);

  await assert.rejects(
    duplicateWorkout(db, uid, src),
    /unavailable exercise\. Remove or replace it before duplicating the workout\./,
  );
  assert.equal(
    (await templates(db, profile)).filter((t) => t.title.includes("(copy)")).length,
    0,
    "no copy row remains after the aborted duplicate",
  );
});

test("duplicate: another user's workout cannot be duplicated", async () => {
  const db = await freshDatabase();
  const a = await fitnessProfile(db);
  const b = await fitnessProfile(db);
  const src = await createWorkout(db, a.uid, "A-only");
  await assert.rejects(duplicateWorkout(db, b.uid, src), /Workout not found/);
  assert.equal((await templates(db, b.profile)).length, 0);
});

// ------------------------------------------------------------------- delete
test("delete: owner delete removes the template and cascades child rows only", async () => {
  const db = await freshDatabase();
  const { uid, profile } = await fitnessProfile(db);
  const sys = await seedSystemExercise(db);
  const id = await createWorkout(db, uid, "Temp");
  await saveWorkout(db, uid, id, await updatedAtOf(db, id), "Temp", [ex(sys)]);
  assert.equal(await delWorkout(db, uid, id), true);
  assert.equal((await templates(db, profile)).length, 0);
  await asService(db);
  // Child rows gone; bulk_exercises remain.
  assert.equal(
    Number(
      (await db.query("SELECT count(*)::int AS n FROM public.workout_template_exercises")).rows[0]
        .n,
    ),
    0,
  );
  assert.equal(
    Number(
      (await db.query("SELECT count(*)::int AS n FROM public.bulk_exercises WHERE id=$1", [sys]))
        .rows[0].n,
    ),
    1,
    "bulk_exercises row survives workout deletion",
  );
});

test("delete: plans and completed sessions are untouched by a workout delete", async () => {
  const db = await freshDatabase();
  const { uid, profile } = await fitnessProfile(db);
  // An unrelated plan + a completed session exist and must survive a workout delete.
  await asUser(db, uid);
  const planId = (await db.query("SELECT public.create_empty_bulk_training_plan('Keep2') AS id"))
    .rows[0].id;
  await asService(db);
  const sessionId = randomUUID();
  await db.query(
    `INSERT INTO public.bulk_training_sessions(id,bulk_profile_id,training_plan_id,plan_name_snapshot,workout_day_name_snapshot,workout_day_order_snapshot,status,completed_at,workout_date)
     VALUES($1,$2,$3,'Keep2','Push',1,'completed',now(),CURRENT_DATE)`,
    [sessionId, profile, planId],
  );
  const workout = await createWorkout(db, uid, "Temp");
  assert.equal(await delWorkout(db, uid, workout), true);
  await asService(db);
  assert.equal(
    Number(
      (
        await db.query("SELECT count(*)::int AS n FROM public.bulk_training_plans WHERE id=$1", [
          planId,
        ])
      ).rows[0].n,
    ),
    1,
    "plan survives",
  );
  assert.ok(
    (await db.query("SELECT 1 FROM public.bulk_training_sessions WHERE id=$1", [sessionId]))
      .rows[0],
    "completed session survives",
  );
});

test("delete: another user's workout is a no-op and a system workout cannot be deleted by a user", async () => {
  const db = await freshDatabase();
  const a = await fitnessProfile(db);
  const b = await fitnessProfile(db);
  const src = await createWorkout(db, a.uid, "A-only");
  assert.equal(await delWorkout(db, b.uid, src), false, "cross-user delete is a no-op false");
  assert.equal(
    (await templates(db, a.profile)).some((t) => t.id === src),
    true,
  );

  await asService(db);
  const systemWorkout = (
    await db.query(
      "INSERT INTO public.workout_templates(bulk_profile_id,title,is_system) VALUES(NULL,'Tempo PPL',true) RETURNING id",
    )
  ).rows[0].id;
  assert.equal(
    await delWorkout(db, a.uid, systemWorkout),
    false,
    "user cannot delete a system workout",
  );
  await asService(db);
  assert.ok(
    (await db.query("SELECT 1 FROM public.workout_templates WHERE id=$1", [systemWorkout])).rows[0],
    "system workout remains",
  );
});

// ------------------------------------------------------------------- privacy / visibility
test("privacy: a user cannot SELECT another user's private workout or its child rows", async () => {
  const db = await freshDatabase();
  const a = await fitnessProfile(db);
  const b = await fitnessProfile(db);
  const sys = await seedSystemExercise(db);
  const aWorkout = await createWorkout(db, a.uid, "A private");
  await saveWorkout(db, a.uid, aWorkout, await updatedAtOf(db, aWorkout), "A private", [ex(sys)]);

  await asUser(db, b.uid);
  const seenTemplate = Number(
    (
      await db.query("SELECT count(*)::int AS n FROM public.workout_templates WHERE id=$1", [
        aWorkout,
      ])
    ).rows[0].n,
  );
  const seenChildren = Number(
    (
      await db.query(
        "SELECT count(*)::int AS n FROM public.workout_template_exercises WHERE workout_template_id=$1",
        [aWorkout],
      )
    ).rows[0].n,
  );
  await asService(db);
  assert.equal(seenTemplate, 0, "B cannot read A's template");
  assert.equal(seenChildren, 0, "B cannot read A's child exercise rows");

  // Owner can read their own.
  await asUser(db, a.uid);
  assert.equal(
    Number(
      (
        await db.query("SELECT count(*)::int AS n FROM public.workout_templates WHERE id=$1", [
          aWorkout,
        ])
      ).rows[0].n,
    ),
    1,
  );
  await asService(db);
});

test("privacy: only owner-scoped SELECT policies exist (no public/community read)", async () => {
  const db = await freshDatabase();
  await asService(db);
  const policies = (
    await db.query(
      "SELECT policyname, cmd, qual FROM pg_policies WHERE schemaname='public' AND tablename IN ('workout_templates','workout_template_exercises') ORDER BY tablename, policyname",
    )
  ).rows;
  // Exactly the two owner-read policies, both SELECT, both gated by can_read_bulk.
  assert.equal(policies.length, 2);
  for (const p of policies) {
    assert.equal(p.cmd, "SELECT");
    assert.match(p.qual, /can_read_bulk/);
  }
});

test("visibility: every user path keeps visibility='private'; there is no publish path", async () => {
  const db = await freshDatabase();
  const { uid } = await fitnessProfile(db);
  const sys = await seedSystemExercise(db);
  const id = await createWorkout(db, uid, "Draft");
  await saveWorkout(db, uid, id, await updatedAtOf(db, id), "Draft", [ex(sys)]);
  const copy = await duplicateWorkout(db, uid, id);
  await asService(db);
  const vis = (
    await db.query("SELECT visibility FROM public.workout_templates WHERE id = ANY($1)", [
      [id, copy],
    ])
  ).rows.map((r) => r.visibility);
  assert.deepEqual(vis, ["private", "private"]);

  // No RPC exists to publish, and the owner has no direct UPDATE grant to flip it.
  const publishRpcs = Number(
    (
      await db.query(
        "SELECT count(*)::int AS n FROM pg_proc WHERE proname ~ 'workout' AND proname ~ 'publish'",
      )
    ).rows[0].n,
  );
  assert.equal(publishRpcs, 0);
  await asUser(db, uid);
  await assert.rejects(
    db.query("UPDATE public.workout_templates SET visibility='public' WHERE id=$1", [id]),
    /permission denied/i,
  );
  await asService(db);
});
