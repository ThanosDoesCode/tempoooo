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

let shared;
/** One migrated database for the file; every test uses its own fresh accounts. */
async function database() {
  if (shared) return shared;
  const db = new PGlite();
  await db.exec(platformSchema);
  const files = (await readdir(migrations)).filter((f) => f.endsWith(".sql")).sort();
  for (const file of files) {
    try {
      await db.exec(await readFile(new URL(file, migrations), "utf8"));
    } catch (error) {
      throw new Error(`migration ${file} failed: ${error.message}`);
    }
  }
  shared = db;
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
/** Run `sql` as `uid`, always returning to the service role. */
async function as(db, uid, sql, params = []) {
  await asUser(db, uid);
  try {
    return await db.query(sql, params);
  } finally {
    await asService(db);
  }
}
async function rejects(db, uid, sql, params, pattern) {
  await asUser(db, uid);
  try {
    await assert.rejects(db.query(sql, params), pattern);
  } finally {
    await asService(db);
  }
}

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

async function coreUser(db) {
  const uid = randomUUID();
  await asService(db);
  await db.query("INSERT INTO auth.users(id) VALUES($1)", [uid]);
  await db.query("INSERT INTO public.profiles(id,display_name) VALUES($1,'Challenger')", [uid]);
  return { uid };
}

/** An active plan day with `exercises` real exercise rows. */
async function planDay(db, profile, name = "Upper A", exercises = 3) {
  await asService(db);
  let plan = (
    await db.query(
      "SELECT id FROM public.bulk_training_plans WHERE bulk_profile_id=$1 AND active",
      [profile],
    )
  ).rows[0]?.id;
  if (!plan) {
    plan = (
      await db.query(
        `INSERT INTO public.bulk_training_plans(bulk_profile_id,plan_type,name,training_days_per_week,active)
         VALUES($1,'custom','My plan',4,true) RETURNING id`,
        [profile],
      )
    ).rows[0].id;
  }
  const order = (
    await db.query(
      "SELECT coalesce(max(day_order),0)+1 AS n FROM public.bulk_training_plan_days WHERE plan_id=$1",
      [plan],
    )
  ).rows[0].n;
  const day = (
    await db.query(
      "INSERT INTO public.bulk_training_plan_days(plan_id,day_order,name) VALUES($1,$2,$3) RETURNING id",
      [plan, order, name],
    )
  ).rows[0].id;
  await db.query(
    `INSERT INTO public.bulk_exercises(id,slug,name,primary_muscle,equipment,movement_pattern,is_system)
     VALUES('system:planner-press','planner-press','Planner press','chest',ARRAY['barbell'],'horizontal_push',true)
     ON CONFLICT (id) DO NOTHING`,
  );
  for (let i = 1; i <= exercises; i++)
    await db.query(
      `INSERT INTO public.bulk_training_plan_exercises(plan_day_id,exercise_id,exercise_name,exercise_order,sets,rep_min,rep_max)
       VALUES($1,'system:planner-press','Planner press',$2,3,8,10)`,
      [day, i],
    );
  return day;
}

const create = (db, uid, fields) =>
  as(
    db,
    uid,
    `SELECT public.create_planned_activity($1,$2,$3::date,$4::time,$5,$6,$7,$8,$9,$10) AS id`,
    [
      fields.id ?? randomUUID(),
      fields.type,
      fields.date ?? "2026-11-07",
      fields.time ?? null,
      fields.source ?? null,
      fields.planDay ?? null,
      fields.template ?? null,
      fields.distance ?? null,
      fields.duration ?? null,
      fields.note ?? null,
    ],
  ).then((result) => result.rows[0].id);

const row = async (db, id) =>
  (
    await db.query(
      "SELECT *, updated_at::text AS stamp, planned_time::text AS time_text FROM public.planned_activities WHERE id=$1",
      [id],
    )
  ).rows[0];

// ---------------------------------------------------------------- ownership and RLS
test("owner creates, reads, edits, reschedules and deletes their own planned items", async () => {
  const db = await database();
  const { uid, profile } = await fitnessProfile(db);
  const day = await planDay(db, profile, "Upper A", 6);
  const workout = await create(db, uid, {
    type: "workout",
    source: "plan_day",
    planDay: day,
    time: "18:00",
  });
  const run = await create(db, uid, { type: "run", distance: 5, duration: 1800, note: " Easy " });
  const ride = await create(db, uid, { type: "ride", date: "2026-11-08", distance: 20 });

  const own = await as(db, uid, "SELECT id FROM public.planned_activities ORDER BY id");
  assert.equal(own.rows.length, 3);
  const w = await row(db, workout);
  assert.equal(w.workout_name_snapshot, "Upper A");
  assert.equal(w.exercise_count_snapshot, 6);
  assert.equal(w.time_text, "18:00:00");
  assert.equal((await row(db, run)).note, "Easy");
  // Raw ride distance; never a Challenge-equivalent 6.67 km.
  assert.equal(Number((await row(db, ride)).planned_distance_km), 20);
  assert.equal((await row(db, ride)).planned_time, null);

  const stamp = (await row(db, run)).stamp;
  await as(
    db,
    uid,
    "SELECT public.update_planned_activity($1,$2,'2026-11-09',NULL,NULL,NULL,NULL,6.5,NULL,NULL)",
    [run, stamp],
  );
  const edited = await row(db, run);
  assert.equal(edited.planned_date.toISOString().slice(0, 10), "2026-11-09");
  assert.equal(Number(edited.planned_distance_km), 6.5);
  assert.equal(edited.planned_duration_seconds, null);
  assert.equal(edited.note, null);
  // Stale edits are rejected rather than overwriting.
  await rejects(
    db,
    uid,
    "SELECT public.update_planned_activity($1,$2,'2026-11-10')",
    [run, stamp],
    /changed elsewhere/,
  );

  await as(db, uid, "SELECT public.reschedule_planned_activity($1,'2026-11-12','07:30')", [ride]);
  const moved = await row(db, ride);
  assert.equal(moved.planned_date.toISOString().slice(0, 10), "2026-11-12");
  assert.equal(moved.time_text, "07:30:00");
  assert.equal(Number(moved.planned_distance_km), 20);

  const deleted = await as(db, uid, "SELECT public.delete_planned_activity($1) AS ok", [ride]);
  assert.equal(deleted.rows[0].ok, true);
  assert.equal(await row(db, ride), undefined);
});

test("other users, Community friends and anon can neither read nor mutate planned items", async () => {
  const db = await database();
  const owner = await fitnessProfile(db);
  const other = await fitnessProfile(db);
  const id = await create(db, owner.uid, { type: "run", distance: 5 });
  const stamp = (await row(db, id)).stamp;

  assert.equal((await as(db, other.uid, "SELECT * FROM public.planned_activities")).rows.length, 0);
  await rejects(
    db,
    other.uid,
    "SELECT public.update_planned_activity($1,$2,'2026-11-09')",
    [id, stamp],
    /not found/,
  );
  await rejects(
    db,
    other.uid,
    "SELECT public.reschedule_planned_activity($1,'2026-11-09')",
    [id],
    /not found/,
  );
  assert.equal(
    (await as(db, other.uid, "SELECT public.delete_planned_activity($1) AS ok", [id])).rows[0].ok,
    false,
  );
  // A colliding request id never returns or rewrites another owner's row.
  await rejects(
    db,
    other.uid,
    "SELECT public.create_planned_activity($1,'run','2026-11-07')",
    [id],
    /not found/,
  );
  assert.ok(await row(db, id));

  // Direct table writes are not granted to signed-in users; anon has no access at all.
  for (const sql of [
    "INSERT INTO public.planned_activities(bulk_profile_id,activity_type,planned_date) VALUES($1,'run','2026-11-07')",
    "UPDATE public.planned_activities SET note='x' WHERE bulk_profile_id=$1",
    "DELETE FROM public.planned_activities WHERE bulk_profile_id=$1",
  ])
    await rejects(db, owner.uid, sql, [owner.profile], /permission denied/);
  await db.exec("SET ROLE anon");
  try {
    await assert.rejects(db.query("SELECT * FROM public.planned_activities"), /permission denied/);
    await assert.rejects(
      db.query("SELECT public.create_planned_activity(gen_random_uuid(),'run','2026-11-07')"),
      /permission denied/,
    );
  } finally {
    await asService(db);
  }
  // Exactly one policy: owner SELECT. Nothing exposes Planner to Community relationships.
  const policies = await db.query(
    "SELECT policyname, cmd FROM pg_policies WHERE tablename='planned_activities'",
  );
  assert.deepEqual(policies.rows, [{ policyname: "planned activities owner read", cmd: "SELECT" }]);
});

test("Challenge-only (core) accounts have no Planner and are never forced into fitness setup", async () => {
  const db = await database();
  const core = await coreUser(db);
  await rejects(
    db,
    core.uid,
    "SELECT public.create_planned_activity(gen_random_uuid(),'run','2026-11-07')",
    [],
    /Active fitness profile required/,
  );
  assert.equal(
    (
      await db.query("SELECT count(*)::int AS n FROM public.bulk_profiles WHERE owner_id=$1", [
        core.uid,
      ])
    ).rows[0].n,
    0,
  );
});

// ---------------------------------------------------------------- validation
test("invalid types, out-of-range numbers, missing dates and mixed shapes are rejected", async () => {
  const db = await database();
  const { uid, profile } = await fitnessProfile(db);
  const day = await planDay(db, profile);
  const cases = [
    [{ type: "swim" }, /Choose a workout, run or ride/],
    [{ type: "run", date: null }, /Choose a date/],
    [{ type: "run", date: "2031-01-01" }, /within the next two years/],
    [{ type: "run", distance: 0 }, /Distance/],
    [{ type: "run", distance: 1000.5 }, /Distance/],
    [{ type: "ride", duration: 30 }, /Duration/],
    [{ type: "ride", duration: 90000 }, /Duration/],
    [{ type: "run", note: "x".repeat(201) }, /200 characters/],
    [{ type: "run", source: "plan_day", planDay: day }, /do not take a workout/],
    [{ type: "workout" }, /Choose a workout/],
    [{ type: "workout", source: "plan_day", planDay: day, distance: 5 }, /distance or duration/],
    [
      { type: "workout", source: "plan_day", planDay: randomUUID() },
      /not found in your current plan/,
    ],
    [{ type: "workout", source: "my_workout", template: randomUUID() }, /not found in My Workouts/],
  ];
  for (const [fields, pattern] of cases) {
    await asUser(db, uid);
    try {
      await assert.rejects(
        db.query(`SELECT public.create_planned_activity($1,$2,$3::date,NULL,$4,$5,$6,$7,$8,$9)`, [
          randomUUID(),
          fields.type,
          "date" in fields ? fields.date : "2026-11-07",
          fields.source ?? null,
          fields.planDay ?? null,
          fields.template ?? null,
          fields.distance ?? null,
          fields.duration ?? null,
          fields.note ?? null,
        ]),
        pattern,
        JSON.stringify(fields),
      );
    } finally {
      await asService(db);
    }
  }
  // Another owner's plan day is not "your current plan".
  const other = await fitnessProfile(db);
  const foreign = await planDay(db, other.profile);
  await rejects(
    db,
    uid,
    "SELECT public.create_planned_activity(gen_random_uuid(),'workout','2026-11-07',NULL,'plan_day',$1)",
    [foreign],
    /not found in your current plan/,
  );
});

test("a retried create is idempotent and planning writes nothing outside the planner", async () => {
  const db = await database();
  const { uid, profile } = await fitnessProfile(db);
  const before = await db.query(
    `SELECT (SELECT count(*) FROM public.bulk_training_sessions WHERE bulk_profile_id=$1)::int AS sessions,
            (SELECT count(*) FROM public.challenge_activities WHERE user_id=$2)::int AS activities,
            (SELECT count(*) FROM public.streak_weeks)::int AS streak_weeks`,
    [profile, uid],
  );
  const id = randomUUID();
  assert.equal(await create(db, uid, { id, type: "run", distance: 5 }), id);
  assert.equal(await create(db, uid, { id, type: "run", distance: 5 }), id);
  assert.equal(
    (
      await db.query(
        "SELECT count(*)::int AS n FROM public.planned_activities WHERE bulk_profile_id=$1",
        [profile],
      )
    ).rows[0].n,
    1,
  );
  const after = await db.query(
    `SELECT (SELECT count(*) FROM public.bulk_training_sessions WHERE bulk_profile_id=$1)::int AS sessions,
            (SELECT count(*) FROM public.challenge_activities WHERE user_id=$2)::int AS activities,
            (SELECT count(*) FROM public.streak_weeks)::int AS streak_weeks`,
    [profile, uid],
  );
  assert.deepEqual(after.rows, before.rows);
});

// ---------------------------------------------------------------- snapshots
test("workout snapshots survive later edits or deletion of the source", async () => {
  const db = await database();
  const { uid, profile } = await fitnessProfile(db);
  const template = (await as(db, uid, "SELECT public.create_workout_template('Upper Body') AS id"))
    .rows[0].id;
  const planned = await create(db, uid, {
    type: "workout",
    source: "my_workout",
    template,
    date: "2026-11-08",
  });
  assert.equal((await row(db, planned)).workout_name_snapshot, "Upper Body");
  assert.equal((await row(db, planned)).exercise_count_snapshot, 0);

  await as(db, uid, "SELECT public.delete_workout_template($1)", [template]);
  const after = await row(db, planned);
  assert.equal(after.workout_template_id, null);
  assert.equal(after.workout_name_snapshot, "Upper Body");
  assert.equal(after.workout_source_type, "my_workout");
  // Editing date/time of an orphaned item keeps its snapshot.
  await as(
    db,
    uid,
    "SELECT public.update_planned_activity($1,$2,'2026-11-09','10:00','my_workout',NULL,NULL)",
    [planned, after.stamp],
  );
  assert.equal((await row(db, planned)).workout_name_snapshot, "Upper Body");

  const day = await planDay(db, profile, "Lower A", 5);
  const fromPlan = await create(db, uid, { type: "workout", source: "plan_day", planDay: day });
  await db.query("DELETE FROM public.bulk_training_plan_days WHERE id=$1", [day]);
  const orphan = await row(db, fromPlan);
  assert.equal(orphan.training_plan_day_id, null);
  assert.equal(orphan.workout_name_snapshot, "Lower A");
  assert.equal(orphan.exercise_count_snapshot, 5);
});

// ---------------------------------------------------------------- completion links
async function session(db, profile, planDayId, date, status = "in_progress") {
  await asService(db);
  return (
    await db.query(
      `INSERT INTO public.bulk_training_sessions(bulk_profile_id,source_plan_day_id,plan_name_snapshot,
         workout_day_name_snapshot,workout_day_order_snapshot,workout_date,status,completed_at)
       VALUES($1,$2,'My plan','Upper A',1,$3,$4,CASE WHEN $4='completed' THEN now() END) RETURNING id`,
      [profile, planDayId, date, status],
    )
  ).rows[0].id;
}

test("a session link is not completion; it follows the real session and never outlives it", async () => {
  const db = await database();
  const { uid, profile } = await fitnessProfile(db);
  const day = await planDay(db, profile, "Upper B");
  const otherDay = await planDay(db, profile, "Lower B");
  const planned = await create(db, uid, {
    type: "workout",
    source: "plan_day",
    planDay: day,
    date: "2026-11-02",
  });
  const link = (s) =>
    as(db, uid, "SELECT public.link_planned_activity_session($1,$2) AS ok", [planned, s]).then(
      (r) => r.rows[0].ok,
    );

  // A resumed session for another plan day or another date is never linked.
  assert.equal(await link(await session(db, profile, otherDay, "2026-11-02")), false);
  await db.query("DELETE FROM public.bulk_training_sessions WHERE bulk_profile_id=$1", [profile]);
  assert.equal(await link(await session(db, profile, day, "2026-11-03")), false);
  await db.query("DELETE FROM public.bulk_training_sessions WHERE bulk_profile_id=$1", [profile]);

  const live = await session(db, profile, day, "2026-11-02");
  assert.equal(await link(live), true);
  assert.equal(await link(live), false); // already linked
  const status = async () =>
    (
      await as(
        db,
        uid,
        `SELECT s.status FROM public.planned_activities a
         LEFT JOIN public.bulk_training_sessions s ON s.id=a.workout_session_id WHERE a.id=$1`,
        [planned],
      )
    ).rows[0].status;
  assert.equal(await status(), "in_progress"); // linked, not completed

  // A discarded/deleted session leaves the planned row planned, with no fake completion.
  await db.query("DELETE FROM public.bulk_training_sessions WHERE id=$1", [live]);
  assert.equal((await row(db, planned)).workout_session_id, null);
  assert.equal(await status(), null);

  const done = await session(db, profile, day, "2026-11-02", "completed");
  assert.equal(await link(done), true);
  assert.equal(await status(), "completed");

  // Deleting the planner row never touches the completed workout.
  await as(db, uid, "SELECT public.delete_planned_activity($1)", [planned]);
  assert.equal(
    (await db.query("SELECT status FROM public.bulk_training_sessions WHERE id=$1", [done])).rows[0]
      .status,
    "completed",
  );

  // Another user's session cannot be linked.
  const other = await fitnessProfile(db);
  const otherPlanned = await create(db, other.uid, {
    type: "workout",
    source: "plan_day",
    planDay: await planDay(db, other.profile),
    date: "2026-11-02",
  });
  assert.equal(
    (
      await as(db, other.uid, "SELECT public.link_planned_activity_session($1,$2) AS ok", [
        otherPlanned,
        await session(db, profile, day, "2026-11-02"),
      ])
    ).rows[0].ok,
    false,
  );
});

test("Run/Ride link only to the owner's own saved Challenge activity of the same kind", async () => {
  const db = await database();
  const { uid } = await fitnessProfile(db);
  // Each user logs into their own challenge, seeded with a caller identity outside RLS.
  const challenges = new Map();
  const activity = async (user, kind, km) => {
    await asService(db);
    await db.query("SELECT set_config('request.jwt.claim.sub',$1,false)", [user]);
    if (!challenges.has(user)) {
      challenges.set(user, randomUUID());
      await db.query(
        "INSERT INTO public.challenges(id,created_by,name,start_date,timezone) VALUES($1,$2,'Planner link',CURRENT_DATE,'UTC')",
        [challenges.get(user), user],
      );
      await db.query(
        "INSERT INTO public.challenge_members(challenge_id,user_id) VALUES($1,$2) ON CONFLICT DO NOTHING",
        [challenges.get(user), user],
      );
    }
    const challenge = challenges.get(user);
    return (
      await db.query(
        `INSERT INTO public.challenge_activities(challenge_id,user_id,activity_type,distance_km,duration_seconds,activity_date,evidence_path)
         VALUES($1,$2,$3,$4,3600,CURRENT_DATE,'evidence') RETURNING id`,
        [challenge, user, kind, km],
      )
    ).rows[0].id;
  };
  await asService(db);
  const ride = await create(db, uid, { type: "ride", distance: 20 });
  const link = (planned, a, user = uid) =>
    as(db, user, "SELECT public.link_planned_activity_challenge_activity($1,$2) AS ok", [
      planned,
      a,
    ]).then((r) => r.rows[0].ok);

  assert.equal(await link(ride, await activity(uid, "run", 20)), false); // kind mismatch
  const stranger = await fitnessProfile(db);
  assert.equal(await link(ride, await activity(stranger.uid, "cycle", 20)), false); // not theirs
  const saved = await activity(uid, "cycle", 20);
  assert.equal(await link(ride, saved), true);
  const linked = await row(db, ride);
  assert.equal(linked.challenge_activity_id, saved);
  assert.equal(Number(linked.planned_distance_km), 20); // planner keeps raw km
  assert.equal(
    Number(
      (await db.query("SELECT equivalent_km FROM public.challenge_activities WHERE id=$1", [saved]))
        .rows[0].equivalent_km,
    ).toFixed(2),
    "6.67",
  ); // Challenge conversion stays the Challenge's own

  // Deleting the Challenge activity unlinks; deleting the planner row never deletes the activity.
  await db.query("SELECT set_config('request.jwt.claim.sub',$1,false)", [uid]); // audited delete
  await db.query("DELETE FROM public.challenge_activities WHERE id=$1", [saved]);
  await asService(db);
  assert.equal((await row(db, ride)).challenge_activity_id, null);
  const again = await activity(uid, "cycle", 20);
  assert.equal(await link(ride, again), true);
  await as(db, uid, "SELECT public.delete_planned_activity($1)", [ride]);
  assert.equal(
    (
      await db.query("SELECT count(*)::int AS n FROM public.challenge_activities WHERE id=$1", [
        again,
      ])
    ).rows[0].n,
    1,
  );
});

test("Today's upcoming read skips completed linked rows before its limit and stays bounded", async () => {
  const db = await database();
  const { uid, profile } = await fitnessProfile(db);
  const day = await planDay(db, profile, "Upper A");
  const from = "2026-11-02";

  // Seven COMPLETED linked items come first: four workouts with completed sessions, three runs
  // linked to saved Challenge activities.
  for (const date of ["2026-11-02", "2026-11-02", "2026-11-03", "2026-11-03"]) {
    const planned = await create(db, uid, {
      type: "workout",
      source: "plan_day",
      planDay: day,
      date,
    });
    const done = await session(db, profile, day, date, "completed");
    await as(db, uid, "SELECT public.link_planned_activity_session($1,$2)", [planned, done]);
  }
  const challenge = randomUUID();
  await asService(db);
  await db.query("SELECT set_config('request.jwt.claim.sub',$1,false)", [uid]);
  await db.query(
    "INSERT INTO public.challenges(id,created_by,name,start_date,timezone) VALUES($1,$2,'Upcoming',CURRENT_DATE,'UTC')",
    [challenge, uid],
  );
  await db.query(
    "INSERT INTO public.challenge_members(challenge_id,user_id) VALUES($1,$2) ON CONFLICT DO NOTHING",
    [challenge, uid],
  );
  for (const date of ["2026-11-02", "2026-11-03", "2026-11-04"]) {
    await asService(db);
    await db.query("SELECT set_config('request.jwt.claim.sub',$1,false)", [uid]);
    const activity = (
      await db.query(
        `INSERT INTO public.challenge_activities(challenge_id,user_id,activity_type,distance_km,duration_seconds,activity_date,evidence_path)
         VALUES($1,$2,'run',5,1800,CURRENT_DATE,'evidence') RETURNING id`,
        [challenge, uid],
      )
    ).rows[0].id;
    await asService(db);
    const planned = await create(db, uid, { type: "run", date, distance: 5 });
    await as(db, uid, "SELECT public.link_planned_activity_challenge_activity($1,$2)", [
      planned,
      activity,
    ]);
  }
  // Then the genuinely unresolved items, plus noise that must never appear.
  const inProgressDay = await planDay(db, profile, "Lower A");
  const inProgress = await create(db, uid, {
    type: "workout",
    source: "plan_day",
    planDay: inProgressDay,
    date: "2026-11-05",
  });
  await as(db, uid, "SELECT public.link_planned_activity_session($1,$2)", [
    inProgress,
    await session(db, profile, inProgressDay, "2026-11-05", "in_progress"),
  ]);
  const ride = await create(db, uid, { type: "ride", date: "2026-11-06", distance: 20 });
  const run = await create(db, uid, { type: "run", date: "2026-11-07", time: "07:00" });
  const later = await create(db, uid, { type: "run", date: "2026-11-08" });
  await create(db, uid, { type: "run", date: "2026-11-01" }); // before today
  const other = await fitnessProfile(db);
  await create(db, other.uid, { type: "run", date: "2026-11-02" }); // another owner

  const upcoming = (user, limit = 3, profileId = profile) =>
    as(db, user, "SELECT id FROM public.planner_upcoming($1,$2,$3)", [profileId, from, limit]).then(
      (r) => r.rows.map((row) => row.id),
    );
  assert.equal(
    (
      await db.query(
        "SELECT count(*)::int AS n FROM public.planned_activities WHERE bulk_profile_id=$1 AND planned_date >= $2",
        [profile, from],
      )
    ).rows[0].n,
    11,
    "seven completed rows sit ahead of the unresolved ones",
  );
  // An in-progress workout is still unresolved (Resume), so it is the first upcoming item.
  assert.deepEqual(await upcoming(uid), [inProgress, ride, run]);
  assert.deepEqual(await upcoming(uid, 4), [inProgress, ride, run, later]);
  // Hard server cap: a large request can never become a history read.
  assert.equal((await upcoming(uid, 1000)).length, 4);
  // RLS still applies inside the function: another user cannot read this profile's plan.
  assert.deepEqual(await upcoming(other.uid, 10), []);
  await db.exec("SET ROLE anon");
  try {
    await assert.rejects(
      db.query("SELECT * FROM public.planner_upcoming($1,$2,3)", [profile, from]),
      /permission denied/,
    );
  } finally {
    await asService(db);
  }
});
