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
