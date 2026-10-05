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
let originalWeightDateConstraint;

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
async function withDatabaseClock(timestamp, action) {
  const original = (
    await db.query(
      "SELECT pg_get_functiondef('public.save_bulk_weight_for_local_day(uuid,date,numeric,text,text)'::regprocedure) AS definition",
    )
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
      "SELECT source_meal_preset_id,name_snapshot,calories,ingredient_snapshot FROM public.bulk_nutrition_entries WHERE id=$1",
      [firstEntry],
    )
  ).rows[0];
  assert.equal(afterPresetDelete.source_meal_preset_id, null);
  assert.equal(afterPresetDelete.name_snapshot, "Snapshot meal");
  assert.equal(Number(afterPresetDelete.calories), 600.25);
  assert.equal(afterPresetDelete.ingredient_snapshot[0].name, "Rice");
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
