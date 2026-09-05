import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  EQUIPMENT_OPTIONS,
  EXPERIENCE_LEVELS,
  TRAINING_DAY_OPTIONS,
  TRAINING_SETUP_OPTIONS,
  validateBulkOnboarding,
} from "../src/lib/bulk-onboarding.ts";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

const valid = {
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
  assert.match(
    validateBulkOnboarding({ ...valid, targetWeightKg: 70 }).targetWeightKg,
    /greater than/i,
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
    "Review your Bulk plan",
  ]) {
    assert.match(onboarding, new RegExp(heading.replace(/[?]/g, "\\?")));
  }
  assert.match(onboarding, /complete_bulk_onboarding/);
  assert.doesNotMatch(onboarding, /activate_my_bulk/);
  assert.match(onboarding, /Creating My Bulk Plan/);
  assert.match(onboarding, /bulkOwnerQueryOptions/);
  assert.match(profile, /Start My Bulk/);
  assert.match(guard, /redirect\(\{ to: "\/bulk-onboarding", replace: true \}\)/);
  assert.match(shell, /\{hasBulk \? \(/);
});
