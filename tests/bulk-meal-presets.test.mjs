import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  BULK_MEAL_UNITS,
  emptyBulkMealDraft,
  moveDraftIngredient,
  validateBulkMealDraft,
} from "../src/lib/bulk-meal-presets.ts";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");
const validDraft = () => ({
  ...emptyBulkMealDraft(),
  name: "Chicken rice",
  calories: "612.5",
  protein: "48.25",
  carbs: "72.75",
  fat: "14.5",
});

test("meal draft accepts decimal macros and a macro-only preset", () => {
  const result = validateBulkMealDraft(validDraft());
  assert.deepEqual(result.errors, []);
  assert.deepEqual(result.input, {
    name: "Chicken rice",
    description: null,
    calories: 612.5,
    protein: 48.25,
    carbs: 72.75,
    fat: 14.5,
    ingredients: [],
  });
});

test("meal and macro validation rejects invalid names and every negative total", () => {
  for (const field of ["calories", "protein", "carbs", "fat"]) {
    const draft = validDraft();
    draft[field] = "-1";
    assert.ok(
      validateBulkMealDraft(draft).errors.some((error) => error.toLowerCase().includes(field)),
    );
  }
  assert.ok(validateBulkMealDraft({ ...validDraft(), name: "x" }).errors.length > 0);
  assert.ok(validateBulkMealDraft({ ...validDraft(), calories: "NaN" }).errors.length > 0);
});

test("ingredients validate quantity and unit and retain deterministic order", () => {
  assert.deepEqual(BULK_MEAL_UNITS, [
    "g",
    "ml",
    "piece",
    "slice",
    "tbsp",
    "tsp",
    "pack",
    "serving",
  ]);
  const draft = validDraft();
  draft.ingredients = [
    { key: "salmon", name: "Salmon", quantity: "125.5", unit: "g" },
    { key: "rice", name: "Rice", quantity: "1", unit: "pack" },
  ];
  assert.deepEqual(validateBulkMealDraft(draft).input?.ingredients, [
    { name: "Salmon", quantity: 125.5, unit: "g" },
    { name: "Rice", quantity: 1, unit: "pack" },
  ]);
  assert.deepEqual(
    moveDraftIngredient(draft.ingredients, 0, 1).map((row) => row.key),
    ["rice", "salmon"],
  );
  assert.equal(moveDraftIngredient(draft.ingredients, 0, -1), draft.ingredients);
  assert.equal(moveDraftIngredient(draft.ingredients, 1, 1), draft.ingredients);
  draft.ingredients[0].quantity = "0";
  assert.ok(validateBulkMealDraft(draft).errors.some((error) => /greater than 0/.test(error)));
});

test("public meal UI uses explicit saves, local errors and mobile-safe controls", async () => {
  const [component, route, query, shell, cache, legacy] = await Promise.all([
    read("src/components/BulkMealPresets.tsx"),
    read("src/routes/_authenticated/bulk/meals_.presets.tsx"),
    read("src/lib/bulk-meal-presets-query.ts"),
    read("src/components/AppShell.tsx"),
    read("src/lib/query-cancellation.ts"),
    read("src/lib/meals.ts"),
  ]);
  assert.match(component, /No meal presets yet/);
  assert.match(component, /Create your first meal/);
  assert.match(component, /Save meal/);
  assert.match(component, /inputMode="decimal"/);
  assert.match(component, /Discard unsaved meal changes/);
  assert.match(component, /Move ingredient/);
  assert.match(component, /This cannot be undone/);
  assert.match(route, /BulkMealPresets/);
  assert.match(shell, /to: PRODUCT_LANDING_ROUTES\.meals/);
  assert.match(query, /Promise\.all/);
  assert.match(query, /bulkMealPresetsQueryKey\(bulkProfileId\)/);
  assert.match(cache, /"bulk-meal-presets"/);
  assert.match(legacy, /id: "salmon"/);
  assert.match(legacy, /id: "beef"/);
  assert.match(legacy, /id: "lentil"/);
  assert.doesNotMatch(query, /MEAL_PLANS|bulk_days/);
});

test("Segment 9 migration is structured, owner-scoped and leaves legacy nutrition alone", async () => {
  const migration = await read("supabase/migrations/20260906200000_public_bulk_meal_presets.sql");
  assert.match(migration, /CREATE TABLE public\.bulk_meal_presets/);
  assert.match(migration, /CREATE TABLE public\.bulk_meal_preset_ingredients/);
  assert.match(migration, /private\.current_bulk_profile\(\)/);
  assert.match(migration, /auth\.uid\(\)/);
  assert.match(migration, /SECURITY DEFINER\s+SET search_path = ''/);
  assert.match(migration, /DEFERRABLE INITIALLY DEFERRED/);
  assert.match(migration, /current_updated_at IS DISTINCT FROM _expected_updated_at/);
  assert.match(
    migration,
    /REVOKE ALL ON public\.bulk_meal_presets FROM PUBLIC, anon, authenticated/,
  );
  assert.doesNotMatch(migration, /UPDATE public\.bulk_days|DELETE FROM public\.bulk_days/);
  assert.doesNotMatch(migration, /Salmon|Beef|Lentils/);
});
