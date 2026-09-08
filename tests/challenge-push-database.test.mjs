import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { createHash, randomUUID } from "node:crypto";
import { PGlite } from "@electric-sql/pglite";

const db = new PGlite();
const a = randomUUID(),
  b = randomUUID(),
  c = randomUUID(),
  d = randomUUID();
const x = randomUUID(),
  y = randomUUID();
const root = new URL("../supabase/migrations/", import.meta.url);
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

before(async () => {
  // Only Supabase's platform schemas are stubbed; every application migration,
  // trigger, calculation, table grant and RLS policy below is the real SQL.
  await db.exec(platformSchema);
  for (const file of (await readdir(root)).filter((f) => f.endsWith(".sql")).sort()) {
    try {
      await db.exec(await readFile(new URL(file, root), "utf8"));
    } catch (error) {
      throw new Error(`Migration failed: ${file}`, { cause: error });
    }
  }
  for (const id of [a, b, c, d]) {
    await db.query("INSERT INTO auth.users VALUES ($1)", [id]);
    await db.query("INSERT INTO public.profiles(id, display_name) VALUES ($1, 'Test athlete')", [
      id,
    ]);
  }
  for (const [id, creator, other] of [
    [x, a, b],
    [y, c, d],
  ]) {
    await db.query(
      "INSERT INTO public.challenges(id,created_by,name,start_date,timezone,legacy_photo_owed) VALUES ($1,$2,'Private',CURRENT_DATE,'UTC',true)",
      [id, creator],
    );
    await db.query(
      "INSERT INTO public.challenge_members(challenge_id,user_id) VALUES ($1,$2),($1,$3)",
      [id, creator, other],
    );
  }
});
after(async () => {
  await db.close();
});
async function asUser(uid, action) {
  await db.query("SELECT set_config('request.jwt.claim.sub', $1, false)", [uid]);
  await db.exec("SET ROLE authenticated");
  try {
    return await action();
  } finally {
    await db.exec("RESET ROLE");
  }
}
async function asService(action) {
  await db.exec("SET ROLE service_role");
  try {
    return await action();
  } finally {
    await db.exec("RESET ROLE");
  }
}
async function asAnon(action) {
  await db.query("SELECT set_config('request.jwt.claim.sub', '', false)");
  await db.exec("SET ROLE anon");
  try {
    return await action();
  } finally {
    await db.exec("RESET ROLE");
  }
}
async function count(kind) {
  return Number(
    (
      await db.query(
        "SELECT count(*) AS n FROM public.challenge_notification_events WHERE kind = $1 AND challenge_id = $2",
        [kind, x],
      )
    ).rows[0].n,
  );
}

async function completeBulkOnboarding(uid, overrides = {}) {
  const values = {
    goal: "gain",
    currentWeight: 70,
    targetWeight: 78,
    weeklyGain: 0.25,
    experience: "intermediate",
    trainingDays: 4,
    equipment: ["dumbbells", "cables", "bench"],
    preference: "generated",
    calories: 2900,
    protein: 140,
    carbs: 360,
    fat: 90,
    ...overrides,
  };
  return asUser(uid, () =>
    db.query(
      `SELECT public.complete_goal_onboarding(
        $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12
      ) AS id`,
      [
        values.goal,
        values.currentWeight,
        values.targetWeight,
        values.weeklyGain,
        values.experience,
        values.trainingDays,
        values.equipment,
        values.preference,
        values.calories,
        values.protein,
        values.carbs,
        values.fat,
      ],
    ),
  );
}

async function createChallengeAtomic(
  uid,
  requestId,
  tokenHash,
  {
    name = "Atomic challenge",
    email = "opponent@example.com",
    target = 15,
    mode = "money",
    high = 15,
    medium = 10,
    low = 5,
    customHigh = null,
    customMedium = null,
    customLow = null,
    travelEnabled = true,
    homeCountries = ["GR", "SE"],
  } = {},
) {
  return asService(() =>
    db.query(
      `SELECT public.create_challenge_atomic(
        $1, $2, $3, (date_trunc('week', CURRENT_DATE) + interval '7 days')::date,
        'UTC', 52, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15
      ) AS id`,
      [
        uid,
        requestId,
        name,
        email,
        tokenHash,
        target,
        mode,
        high,
        medium,
        low,
        customHigh,
        customMedium,
        customLow,
        travelEnabled,
        homeCountries,
      ],
    ),
  );
}
async function activity(uid, km, challenge = x, type = "run") {
  const durationSeconds = Math.round(type === "run" ? km * 360 : (km / 20) * 3600);
  return asUser(uid, () =>
    db.query(
      "INSERT INTO public.challenge_activities(challenge_id,user_id,activity_type,distance_km,duration_seconds,activity_date,evidence_path) VALUES ($1,$2,$3,$4,$5,CURRENT_DATE,'private-test-evidence') RETURNING id",
      [challenge, uid, type, km, durationSeconds],
    ),
  );
}

async function freshChallenge(name) {
  const id = randomUUID();
  await db.query(
    "INSERT INTO public.challenges(id,created_by,name,start_date,timezone) VALUES ($1,$2,$3,CURRENT_DATE,'UTC')",
    [id, a, name],
  );
  await db.query(
    "INSERT INTO public.challenge_members(challenge_id,user_id) VALUES ($1,$2),($1,$3)",
    [id, a, b],
  );
  return id;
}

test("RLS permits A and B's own activities, rejects a third party, and isolates X/Y", async () => {
  await activity(a, 7);
  await activity(b, 3);
  assert.equal(await count("activity_posted"), 2);
  await assert.rejects(activity(c, 1), /row-level security|Not a member/);
  await assert.rejects(
    asUser(c, () => db.exec(`SELECT public.claim_challenge_push_events()`)),
    /permission denied/,
  );
  await assert.rejects(
    asUser(c, () => db.exec(`SELECT * FROM public.challenge_notification_events`)),
    /permission denied/,
  );
  await activity(c, 2, y);
  assert.equal(await count("activity_posted"), 2);
  assert.equal(
    (
      await db.query(
        "SELECT count(*) AS n FROM public.challenge_notification_events WHERE challenge_id = $1",
        [y],
      )
    ).rows[0].n,
    1,
  );
});
test("Bulk data stays owner-only while users can atomically activate one personal plan", async () => {
  const bulk = randomUUID();
  await db.query("INSERT INTO public.bulk_profiles(id,owner_id) VALUES ($1,$2)", [bulk, a]);
  await db.query(
    "INSERT INTO public.bulk_members(bulk_profile_id,user_id,role,invited_by) VALUES ($1,$2,'owner',$2),($1,$3,'editor',$2),($1,$4,'viewer',$2)",
    [bulk, a, b, c],
  );
  await db.query(
    "INSERT INTO public.bulk_targets(bulk_profile_id,payload) VALUES ($1,'{\"calories\":2900}')",
    [bulk],
  );
  const objectId = randomUUID();
  await db.query(
    "INSERT INTO storage.objects(id,bucket_id,name) VALUES ($1,'bulk-progress-photos',$2)",
    [objectId, `${bulk}/private.jpg`],
  );

  const owner = await asUser(a, () =>
    db.query("SELECT payload FROM public.bulk_targets WHERE bulk_profile_id=$1", [bulk]),
  );
  assert.equal(owner.rows.length, 1);
  assert.equal(
    (await asUser(a, () => db.query("SELECT id FROM storage.objects WHERE id=$1", [objectId]))).rows
      .length,
    1,
  );
  const ownerWrite = await asUser(a, () =>
    db.query(
      "UPDATE public.bulk_targets SET payload='{\"calories\":3000}' WHERE bulk_profile_id=$1 RETURNING payload",
      [bulk],
    ),
  );
  assert.equal(ownerWrite.rows[0].payload.calories, 3000);
  await assert.rejects(
    completeBulkOnboarding(a),
    /Legacy My Bulk profiles cannot be converted through public onboarding/,
  );
  const preservedLegacyPayload = (
    await db.query("SELECT payload FROM public.bulk_targets WHERE bulk_profile_id=$1", [bulk])
  ).rows[0].payload;
  assert.equal(preservedLegacyPayload.calories, 3000);
  assert.equal(preservedLegacyPayload.goal, undefined);

  for (const user of [b, c, d]) {
    assert.equal(
      (
        await asUser(user, () =>
          db.query("SELECT payload FROM public.bulk_targets WHERE bulk_profile_id=$1", [bulk]),
        )
      ).rows.length,
      0,
    );
    assert.equal(
      (await asUser(user, () => db.query("SELECT id FROM storage.objects WHERE id=$1", [objectId])))
        .rows.length,
      0,
    );
    assert.equal(
      (
        await asUser(user, () =>
          db.query(
            "UPDATE public.bulk_targets SET payload='{\"calories\":1}' WHERE bulk_profile_id=$1 RETURNING payload",
            [bulk],
          ),
        )
      ).rows.length,
      0,
    );
  }
  const formerViewerProfiles = await db.query("SELECT id FROM public.related_profiles($1)", [c]);
  assert.equal(
    formerViewerProfiles.rows.some((profile) => profile.id === a),
    false,
  );
  await assert.rejects(
    asUser(c, () => db.query("INSERT INTO public.bulk_profiles(owner_id) VALUES ($1)", [c])),
    /row-level security|permission denied/,
  );
  await assert.rejects(
    asUser(a, () =>
      db.query(
        "INSERT INTO public.bulk_members(bulk_profile_id,user_id,role,invited_by) VALUES ($1,$2,'viewer',$3)",
        [bulk, c, a],
      ),
    ),
    /row-level security|permission denied/,
  );

  await db.query("SELECT set_config('request.jwt.claim.sub', '', false)");
  await db.exec("SET ROLE authenticated");
  try {
    await assert.rejects(
      db.query(
        "SELECT public.complete_goal_onboarding('gain',70,78,0.25,'beginner',3,ARRAY['dumbbells'],'generated',2900,140,360,90)",
      ),
      /Not authenticated/,
    );
  } finally {
    await db.exec("RESET ROLE");
  }

  await assert.rejects(
    asUser(d, () => db.query("SELECT public.activate_my_bulk()")),
    /permission denied/,
  );
  await db.exec(`
    CREATE FUNCTION public.reject_test_bulk_target() RETURNS trigger
    LANGUAGE plpgsql AS $$
    BEGIN
      IF EXISTS (
        SELECT 1 FROM public.bulk_profiles
        WHERE id = NEW.bulk_profile_id AND owner_id = '${c}'::uuid
      ) THEN RAISE EXCEPTION 'Forced target failure'; END IF;
      RETURN NEW;
    END $$;
    CREATE TRIGGER reject_test_bulk_target
    BEFORE INSERT ON public.bulk_targets
    FOR EACH ROW EXECUTE FUNCTION public.reject_test_bulk_target();
  `);
  await assert.rejects(completeBulkOnboarding(c), /Forced target failure/);
  assert.equal(
    (await db.query("SELECT count(*) AS n FROM public.bulk_profiles WHERE owner_id=$1", [c]))
      .rows[0].n,
    0,
  );
  assert.equal(
    (
      await db.query(
        "SELECT count(*) AS n FROM public.bulk_members WHERE user_id=$1 AND role='owner'",
        [c],
      )
    ).rows[0].n,
    0,
  );
  await db.exec(`
    DROP TRIGGER reject_test_bulk_target ON public.bulk_targets;
    DROP FUNCTION public.reject_test_bulk_target();
  `);
  for (const invalid of [
    { currentWeight: 0 },
    { targetWeight: 70 },
    { weeklyGain: 2 },
    { experience: "expert" },
    { trainingDays: 7 },
    { equipment: ["private_home_address"] },
    { preference: "admin_plan" },
    { calories: 0 },
    { protein: 0 },
  ]) {
    await assert.rejects(completeBulkOnboarding(c, invalid), /Invalid/);
  }
  assert.equal(
    (await db.query("SELECT count(*) AS n FROM public.bulk_profiles WHERE owner_id=$1", [c]))
      .rows[0].n,
    0,
  );
  const firstActivation = await completeBulkOnboarding(d);
  const secondActivation = await completeBulkOnboarding(d, {
    targetWeight: 99,
    experience: "advanced",
  });
  const personalBulk = firstActivation.rows[0].id;
  assert.equal(secondActivation.rows[0].id, personalBulk);
  assert.equal(
    (await db.query("SELECT count(*) AS n FROM public.bulk_profiles WHERE owner_id=$1", [d]))
      .rows[0].n,
    1,
  );
  const personalTargets = await asUser(d, () =>
    db.query("SELECT payload FROM public.bulk_targets WHERE bulk_profile_id=$1", [personalBulk]),
  );
  assert.deepEqual(
    {
      startWeight: personalTargets.rows[0].payload.startWeight,
      targetWeight: personalTargets.rows[0].payload.targetWeight,
      targetWeeklyGainKg: personalTargets.rows[0].payload.targetWeeklyGainKg,
      experienceLevel: personalTargets.rows[0].payload.experienceLevel,
      trainingDaysPerWeek: personalTargets.rows[0].payload.trainingDaysPerWeek,
      availableEquipment: personalTargets.rows[0].payload.availableEquipment,
      trainingSetupPreference: personalTargets.rows[0].payload.trainingSetupPreference,
      calories: personalTargets.rows[0].payload.calories,
      protein: personalTargets.rows[0].payload.protein,
      carbs: personalTargets.rows[0].payload.carbs,
      fat: personalTargets.rows[0].payload.fat,
    },
    {
      startWeight: 70,
      targetWeight: 78,
      targetWeeklyGainKg: 0.25,
      experienceLevel: "intermediate",
      trainingDaysPerWeek: 4,
      availableEquipment: ["bench", "cables", "dumbbells"],
      trainingSetupPreference: "generated",
      calories: 2900,
      protein: 140,
      carbs: 360,
      fat: 90,
    },
  );
  await assert.rejects(
    asUser(d, () =>
      db.query(
        `UPDATE public.bulk_targets
         SET payload = payload || '{"targetWeight":60}'::jsonb
         WHERE bulk_profile_id=$1`,
        [personalBulk],
      ),
    ),
    /bulk_targets_onboarding_payload_ck/,
  );
  assert.equal(
    (
      await asUser(d, () =>
        db.query(
          "UPDATE public.bulk_targets SET payload=$2::jsonb WHERE bulk_profile_id=$1 RETURNING payload",
          [personalBulk, JSON.stringify({ calories: 2800 })],
        ),
      )
    ).rows[0].payload.calories,
    2800,
  );
  assert.equal(
    (
      await asUser(d, () =>
        db.query("SELECT payload FROM public.bulk_targets WHERE bulk_profile_id=$1", [bulk]),
      )
    ).rows.length,
    0,
  );

  for (const setup of [
    {
      id: randomUUID(),
      experience: "beginner",
      trainingDays: 2,
      equipment: ["full_gym"],
      preference: "tempo_preset",
    },
    {
      id: randomUUID(),
      experience: "advanced",
      trainingDays: 6,
      equipment: ["bodyweight_only"],
      preference: "custom",
    },
  ]) {
    await db.query("INSERT INTO auth.users(id) VALUES ($1)", [setup.id]);
    await db.query("INSERT INTO public.profiles(id,display_name) VALUES ($1,'New athlete')", [
      setup.id,
    ]);
    const created = await completeBulkOnboarding(setup.id, setup);
    const saved = (
      await asUser(setup.id, () =>
        db.query("SELECT payload FROM public.bulk_targets WHERE bulk_profile_id=$1", [
          created.rows[0].id,
        ]),
      )
    ).rows[0].payload;
    assert.equal(saved.experienceLevel, setup.experience);
    assert.equal(saved.trainingDaysPerWeek, setup.trainingDays);
    assert.deepEqual(saved.availableEquipment.sort(), setup.equipment.sort());
    assert.equal(saved.trainingSetupPreference, setup.preference);
  }

  await db.query("INSERT INTO public.bulk_admins(user_id) VALUES ($1)", [a]);
  assert.equal(
    (await asUser(a, () => db.query("SELECT public.is_bulk_admin() AS ok"))).rows[0].ok,
    true,
  );
  assert.equal(
    (await asUser(d, () => db.query("SELECT public.is_bulk_admin() AS ok"))).rows[0].ok,
    false,
  );
  await assert.rejects(
    asUser(d, () => db.query("SELECT * FROM public.bulk_admins")),
    /permission denied/,
  );
});

test("public Goal onboarding persists gain, cut and maintain without weakening owner isolation", async () => {
  const cases = [
    { goal: "gain", currentWeight: 70, targetWeight: 78, weeklyGain: 0.25 },
    { goal: "cut", currentWeight: 80, targetWeight: 72, weeklyGain: 0.5 },
    { goal: "maintain", currentWeight: 75, targetWeight: 75, weeklyGain: 0 },
  ];
  for (const values of cases) {
    const owner = randomUUID();
    await db.query("INSERT INTO auth.users VALUES ($1)", [owner]);
    await db.query("INSERT INTO public.profiles(id,display_name) VALUES ($1,'Goal owner')", [
      owner,
    ]);
    const result = await completeBulkOnboarding(owner, values);
    const payload = (
      await asUser(owner, () =>
        db.query("SELECT payload FROM public.bulk_targets WHERE bulk_profile_id=$1", [
          result.rows[0].id,
        ]),
      )
    ).rows[0].payload;
    assert.equal(payload.goal, values.goal);
    assert.equal(Number(payload.startWeight), values.currentWeight);
    assert.equal(Number(payload.targetWeight), values.targetWeight);
    assert.equal(Number(payload.targetWeeklyGainKg), values.weeklyGain);
    assert.equal(
      (
        await asUser(c, () =>
          db.query("SELECT payload FROM public.bulk_targets WHERE bulk_profile_id=$1", [
            result.rows[0].id,
          ]),
        )
      ).rows.length,
      0,
    );
  }

  const invalidOwner = randomUUID();
  await db.query("INSERT INTO auth.users VALUES ($1)", [invalidOwner]);
  await db.query("INSERT INTO public.profiles(id,display_name) VALUES ($1,'Invalid goal')", [
    invalidOwner,
  ]);
  for (const invalid of [
    { goal: "gain", currentWeight: 80, targetWeight: 72, weeklyGain: 0.25 },
    { goal: "cut", currentWeight: 70, targetWeight: 78, weeklyGain: 0.5 },
    { goal: "maintain", currentWeight: 70, targetWeight: 78, weeklyGain: 0 },
    { goal: "maintain", currentWeight: 70, targetWeight: 70, weeklyGain: 0.25 },
  ]) {
    await assert.rejects(completeBulkOnboarding(invalidOwner, invalid), /Invalid/i);
  }
  assert.equal(
    (
      await db.query("SELECT count(*) AS n FROM public.bulk_profiles WHERE owner_id=$1", [
        invalidOwner,
      ])
    ).rows[0].n,
    0,
  );
});

test("Bulk exercise library is seeded once and custom exercises remain owner-only", async () => {
  const ownerLibrary = await asUser(a, () =>
    db.query(
      "SELECT id,name,primary_muscle,equipment,supports_unilateral FROM public.bulk_exercises WHERE is_system ORDER BY name",
    ),
  );
  assert.ok(ownerLibrary.rows.length >= 300);
  assert.equal(new Set(ownerLibrary.rows.map((row) => row.id)).size, ownerLibrary.rows.length);
  assert.equal(new Set(ownerLibrary.rows.map((row) => row.name)).size, ownerLibrary.rows.length);
  assert.ok(ownerLibrary.rows.some((row) => row.name === "Incline Dumbbell Bench Press"));
  assert.ok(ownerLibrary.rows.some((row) => row.primary_muscle === "abs"));
  assert.equal(
    (await asUser(c, () => db.query("SELECT id FROM public.bulk_exercises"))).rows.length,
    0,
  );

  const created = await asUser(a, () =>
    db.query(
      `INSERT INTO public.bulk_exercises(
        slug,name,primary_muscle,secondary_muscles,equipment,movement_pattern,supports_unilateral
      ) VALUES ('my-cable-curl','My Cable Curl','biceps',ARRAY['forearms'],ARRAY['cable'],'other',true)
      RETURNING id,owner_id,supports_unilateral`,
    ),
  );
  const customId = created.rows[0].id;
  assert.match(customId, /^custom:/);
  assert.equal(created.rows[0].owner_id, a);
  assert.equal(created.rows[0].supports_unilateral, true);
  assert.equal(
    (
      await asUser(a, () =>
        db.query(
          "UPDATE public.bulk_exercises SET name='My Updated Cable Curl' WHERE id=$1 RETURNING name",
          [customId],
        ),
      )
    ).rows[0].name,
    "My Updated Cable Curl",
  );
  assert.equal(
    (
      await asUser(d, () =>
        db.query("SELECT id FROM public.bulk_exercises WHERE id=$1", [customId]),
      )
    ).rows.length,
    0,
  );
  assert.equal(
    (
      await asUser(d, () =>
        db.query("UPDATE public.bulk_exercises SET name='Stolen' WHERE id=$1 RETURNING id", [
          customId,
        ]),
      )
    ).rows.length,
    0,
  );
  assert.equal(
    (
      await asUser(d, () =>
        db.query("DELETE FROM public.bulk_exercises WHERE id=$1 RETURNING id", [customId]),
      )
    ).rows.length,
    0,
  );
  assert.equal(
    (
      await asUser(a, () =>
        db.query(
          "UPDATE public.bulk_exercises SET name='Changed system row' WHERE id='system:pull-up' RETURNING id",
        ),
      )
    ).rows.length,
    0,
  );
  await assert.rejects(
    asUser(a, () =>
      db.query(
        `INSERT INTO public.bulk_exercises(
          id,owner_id,slug,name,primary_muscle,equipment,movement_pattern,is_system
        ) VALUES ('custom:forged',$1,'forged','Forged','chest',ARRAY['barbell'],'other',false)`,
        [d],
      ),
    ),
    /row-level security/,
  );
  assert.equal(
    (
      await asUser(a, () =>
        db.query("DELETE FROM public.bulk_exercises WHERE id=$1 RETURNING id", [customId]),
      )
    ).rows.length,
    1,
  );
});

test("Tempo templates are immutable and selection creates one isolated owner plan", async () => {
  const templates = await asUser(a, () =>
    db.query(
      "SELECT id,experience_level,training_days_per_week FROM public.bulk_training_plan_templates ORDER BY id",
    ),
  );
  assert.equal(templates.rows.length, 9);
  for (const [level, frequencies] of [
    ["beginner", [2, 3, 4]],
    ["intermediate", [3, 4, 5]],
    ["advanced", [4, 5, 6]],
  ]) {
    assert.deepEqual(
      templates.rows
        .filter((row) => row.experience_level === level)
        .map((row) => row.training_days_per_week)
        .sort(),
      frequencies,
    );
  }
  const invalidReferences = await db.query(`
    SELECT count(*) AS n
    FROM public.bulk_training_plan_template_exercises pe
    JOIN public.bulk_exercises e ON e.id = pe.exercise_id
    WHERE NOT e.is_system OR e.owner_id IS NOT NULL
  `);
  assert.equal(Number(invalidReferences.rows[0].n), 0);
  const invalidPrescriptions = await db.query(`
    SELECT count(*) AS n FROM public.bulk_training_plan_template_exercises
    WHERE sets <= 0 OR rep_min <= 0 OR rep_min > rep_max
  `);
  assert.equal(Number(invalidPrescriptions.rows[0].n), 0);
  const wrongDayCounts = await db.query(`
    SELECT count(*) AS n FROM public.bulk_training_plan_templates t
    WHERE (SELECT count(*) FROM public.bulk_training_plan_template_days d WHERE d.template_id=t.id) <> t.training_days_per_week
  `);
  assert.equal(Number(wrongDayCounts.rows[0].n), 0);
  await assert.rejects(
    asUser(a, () =>
      db.query("UPDATE public.bulk_training_plan_templates SET name='Forged' RETURNING id"),
    ),
    /permission denied|row-level security/,
  );

  const selected = await asUser(d, () =>
    db.query(
      "SELECT public.instantiate_bulk_training_plan('template:intermediate-upper-lower-4','generated') AS id",
    ),
  );
  const planId = selected.rows[0].id;
  const repeated = await asUser(d, () =>
    db.query(
      "SELECT public.instantiate_bulk_training_plan('template:intermediate-upper-lower-4','generated') AS id",
    ),
  );
  assert.equal(repeated.rows[0].id, planId);
  assert.equal(
    Number(
      (
        await db.query(
          "SELECT count(*) AS n FROM public.bulk_training_plans WHERE bulk_profile_id=(SELECT id FROM public.bulk_profiles WHERE owner_id=$1) AND active",
          [d],
        )
      ).rows[0].n,
    ),
    1,
  );
  await assert.rejects(
    asUser(d, () =>
      db.query(
        "SELECT public.instantiate_bulk_training_plan('template:advanced-ppl-6','generated')",
      ),
    ),
    /active training plan already exists/i,
  );
  const copied = await asUser(d, () =>
    db.query(
      `
    SELECT d.day_order,e.exercise_order,e.exercise_name,e.sets,e.rep_min,e.rep_max,e.source_system_exercise_id
    FROM public.bulk_training_plan_days d JOIN public.bulk_training_plan_exercises e ON e.plan_day_id=d.id
    WHERE d.plan_id=$1 ORDER BY d.day_order,e.exercise_order
  `,
      [planId],
    ),
  );
  assert.ok(copied.rows.length > 0);
  assert.equal(
    copied.rows.every((row) => row.source_system_exercise_id?.startsWith("system:")),
    true,
  );
  const firstCopiedSetCount = copied.rows[0].sets;
  await asService(() =>
    db.query(`
      UPDATE public.bulk_training_plan_template_exercises
      SET sets = CASE WHEN sets = 10 THEN 9 ELSE sets + 1 END
      WHERE template_day_id='template:intermediate-upper-lower-4:day:1' AND exercise_order=1
    `),
  );
  assert.equal(
    (
      await db.query(
        "SELECT sets FROM public.bulk_training_plan_exercises WHERE plan_day_id IN (SELECT id FROM public.bulk_training_plan_days WHERE plan_id=$1) ORDER BY exercise_order LIMIT 1",
        [planId],
      )
    ).rows[0].sets,
    firstCopiedSetCount,
  );
  assert.equal(
    (
      await asUser(a, () =>
        db.query("SELECT id FROM public.bulk_training_plans WHERE id=$1", [planId]),
      )
    ).rows.length,
    0,
  );

  const customUser = randomUUID();
  await db.query("INSERT INTO auth.users(id) VALUES ($1)", [customUser]);
  await db.query("INSERT INTO public.profiles(id,display_name) VALUES ($1,'Custom athlete')", [
    customUser,
  ]);
  await completeBulkOnboarding(customUser, { preference: "custom" });
  const custom = await asUser(customUser, () =>
    db.query("SELECT public.create_empty_bulk_training_plan('My Plan') AS id"),
  );
  const customAgain = await asUser(customUser, () =>
    db.query("SELECT public.create_empty_bulk_training_plan('My Plan') AS id"),
  );
  assert.equal(customAgain.rows[0].id, custom.rows[0].id);
  assert.equal(
    Number(
      (
        await db.query(
          "SELECT count(*) AS n FROM public.bulk_training_plan_days WHERE plan_id=$1",
          [custom.rows[0].id],
        )
      ).rows[0].n,
    ),
    0,
  );
});

test("owners transactionally edit only their active plan with valid library exercises", async () => {
  const owner = randomUUID();
  const other = randomUUID();
  for (const user of [owner, other]) {
    await db.query("INSERT INTO auth.users(id) VALUES ($1)", [user]);
    await db.query("INSERT INTO public.profiles(id,display_name) VALUES ($1,'Plan editor')", [
      user,
    ]);
    await completeBulkOnboarding(user, { preference: "tempo_preset" });
  }
  const planId = (
    await asUser(owner, () =>
      db.query(
        "SELECT public.instantiate_bulk_training_plan('template:beginner-full-body-2','tempo_preset') AS id",
      ),
    )
  ).rows[0].id;
  const otherCustom = (
    await asUser(other, () =>
      db.query(`INSERT INTO public.bulk_exercises(slug,name,primary_muscle,equipment,movement_pattern)
        VALUES('other-private-move','Other Private Move','biceps',ARRAY['dumbbell'],'other') RETURNING id`),
    )
  ).rows[0].id;
  const ownCustom = (
    await asUser(owner, () =>
      db.query(`INSERT INTO public.bulk_exercises(slug,name,primary_muscle,equipment,movement_pattern,supports_unilateral)
        VALUES('own-private-move','Own Private Move','biceps',ARRAY['dumbbell'],'other',true) RETURNING id`),
    )
  ).rows[0].id;
  const originalTemplateSets = (
    await db.query(
      "SELECT sets FROM public.bulk_training_plan_template_exercises WHERE template_day_id='template:beginner-full-body-2:day:1' AND exercise_order=1",
    )
  ).rows[0].sets;
  const workoutCount = Number(
    (
      await db.query(
        "SELECT count(*) AS n FROM public.bulk_workouts WHERE bulk_profile_id=(SELECT bulk_profile_id FROM public.bulk_training_plans WHERE id=$1)",
        [planId],
      )
    ).rows[0].n,
  );
  const current = (
    await asUser(owner, () =>
      db.query("SELECT updated_at FROM public.bulk_training_plans WHERE id=$1", [planId]),
    )
  ).rows[0];
  const firstPayload = [
    {
      name: "Lower First",
      exercises: [
        {
          exerciseId: "system:pull-up",
          sets: 4,
          repMin: 6,
          repMax: 10,
          executionMode: "bilateral",
          notes: null,
        },
        {
          exerciseId: ownCustom,
          sets: 3,
          repMin: 8,
          repMax: 12,
          executionMode: "unilateral",
          notes: "Neutral grip",
        },
        {
          exerciseId: "system:one-arm-dumbbell-row",
          sets: 2,
          repMin: 10,
          repMax: 15,
          executionMode: "unilateral",
          notes: null,
        },
      ],
    },
    { name: "Upper Second", exercises: [] },
  ];
  await asUser(owner, () =>
    db.query("SELECT public.save_bulk_training_plan($1,$2,'My Edited Plan',$3::jsonb)", [
      planId,
      current.updated_at,
      JSON.stringify(firstPayload),
    ]),
  );
  const saved = await asUser(owner, () =>
    db.query(
      `SELECT p.name,p.active,p.updated_at,d.day_order,d.name AS day_name,e.exercise_order,
      e.exercise_id,e.exercise_name,e.sets,e.rep_min,e.rep_max,e.intended_unilateral_mode,e.notes
      FROM public.bulk_training_plans p JOIN public.bulk_training_plan_days d ON d.plan_id=p.id
      LEFT JOIN public.bulk_training_plan_exercises e ON e.plan_day_id=d.id
      WHERE p.id=$1 ORDER BY d.day_order,e.exercise_order`,
      [planId],
    ),
  );
  assert.equal(saved.rows[0].name, "My Edited Plan");
  assert.equal(saved.rows[0].active, true);
  assert.deepEqual([...new Set(saved.rows.map((row) => row.day_order))], [1, 2]);
  assert.deepEqual(
    saved.rows.filter((row) => row.day_order === 1).map((row) => row.exercise_order),
    [1, 2, 3],
  );
  assert.equal(saved.rows[1].exercise_id, ownCustom);
  assert.equal(saved.rows[1].intended_unilateral_mode, "unilateral");
  assert.equal(saved.rows[1].notes, "Neutral grip");

  const rejectedPayloads = [
    [
      {
        name: "Day",
        exercises: [
          {
            exerciseId: otherCustom,
            sets: 3,
            repMin: 8,
            repMax: 12,
            executionMode: "bilateral",
            notes: null,
          },
        ],
      },
    ],
    [
      {
        name: "Day",
        exercises: [
          {
            exerciseId: "system:flat-barbell-bench-press",
            sets: 0,
            repMin: 8,
            repMax: 12,
            executionMode: "bilateral",
            notes: null,
          },
        ],
      },
    ],
    [
      {
        name: "Day",
        exercises: [
          {
            exerciseId: "system:flat-barbell-bench-press",
            sets: 3,
            repMin: 15,
            repMax: 8,
            executionMode: "bilateral",
            notes: null,
          },
        ],
      },
    ],
    [
      {
        name: "Day",
        exercises: [
          {
            exerciseId: "system:flat-barbell-bench-press",
            sets: 3,
            repMin: 8,
            repMax: 12,
            executionMode: "unilateral",
            notes: null,
          },
        ],
      },
    ],
  ];
  for (const payload of rejectedPayloads) {
    await assert.rejects(
      asUser(owner, () =>
        db.query("SELECT public.save_bulk_training_plan($1,$2,'Invalid',$3::jsonb)", [
          planId,
          saved.rows[0].updated_at,
          JSON.stringify(payload),
        ]),
      ),
      /unavailable|sets|rep range|unilateral/i,
    );
  }
  await assert.rejects(
    asUser(other, () =>
      db.query("SELECT public.save_bulk_training_plan($1,$2,'Stolen',$3::jsonb)", [
        planId,
        saved.rows[0].updated_at,
        JSON.stringify(firstPayload),
      ]),
    ),
    /not found/i,
  );
  await assert.rejects(
    asUser(owner, () =>
      db.query("SELECT public.save_bulk_training_plan($1,'2000-01-01','Stale',$2::jsonb)", [
        planId,
        JSON.stringify(firstPayload),
      ]),
    ),
    /changed on another device/i,
  );

  const replacement = [
    {
      name: "Renamed Day",
      exercises: [
        {
          exerciseId: "system:flat-barbell-bench-press",
          sets: 4,
          repMin: 6,
          repMax: 10,
          executionMode: "bilateral",
          notes: null,
        },
        {
          exerciseId: "system:one-arm-dumbbell-row",
          sets: 2,
          repMin: 10,
          repMax: 15,
          executionMode: "bilateral",
          notes: null,
        },
      ],
    },
  ];
  await asUser(owner, () =>
    db.query("SELECT public.save_bulk_training_plan($1,$2,'My Edited Plan',$3::jsonb)", [
      planId,
      saved.rows[0].updated_at,
      JSON.stringify(replacement),
    ]),
  );
  const finalRows = await db.query(
    `SELECT d.day_order,d.name,e.exercise_order,e.exercise_id,e.sets,e.rep_min,e.rep_max,e.intended_unilateral_mode
    FROM public.bulk_training_plan_days d JOIN public.bulk_training_plan_exercises e ON e.plan_day_id=d.id
    WHERE d.plan_id=$1 ORDER BY d.day_order,e.exercise_order`,
    [planId],
  );
  assert.equal(finalRows.rows.length, 2);
  assert.deepEqual(
    finalRows.rows.map((row) => row.exercise_order),
    [1, 2],
  );
  assert.equal(finalRows.rows[0].exercise_id, "system:flat-barbell-bench-press");
  assert.deepEqual(
    [finalRows.rows[0].sets, finalRows.rows[0].rep_min, finalRows.rows[0].rep_max],
    [4, 6, 10],
  );
  assert.equal(finalRows.rows[0].intended_unilateral_mode, "bilateral");
  assert.equal(
    (
      await db.query(
        "SELECT count(*) AS n FROM public.bulk_training_plans WHERE id=$1 AND active",
        [planId],
      )
    ).rows[0].n,
    1,
  );
  assert.equal(
    (
      await db.query(
        "SELECT sets FROM public.bulk_training_plan_template_exercises WHERE template_day_id='template:beginner-full-body-2:day:1' AND exercise_order=1",
      )
    ).rows[0].sets,
    originalTemplateSets,
  );
  assert.equal(
    Number(
      (
        await db.query(
          "SELECT count(*) AS n FROM public.bulk_workouts WHERE bulk_profile_id=(SELECT bulk_profile_id FROM public.bulk_training_plans WHERE id=$1)",
          [planId],
        )
      ).rows[0].n,
    ),
    workoutCount,
  );
});

test("public Bulk workout sessions are snapshot-based, resumable, validated and owner-only", async () => {
  const owner = randomUUID();
  const stranger = randomUUID();
  for (const user of [owner, stranger]) {
    await db.query("INSERT INTO auth.users(id) VALUES ($1)", [user]);
    await db.query("INSERT INTO public.profiles(id,display_name) VALUES ($1,'Workout tester')", [
      user,
    ]);
    await completeBulkOnboarding(user, { preference: "custom" });
  }
  async function planFor(user, name) {
    const plan = (
      await asUser(user, () =>
        db.query("SELECT public.create_empty_bulk_training_plan($1) AS id", [name]),
      )
    ).rows[0].id;
    const current = (
      await asUser(user, () =>
        db.query("SELECT updated_at FROM public.bulk_training_plans WHERE id=$1", [plan]),
      )
    ).rows[0].updated_at;
    const days = [
      {
        name: "Upper Snapshot",
        exercises: [
          {
            exerciseId: "system:flat-barbell-bench-press",
            sets: 2,
            repMin: 8,
            repMax: 12,
            executionMode: "bilateral",
            notes: "Bench notch 3",
          },
          {
            exerciseId: "system:one-arm-dumbbell-row",
            sets: 1,
            repMin: 8,
            repMax: 12,
            executionMode: "unilateral",
            notes: null,
          },
          {
            exerciseId: "system:pull-up",
            sets: 1,
            repMin: 6,
            repMax: 10,
            executionMode: "bilateral",
            notes: null,
          },
        ],
      },
    ];
    await asUser(user, () =>
      db.query("SELECT public.save_bulk_training_plan($1,$2,$3,$4::jsonb)", [
        plan,
        current,
        name,
        JSON.stringify(days),
      ]),
    );
    const day = (
      await db.query("SELECT id FROM public.bulk_training_plan_days WHERE plan_id=$1", [plan])
    ).rows[0].id;
    return { plan, day };
  }
  const mine = await planFor(owner, "Durable Plan");
  const theirs = await planFor(stranger, "Other Plan");
  await assert.rejects(
    asUser(owner, () => db.query("SELECT public.start_bulk_training_session($1)", [theirs.day])),
    /not found/i,
  );
  const session = (
    await asUser(owner, () =>
      db.query("SELECT public.start_bulk_training_session($1) AS id", [mine.day]),
    )
  ).rows[0].id;
  assert.equal(
    (
      await asUser(owner, () =>
        db.query("SELECT public.start_bulk_training_session($1) AS id", [mine.day]),
      )
    ).rows[0].id,
    session,
  );
  const snapshot = await asUser(owner, () =>
    db.query(
      `
    SELECT s.plan_name_snapshot,s.workout_day_name_snapshot,e.id,e.exercise_name_snapshot,
      e.execution_mode,e.is_bodyweight,e.target_sets,e.target_rep_min,e.target_rep_max,e.notes_snapshot
    FROM public.bulk_training_sessions s
    JOIN public.bulk_training_session_exercises e ON e.session_id=s.id
    WHERE s.id=$1 ORDER BY e.exercise_order
  `,
      [session],
    ),
  );
  assert.equal(snapshot.rows.length, 3);
  assert.deepEqual(
    [
      snapshot.rows[0].plan_name_snapshot,
      snapshot.rows[0].workout_day_name_snapshot,
      snapshot.rows[0].exercise_name_snapshot,
      snapshot.rows[0].target_sets,
      snapshot.rows[0].notes_snapshot,
    ],
    ["Durable Plan", "Upper Snapshot", "Flat Barbell Bench Press", 2, "Bench notch 3"],
  );
  assert.equal(snapshot.rows[2].is_bodyweight, true);
  assert.equal(
    Number(
      (
        await db.query(
          "SELECT count(*) AS n FROM public.bulk_training_sessions WHERE bulk_profile_id=(SELECT bulk_profile_id FROM public.bulk_training_plans WHERE id=$1) AND status='in_progress'",
          [mine.plan],
        )
      ).rows[0].n,
    ),
    1,
  );
  assert.equal(
    (
      await asUser(stranger, () =>
        db.query("SELECT id FROM public.bulk_training_sessions WHERE id=$1", [session]),
      )
    ).rows.length,
    0,
  );
  assert.equal(
    (
      await asUser(stranger, () =>
        db.query("SELECT id FROM public.bulk_training_session_sets WHERE session_exercise_id=$1", [
          snapshot.rows[0].id,
        ]),
      )
    ).rows.length,
    0,
  );

  const sets = (
    await asUser(owner, () =>
      db.query(
        `
    SELECT ss.id,e.execution_mode,e.is_bodyweight,e.exercise_order,ss.set_order
    FROM public.bulk_training_session_sets ss
    JOIN public.bulk_training_session_exercises e ON e.id=ss.session_exercise_id
    WHERE e.session_id=$1 ORDER BY e.exercise_order,ss.set_order
  `,
        [session],
      ),
    )
  ).rows;
  const bilateral = sets.find((row) => row.exercise_order === 1 && row.set_order === 1);
  const unilateral = sets.find((row) => row.exercise_order === 2);
  const bodyweight = sets.find((row) => row.exercise_order === 3);
  const save = (set, bw, br, lw, lr, rw, rr) =>
    asUser(owner, () =>
      db.query("SELECT public.save_bulk_training_session_set($1,$2,$3,$4,$5,$6,$7,$8)", [
        session,
        set,
        bw,
        br,
        lw,
        lr,
        rw,
        rr,
      ]),
    );
  await save(bilateral.id, 22.5, 10, null, null, null, null);
  await assert.rejects(save(bilateral.id, 22.5, 10, 10, 10, null, null), /Bilateral sets/);
  await save(unilateral.id, null, null, 10, 10, 12.5, 8);
  await assert.rejects(save(unilateral.id, 10, 8, null, null, null, null), /Unilateral sets/);
  await save(bodyweight.id, null, 8, null, null, null, null);
  await assert.rejects(
    save(bilateral.id, -1, 10, null, null, null, null),
    /weights_ck|violates check/,
  );
  await assert.rejects(
    asUser(owner, () =>
      db.query(
        "SELECT public.save_bulk_training_session_set($1,$2,10,8.5::numeric,NULL,NULL,NULL,NULL)",
        [session, bilateral.id],
      ),
    ),
    /does not exist|integer|function/i,
  );
  await assert.rejects(save(bilateral.id, 10, 0, null, null, null, null), /reps_ck|violates check/);

  const extra = (
    await asUser(owner, () =>
      db.query("SELECT public.add_bulk_training_session_set($1,$2) AS id", [
        session,
        snapshot.rows[0].id,
      ]),
    )
  ).rows[0].id;
  assert.deepEqual(
    (
      await db.query(
        "SELECT set_order,is_extra FROM public.bulk_training_session_sets WHERE id=$1",
        [extra],
      )
    ).rows[0],
    { set_order: 3, is_extra: true },
  );
  assert.equal(
    (
      await asUser(owner, () =>
        db.query("SELECT public.remove_bulk_training_session_set($1,$2) AS ok", [session, extra]),
      )
    ).rows[0].ok,
    true,
  );

  const changedAt = (
    await db.query("SELECT updated_at FROM public.bulk_training_plans WHERE id=$1", [mine.plan])
  ).rows[0].updated_at;
  await asUser(owner, () =>
    db.query("SELECT public.save_bulk_training_plan($1,$2,'Renamed Future Plan',$3::jsonb)", [
      mine.plan,
      changedAt,
      JSON.stringify([{ name: "Changed Future Day", exercises: [] }]),
    ]),
  );
  const stable = (
    await db.query(
      "SELECT plan_name_snapshot,workout_day_name_snapshot FROM public.bulk_training_sessions WHERE id=$1",
      [session],
    )
  ).rows[0];
  assert.deepEqual(stable, {
    plan_name_snapshot: "Durable Plan",
    workout_day_name_snapshot: "Upper Snapshot",
  });
  assert.equal(
    (
      await db.query(
        "SELECT exercise_name_snapshot FROM public.bulk_training_session_exercises WHERE session_id=$1 ORDER BY exercise_order",
        [session],
      )
    ).rows.length,
    3,
  );

  await assert.rejects(
    asUser(owner, () =>
      db.query("SELECT public.finish_bulk_training_session($1,false)", [session]),
    ),
    /Incomplete sets require confirmation/,
  );
  assert.equal(
    (
      await asUser(owner, () =>
        db.query("SELECT public.finish_bulk_training_session($1,true) AS id", [session]),
      )
    ).rows[0].id,
    session,
  );
  assert.equal(
    (
      await asUser(owner, () =>
        db.query("SELECT public.finish_bulk_training_session($1,true) AS id", [session]),
      )
    ).rows[0].id,
    session,
  );
  await assert.rejects(
    save(bilateral.id, 25, 9, null, null, null, null),
    /Active workout not found|cannot be changed/,
  );
  await assert.rejects(
    asUser(owner, () =>
      db.query("UPDATE public.bulk_training_session_sets SET bilateral_reps=12 WHERE id=$1", [
        bilateral.id,
      ]),
    ),
    /permission denied|cannot be changed/,
  );
  assert.equal(
    Number(
      (
        await db.query(
          "SELECT bilateral_weight,bilateral_reps FROM public.bulk_training_session_sets WHERE id=$1",
          [bilateral.id],
        )
      ).rows[0].bilateral_weight,
    ),
    22.5,
  );

  const discardSession = (
    await asUser(stranger, () =>
      db.query("SELECT public.start_bulk_training_session($1) AS id", [theirs.day]),
    )
  ).rows[0].id;
  await assert.rejects(
    asUser(owner, () =>
      db.query("SELECT public.discard_bulk_training_session($1)", [discardSession]),
    ),
    /not found/,
  );
  assert.equal(
    (
      await asUser(stranger, () =>
        db.query("SELECT public.discard_bulk_training_session($1) AS ok", [discardSession]),
      )
    ).rows[0].ok,
    true,
  );
  assert.ok(
    Number((await db.query("SELECT count(*) AS n FROM public.bulk_workouts")).rows[0].n) >= 0,
  );
});

test("atomic challenge creation writes challenge, own membership and invitation exactly once", async () => {
  const requestId = randomUUID();
  const tokenHash = "a".repeat(64);
  const first = await createChallengeAtomic(a, requestId, tokenHash);
  const retry = await createChallengeAtomic(a, requestId, tokenHash);
  assert.equal(first.rows[0].id, requestId);
  assert.equal(retry.rows[0].id, requestId);

  const state = await db.query(
    `SELECT
      (SELECT count(*) FROM public.challenges WHERE id=$1) AS challenges,
      (SELECT count(*) FROM public.challenge_members WHERE challenge_id=$1) AS members,
      (SELECT count(*) FROM public.challenge_invitations WHERE challenge_id=$1) AS invitations,
      (SELECT created_by FROM public.challenges WHERE id=$1) AS creator,
      (SELECT user_id FROM public.challenge_members WHERE challenge_id=$1) AS member`,
    [requestId],
  );
  assert.deepEqual(
    {
      challenges: Number(state.rows[0].challenges),
      members: Number(state.rows[0].members),
      invitations: Number(state.rows[0].invitations),
      creator: state.rows[0].creator,
      member: state.rows[0].member,
    },
    { challenges: 1, members: 1, invitations: 1, creator: a, member: a },
  );

  await assert.rejects(createChallengeAtomic(b, requestId, tokenHash), /conflicts/);
  await assert.rejects(
    asUser(a, () =>
      db.query("INSERT INTO public.challenge_members(challenge_id,user_id) VALUES ($1,$2)", [
        requestId,
        b,
      ]),
    ),
    /permission denied|row-level security/,
  );
});

test("atomic creation stores immutable challenge-specific target and money penalties", async () => {
  const requestId = randomUUID();
  const token = "custom-terms-invitation-token-with-enough-entropy";
  const tokenHash = createHash("sha256").update(token).digest("hex");
  await createChallengeAtomic(a, requestId, tokenHash, {
    target: 30,
    high: 60,
    medium: 35,
    low: 10,
  });
  const stored = (
    await db.query(
      `SELECT weekly_target_km,penalty_mode,penalty_high_eur,penalty_medium_eur,
        penalty_low_eur,legacy_photo_owed,travel_pause_enabled,travel_pause_home_countries
       FROM public.challenges WHERE id=$1`,
      [requestId],
    )
  ).rows[0];
  assert.deepEqual(
    {
      ...stored,
      weekly_target_km: Number(stored.weekly_target_km),
      penalty_high_eur: Number(stored.penalty_high_eur),
      penalty_medium_eur: Number(stored.penalty_medium_eur),
      penalty_low_eur: Number(stored.penalty_low_eur),
    },
    {
      weekly_target_km: 30,
      penalty_mode: "money",
      penalty_high_eur: 60,
      penalty_medium_eur: 35,
      penalty_low_eur: 10,
      legacy_photo_owed: false,
      travel_pause_enabled: true,
      travel_pause_home_countries: ["GR", "SE"],
    },
  );

  const preview = await asService(() =>
    db.query("SELECT * FROM public.preview_challenge_invitation($1,$2,$3)", [
      b,
      "opponent@example.com",
      token,
    ]),
  );
  assert.equal(preview.rows[0].challenge_id, requestId);
  assert.equal(Number(preview.rows[0].weekly_target_km), 30);
  assert.equal(preview.rows[0].penalty_mode, "money");
  assert.equal(Number(preview.rows[0].penalty_high_eur), 60);
  await assert.rejects(
    asUser(b, () =>
      db.query("SELECT * FROM public.preview_challenge_invitation($1,$2,$3)", [
        b,
        "opponent@example.com",
        token,
      ]),
    ),
    /permission denied/,
  );
  const accepted = await asService(() =>
    db.query("SELECT public.accept_challenge_invitation($1,$2,$3) AS id", [
      b,
      "opponent@example.com",
      token,
    ]),
  );
  assert.equal(accepted.rows[0].id, requestId);
  assert.equal(
    Number(
      (
        await db.query(
          "SELECT count(*) AS n FROM public.challenge_members WHERE challenge_id=$1 AND user_id=$2",
          [requestId, b],
        )
      ).rows[0].n,
    ),
    1,
  );
  await assert.rejects(
    db.query("UPDATE public.challenges SET weekly_target_km=40 WHERE id=$1", [requestId]),
    /immutable/,
  );
  await assert.rejects(
    createChallengeAtomic(a, requestId, tokenHash, {
      target: 40,
      high: 60,
      medium: 35,
      low: 10,
    }),
    /conflicts/,
  );
});

test("legacy challenges retain the 15 km and €15/€10/€5 defaults", async () => {
  const legacy = (
    await db.query(
      `SELECT weekly_target_km,penalty_mode,penalty_high_eur,penalty_medium_eur,
        penalty_low_eur,legacy_photo_owed,travel_pause_enabled,travel_pause_home_countries
       FROM public.challenges WHERE id=$1`,
      [x],
    )
  ).rows[0];
  assert.deepEqual(
    {
      ...legacy,
      weekly_target_km: Number(legacy.weekly_target_km),
      penalty_high_eur: Number(legacy.penalty_high_eur),
      penalty_medium_eur: Number(legacy.penalty_medium_eur),
      penalty_low_eur: Number(legacy.penalty_low_eur),
    },
    {
      weekly_target_km: 15,
      penalty_mode: "money",
      penalty_high_eur: 15,
      penalty_medium_eur: 10,
      penalty_low_eur: 5,
      legacy_photo_owed: true,
      travel_pause_enabled: true,
      travel_pause_home_countries: ["GR", "SE"],
    },
  );
});

test("incremental custom migration preserves deployed money challenges, weeks and payments", async () => {
  const upgradeDb = new PGlite();
  const owner = randomUUID();
  const opponent = randomUUID();
  const challenge = randomUUID();
  const week = randomUUID();
  const payment = randomUUID();
  try {
    await upgradeDb.exec(platformSchema);
    const migrationFiles = (await readdir(root)).filter((file) => file.endsWith(".sql")).sort();
    for (const file of migrationFiles.filter((file) => file < "20260904170000_")) {
      await upgradeDb.exec(await readFile(new URL(file, root), "utf8"));
    }
    await upgradeDb.query("INSERT INTO auth.users VALUES ($1),($2)", [owner, opponent]);
    await upgradeDb.query(
      "INSERT INTO public.profiles(id,display_name) VALUES ($1,'Owner'),($2,'Opponent')",
      [owner, opponent],
    );
    await upgradeDb.query(
      `INSERT INTO public.challenges(
        id,created_by,name,start_date,timezone,weekly_target_km,
        penalty_high_eur,penalty_medium_eur,penalty_low_eur
      ) VALUES ($1,$2,'Deployed money challenge',CURRENT_DATE-14,'UTC',30,44,22,11)`,
      [challenge, owner],
    );
    await upgradeDb.query(
      "INSERT INTO public.challenge_members(challenge_id,user_id) VALUES ($1,$2),($1,$3)",
      [challenge, owner, opponent],
    );
    await upgradeDb.query(
      `INSERT INTO public.challenge_weeks(
        id,challenge_id,user_id,week_number,week_start,week_end,equivalent_km,target_km,penalty_eur
      ) VALUES ($1,$2,$3,1,CURRENT_DATE-14,CURRENT_DATE-8,25,30,11)`,
      [week, challenge, owner],
    );
    await upgradeDb.query(
      `INSERT INTO public.challenge_payments(
        id,challenge_id,week_id,payer_id,recipient_id,amount_eur
      ) VALUES ($1,$2,$3,$4,$5,11)`,
      [payment, challenge, week, owner, opponent],
    );
    await upgradeDb.query("SELECT set_config('request.jwt.claim.sub', $1, false)", [owner]);
    await upgradeDb.exec("SET ROLE authenticated");
    await upgradeDb.query(
      `INSERT INTO public.challenge_travel_pauses(challenge_id,user_id,week_number,country)
       VALUES ($1,$2,3,'Italy')`,
      [challenge, owner],
    );
    await upgradeDb.exec("RESET ROLE");

    const beforeWeek = (
      await upgradeDb.query(
        `SELECT challenge_id,user_id,week_number,equivalent_km,target_km,penalty_eur,completed
         FROM public.challenge_weeks WHERE id=$1`,
        [week],
      )
    ).rows[0];
    const beforePayment = (
      await upgradeDb.query(
        `SELECT challenge_id,week_id,payer_id,recipient_id,amount_eur,status
         FROM public.challenge_payments WHERE id=$1`,
        [payment],
      )
    ).rows[0];

    await upgradeDb.exec(
      await readFile(new URL("20260904170000_add_custom_challenge_penalties.sql", root), "utf8"),
    );
    await upgradeDb.exec(
      await readFile(new URL("20260904180000_configurable_travel_pause_terms.sql", root), "utf8"),
    );

    const upgraded = (
      await upgradeDb.query(
        `SELECT weekly_target_km,penalty_high_eur,penalty_medium_eur,penalty_low_eur,
          penalty_mode,legacy_photo_owed,penalty_high_custom,penalty_medium_custom,
          penalty_low_custom,travel_pause_enabled,travel_pause_home_countries
          FROM public.challenges WHERE id=$1`,
        [challenge],
      )
    ).rows[0];
    assert.deepEqual(
      {
        ...upgraded,
        weekly_target_km: Number(upgraded.weekly_target_km),
        penalty_high_eur: Number(upgraded.penalty_high_eur),
        penalty_medium_eur: Number(upgraded.penalty_medium_eur),
        penalty_low_eur: Number(upgraded.penalty_low_eur),
      },
      {
        weekly_target_km: 30,
        penalty_high_eur: 44,
        penalty_medium_eur: 22,
        penalty_low_eur: 11,
        penalty_mode: "money",
        legacy_photo_owed: true,
        penalty_high_custom: null,
        penalty_medium_custom: null,
        penalty_low_custom: null,
        travel_pause_enabled: true,
        travel_pause_home_countries: ["GR", "SE"],
      },
    );
    assert.deepEqual(
      (
        await upgradeDb.query(
          `SELECT challenge_id,user_id,week_number,equivalent_km,target_km,penalty_eur,completed
           FROM public.challenge_weeks WHERE id=$1`,
          [week],
        )
      ).rows[0],
      beforeWeek,
    );
    assert.deepEqual(
      (
        await upgradeDb.query(
          `SELECT challenge_id,week_id,payer_id,recipient_id,amount_eur,status
           FROM public.challenge_payments WHERE id=$1`,
          [payment],
        )
      ).rows[0],
      beforePayment,
    );
    assert.deepEqual(
      (
        await upgradeDb.query(
          "SELECT penalty_mode,penalty_band,penalty_consequence FROM public.challenge_weeks WHERE id=$1",
          [week],
        )
      ).rows[0],
      { penalty_mode: null, penalty_band: null, penalty_consequence: null },
    );
    assert.deepEqual(
      (
        await upgradeDb.query(
          "SELECT week_number,country FROM public.challenge_travel_pauses WHERE challenge_id=$1",
          [challenge],
        )
      ).rows,
      [{ week_number: 3, country: "Italy" }],
    );
  } finally {
    await upgradeDb.close();
  }
});

test("custom challenge creation stores and previews exact immutable consequences", async () => {
  const requestId = randomUUID();
  const token = "custom-mode-invitation-token-with-enough-entropy";
  await createChallengeAtomic(a, requestId, createHash("sha256").update(token).digest("hex"), {
    target: 45,
    mode: "custom",
    customHigh: "Send 3 photos",
    customMedium: "Buy dinner",
    customLow: "Make breakfast",
  });
  const stored = (
    await db.query(
      `SELECT penalty_mode,penalty_high_custom,penalty_medium_custom,penalty_low_custom,
        legacy_photo_owed FROM public.challenges WHERE id=$1`,
      [requestId],
    )
  ).rows[0];
  assert.deepEqual(stored, {
    penalty_mode: "custom",
    penalty_high_custom: "Send 3 photos",
    penalty_medium_custom: "Buy dinner",
    penalty_low_custom: "Make breakfast",
    legacy_photo_owed: false,
  });
  const preview = await asService(() =>
    db.query("SELECT * FROM public.preview_challenge_invitation($1,$2,$3)", [
      b,
      "opponent@example.com",
      token,
    ]),
  );
  assert.deepEqual(
    {
      target: Number(preview.rows[0].weekly_target_km),
      mode: preview.rows[0].penalty_mode,
      high: preview.rows[0].penalty_high_custom,
      medium: preview.rows[0].penalty_medium_custom,
      low: preview.rows[0].penalty_low_custom,
    },
    {
      target: 45,
      mode: "custom",
      high: "Send 3 photos",
      medium: "Buy dinner",
      low: "Make breakfast",
    },
  );
  await assert.rejects(
    db.query("UPDATE public.challenges SET penalty_low_custom='Changed' WHERE id=$1", [requestId]),
    /immutable/,
  );
});

test("atomic creation stores, normalizes and previews immutable travel-pause terms", async () => {
  await assert.rejects(
    asUser(a, () => db.query("SELECT private.valid_travel_pause_countries(ARRAY['GR']::text[])")),
    /permission denied/,
  );
  assert.equal(
    (
      await asService(() =>
        db.query("SELECT private.valid_travel_pause_countries(ARRAY['GR','SE']::text[]) AS valid"),
      )
    ).rows[0].valid,
    true,
  );
  const disabledId = randomUUID();
  const disabledToken = "disabled-travel-invitation-token-with-enough-entropy";
  await createChallengeAtomic(
    a,
    disabledId,
    createHash("sha256").update(disabledToken).digest("hex"),
    { travelEnabled: false, homeCountries: [] },
  );
  assert.deepEqual(
    (
      await db.query(
        "SELECT travel_pause_enabled,travel_pause_home_countries FROM public.challenges WHERE id=$1",
        [disabledId],
      )
    ).rows[0],
    { travel_pause_enabled: false, travel_pause_home_countries: [] },
  );
  const disabledPreview = await asService(() =>
    db.query("SELECT * FROM public.preview_challenge_invitation($1,$2,$3)", [
      b,
      "opponent@example.com",
      disabledToken,
    ]),
  );
  assert.equal(disabledPreview.rows[0].travel_pause_enabled, false);
  assert.deepEqual(disabledPreview.rows[0].travel_pause_home_countries, []);
  await assert.rejects(
    asUser(a, () =>
      db.query(
        "INSERT INTO public.challenge_travel_pauses(challenge_id,user_id,week_number,country) VALUES ($1,$2,1,'IT')",
        [disabledId, a],
      ),
    ),
    /disabled/i,
  );

  const oneCountryId = randomUUID();
  await createChallengeAtomic(a, oneCountryId, "d".repeat(64), {
    homeCountries: ["se"],
  });
  assert.deepEqual(
    (
      await db.query("SELECT travel_pause_home_countries FROM public.challenges WHERE id=$1", [
        oneCountryId,
      ])
    ).rows[0].travel_pause_home_countries,
    ["SE"],
  );

  const multipleId = randomUUID();
  const multipleToken = "multiple-country-invitation-token-with-enough-entropy";
  await createChallengeAtomic(
    a,
    multipleId,
    createHash("sha256").update(multipleToken).digest("hex"),
    {
      homeCountries: [" se ", "GR", "de", "GR"],
    },
  );
  assert.deepEqual(
    (
      await db.query("SELECT travel_pause_home_countries FROM public.challenges WHERE id=$1", [
        multipleId,
      ])
    ).rows[0].travel_pause_home_countries,
    ["DE", "GR", "SE"],
  );
  const multiplePreview = await asService(() =>
    db.query(
      "SELECT travel_pause_enabled,travel_pause_home_countries FROM public.preview_challenge_invitation($1,$2,$3)",
      [b, "opponent@example.com", multipleToken],
    ),
  );
  assert.equal(multiplePreview.rows[0].travel_pause_enabled, true);
  assert.deepEqual(multiplePreview.rows[0].travel_pause_home_countries, ["DE", "GR", "SE"]);
  await assert.rejects(
    db.query("UPDATE public.challenges SET travel_pause_enabled=false WHERE id=$1", [multipleId]),
    /immutable/,
  );
});

test("atomic creation rejects invalid targets and penalty values without partial state", async () => {
  for (const terms of [
    { target: 0, high: 15, medium: 10, low: 5 },
    { target: 501, high: 15, medium: 10, low: 5 },
    { target: 30.001, high: 15, medium: 10, low: 5 },
    { target: 30, high: 5, medium: 10, low: 1 },
    { target: 30, high: 1001, medium: 10, low: 5 },
    { target: 30, mode: "custom", customHigh: "", customMedium: "Dinner", customLow: "Tea" },
    {
      target: 30,
      mode: "custom",
      customHigh: "x".repeat(161),
      customMedium: "Dinner",
      customLow: "Tea",
    },
    { target: 30, mode: "photo" },
    { target: 30, mode: "money", customHigh: "Unexpected custom term" },
    { target: 30, travelEnabled: true, homeCountries: [] },
    { target: 30, travelEnabled: true, homeCountries: ["ZZ"] },
    { target: 30, travelEnabled: false, homeCountries: ["GR"] },
  ]) {
    const requestId = randomUUID();
    await assert.rejects(
      createChallengeAtomic(a, requestId, randomUUID().replaceAll("-", "").repeat(2), terms),
      /Weekly target|Penalty amounts|Penalty mode|Custom consequences|Money penalties|Travel pause|home countries/,
    );
    const rows = await db.query(
      `SELECT
        (SELECT count(*) FROM public.challenges WHERE id=$1) AS challenges,
        (SELECT count(*) FROM public.challenge_members WHERE challenge_id=$1) AS members,
        (SELECT count(*) FROM public.challenge_invitations WHERE challenge_id=$1) AS invitations`,
      [requestId],
    );
    assert.deepEqual(
      Object.fromEntries(Object.entries(rows.rows[0]).map(([key, value]) => [key, Number(value)])),
      { challenges: 0, members: 0, invitations: 0 },
    );
  }
});

test("atomic creation rolls every row back when the invitation insert fails", async () => {
  const tokenHash = "b".repeat(64);
  await createChallengeAtomic(a, randomUUID(), tokenHash);
  const failedRequest = randomUUID();
  await assert.rejects(createChallengeAtomic(a, failedRequest, tokenHash), /unique|duplicate/i);
  const leftovers = await db.query(
    `SELECT
      (SELECT count(*) FROM public.challenges WHERE id=$1) AS challenges,
      (SELECT count(*) FROM public.challenge_members WHERE challenge_id=$1) AS members,
      (SELECT count(*) FROM public.challenge_invitations WHERE challenge_id=$1) AS invitations`,
    [failedRequest],
  );
  assert.deepEqual(
    Object.fromEntries(
      Object.entries(leftovers.rows[0]).map(([key, value]) => [key, Number(value)]),
    ),
    { challenges: 0, members: 0, invitations: 0 },
  );
});

test("atomic challenge creation rejects unauthenticated and direct partial creation", async () => {
  const callWithCaller = (caller) =>
    db.query(
      `SELECT public.create_challenge_atomic(
        $1, $2, 'No owner', (date_trunc('week', CURRENT_DATE) + interval '7 days')::date,
        'UTC', 52, 'opponent@example.com', $3, 15, 'money', 15, 10, 5,
        null, null, null, true, ARRAY['GR','SE']::text[]
      )`,
      [caller, randomUUID(), "c".repeat(64)],
    );
  await assert.rejects(
    asAnon(() => callWithCaller(a)),
    /permission denied/,
  );
  await assert.rejects(
    asUser(a, () => callWithCaller(a)),
    /permission denied/,
  );
  const callPrivateWithCaller = (caller) =>
    db.query(
      `SELECT private.create_challenge_atomic(
        $1, $2, 'No owner', (date_trunc('week', CURRENT_DATE) + interval '7 days')::date,
        'UTC', 52, 'opponent@example.com', $3, 15, 'money', 15, 10, 5,
        null, null, null, true, ARRAY['GR','SE']::text[]
      )`,
      [caller, randomUUID(), "c".repeat(64)],
    );
  await assert.rejects(
    asAnon(() => callPrivateWithCaller(a)),
    /permission denied/,
  );
  await assert.rejects(
    asUser(a, () => callPrivateWithCaller(a)),
    /permission denied/,
  );
  await assert.rejects(
    asService(() => callWithCaller(null)),
    /Not authenticated/,
  );

  await assert.rejects(
    asUser(a, () =>
      db.query(
        "INSERT INTO public.challenges(id,created_by,name,start_date,timezone) VALUES ($1,$2,'Partial',CURRENT_DATE,'UTC')",
        [randomUUID(), a],
      ),
    ),
    /permission denied|row-level security/,
  );
});
test("normal activity creation still works without forging audit history", async () => {
  const challenge = await freshChallenge("Activity creation");
  const created = await activity(a, 4, challenge);
  assert.equal(created.rows.length, 1);
  assert.equal(
    Number(
      (
        await db.query(
          "SELECT count(*) AS n FROM public.challenge_activity_audit WHERE activity_id=$1",
          [created.rows[0].id],
        )
      ).rows[0].n,
    ),
    0,
  );
});
test("activity owner can correct an open-week activity and the trigger records its old values", async () => {
  const challenge = await freshChallenge("Open correction");
  const created = await activity(a, 4, challenge);
  const id = created.rows[0].id;
  const beforeDate = (
    await db.query("SELECT activity_date FROM public.challenge_activities WHERE id=$1", [id])
  ).rows[0].activity_date;
  const corrected = await asUser(a, () =>
    db.query(
      "UPDATE public.challenge_activities SET activity_type='cycle',distance_km=12 WHERE id=$1 RETURNING edited,activity_type,distance_km",
      [id],
    ),
  );
  assert.equal(corrected.rows.length, 1);
  assert.equal(corrected.rows[0].edited, true);
  assert.equal(corrected.rows[0].activity_type, "cycle");
  assert.equal(Number(corrected.rows[0].distance_km), 12);
  const audit = await asUser(a, () =>
    db.query(
      "SELECT old_activity_type,old_distance_km,old_activity_date,old_duration_seconds,changed_by,changed_at,action FROM public.challenge_activity_audit WHERE activity_id=$1",
      [id],
    ),
  );
  assert.equal(audit.rows.length, 1);
  assert.equal(audit.rows[0].action, "update");
  assert.equal(audit.rows[0].old_activity_type, "run");
  assert.equal(Number(audit.rows[0].old_distance_km), 4);
  assert.deepEqual(audit.rows[0].old_activity_date, beforeDate);
  assert.equal(audit.rows[0].old_duration_seconds, 1440);
  assert.equal(audit.rows[0].changed_by, a);
  assert.ok(audit.rows[0].changed_at);
});
test("the other challenge member cannot edit an activity they do not own", async () => {
  const challenge = await freshChallenge("Opponent isolation");
  const id = (await activity(a, 5, challenge)).rows[0].id;
  const result = await asUser(b, () =>
    db.query("UPDATE public.challenge_activities SET distance_km=99 WHERE id=$1 RETURNING id", [
      id,
    ]),
  );
  assert.equal(result.rows.length, 0);
  assert.equal(
    Number(
      (await db.query("SELECT distance_km FROM public.challenge_activities WHERE id=$1", [id]))
        .rows[0].distance_km,
    ),
    5,
  );
});
test("a third party cannot edit the activity, inspect its audit, or forge audit rows", async () => {
  const challenge = await freshChallenge("Third-party isolation");
  const id = (await activity(a, 6, challenge)).rows[0].id;
  await asUser(a, () =>
    db.query("UPDATE public.challenge_activities SET distance_km=7 WHERE id=$1", [id]),
  );
  const update = await asUser(c, () =>
    db.query("UPDATE public.challenge_activities SET distance_km=100 WHERE id=$1 RETURNING id", [
      id,
    ]),
  );
  assert.equal(update.rows.length, 0);
  const protectedAudit = await asUser(c, () =>
    db.query("SELECT * FROM public.challenge_activity_audit WHERE activity_id=$1", [id]),
  );
  assert.equal(protectedAudit.rows.length, 0);
  const privileges = await asUser(c, () =>
    db.query(
      "SELECT has_table_privilege('public.challenge_activity_audit','INSERT') AS ins,has_table_privilege('public.challenge_activity_audit','UPDATE') AS upd,has_table_privilege('public.challenge_activity_audit','DELETE') AS del",
    ),
  );
  assert.deepEqual(privileges.rows[0], { ins: false, upd: false, del: false });
  await assert.rejects(
    asUser(c, () =>
      db.query(
        "INSERT INTO public.challenge_activity_audit(activity_id,challenge_id,changed_by,action) VALUES ($1,$2,$3,'forged')",
        [id, challenge, c],
      ),
    ),
    /permission denied/,
  );
});
test("deleting an owned open-week activity still creates protected audit history", async () => {
  const challenge = await freshChallenge("Delete audit");
  const id = (await activity(a, 9, challenge, "cycle")).rows[0].id;
  const removed = await asUser(a, () =>
    db.query("DELETE FROM public.challenge_activities WHERE id=$1 RETURNING id", [id]),
  );
  assert.equal(removed.rows.length, 1);
  const audit = await asUser(a, () =>
    db.query(
      "SELECT action,old_activity_type,old_distance_km,old_activity_date,changed_by,changed_at FROM public.challenge_activity_audit WHERE activity_id=$1",
      [id],
    ),
  );
  assert.equal(audit.rows.length, 1);
  assert.equal(audit.rows[0].action, "delete");
  assert.equal(audit.rows[0].old_activity_type, "cycle");
  assert.equal(Number(audit.rows[0].old_distance_km), 9);
  assert.equal(audit.rows[0].changed_by, a);
  assert.ok(audit.rows[0].old_activity_date);
  assert.ok(audit.rows[0].changed_at);
});
test("a member who has left the challenge cannot correct their former activity", async () => {
  const challenge = await freshChallenge("Former member");
  const id = (await activity(a, 6, challenge)).rows[0].id;
  await db.query("DELETE FROM public.challenge_members WHERE challenge_id=$1 AND user_id=$2", [
    challenge,
    a,
  ]);
  const update = await asUser(a, () =>
    db.query("UPDATE public.challenge_activities SET distance_km=8 WHERE id=$1 RETURNING id", [id]),
  );
  assert.equal(update.rows.length, 0);
  assert.equal(
    Number(
      (await db.query("SELECT distance_km FROM public.challenge_activities WHERE id=$1", [id]))
        .rows[0].distance_km,
    ),
    6,
  );
});
test("a closed-week activity cannot be changed", async () => {
  const challenge = await freshChallenge("Closed correction");
  const id = (await activity(a, 6, challenge)).rows[0].id;
  await db.query("UPDATE public.challenges SET start_date=CURRENT_DATE-7 WHERE id=$1", [challenge]);
  await db.exec(
    "ALTER TABLE public.challenge_activities DISABLE TRIGGER challenge_activities_guard",
  );
  try {
    await db.query(
      "UPDATE public.challenge_activities SET activity_date=CURRENT_DATE-7 WHERE id=$1",
      [id],
    );
  } finally {
    await db.exec(
      "ALTER TABLE public.challenge_activities ENABLE TRIGGER challenge_activities_guard",
    );
  }
  assert.equal(
    (
      await db.query(
        "SELECT private.challenge_week_open(challenge_id,activity_date) AS open FROM public.challenge_activities WHERE id=$1",
        [id],
      )
    ).rows[0].open,
    false,
  );
  const update = await asUser(a, () =>
    db.query("UPDATE public.challenge_activities SET distance_km=8 WHERE id=$1 RETURNING id", [id]),
  );
  assert.equal(update.rows.length, 0);
  assert.equal(
    Number(
      (await db.query("SELECT distance_km FROM public.challenge_activities WHERE id=$1", [id]))
        .rows[0].distance_km,
    ),
    6,
  );
});
test("an explicitly finalized activity cannot be changed even while its dates are current", async () => {
  const challenge = await freshChallenge("Finalized correction");
  const id = (await activity(a, 6, challenge)).rows[0].id;
  await db.query(
    "INSERT INTO public.challenge_weeks(challenge_id,user_id,week_number,week_start,week_end) VALUES ($1,$2,1,CURRENT_DATE,CURRENT_DATE+6)",
    [challenge, a],
  );
  await assert.rejects(
    asUser(a, () =>
      db.query("UPDATE public.challenge_activities SET distance_km=8 WHERE id=$1", [id]),
    ),
    /Finalized activity cannot be changed/,
  );
  assert.equal(
    Number(
      (await db.query("SELECT distance_km FROM public.challenge_activities WHERE id=$1", [id]))
        .rows[0].distance_km,
    ),
    6,
  );
});
test("crossing 15 creates one completion; later posts, edits and recrossings cannot duplicate it", async () => {
  const row = await activity(a, 24, x, "cycle"); // 7 + 24/3 = 15
  assert.equal(await count("target_reached"), 1);
  await activity(a, 1);
  await asUser(a, () =>
    db.query("UPDATE public.challenge_activities SET distance_km=3 WHERE id=$1", [row.rows[0].id]),
  );
  await asUser(a, () =>
    db.query("UPDATE public.challenge_activities SET distance_km=24 WHERE id=$1", [row.rows[0].id]),
  );
  assert.equal(await count("target_reached"), 1);
  assert.equal(await count("activity_posted"), 4);
});
test("pace and speed thresholds are authoritative and duration changes are audited", async () => {
  const challenge = await freshChallenge("Qualification thresholds");
  const insert = (type, km, seconds) =>
    asUser(a, () =>
      db.query(
        "INSERT INTO public.challenge_activities(challenge_id,user_id,activity_type,distance_km,duration_seconds,activity_date,evidence_path) VALUES ($1,$2,$3,$4,$5,CURRENT_DATE,'test') RETURNING id,is_qualified,qualifying_equivalent_km,average_speed_kmh,average_pace_seconds_per_km",
        [challenge, a, type, km, seconds],
      ),
    );
  const fastRun = (await insert("run", 7, 2939)).rows[0];
  const sevenMinuteRun = (await insert("run", 7, 2940)).rows[0];
  const thresholdRide = (await insert("cycle", 18, 3600)).rows[0];
  const slowRide = (await insert("cycle", 18, 3601)).rows[0];
  assert.equal(fastRun.is_qualified, true);
  assert.equal(Number(fastRun.qualifying_equivalent_km), 7);
  assert.equal(sevenMinuteRun.is_qualified, false);
  assert.equal(Number(sevenMinuteRun.qualifying_equivalent_km), 0);
  assert.equal(thresholdRide.is_qualified, true);
  assert.equal(Number(thresholdRide.qualifying_equivalent_km), 6);
  assert.equal(slowRide.is_qualified, false);
  assert.equal(Number(slowRide.qualifying_equivalent_km), 0);
  await asUser(a, () =>
    db.query("UPDATE public.challenge_activities SET duration_seconds=2800 WHERE id=$1", [
      sevenMinuteRun.id,
    ]),
  );
  const audit = await db.query(
    "SELECT old_duration_seconds FROM public.challenge_activity_audit WHERE activity_id=$1",
    [sevenMinuteRun.id],
  );
  assert.equal(audit.rows[0].old_duration_seconds, 2940);
  await assert.rejects(
    asUser(a, () =>
      db.query(
        "INSERT INTO public.challenge_activities(challenge_id,user_id,activity_type,distance_km,activity_date,evidence_path) VALUES ($1,$2,'run',5,CURRENT_DATE,'test')",
        [challenge, a],
      ),
    ),
    /Duration is required/,
  );
});
test("weekly penalty tiers use precise target-relative thirds and stored money amounts", async () => {
  const result = await db.query(
    `SELECT
      public.penalty_for(15,15) AS legacy_full,
      public.penalty_for(14.99,15) AS legacy_low,
      public.penalty_for(10,15) AS legacy_two_thirds,
      public.penalty_for(9.99,15) AS legacy_medium,
      public.penalty_for(5,15) AS legacy_one_third,
      public.penalty_for(4.99,15) AS legacy_high,
      public.penalty_for(9.999,30,90,60,30) AS thirty_high,
      public.penalty_for(10,30,90,60,30) AS thirty_medium,
      public.penalty_for(20,30,90,60,30) AS thirty_low,
      public.penalty_for(30,30,90,60,30) AS thirty_full,
      public.penalty_for(15,45,90,60,30) AS forty_five_medium,
      public.penalty_for(30,45,90,60,30) AS forty_five_low,
      public.penalty_for(6.666666,20,90,60,30) AS arbitrary_high,
      public.penalty_for(20.0/3,20,90,60,30) AS arbitrary_medium,
      public.penalty_for(0,0,90,60,30) AS paused`,
  );
  assert.deepEqual(
    Object.fromEntries(Object.entries(result.rows[0]).map(([key, value]) => [key, Number(value)])),
    {
      legacy_full: 0,
      legacy_low: 5,
      legacy_two_thirds: 5,
      legacy_medium: 10,
      legacy_one_third: 10,
      legacy_high: 15,
      thirty_high: 90,
      thirty_medium: 60,
      thirty_low: 30,
      thirty_full: 0,
      forty_five_medium: 60,
      forty_five_low: 30,
      arbitrary_high: 90,
      arbitrary_medium: 60,
      paused: 0,
    },
  );
});
test("unrelated edits and bulk tracker writes create no events", async () => {
  const before = (await db.query("SELECT count(*) AS n FROM public.challenge_notification_events"))
    .rows[0].n;
  await asUser(a, () =>
    db.query(
      "UPDATE public.challenge_activities SET note='not a notification' WHERE user_id=$1 AND challenge_id=$2",
      [a, x],
    ),
  );
  await asUser(a, () =>
    db.query("UPDATE public.profiles SET display_name='Renamed' WHERE id=$1", [a]),
  );
  const ownedBulk = (
    await db.query("SELECT id FROM public.bulk_profiles WHERE owner_id=$1 LIMIT 1", [a])
  ).rows[0].id;
  await asUser(a, () =>
    db.query("UPDATE public.bulk_profiles SET allow_editor=false WHERE id=$1", [ownedBulk]),
  );
  assert.equal(
    (await db.query("SELECT count(*) AS n FROM public.challenge_notification_events")).rows[0].n,
    before,
  );
});
let payment;
test("evidence cleanup is queued only for successfully finalized weeks", async () => {
  const retentionChallenge = await freshChallenge("Evidence retention");
  const activityId = (await activity(a, 5, retentionChallenge)).rows[0].id;
  const storageObjectId = randomUUID();
  await db.query("INSERT INTO storage.objects(id,bucket_id,name) VALUES ($1,$2,$3)", [
    storageObjectId,
    "challenge-evidence",
    `${retentionChallenge}/${a}/current-week.webp`,
  ]);
  const clientDeletion = await asUser(a, () =>
    db.query("DELETE FROM storage.objects WHERE id=$1 RETURNING id", [storageObjectId]),
  );
  assert.equal(clientDeletion.rows.length, 0);
  assert.equal(
    Number(
      (await db.query("SELECT count(*) AS n FROM storage.objects WHERE id=$1", [storageObjectId]))
        .rows[0].n,
    ),
    1,
  );

  assert.equal(
    Number(
      (
        await db.query(
          "SELECT count(*) AS n FROM public.challenge_evidence_cleanup WHERE activity_id=$1",
          [activityId],
        )
      ).rows[0].n,
    ),
    0,
  );

  await db.query("UPDATE public.challenges SET start_date=CURRENT_DATE-7 WHERE id=$1", [
    retentionChallenge,
  ]);
  await db.exec(
    "ALTER TABLE public.challenge_activities DISABLE TRIGGER challenge_activities_guard",
  );
  await db.query(
    "UPDATE public.challenge_activities SET activity_date=CURRENT_DATE-7 WHERE id=$1",
    [activityId],
  );
  await db.exec(
    "ALTER TABLE public.challenge_activities ENABLE TRIGGER challenge_activities_guard",
  );
  const currentActivityId = (await activity(a, 2, retentionChallenge)).rows[0].id;

  await assert.rejects(
    db.query("SELECT public.finalize_challenge($1,$2)", [c, retentionChallenge]),
    /Not a member/,
  );
  assert.equal(
    Number(
      (
        await db.query(
          "SELECT count(*) AS n FROM public.challenge_evidence_cleanup WHERE activity_id=$1",
          [activityId],
        )
      ).rows[0].n,
    ),
    0,
  );

  await db.query("SELECT public.finalize_challenge($1,$2)", [a, retentionChallenge]);
  await db.query("SELECT public.finalize_challenge($1,$2)", [a, retentionChallenge]);
  const queued = await db.query(
    "SELECT status,storage_paths FROM public.challenge_evidence_cleanup WHERE activity_id=$1",
    [activityId],
  );
  assert.equal(queued.rows.length, 1);
  assert.equal(queued.rows[0].status, "pending");
  assert.deepEqual(queued.rows[0].storage_paths, ["private-test-evidence"]);
  assert.equal(
    Number(
      (
        await db.query(
          "SELECT count(*) AS n FROM public.challenge_evidence_cleanup WHERE activity_id=$1",
          [currentActivityId],
        )
      ).rows[0].n,
    ),
    0,
  );
  assert.equal(
    Number(
      (
        await db.query("SELECT count(*) AS n FROM public.challenge_activities WHERE id=$1", [
          activityId,
        ])
      ).rows[0].n,
    ),
    1,
  );
  await assert.rejects(
    asUser(a, () =>
      db.query("SELECT * FROM public.challenge_evidence_cleanup WHERE activity_id=$1", [
        activityId,
      ]),
    ),
    /permission denied/,
  );

  await assert.rejects(
    asUser(a, () =>
      db.query("SELECT * FROM public.claim_challenge_evidence_cleanup($1, $2)", [
        retentionChallenge,
        50,
      ]),
    ),
    /permission denied/,
  );

  const firstClaim = await asService(() =>
    db.query("SELECT * FROM public.claim_challenge_evidence_cleanup($1, $2)", [
      retentionChallenge,
      50,
    ]),
  );
  assert.equal(firstClaim.rows.length, 1);
  assert.equal(firstClaim.rows[0].activity_id, activityId);
  assert.equal(firstClaim.rows[0].attempts, 1);

  const overlappingClaim = await asService(() =>
    db.query("SELECT * FROM public.claim_challenge_evidence_cleanup($1, $2)", [
      retentionChallenge,
      50,
    ]),
  );
  assert.equal(overlappingClaim.rows.length, 0);

  assert.equal(
    (
      await asService(() =>
        db.query("SELECT public.finish_challenge_evidence_cleanup($1,$2,false) AS finished", [
          activityId,
          firstClaim.rows[0].lease_token,
        ]),
      )
    ).rows[0].finished,
    true,
  );
  const failed = await db.query(
    `SELECT status,attempts,
      next_attempt_at BETWEEN now() + interval '55 seconds' AND now() + interval '65 seconds'
        AS waits_for_first_backoff
     FROM public.challenge_evidence_cleanup WHERE activity_id=$1`,
    [activityId],
  );
  assert.deepEqual(failed.rows[0], {
    status: "failed",
    attempts: 1,
    waits_for_first_backoff: true,
  });

  const futureRetry = await asService(() =>
    db.query("SELECT * FROM public.claim_challenge_evidence_cleanup($1, $2)", [
      retentionChallenge,
      50,
    ]),
  );
  assert.equal(futureRetry.rows.length, 0);

  await db.query(
    "UPDATE public.challenge_evidence_cleanup SET next_attempt_at=now()-interval '1 second' WHERE activity_id=$1",
    [activityId],
  );
  const retryClaim = await asService(() =>
    db.query("SELECT * FROM public.claim_challenge_evidence_cleanup($1, $2)", [
      retentionChallenge,
      50,
    ]),
  );
  assert.equal(retryClaim.rows.length, 1);
  assert.equal(retryClaim.rows[0].attempts, 2);
  assert.notEqual(retryClaim.rows[0].lease_token, firstClaim.rows[0].lease_token);
  assert.equal(
    (
      await asService(() =>
        db.query("SELECT public.finish_challenge_evidence_cleanup($1,$2,true) AS finished", [
          activityId,
          retryClaim.rows[0].lease_token,
        ]),
      )
    ).rows[0].finished,
    true,
  );
  assert.equal(
    (
      await db.query("SELECT status FROM public.challenge_evidence_cleanup WHERE activity_id=$1", [
        activityId,
      ])
    ).rows[0].status,
    "completed",
  );
  assert.equal(
    (
      await asService(() =>
        db.query("SELECT * FROM public.claim_challenge_evidence_cleanup($1, $2)", [
          retentionChallenge,
          50,
        ]),
      )
    ).rows.length,
    0,
  );

  // Even a server-created bad queue row cannot make an open week eligible.
  await db.query(
    "INSERT INTO public.challenge_evidence_cleanup(activity_id,challenge_id,storage_paths) VALUES ($1,$2,$3)",
    [currentActivityId, retentionChallenge, [`${retentionChallenge}/${a}/open.webp`]],
  );
  assert.equal(
    (
      await asService(() =>
        db.query("SELECT * FROM public.claim_challenge_evidence_cleanup($1, $2)", [
          retentionChallenge,
          50,
        ]),
      )
    ).rows.length,
    0,
  );
  assert.equal(
    Number(
      (
        await db.query(
          "SELECT count(*) AS n FROM public.challenge_activities WHERE id IN ($1,$2)",
          [activityId, currentActivityId],
        )
      ).rows[0].n,
    ),
    2,
  );
  assert.equal(
    Number(
      (
        await db.query(
          "SELECT count(*) AS n FROM public.challenge_weeks WHERE challenge_id=$1 AND user_id=$2",
          [retentionChallenge, a],
        )
      ).rows[0].n,
    ),
    1,
  );
});
test("finalization uses stored target-relative penalty amounts without rewriting history", async () => {
  const challenge = randomUUID();
  await db.query(
    `INSERT INTO public.challenges(
      id,created_by,name,start_date,timezone,weekly_target_km,
      penalty_high_eur,penalty_medium_eur,penalty_low_eur
    ) VALUES ($1,$2,'Custom finalization',CURRENT_DATE,'UTC',30,60,35,10)`,
    [challenge, a],
  );
  await db.query(
    "INSERT INTO public.challenge_members(challenge_id,user_id) VALUES ($1,$2),($1,$3)",
    [challenge, a, b],
  );
  await activity(a, 12, challenge);
  await db.query("UPDATE public.challenges SET start_date=CURRENT_DATE-7 WHERE id=$1", [challenge]);
  await db.exec(
    "ALTER TABLE public.challenge_activities DISABLE TRIGGER challenge_activities_guard",
  );
  await db.query(
    "UPDATE public.challenge_activities SET activity_date=CURRENT_DATE-7 WHERE challenge_id=$1",
    [challenge],
  );
  await db.exec(
    "ALTER TABLE public.challenge_activities ENABLE TRIGGER challenge_activities_guard",
  );
  await db.query("SELECT public.finalize_challenge($1,$2)", [a, challenge]);
  const weeks = await db.query(
    "SELECT user_id,target_km,equivalent_km,penalty_eur FROM public.challenge_weeks WHERE challenge_id=$1 ORDER BY user_id",
    [challenge],
  );
  const mine = weeks.rows.find((row) => row.user_id === a);
  const opponent = weeks.rows.find((row) => row.user_id === b);
  assert.deepEqual(
    {
      target: Number(mine.target_km),
      equivalent: Number(mine.equivalent_km),
      penalty: Number(mine.penalty_eur),
    },
    { target: 30, equivalent: 12, penalty: 35 },
  );
  assert.equal(Number(opponent.penalty_eur), 60);
  assert.deepEqual(
    (
      await db.query("SELECT amount_eur FROM public.challenge_payments WHERE challenge_id=$1", [
        challenge,
      ])
    ).rows
      .map((row) => Number(row.amount_eur))
      .sort((left, right) => left - right),
    [35, 60],
  );
  await assert.rejects(
    db.query("UPDATE public.challenge_weeks SET penalty_eur=0 WHERE challenge_id=$1", [challenge]),
    /immutable/,
  );
});

test("custom finalization snapshots every band and creates no money payments", async () => {
  const cases = [
    { km: 3, band: "high", consequence: "Send 3 photos" },
    { km: 12, band: "medium", consequence: "Buy dinner" },
    { km: 25, band: "low", consequence: "Make breakfast" },
    { km: 30, band: null, consequence: null },
  ];
  for (const expected of cases) {
    const challenge = randomUUID();
    await db.query(
      `INSERT INTO public.challenges(
        id,created_by,name,start_date,timezone,weekly_target_km,penalty_mode,
        penalty_high_custom,penalty_medium_custom,penalty_low_custom
      ) VALUES ($1,$2,'Custom consequences',CURRENT_DATE,'UTC',30,'custom',$3,$4,$5)`,
      [challenge, a, "Send 3 photos", "Buy dinner", "Make breakfast"],
    );
    await db.query(
      "INSERT INTO public.challenge_members(challenge_id,user_id) VALUES ($1,$2),($1,$3)",
      [challenge, a, b],
    );
    await activity(a, expected.km, challenge);
    await db.query("UPDATE public.challenges SET start_date=CURRENT_DATE-7 WHERE id=$1", [
      challenge,
    ]);
    await db.exec(
      "ALTER TABLE public.challenge_activities DISABLE TRIGGER challenge_activities_guard",
    );
    await db.query(
      "UPDATE public.challenge_activities SET activity_date=CURRENT_DATE-7 WHERE challenge_id=$1",
      [challenge],
    );
    await db.exec(
      "ALTER TABLE public.challenge_activities ENABLE TRIGGER challenge_activities_guard",
    );
    await db.query("SELECT public.finalize_challenge($1,$2)", [a, challenge]);
    const week = (
      await db.query(
        `SELECT target_km,penalty_eur,penalty_mode,penalty_band,penalty_consequence
         FROM public.challenge_weeks WHERE challenge_id=$1 AND user_id=$2`,
        [challenge, a],
      )
    ).rows[0];
    assert.deepEqual(
      {
        target: Number(week.target_km),
        euros: Number(week.penalty_eur),
        mode: week.penalty_mode,
        band: week.penalty_band,
        consequence: week.penalty_consequence,
      },
      {
        target: 30,
        euros: 0,
        mode: "custom",
        band: expected.band,
        consequence: expected.consequence,
      },
    );
    assert.equal(
      Number(
        (
          await db.query(
            "SELECT count(*) AS n FROM public.challenge_payments WHERE challenge_id=$1",
            [challenge],
          )
        ).rows[0].n,
      ),
      0,
    );
  }
});

test("travel pause suppresses a custom consequence and money payment", async () => {
  const challenge = randomUUID();
  await db.query(
    `INSERT INTO public.challenges(
      id,created_by,name,start_date,timezone,weekly_target_km,penalty_mode,
      penalty_high_custom,penalty_medium_custom,penalty_low_custom
    ) VALUES ($1,$2,'Paused custom',CURRENT_DATE,'UTC',30,'custom','High','Medium','Low')`,
    [challenge, a],
  );
  await db.query(
    "INSERT INTO public.challenge_members(challenge_id,user_id) VALUES ($1,$2),($1,$3)",
    [challenge, a, b],
  );
  await asUser(a, () =>
    db.query(
      "INSERT INTO public.challenge_travel_pauses(challenge_id,user_id,week_number,country) VALUES ($1,$2,1,'IT')",
      [challenge, a],
    ),
  );
  await db.query("UPDATE public.challenges SET start_date=CURRENT_DATE-7 WHERE id=$1", [challenge]);
  await db.query("SELECT public.finalize_challenge($1,$2)", [a, challenge]);
  const week = (
    await db.query(
      `SELECT target_km,penalty_eur,penalty_band,penalty_consequence,paused
       FROM public.challenge_weeks WHERE challenge_id=$1 AND user_id=$2`,
      [challenge, a],
    )
  ).rows[0];
  assert.deepEqual(
    {
      target: Number(week.target_km),
      euros: Number(week.penalty_eur),
      band: week.penalty_band,
      consequence: week.penalty_consequence,
      paused: week.paused,
    },
    { target: 0, euros: 0, band: null, consequence: null, paused: true },
  );
  assert.equal(
    Number(
      (
        await db.query(
          "SELECT count(*) AS n FROM public.challenge_payments WHERE challenge_id=$1",
          [challenge],
        )
      ).rows[0].n,
    ),
    0,
  );
});
test("real finalization creates exactly one €5 penalty event, including repeated calls", async () => {
  // Fixture a closed week through the service role without altering production guards.
  const past = randomUUID();
  await db.query(
    "INSERT INTO public.challenges(id,created_by,name,start_date,timezone) VALUES ($1,$2,'Closed week',CURRENT_DATE-7,'UTC')",
    [past, a],
  );
  await db.query(
    "INSERT INTO public.challenge_members(challenge_id,user_id) VALUES ($1,$2),($1,$3)",
    [past, a, b],
  );
  // Insert while that week is open, then advance the challenge's start date.
  await db.query("UPDATE public.challenges SET start_date=CURRENT_DATE WHERE id=$1", [past]);
  await activity(a, 10, past);
  await db.query("UPDATE public.challenges SET start_date=CURRENT_DATE-7 WHERE id=$1", [past]);
  await db.exec(
    "ALTER TABLE public.challenge_activities DISABLE TRIGGER challenge_activities_guard",
  );
  await db.query(
    "UPDATE public.challenge_activities SET activity_date=CURRENT_DATE-7 WHERE challenge_id=$1",
    [past],
  );
  await db.exec(
    "ALTER TABLE public.challenge_activities ENABLE TRIGGER challenge_activities_guard",
  );
  await db.query("SELECT public.finalize_challenge($1,$2)", [a, past]);
  await db.query("SELECT public.finalize_challenge($1,$2)", [b, past]);
  const penalties = await db.query(
    "SELECT facts FROM public.challenge_notification_events WHERE challenge_id=$1 AND actor_id=$2 AND kind='week_penalty'",
    [past, a],
  );
  assert.equal(penalties.rows.length, 1);
  assert.equal(penalties.rows[0].facts.amount_eur, 5);
  payment = (
    await db.query(
      "SELECT id FROM public.challenge_payments WHERE challenge_id=$1 AND payer_id=$2",
      [past, a],
    )
  ).rows[0].id;
});
test("only unpaid → marked_paid notifies, once per obligation despite toggle/retry", async () => {
  await asUser(a, () =>
    db.query("UPDATE public.challenge_payments SET status='marked_paid' WHERE id=$1", [payment]),
  );
  await asUser(a, () =>
    db.query("UPDATE public.challenge_payments SET status='marked_paid' WHERE id=$1", [payment]),
  );
  await asUser(a, () =>
    db.query("UPDATE public.challenge_payments SET status='unpaid' WHERE id=$1", [payment]),
  );
  await asUser(a, () =>
    db.query("UPDATE public.challenge_payments SET status='marked_paid' WHERE id=$1", [payment]),
  );
  await asUser(b, () =>
    db.query("UPDATE public.challenge_payments SET status='confirmed_paid' WHERE id=$1", [payment]),
  );
  assert.equal(
    (
      await db.query(
        "SELECT count(*) AS n FROM public.challenge_notification_events WHERE dedupe_key=$1",
        [`payment:${payment}`],
      )
    ).rows[0].n,
    1,
  );
});
test("own subscription reads/deletes only; device forgery/identity edits/outbox injection denied", async () => {
  for (const uid of [a, b]) {
    await db.query("INSERT INTO public.challenge_push_users(user_id,enabled) VALUES ($1,true)", [
      uid,
    ]);
    await db.query(
      "INSERT INTO public.push_subscriptions(user_id,subscription_id) VALUES ($1,$2)",
      [uid, randomUUID()],
    );
  }
  assert.equal(
    (await asUser(a, () => db.exec("SELECT * FROM public.push_subscriptions")))[0].rows.length,
    1,
  );
  assert.equal(
    (await asUser(a, () => db.exec("SELECT * FROM public.challenge_push_users")))[0].rows.length,
    1,
  );
  await assert.rejects(
    asUser(a, () =>
      db.query("INSERT INTO public.push_subscriptions(user_id,subscription_id) VALUES ($1,$2)", [
        a,
        randomUUID(),
      ]),
    ),
    /permission denied/,
  );
  await assert.rejects(
    asUser(a, () => db.exec("UPDATE public.challenge_push_users SET external_id='forged'")),
    /permission denied/,
  );
  await assert.rejects(
    asUser(a, () => db.exec("INSERT INTO public.challenge_notification_events DEFAULT VALUES")),
    /permission denied/,
  );
  await assert.rejects(
    asUser(a, () => db.query("SELECT public.disable_challenge_push($1)", [a])),
    /permission denied/,
  );
  await assert.rejects(
    asAnon(() => db.query("SELECT public.disable_challenge_push($1)", [a])),
    /permission denied/,
  );
  await assert.rejects(
    asUser(a, () => db.query("SELECT private.disable_challenge_push($1)", [a])),
    /permission denied/,
  );
  await assert.rejects(
    asAnon(() => db.query("SELECT private.disable_challenge_push($1)", [a])),
    /permission denied/,
  );
  await asService(() => db.query("SELECT public.disable_challenge_push($1)", [a]));
  assert.equal(
    (await db.query("SELECT enabled FROM public.challenge_push_users WHERE user_id=$1", [a]))
      .rows[0].enabled,
    false,
  );
  assert.equal(
    (await db.query("SELECT enabled FROM public.challenge_push_users WHERE user_id=$1", [b]))
      .rows[0].enabled,
    true,
  );
  await asUser(a, () => db.query("DELETE FROM public.push_subscriptions WHERE user_id=$1", [b]));
  assert.equal(
    (await db.query("SELECT count(*) AS n FROM public.push_subscriptions WHERE user_id=$1", [b]))
      .rows[0].n,
    1,
  );
});
test("server registration respects account opt-out, rejects forged identity, and cannot be invoked by clients", async () => {
  const external = (
    await db.query("SELECT external_id FROM public.challenge_push_users WHERE user_id=$1", [a])
  ).rows[0].external_id;
  const id = randomUUID();
  const register = (active, identity = external) =>
    db.query("SELECT public.register_challenge_push_device($1,$2,$3,$4) AS enabled", [
      a,
      id,
      identity,
      active,
    ]);
  await assert.rejects(
    asUser(a, () => register(true)),
    /permission denied/,
  );
  for (const args of [
    [null, id, external, true],
    [a, null, external, true],
    [a, id, null, true],
    [a, id, "   ", true],
    [a, id, external, null],
  ]) {
    assert.equal(
      (await db.query("SELECT public.register_challenge_push_device($1,$2,$3,$4) AS enabled", args))
        .rows[0].enabled,
      false,
    );
  }
  assert.equal((await register(true, "forged")).rows[0].enabled, false);
  assert.equal((await register(false)).rows[0].enabled, false);
  assert.equal((await register(true)).rows[0].enabled, true);
  assert.equal(
    (await db.query("SELECT enabled FROM public.challenge_push_users WHERE user_id=$1", [a]))
      .rows[0].enabled,
    true,
  );
  await asService(() => db.query("SELECT public.disable_challenge_push($1)", [a]));
  assert.equal((await register(false)).rows[0].enabled, false);
  assert.equal(
    (await db.query("SELECT enabled FROM public.challenge_push_users WHERE user_id=$1", [a]))
      .rows[0].enabled,
    false,
  );
  assert.equal(
    (
      await db.query("SELECT is_active FROM public.push_subscriptions WHERE subscription_id=$1", [
        id,
      ])
    ).rows[0].is_active,
    false,
  );
  assert.equal((await register(true)).rows[0].enabled, true);
  assert.equal(
    (await db.query("SELECT enabled FROM public.challenge_push_users WHERE user_id=$1", [a]))
      .rows[0].enabled,
    true,
  );
});
test("verified background registration restores detached devices and transfers account ownership safely", async () => {
  const identities = await db.query(
    "SELECT user_id, external_id FROM public.challenge_push_users WHERE user_id IN ($1,$2)",
    [a, b],
  );
  const external = new Map(identities.rows.map((row) => [row.user_id, row.external_id]));
  const id = randomUUID();
  await db.query("UPDATE public.challenge_push_users SET enabled=true WHERE user_id IN ($1,$2)", [
    a,
    b,
  ]);
  assert.equal(
    (
      await db.query("SELECT public.register_challenge_push_device($1,$2,$3,true) AS enabled", [
        a,
        id,
        external.get(a),
      ])
    ).rows[0].enabled,
    true,
  );
  await db.query("UPDATE public.push_subscriptions SET is_active=false WHERE subscription_id=$1", [
    id,
  ]);
  assert.equal(
    (
      await db.query("SELECT public.register_challenge_push_device($1,$2,$3,false) AS enabled", [
        a,
        id,
        external.get(a),
      ])
    ).rows[0].enabled,
    true,
  );
  assert.equal(
    (
      await db.query("SELECT public.register_challenge_push_device($1,$2,$3,false) AS enabled", [
        b,
        id,
        external.get(b),
      ])
    ).rows[0].enabled,
    true,
  );
  assert.deepEqual(
    (
      await db.query(
        "SELECT user_id, is_active FROM public.push_subscriptions WHERE subscription_id=$1",
        [id],
      )
    ).rows[0],
    { user_id: b, is_active: true },
  );
  await asService(() => db.query("SELECT public.disable_challenge_push($1)", [b]));
  assert.equal(
    (
      await db.query("SELECT public.register_challenge_push_device($1,$2,$3,false) AS enabled", [
        b,
        id,
        external.get(b),
      ])
    ).rows[0].enabled,
    false,
  );
});
test("rollback leaves no event and clients cannot directly override a weekly target", async () => {
  const beforeCount = (
    await db.query("SELECT count(*) AS n FROM public.challenge_notification_events")
  ).rows[0].n;
  await asUser(a, async () => {
    await db.exec("BEGIN");
    try {
      await db.query(
        "INSERT INTO public.challenge_activities(challenge_id,user_id,activity_type,distance_km,duration_seconds,activity_date,evidence_path) VALUES ($1,$2,'run',1,360,CURRENT_DATE,'test')",
        [x, a],
      );
    } finally {
      await db.exec("ROLLBACK");
    }
  });
  assert.equal(
    (await db.query("SELECT count(*) AS n FROM public.challenge_notification_events")).rows[0].n,
    beforeCount,
  );
  const custom = randomUUID();
  await db.query(
    "INSERT INTO public.challenges(id,created_by,name,start_date,timezone) VALUES ($1,$2,'Override',CURRENT_DATE,'UTC')",
    [custom, a],
  );
  await db.query(
    "INSERT INTO public.challenge_members(challenge_id,user_id) VALUES ($1,$2),($1,$3)",
    [custom, a, b],
  );
  await assert.rejects(
    asUser(a, () =>
      db.query(
        "INSERT INTO public.challenge_week_targets(challenge_id,week_number,target_km,set_by) VALUES ($1,2,30,$2)",
        [custom, a],
      ),
    ),
    /permission denied/,
  );
  await db.query("UPDATE public.challenges SET start_date=CURRENT_DATE-7 WHERE id=$1", [custom]);
  await activity(a, 15, custom);
  const result = (
    await db.query(
      "SELECT facts FROM public.challenge_notification_events WHERE challenge_id=$1 AND kind='target_reached'",
      [custom],
    )
  ).rows;
  assert.equal(result.length, 1);
  assert.equal(result[0].facts.target_km, 15);
});

test("future target overrides are creator-only, server-mediated and snapshotted at finalization", async () => {
  const challenge = await freshChallenge("Future targets");

  await assert.rejects(
    asUser(a, () =>
      db.query("SELECT public.set_challenge_week_target($1,$2,2,30)", [a, challenge]),
    ),
    /permission denied/i,
  );
  await assert.rejects(
    asAnon(() => db.query("SELECT public.set_challenge_week_target($1,$2,2,30)", [a, challenge])),
    /permission denied/i,
  );
  await assert.rejects(
    asService(() =>
      db.query("SELECT public.set_challenge_week_target($1,$2,2,30)", [b, challenge]),
    ),
    /Only the challenge creator/i,
  );
  await assert.rejects(
    asService(() =>
      db.query("SELECT public.set_challenge_week_target($1,$2,1,30)", [a, challenge]),
    ),
    /Only future week targets/i,
  );
  for (const invalidTarget of [0, 500.01, 20.123]) {
    await assert.rejects(
      asService(() =>
        db.query("SELECT public.set_challenge_week_target($1,$2,2,$3)", [
          a,
          challenge,
          invalidTarget,
        ]),
      ),
      /Weekly target must be between 1 and 500 km with at most 2 decimals/i,
    );
  }

  assert.equal(
    Number(
      (
        await asService(() =>
          db.query("SELECT public.set_challenge_week_target($1,$2,2,30.25) AS target_km", [
            a,
            challenge,
          ]),
        )
      ).rows[0].target_km,
    ),
    30.25,
  );
  assert.equal(
    Number(
      (
        await asUser(b, () =>
          db.query(
            "SELECT target_km FROM public.challenge_week_targets WHERE challenge_id=$1 AND week_number=2",
            [challenge],
          ),
        )
      ).rows[0].target_km,
    ),
    30.25,
  );
  assert.equal(
    (
      await asUser(c, () =>
        db.query("SELECT * FROM public.challenge_week_targets WHERE challenge_id=$1", [challenge]),
      )
    ).rows.length,
    0,
  );

  await activity(a, 12, challenge);
  await db.query("UPDATE public.challenges SET start_date=CURRENT_DATE-14 WHERE id=$1", [
    challenge,
  ]);
  await db.exec(
    "ALTER TABLE public.challenge_activities DISABLE TRIGGER challenge_activities_guard",
  );
  await db.query(
    "UPDATE public.challenge_activities SET activity_date=CURRENT_DATE-7 WHERE challenge_id=$1",
    [challenge],
  );
  await db.exec(
    "ALTER TABLE public.challenge_activities ENABLE TRIGGER challenge_activities_guard",
  );
  await db.query("SELECT public.finalize_challenge($1,$2)", [a, challenge]);

  const finalized = (
    await db.query(
      `SELECT target_km,equivalent_km,penalty_eur
       FROM public.challenge_weeks
       WHERE challenge_id=$1 AND user_id=$2 AND week_number=2`,
      [challenge, a],
    )
  ).rows[0];
  assert.deepEqual(
    {
      target: Number(finalized.target_km),
      equivalent: Number(finalized.equivalent_km),
      penalty: Number(finalized.penalty_eur),
    },
    { target: 30.25, equivalent: 12, penalty: 10 },
  );
  await assert.rejects(
    asService(() =>
      db.query("SELECT public.set_challenge_week_target($1,$2,2,40)", [a, challenge]),
    ),
    /Only future week targets|Finalized week targets/i,
  );
});

test("resetting a future target restores the base target and travel pause still resolves to zero", async () => {
  const challenge = await freshChallenge("Resolved targets");
  await asService(() =>
    db.query("SELECT public.set_challenge_week_target($1,$2,2,25)", [a, challenge]),
  );
  assert.equal(
    Number(
      (
        await asService(() =>
          db.query("SELECT private.target_for_week($1,2,$2) AS target_km", [challenge, a]),
        )
      ).rows[0].target_km,
    ),
    25,
  );
  await asUser(a, () =>
    db.query(
      "INSERT INTO public.challenge_travel_pauses(challenge_id,user_id,week_number,country) VALUES ($1,$2,2,'IT')",
      [challenge, a],
    ),
  );
  assert.equal(
    Number(
      (
        await asService(() =>
          db.query("SELECT private.target_for_week($1,2,$2) AS target_km", [challenge, a]),
        )
      ).rows[0].target_km,
    ),
    0,
  );
  assert.equal(
    Number(
      (
        await asService(() =>
          db.query("SELECT public.set_challenge_week_target($1,$2,2,NULL) AS target_km", [
            a,
            challenge,
          ]),
        )
      ).rows[0].target_km,
    ),
    15,
  );
  assert.equal(
    (
      await db.query(
        "SELECT count(*) AS n FROM public.challenge_week_targets WHERE challenge_id=$1",
        [challenge],
      )
    ).rows[0].n,
    0,
  );
});

test("target-reached push facts use the resolved weekly override", async () => {
  const challenge = await freshChallenge("Override push");
  await asService(() =>
    db.query("SELECT public.set_challenge_week_target($1,$2,2,24)", [a, challenge]),
  );
  await db.query("UPDATE public.challenges SET start_date=CURRENT_DATE-7 WHERE id=$1", [challenge]);
  await activity(a, 24, challenge);
  const events = (
    await db.query(
      "SELECT facts FROM public.challenge_notification_events WHERE challenge_id=$1 AND kind='target_reached'",
      [challenge],
    )
  ).rows;
  assert.equal(events.length, 1);
  assert.equal(Number(events[0].facts.target_km), 24);
});

test("a creator who left cannot change future targets", async () => {
  const challenge = await freshChallenge("Former creator target");
  await db.query("DELETE FROM public.challenge_members WHERE challenge_id=$1 AND user_id=$2", [
    challenge,
    a,
  ]);
  await assert.rejects(
    asService(() =>
      db.query("SELECT public.set_challenge_week_target($1,$2,2,20)", [a, challenge]),
    ),
    /Active challenge membership required/i,
  );
});
test("a multi-row insert crossing the target emits exactly one completion", async () => {
  const batch = randomUUID();
  await db.query(
    "INSERT INTO public.challenges(id,created_by,name,start_date,timezone) VALUES ($1,$2,'Batch',CURRENT_DATE,'UTC')",
    [batch, a],
  );
  await db.query(
    "INSERT INTO public.challenge_members(challenge_id,user_id) VALUES ($1,$2),($1,$3)",
    [batch, a, b],
  );
  await asUser(a, () =>
    db.query(
      "INSERT INTO public.challenge_activities(challenge_id,user_id,activity_type,distance_km,duration_seconds,activity_date,evidence_path) VALUES ($1,$2,'run',15,5400,CURRENT_DATE,'test'),($1,$2,'run',15,5400,CURRENT_DATE,'test')",
      [batch, a],
    ),
  );
  const kinds = (
    await db.query("SELECT kind FROM public.challenge_notification_events WHERE challenge_id=$1", [
      batch,
    ])
  ).rows.map((r) => r.kind);
  assert.equal(kinds.filter((k) => k === "activity_posted").length, 2);
  assert.equal(kinds.filter((k) => k === "target_reached").length, 1);
});
test("an outside-country pause is private to its owner and makes only their week penalty-free", async () => {
  const challenge = await freshChallenge("Travel pause");
  await activity(a, 1, challenge);
  const pause = await asUser(a, () =>
    db.query(
      "INSERT INTO public.challenge_travel_pauses(challenge_id,user_id,week_number,country) VALUES ($1,$2,1,'IT') RETURNING id",
      [challenge, a],
    ),
  );
  assert.equal(pause.rows.length, 1);
  await assert.rejects(
    asUser(b, () =>
      db.query(
        "INSERT INTO public.challenge_travel_pauses(challenge_id,user_id,week_number,country) VALUES ($1,$2,1,'FR')",
        [challenge, a],
      ),
    ),
    /row-level security|manage your own/,
  );
  assert.equal(
    (
      await asUser(b, () =>
        db.query("SELECT count(*) AS n FROM public.challenge_travel_pauses WHERE challenge_id=$1", [
          challenge,
        ]),
      )
    ).rows[0].n,
    1,
  );
  assert.equal(
    (
      await asUser(c, () =>
        db.query("SELECT count(*) AS n FROM public.challenge_travel_pauses WHERE challenge_id=$1", [
          challenge,
        ]),
      )
    ).rows[0].n,
    0,
  );
  await assert.rejects(
    asUser(a, () =>
      db.query(
        "INSERT INTO public.challenge_travel_pauses(challenge_id,user_id,week_number,country) VALUES ($1,$2,2,'SE')",
        [challenge, a],
      ),
    ),
    /only allowed outside/,
  );
  await db.query("UPDATE public.challenges SET start_date=CURRENT_DATE-7 WHERE id=$1", [challenge]);
  await db.exec(
    "ALTER TABLE public.challenge_activities DISABLE TRIGGER challenge_activities_guard",
  );
  await db.query(
    "UPDATE public.challenge_activities SET activity_date=CURRENT_DATE-7 WHERE challenge_id=$1",
    [challenge],
  );
  await db.exec(
    "ALTER TABLE public.challenge_activities ENABLE TRIGGER challenge_activities_guard",
  );
  await db.query("SELECT public.finalize_challenge($1,$2)", [a, challenge]);
  const finalized = await db.query(
    "SELECT user_id,paused,pause_country,target_km,penalty_eur FROM public.challenge_weeks WHERE challenge_id=$1 ORDER BY user_id",
    [challenge],
  );
  const mine = finalized.rows.find((row) => row.user_id === a);
  const opponent = finalized.rows.find((row) => row.user_id === b);
  assert.deepEqual(
    {
      paused: mine.paused,
      country: mine.pause_country,
      target: Number(mine.target_km),
      penalty: Number(mine.penalty_eur),
    },
    { paused: true, country: "IT", target: 0, penalty: 0 },
  );
  assert.deepEqual(
    {
      paused: opponent.paused,
      target: Number(opponent.target_km),
      penalty: Number(opponent.penalty_eur),
    },
    { paused: false, target: 15, penalty: 15 },
  );
  await db.query(
    "UPDATE public.challenges SET start_date=date_trunc('week',CURRENT_DATE)::date WHERE id=$1",
    [challenge],
  );
  await assert.rejects(
    asUser(a, () =>
      db.query("DELETE FROM public.challenge_travel_pauses WHERE id=$1", [pause.rows[0].id]),
    ),
    /Finalized travel pauses cannot be changed/,
  );
});
test("outbox claim leases prevent duplicate workers; expired leases retry, stale events expire", async () => {
  const first = (await db.query("SELECT * FROM public.claim_challenge_push_events()")).rows;
  const second = (await db.query("SELECT * FROM public.claim_challenge_push_events()")).rows;
  assert.ok(first.length > 0);
  assert.ok(first.every((e) => !second.some((other) => other.id === e.id)));
  const chosen = first[0];
  await db.query(
    "UPDATE public.challenge_notification_events SET lease_until=now()-interval '1 minute' WHERE id=$1",
    [chosen.id],
  );
  const retry = (await db.query("SELECT * FROM public.claim_challenge_push_events()")).rows.find(
    (e) => e.id === chosen.id,
  );
  assert.equal(retry.attempts, 2);
  assert.notEqual(retry.lease_token, chosen.lease_token);
  await db.query(
    "UPDATE public.challenge_notification_events SET lease_until=NULL,created_at=now()-interval '2 days' WHERE id=$1",
    [chosen.id],
  );
  await db.query("SELECT * FROM public.claim_challenge_push_events()");
  assert.equal(
    (
      await db.query("SELECT status FROM public.challenge_notification_events WHERE id=$1", [
        chosen.id,
      ])
    ).rows[0].status,
    "failed",
  );
});

test("security audit blocks direct cross-user, anon, unsafe-link and legacy function attacks", async () => {
  const owner = randomUUID();
  const attacker = randomUUID();
  for (const [id, email] of [
    [owner, "security-owner@example.com"],
    [attacker, "security-attacker@example.com"],
  ]) {
    await db.query("INSERT INTO auth.users(id) VALUES ($1)", [id]);
    await db.query(
      "INSERT INTO public.profiles(id,email,display_name) VALUES ($1,$2,'Security athlete')",
      [id, email],
    );
    await completeBulkOnboarding(id, { preference: "custom" });
  }
  const ownerBulk = (
    await db.query("SELECT id FROM public.bulk_profiles WHERE owner_id=$1", [owner])
  ).rows[0].id;
  const attackerBulk = (
    await db.query("SELECT id FROM public.bulk_profiles WHERE owner_id=$1", [attacker])
  ).rows[0].id;

  await db.query(
    `INSERT INTO public.bulk_days(bulk_profile_id,day,payload)
     VALUES ($1,CURRENT_DATE,'{"weight":75}')`,
    [ownerBulk],
  );
  await db.query(
    `INSERT INTO public.bulk_workouts(bulk_profile_id,day,payload)
     VALUES ($1,CURRENT_DATE,'{"status":"completed"}')`,
    [ownerBulk],
  );
  await db.query(
    `INSERT INTO public.bulk_week_notes(bulk_profile_id,week_start,note)
     VALUES ($1,date_trunc('week',CURRENT_DATE)::date,'private')`,
    [ownerBulk],
  );
  await db.query(
    `INSERT INTO public.bulk_photos(bulk_profile_id,taken_on,front_path)
     VALUES ($1,CURRENT_DATE,$2)`,
    [ownerBulk, `${ownerBulk}/photo/front.webp`],
  );
  const photoObject = randomUUID();
  await db.query(
    "INSERT INTO storage.objects(id,bucket_id,name) VALUES ($1,'bulk-progress-photos',$2)",
    [photoObject, `${ownerBulk}/photo/front.webp`],
  );
  const customExercise = `custom:${randomUUID()}`;
  await asUser(owner, () =>
    db.query(
      `INSERT INTO public.bulk_exercises(
        id,owner_id,slug,name,primary_muscle,equipment,movement_pattern
      ) VALUES ($1,$2,$3,'Private Row','upper_back',ARRAY['dumbbell'],'horizontal_pull')`,
      [customExercise, owner, `private-row-${owner.slice(0, 8)}`],
    ),
  );
  const ownerPlan = (
    await asUser(owner, () =>
      db.query("SELECT public.create_empty_bulk_training_plan('Security plan') AS id"),
    )
  ).rows[0].id;
  const ownerPlanVersion = (
    await db.query("SELECT updated_at FROM public.bulk_training_plans WHERE id=$1", [ownerPlan])
  ).rows[0].updated_at;
  await asUser(owner, () =>
    db.query("SELECT public.save_bulk_training_plan($1,$2,'Security plan',$3::jsonb)", [
      ownerPlan,
      ownerPlanVersion,
      JSON.stringify([
        {
          name: "Private day",
          exercises: [
            {
              exerciseId: customExercise,
              sets: 3,
              repMin: 8,
              repMax: 12,
              executionMode: "bilateral",
              notes: "private setup",
            },
          ],
        },
      ]),
    ]),
  );
  const ownerDay = (
    await db.query("SELECT id FROM public.bulk_training_plan_days WHERE plan_id=$1", [ownerPlan])
  ).rows[0].id;
  const ownerPlanExercise = (
    await db.query("SELECT id FROM public.bulk_training_plan_exercises WHERE plan_day_id=$1", [
      ownerDay,
    ])
  ).rows[0].id;
  const ownerSession = (
    await asUser(owner, () =>
      db.query("SELECT public.start_bulk_training_session($1) AS id", [ownerDay]),
    )
  ).rows[0].id;
  const ownerSessionExercise = (
    await db.query("SELECT id FROM public.bulk_training_session_exercises WHERE session_id=$1", [
      ownerSession,
    ])
  ).rows[0].id;
  const ownerSet = (
    await db.query(
      "SELECT id FROM public.bulk_training_session_sets WHERE session_exercise_id=$1 LIMIT 1",
      [ownerSessionExercise],
    )
  ).rows[0].id;

  for (const [table, where, value] of [
    ["bulk_profiles", "id", ownerBulk],
    ["bulk_members", "bulk_profile_id", ownerBulk],
    ["bulk_targets", "bulk_profile_id", ownerBulk],
    ["bulk_days", "bulk_profile_id", ownerBulk],
    ["bulk_workouts", "bulk_profile_id", ownerBulk],
    ["bulk_week_notes", "bulk_profile_id", ownerBulk],
    ["bulk_photos", "bulk_profile_id", ownerBulk],
    ["bulk_exercises", "id", customExercise],
    ["bulk_training_plans", "id", ownerPlan],
    ["bulk_training_plan_days", "id", ownerDay],
    ["bulk_training_plan_exercises", "id", ownerPlanExercise],
    ["bulk_training_sessions", "id", ownerSession],
    ["bulk_training_session_exercises", "id", ownerSessionExercise],
    ["bulk_training_session_sets", "id", ownerSet],
  ]) {
    const rows = await asUser(attacker, () =>
      db.query(`SELECT * FROM public.${table} WHERE ${where}=$1`, [value]),
    );
    assert.equal(rows.rows.length, 0, `${table} leaked across accounts`);
  }
  assert.equal(
    (await asUser(attacker, () => db.query("SELECT id FROM public.profiles WHERE id=$1", [owner])))
      .rows.length,
    0,
  );
  assert.equal(
    (
      await asUser(attacker, () =>
        db.query("UPDATE public.bulk_training_plans SET name='Stolen' WHERE id=$1 RETURNING id", [
          ownerPlan,
        ]),
      )
    ).rows.length,
    0,
  );
  assert.equal(
    (
      await asUser(attacker, () =>
        db.query("SELECT id FROM storage.objects WHERE id=$1", [photoObject]),
      )
    ).rows.length,
    0,
  );
  assert.equal(
    (
      await asUser(attacker, () =>
        db.query(
          "UPDATE public.bulk_targets SET payload='{}' WHERE bulk_profile_id=$1 RETURNING bulk_profile_id",
          [ownerBulk],
        ),
      )
    ).rows.length,
    0,
  );
  await assert.rejects(
    asUser(attacker, () =>
      db.query("SELECT public.save_bulk_training_session_set($1,$2,20,10,NULL,NULL,NULL,NULL)", [
        ownerSession,
        ownerSet,
      ]),
    ),
    /not found/i,
  );
  await assert.rejects(
    asUser(attacker, () =>
      db.query("SELECT public.finish_bulk_training_session($1,true)", [ownerSession]),
    ),
    /not found/i,
  );
  await assert.rejects(
    asUser(attacker, () =>
      db.query("SELECT public.discard_bulk_training_session($1)", [ownerSession]),
    ),
    /not found/i,
  );

  const attackerPlan = (
    await asUser(attacker, () =>
      db.query("SELECT public.create_empty_bulk_training_plan('Attacker plan') AS id"),
    )
  ).rows[0].id;
  const attackerPlanVersion = (
    await db.query("SELECT updated_at FROM public.bulk_training_plans WHERE id=$1", [attackerPlan])
  ).rows[0].updated_at;
  await assert.rejects(
    asUser(attacker, () =>
      db.query("SELECT public.save_bulk_training_plan($1,$2,'Attacker plan',$3::jsonb)", [
        attackerPlan,
        attackerPlanVersion,
        JSON.stringify([
          {
            name: "Stolen",
            exercises: [
              {
                exerciseId: customExercise,
                sets: 3,
                repMin: 8,
                repMax: 12,
                executionMode: "bilateral",
                notes: null,
              },
            ],
          },
        ]),
      ]),
    ),
    /unavailable/i,
  );

  assert.equal(
    (await asUser(attacker, () => db.query("SELECT * FROM public.challenges WHERE id=$1", [x])))
      .rows.length,
    0,
  );
  for (const table of [
    "challenge_members",
    "challenge_invitations",
    "challenge_activities",
    "challenge_activity_audit",
    "challenge_weeks",
    "challenge_payments",
    "challenge_travel_pauses",
  ]) {
    const rows = await asUser(attacker, () =>
      db.query(`SELECT * FROM public.${table} WHERE challenge_id=$1`, [x]),
    );
    assert.equal(rows.rows.length, 0, `${table} leaked outside Challenge membership`);
  }
  const challengeObject = randomUUID();
  await db.query(
    "INSERT INTO storage.objects(id,bucket_id,name) VALUES ($1,'challenge-evidence',$2)",
    [challengeObject, `${x}/${a}/evidence.webp`],
  );
  assert.equal(
    (
      await asUser(attacker, () =>
        db.query("SELECT id FROM storage.objects WHERE id=$1", [challengeObject]),
      )
    ).rows.length,
    0,
  );
  await assert.rejects(
    asUser(attacker, () => db.query("SELECT * FROM public.challenge_notification_events")),
    /permission denied/i,
  );
  const privateSubscription = randomUUID();
  await db.query("INSERT INTO public.push_subscriptions(user_id,subscription_id) VALUES ($1,$2)", [
    a,
    privateSubscription,
  ]);
  assert.equal(
    (
      await asUser(attacker, () =>
        db.query("SELECT id FROM public.push_subscriptions WHERE subscription_id=$1", [
          privateSubscription,
        ]),
      )
    ).rows.length,
    0,
  );
  await assert.rejects(
    asUser(attacker, () =>
      db.query(
        "INSERT INTO public.challenge_activities(challenge_id,user_id,activity_type,distance_km,duration_seconds,activity_date,evidence_path) VALUES ($1,$2,'run',1,300,CURRENT_DATE,'forged')",
        [x, attacker],
      ),
    ),
    /row-level security|Not a member/i,
  );

  const invitation = randomUUID();
  await db.query(
    `INSERT INTO public.challenge_invitations(
      id,challenge_id,invited_email,token_hash,expires_at,created_by
    ) VALUES ($1,$2,'private-invite@example.com',$3,now()+interval '1 day',$4)`,
    [invitation, x, createHash("sha256").update(invitation).digest("hex"), a],
  );
  assert.equal(
    (
      await asUser(b, () =>
        db.query(
          "UPDATE public.challenge_invitations SET invited_email='changed@example.com' WHERE id=$1 RETURNING id",
          [invitation],
        ),
      )
    ).rows.length,
    0,
  );
  const related = await asService(() => db.query("SELECT * FROM public.related_profiles($1)", [a]));
  assert.ok(related.rows.length >= 2);
  assert.ok(related.rows.every((profile) => profile.email === null));

  await assert.rejects(
    asUser(a, () =>
      db.query(
        "INSERT INTO public.challenge_activities(challenge_id,user_id,activity_type,distance_km,duration_seconds,activity_date,evidence_path,external_activity_url) VALUES ($1,$2,'run',1,300,CURRENT_DATE,'unsafe-url','javascript:alert(1)')",
        [x, a],
      ),
    ),
    /external_url_security_ck|check constraint/i,
  );

  const publicTables = await db.query(`
    SELECT c.relname
    FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname='public' AND c.relkind='r' AND NOT c.relrowsecurity
  `);
  assert.deepEqual(publicTables.rows, []);
  assert.equal(
    Number(
      (
        await db.query(`
          SELECT count(*) AS n
          FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
          WHERE n.nspname='public' AND c.relkind='r'
            AND has_table_privilege('anon',c.oid,'SELECT,INSERT,UPDATE,DELETE')
        `)
      ).rows[0].n,
    ),
    0,
  );
  await assert.rejects(
    asAnon(() => db.query("SELECT * FROM public.bulk_profiles")),
    /permission denied/i,
  );
  await assert.rejects(
    asAnon(() =>
      db.query(
        "SELECT public.complete_goal_onboarding('gain',70,78,0.25,'beginner',3,ARRAY['dumbbells'],'custom',2900,140,360,90)",
      ),
    ),
    /permission denied/i,
  );
  await assert.rejects(
    asAnon(() => db.query("SELECT * FROM storage.objects")),
    /permission denied/i,
  );

  const unsafeDefiners = await db.query(`
    SELECT n.nspname,p.proname
    FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
    WHERE n.nspname IN ('public','private') AND p.prosecdef
      AND NOT coalesce(p.proconfig,'{}'::text[]) @> ARRAY['search_path=""']
  `);
  assert.deepEqual(unsafeDefiners.rows, []);
  for (const name of ["challenge_today", "challenge_week_of", "challenge_week_open"])
    assert.equal(
      (
        await db.query(
          "SELECT has_function_privilege('authenticated',p.oid,'EXECUTE') AS allowed FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname=$1",
          [name],
        )
      ).rows[0].allowed,
      false,
    );
  assert.equal(
    (
      await db.query(
        "SELECT has_function_privilege('authenticated','public.activate_my_bulk()','EXECUTE') AS allowed",
      )
    ).rows[0].allowed,
    false,
  );
  assert.ok(
    (
      await db.query(
        "SELECT bool_and(NOT public) AS private FROM storage.buckets WHERE id IN ('challenge-evidence','bulk-progress-photos','payment-evidence')",
      )
    ).rows[0].private,
  );
});

test("Goal acknowledgement is writable only on the authenticated user's profile", async () => {
  const own = await asUser(a, () =>
    db.query("UPDATE public.profiles SET goal_seen_at=now() WHERE id=$1 RETURNING goal_seen_at", [
      a,
    ]),
  );
  assert.equal(own.rows.length, 1);

  const forged = await asUser(b, () =>
    db.query("UPDATE public.profiles SET goal_seen_at=now() WHERE id=$1 RETURNING goal_seen_at", [
      a,
    ]),
  );
  assert.equal(forged.rows.length, 0);
  const stored = await asService(() =>
    db.query("SELECT goal_seen_at FROM public.profiles WHERE id=$1", [a]),
  );
  assert.ok(stored.rows[0].goal_seen_at);
});
