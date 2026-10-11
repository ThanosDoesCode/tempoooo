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

// RPC helpers (run as the owning user).
const createEmpty = async (db, uid, name, reqId) => {
  await asUser(db, uid);
  const sql = reqId
    ? "SELECT public.create_empty_bulk_training_plan($1,$2) AS id"
    : "SELECT public.create_empty_bulk_training_plan($1) AS id";
  const { rows } = await db.query(sql, reqId ? [name, reqId] : [name]);
  await asService(db);
  return rows[0].id;
};
const instantiate = async (db, uid, templateId, planType = "tempo_preset", reqId) => {
  await asUser(db, uid);
  const sql = reqId
    ? "SELECT public.instantiate_bulk_training_plan($1,$2,$3) AS id"
    : "SELECT public.instantiate_bulk_training_plan($1,$2) AS id";
  const { rows } = await db.query(
    sql,
    reqId ? [templateId, planType, reqId] : [templateId, planType],
  );
  await asService(db);
  return rows[0].id;
};
const activate = async (db, uid, planId) => {
  await asUser(db, uid);
  try {
    await db.query("SELECT public.activate_bulk_training_plan($1)", [planId]);
  } finally {
    await asService(db);
  }
};
const del = async (db, uid, planId) => {
  await asUser(db, uid);
  try {
    const { rows } = await db.query("SELECT public.delete_bulk_training_plan($1) AS ok", [planId]);
    return rows[0].ok;
  } finally {
    await asService(db);
  }
};
const duplicate = async (db, uid, planId, reqId) => {
  await asUser(db, uid);
  const sql = reqId
    ? "SELECT public.duplicate_bulk_training_plan($1,$2) AS id"
    : "SELECT public.duplicate_bulk_training_plan($1) AS id";
  const { rows } = await db.query(sql, reqId ? [planId, reqId] : [planId]);
  await asService(db);
  return rows[0].id;
};
const plans = async (db, profile) =>
  (
    await db.query(
      "SELECT id, name, active, plan_type, source_template_id FROM public.bulk_training_plans WHERE bulk_profile_id=$1 ORDER BY created_at",
      [profile],
    )
  ).rows;
const activeCount = async (db, profile) =>
  Number(
    (
      await db.query(
        "SELECT count(*)::int AS n FROM public.bulk_training_plans WHERE bulk_profile_id=$1 AND active",
        [profile],
      )
    ).rows[0].n,
  );
const planCounts = async (db, profile) =>
  (
    await db.query(
      `SELECT
         (SELECT count(*) FROM public.bulk_training_plans WHERE bulk_profile_id=$1)::int AS plans,
         (SELECT count(*) FROM public.bulk_training_plan_days d
            JOIN public.bulk_training_plans p ON p.id=d.plan_id WHERE p.bulk_profile_id=$1)::int AS days,
         (SELECT count(*) FROM public.bulk_training_plan_exercises e
            JOIN public.bulk_training_plan_days d ON d.id=e.plan_day_id
            JOIN public.bulk_training_plans p ON p.id=d.plan_id WHERE p.bulk_profile_id=$1)::int AS exercises`,
      [profile],
    )
  ).rows[0];

async function seedTemplate(db, slug = "test") {
  await asService(db);
  const id = `template:${slug}`;
  await db.query(
    `INSERT INTO public.bulk_training_plan_templates(id,slug,name,description,experience_level,training_days_per_week,split_summary)
     VALUES($1,$2,'Test template','A template','intermediate',3,'3-day split')`,
    [id, slug],
  );
  await db.query(
    "INSERT INTO public.bulk_training_plan_template_days(id,template_id,day_order,name) VALUES($1,$2,1,'Day 1')",
    [`${id}:day1`, id],
  );
  return id;
}

async function addDayWithExercise(db, planId, dayOrder = 1, dayName = "Push") {
  await asService(db);
  await db.query(
    `INSERT INTO public.bulk_exercises(id,slug,name,primary_muscle,equipment,movement_pattern,is_system)
     VALUES('system:bench-press','bench-press','Bench press','chest',ARRAY['barbell','bench'],'horizontal_push',true)
     ON CONFLICT (id) DO NOTHING`,
  );
  const dayId = randomUUID();
  await db.query(
    "INSERT INTO public.bulk_training_plan_days(id,plan_id,day_order,name) VALUES($1,$2,$3,$4)",
    [dayId, planId, dayOrder, dayName],
  );
  await db.query(
    `INSERT INTO public.bulk_training_plan_exercises(plan_day_id,exercise_id,exercise_name,exercise_order,sets,rep_min,rep_max)
     VALUES($1,'system:bench-press','Bench press',1,3,5,8)`,
    [dayId],
  );
  // Reflect a real custom plan's training_days_per_week.
  await db.query(
    "UPDATE public.bulk_training_plans SET training_days_per_week=greatest(training_days_per_week,$2) WHERE id=$1",
    [planId, dayOrder],
  );
  return dayId;
}

// ------------------------------------------------------------------- create
test("first plan is active; a second plan is saved inactive and never touches the first", async () => {
  const db = await freshDatabase();
  const { uid, profile } = await fitnessProfile(db);
  const a = await createEmpty(db, uid, "Plan A");
  const afterA = await plans(db, profile);
  assert.equal(afterA.length, 1);
  assert.equal(afterA[0].active, true);

  const b = await createEmpty(db, uid, "Plan B");
  const after = await plans(db, profile);
  assert.equal(after.length, 2);
  const planA = after.find((p) => p.id === a);
  const planB = after.find((p) => p.id === b);
  assert.equal(planA.active, true, "Plan A stays active");
  assert.equal(planA.name, "Plan A", "Plan A is unchanged");
  assert.equal(planB.active, false, "Plan B is saved inactive");
  assert.equal(await activeCount(db, profile), 1);
});

test("duplicate plan names and repeated copies of the same template are allowed", async () => {
  const db = await freshDatabase();
  const { uid, profile } = await fitnessProfile(db);
  await createEmpty(db, uid, "Legs");
  await createEmpty(db, uid, "Legs");
  const sameName = (await plans(db, profile)).filter((p) => p.name === "Legs");
  assert.equal(sameName.length, 2);

  const template = await seedTemplate(db);
  const t1 = await instantiate(db, uid, template);
  const t2 = await instantiate(db, uid, template);
  assert.notEqual(t1, t2);
  const fromTemplate = (await plans(db, profile)).filter((p) => p.source_template_id === template);
  assert.equal(fromTemplate.length, 2);
  assert.equal(await activeCount(db, profile), 1); // still at most one active
});

test("create is idempotent per request id (retry/replay inserts once)", async () => {
  const db = await freshDatabase();
  const { uid, profile } = await fitnessProfile(db);
  const req = randomUUID();
  const first = await createEmpty(db, uid, "Once", req);
  const second = await createEmpty(db, uid, "Once", req);
  assert.equal(first, second);
  assert.equal((await plans(db, profile)).length, 1);
});

// ------------------------------------------------------------------- activate
test("activation moves active to the selected plan and never yields two active", async () => {
  const db = await freshDatabase();
  const { uid, profile } = await fitnessProfile(db);
  const a = await createEmpty(db, uid, "Plan A");
  const b = await createEmpty(db, uid, "Plan B");
  await activate(db, uid, b);
  const after = await plans(db, profile);
  assert.equal(after.find((p) => p.id === a).active, false);
  assert.equal(after.find((p) => p.id === b).active, true);
  assert.equal(await activeCount(db, profile), 1);
  // Activating the already-active plan is a safe no-op.
  await activate(db, uid, b);
  assert.equal(await activeCount(db, profile), 1);
});

test("activation is denied across users and blocked during an in-progress session", async () => {
  const db = await freshDatabase();
  const a = await fitnessProfile(db);
  const b = await fitnessProfile(db);
  const aPlan = await createEmpty(db, a.uid, "A-plan");
  // Cross-user: B cannot activate A's plan.
  await assert.rejects(activate(db, b.uid, aPlan));
  assert.equal((await plans(db, a.profile)).find((p) => p.id === aPlan).active, true);

  // In-progress session blocks switching.
  const second = await createEmpty(db, a.uid, "A-plan-2");
  await asService(db);
  await db.query(
    `INSERT INTO public.bulk_training_sessions(bulk_profile_id,plan_name_snapshot,workout_day_name_snapshot,workout_day_order_snapshot,status,workout_date)
     VALUES($1,'A-plan','Day',1,'in_progress',CURRENT_DATE)`,
    [a.profile],
  );
  await assert.rejects(activate(db, a.uid, second));
});

// ------------------------------------------------------------------- delete
test("deleting the active plan leaves zero active and never auto-activates another", async () => {
  const db = await freshDatabase();
  const { uid, profile } = await fitnessProfile(db);
  const a = await createEmpty(db, uid, "Plan A"); // active
  await createEmpty(db, uid, "Plan B"); // inactive
  assert.equal(await del(db, uid, a), true);
  assert.equal(await activeCount(db, profile), 0, "deleting the active plan leaves zero active");
  const left = await plans(db, profile);
  assert.equal(left.length, 1);
  assert.equal(left[0].active, false, "the remaining plan is not auto-activated");
});

test("deletion preserves completed session history and nulls the source FK", async () => {
  const db = await freshDatabase();
  const { uid, profile } = await fitnessProfile(db);
  const plan = await createEmpty(db, uid, "Hist");
  await asService(db);
  const sessionId = randomUUID();
  await db.query(
    `INSERT INTO public.bulk_training_sessions(id,bulk_profile_id,training_plan_id,plan_name_snapshot,workout_day_name_snapshot,workout_day_order_snapshot,status,completed_at,workout_date)
     VALUES($1,$2,$3,'Hist','Push',1,'completed',now(),CURRENT_DATE)`,
    [sessionId, profile, plan],
  );
  assert.equal(await del(db, uid, plan), true);
  const row = (
    await db.query("SELECT training_plan_id FROM public.bulk_training_sessions WHERE id=$1", [
      sessionId,
    ])
  ).rows[0];
  assert.ok(row, "completed session survives plan deletion");
  assert.equal(row.training_plan_id, null, "source plan FK is nulled, snapshot stays");
});

test("deletion is blocked by an in-progress session on that plan and denied across users", async () => {
  const db = await freshDatabase();
  const a = await fitnessProfile(db);
  const b = await fitnessProfile(db);
  const plan = await createEmpty(db, a.uid, "Busy");
  await asService(db);
  await db.query(
    `INSERT INTO public.bulk_training_sessions(bulk_profile_id,training_plan_id,plan_name_snapshot,workout_day_name_snapshot,workout_day_order_snapshot,status,workout_date)
     VALUES($1,$2,'Busy','Day',1,'in_progress',CURRENT_DATE)`,
    [a.profile, plan],
  );
  await assert.rejects(del(db, a.uid, plan));
  // Cross-user delete is a no-op that leaves the plan intact.
  assert.equal(await del(db, b.uid, plan), false);
  assert.equal(
    (await plans(db, a.profile)).some((p) => p.id === plan),
    true,
  );
});

// ------------------------------------------------------------------- duplicate
test("duplicate deep-copies days and exercises with independent ids; source is unchanged", async () => {
  const db = await freshDatabase();
  const { uid, profile } = await fitnessProfile(db);
  const source = await createEmpty(db, uid, "Original");
  const sourceDay = await addDayWithExercise(db, source, 1, "Push");

  const copy = await duplicate(db, uid, source);
  const copyRow = (await plans(db, profile)).find((p) => p.id === copy);
  assert.equal(copyRow.active, false, "copy is inactive");
  assert.equal(copyRow.name, "Original (copy)");

  const sourceDays = (
    await db.query(
      "SELECT id,name,day_order FROM public.bulk_training_plan_days WHERE plan_id=$1",
      [source],
    )
  ).rows;
  const copyDays = (
    await db.query(
      "SELECT id,name,day_order FROM public.bulk_training_plan_days WHERE plan_id=$1",
      [copy],
    )
  ).rows;
  assert.equal(copyDays.length, 1);
  assert.equal(copyDays[0].name, "Push");
  assert.notEqual(copyDays[0].id, sourceDay, "copied day has an independent id");

  const copyExercises = (
    await db.query(
      "SELECT exercise_name,plan_day_id FROM public.bulk_training_plan_exercises WHERE plan_day_id=$1",
      [copyDays[0].id],
    )
  ).rows;
  assert.equal(copyExercises.length, 1);
  assert.equal(copyExercises[0].exercise_name, "Bench press");

  // Editing the copy's day does not touch the source.
  await asService(db);
  await db.query("UPDATE public.bulk_training_plan_days SET name='Pull' WHERE id=$1", [
    copyDays[0].id,
  ]);
  const sourceStillPush = (
    await db.query("SELECT name FROM public.bulk_training_plan_days WHERE id=$1", [sourceDay])
  ).rows[0].name;
  assert.equal(sourceStillPush, "Push", "source day unchanged after editing the copy");

  // No sessions are copied; two copies with the same (copy) name are allowed.
  const copy2 = await duplicate(db, uid, source);
  assert.notEqual(copy, copy2);
  assert.equal((await plans(db, profile)).filter((p) => p.name === "Original (copy)").length, 2);
});

// ------------------------------------------------------------------- switch compatibility
test("explicit switch still deactivates the old plan and activates the replacement (at most one active)", async () => {
  const db = await freshDatabase();
  const { uid, profile } = await fitnessProfile(db);
  const a = await createEmpty(db, uid, "Plan A"); // active
  await asUser(db, uid);
  const b = (
    await db.query("SELECT public.switch_to_empty_bulk_training_plan($1) AS id", ["Plan B"])
  ).rows[0].id;
  await asService(db);
  const after = await plans(db, profile);
  assert.equal(after.find((p) => p.id === a).active, false, "old plan deactivated");
  assert.equal(after.find((p) => p.id === b).active, true, "replacement becomes active");
  assert.equal(await activeCount(db, profile), 1);
});

// ------------------------------------------------------------------- zero-active recovery
test("zero-active recovery: delete active, then a normal create becomes the active plan again", async () => {
  const db = await freshDatabase();
  const { uid, profile } = await fitnessProfile(db);
  const a = await createEmpty(db, uid, "Plan A");
  await del(db, uid, a);
  assert.equal(await activeCount(db, profile), 0);
  const c = await createEmpty(db, uid, "Plan C");
  assert.equal((await plans(db, profile)).find((p) => p.id === c).active, true);
  assert.equal(await activeCount(db, profile), 1);
});

// ------------------------------------------------------------------- duplicate: unavailable exercise
test("duplicating a plan with an unavailable (inactive) exercise is refused with the domain error, atomically", async () => {
  const db = await freshDatabase();
  const { uid, profile } = await fitnessProfile(db);
  const source = await createEmpty(db, uid, "Has unavailable");
  await addDayWithExercise(db, source, 1, "Push");
  // Make the referenced exercise unavailable (a reachable state via deactivation).
  await asService(db);
  await db.query("UPDATE public.bulk_exercises SET active=false WHERE id='system:bench-press'");
  const before = await planCounts(db, profile);

  await asUser(db, uid);
  let message = "";
  try {
    await db.query("SELECT public.duplicate_bulk_training_plan($1)", [source]);
  } catch (error) {
    message = String(error?.message ?? "");
  }
  await asService(db);

  assert.match(
    message,
    /unavailable exercise\. Remove or replace it before duplicating the plan\./,
  );
  assert.doesNotMatch(message, /Exercise is unavailable/); // the deliberate domain error, not the trigger text
  assert.deepEqual(await planCounts(db, profile), before); // no partial plan/day/exercise rows
  assert.equal(
    (await plans(db, profile)).filter((p) => p.name.includes("(copy)")).length,
    0,
    "no duplicate plan remains after failure",
  );
});

test("an orphaned exercise_id = NULL row is also refused with the domain error", async () => {
  const db = await freshDatabase();
  const { uid, profile } = await fitnessProfile(db);
  const source = await createEmpty(db, uid, "Null exercise");
  // Simulate a legacy orphaned row (exercise_id null) by bypassing the validate trigger once.
  await asService(db);
  const dayId = randomUUID();
  await db.query(
    "INSERT INTO public.bulk_training_plan_days(id,plan_id,day_order,name) VALUES($1,$2,1,'Day')",
    [dayId, source],
  );
  await db.exec("SET session_replication_role = replica");
  await db.query(
    `INSERT INTO public.bulk_training_plan_exercises(plan_day_id,exercise_name,exercise_order,sets,rep_min,rep_max)
     VALUES($1,'Orphan',1,3,5,8)`,
    [dayId],
  );
  await db.exec("SET session_replication_role = origin");

  await asUser(db, uid);
  let message = "";
  try {
    await db.query("SELECT public.duplicate_bulk_training_plan($1)", [source]);
  } catch (error) {
    message = String(error?.message ?? "");
  }
  await asService(db);
  assert.match(
    message,
    /unavailable exercise\. Remove or replace it before duplicating the plan\./,
  );
  assert.equal((await plans(db, profile)).filter((p) => p.name.includes("(copy)")).length, 0);
});

test("a valid plan still duplicates normally after the guard", async () => {
  const db = await freshDatabase();
  const { uid, profile } = await fitnessProfile(db);
  const source = await createEmpty(db, uid, "Valid plan");
  await addDayWithExercise(db, source, 1, "Push");
  const copy = await duplicate(db, uid, source);
  const days = Number(
    (
      await db.query(
        "SELECT count(*)::int AS n FROM public.bulk_training_plan_days WHERE plan_id=$1",
        [copy],
      )
    ).rows[0].n,
  );
  assert.equal(days, 1);
  assert.equal((await plans(db, profile)).find((p) => p.id === copy).name, "Valid plan (copy)");
});
