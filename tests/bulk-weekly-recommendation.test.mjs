import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  RECOMMENDATION_CALORIE_STEP,
  RECOMMENDATION_MIN_CURRENT_WEIGH_INS,
  RECOMMENDATION_MIN_NUTRITION_DAYS,
  RECOMMENDATION_MIN_PREVIOUS_WEIGH_INS,
  RECOMMENDATION_WEIGHT_TOLERANCE_KG,
  recommendBulkCalories,
} from "../src/lib/bulk-weekly-recommendation.ts";

const summary = (overrides = {}) => ({
  weekStart: "2026-08-24",
  weekEnd: "2026-08-30",
  weightAverageKg: 62,
  previousWeightAverageKg: 61.75,
  weightChangeKg: 0.25,
  weightEntryCount: 4,
  previousWeightEntryCount: 4,
  targetWeeklyGainKg: 0.25,
  averageCalories: 2800,
  averageProtein: 140,
  nutritionLoggedDays: 6,
  calorieAdherentDays: 5,
  targetCalories: 2800,
  completedWorkouts: 4,
  plannedWorkouts: 4,
  ...overrides,
});
const recommend = (overrides = {}, input = {}) =>
  recommendBulkCalories({
    summary: summary(overrides),
    previousTrendChangeKg: 0.25,
    previousTrendComparable: true,
    targetWeightReached: false,
    ...input,
  });

test("recommendation thresholds are centralized and conservative", () => {
  assert.equal(RECOMMENDATION_MIN_CURRENT_WEIGH_INS, 3);
  assert.equal(RECOMMENDATION_MIN_PREVIOUS_WEIGH_INS, 3);
  assert.equal(RECOMMENDATION_MIN_NUTRITION_DAYS, 4);
  assert.equal(RECOMMENDATION_WEIGHT_TOLERANCE_KG, 0.15);
  assert.equal(RECOMMENDATION_CALORIE_STEP, 150);
});

test("missing history, sparse weights and missing targets are insufficient", () => {
  assert.equal(
    recommend({ previousWeightAverageKg: null, weightChangeKg: null }).reasonCode,
    "insufficient_history",
  );
  assert.equal(recommend({ weightEntryCount: 2 }).reasonCode, "insufficient_weight_data");
  assert.equal(recommend({ previousWeightEntryCount: 1 }).decision, "insufficient_data");
  assert.equal(recommend({ targetWeeklyGainKg: null }).reasonCode, "missing_target");
  assert.equal(recommend({ targetCalories: null }).reasonCode, "missing_target");
});

test("on-target and tolerance-edge changes maintain calories", () => {
  for (const change of [0.1, 0.22, 0.4]) {
    const result = recommend({ weightChangeKg: change });
    assert.equal(result.decision, "maintain");
    assert.equal(result.reasonCode, "on_target");
    assert.equal(result.recommendedCalories, 2800);
  }
});

test("below-target gain with good adherence and training increases by a practical bounded step", () => {
  for (const change of [0.05, -0.3]) {
    const result = recommend({ weightChangeKg: change });
    assert.equal(result.decision, "increase_calories");
    assert.equal(result.reasonCode, "below_target_good_adherence");
    assert.equal(result.recommendedCalories, 2950);
    assert.equal(result.calorieDelta, 150);
  }
  const odd = recommend({ weightChangeKg: 0, targetCalories: 2937, averageCalories: 2937 });
  assert.equal(odd.recommendedCalories, 3050);
  assert.ok(odd.calorieDelta <= 150);
  assert.equal(odd.recommendedCalories % 50, 0);
});

test("poor adherence and low training keep the existing target", () => {
  const adherence = recommend({ weightChangeKg: 0, averageCalories: 2300, calorieAdherentDays: 1 });
  assert.equal(adherence.decision, "maintain");
  assert.equal(adherence.reasonCode, "below_target_low_adherence");
  const training = recommend({ weightChangeKg: 0, completedWorkouts: 1, plannedWorkouts: 4 });
  assert.equal(training.decision, "maintain");
  assert.equal(training.reasonCode, "below_target_low_training");
});

test("poor nutrition logging blocks adjustment but does not fabricate missing weight", () => {
  const result = recommend({ nutritionLoggedDays: 3 });
  assert.equal(result.decision, "maintain");
  assert.equal(result.reasonCode, "insufficient_nutrition_data");
  assert.equal(result.dataQuality, "limited");
});

test("one high completed week holds while two comparable high weeks decrease", () => {
  const single = recommend({ weightChangeKg: 0.55 }, { previousTrendChangeKg: 0.3 });
  assert.equal(single.decision, "maintain");
  assert.equal(single.reasonCode, "above_target_single_week");
  const confirmed = recommend({ weightChangeKg: 0.55 }, { previousTrendChangeKg: 0.5 });
  assert.equal(confirmed.decision, "decrease_calories");
  assert.equal(confirmed.reasonCode, "above_target_confirmed");
  assert.equal(confirmed.recommendedCalories, 2650);
  assert.equal(confirmed.calorieDelta, -150);
});

test("reached target never creates a cutting recommendation", () => {
  const result = recommend(
    { weightChangeKg: 0.8 },
    { previousTrendChangeKg: 0.8, targetWeightReached: true },
  );
  assert.equal(result.decision, "maintain");
  assert.equal(result.reasonCode, "goal_reached");
});

test("cut recommendations follow loss direction and keep conservative steps", () => {
  const onTarget = recommend(
    { weightChangeKg: -0.25 },
    { goal: "cut", previousTrendChangeKg: -0.25 },
  );
  assert.equal(onTarget.decision, "maintain");

  const tooSlow = recommend({ weightChangeKg: 0 }, { goal: "cut", previousTrendChangeKg: 0 });
  assert.equal(tooSlow.decision, "decrease_calories");
  assert.equal(tooSlow.calorieDelta, -150);

  const firstFastWeek = recommend(
    { weightChangeKg: -0.7 },
    { goal: "cut", previousTrendChangeKg: -0.25 },
  );
  assert.equal(firstFastWeek.decision, "maintain");
  const confirmedFast = recommend(
    { weightChangeKg: -0.7 },
    { goal: "cut", previousTrendChangeKg: -0.65 },
  );
  assert.equal(confirmedFast.decision, "increase_calories");
  assert.equal(confirmedFast.calorieDelta, 150);
});

test("maintenance ignores small fluctuations and corrects only a confirmed drift", () => {
  const stable = recommend(
    { targetWeeklyGainKg: 0, weightChangeKg: 0.1 },
    { goal: "maintain", previousTrendChangeKg: -0.1 },
  );
  assert.equal(stable.decision, "maintain");
  assert.equal(stable.reasonCode, "on_target");

  const oneDrift = recommend(
    { targetWeeklyGainKg: 0, weightChangeKg: 0.3 },
    { goal: "maintain", previousTrendChangeKg: 0.1 },
  );
  assert.equal(oneDrift.decision, "maintain");
  const confirmedDrift = recommend(
    { targetWeeklyGainKg: 0, weightChangeKg: 0.3 },
    { goal: "maintain", previousTrendChangeKg: 0.25 },
  );
  assert.equal(confirmedDrift.decision, "decrease_calories");
  assert.equal(confirmedDrift.calorieDelta, -150);
});

test("weekly adjustments remain inside persisted calorie bounds", () => {
  const cutFloor = recommend(
    { targetCalories: 800, averageCalories: 800, weightChangeKg: 0 },
    { goal: "cut", previousTrendChangeKg: 0 },
  );
  assert.equal(cutFloor.recommendedCalories, 800);
  const gainCeiling = recommend(
    { targetCalories: 10_000, averageCalories: 10_000, weightChangeKg: 0 },
    { goal: "gain", previousTrendChangeKg: 0 },
  );
  assert.equal(gainCeiling.recommendedCalories, 10_000);
});

test("recommendation is pure and UI uses completed weeks with explicit application", async () => {
  const source = summary({ weightChangeKg: 0 });
  const before = structuredClone(source);
  recommendBulkCalories({
    summary: source,
    previousTrendChangeKg: 0,
    previousTrendComparable: true,
    targetWeightReached: false,
  });
  assert.deepEqual(source, before);
  const [component, query, migration, cache] = await Promise.all([
    readFile(new URL("../src/components/PublicBulkProgress.tsx", import.meta.url), "utf8"),
    readFile(new URL("../src/lib/bulk-progress-query.ts", import.meta.url), "utf8"),
    readFile(
      new URL(
        "../supabase/migrations/20260906230000_apply_bulk_calorie_recommendation.sql",
        import.meta.url,
      ),
      "utf8",
    ),
    readFile(new URL("../src/lib/query-cancellation.ts", import.meta.url), "utf8"),
  ]);
  assert.match(component, /lastCompletedEnd/);
  assert.match(component, /Weekly Check-in/);
  assert.match(component, /Apply Recommendation/);
  assert.match(component, /Protein, carbs and fat will stay unchanged/);
  assert.match(query, /apply_bulk_calorie_recommendation/);
  assert.match(migration, /private\.current_bulk_profile\(\)/);
  assert.match(migration, /abs\(_new_calories - current_calories\) > 150/);
  assert.match(migration, /jsonb_set\(payload, '\{calories\}'/);
  assert.match(migration, /SET search_path = ''/);
  assert.match(cache, /bulk-weekly-recommendation/);
});
