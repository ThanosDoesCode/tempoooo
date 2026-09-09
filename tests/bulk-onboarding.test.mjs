import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  EQUIPMENT_OPTIONS,
  EXPERIENCE_LEVELS,
  PHYSIQUE_GOALS,
  TRAINING_DAY_OPTIONS,
  TRAINING_SETUP_OPTIONS,
  recommendInitialNutritionTargets,
  validateBulkOnboarding,
} from "../src/lib/bulk-onboarding.ts";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

const valid = {
  goal: "gain",
  currentWeightKg: 70,
  targetWeightKg: 78,
  targetWeeklyGainKg: 0.25,
  experienceLevel: "intermediate",
  trainingDaysPerWeek: 4,
  availableEquipment: ["dumbbells", "cables", "bench"],
  trainingSetupPreference: "generated",
  calories: 2900,
  protein: 140,
  carbs: 360,
  fat: 90,
};

test("Bulk onboarding centralizes every structured option needed by later segments", () => {
  assert.deepEqual(
    PHYSIQUE_GOALS.map(({ value }) => value),
    ["gain", "cut", "maintain"],
  );
  assert.deepEqual(
    EXPERIENCE_LEVELS.map(({ value }) => value),
    ["beginner", "intermediate", "advanced"],
  );
  assert.deepEqual(TRAINING_DAY_OPTIONS, [2, 3, 4, 5, 6]);
  assert.deepEqual(
    TRAINING_SETUP_OPTIONS.map(({ value }) => value),
    ["generated", "tempo_preset", "custom"],
  );
  assert.deepEqual(
    EQUIPMENT_OPTIONS.map(({ value }) => value),
    [
      "full_gym",
      "barbell",
      "dumbbells",
      "cables",
      "machines",
      "bench",
      "pull_up_bar",
      "bodyweight_only",
    ],
  );
});

test("required onboarding values and target relationships validate locally", () => {
  assert.deepEqual(validateBulkOnboarding(valid), {});
  assert.match(validateBulkOnboarding({ ...valid, targetWeightKg: 70 }).targetWeightKg, /above/i);
  assert.deepEqual(
    validateBulkOnboarding({
      ...valid,
      goal: "cut",
      targetWeightKg: 62,
      targetWeeklyGainKg: 0.5,
    }),
    {},
  );
  assert.match(
    validateBulkOnboarding({ ...valid, goal: "cut", targetWeightKg: 78 }).targetWeightKg,
    /below/i,
  );
  assert.deepEqual(
    validateBulkOnboarding({
      ...valid,
      goal: "maintain",
      targetWeightKg: 70,
      targetWeeklyGainKg: 0,
    }),
    {},
  );
  assert.ok(
    validateBulkOnboarding({
      ...valid,
      goal: "maintain",
      targetWeightKg: 78,
      targetWeeklyGainKg: 0,
    }).targetWeightKg,
  );
  assert.ok(validateBulkOnboarding({ ...valid, currentWeightKg: 0 }).currentWeightKg);
  assert.ok(validateBulkOnboarding({ ...valid, targetWeeklyGainKg: 2 }).targetWeeklyGainKg);
  assert.ok(validateBulkOnboarding({ ...valid, experienceLevel: "" }).experienceLevel);
  assert.ok(validateBulkOnboarding({ ...valid, trainingDaysPerWeek: 1 }).trainingDaysPerWeek);
  assert.ok(validateBulkOnboarding({ ...valid, availableEquipment: [] }).availableEquipment);
  assert.ok(
    validateBulkOnboarding({ ...valid, trainingSetupPreference: "" }).trainingSetupPreference,
  );
  for (const key of ["calories", "protein", "carbs", "fat"]) {
    assert.ok(validateBulkOnboarding({ ...valid, [key]: 0 })[key]);
  }
});

test("initial nutrition recommendations are practical and goal-aware", () => {
  for (const input of [
    {
      goal: "gain",
      currentWeightKg: 50,
      targetWeightKg: 58,
      targetWeeklyGainKg: 0.1,
      trainingDaysPerWeek: 2,
    },
    {
      goal: "cut",
      currentWeightKg: 70,
      targetWeightKg: 62,
      targetWeeklyGainKg: 0.5,
      trainingDaysPerWeek: 4,
    },
    {
      goal: "maintain",
      currentWeightKg: 100,
      targetWeightKg: 100,
      targetWeeklyGainKg: 0,
      trainingDaysPerWeek: 6,
    },
  ]) {
    const recommendation = recommendInitialNutritionTargets(input);
    assert.ok(recommendation);
    assert.ok(recommendation.calories >= 800 && recommendation.calories <= 10000);
    assert.ok(recommendation.protein >= 1 && recommendation.protein <= 1000);
    assert.ok(recommendation.fat >= 1 && recommendation.fat <= 1000);
    assert.ok(recommendation.carbs >= 0 && recommendation.carbs <= 1000);
    assert.ok(
      recommendation.protein * 4 + recommendation.carbs * 4 + recommendation.fat * 9 <=
        recommendation.calories,
    );
  }
  const slower = recommendInitialNutritionTargets({
    goal: "gain",
    currentWeightKg: 70,
    targetWeightKg: 80,
    targetWeeklyGainKg: 0.1,
    trainingDaysPerWeek: 4,
  });
  const faster = recommendInitialNutritionTargets({
    goal: "gain",
    currentWeightKg: 70,
    targetWeightKg: 80,
    targetWeeklyGainKg: 0.3,
    trainingDaysPerWeek: 4,
  });
  assert.ok(slower && faster && faster.calories > slower.calories);

  const gain = recommendInitialNutritionTargets({
    goal: "gain",
    currentWeightKg: 80,
    targetWeightKg: 88,
    targetWeeklyGainKg: 0.25,
    trainingDaysPerWeek: 4,
  });
  const cut = recommendInitialNutritionTargets({
    goal: "cut",
    currentWeightKg: 80,
    targetWeightKg: 72,
    targetWeeklyGainKg: 0.5,
    trainingDaysPerWeek: 4,
  });
  const maintain = recommendInitialNutritionTargets({
    goal: "maintain",
    currentWeightKg: 80,
    targetWeightKg: 80,
    targetWeeklyGainKg: 0,
    trainingDaysPerWeek: 4,
  });
  assert.ok(gain && cut && maintain);
  assert.ok(gain.calories > maintain.calories);
  assert.ok(cut.calories < maintain.calories);
  assert.ok(cut.calories >= maintain.calories - 600);
  assert.ok(cut.protein >= 80 * 2);
  assert.ok(gain.fat >= 50 && cut.fat >= 45 && maintain.fat >= 50);
});

test("initial nutrition recommendations never return negative carbs", () => {
  for (const currentWeightKg of [20, 45, 80, 150, 250, 400]) {
    const recommendation = recommendInitialNutritionTargets({
      goal: currentWeightKg === 400 ? "maintain" : "gain",
      currentWeightKg,
      targetWeightKg: currentWeightKg === 400 ? 400 : Math.min(450, currentWeightKg + 10),
      targetWeeklyGainKg: currentWeightKg === 400 ? 0 : 0.25,
      trainingDaysPerWeek: 4,
    });
    assert.ok(recommendation);
    assert.ok(recommendation.carbs >= 0);
  }
});

test("nutrition onboarding adapts guidance without changing its atomic save", async () => {
  const onboarding = await read("src/routes/_authenticated/bulk-onboarding.tsx");
  assert.match(onboarding, /form\.experienceLevel === "beginner"/);
  assert.match(onboarding, /Use these targets/);
  assert.match(onboarding, /Adjust manually/);
  assert.match(onboarding, /starting targets[\s\S]*weekly progress/);
  assert.match(onboarding, /form\.experienceLevel === "intermediate"/);
  assert.match(onboarding, /recommendation is prefilled/);
  assert.match(onboarding, /form\.experienceLevel === "advanced"/);
  assert.match(onboarding, /Use Tempo recommendation/);
  assert.match(onboarding, /complete_goal_onboarding/);
  assert.match(onboarding, /PHYSIQUE_GOALS/);
  assert.match(onboarding, /goal: form\.goal/);
});

test("the five-step UI submits one atomic RPC and does not expose Bulk early", async () => {
  const [onboarding, profile, guard, shell] = await Promise.all([
    read("src/routes/_authenticated/bulk-onboarding.tsx"),
    read("src/routes/_authenticated/profile.tsx"),
    read("src/routes/_authenticated/bulk/route.tsx"),
    read("src/components/AppShell.tsx"),
  ]);
  for (const heading of [
    "Your goal",
    "Your training",
    "How do you want to train?",
    "Nutrition targets",
    "Review your Goal plan",
  ]) {
    assert.match(onboarding, new RegExp(heading.replace(/[?]/g, "\\?")));
  }
  assert.match(onboarding, /complete_goal_onboarding/);
  assert.doesNotMatch(onboarding, /activate_my_bulk/);
  assert.match(onboarding, /Creating My Goal/);
  assert.match(onboarding, /bulkOwnerQueryOptions/);
  assert.match(profile, /Start My Goal/);
  assert.match(guard, /redirect\(\{ to: "\/bulk-onboarding", replace: true \}\)/);
  assert.match(shell, /item\.area === "challenge" \|\| item\.area === "profile" \|\| hasBulk/);
  assert.doesNotMatch(shell, /label: "Bulk"/);
});
