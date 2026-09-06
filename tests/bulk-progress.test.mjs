import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  bulkWeek,
  goalProgress,
  nutritionWeekSummary,
  trainingConsistency,
  validateWeight,
  weeklyProgressSummary,
  weeklyWeightAverage,
} from "../src/lib/bulk-progress.ts";

const weight = (date, kg, id = date) => ({
  id,
  bulkProfileId: "profile",
  logDate: date,
  weightKg: kg,
  note: null,
  createdAt: "",
  updatedAt: "",
});

test("Monday weeks average only actual decimal weigh-ins", () => {
  assert.deepEqual(bulkWeek("2026-09-09"), { start: "2026-09-07", end: "2026-09-13" });
  assert.deepEqual(
    weeklyWeightAverage(
      [weight("2026-09-07", 61.2), weight("2026-09-09", 61.75), weight("2026-09-14", 100)],
      "2026-09-07",
    ),
    { averageKg: 61.48, count: 2 },
  );
  assert.deepEqual(weeklyWeightAverage([], "2026-09-07"), { averageKg: null, count: 0 });
});

test("weekly change and incomplete-week data quality remain explicit", () => {
  const summary = weeklyProgressSummary({
    selectedDay: "2026-09-09",
    weights: [weight("2026-09-01", 61.5), weight("2026-09-03", 61.7), weight("2026-09-08", 62.0)],
    nutritionDays: [],
    completedWorkoutDates: [],
    plannedWorkouts: 4,
    targetWeeklyGainKg: 0.25,
  });
  assert.equal(summary.weightAverageKg, 62);
  assert.equal(summary.previousWeightAverageKg, 61.6);
  assert.equal(summary.weightChangeKg, 0.4);
  assert.equal(summary.weightEntryCount, 1);
  assert.equal(summary.previousWeightEntryCount, 2);
  assert.equal(summary.targetWeeklyGainKg, 0.25);
  assert.equal(
    weeklyProgressSummary({
      selectedDay: "2026-09-09",
      weights: [weight("2026-09-08", 62)],
      nutritionDays: [],
      completedWorkoutDates: [],
      plannedWorkouts: null,
      targetWeeklyGainKg: null,
    }).weightChangeKg,
    null,
  );
});

test("goal progress prefers weekly average then latest weight and preserves onboarding values", () => {
  const weights = [weight("2026-09-05", 62.5), weight("2026-09-08", 63.2)];
  assert.deepEqual(goalProgress(weights, 63, 61.5, 75), {
    currentWeightKg: 63,
    source: "weekly_average",
    gainedKg: 1.5,
    remainingKg: 12,
    percent: 11.11111111111111,
  });
  assert.equal(goalProgress(weights, null, 61.5, 75).currentWeightKg, 63.2);
  assert.equal(goalProgress([weight("2026-09-08", 80)], 80, 61.5, 75).percent, 100);
});

test("training consistency caps at 100 and handles no active plan", () => {
  assert.deepEqual(
    trainingConsistency(
      ["2026-09-07", "2026-09-08", "2026-09-09", "2026-09-10", "2026-09-11"],
      "2026-09-07",
      4,
    ),
    { completed: 5, planned: 4, percent: 100 },
  );
  assert.deepEqual(trainingConsistency(["2026-09-07"], "2026-09-07", null), {
    completed: 1,
    planned: null,
    percent: null,
  });
});

test("nutrition summary uses logged days and their historical targets", () => {
  const result = nutritionWeekSummary(
    [
      { logDate: "2026-09-07", calories: 2800, protein: 140, targetCalories: 2900 },
      { logDate: "2026-09-08", calories: 3200, protein: 150, targetCalories: 3000 },
      { logDate: "2026-09-14", calories: 0, protein: 0, targetCalories: 1 },
    ],
    "2026-09-07",
  );
  assert.deepEqual(result, {
    loggedDays: 2,
    averageCalories: 3000,
    averageProtein: 145,
    targetCalories: 2950,
    calorieAdherentDays: 2,
  });
});

test("weight validation rejects bounds, invalid values and future dates", () => {
  assert.equal(validateWeight(61.75, "2026-09-06", "2026-09-06", ""), null);
  for (const invalid of [NaN, -1, 19.99, 400.01])
    assert.match(validateWeight(invalid, "2026-09-06", "2026-09-06", ""), /20 and 400/);
  assert.match(validateWeight(70, "2026-09-07", "2026-09-06", ""), /future/);
});

test("public progress remains separate from legacy progress and clears private queries", async () => {
  const [route, component, query, cache, migration] = await Promise.all([
    readFile(new URL("../src/routes/_authenticated/bulk/progress.tsx", import.meta.url), "utf8"),
    readFile(new URL("../src/components/PublicBulkProgress.tsx", import.meta.url), "utf8"),
    readFile(new URL("../src/lib/bulk-progress-query.ts", import.meta.url), "utf8"),
    readFile(new URL("../src/lib/query-cancellation.ts", import.meta.url), "utf8"),
    readFile(
      new URL("../supabase/migrations/20260906220000_public_bulk_progress.sql", import.meta.url),
      "utf8",
    ),
  ]);
  assert.match(route, /targets\.trainingSetupPreference/);
  assert.match(route, /LegacyProgressPage/);
  assert.match(component, /current week is still in progress/);
  assert.match(component, /Photo unavailable/);
  assert.match(query, /createSignedUrls\(paths, 15 \* 60\)/);
  assert.match(query, /bulk-progress-photos/);
  assert.match(cache, /bulk-weight-entries/);
  assert.match(cache, /bulk-progress-photos/);
  assert.match(migration, /ENABLE ROW LEVEL SECURITY/g);
  assert.match(migration, /storage_path LIKE bulk_profile_id::text \|\| '\/public\/%'/);
  assert.doesNotMatch(migration, /UPDATE public\.bulk_days|DELETE FROM public\.bulk_photos/);
});
