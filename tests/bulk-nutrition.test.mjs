import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  emptyNutritionEntryDraft,
  isIsoLocalDay,
  nutritionMacroStatus,
  nutritionSummary,
  totalNutrition,
  validateNutritionEntryDraft,
} from "../src/lib/bulk-nutrition.ts";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");
const entry = (overrides = {}) => ({
  id: "entry",
  nutritionDayId: "day",
  sourceMealPresetId: null,
  sourceType: "custom",
  name: "Meal",
  calories: 600.25,
  protein: 40.5,
  carbs: 60.25,
  fat: 20.75,
  ingredients: [],
  note: null,
  sortOrder: 1,
  createdAt: "2026-09-06T12:00:00Z",
  updatedAt: "2026-09-06T12:00:00Z",
  ...overrides,
});

test("daily totals aggregate decimal macros without display noise", () => {
  assert.deepEqual(totalNutrition([]), { calories: 0, protein: 0, carbs: 0, fat: 0 });
  assert.deepEqual(
    totalNutrition([
      entry(),
      entry({ id: "two", calories: 123.45, protein: 12.25, carbs: 14.5, fat: 3.75 }),
    ]),
    { calories: 723.7, protein: 52.75, carbs: 74.75, fat: 24.5 },
  );
});

test("remaining, reached and over status works neutrally for every macro", () => {
  assert.deepEqual(nutritionMacroStatus(2450, 2800), {
    consumed: 2450,
    target: 2800,
    delta: 350,
    status: "under",
  });
  assert.deepEqual(nutritionMacroStatus(2950, 2800), {
    consumed: 2950,
    target: 2800,
    delta: 150,
    status: "over",
  });
  assert.equal(nutritionMacroStatus(140, 140).status, "at");
  const summary = nutritionSummary([entry()], {
    calories: 500,
    protein: 45,
    carbs: 60.25,
    fat: 25,
  });
  assert.equal(summary.calories.status, "over");
  assert.equal(summary.protein.status, "under");
  assert.equal(summary.carbs.status, "at");
  assert.equal(summary.fat.status, "under");
});

test("custom entry validation accepts decimals and rejects invalid macros", () => {
  const draft = {
    ...emptyNutritionEntryDraft(),
    name: "Restaurant meal",
    calories: "812,5",
    protein: "42.25",
    carbs: "95.5",
    fat: "27.75",
    note: "Estimated from menu",
  };
  assert.deepEqual(validateNutritionEntryDraft(draft).input, {
    name: "Restaurant meal",
    calories: 812.5,
    protein: 42.25,
    carbs: 95.5,
    fat: 27.75,
    note: "Estimated from menu",
  });
  for (const field of ["calories", "protein", "carbs", "fat"]) {
    const invalid = { ...draft, [field]: "-1" };
    assert.ok(
      validateNutritionEntryDraft(invalid).errors.some((error) =>
        error.toLowerCase().includes(field),
      ),
    );
  }
});

test("logical nutrition days reject malformed or impossible local dates", () => {
  assert.equal(isIsoLocalDay("2026-09-06"), true);
  assert.equal(isIsoLocalDay("2026-02-29"), false);
  assert.equal(isIsoLocalDay("2026-13-01"), false);
  assert.equal(isIsoLocalDay("09/06/2026"), false);
});

test("nutrition UI keeps daily logging and route-backed preset management distinct", async () => {
  const [component, route, presetRoute, historyRoute, query, presetComponent, cache] =
    await Promise.all([
      read("src/components/BulkNutritionLog.tsx"),
      read("src/routes/_authenticated/bulk/meals.tsx"),
      read("src/routes/_authenticated/bulk/meals_.presets.tsx"),
      read("src/routes/_authenticated/bulk/meals_.history.tsx"),
      read("src/lib/bulk-nutrition-query.ts"),
      read("src/components/BulkMealPresets.tsx"),
      read("src/lib/query-cancellation.ts"),
    ]);
  assert.match(route, /BulkNutritionLog/);
  assert.doesNotMatch(route, /BulkMealPresets|hidden=\{view|hash === "presets"/);
  assert.match(route, /publicNutrition[\s\S]*BulkNutritionLog/);
  assert.match(route, /selectedDate=\{selectedDate\}/);
  assert.match(presetRoute, /BulkMealPresets/);
  assert.doesNotMatch(presetRoute, /BulkNutritionLog/);
  assert.match(historyRoute, /useBulkNutritionDay/);
  assert.match(historyRoute, /Logged meals and entries/);
  assert.match(component, /Previous day/);
  assert.match(component, /Next day/);
  assert.match(component, /\n\s*Today\n/);
  assert.match(component, /Planning a future day/);
  assert.match(component, /Log to \{format\(parseISO\(selectedDate\)/);
  assert.match(component, /Retry same log/);
  assert.match(component, /failedPreset\.requestId/);
  assert.match(component, /Discard the unsaved nutrition entry/);
  assert.match(component, /Add Custom Entry/);
  assert.match(component, /Saved meal snapshot/);
  assert.match(component, /Nothing logged for this day/);
  assert.match(query, /bulkNutritionDayQueryKey\(bulkProfileId, logDate\)/);
  assert.match(query, /log_bulk_meal_preset/);
  assert.match(presetComponent, /Create Meal/);
  assert.match(cache, /"bulk-nutrition-day"/);
});

test("nutrition migration snapshots history and leaves legacy My Bulk data separate", async () => {
  const migration = await read("supabase/migrations/20260906210000_public_bulk_nutrition_logs.sql");
  assert.match(migration, /CREATE TABLE public\.bulk_nutrition_days/);
  assert.match(migration, /CREATE TABLE public\.bulk_nutrition_entries/);
  assert.match(migration, /UNIQUE \(bulk_profile_id, log_date\)/);
  assert.match(migration, /ingredient_snapshot jsonb/);
  assert.match(migration, /ON DELETE SET NULL/);
  assert.match(migration, /request_id uuid NOT NULL/);
  assert.match(migration, /pg_advisory_xact_lock/);
  assert.match(migration, /private\.current_bulk_profile\(\)/);
  assert.match(migration, /SECURITY DEFINER\s+SET search_path = ''/);
  assert.match(
    migration,
    /REVOKE ALL ON public\.bulk_nutrition_days FROM PUBLIC, anon, authenticated/,
  );
  assert.doesNotMatch(migration, /UPDATE public\.bulk_days|DELETE FROM public\.bulk_days/);
  assert.doesNotMatch(migration, /Salmon|Beef|Lentils/);
});
