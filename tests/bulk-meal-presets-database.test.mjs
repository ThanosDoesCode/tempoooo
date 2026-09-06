import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";

const db = new PGlite();
const root = new URL("../supabase/migrations/", import.meta.url);
const owner = randomUUID();
const other = randomUUID();

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
  for (const file of (await readdir(root)).filter((name) => name.endsWith(".sql")).sort()) {
    try {
      await db.exec(await readFile(new URL(file, root), "utf8"));
    } catch (error) {
      throw new Error(`Migration failed: ${file}`, { cause: error });
    }
  }
  for (const id of [owner, other]) {
    await db.query("INSERT INTO auth.users VALUES ($1)", [id]);
    await db.query("INSERT INTO public.profiles(id,display_name) VALUES ($1,'Meal owner')", [id]);
    await asUser(id, () =>
      db.query(
        `SELECT public.complete_bulk_onboarding(
          70,78,0.25,'intermediate',4,ARRAY['dumbbells','bench'],'custom',2900,140,360,90
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
      db.query("SELECT public.log_bulk_meal_preset($1,'2026-09-06',$2) AS id", [
        preset,
        firstRequest,
      ]),
    )
  ).rows[0].id;
  const retryEntry = (
    await asUser(owner, () =>
      db.query("SELECT public.log_bulk_meal_preset($1,'2026-09-06',$2) AS id", [
        preset,
        firstRequest,
      ]),
    )
  ).rows[0].id;
  const secondEntry = (
    await asUser(owner, () =>
      db.query("SELECT public.log_bulk_meal_preset($1,'2026-09-06',$2) AS id", [
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
          '2026-09-06',$1,'Protein bar',123.45,12.25,14.5,3.75,'After training'
        ) AS id`,
        [request],
      ),
    )
  ).rows[0].id;
  const retry = (
    await asUser(owner, () =>
      db.query(
        `SELECT public.create_bulk_nutrition_entry(
          '2026-09-06',$1,'Protein bar',123.45,12.25,14.5,3.75,'After training'
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
      "SELECT public.update_bulk_nutrition_entry($1,$2,'Coffee',45.5,1.25,5.5,2.25,'Edited only here')",
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
        db.query("SELECT public.delete_bulk_nutrition_entry($1) AS ok", [custom]),
      )
    ).rows[0].ok,
    true,
  );
  assert.equal(
    Number((await db.query("SELECT count(*) AS n FROM public.bulk_nutrition_entries")).rows[0].n),
    countBefore - 1,
  );

  const future = (
    await asUser(owner, () =>
      db.query(
        "SELECT public.create_bulk_nutrition_entry('2099-01-01',$1,'Planned meal',1.5,2.5,3.5,4.5,NULL) AS id",
        [randomUUID()],
      ),
    )
  ).rows[0].id;
  assert.ok(future);
});

test("nutrition RLS and mutation RPCs deny cross-user and anonymous access", async () => {
  const ownerPreset = (await createMeal(owner, "Owner only preset")).rows[0].id;
  const ownerEntry = (
    await asUser(owner, () =>
      db.query("SELECT public.log_bulk_meal_preset($1,'2026-09-07',$2) AS id", [
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
      db.query("SELECT public.log_bulk_meal_preset($1,'2026-09-07',$2)", [
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
      db.query("SELECT public.update_bulk_nutrition_entry($1,$2,'Stolen',1,1,1,1,NULL)", [
        ownerEntry,
        ownerUpdated,
      ]),
    ),
    /not found/i,
  );
  assert.equal(
    (
      await asUser(other, () =>
        db.query("SELECT public.delete_bulk_nutrition_entry($1) AS ok", [ownerEntry]),
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
