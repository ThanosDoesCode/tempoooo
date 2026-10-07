import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import { calculateMuscleCoverage } from "../src/lib/bulk-muscle-coverage.ts";
import { MUSCLE_GROUPS } from "../src/lib/exercise-library.ts";

const db = new PGlite();
const root = new URL("../supabase/migrations/", import.meta.url);
const owner = randomUUID();
const other = randomUUID();
const existingPresetOwner = randomUUID();
const existingPreset = randomUUID();
let originalWeightDateConstraint;
let preservedNutrition;

before(async () => {
  await db.exec(`
    SET TIME ZONE 'UTC';
    CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role BYPASSRLS;
    CREATE SCHEMA auth; CREATE SCHEMA storage; CREATE SCHEMA extensions;
    CREATE TABLE auth.users(id uuid PRIMARY KEY);
    CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$
      SELECT nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
    $$;
    CREATE FUNCTION auth.jwt() RETURNS jsonb LANGUAGE sql STABLE AS $$ SELECT '{}'::jsonb $$;
    CREATE TABLE storage.buckets(
      id text PRIMARY KEY,
      public boolean NOT NULL DEFAULT false,
      file_size_limit bigint,
      allowed_mime_types text[]
    );
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
  for (const file of (await readdir(root)).filter((name) => name.endsWith(".sql")).sort()) {
    try {
      if (file === "20261005130000_meal_preset_quick_add_visibility.sql") {
        const profile = randomUUID();
        await db.query("INSERT INTO auth.users(id) VALUES ($1)", [existingPresetOwner]);
        await db.query("INSERT INTO public.profiles(id) VALUES ($1)", [existingPresetOwner]);
        await db.query(
          "INSERT INTO public.bulk_profiles(id,owner_id,goal_status) VALUES ($1,$2,'active')",
          [profile, existingPresetOwner],
        );
        await db.query(
          "INSERT INTO public.bulk_members(bulk_profile_id,user_id,role) VALUES ($1,$2,'owner')",
          [profile, existingPresetOwner],
        );
        await db.query(
          `INSERT INTO public.bulk_meal_presets(id,bulk_profile_id,name,sort_order,
            calories,protein_g,carbs_g,fat_g,source_key)
           VALUES ($1,$2,'Preserved imported meal',1,2850,120,369,96,'legacy:salmon')`,
          [existingPreset, profile],
        );
      }
      if (file === "20261008120000_meal_categories_and_target_history.sql") {
        const profile = (
          await db.query("SELECT id FROM public.bulk_profiles WHERE owner_id=$1", [
            existingPresetOwner,
          ])
        ).rows[0].id;
        const day = (
          await db.query(
            `INSERT INTO public.bulk_nutrition_days(bulk_profile_id,log_date,target_calories,target_protein_g,target_carbs_g,target_fat_g)
          VALUES ($1,'2001-01-01',2800,140,360,80) RETURNING *`,
            [profile],
          )
        ).rows[0];
        const entry = (
          await db.query(
            `INSERT INTO public.bulk_nutrition_entries(nutrition_day_id,source_type,name_snapshot,calories,protein_g,carbs_g,fat_g,sort_order,request_id)
          VALUES ($1,'custom','Unclassified preserved meal',600,40,70,20,1,$2) RETURNING *`,
            [day.id, randomUUID()],
          )
        ).rows[0];
        preservedNutrition = { profile, day, entry };
      }
      await db.exec(await readFile(new URL(file, root), "utf8"));
      if (file === "20260906220000_public_bulk_progress.sql") {
        originalWeightDateConstraint = (
          await db.query(
            "SELECT pg_get_constraintdef(oid) AS definition FROM pg_constraint WHERE conrelid='public.bulk_weight_entries'::regclass AND conname='bulk_weight_entries_date_ck'",
          )
        ).rows[0].definition;
      }
    } catch (error) {
      throw new Error(`Migration failed: ${file}`, { cause: error });
    }
  }
  for (const id of [owner, other]) {
    await db.query("INSERT INTO auth.users VALUES ($1)", [id]);
    await db.query("INSERT INTO public.profiles(id,display_name) VALUES ($1,'Meal owner')", [id]);
    await asUser(id, () =>
      db.query(
        `SELECT public.complete_goal_onboarding(
          'gain',70,78,0.25,'intermediate',4,ARRAY['dumbbells','bench'],'custom',2900,140,360,90
        )`,
      ),
    );
  }
});

after(() => db.close());

async function asUser(id, action) {
  await db.query("SELECT set_config('request.jwt.claim.sub',$1,false)", [id]);
  await db.exec("SET ROLE authenticated");
  try {
    return await action();
  } finally {
    await db.exec("RESET ROLE");
  }
}

async function asAnon(action) {
  await db.query("SELECT set_config('request.jwt.claim.sub','',false)");
  await db.exec("SET ROLE anon");
  try {
    return await action();
  } finally {
    await db.exec("RESET ROLE");
  }
}

const createMeal = (id, name, ingredients = [], calories = 612.5) =>
  asUser(id, () =>
    db.query(
      `SELECT public.create_bulk_meal_preset(
        $1,NULL,$2,48.25,72.75,14.5,$3::jsonb
      ) AS id`,
      [name, calories, JSON.stringify(ingredients)],
    ),
  );

// Execute the migration's real RPC under fixed midnight instants by substituting
// only its clock expression in the isolated PostgreSQL instance. CURRENT_DATE,
// RLS and the original table constraint are not replaced. Restore the exact RPC
// definition even on failure; production has no caller-controlled clock.
async function withDatabaseClock(
  timestamp,
  action,
  signature = "public.save_bulk_weight_for_local_day(uuid,date,numeric,text,text)",
) {
  const original = (
    await db.query("SELECT pg_get_functiondef($1::regprocedure) AS definition", [signature])
  ).rows[0].definition;
  const instant = new Date(timestamp).toISOString();
  assert.ok(original.includes("pg_catalog.now()"));
  try {
    await db.exec(original.replace("pg_catalog.now()", `'${instant}'::timestamptz`));
    return await action(instant);
  } finally {
    await db.exec(original);
  }
}

async function nutritionTargetFixture() {
  const user = randomUUID();
  await db.query("INSERT INTO auth.users(id) VALUES ($1)", [user]);
  await db.query("INSERT INTO public.profiles(id) VALUES ($1)", [user]);
  const profile = (
    await asUser(user, () =>
      db.query(`SELECT public.complete_goal_onboarding(
        'gain',70,78,0.25,'intermediate',4,ARRAY['dumbbells'],'custom',2400,140,300,80
      ) AS id`),
    )
  ).rows[0].id;
  const targets = (
    await db.query("SELECT payload FROM public.bulk_targets WHERE bulk_profile_id=$1", [profile])
  ).rows[0].payload;
  const save = (payload, timezone = "Europe/Stockholm") =>
    db.query("SELECT public.save_bulk_targets_for_local_day($1,$2::jsonb,$3)::text AS day", [
      profile,
      JSON.stringify(payload),
      timezone,
    ]);
  return { user, profile, targets, save };
}

test("saving Goal targets updates today's snapshot, preserves meals/past days and scopes writes to the owner", async () => {
  const f = await nutritionTargetFixture();
  const stranger = await nutritionTargetFixture();
  const dates = (
    await db.query(`SELECT
    (now() AT TIME ZONE 'Europe/Stockholm')::date::text AS today,
    ((now() AT TIME ZONE 'Europe/Stockholm')::date-1)::text AS yesterday`)
  ).rows[0];
  for (const date of [dates.today, dates.yesterday]) {
    await asUser(f.user, () =>
      db.query(
        "SELECT public.create_bulk_nutrition_entry($1,$2,'Preserved meal',2400,100,260,60,$3,'Keep note')",
        [date, randomUUID(), dates.today],
      ),
    );
  }
  const readDays = () =>
    db.query(
      "SELECT * FROM public.bulk_nutrition_days WHERE bulk_profile_id=$1 ORDER BY log_date",
      [f.profile],
    );
  const readMeals = () =>
    db.query(
      `SELECT entry.* FROM public.bulk_nutrition_entries entry
    JOIN public.bulk_nutrition_days day ON day.id=entry.nutrition_day_id
    WHERE day.bulk_profile_id=$1 ORDER BY entry.id`,
      [f.profile],
    );
  const beforeDays = (await readDays()).rows;
  const beforeMeals = (await readMeals()).rows;
  const updated = { ...f.targets, calories: 3000, protein: 160, carbs: 380, fat: 90 };
  const result = await asUser(f.user, () => f.save(updated));
  assert.equal(result.rows[0].day, dates.today);
  const afterDays = (await readDays()).rows;
  assert.deepEqual(afterDays[0], beforeDays[0], "past snapshot and timestamps stay unchanged");
  assert.equal(afterDays[1].id, beforeDays[1].id);
  assert.deepEqual(afterDays[1].created_at, beforeDays[1].created_at);
  assert.deepEqual(
    [
      afterDays[1].target_calories,
      afterDays[1].target_protein_g,
      afterDays[1].target_carbs_g,
      afterDays[1].target_fat_g,
    ].map(Number),
    [3000, 160, 380, 90],
  );
  assert.deepEqual((await readMeals()).rows, beforeMeals, "logged intake and notes stay identical");
  assert.deepEqual(
    (
      await db.query("SELECT payload FROM public.bulk_targets WHERE bulk_profile_id=$1", [
        f.profile,
      ])
    ).rows[0].payload,
    updated,
  );
  await assert.rejects(
    asUser(stranger.user, () => f.save(updated)),
    /Goal profile not found/,
  );
  const mismatchedOwner = randomUUID();
  const mismatchedProfile = randomUUID();
  await db.query("INSERT INTO auth.users(id) VALUES ($1)", [mismatchedOwner]);
  await db.query("INSERT INTO public.profiles(id) VALUES ($1)", [mismatchedOwner]);
  await db.query(
    "INSERT INTO public.bulk_profiles(id,owner_id,goal_status) VALUES ($1,$2,'active')",
    [mismatchedProfile, mismatchedOwner],
  );
  await db.query(
    "INSERT INTO public.bulk_members(bulk_profile_id,user_id,role) VALUES ($1,$2,'owner')",
    [mismatchedProfile, stranger.user],
  );
  await assert.rejects(
    asUser(stranger.user, () =>
      db.query("SELECT public.save_bulk_targets_for_local_day($1,$2::jsonb,'Europe/Stockholm')", [
        mismatchedProfile,
        JSON.stringify(updated),
      ]),
    ),
    /Goal profile not found/,
    "an owner membership alone cannot override the profile's actual owner",
  );
  await assert.rejects(
    asUser("", () => f.save(updated)),
    /Authentication required/,
  );
  await assert.rejects(
    asAnon(() => f.save(updated)),
    /permission denied/,
  );
  await assert.rejects(
    asUser(f.user, () => f.save(updated, "not/a/timezone")),
    /Invalid device timezone/,
  );
  await assert.rejects(
    asUser(f.user, () => f.save({ ...updated, calories: -1 })),
    /outside the allowed range/,
  );
  await assert.rejects(
    asUser(f.user, () => f.save({ ...updated, protein: null })),
    /unavailable/,
  );
  assert.deepEqual(
    (
      await db.query("SELECT payload FROM public.bulk_targets WHERE bulk_profile_id=$1", [
        stranger.profile,
      ])
    ).rows[0].payload,
    stranger.targets,
  );
  const privileges = (
    await db.query(`SELECT
    has_function_privilege('anon','public.save_bulk_targets_for_local_day(uuid,jsonb,text)','EXECUTE') AS anon,
    has_table_privilege('authenticated','public.bulk_nutrition_days','UPDATE') AS direct_update,
    relrowsecurity AS rls FROM pg_class WHERE oid='public.bulk_nutrition_days'::regclass`)
  ).rows[0];
  assert.deepEqual(privileges, { anon: false, direct_update: false, rls: true });
});

test("target saves use the current local day at midnight and never seed an empty day's history", async () => {
  const f = await nutritionTargetFixture();
  for (const [timezone, instant, expectedDay] of [
    ["Europe/Stockholm", "2026-10-06T22:05:00Z", "2026-10-07"],
    ["Pacific/Kiritimati", "2026-10-06T12:05:00Z", "2026-10-07"],
    ["America/Los_Angeles", "2026-10-07T01:05:00Z", "2026-10-06"],
  ]) {
    await withDatabaseClock(
      instant,
      async () => {
        const saved = await asUser(f.user, () =>
          f.save({ ...f.targets, calories: 3000 }, timezone),
        );
        assert.equal(saved.rows[0].day, expectedDay);
      },
      "public.save_bulk_targets_for_local_day(uuid,jsonb,text)",
    );
  }
  assert.equal(
    Number(
      (
        await db.query(
          "SELECT count(*) AS n FROM public.bulk_nutrition_days WHERE bulk_profile_id=$1",
          [f.profile],
        )
      ).rows[0].n,
    ),
    0,
  );
  const today = (
    await db.query("SELECT (now() AT TIME ZONE 'Europe/Stockholm')::date::text AS day")
  ).rows[0].day;
  await asUser(f.user, () =>
    db.query("SELECT public.create_bulk_nutrition_entry($1,$2,'First meal',500,20,50,20,$1,NULL)", [
      today,
      randomUUID(),
    ]),
  );
  assert.equal(
    Number(
      (
        await db.query(
          "SELECT target_calories FROM public.bulk_nutrition_days WHERE bulk_profile_id=$1 AND log_date=$2",
          [f.profile, today],
        )
      ).rows[0].target_calories,
    ),
    3000,
  );
});

test("snapshot update failure rolls back the target change in the same transaction", async () => {
  const f = await nutritionTargetFixture();
  const today = (
    await db.query("SELECT (now() AT TIME ZONE 'Europe/Stockholm')::date::text AS day")
  ).rows[0].day;
  await asUser(f.user, () =>
    db.query("SELECT public.create_bulk_nutrition_entry($1,$2,'Meal',2400,100,260,60,$1,NULL)", [
      today,
      randomUUID(),
    ]),
  );
  await db.exec(`CREATE FUNCTION public.reject_test_nutrition_snapshot() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN RAISE EXCEPTION 'Snapshot write failed'; END; $$;
    CREATE TRIGGER reject_test_nutrition_snapshot BEFORE UPDATE ON public.bulk_nutrition_days
    FOR EACH ROW EXECUTE FUNCTION public.reject_test_nutrition_snapshot();`);
  try {
    await assert.rejects(
      asUser(f.user, () => f.save({ ...f.targets, calories: 3000 })),
      /Snapshot write failed/,
    );
    assert.deepEqual(
      (
        await db.query("SELECT payload FROM public.bulk_targets WHERE bulk_profile_id=$1", [
          f.profile,
        ])
      ).rows[0].payload,
      f.targets,
    );
    assert.equal(
      Number(
        (
          await db.query(
            "SELECT target_calories FROM public.bulk_nutrition_days WHERE bulk_profile_id=$1",
            [f.profile],
          )
        ).rows[0].target_calories,
      ),
      2400,
    );
  } finally {
    await db.exec(`DROP TRIGGER reject_test_nutrition_snapshot ON public.bulk_nutrition_days;
      DROP FUNCTION public.reject_test_nutrition_snapshot();`);
  }
});

test("public Goal starts without presets even when legacy meal data exists", async () => {
  const profile = (await db.query("SELECT id FROM public.bulk_profiles WHERE owner_id=$1", [owner]))
    .rows[0].id;
  assert.equal(
    Number(
      (
        await asUser(owner, () =>
          db.query("SELECT count(*) AS n FROM public.bulk_meal_presets WHERE bulk_profile_id=$1", [
            profile,
          ]),
        )
      ).rows[0].n,
    ),
    0,
  );
  await db.query(
    `INSERT INTO public.bulk_days(bulk_profile_id,day,payload)
     VALUES ($1,'2026-09-05','{"mealPlan":"salmon","calories":2850}'::jsonb)`,
    [profile],
  );
  assert.equal(
    Number(
      (
        await asUser(owner, () =>
          db.query("SELECT count(*) AS n FROM public.bulk_meal_presets WHERE bulk_profile_id=$1", [
            profile,
          ]),
        )
      ).rows[0].n,
    ),
    0,
  );
  assert.equal(
    (
      await db.query(
        "SELECT payload->>'mealPlan' AS meal FROM public.bulk_days WHERE day='2026-09-05' AND bulk_profile_id=$1",
        [profile],
      )
    ).rows[0].meal,
    "salmon",
  );
});

test("meal CRUD, duplication and normalized ordering are transactional", async () => {
  const first = (
    await createMeal(owner, "Chicken rice", [
      { name: "Chicken", quantity: 175.5, unit: "g" },
      { name: "Rice", quantity: 1, unit: "pack" },
    ])
  ).rows[0].id;
  const second = (await createMeal(owner, "Yogurt bowl")).rows[0].id;
  const profile = (await db.query("SELECT id FROM public.bulk_profiles WHERE owner_id=$1", [owner]))
    .rows[0].id;

  const own = await asUser(owner, () =>
    db.query(
      "SELECT id,sort_order,calories FROM public.bulk_meal_presets WHERE bulk_profile_id=$1 ORDER BY sort_order",
      [profile],
    ),
  );
  assert.deepEqual(
    own.rows.map((row) => row.id),
    [first, second],
  );
  assert.equal(Number(own.rows[0].calories), 612.5);
  const ingredients = await asUser(owner, () =>
    db.query(
      "SELECT name,quantity,unit,sort_order FROM public.bulk_meal_preset_ingredients WHERE meal_preset_id=$1 ORDER BY sort_order",
      [first],
    ),
  );
  assert.deepEqual(
    ingredients.rows.map((row) => [row.name, Number(row.quantity), row.unit, row.sort_order]),
    [
      ["Chicken", 175.5, "g", 1],
      ["Rice", 1, "pack", 2],
    ],
  );

  const oldUpdatedAt = (
    await asUser(owner, () =>
      db.query("SELECT updated_at FROM public.bulk_meal_presets WHERE id=$1", [first]),
    )
  ).rows[0].updated_at;
  await asUser(owner, () =>
    db.query(
      `SELECT public.update_bulk_meal_preset(
        $1,$2,'Chicken rice edited','Dinner',700.25,50.5,80.75,15.25,
        '[{"name":"Chicken","quantity":200,"unit":"g"}]'::jsonb
      )`,
      [first, oldUpdatedAt],
    ),
  );
  assert.equal(
    (
      await asUser(owner, () =>
        db.query("SELECT name FROM public.bulk_meal_presets WHERE id=$1", [first]),
      )
    ).rows[0].name,
    "Chicken rice edited",
  );
  await assert.rejects(
    asUser(owner, () =>
      db.query(
        "SELECT public.update_bulk_meal_preset($1,$2,'Stale edit',NULL,1,1,1,1,'[]'::jsonb)",
        [first, oldUpdatedAt],
      ),
    ),
    /another device/i,
  );

  const copy = (
    await asUser(owner, () =>
      db.query("SELECT public.duplicate_bulk_meal_preset($1) AS id", [first]),
    )
  ).rows[0].id;
  assert.notEqual(copy, first);
  assert.equal(
    Number(
      (
        await db.query(
          "SELECT count(*) AS n FROM public.bulk_meal_preset_ingredients WHERE meal_preset_id=$1",
          [copy],
        )
      ).rows[0].n,
    ),
    1,
  );
  assert.equal(
    (
      await asUser(owner, () =>
        db.query("SELECT name FROM public.bulk_meal_presets WHERE id=$1", [first]),
      )
    ).rows[0].name,
    "Chicken rice edited",
  );

  assert.equal(
    (
      await asUser(owner, () =>
        db.query("SELECT public.move_bulk_meal_preset($1,-1) AS ok", [second]),
      )
    ).rows[0].ok,
    true,
  );
  assert.equal(
    (
      await asUser(owner, () =>
        db.query("SELECT public.move_bulk_meal_preset($1,-1) AS ok", [second]),
      )
    ).rows[0].ok,
    false,
  );
  const ordered = await asUser(owner, () =>
    db.query(
      "SELECT sort_order FROM public.bulk_meal_presets WHERE bulk_profile_id=$1 ORDER BY sort_order",
      [profile],
    ),
  );
  assert.deepEqual(
    ordered.rows.map((row) => row.sort_order),
    [1, 2, 3],
  );
  assert.equal(new Set(ordered.rows.map((row) => row.sort_order)).size, 3);

  assert.equal(
    (
      await asUser(owner, () =>
        db.query("SELECT public.delete_bulk_meal_preset($1) AS ok", [first]),
      )
    ).rows[0].ok,
    true,
  );
  assert.equal(
    Number(
      (
        await db.query(
          "SELECT count(*) AS n FROM public.bulk_meal_preset_ingredients WHERE meal_preset_id=$1",
          [first],
        )
      ).rows[0].n,
    ),
    0,
  );
  const compacted = await asUser(owner, () =>
    db.query(
      "SELECT sort_order FROM public.bulk_meal_presets WHERE bulk_profile_id=$1 ORDER BY sort_order",
      [profile],
    ),
  );
  assert.deepEqual(
    compacted.rows.map((row) => row.sort_order),
    [1, 2],
  );
});

test("local-day weight RPC preserves the date constraint and same-day upserts across timezone boundaries", async () => {
  const profile = (await db.query("SELECT id FROM public.bulk_profiles WHERE owner_id=$1", [owner]))
    .rows[0].id;
  const rpc = (date, kg, note = "Morning", timezone = "Pacific/Kiritimati") =>
    db.query("SELECT public.save_bulk_weight_for_local_day($1,$2,$3,$4,$5)", [
      profile,
      date,
      kg,
      note,
      timezone,
    ]);
  let createdId;
  try {
    // UTC-12 vs UTC+14 guarantees two distinct calendar dates at the same instant.
    await db.exec("SET TIME ZONE 'Etc/GMT+12'");
    const dates = (
      await db.query(`SELECT CURRENT_DATE::text AS server_day,
      (now() AT TIME ZONE 'Pacific/Kiritimati')::date::text AS local_day`)
    ).rows[0];
    assert.ok(dates.local_day > dates.server_day);
    await assert.rejects(
      asUser(owner, () =>
        db.query(
          "INSERT INTO public.bulk_weight_entries(bulk_profile_id,log_date,weight_kg) VALUES($1,$2,70)",
          [profile, dates.local_day],
        ),
      ),
      (error) => error.code === "23514" && error.constraint === "bulk_weight_entries_date_ck",
    );

    await asUser(owner, () => rpc(dates.local_day, 71.25));
    const original = (
      await db.query(
        "SELECT id,log_date::text FROM public.bulk_weight_entries WHERE bulk_profile_id=$1 AND log_date=$2",
        [profile, dates.local_day],
      )
    ).rows[0];
    createdId = original.id;
    await asUser(owner, () => rpc(dates.local_day, 71.5, "Edited"));
    const rows = (
      await db.query(
        "SELECT id,log_date::text,weight_kg::text,note FROM public.bulk_weight_entries WHERE bulk_profile_id=$1 AND log_date=$2",
        [profile, dates.local_day],
      )
    ).rows;
    assert.deepEqual(rows, [
      { id: original.id, log_date: dates.local_day, weight_kg: "71.50", note: "Edited" },
    ]);
    for (const note of [null, ""]) {
      await asUser(owner, () => rpc(dates.local_day, 71.5, note));
      const updated = (
        await db.query(
          "SELECT id,note FROM public.bulk_weight_entries WHERE bulk_profile_id=$1 AND log_date=$2",
          [profile, dates.local_day],
        )
      ).rows;
      assert.deepEqual(updated, [{ id: original.id, note }]);
    }
    assert.equal((await db.query("SHOW TimeZone")).rows[0].TimeZone, "Etc/GMT+12");

    const tomorrow = (
      await db.query("SELECT ((now() AT TIME ZONE 'Pacific/Kiritimati')::date+1)::text AS day")
    ).rows[0].day;
    await assert.rejects(
      asUser(owner, () => rpc(tomorrow, 70)),
      /Weight date must be today in the supplied timezone/,
    );
    await assert.rejects(
      asUser(owner, () => rpc("1999-12-31", 70)),
      /Weight date must be today in the supplied timezone/,
    );
    await assert.rejects(
      asUser(owner, () => rpc(dates.local_day, 401)),
      (error) => error.constraint === "bulk_weight_entries_weight_ck",
    );
    await assert.rejects(
      asUser(owner, () => rpc(dates.local_day, 70, null, "not/a/timezone")),
      /Invalid device timezone/,
    );
    await assert.rejects(
      asUser(owner, () => rpc(dates.local_day, 70, null, null)),
      /Invalid device timezone/,
    );
    await assert.rejects(
      asUser(other, () => rpc(dates.local_day, 70)),
      /Goal profile not found/,
    );
    await assert.rejects(
      asUser("", () => rpc(dates.local_day, 70)),
      /Not authenticated/,
    );
    await assert.rejects(
      asAnon(() => rpc(dates.local_day, 70)),
      /permission denied/,
    );
    assert.equal((await db.query("SHOW TimeZone")).rows[0].TimeZone, "Etc/GMT+12");
    const fn = (
      await db.query(`SELECT prosecdef,proconfig,
      has_function_privilege('anon',oid,'EXECUTE') AS anon,
      has_function_privilege('authenticated',oid,'EXECUTE') AS authenticated
      FROM pg_proc WHERE proname='save_bulk_weight_for_local_day'`)
    ).rows[0];
    assert.equal(fn.prosecdef, false, "RLS remains in force for the caller");
    assert.equal(fn.anon, false);
    assert.equal(fn.authenticated, true);
    assert.ok(fn.proconfig.includes('search_path=""'));
    assert.equal(
      (
        await db.query(
          "SELECT relrowsecurity FROM pg_class WHERE oid='public.bulk_weight_entries'::regclass",
        )
      ).rows[0].relrowsecurity,
      true,
    );
  } finally {
    await db.exec("SET TIME ZONE 'UTC'");
    if (createdId)
      await db.query("DELETE FROM public.bulk_weight_entries WHERE id=$1", [createdId]);
  }
});

test("today-only weight RPC accepts Stockholm after midnight and timezones ahead/behind UTC", async (t) => {
  const profile = (await db.query("SELECT id FROM public.bulk_profiles WHERE owner_id=$1", [owner]))
    .rows[0].id;
  const cases = [
    ["Stockholm just after midnight", "2024-12-31T23:05:00Z", "Europe/Stockholm", "2025-01-01"],
    ["ahead of UTC", "2025-01-31T10:05:00Z", "Pacific/Kiritimati", "2025-02-01"],
    ["behind UTC", "2025-01-01T00:05:00Z", "America/Los_Angeles", "2024-12-31"],
    ["Stockholm summer midnight", "2025-06-30T22:05:00Z", "Europe/Stockholm", "2025-07-01"],
  ];
  for (const [name, timestamp, timezone, expectedDate] of cases) {
    await t.test(name, () =>
      withDatabaseClock(timestamp, async (instant) => {
        let createdId;
        try {
          assert.equal(
            (
              await db.query("SELECT ($1::timestamptz AT TIME ZONE $2)::date::text AS day", [
                instant,
                timezone,
              ])
            ).rows[0].day,
            expectedDate,
          );
          await asUser(owner, () =>
            db.query("SELECT public.save_bulk_weight_for_local_day($1,$2,72.25,NULL,$3)", [
              profile,
              expectedDate,
              timezone,
            ]),
          );
          const row = (
            await db.query(
              "SELECT id,log_date::text,weight_kg::text FROM public.bulk_weight_entries WHERE bulk_profile_id=$1 AND log_date=$2",
              [profile, expectedDate],
            )
          ).rows[0];
          createdId = row.id;
          assert.equal(row.log_date, expectedDate);
          assert.equal(row.weight_kg, "72.25");
          assert.equal((await db.query("SHOW TimeZone")).rows[0].TimeZone, "UTC");
        } finally {
          if (createdId)
            await db.query("DELETE FROM public.bulk_weight_entries WHERE id=$1", [createdId]);
        }
      }),
    );
  }
});

test("arbitrary valid timezone never permits tomorrow or yesterday relative to that timezone", async () => {
  const profile = (await db.query("SELECT id FROM public.bulk_profiles WHERE owner_id=$1", [owner]))
    .rows[0].id;
  await withDatabaseClock("2025-01-01T12:05:00Z", async (instant) => {
    const before = (
      await db.query(
        "SELECT count(*) AS count FROM public.bulk_weight_entries WHERE bulk_profile_id=$1",
        [profile],
      )
    ).rows[0].count;
    for (const timezone of [
      "UTC",
      "Europe/Stockholm",
      "Pacific/Kiritimati",
      "America/Los_Angeles",
      "Etc/GMT+12",
    ]) {
      const dates = (
        await db.query(
          "SELECT (($1::timestamptz AT TIME ZONE $2)::date+1)::text AS tomorrow, (($1::timestamptz AT TIME ZONE $2)::date-1)::text AS yesterday",
          [instant, timezone],
        )
      ).rows[0];
      for (const date of [dates.tomorrow, dates.yesterday]) {
        // Both are below the real CURRENT_DATE: the explicit RPC guard, not the
        // existing table bound, must reject them under the test clock.
        await assert.rejects(
          asUser(owner, () =>
            db.query("SELECT public.save_bulk_weight_for_local_day($1,$2,72,NULL,$3)", [
              profile,
              date,
              timezone,
            ]),
          ),
          /Weight date must be today in the supplied timezone/,
        );
        assert.equal((await db.query("SHOW TimeZone")).rows[0].TimeZone, "UTC");
      }
    }
    assert.equal(
      (
        await db.query(
          "SELECT count(*) AS count FROM public.bulk_weight_entries WHERE bulk_profile_id=$1",
          [profile],
        )
      ).rows[0].count,
      before,
    );
  });
});

test("local-day weight RPC keeps original constraint, RLS and execution/ownership boundaries", async () => {
  assert.equal(
    (
      await db.query(
        "SELECT pg_get_constraintdef(oid) AS definition FROM pg_constraint WHERE conrelid='public.bulk_weight_entries'::regclass AND conname='bulk_weight_entries_date_ck'",
      )
    ).rows[0].definition,
    originalWeightDateConstraint,
  );
  assert.match(originalWeightDateConstraint, /2000-01-01/);
  assert.match(originalWeightDateConstraint, /CURRENT_DATE/);
  const migration = await readFile(
    new URL("20261005120000_save_goal_weight_local_day.sql", root),
    "utf8",
  );
  assert.doesNotMatch(
    migration,
    /\bEXECUTE\s+(?:format|')|SECURITY DEFINER|ALTER TABLE|DROP CONSTRAINT/i,
  );
  assert.match(migration, /pg_catalog\.pg_timezone_names/);
  assert.match(migration, /pg_catalog\.set_config\('TimeZone', _timezone, true\)/);
  assert.match(migration, /p\.owner_id = caller/);
  assert.match(migration, /m\.user_id = caller AND m\.role = 'owner'/);
  assert.equal(
    (
      await db.query(
        "SELECT has_function_privilege('anon','public.save_bulk_weight_for_local_day(uuid,date,numeric,text,text)','EXECUTE') AS anon, has_function_privilege('service_role','public.save_bulk_weight_for_local_day(uuid,date,numeric,text,text)','EXECUTE') AS service",
      )
    ).rows[0].anon,
    false,
  );
  assert.equal(
    (
      await db.query(
        "SELECT has_function_privilege('service_role','public.save_bulk_weight_for_local_day(uuid,date,numeric,text,text)','EXECUTE') AS allowed",
      )
    ).rows[0].allowed,
    false,
  );
});

test("weight RPC restores timezone inside an existing transaction on success and constraint failure", async () => {
  const profile = (await db.query("SELECT id FROM public.bulk_profiles WHERE owner_id=$1", [owner]))
    .rows[0].id;
  try {
    await db.exec("BEGIN; SET LOCAL TIME ZONE 'Etc/GMT+12'");
    await db.query("SELECT set_config('request.jwt.claim.sub',$1,true)", [owner]);
    await db.exec("SET LOCAL ROLE authenticated");
    const date = (
      await db.query(
        "SELECT (pg_catalog.now() AT TIME ZONE 'Pacific/Kiritimati')::date::text AS day",
      )
    ).rows[0].day;
    await db.query(
      "SELECT public.save_bulk_weight_for_local_day($1,$2,72,NULL,'Pacific/Kiritimati')",
      [profile, date],
    );
    assert.equal(
      (await db.query("SHOW TimeZone")).rows[0].TimeZone,
      "Etc/GMT+12",
      "restored before the outer transaction ends",
    );
    await db.exec("SAVEPOINT rejected_weight");
    await assert.rejects(
      db.query(
        "SELECT public.save_bulk_weight_for_local_day($1,$2,401,NULL,'Pacific/Kiritimati')",
        [profile, date],
      ),
      (error) => error.constraint === "bulk_weight_entries_weight_ck",
    );
    await db.exec("ROLLBACK TO SAVEPOINT rejected_weight");
    assert.equal((await db.query("SHOW TimeZone")).rows[0].TimeZone, "Etc/GMT+12");
  } finally {
    await db.exec("ROLLBACK");
  }
  assert.equal((await db.query("SHOW TimeZone")).rows[0].TimeZone, "UTC");
});

test("public Bulk weight entries are decimal, canonical by date and owner-only", async () => {
  const ownerProfile = (
    await db.query("SELECT id FROM public.bulk_profiles WHERE owner_id=$1", [owner])
  ).rows[0].id;
  const otherProfile = (
    await db.query("SELECT id FROM public.bulk_profiles WHERE owner_id=$1", [other])
  ).rows[0].id;
  await asUser(owner, () =>
    db.query(
      "INSERT INTO public.bulk_weight_entries(bulk_profile_id,log_date,weight_kg,note) VALUES ($1,'2026-09-05',61.75,'Morning')",
      [ownerProfile],
    ),
  );
  await assert.rejects(
    asUser(owner, () =>
      db.query(
        "INSERT INTO public.bulk_weight_entries(bulk_profile_id,log_date,weight_kg) VALUES ($1,'2026-09-05',62)",
        [ownerProfile],
      ),
    ),
    /unique|duplicate/i,
  );
  await asUser(owner, () =>
    db.query(
      "UPDATE public.bulk_weight_entries SET weight_kg=61.25 WHERE bulk_profile_id=$1 AND log_date='2026-09-05'",
      [ownerProfile],
    ),
  );
  assert.equal(
    Number(
      (
        await asUser(owner, () =>
          db.query("SELECT weight_kg FROM public.bulk_weight_entries WHERE bulk_profile_id=$1", [
            ownerProfile,
          ]),
        )
      ).rows[0].weight_kg,
    ),
    61.25,
  );
  assert.equal(
    (
      await asUser(other, () =>
        db.query("SELECT * FROM public.bulk_weight_entries WHERE bulk_profile_id=$1", [
          ownerProfile,
        ]),
      )
    ).rows.length,
    0,
  );
  assert.equal(
    (
      await asUser(other, () =>
        db.query("UPDATE public.bulk_weight_entries SET weight_kg=90 WHERE bulk_profile_id=$1", [
          ownerProfile,
        ]),
      )
    ).affectedRows,
    0,
  );
  await assert.rejects(
    asUser(owner, () =>
      db.query(
        "INSERT INTO public.bulk_weight_entries(bulk_profile_id,log_date,weight_kg) VALUES ($1,'2026-09-04',19)",
        [ownerProfile],
      ),
    ),
    /weight|check/i,
  );
  await assert.rejects(
    asUser(owner, () =>
      db.query(
        "INSERT INTO public.bulk_weight_entries(bulk_profile_id,log_date,weight_kg) VALUES ($1,'2099-09-04',70)",
        [ownerProfile],
      ),
    ),
    /date|check/i,
  );
  await assert.rejects(
    asUser(owner, () =>
      db.query(
        "INSERT INTO public.bulk_weight_entries(bulk_profile_id,log_date,weight_kg) VALUES ($1,'2026-09-03',401)",
        [ownerProfile],
      ),
    ),
    /weight|check/i,
  );
  await assert.rejects(
    asUser(owner, () =>
      db.query(
        "INSERT INTO public.bulk_weight_entries(bulk_profile_id,log_date,weight_kg) VALUES ($1,'2026-09-02',70)",
        [otherProfile],
      ),
    ),
    /row-level security/i,
  );
  await asUser(owner, () =>
    db.query("DELETE FROM public.bulk_weight_entries WHERE bulk_profile_id=$1", [ownerProfile]),
  );
  assert.equal(
    (
      await db.query(
        "SELECT count(*) AS n FROM public.bulk_weight_entries WHERE bulk_profile_id=$1",
        [ownerProfile],
      )
    ).rows[0].n,
    0,
  );
  await assert.rejects(
    asAnon(() => db.query("SELECT * FROM public.bulk_weight_entries")),
    /permission denied/i,
  );
});

test("public progress photo metadata and storage paths remain private and owner-scoped", async () => {
  const ownerProfile = (
    await db.query("SELECT id FROM public.bulk_profiles WHERE owner_id=$1", [owner])
  ).rows[0].id;
  const otherProfile = (
    await db.query("SELECT id FROM public.bulk_profiles WHERE owner_id=$1", [other])
  ).rows[0].id;
  const photoId = randomUUID();
  const path = `${ownerProfile}/public/${photoId}/photo.webp`;
  await asUser(owner, () =>
    db.query(
      "INSERT INTO public.bulk_progress_photos(id,bulk_profile_id,log_date,storage_path,view_type,note) VALUES ($1,$2,'2026-09-05',$3,'front','Check-in')",
      [photoId, ownerProfile, path],
    ),
  );
  await asUser(owner, () =>
    db.query(
      "INSERT INTO storage.objects(id,bucket_id,name) VALUES ($1,'bulk-progress-photos',$2)",
      [randomUUID(), path],
    ),
  );
  assert.equal(
    (
      await asUser(other, () =>
        db.query("SELECT * FROM public.bulk_progress_photos WHERE id=$1", [photoId]),
      )
    ).rows.length,
    0,
  );
  assert.equal(
    (await asUser(other, () => db.query("SELECT * FROM storage.objects WHERE name=$1", [path])))
      .rows.length,
    0,
  );
  await assert.rejects(
    asUser(owner, () =>
      db.query(
        "INSERT INTO public.bulk_progress_photos(bulk_profile_id,log_date,storage_path) VALUES ($1,'2026-09-05',$2)",
        [ownerProfile, `${otherProfile}/public/x/photo.webp`],
      ),
    ),
    /check/i,
  );
  await assert.rejects(
    asAnon(() => db.query("SELECT * FROM public.bulk_progress_photos")),
    /permission denied/i,
  );
  await asUser(owner, () => db.query("DELETE FROM storage.objects WHERE name=$1", [path]));
  await asUser(owner, () =>
    db.query("DELETE FROM public.bulk_progress_photos WHERE id=$1", [photoId]),
  );
  assert.equal(
    (await db.query("SELECT count(*) AS n FROM public.bulk_progress_photos WHERE id=$1", [photoId]))
      .rows[0].n,
    0,
  );
});

test("RLS and RPC ownership prevent cross-user and anonymous meal access", async () => {
  const meal = (await createMeal(owner, "Private meal")).rows[0].id;
  assert.equal(
    (
      await asUser(other, () =>
        db.query("SELECT id FROM public.bulk_meal_presets WHERE id=$1", [meal]),
      )
    ).rows.length,
    0,
  );
  await assert.rejects(
    asUser(other, () => db.query("SELECT public.duplicate_bulk_meal_preset($1)", [meal])),
    /not found/i,
  );
  assert.equal(
    (await asUser(other, () => db.query("SELECT public.delete_bulk_meal_preset($1) AS ok", [meal])))
      .rows[0].ok,
    false,
  );
  await assert.rejects(
    asUser(other, () =>
      db.query(
        "INSERT INTO public.bulk_meal_preset_ingredients(meal_preset_id,name,quantity,unit,sort_order) VALUES ($1,'Stolen',1,'g',1)",
        [meal],
      ),
    ),
    /permission denied/i,
  );
  await assert.rejects(
    asUser(other, () =>
      db.query("UPDATE public.bulk_meal_presets SET name='Stolen' WHERE id=$1", [meal]),
    ),
    /permission denied/i,
  );
  await assert.rejects(
    asAnon(() => db.query("SELECT * FROM public.bulk_meal_presets")),
    /permission denied/i,
  );
});

test("server constraints reject unsafe meal and ingredient values without partial rows", async () => {
  const beforeCount = Number(
    (await db.query("SELECT count(*) AS n FROM public.bulk_meal_presets")).rows[0].n,
  );
  await assert.rejects(createMeal(owner, "Negative meal", [], -1), /outside the allowed range/i);
  await assert.rejects(
    createMeal(owner, "Bad ingredient", [{ name: "Rice", quantity: 0, unit: "g" }]),
    /quantity_ck/i,
  );
  assert.equal(
    Number((await db.query("SELECT count(*) AS n FROM public.bulk_meal_presets")).rows[0].n),
    beforeCount,
  );
});

test("nutrition logs snapshot targets, presets and ingredients with idempotent retries", async () => {
  // This date has an authoritative existing snapshot; the new migration must retain it.
  await db.query(
    `INSERT INTO public.bulk_nutrition_days(bulk_profile_id,log_date,target_calories,target_protein_g,target_carbs_g,target_fat_g)
    SELECT id,'2026-09-06',2900,140,360,90 FROM public.bulk_profiles WHERE owner_id=$1
    ON CONFLICT (bulk_profile_id,log_date) DO UPDATE SET target_calories=2900,target_protein_g=140,target_carbs_g=360,target_fat_g=90`,
    [owner],
  );
  const preset = (
    await asUser(owner, () =>
      db.query(
        `SELECT public.create_bulk_meal_preset(
          'Snapshot meal','Original',600.25,40.5,60.25,20.75,
          '[{"name":"Rice","quantity":125.5,"unit":"g"}]'::jsonb
        ) AS id`,
      ),
    )
  ).rows[0].id;
  const firstRequest = randomUUID();
  const secondRequest = randomUUID();
  const firstEntry = (
    await asUser(owner, () =>
      db.query("SELECT public.log_bulk_meal_preset($1,'2026-09-06',$2,current_date) AS id", [
        preset,
        firstRequest,
      ]),
    )
  ).rows[0].id;
  const retryEntry = (
    await asUser(owner, () =>
      db.query("SELECT public.log_bulk_meal_preset($1,'2026-09-06',$2,current_date) AS id", [
        preset,
        firstRequest,
      ]),
    )
  ).rows[0].id;
  const secondEntry = (
    await asUser(owner, () =>
      db.query("SELECT public.log_bulk_meal_preset($1,'2026-09-06',$2,current_date) AS id", [
        preset,
        secondRequest,
      ]),
    )
  ).rows[0].id;
  assert.equal(retryEntry, firstEntry);
  assert.notEqual(secondEntry, firstEntry);

  const profile = (await db.query("SELECT id FROM public.bulk_profiles WHERE owner_id=$1", [owner]))
    .rows[0].id;
  const days = await db.query(
    "SELECT * FROM public.bulk_nutrition_days WHERE bulk_profile_id=$1 AND log_date='2026-09-06'",
    [profile],
  );
  assert.equal(days.rows.length, 1);
  assert.deepEqual(
    [
      Number(days.rows[0].target_calories),
      Number(days.rows[0].target_protein_g),
      Number(days.rows[0].target_carbs_g),
      Number(days.rows[0].target_fat_g),
    ],
    [2900, 140, 360, 90],
  );
  const snapshot = (
    await db.query("SELECT * FROM public.bulk_nutrition_entries WHERE id=$1", [firstEntry])
  ).rows[0];
  assert.equal(snapshot.name_snapshot, "Snapshot meal");
  assert.deepEqual(
    [
      Number(snapshot.calories),
      Number(snapshot.protein_g),
      Number(snapshot.carbs_g),
      Number(snapshot.fat_g),
    ],
    [600.25, 40.5, 60.25, 20.75],
  );
  assert.deepEqual(snapshot.ingredient_snapshot, [{ name: "Rice", quantity: 125.5, unit: "g" }]);

  await asUser(owner, () =>
    db.query("SELECT public.set_bulk_meal_preset_quick_add_visibility($1,false)", [preset]),
  );
  assert.deepEqual(
    (await db.query("SELECT * FROM public.bulk_nutrition_entries WHERE id=$1", [firstEntry]))
      .rows[0],
    snapshot,
  );

  const presetUpdated = (
    await db.query("SELECT updated_at FROM public.bulk_meal_presets WHERE id=$1", [preset])
  ).rows[0].updated_at;
  await asUser(owner, () =>
    db.query(
      "SELECT public.update_bulk_meal_preset($1,$2,'Changed preset',NULL,700,50,70,30,'[]'::jsonb)",
      [preset, presetUpdated],
    ),
  );
  assert.equal(
    (await db.query("SELECT show_in_quick_add FROM public.bulk_meal_presets WHERE id=$1", [preset]))
      .rows[0].show_in_quick_add,
    false,
  );
  assert.equal(
    Number(
      (
        await db.query("SELECT calories FROM public.bulk_nutrition_entries WHERE id=$1", [
          firstEntry,
        ])
      ).rows[0].calories,
    ),
    600.25,
  );
  await asUser(owner, () => db.query("SELECT public.delete_bulk_meal_preset($1)", [preset]));
  const afterPresetDelete = (
    await db.query(
      "SELECT source_meal_preset_id,name_snapshot,calories,protein_g,carbs_g,fat_g,ingredient_snapshot FROM public.bulk_nutrition_entries WHERE id=$1",
      [firstEntry],
    )
  ).rows[0];
  assert.equal(afterPresetDelete.source_meal_preset_id, null);
  assert.equal(afterPresetDelete.name_snapshot, "Snapshot meal");
  assert.equal(Number(afterPresetDelete.calories), 600.25);
  assert.deepEqual(
    [
      Number(afterPresetDelete.protein_g),
      Number(afterPresetDelete.carbs_g),
      Number(afterPresetDelete.fat_g),
    ],
    [40.5, 60.25, 20.75],
  );
  assert.equal(afterPresetDelete.ingredient_snapshot[0].name, "Rice");
});

test("Quick Add migration preserves existing imported presets and makes new/duplicated presets visible", async () => {
  const imported = (
    await asUser(existingPresetOwner, () =>
      db.query("SELECT * FROM public.bulk_meal_presets WHERE id=$1", [existingPreset]),
    )
  ).rows[0];
  assert.equal(imported.show_in_quick_add, true);
  assert.equal(imported.source_key, "legacy:salmon");
  assert.equal(imported.name, "Preserved imported meal");
  assert.equal(Number(imported.calories), 2850);

  const created = (await createMeal(owner, "Visible by default")).rows[0].id;
  assert.equal(
    (
      await db.query("SELECT show_in_quick_add FROM public.bulk_meal_presets WHERE id=$1", [
        created,
      ])
    ).rows[0].show_in_quick_add,
    true,
  );
  await asUser(existingPresetOwner, () =>
    db.query("SELECT public.set_bulk_meal_preset_quick_add_visibility($1,false)", [existingPreset]),
  );
  const copy = (
    await asUser(existingPresetOwner, () =>
      db.query("SELECT public.duplicate_bulk_meal_preset($1) AS id", [existingPreset]),
    )
  ).rows[0].id;
  const duplicated = (
    await db.query(
      "SELECT source_key,show_in_quick_add FROM public.bulk_meal_presets WHERE id=$1",
      [copy],
    )
  ).rows[0];
  assert.equal(duplicated.source_key, null);
  assert.equal(duplicated.show_in_quick_add, true);
});

test("owner can show/hide presets idempotently without changing order, macros or ingredients", async () => {
  const meal = (
    await createMeal(owner, "Visibility preference", [{ name: "Rice", quantity: 125, unit: "g" }])
  ).rows[0].id;
  const before = (await db.query("SELECT * FROM public.bulk_meal_presets WHERE id=$1", [meal]))
    .rows[0];
  const ingredients = (
    await db.query("SELECT * FROM public.bulk_meal_preset_ingredients WHERE meal_preset_id=$1", [
      meal,
    ])
  ).rows;
  for (const visible of [false, false, true, true, false]) {
    assert.equal(
      (
        await asUser(owner, () =>
          db.query("SELECT public.set_bulk_meal_preset_quick_add_visibility($1,$2) AS ok", [
            meal,
            visible,
          ]),
        )
      ).rows[0].ok,
      true,
    );
    const current = (
      await asUser(owner, () =>
        db.query("SELECT * FROM public.bulk_meal_presets WHERE id=$1", [meal]),
      )
    ).rows[0];
    assert.deepEqual(current, { ...before, show_in_quick_add: visible });
  }
  assert.deepEqual(
    (
      await db.query("SELECT * FROM public.bulk_meal_preset_ingredients WHERE meal_preset_id=$1", [
        meal,
      ])
    ).rows,
    ingredients,
  );
  await asUser(owner, () => db.query("SELECT public.move_bulk_meal_preset($1,-1)", [meal]));
  const moved = (
    await db.query(
      "SELECT sort_order,show_in_quick_add FROM public.bulk_meal_presets WHERE id=$1",
      [meal],
    )
  ).rows[0];
  assert.equal(moved.sort_order, before.sort_order - 1);
  assert.equal(moved.show_in_quick_add, false);
});

test("visibility is owner-only through both RPC and RLS; invalid/unauthenticated calls are rejected", async () => {
  const meal = (await createMeal(owner, "Owner preference")).rows[0].id;
  assert.equal(
    (
      await asUser(other, () =>
        db.query("SELECT public.set_bulk_meal_preset_quick_add_visibility($1,false) AS ok", [meal]),
      )
    ).rows[0].ok,
    false,
  );
  assert.equal(
    (
      await asUser(other, () =>
        db.query(
          "UPDATE public.bulk_meal_presets SET show_in_quick_add=false WHERE id=$1 RETURNING id",
          [meal],
        ),
      )
    ).rows.length,
    0,
  );
  assert.equal(
    (await db.query("SELECT show_in_quick_add FROM public.bulk_meal_presets WHERE id=$1", [meal]))
      .rows[0].show_in_quick_add,
    true,
  );
  await assert.rejects(
    asAnon(() =>
      db.query("SELECT public.set_bulk_meal_preset_quick_add_visibility($1,false)", [meal]),
    ),
    /permission denied/i,
  );
  await assert.rejects(
    asUser("", () =>
      db.query("SELECT public.set_bulk_meal_preset_quick_add_visibility($1,false)", [meal]),
    ),
    /Authentication required/i,
  );
  for (const args of [
    [null, false],
    [meal, null],
  ])
    await assert.rejects(
      asUser(owner, () =>
        db.query("SELECT public.set_bulk_meal_preset_quick_add_visibility($1,$2)", args),
      ),
      /required/i,
    );
  assert.equal(
    (
      await asUser(owner, () =>
        db.query("SELECT public.set_bulk_meal_preset_quick_add_visibility($1,false) AS ok", [
          randomUUID(),
        ]),
      )
    ).rows[0].ok,
    false,
  );

  const profile = (
    await db.query("SELECT bulk_profile_id FROM public.bulk_meal_presets WHERE id=$1", [meal])
  ).rows[0].bulk_profile_id;
  for (const role of ["editor", "viewer"]) {
    const user = randomUUID();
    await db.query("INSERT INTO auth.users(id) VALUES ($1)", [user]);
    await db.query("INSERT INTO public.profiles(id) VALUES ($1)", [user]);
    await db.query(
      "INSERT INTO public.bulk_members(bulk_profile_id,user_id,role) VALUES ($1,$2,$3)",
      [profile, user, role],
    );
    assert.equal(
      (
        await asUser(user, () =>
          db.query("SELECT public.set_bulk_meal_preset_quick_add_visibility($1,false) AS ok", [
            meal,
          ]),
        )
      ).rows[0].ok,
      false,
    );
  }
});

test("visibility requires profile ownership as well as an owner membership", async () => {
  const user = randomUUID();
  const member = randomUUID();
  const profile = randomUUID();
  const meal = randomUUID();
  await db.query("INSERT INTO auth.users(id) VALUES ($1)", [user]);
  await db.query("INSERT INTO auth.users(id) VALUES ($1)", [member]);
  await db.query("INSERT INTO public.profiles(id) VALUES ($1),($2)", [user, member]);
  await db.query(
    "INSERT INTO public.bulk_profiles(id,owner_id,goal_status) VALUES ($1,$2,'active')",
    [profile, user],
  );
  await db.query(
    "INSERT INTO public.bulk_members(bulk_profile_id,user_id,role) VALUES ($1,$2,'owner')",
    [profile, member],
  );
  await db.query(
    "INSERT INTO public.bulk_meal_presets(id,bulk_profile_id,name,sort_order,calories,protein_g,carbs_g,fat_g) VALUES ($1,$2,'Ownership mismatch',1,200,20,10,5)",
    [meal, profile],
  );
  for (const actor of [member, user])
    assert.equal(
      (
        await asUser(actor, () =>
          db.query("SELECT public.set_bulk_meal_preset_quick_add_visibility($1,false) AS ok", [
            meal,
          ]),
        )
      ).rows[0].ok,
      false,
    );
  assert.equal(
    (await db.query("SELECT show_in_quick_add FROM public.bulk_meal_presets WHERE id=$1", [meal]))
      .rows[0].show_in_quick_add,
    true,
  );
});

test("visibility RPC is invoker-only with locked search path and only the new column writable", async () => {
  const definition = (
    await db.query(
      "SELECT prosecdef,proconfig FROM pg_proc WHERE oid='public.set_bulk_meal_preset_quick_add_visibility(uuid,boolean)'::regprocedure",
    )
  ).rows[0];
  assert.equal(definition.prosecdef, false);
  assert.ok(definition.proconfig.includes('search_path=""'));
  const access = (
    await db.query(`SELECT
    has_function_privilege('authenticated','public.set_bulk_meal_preset_quick_add_visibility(uuid,boolean)','EXECUTE') AS authenticated,
    has_function_privilege('anon','public.set_bulk_meal_preset_quick_add_visibility(uuid,boolean)','EXECUTE') AS anon,
    has_function_privilege('service_role','public.set_bulk_meal_preset_quick_add_visibility(uuid,boolean)','EXECUTE') AS service,
    has_table_privilege('authenticated','public.bulk_meal_presets','UPDATE') AS table_update,
    has_column_privilege('authenticated','public.bulk_meal_presets','show_in_quick_add','UPDATE') AS visibility_update,
    (SELECT relrowsecurity FROM pg_class WHERE oid='public.bulk_meal_presets'::regclass) AS rls`)
  ).rows[0];
  assert.deepEqual(access, {
    authenticated: true,
    anon: false,
    service: false,
    table_update: false,
    visibility_update: true,
    rls: true,
  });
  for (const column of [
    "name",
    "bulk_profile_id",
    "calories",
    "sort_order",
    "source_key",
    "updated_at",
  ])
    assert.equal(
      (
        await db.query(
          "SELECT has_column_privilege('authenticated','public.bulk_meal_presets',$1,'UPDATE') AS allowed",
          [column],
        )
      ).rows[0].allowed,
      false,
    );
});

test("custom entries edit independently, aggregate decimals and preserve historical targets", async () => {
  const profile = (await db.query("SELECT id FROM public.bulk_profiles WHERE owner_id=$1", [owner]))
    .rows[0].id;
  const presetCount = Number(
    (
      await db.query(
        "SELECT count(*) AS n FROM public.bulk_meal_presets WHERE bulk_profile_id=$1",
        [profile],
      )
    ).rows[0].n,
  );
  const request = randomUUID();
  const custom = (
    await asUser(owner, () =>
      db.query(
        `SELECT public.create_bulk_nutrition_entry(
          '2026-09-06',$1,'Protein bar',123.45,12.25,14.5,3.75,current_date,'After training'
        ) AS id`,
        [request],
      ),
    )
  ).rows[0].id;
  const retry = (
    await asUser(owner, () =>
      db.query(
        `SELECT public.create_bulk_nutrition_entry(
          '2026-09-06',$1,'Protein bar',123.45,12.25,14.5,3.75,current_date,'After training'
        ) AS id`,
        [request],
      ),
    )
  ).rows[0].id;
  assert.equal(retry, custom);
  assert.equal(
    Number(
      (
        await db.query(
          "SELECT count(*) AS n FROM public.bulk_meal_presets WHERE bulk_profile_id=$1",
          [profile],
        )
      ).rows[0].n,
    ),
    presetCount,
  );

  const aggregate = (
    await db.query(
      `SELECT sum(e.calories) calories,sum(e.protein_g) protein,
        sum(e.carbs_g) carbs,sum(e.fat_g) fat
       FROM public.bulk_nutrition_entries e
       JOIN public.bulk_nutrition_days d ON d.id=e.nutrition_day_id
       WHERE d.bulk_profile_id=$1 AND d.log_date='2026-09-06'`,
      [profile],
    )
  ).rows[0];
  assert.deepEqual(
    [
      Number(aggregate.calories),
      Number(aggregate.protein),
      Number(aggregate.carbs),
      Number(aggregate.fat),
    ],
    [1323.95, 93.25, 135, 45.25],
  );

  const updatedAt = (
    await db.query("SELECT updated_at FROM public.bulk_nutrition_entries WHERE id=$1", [custom])
  ).rows[0].updated_at;
  await asUser(owner, () =>
    db.query(
      "SELECT public.update_bulk_nutrition_entry($1,$2,'Coffee',45.5,1.25,5.5,2.25,current_date,'Edited only here')",
      [custom, updatedAt],
    ),
  );
  const edited = (
    await db.query("SELECT * FROM public.bulk_nutrition_entries WHERE id=$1", [custom])
  ).rows[0];
  assert.equal(edited.name_snapshot, "Coffee");
  assert.equal(Number(edited.calories), 45.5);
  assert.equal(edited.note, "Edited only here");

  await db.query(
    `UPDATE public.bulk_targets
     SET payload=jsonb_set(jsonb_set(payload,'{calories}','3100'),'{protein}','160')
     WHERE bulk_profile_id=$1`,
    [profile],
  );
  const historicalTargets = (
    await db.query(
      "SELECT target_calories,target_protein_g FROM public.bulk_nutrition_days WHERE bulk_profile_id=$1 AND log_date='2026-09-06'",
      [profile],
    )
  ).rows[0];
  assert.deepEqual(
    [Number(historicalTargets.target_calories), Number(historicalTargets.target_protein_g)],
    [2900, 140],
  );

  const countBefore = Number(
    (await db.query("SELECT count(*) AS n FROM public.bulk_nutrition_entries")).rows[0].n,
  );
  assert.equal(
    (
      await asUser(owner, () =>
        db.query("SELECT public.delete_bulk_nutrition_entry($1,current_date) AS ok", [custom]),
      )
    ).rows[0].ok,
    true,
  );
  assert.equal(
    Number((await db.query("SELECT count(*) AS n FROM public.bulk_nutrition_entries")).rows[0].n),
    countBefore - 1,
  );

  await assert.rejects(
    asUser(owner, () =>
      db.query(
        "SELECT public.create_bulk_nutrition_entry('2099-01-01',$1,'Planned meal',1.5,2.5,3.5,4.5,current_date,NULL) AS id",
        [randomUUID()],
      ),
    ),
    /Future nutrition days are view-only/i,
  );
});

test("nutrition RLS and mutation RPCs deny cross-user and anonymous access", async () => {
  const ownerPreset = (await createMeal(owner, "Owner only preset")).rows[0].id;
  const ownerEntry = (
    await asUser(owner, () =>
      db.query("SELECT public.log_bulk_meal_preset($1,'2026-09-07',$2,current_date) AS id", [
        ownerPreset,
        randomUUID(),
      ]),
    )
  ).rows[0].id;
  assert.equal(
    (await asUser(other, () => db.query("SELECT * FROM public.bulk_nutrition_days"))).rows.length,
    0,
  );
  assert.equal(
    (await asUser(other, () => db.query("SELECT * FROM public.bulk_nutrition_entries"))).rows
      .length,
    0,
  );
  await assert.rejects(
    asUser(other, () =>
      db.query("SELECT public.log_bulk_meal_preset($1,'2026-09-07',$2,current_date)", [
        ownerPreset,
        randomUUID(),
      ]),
    ),
    /not found/i,
  );
  const ownerUpdated = (
    await db.query("SELECT updated_at FROM public.bulk_nutrition_entries WHERE id=$1", [ownerEntry])
  ).rows[0].updated_at;
  await assert.rejects(
    asUser(other, () =>
      db.query(
        "SELECT public.update_bulk_nutrition_entry($1,$2,'Stolen',1,1,1,1,current_date,NULL)",
        [ownerEntry, ownerUpdated],
      ),
    ),
    /not found/i,
  );
  assert.equal(
    (
      await asUser(other, () =>
        db.query("SELECT public.delete_bulk_nutrition_entry($1,current_date) AS ok", [ownerEntry]),
      )
    ).rows[0].ok,
    false,
  );
  await assert.rejects(
    asAnon(() => db.query("SELECT * FROM public.bulk_nutrition_days")),
    /permission denied/i,
  );
  await assert.rejects(
    asAnon(() => db.query("SELECT * FROM public.bulk_nutrition_entries")),
    /permission denied/i,
  );
});

test("future nutrition is read-only at every mutation boundary with local-day tolerance", async () => {
  const profile = (await db.query("SELECT id FROM public.bulk_profiles WHERE owner_id=$1", [owner]))
    .rows[0].id;
  const preset = (await createMeal(owner, "Future guard preset")).rows[0].id;

  await assert.rejects(
    asUser(owner, () =>
      db.query("SELECT public.log_bulk_meal_preset($1,'2098-01-01',$2,current_date)", [
        preset,
        randomUUID(),
      ]),
    ),
    /Future nutrition days are view-only/i,
  );
  await assert.rejects(
    asUser(owner, () =>
      db.query(
        "SELECT public.create_bulk_nutrition_entry('2098-01-01',$1,'Future custom',1,1,1,1,current_date,NULL)",
        [randomUUID()],
      ),
    ),
    /Future nutrition days are view-only/i,
  );
  assert.equal(
    Number(
      (
        await db.query(
          "SELECT count(*) AS n FROM public.bulk_nutrition_days WHERE bulk_profile_id=$1 AND log_date='2098-01-01'",
          [profile],
        )
      ).rows[0].n,
    ),
    0,
  );

  const futureDay = randomUUID();
  const futureEntry = randomUUID();
  await db.query(
    `INSERT INTO public.bulk_nutrition_days(
      id,bulk_profile_id,log_date,target_calories,target_protein_g,target_carbs_g,target_fat_g
    ) VALUES ($1,$2,'2099-01-01',2900,140,360,90)`,
    [futureDay, profile],
  );
  await db.query(
    `INSERT INTO public.bulk_nutrition_entries(
      id,nutrition_day_id,source_type,name_snapshot,calories,protein_g,carbs_g,fat_g,
      sort_order,request_id
    ) VALUES ($1,$2,'custom','Protected future entry',1,1,1,1,1,$3)`,
    [futureEntry, futureDay, randomUUID()],
  );
  const updatedAt = (
    await db.query("SELECT updated_at FROM public.bulk_nutrition_entries WHERE id=$1", [
      futureEntry,
    ])
  ).rows[0].updated_at;
  await assert.rejects(
    asUser(owner, () =>
      db.query(
        "SELECT public.update_bulk_nutrition_entry($1,$2,'Changed',2,2,2,2,current_date,NULL)",
        [futureEntry, updatedAt],
      ),
    ),
    /Future nutrition days are view-only/i,
  );
  await assert.rejects(
    asUser(owner, () =>
      db.query("SELECT public.delete_bulk_nutrition_entry($1,current_date)", [futureEntry]),
    ),
    /Future nutrition days are view-only/i,
  );
  assert.equal(
    Number(
      (
        await db.query("SELECT count(*) AS n FROM public.bulk_nutrition_entries WHERE id=$1", [
          futureEntry,
        ])
      ).rows[0].n,
    ),
    1,
  );

  const timezoneEntry = (
    await asUser(owner, () =>
      db.query(
        "SELECT public.create_bulk_nutrition_entry(current_date + 1,$1,'Local today',1,1,1,1,current_date + 1,NULL) AS id",
        [randomUUID()],
      ),
    )
  ).rows[0].id;
  assert.ok(timezoneEntry);
});

test("calorie recommendation application is bounded, idempotent and calorie-only", async () => {
  const ownerProfile = (
    await db.query("SELECT id FROM public.bulk_profiles WHERE owner_id=$1", [owner])
  ).rows[0].id;
  const otherProfile = (
    await db.query("SELECT id FROM public.bulk_profiles WHERE owner_id=$1", [other])
  ).rows[0].id;
  const before = (
    await db.query("SELECT payload FROM public.bulk_targets WHERE bulk_profile_id=$1", [
      ownerProfile,
    ])
  ).rows[0].payload;
  const current = Number(before.calories);
  const next = Math.floor((current + 150) / 50) * 50;
  assert.equal(
    (
      await asUser(owner, () =>
        db.query("SELECT public.apply_bulk_calorie_recommendation($1,$2) AS ok", [current, next]),
      )
    ).rows[0].ok,
    true,
  );
  assert.equal(
    (
      await asUser(owner, () =>
        db.query("SELECT public.apply_bulk_calorie_recommendation($1,$2) AS ok", [current, next]),
      )
    ).rows[0].ok,
    true,
  );
  const after = (
    await db.query("SELECT payload FROM public.bulk_targets WHERE bulk_profile_id=$1", [
      ownerProfile,
    ])
  ).rows[0].payload;
  assert.equal(Number(after.calories), next);
  assert.equal(after.protein, before.protein);
  assert.equal(after.carbs, before.carbs);
  assert.equal(after.fat, before.fat);
  await assert.rejects(
    asUser(owner, () =>
      db.query("SELECT public.apply_bulk_calorie_recommendation($1,$2)", [current, next + 50]),
    ),
    /another device/i,
  );
  await assert.rejects(
    asUser(owner, () =>
      db.query("SELECT public.apply_bulk_calorie_recommendation($1,$2)", [next, next + 500]),
    ),
    /outside/i,
  );
  await assert.rejects(
    asUser(owner, () =>
      db.query("SELECT public.apply_bulk_calorie_recommendation($1,$2)", [next, next + 125]),
    ),
    /outside/i,
  );
  await assert.rejects(
    asAnon(() =>
      db.query("SELECT public.apply_bulk_calorie_recommendation($1,$2)", [next, next + 150]),
    ),
    /permission denied/i,
  );
  assert.equal(
    Number(
      (
        await db.query(
          "SELECT payload->>'calories' AS calories FROM public.bulk_targets WHERE bulk_profile_id=$1",
          [otherProfile],
        )
      ).rows[0].calories,
    ),
    2900,
  );

  const historical = await db.query(
    "SELECT target_calories FROM public.bulk_nutrition_days WHERE bulk_profile_id=$1 AND log_date='2026-09-06'",
    [ownerProfile],
  );
  assert.equal(Number(historical.rows[0].target_calories), 2900);
  await asUser(owner, () =>
    db.query(
      "SELECT public.create_bulk_nutrition_entry(current_date,$1,'After adjustment',1,1,1,1,current_date,NULL)",
      [randomUUID()],
    ),
  );
  assert.equal(
    Number(
      (
        await db.query(
          "SELECT target_calories FROM public.bulk_nutrition_days WHERE bulk_profile_id=$1 AND log_date=current_date",
          [ownerProfile],
        )
      ).rows[0].target_calories,
    ),
    next,
  );
});

test("plan switching and Goal reset preserve completed public history", async () => {
  const profile = (await db.query("SELECT id FROM public.bulk_profiles WHERE owner_id=$1", [owner]))
    .rows[0].id;
  const presetsBeforeReset = Number(
    (
      await db.query(
        "SELECT count(*) AS n FROM public.bulk_meal_presets WHERE bulk_profile_id=$1",
        [profile],
      )
    ).rows[0].n,
  );
  const legacyDaysBeforeReset = Number(
    (
      await db.query(
        "SELECT count(*) AS n FROM public.bulk_days WHERE bulk_profile_id=$1 AND payload ? 'mealPlan'",
        [profile],
      )
    ).rows[0].n,
  );
  const originalPlan = (
    await asUser(owner, () =>
      db.query(
        "SELECT public.instantiate_bulk_training_plan('template:intermediate-upper-lower-4','generated') AS id",
      ),
    )
  ).rows[0].id;
  const originalDay = (
    await db.query(
      "SELECT id FROM public.bulk_training_plan_days WHERE plan_id=$1 ORDER BY day_order LIMIT 1",
      [originalPlan],
    )
  ).rows[0].id;
  const completedSession = randomUUID();
  await db.query(
    `INSERT INTO public.bulk_training_sessions(
      id,bulk_profile_id,training_plan_id,source_plan_day_id,plan_name_snapshot,
      workout_day_name_snapshot,workout_day_order_snapshot,status,completed_at
    ) VALUES ($1,$2,$3,$4,'Original plan','Completed day',1,'completed',now())`,
    [completedSession, profile, originalPlan, originalDay],
  );

  const replacementPlan = (
    await asUser(owner, () =>
      db.query(
        "SELECT public.switch_bulk_training_plan('template:beginner-full-body-3','tempo_preset') AS id",
      ),
    )
  ).rows[0].id;
  assert.notEqual(replacementPlan, originalPlan);
  assert.deepEqual(
    (
      await db.query(
        "SELECT id,active FROM public.bulk_training_plans WHERE id IN ($1,$2) ORDER BY id",
        [originalPlan, replacementPlan],
      )
    ).rows
      .map((row) => [row.id, row.active])
      .sort(([left], [right]) => left.localeCompare(right)),
    [
      [originalPlan, false],
      [replacementPlan, true],
    ].sort(([left], [right]) => left.localeCompare(right)),
  );
  assert.equal(
    Number(
      (
        await db.query("SELECT count(*) AS n FROM public.bulk_training_sessions WHERE id=$1", [
          completedSession,
        ])
      ).rows[0].n,
    ),
    1,
  );

  const replacementDay = (
    await db.query(
      "SELECT id FROM public.bulk_training_plan_days WHERE plan_id=$1 ORDER BY day_order LIMIT 1",
      [replacementPlan],
    )
  ).rows[0].id;
  const activeSession = (
    await asUser(owner, () =>
      db.query("SELECT public.start_bulk_training_session($1) AS id", [replacementDay]),
    )
  ).rows[0].id;
  await assert.rejects(
    asUser(owner, () =>
      db.query("SELECT public.switch_bulk_training_plan('template:advanced-ppl-6','generated')"),
    ),
    /Finish or discard your current workout before changing plans/i,
  );
  await asUser(owner, () =>
    db.query("SELECT public.discard_bulk_training_session($1)", [activeSession]),
  );

  assert.equal(
    (await asUser(owner, () => db.query("SELECT public.deactivate_public_goal() AS id"))).rows[0]
      .id,
    profile,
  );
  const reset = (
    await db.query(
      `SELECT goal_status,
        (SELECT count(*) FROM public.bulk_targets WHERE bulk_profile_id=p.id) AS target_count,
        (SELECT count(*) FROM public.bulk_training_sessions WHERE bulk_profile_id=p.id AND status='completed') AS completed_count
       FROM public.bulk_profiles p WHERE p.id=$1`,
      [profile],
    )
  ).rows[0];
  assert.equal(reset.goal_status, "inactive");
  assert.equal(Number(reset.target_count), 0);
  assert.equal(Number(reset.completed_count), 1);
  assert.equal(
    Number(
      (
        await db.query(
          "SELECT count(*) AS n FROM public.bulk_meal_presets WHERE bulk_profile_id=$1",
          [profile],
        )
      ).rows[0].n,
    ),
    presetsBeforeReset,
  );
  assert.equal(
    Number(
      (
        await db.query(
          "SELECT count(*) AS n FROM public.bulk_training_plans WHERE bulk_profile_id=$1",
          [profile],
        )
      ).rows[0].n,
    ),
    2,
  );
  await assert.rejects(
    asUser(owner, () =>
      db.query("SELECT public.switch_bulk_training_plan('template:advanced-ppl-6','generated')"),
    ),
    /Active Goal profile required/i,
  );
  assert.equal(
    (
      await asUser(owner, () =>
        db.query(
          `SELECT public.complete_goal_onboarding(
            'maintain',70,70,0,'intermediate',4,ARRAY['dumbbells','bench'],'custom',2500,140,300,80
          ) AS id`,
        ),
      )
    ).rows[0].id,
    profile,
  );
  const reactivated = (
    await db.query(
      `SELECT goal_status,
        (SELECT count(*) FROM public.bulk_targets WHERE bulk_profile_id=p.id) AS target_count,
        (SELECT count(*) FROM public.bulk_training_sessions WHERE bulk_profile_id=p.id AND status='completed') AS completed_count
       FROM public.bulk_profiles p WHERE p.id=$1`,
      [profile],
    )
  ).rows[0];
  assert.equal(reactivated.goal_status, "active");
  assert.equal(Number(reactivated.target_count), 1);
  assert.equal(Number(reactivated.completed_count), 1);
  assert.equal(
    Number(
      (
        await db.query(
          "SELECT count(*) AS n FROM public.bulk_meal_presets WHERE bulk_profile_id=$1",
          [profile],
        )
      ).rows[0].n,
    ),
    presetsBeforeReset,
  );
  assert.equal(
    Number(
      (
        await db.query(
          "SELECT count(*) AS n FROM public.bulk_days WHERE bulk_profile_id=$1 AND payload ? 'mealPlan'",
          [profile],
        )
      ).rows[0].n,
    ),
    legacyDaysBeforeReset,
  );
  await assert.rejects(
    asUser(owner, () =>
      db.query("UPDATE public.bulk_profiles SET goal_status='inactive' WHERE id=$1", [profile]),
    ),
    /permission denied/i,
  );
});

test("Bulk and Cut switching resets only current Goal configuration", async () => {
  const switcher = randomUUID();
  await db.query("INSERT INTO auth.users VALUES ($1)", [switcher]);
  await db.query("INSERT INTO public.profiles(id,display_name) VALUES ($1,'Goal switcher')", [
    switcher,
  ]);
  const profile = (
    await asUser(switcher, () =>
      db.query(
        `SELECT public.complete_goal_onboarding(
          'gain',70,78,0.25,'intermediate',4,ARRAY['dumbbells','bench'],'custom',2900,140,360,90
        ) AS id`,
      ),
    )
  ).rows[0].id;
  const meal = (await createMeal(switcher, "Reusable oats")).rows[0].id;
  await asUser(switcher, () =>
    db.query("SELECT public.switch_to_empty_bulk_training_plan('custom')"),
  );

  await asUser(switcher, () => db.query("SELECT public.deactivate_public_goal()"));
  const afterBulk = (
    await db.query(
      `SELECT p.goal_status,
        (SELECT count(*) FROM public.bulk_targets WHERE bulk_profile_id=p.id) AS targets,
        (SELECT count(*) FROM public.bulk_training_plans WHERE bulk_profile_id=p.id AND active) AS active_plans,
        (SELECT count(*) FROM public.bulk_meal_presets WHERE id=$2) AS meals,
        (SELECT count(*) FROM public.profiles WHERE id=$1) AS identity
       FROM public.bulk_profiles p WHERE p.id=$3`,
      [switcher, meal, profile],
    )
  ).rows[0];
  assert.equal(afterBulk.goal_status, "inactive");
  assert.equal(Number(afterBulk.targets), 0);
  assert.equal(Number(afterBulk.active_plans), 0);
  assert.equal(Number(afterBulk.meals), 1);
  assert.equal(Number(afterBulk.identity), 1);

  await asUser(switcher, () =>
    db.query(
      `SELECT public.complete_goal_onboarding(
        'cut',70,62,0.5,'intermediate',4,ARRAY['dumbbells','bench'],'custom',2200,150,240,70
      )`,
    ),
  );
  assert.equal(
    (
      await db.query(
        "SELECT payload->>'goal' AS goal FROM public.bulk_targets WHERE bulk_profile_id=$1",
        [profile],
      )
    ).rows[0].goal,
    "cut",
  );
  await asUser(switcher, () => db.query("SELECT public.deactivate_public_goal()"));
  await asUser(switcher, () =>
    db.query(
      `SELECT public.complete_goal_onboarding(
        'gain',70,78,0.25,'intermediate',4,ARRAY['dumbbells','bench'],'custom',2900,140,360,90
      )`,
    ),
  );
  const afterCut = (
    await db.query(
      `SELECT p.goal_status, t.payload->>'goal' AS goal,
        (SELECT count(*) FROM public.bulk_meal_presets WHERE id=$2) AS meals,
        (SELECT count(*) FROM public.profiles WHERE id=$1) AS identity
       FROM public.bulk_profiles p
       JOIN public.bulk_targets t ON t.bulk_profile_id=p.id
       WHERE p.id=$3`,
      [switcher, meal, profile],
    )
  ).rows[0];
  assert.equal(afterCut.goal_status, "active");
  assert.equal(afterCut.goal, "gain");
  assert.equal(Number(afterCut.meals), 1);
  assert.equal(Number(afterCut.identity), 1);
});

test("all Tempo templates use valid metadata and retain whole-body coverage", async () => {
  const templates = (
    await db.query(
      "SELECT id,experience_level FROM public.bulk_training_plan_templates WHERE active ORDER BY id",
    )
  ).rows;
  const days = (
    await db.query("SELECT id,template_id FROM public.bulk_training_plan_template_days")
  ).rows;
  const planned = (
    await db.query(
      "SELECT template_day_id,exercise_id,sets,intended_unilateral_mode FROM public.bulk_training_plan_template_exercises",
    )
  ).rows;
  const metadata = (
    await db.query(
      "SELECT id,primary_muscle,secondary_muscles,active FROM public.bulk_exercises WHERE is_system AND active",
    )
  ).rows;
  assert.equal(templates.length, 9);
  const valid = new Set(MUSCLE_GROUPS);
  for (const exercise of metadata) {
    assert.equal(valid.has(exercise.primary_muscle), true, `${exercise.id} primary muscle`);
    assert.equal(
      new Set(exercise.secondary_muscles).size,
      exercise.secondary_muscles.length,
      `${exercise.id} duplicate secondary muscle`,
    );
    assert.equal(
      exercise.secondary_muscles.includes(exercise.primary_muscle),
      false,
      `${exercise.id} duplicates its primary muscle`,
    );
    for (const muscle of exercise.secondary_muscles)
      assert.equal(valid.has(muscle), true, `${exercise.id} secondary muscle`);
  }
  for (const template of templates) {
    const templateDays = days
      .filter((day) => day.template_id === template.id)
      .map((day) => ({
        id: day.id,
        exercises: planned
          .filter((entry) => entry.template_day_id === day.id)
          .map((entry, index) => ({
            id: `${day.id}:${index}`,
            exerciseId: entry.exercise_id,
            name: entry.exercise_id,
            sets: entry.sets,
            intendedUnilateralMode: entry.intended_unilateral_mode,
          })),
      }));
    const result = calculateMuscleCoverage({ days: templateDays }, metadata);
    const effective = (muscle) => result.muscles.find((row) => row.muscle === muscle).effectiveSets;
    assert.ok(effective("chest") > 0, `${template.id} has chest work`);
    assert.ok(effective("lats") + effective("upper_back") > 0, `${template.id} has pulling work`);
    assert.ok(effective("quads") > 0, `${template.id} has knee-dominant work`);
    assert.ok(effective("hamstrings") > 0, `${template.id} has hamstring work`);
    assert.ok(effective("glutes") > 0, `${template.id} has glute work`);
    if (template.experience_level === "beginner") {
      assert.ok(effective("calves") > 0, `${template.id} has calf work`);
      assert.ok(
        effective("abs") + effective("obliques") + effective("lower_back") > 0,
        `${template.id} has core work`,
      );
    }
  }
});

async function historyFixture() {
  const user = randomUUID();
  await db.query("INSERT INTO auth.users VALUES ($1)", [user]);
  await db.query("INSERT INTO public.profiles(id) VALUES ($1)", [user]);
  const profile = (
    await asUser(user, () =>
      db.query(
        `SELECT public.complete_goal_onboarding('gain',70,78,0.25,'intermediate',4,ARRAY['full_gym'],'custom',2900,140,360,90) AS id`,
      ),
    )
  ).rows[0].id;
  const session = randomUUID(),
    exercise = randomUUID();
  await db.query(
    `INSERT INTO public.bulk_training_sessions(id,bulk_profile_id,plan_name_snapshot,workout_day_name_snapshot,workout_day_order_snapshot,started_at,workout_date,bodyweight_kg) VALUES ($1,$2,'Preserved plan','Upper A',1,'2026-09-28T12:00:00Z','2026-09-28',70)`,
    [session, profile],
  );
  await db.query(
    `INSERT INTO public.bulk_training_session_exercises(id,session_id,exercise_name_snapshot,exercise_order,execution_mode,is_bodyweight,target_sets,target_rep_min,target_rep_max,notes_snapshot) VALUES ($1,$2,'Incline press',1,'bilateral',false,3,8,12,'Bench 3')`,
    [exercise, session],
  );
  const sets = [];
  for (const [index, type] of ["warmup", "normal", "failure", "drop"].entries()) {
    const id = randomUUID();
    sets.push(id);
    await db.query(
      `INSERT INTO public.bulk_training_session_sets(id,session_exercise_id,set_order,set_type,bilateral_weight,bilateral_reps,rpe) VALUES ($1,$2,$3,$4,24,10,8)`,
      [id, exercise, index + 1, type],
    );
  }
  await db.query(
    `UPDATE public.bulk_training_sessions SET status='completed',completed_at='2026-09-28T13:00:00Z' WHERE id=$1`,
    [session],
  );
  return { user, profile, session, exercise, sets };
}
const correction = (f, args = []) =>
  asUser(f.user, () =>
    db.query(
      `SELECT public.correct_completed_bulk_training_set($1,$2,$3,$4,NULL,NULL,NULL,NULL,$5,$6) AS id`,
      [f.session, f.sets[1], args[0] ?? 26, args[1] ?? 12, args[2] ?? "normal", args[3] ?? 8.5],
    ),
  );

test("completed-set corrections are narrow, owner authorized, validated and transaction-scoped", async () => {
  const f = await historyFixture();
  const snapshot = (
    await db.query(
      "SELECT * FROM public.bulk_training_session_sets WHERE session_exercise_id=$1 ORDER BY set_order",
      [f.exercise],
    )
  ).rows;
  assert.equal((await correction(f)).rows[0].id, f.sets[1]);
  const updated = (
    await db.query(
      "SELECT * FROM public.bulk_training_session_sets WHERE session_exercise_id=$1 ORDER BY set_order",
      [f.exercise],
    )
  ).rows;
  assert.equal(Number(updated[1].bilateral_weight), 26);
  assert.equal(updated[1].bilateral_reps, 12);
  assert.equal(Number(updated[1].rpe), 8.5);
  for (const i of [0, 2, 3]) assert.deepEqual(updated[i], snapshot[i]);
  for (const args of [
    [26, 12, "invalid", 8],
    [26, 12, "normal", 5],
    [26, 12, "normal", 8.2],
    [1001, 12],
    [26, 0],
  ])
    await assert.rejects(correction(f, args));
  assert.equal(
    Number(
      (await db.query("SELECT count(*) AS n FROM private.bulk_completed_set_corrections")).rows[0]
        .n,
    ),
    0,
  );
  await assert.rejects(
    db.query("UPDATE public.bulk_training_session_sets SET bilateral_weight=99 WHERE id=$1", [
      f.sets[1],
    ]),
    /Completed workouts cannot be changed/,
  );
  await assert.rejects(
    asUser(f.user, () =>
      db.query("UPDATE public.bulk_training_session_sets SET bilateral_weight=99 WHERE id=$1", [
        f.sets[1],
      ]),
    ),
    /permission denied/,
  );
  await assert.rejects(
    asUser(f.user, () =>
      db.query("INSERT INTO private.bulk_completed_set_corrections VALUES (txid_current(),$1,$2)", [
        f.sets[1],
        f.user,
      ]),
    ),
    /permission denied/,
  );
  await assert.rejects(
    asUser(other, () =>
      db.query(
        `SELECT public.correct_completed_bulk_training_set($1,$2,25,12,NULL,NULL,NULL,NULL,'normal',8)`,
        [f.session, f.sets[1]],
      ),
    ),
    /Completed workout not found/,
  );
  await assert.rejects(
    asAnon(() =>
      db.query(
        `SELECT public.correct_completed_bulk_training_set($1,$2,25,12,NULL,NULL,NULL,NULL,'normal',8)`,
        [f.session, f.sets[1]],
      ),
    ),
    /permission denied/,
  );
  assert.equal(
    Number(
      (
        await db.query(
          "SELECT bilateral_weight FROM public.bulk_training_session_sets WHERE id=$1",
          [f.sets[1]],
        )
      ).rows[0].bilateral_weight,
    ),
    26,
  );
});

test("time correction preserves the local calendar day at UTC boundaries and changes no sets or bodyweight", async () => {
  const f = await historyFixture();
  const sets = (
    await db.query(
      "SELECT * FROM public.bulk_training_session_sets WHERE session_exercise_id=$1 ORDER BY set_order",
      [f.exercise],
    )
  ).rows;
  const time = (date, start, end, zone = "Europe/Stockholm") =>
    asUser(f.user, () =>
      db.query("SELECT public.correct_completed_bulk_training_time($1,$2,$3,$4,$5)", [
        f.session,
        date,
        start,
        end,
        zone,
      ]),
    );
  await time("2026-10-02", "2026-10-01T22:30:00Z", "2026-10-01T23:15:00Z");
  const row = (
    await db.query("SELECT * FROM public.bulk_training_sessions WHERE id=$1", [f.session])
  ).rows[0];
  assert.equal(new Date(row.workout_date).toISOString().slice(0, 10), "2026-10-02");
  assert.equal(Number(row.bodyweight_kg), 70);
  assert.equal(Date.parse(row.completed_at) - Date.parse(row.started_at), 45 * 60 * 1000);
  await assert.rejects(time("2026-10-02", "2026-10-01T22:30Z", "2026-10-01T22:30Z"), /End time/);
  await assert.rejects(time("2026-10-02", "2026-10-01T22:30Z", "2026-10-01T22:00Z"), /End time/);
  await assert.rejects(
    time("2026-10-01", "2026-10-01T22:30Z", "2026-10-01T23:15Z"),
    /local start date/,
  );
  await assert.rejects(
    time("2026-10-02", "2026-10-01T22:30Z", "2026-10-01T23:15Z", "fake/timezone"),
    /Invalid timezone/,
  );
  await assert.rejects(
    asUser(other, () =>
      db.query(
        `SELECT public.correct_completed_bulk_training_time($1,'2026-10-02','2026-10-01T22:30Z','2026-10-01T23:15Z','Europe/Stockholm')`,
        [f.session],
      ),
    ),
    /Completed workout not found/,
  );
  assert.deepEqual(
    (
      await db.query(
        "SELECT * FROM public.bulk_training_session_sets WHERE session_exercise_id=$1 ORDER BY set_order",
        [f.exercise],
      )
    ).rows,
    sets,
  );
});

test("repeat copies prescriptions into new incomplete sets without mutating history or an existing active workout", async () => {
  const f = await historyFixture();
  const before = (
    await db.query("SELECT * FROM public.bulk_training_sessions WHERE id=$1", [f.session])
  ).rows[0];
  const repeat = () =>
    asUser(f.user, () =>
      db.query("SELECT public.repeat_completed_bulk_training_session($1,CURRENT_DATE) AS id", [
        f.session,
      ]),
    );
  await assert.rejects(
    asUser(other, () =>
      db.query("SELECT public.repeat_completed_bulk_training_session($1,CURRENT_DATE)", [
        f.session,
      ]),
    ),
    /Completed workout not found/,
  );
  await assert.rejects(
    asAnon(() =>
      db.query("SELECT public.repeat_completed_bulk_training_session($1,CURRENT_DATE)", [
        f.session,
      ]),
    ),
    /permission denied/,
  );
  const id = (await repeat()).rows[0].id;
  assert.notEqual(id, f.session);
  const row = (await db.query("SELECT * FROM public.bulk_training_sessions WHERE id=$1", [id]))
    .rows[0];
  assert.equal(row.status, "in_progress");
  assert.equal(row.completed_at, null);
  assert.notEqual(row.started_at, before.started_at);
  const exercises = (
    await db.query(
      "SELECT * FROM public.bulk_training_session_exercises WHERE session_id=$1 ORDER BY exercise_order",
      [id],
    )
  ).rows;
  assert.equal(exercises[0].exercise_name_snapshot, "Incline press");
  assert.equal(exercises[0].target_sets, 3);
  assert.equal(exercises[0].target_rep_min, 8);
  assert.equal(exercises[0].target_rep_max, 12);
  assert.equal(exercises[0].notes_snapshot, "Bench 3");
  const sets = (
    await db.query(
      "SELECT * FROM public.bulk_training_session_sets WHERE session_exercise_id=$1 ORDER BY set_order",
      [exercises[0].id],
    )
  ).rows;
  assert.deepEqual(
    sets.map((s) => s.set_type),
    ["warmup", "normal", "failure", "drop"],
  );
  assert.ok(
    sets.every(
      (s) =>
        Number(s.bilateral_weight) === 24 &&
        s.bilateral_reps === null &&
        s.rpe === null &&
        !s.is_complete &&
        !f.sets.includes(s.id),
    ),
  );
  await assert.rejects(repeat(), (e) => e.code === "55000" && e.detail === "active_workout_exists");
  assert.deepEqual(
    (await db.query("SELECT * FROM public.bulk_training_sessions WHERE id=$1", [f.session]))
      .rows[0],
    before,
  );
  assert.equal(
    Number(
      (
        await db.query(
          "SELECT count(*) AS n FROM public.bulk_training_sessions WHERE bulk_profile_id=$1 AND status='in_progress'",
          [f.profile],
        )
      ).rows[0].n,
    ),
    1,
  );
});

test("history RPC grants stay authenticated-only and tables stay read-only under RLS", async () => {
  const signatures = [
    "public.correct_completed_bulk_training_set(uuid,uuid,numeric,integer,numeric,integer,numeric,integer,text,numeric)",
    "public.correct_completed_bulk_training_time(uuid,date,timestamptz,timestamptz,text)",
    "public.repeat_completed_bulk_training_session(uuid,date)",
    "public.correct_legacy_bulk_workout_time(date,date,timestamptz,timestamptz,text)",
    "public.repeat_legacy_bulk_workout(date,date)",
  ];
  for (const signature of signatures) {
    const row = (
      await db.query(
        `SELECT prosecdef,proconfig,has_function_privilege('authenticated',oid,'EXECUTE') AS allowed,has_function_privilege('anon',oid,'EXECUTE') AS anon,has_function_privilege('service_role',oid,'EXECUTE') AS service FROM pg_proc WHERE oid=$1::regprocedure`,
        [signature],
      )
    ).rows[0];
    assert.equal(row.prosecdef, true);
    assert.ok(row.proconfig.includes('search_path=""'));
    assert.equal(row.allowed, true);
    assert.equal(row.anon, false);
    assert.equal(row.service, false);
  }
  for (const table of [
    "bulk_training_sessions",
    "bulk_training_session_exercises",
    "bulk_training_session_sets",
  ]) {
    assert.equal(
      (
        await db.query(`SELECT has_table_privilege('authenticated',$1,'UPDATE') AS allowed`, [
          `public.${table}`,
        ])
      ).rows[0].allowed,
      false,
    );
    assert.equal(
      (
        await db.query("SELECT relrowsecurity FROM pg_class WHERE oid=$1::regclass", [
          `public.${table}`,
        ])
      ).rows[0].relrowsecurity,
      true,
    );
  }
});

test("deleting a corrected workout removes its children but preserves unrelated data", async () => {
  const f = await historyFixture();
  const second = await historyFixture();
  await correction(f);
  assert.equal(
    (
      await asUser(other, () =>
        db.query("SELECT public.delete_completed_bulk_training_session($1) AS ok", [f.session]),
      )
    ).rows[0].ok,
    false,
  );
  assert.equal(
    (
      await asUser(f.user, () =>
        db.query("SELECT public.delete_completed_bulk_training_session($1) AS ok", [f.session]),
      )
    ).rows[0].ok,
    true,
  );
  assert.equal(
    Number(
      (
        await db.query(
          "SELECT count(*) AS n FROM public.bulk_training_session_sets WHERE session_exercise_id=$1",
          [f.exercise],
        )
      ).rows[0].n,
    ),
    0,
  );
  assert.equal(
    Number(
      (
        await db.query(
          "SELECT count(*) AS n FROM public.bulk_training_session_exercises WHERE session_id=$1",
          [f.session],
        )
      ).rows[0].n,
    ),
    0,
  );
  assert.equal(
    Number(
      (
        await db.query("SELECT count(*) AS n FROM public.bulk_training_sessions WHERE id=$1", [
          second.session,
        ])
      ).rows[0].n,
    ),
    1,
  );
  assert.equal(
    Number(
      (await db.query("SELECT count(*) AS n FROM public.bulk_profiles WHERE id=$1", [f.profile]))
        .rows[0].n,
    ),
    1,
  );
});

test("legacy time correction and repeat keep JSON history and same-day nutrition intact", async () => {
  const f = await historyFixture();
  const day = "2026-09-27";
  const payload = {
    date: day,
    type: "Chest & Back",
    entries: [
      {
        exercise: "Incline Dumbbell Press",
        weight: 24,
        reps: [10, 9, 8],
        rpe: 8,
        notes: "Saved note",
      },
    ],
    durationSeconds: 999,
    status: "completed",
    sessionNote: "Do not lose",
  };
  await db.query(
    "INSERT INTO public.bulk_workouts(bulk_profile_id,day,payload) VALUES ($1,$2,$3::jsonb)",
    [f.profile, day, JSON.stringify(payload)],
  );
  await db.query(
    "INSERT INTO public.bulk_days(bulk_profile_id,day,payload) VALUES ($1,$2,$3::jsonb)",
    [f.profile, day, JSON.stringify({ calories: 2900, weight: 70, note: "Nutrition" })],
  );
  await asUser(f.user, () =>
    db.query(
      `SELECT public.correct_legacy_bulk_workout_time($1,$1,'2026-09-27T10:00Z','2026-09-27T10:45Z','UTC')`,
      [day],
    ),
  );
  const corrected = (
    await db.query("SELECT payload FROM public.bulk_workouts WHERE bulk_profile_id=$1 AND day=$2", [
      f.profile,
      day,
    ])
  ).rows[0].payload;
  assert.deepEqual(corrected.entries, payload.entries);
  assert.equal(corrected.sessionNote, payload.sessionNote);
  assert.equal(corrected.durationSeconds, 2700);
  const repeated = (
    await asUser(f.user, () =>
      db.query("SELECT public.repeat_legacy_bulk_workout($1,CURRENT_DATE) AS id", [day]),
    )
  ).rows[0].id;
  assert.ok(repeated);
  assert.deepEqual(
    (
      await db.query(
        "SELECT payload FROM public.bulk_workouts WHERE bulk_profile_id=$1 AND day=$2",
        [f.profile, day],
      )
    ).rows[0].payload,
    corrected,
  );
  assert.deepEqual(
    (
      await db.query("SELECT payload FROM public.bulk_days WHERE bulk_profile_id=$1 AND day=$2", [
        f.profile,
        day,
      ])
    ).rows[0].payload,
    { calories: 2900, weight: 70, note: "Nutrition" },
  );
});

test("history migration is safely re-runnable and does not update preserved workouts", async () => {
  const f = await historyFixture();
  const before = (
    await db.query("SELECT * FROM public.bulk_training_sessions WHERE id=$1", [f.session])
  ).rows;
  const sets = (
    await db.query(
      "SELECT * FROM public.bulk_training_session_sets WHERE session_exercise_id=$1 ORDER BY set_order",
      [f.exercise],
    )
  ).rows;
  await db.exec(
    await readFile(new URL("20261005140000_owner_workout_history_actions.sql", root), "utf8"),
  );
  assert.deepEqual(
    (await db.query("SELECT * FROM public.bulk_training_sessions WHERE id=$1", [f.session])).rows,
    before,
  );
  assert.deepEqual(
    (
      await db.query(
        "SELECT * FROM public.bulk_training_session_sets WHERE session_exercise_id=$1 ORDER BY set_order",
        [f.exercise],
      )
    ).rows,
    sets,
  );
  assert.equal(
    (
      await db.query(
        "SELECT has_function_privilege('anon','public.correct_completed_bulk_training_time(uuid,date,timestamptz,timestamptz,text)','EXECUTE') AS allowed",
      )
    ).rows[0].allowed,
    false,
  );
  await correction(f);
});

test("completed corrections preserve unilateral sides, reject active/missing/wrong-session sets and repeat preserves exercise order", async () => {
  const f = await historyFixture();
  await db.query(
    "UPDATE public.bulk_training_sessions SET status='in_progress',completed_at=NULL WHERE id=$1",
    [f.session],
  );
  await assert.rejects(correction(f), /Completed workout not found/);
  const exercise = randomUUID(),
    set = randomUUID();
  await db.query(
    `INSERT INTO public.bulk_training_session_exercises(id,session_id,exercise_name_snapshot,exercise_order,execution_mode,is_bodyweight,target_sets,target_rep_min,target_rep_max) VALUES ($1,$2,'One-arm row',2,'unilateral',false,2,8,12)`,
    [exercise, f.session],
  );
  await db.query(
    `INSERT INTO public.bulk_training_session_sets(id,session_exercise_id,set_order,left_weight,left_reps,right_weight,right_reps,rpe) VALUES ($1,$2,1,20,10,22,9,7.5)`,
    [set, exercise],
  );
  await db.query(
    "UPDATE public.bulk_training_sessions SET status='completed',completed_at='2026-09-28T13:00Z' WHERE id=$1",
    [f.session],
  );
  const otherWorkout = await historyFixture();
  await assert.rejects(
    asUser(f.user, () =>
      db.query(
        "SELECT public.correct_completed_bulk_training_set($1,$2,26,12,NULL,NULL,NULL,NULL,'normal',8)",
        [f.session, otherWorkout.sets[0]],
      ),
    ),
    /Workout set not found/,
  );
  await assert.rejects(
    asUser(f.user, () =>
      db.query(
        "SELECT public.correct_completed_bulk_training_set($1,$2,26,12,NULL,NULL,NULL,NULL,'normal',8)",
        [randomUUID(), f.sets[0]],
      ),
    ),
    /Completed workout not found/,
  );
  await asUser(f.user, () =>
    db.query(
      "SELECT public.correct_completed_bulk_training_set($1,$2,NULL,NULL,24,12,26,11,'failure',9.5)",
      [f.session, set],
    ),
  );
  const corrected = (
    await db.query("SELECT * FROM public.bulk_training_session_sets WHERE id=$1", [set])
  ).rows[0];
  assert.equal(Number(corrected.left_weight), 24);
  assert.equal(corrected.left_reps, 12);
  assert.equal(Number(corrected.right_weight), 26);
  assert.equal(corrected.right_reps, 11);
  assert.equal(corrected.set_type, "failure");
  assert.equal(Number(corrected.rpe), 9.5);
  const id = (
    await asUser(f.user, () =>
      db.query("SELECT public.repeat_completed_bulk_training_session($1,CURRENT_DATE) AS id", [
        f.session,
      ]),
    )
  ).rows[0].id;
  const copies = (
    await db.query(
      "SELECT * FROM public.bulk_training_session_exercises WHERE session_id=$1 ORDER BY exercise_order",
      [id],
    )
  ).rows;
  assert.deepEqual(
    copies.map((e) => e.exercise_name_snapshot),
    ["Incline press", "One-arm row"],
  );
  assert.deepEqual(
    copies.map((e) => e.exercise_order),
    [1, 2],
  );
  const copied = (
    await db.query("SELECT * FROM public.bulk_training_session_sets WHERE session_exercise_id=$1", [
      copies[1].id,
    ])
  ).rows[0];
  assert.equal(Number(copied.left_weight), 24);
  assert.equal(Number(copied.right_weight), 26);
  assert.equal(copied.left_reps, null);
  assert.equal(copied.right_reps, null);
  assert.equal(copied.rpe, null);
  assert.equal(copied.is_complete, false);
});

test("repeat rejects legacy draft collisions and unsupported prescriptions without modifying the source", async () => {
  const f = await historyFixture();
  const day = "2026-09-26";
  const source = {
    date: day,
    type: "Legs",
    status: "completed",
    entries: [{ exercise: "Squat", weight: 40, reps: [101], bodyweight: null }],
  };
  await db.query(
    "INSERT INTO public.bulk_workouts(bulk_profile_id,day,payload) VALUES ($1,$2,$3::jsonb)",
    [f.profile, day, JSON.stringify(source)],
  );
  await assert.rejects(
    asUser(other, () =>
      db.query("SELECT public.repeat_legacy_bulk_workout($1,CURRENT_DATE)", [day]),
    ),
    /Completed workout not found/,
  );
  await assert.rejects(
    asUser(f.user, () =>
      db.query("SELECT public.repeat_legacy_bulk_workout($1,CURRENT_DATE)", [day]),
    ),
    /exceeds the normalized plan limits/,
  );
  assert.deepEqual(
    (
      await db.query(
        "SELECT payload FROM public.bulk_workouts WHERE bulk_profile_id=$1 AND day=$2",
        [f.profile, day],
      )
    ).rows[0].payload,
    source,
  );
  assert.equal(
    Number(
      (
        await db.query(
          "SELECT count(*) AS n FROM public.bulk_training_sessions WHERE bulk_profile_id=$1 AND status='in_progress'",
          [f.profile],
        )
      ).rows[0].n,
    ),
    0,
  );
  source.entries[0].reps = [10];
  await db.query(
    "UPDATE public.bulk_workouts SET payload=$3::jsonb WHERE bulk_profile_id=$1 AND day=$2",
    [f.profile, day, JSON.stringify(source)],
  );
  await db.query(
    'INSERT INTO public.bulk_workouts(bulk_profile_id,day,payload) VALUES ($1,CURRENT_DATE,\'{"status":"draft"}\')',
    [f.profile],
  );
  await assert.rejects(
    asUser(f.user, () =>
      db.query("SELECT public.repeat_completed_bulk_training_session($1,CURRENT_DATE)", [
        f.session,
      ]),
    ),
    (e) => e.code === "55000" && e.detail === "active_workout_exists",
  );
  await assert.rejects(
    asUser(f.user, () =>
      db.query("SELECT public.repeat_legacy_bulk_workout($1,CURRENT_DATE)", [day]),
    ),
    (e) => e.code === "55000" && e.detail === "active_workout_exists",
  );
  await db.query("DELETE FROM public.bulk_workouts WHERE bulk_profile_id=$1 AND day=CURRENT_DATE", [
    f.profile,
  ]);
  const id = (
    await asUser(f.user, () =>
      db.query("SELECT public.repeat_legacy_bulk_workout($1,CURRENT_DATE) AS id", [day]),
    )
  ).rows[0].id;
  const exercise = (
    await db.query("SELECT * FROM public.bulk_training_session_exercises WHERE session_id=$1", [id])
  ).rows[0];
  assert.equal(exercise.is_bodyweight, false);
  assert.equal(exercise.target_rep_min, 10);
  assert.equal(exercise.target_rep_max, 10);
});

// Meals redesign: execute the real accumulated schema/RPCs, not a SQL mock.
test("meal categories persist on retroactive custom/preset entries and update without changing snapshots", async () => {
  const f = await nutritionTargetFixture();
  const today = (await db.query("SELECT current_date::text AS day")).rows[0].day;
  const preset = (await createMeal(f.user, "Imported category meal")).rows[0].id;
  const request = randomUUID();
  const log = (category) =>
    asUser(f.user, () =>
      db.query("SELECT public.log_bulk_meal_preset($1,'2001-01-01',$2,$3,$4,'UTC') AS id", [
        preset,
        request,
        today,
        category,
      ]),
    );
  const id = (await log("breakfast")).rows[0].id;
  assert.equal(
    (await log("dinner")).rows[0].id,
    id,
    "retry retains first category and one occurrence",
  );
  const before = (await db.query("SELECT * FROM public.bulk_nutrition_entries WHERE id=$1", [id]))
    .rows[0];
  assert.equal(before.meal_category, "breakfast");
  assert.equal(before.source_meal_preset_id, preset);
  const snapshot = (
    await db.query("SELECT * FROM public.bulk_nutrition_days WHERE id=$1", [
      before.nutrition_day_id,
    ])
  ).rows[0];
  for (const field of ["target_calories", "target_protein_g", "target_carbs_g", "target_fat_g"])
    assert.equal(snapshot[field], null);
  await asUser(f.user, () =>
    db.query(
      "SELECT public.update_bulk_nutrition_entry($1,$2,'Renamed',500,40,60,12,$3,'Note','lunch','UTC')",
      [id, before.updated_at, today],
    ),
  );
  const edited = (await db.query("SELECT * FROM public.bulk_nutrition_entries WHERE id=$1", [id]))
    .rows[0];
  assert.equal(edited.meal_category, "lunch");
  assert.equal(Number(edited.calories), 500);
  assert.deepEqual(
    (
      await db.query("SELECT * FROM public.bulk_nutrition_days WHERE id=$1", [
        before.nutrition_day_id,
      ])
    ).rows[0],
    snapshot,
  );
  assert.equal(
    (await db.query("SELECT name FROM public.bulk_meal_presets WHERE id=$1", [preset])).rows[0]
      .name,
    "Imported category meal",
  );
  const custom = (
    await asUser(f.user, () =>
      db.query(
        "SELECT public.create_bulk_nutrition_entry('2001-01-02',$1,'Snack',200,10,25,6,$2,NULL,'snacks','UTC') AS id",
        [randomUUID(), today],
      ),
    )
  ).rows[0].id;
  assert.equal(
    (
      await db.query("SELECT meal_category FROM public.bulk_nutrition_entries WHERE id=$1", [
        custom,
      ])
    ).rows[0].meal_category,
    "snacks",
  );
  await assert.rejects(
    asUser(f.user, () =>
      db.query(
        "SELECT public.create_bulk_nutrition_entry('2001-01-02',$1,'Bad',200,10,25,6,$2,NULL,'invented','UTC')",
        [randomUUID(), today],
      ),
    ),
    /Invalid meal category/,
  );
  assert.equal(
    Number(
      (
        await db.query(
          "SELECT count(*) AS n FROM public.bulk_nutrition_days WHERE bulk_profile_id=$1 AND log_date=$2",
          [f.profile, today],
        )
      ).rows[0].n,
    ),
    0,
    "retroactive logging never creates today's log",
  );
  assert.deepEqual(
    (
      await db.query("SELECT payload FROM public.bulk_targets WHERE bulk_profile_id=$1", [
        f.profile,
      ])
    ).rows[0].payload,
    f.targets,
  );
});

test("effective target versions resolve by local day while old unrecorded targets remain unknown", async () => {
  const f = await nutritionTargetFixture();
  const dates = (
    await db.query(
      "SELECT current_date::text AS today,(current_date-10)::text AS first,(current_date-5)::text AS second,(current_date-7)::text AS middle",
    )
  ).rows[0];
  // Reliable dated versions are test fixtures, never migration backfills.
  await db.query(
    `INSERT INTO public.bulk_nutrition_target_history(bulk_profile_id,effective_from,calories,protein_g,carbs_g,fat_g,timezone)
    VALUES ($1,$2,2200,140,250,70,'UTC'),($1,$3,2600,150,320,80,'UTC')`,
    [f.profile, dates.first, dates.second],
  );
  const create = (date) =>
    asUser(f.user, () =>
      db.query(
        "SELECT public.create_bulk_nutrition_entry($1,$2,'Historical meal',600,40,70,20,$3,NULL,'dinner','UTC')",
        [date, randomUUID(), dates.today],
      ),
    );
  await create(dates.middle);
  await create(dates.second);
  await create("2001-01-01");
  const rows = (
    await db.query(
      "SELECT log_date::text,target_calories FROM public.bulk_nutrition_days WHERE bulk_profile_id=$1 ORDER BY log_date",
      [f.profile],
    )
  ).rows;
  assert.deepEqual(
    rows.map((row) => [
      row.log_date,
      row.target_calories == null ? null : Number(row.target_calories),
    ]),
    [
      ["2001-01-01", null],
      [dates.middle, 2200],
      [dates.second, 2600],
    ],
  );
  const saved = await asUser(f.user, () => f.save({ ...f.targets, calories: 3000 }, "UTC"));
  assert.equal(saved.rows[0].day, dates.today);
  const unchanged = (
    await db.query(
      "SELECT log_date::text,target_calories FROM public.bulk_nutrition_days WHERE bulk_profile_id=$1 ORDER BY log_date",
      [f.profile],
    )
  ).rows;
  assert.deepEqual(unchanged, rows);
  await create(dates.today);
  assert.equal(
    Number(
      (
        await db.query(
          "SELECT target_calories FROM public.bulk_nutrition_days WHERE bulk_profile_id=$1 AND log_date=$2",
          [f.profile, dates.today],
        )
      ).rows[0].target_calories,
    ),
    3000,
  );
  assert.equal(
    (
      await asUser(f.user, () =>
        db.query("SELECT public.bulk_nutrition_targets_for_day($1,'2001-01-01','UTC') AS targets", [
          f.profile,
        ]),
      )
    ).rows[0].targets.calories,
    null,
  );
  assert.equal(
    (
      await asUser(f.user, () =>
        db.query("SELECT public.bulk_nutrition_targets_for_day($1,'2000-01-01','UTC') AS targets", [
          f.profile,
        ]),
      )
    ).rows[0].targets,
    null,
  );
  assert.equal(
    (
      await db.query(
        "SELECT count(*) AS n FROM public.bulk_nutrition_target_history WHERE bulk_profile_id=$1 AND effective_from=$2",
        [f.profile, dates.today],
      )
    ).rows[0].n,
    1,
  );
});

test("nutrition history and category RPCs preserve owner isolation, RLS and anon denial", async () => {
  const f = await nutritionTargetFixture();
  const stranger = await nutritionTargetFixture();
  const today = (await db.query("SELECT current_date::text AS day")).rows[0].day;
  await asUser(f.user, () =>
    db.query("SELECT public.bulk_nutrition_targets_for_day($1,$2,'UTC')", [f.profile, today]),
  );
  const id = (
    await asUser(f.user, () =>
      db.query(
        "SELECT public.create_bulk_nutrition_entry($1,$2,'Owned',1,1,1,1,$1,NULL,'breakfast','UTC') AS id",
        [today, randomUUID()],
      ),
    )
  ).rows[0].id;
  const updated = (
    await db.query("SELECT updated_at FROM public.bulk_nutrition_entries WHERE id=$1", [id])
  ).rows[0].updated_at;
  await assert.rejects(
    asUser(stranger.user, () =>
      db.query("SELECT public.bulk_nutrition_targets_for_day($1,$2,'UTC')", [f.profile, today]),
    ),
    /Goal profile not found/,
  );
  await assert.rejects(
    asUser(stranger.user, () =>
      db.query(
        "SELECT public.update_bulk_nutrition_entry($1,$2,'Forged',1,1,1,1,$3,NULL,'snacks','UTC')",
        [id, updated, today],
      ),
    ),
    /Nutrition entry not found/,
  );
  assert.equal(
    (
      await asUser(stranger.user, () =>
        db.query("SELECT * FROM public.bulk_nutrition_target_history WHERE bulk_profile_id=$1", [
          f.profile,
        ]),
      )
    ).rows.length,
    0,
  );
  await assert.rejects(
    asUser(f.user, () =>
      db.query(
        "UPDATE public.bulk_nutrition_target_history SET calories=1000 WHERE bulk_profile_id=$1",
        [f.profile],
      ),
    ),
    /permission denied/,
  );
  await assert.rejects(
    asAnon(() =>
      db.query("SELECT public.bulk_nutrition_targets_for_day($1,$2,'UTC')", [f.profile, today]),
    ),
    /permission denied/,
  );
  await assert.rejects(
    asUser("", () =>
      db.query("SELECT public.bulk_nutrition_targets_for_day($1,$2,'UTC')", [f.profile, today]),
    ),
    /Goal profile not found/,
  );
  await assert.rejects(
    asUser(f.user, () =>
      db.query("SELECT public.bulk_nutrition_targets_for_day($1,$2,'invalid/timezone')", [
        f.profile,
        today,
      ]),
    ),
    /Invalid device timezone/,
  );
  await assert.rejects(
    asUser(f.user, () =>
      db.query("SELECT public.bulk_nutrition_targets_for_day($1,$2,NULL)", [f.profile, today]),
    ),
    /Invalid device timezone/,
  );
  const functions = (
    await db.query(
      `SELECT proname,prosecdef,proconfig,has_function_privilege('anon',oid,'EXECUTE') AS anon FROM pg_proc WHERE proname IN ('bulk_nutrition_targets_for_day','create_bulk_nutrition_entry','log_bulk_meal_preset','update_bulk_nutrition_entry')`,
    )
  ).rows;
  assert.ok(
    functions.every(
      (fn) =>
        fn.prosecdef &&
        !fn.anon &&
        fn.proconfig.some((setting) => setting.startsWith("search_path=")),
    ),
  );
});

test("nutrition category migration preserves pre-existing entries and target snapshots without seeding history", async () => {
  assert.ok(preservedNutrition);
  const { entry, day, profile } = preservedNutrition;
  const afterEntry = (
    await db.query("SELECT * FROM public.bulk_nutrition_entries WHERE id=$1", [entry.id])
  ).rows[0];
  assert.equal(afterEntry.meal_category, null);
  const { meal_category, ...rest } = afterEntry;
  assert.deepEqual(rest, entry);
  assert.deepEqual(
    (await db.query("SELECT * FROM public.bulk_nutrition_days WHERE id=$1", [day.id])).rows[0],
    day,
  );
  assert.equal(
    Number(
      (
        await db.query(
          "SELECT count(*) AS n FROM public.bulk_nutrition_target_history WHERE bulk_profile_id=$1",
          [profile],
        )
      ).rows[0].n,
    ),
    0,
  );
});

test("meal logging uses the submitted local day across UTC, month and year boundaries without timezone leakage", async () => {
  const signatures = [
    "private.record_bulk_nutrition_targets(uuid,text,date)",
    "private.prepare_bulk_nutrition_write(date,text)",
    "private.validate_bulk_nutrition_write_day(date,date)",
  ];
  const originals = [];
  for (const signature of signatures)
    originals.push(
      (await db.query("SELECT pg_get_functiondef($1::regprocedure) AS definition", [signature]))
        .rows[0].definition,
    );
  try {
    for (const [instant, zone, localDay] of [
      ["2025-12-31T23:05:00Z", "Europe/Stockholm", "2026-01-01"],
      ["2026-01-31T10:05:00Z", "Pacific/Kiritimati", "2026-02-01"],
      ["2026-02-01T01:05:00Z", "America/Los_Angeles", "2026-01-31"],
    ]) {
      for (const original of originals)
        await db.exec(
          original
            .replaceAll("pg_catalog.now()", `'${instant}'::timestamptz`)
            .replaceAll("current_date", `('${instant}'::timestamptz AT TIME ZONE 'UTC')::date`),
        );
      const f = await nutritionTargetFixture();
      await asUser(f.user, () =>
        db.query(
          "SELECT public.create_bulk_nutrition_entry($1,$2,'Local meal',100,10,10,2,$1,NULL,'breakfast',$3)",
          [localDay, randomUUID(), zone],
        ),
      );
      const row = (
        await db.query(
          "SELECT log_date::text,target_calories FROM public.bulk_nutrition_days WHERE bulk_profile_id=$1",
          [f.profile],
        )
      ).rows[0];
      assert.equal(row.log_date, localDay);
      assert.equal(Number(row.target_calories), 2400);
      const history = (
        await db.query(
          "SELECT effective_from::text,timezone FROM public.bulk_nutrition_target_history WHERE bulk_profile_id=$1",
          [f.profile],
        )
      ).rows;
      assert.deepEqual(history, [{ effective_from: localDay, timezone: zone }]);
      assert.equal((await db.query("SHOW TimeZone")).rows[0].TimeZone, "UTC");
      const before = Number(
        (await db.query("SELECT count(*) AS n FROM public.bulk_nutrition_entries")).rows[0].n,
      );
      const tomorrow = (await db.query("SELECT ($1::date+1)::text AS day", [localDay])).rows[0].day;
      await assert.rejects(
        asUser(f.user, () =>
          db.query(
            "SELECT public.create_bulk_nutrition_entry($1,$2,'Future',100,10,10,2,$3,NULL,'breakfast',$4)",
            [tomorrow, randomUUID(), localDay, zone],
          ),
        ),
        /Future nutrition days are view-only/,
      );
      assert.equal(
        Number(
          (await db.query("SELECT count(*) AS n FROM public.bulk_nutrition_entries")).rows[0].n,
        ),
        before,
      );
    }
  } finally {
    for (const original of originals) await db.exec(original);
  }
});
