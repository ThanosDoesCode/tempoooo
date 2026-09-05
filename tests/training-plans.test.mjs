import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  availableExerciseEquipment,
  planCompatibility,
  recommendTrainingPlan,
} from "../src/lib/training-plans.ts";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");
const plan = (overrides = {}) => ({
  id: "template:intermediate-upper-lower-4",
  slug: "intermediate-upper-lower-4",
  name: "Intermediate Upper / Lower A/B",
  description: "Balanced",
  experienceLevel: "intermediate",
  trainingDaysPerWeek: 4,
  requiredEquipment: ["dumbbell", "cable", "bench"],
  splitSummary: "Upper A / Lower A / Upper B / Lower B",
  days: [],
  ...overrides,
});

test("full commercial gym expands to broad exercise-library equipment access", () => {
  const full = availableExerciseEquipment(["full_gym"]);
  for (const item of [
    "barbell",
    "dumbbell",
    "cable",
    "machine",
    "bench",
    "pull_up_bar",
    "bodyweight",
  ])
    assert.equal(full.has(item), true);
  assert.equal(planCompatibility(plan(), "intermediate", 4, ["full_gym"]).exact, true);
});

test("equipment compatibility reports missing requirements instead of hiding them", () => {
  const result = planCompatibility(plan(), "intermediate", 4, ["dumbbells", "bench"]);
  assert.equal(result.equipmentCompatible, false);
  assert.deepEqual(result.missingEquipment, ["cable"]);
});

test("generated recommendation prioritizes compatible frequency and experience", () => {
  const plans = [
    plan({ id: "advanced", experienceLevel: "advanced", trainingDaysPerWeek: 6 }),
    plan({ id: "missing", requiredEquipment: ["machine"] }),
    plan({ id: "match" }),
  ];
  assert.equal(
    recommendTrainingPlan(plans, "intermediate", 4, ["dumbbells", "cables", "bench"])?.id,
    "match",
  );
});

test("training UI supports generated, preset and empty custom paths without replacing legacy logging", async () => {
  const [component, route, query, migration] = await Promise.all([
    read("src/components/TrainingPlanSetup.tsx"),
    read("src/routes/_authenticated/bulk/training.tsx"),
    read("src/lib/training-plans-query.ts"),
    read("supabase/migrations/20260905180000_bulk_training_plans.sql"),
  ]);
  assert.match(component, /Your recommended plan/);
  assert.match(component, /See Other Plans/);
  assert.match(component, /Tempo plans/);
  assert.match(component, /Create My Training Plan/);
  assert.match(component, /Use This Plan/);
  assert.match(component, /Works with your equipment/);
  assert.match(query, /instantiate_bulk_training_plan/);
  assert.match(query, /create_empty_bulk_training_plan/);
  assert.match(route, /TrainingPlanSetup/);
  assert.match(route, /TrainingPlanOverview/);
  assert.match(route, /TrainingSession/);
  assert.doesNotMatch(migration, /UPDATE public\.bulk_workouts|DELETE FROM public\.bulk_workouts/);
});
