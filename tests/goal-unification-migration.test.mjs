import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";

const root = new URL("../supabase/migrations/", import.meta.url);
const migrationName = "20260919130000_unify_goal_and_migrate_legacy_meals.sql";
const nutritionCompatibilityMigrationName =
  "20260922120000_unified_goal_legacy_nutrition_compatibility.sql";

test("Goal unification is retry-safe and migrates only the authoritative legacy cohort", async () => {
  const db = new PGlite();
  try {
    await db.exec(`
      SET TIME ZONE 'UTC';
      CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role BYPASSRLS;
      CREATE SCHEMA auth; CREATE SCHEMA storage; CREATE SCHEMA extensions;
      CREATE TABLE auth.users(id uuid PRIMARY KEY);
      CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$
        SELECT nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
      $$;
      CREATE FUNCTION auth.jwt() RETURNS jsonb LANGUAGE sql STABLE AS $$ SELECT '{}'::jsonb $$;
      CREATE TABLE storage.buckets(id text PRIMARY KEY, public boolean NOT NULL DEFAULT false);
      INSERT INTO storage.buckets(id, public) VALUES
        ('challenge-evidence', true),('bulk-progress-photos', true),('payment-evidence', true);
      CREATE TABLE storage.objects(id uuid PRIMARY KEY, bucket_id text, name text);
      ALTER TABLE storage.objects ENABLE ROW LEVEL SECURITY;
      CREATE FUNCTION storage.foldername(text) RETURNS text[] LANGUAGE sql AS $$
        SELECT string_to_array($1, '/')
      $$;
      GRANT SELECT, INSERT, UPDATE, DELETE ON storage.objects TO authenticated, service_role;
      GRANT USAGE ON SCHEMA auth, public, storage TO authenticated, anon, service_role;
      GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA auth TO authenticated, anon, service_role;
    `);
    const migrations = (await readdir(root)).filter((name) => name.endsWith(".sql")).sort();
    for (const name of migrations.filter((name) => name < migrationName)) {
      await db.exec(await readFile(new URL(name, root), "utf8"));
    }

    const legacyOwner = randomUUID();
    const unrelatedAdmin = randomUUID();
    const ordinaryOwner = randomUUID();
    const legacyProfile = randomUUID();
    const unrelatedProfile = randomUUID();
    const ordinaryProfile = randomUUID();
    for (const [userId, username] of [
      [legacyOwner, "legacy_owner"],
      [unrelatedAdmin, "operations_admin"],
      [ordinaryOwner, "ordinary_owner"],
    ]) {
      await db.query("INSERT INTO auth.users(id) VALUES ($1)", [userId]);
      await db.query(
        "INSERT INTO public.profiles(id,username,account_onboarded_at) VALUES ($1,$2,now())",
        [userId, username],
      );
    }
    for (const [profileId, ownerId, status] of [
      [legacyProfile, legacyOwner, null],
      [unrelatedProfile, unrelatedAdmin, "active"],
      [ordinaryProfile, ordinaryOwner, null],
    ]) {
      await db.query(
        "INSERT INTO public.bulk_profiles(id,owner_id,goal_status) VALUES ($1,$2,$3)",
        [profileId, ownerId, status],
      );
      await db.query(
        "INSERT INTO public.bulk_members(bulk_profile_id,user_id,role) VALUES ($1,$2,'owner')",
        [profileId, ownerId],
      );
    }
    await db.query("INSERT INTO public.bulk_admins(user_id) VALUES ($1),($2)", [
      legacyOwner,
      unrelatedAdmin,
    ]);
    await db.query(
      `INSERT INTO public.bulk_targets(bulk_profile_id,payload) VALUES
       ($1,$2::jsonb),($3,'{}'::jsonb),($4,'{}'::jsonb)`,
      [
        legacyProfile,
        JSON.stringify({
          calories: 2900,
          protein: 141,
          carbs: 375,
          fat: 87,
          legacyExerciseDefinitions: {
            "Chest & Back": [{ name: "Barbell Front Raise", min: 8, max: 12 }],
          },
          legacyExerciseOrder: {
            "Chest & Back": ["Barbell Front Raise", "Pull-Ups"],
          },
        }),
        unrelatedProfile,
        ordinaryProfile,
      ],
    );
    await db.query(
      `INSERT INTO public.bulk_exercises(
        id,owner_id,slug,name,primary_muscle,equipment,movement_pattern
      ) VALUES ('custom:barbell-front-raise',$1,'barbell-front-raise','Barbell Front Raise',
        'front_delts',ARRAY['barbell'],'shoulder_flexion')`,
      [legacyOwner],
    );
    const customDay = {
      mealPlan: "custom",
      calories: 2777,
      protein: 133,
      carbs: 321,
      fat: 91,
      note: "Historical custom day",
    };
    await db.query(
      "INSERT INTO public.bulk_days(bulk_profile_id,day,payload) VALUES ($1,'2026-09-01',$2::jsonb)",
      [legacyProfile, JSON.stringify(customDay)],
    );

    const migration = await readFile(new URL(migrationName, root), "utf8");
    await db.exec(migration);

    assert.equal(
      (await db.query("SELECT goal_status FROM public.bulk_profiles WHERE id=$1", [legacyProfile]))
        .rows[0].goal_status,
      "active",
    );
    assert.equal(
      Number(
        (
          await db.query(
            "SELECT count(*) AS n FROM public.bulk_meal_presets WHERE bulk_profile_id=$1",
            [legacyProfile],
          )
        ).rows[0].n,
      ),
      4,
    );
    assert.equal(
      Number(
        (
          await db.query(
            "SELECT count(*) AS n FROM public.bulk_meal_presets WHERE bulk_profile_id IN ($1,$2)",
            [unrelatedProfile, ordinaryProfile],
          )
        ).rows[0].n,
      ),
      0,
    );
    const chest = await db.query(
      `SELECT exercise_name,exercise_id
       FROM public.bulk_training_plan_exercises exercise
       JOIN public.bulk_training_plan_days day ON day.id=exercise.plan_day_id
       JOIN public.bulk_training_plans plan ON plan.id=day.plan_id
       WHERE plan.bulk_profile_id=$1 AND day.day_order=1
       ORDER BY exercise.exercise_order`,
      [legacyProfile],
    );
    assert.deepEqual(chest.rows.slice(0, 2), [
      { exercise_name: "Barbell Front Raise", exercise_id: "custom:barbell-front-raise" },
      { exercise_name: "Pull-Up", exercise_id: "system:pull-up" },
    ]);
    assert.equal(
      Number(
        (
          await db.query(
            "SELECT count(*) AS n FROM public.bulk_training_plans WHERE bulk_profile_id IN ($1,$2)",
            [unrelatedProfile, ordinaryProfile],
          )
        ).rows[0].n,
      ),
      0,
    );
    assert.deepEqual(
      (
        await db.query("SELECT payload FROM public.bulk_days WHERE bulk_profile_id=$1", [
          legacyProfile,
        ])
      ).rows[0].payload,
      customDay,
    );

    await db.exec(migration);
    assert.equal(
      Number(
        (
          await db.query(
            "SELECT count(*) AS n FROM public.bulk_meal_presets WHERE bulk_profile_id=$1",
            [legacyProfile],
          )
        ).rows[0].n,
      ),
      4,
    );
    assert.equal(
      Number(
        (
          await db.query(
            "SELECT count(*) AS n FROM public.bulk_training_plans WHERE bulk_profile_id=$1",
            [legacyProfile],
          )
        ).rows[0].n,
      ),
      1,
    );

    await db.exec(await readFile(new URL(nutritionCompatibilityMigrationName, root), "utf8"));
    const migratedPreset = (
      await db.query(
        "SELECT id FROM public.bulk_meal_presets WHERE bulk_profile_id=$1 AND source_key='legacy:beef'",
        [legacyProfile],
      )
    ).rows[0].id;
    const requestId = randomUUID();
    await db.query("SELECT set_config('request.jwt.claim.sub',$1,false)", [legacyOwner]);
    await db.exec("SET ROLE authenticated");
    try {
      await db.query("SELECT public.log_bulk_meal_preset($1,current_date,$2,current_date)", [
        migratedPreset,
        requestId,
      ]);
    } finally {
      await db.exec("RESET ROLE");
    }
    const logged = await db.query(
      `SELECT day.target_calories,day.target_protein_g,day.target_carbs_g,day.target_fat_g,
        entry.calories,entry.protein_g,entry.carbs_g,entry.fat_g,entry.source_meal_preset_id
       FROM public.bulk_nutrition_days day
       JOIN public.bulk_nutrition_entries entry ON entry.nutrition_day_id=day.id
       WHERE day.bulk_profile_id=$1 AND entry.request_id=$2`,
      [legacyProfile, requestId],
    );
    assert.deepEqual(logged.rows, [
      {
        target_calories: "2900.00",
        target_protein_g: "141.00",
        target_carbs_g: "375.00",
        target_fat_g: "87.00",
        calories: "2900.00",
        protein_g: "141.00",
        carbs_g: "375.00",
        fat_g: "87.00",
        source_meal_preset_id: migratedPreset,
      },
    ]);
    assert.equal(
      Number(
        (
          await db.query("SELECT count(*) AS n FROM public.bulk_meal_presets WHERE id=$1", [
            migratedPreset,
          ])
        ).rows[0].n,
      ),
      1,
    );
  } finally {
    await db.close();
  }
});
