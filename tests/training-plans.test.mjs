import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  availableExerciseEquipment,
  moveOrderedItem,
  planCompatibility,
  recommendTrainingPlan,
  replaceTrainingPlanExercise,
  validateTrainingPlanDraft,
} from "../src/lib/training-plans.ts";
import { orderedExerciseDefs } from "../src/lib/types.ts";

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

test("arrow ordering moves items without crossing list boundaries", () => {
  assert.deepEqual(moveOrderedItem(["a", "b", "c"], 1, 0), ["b", "a", "c"]);
  assert.deepEqual(moveOrderedItem(["a", "b", "c"], 1, 2), ["a", "c", "b"]);
  const original = ["a", "b", "c"];
  assert.equal(moveOrderedItem(original, 0, -1), original);
  assert.equal(moveOrderedItem(original, 2, 3), original);
});

test("replacement preserves prescription and position while normalizing execution mode", () => {
  const current = {
    id: "plan-exercise",
    exerciseId: "system:one-arm-dumbbell-row",
    sourceSystemExerciseId: "system:one-arm-dumbbell-row",
    name: "One-Arm Dumbbell Row",
    order: 3,
    sets: 4,
    repMin: 6,
    repMax: 10,
    intendedUnilateralMode: "unilateral",
    notes: "Bench notch 3",
    supportsUnilateral: true,
  };
  const replacement = replaceTrainingPlanExercise(current, {
    id: "system:flat-barbell-bench-press",
    owner_id: null,
    slug: "flat-barbell-bench-press",
    name: "Flat Barbell Bench Press",
    primary_muscle: "chest",
    secondary_muscles: [],
    equipment: ["barbell", "bench"],
    movement_pattern: "horizontal_push",
    category: "strength",
    supports_unilateral: false,
    default_unilateral_mode: "bilateral",
    is_bodyweight: false,
    is_system: true,
    active: true,
    min_experience: "beginner",
    created_at: "2026-09-06",
    updated_at: "2026-09-06",
  });
  assert.deepEqual(
    [
      replacement.order,
      replacement.sets,
      replacement.repMin,
      replacement.repMax,
      replacement.notes,
    ],
    [3, 4, 6, 10, "Bench notch 3"],
  );
  assert.equal(replacement.intendedUnilateralMode, "bilateral");
  assert.equal(replacement.exerciseId, "system:flat-barbell-bench-press");
});

test("plan draft validation rejects invalid sets, reps and unilateral configuration", () => {
  const baseExercise = {
    id: "exercise",
    exerciseId: "system:flat-barbell-bench-press",
    sourceSystemExerciseId: "system:flat-barbell-bench-press",
    name: "Bench Press",
    order: 1,
    sets: 3,
    repMin: 8,
    repMax: 12,
    intendedUnilateralMode: "bilateral",
    notes: null,
    supportsUnilateral: false,
  };
  const draft = (exercise) => ({
    id: "plan",
    name: "My Plan",
    updatedAt: "2026-09-06",
    days: [{ id: "day", order: 1, name: "Upper", exercises: [exercise] }],
  });
  assert.deepEqual(validateTrainingPlanDraft(draft(baseExercise)), []);
  assert.match(validateTrainingPlanDraft(draft({ ...baseExercise, sets: 0 }))[0], /sets/i);
  assert.match(
    validateTrainingPlanDraft(draft({ ...baseExercise, repMin: 15, repMax: 8 }))[0],
    /rep range/i,
  );
  assert.match(
    validateTrainingPlanDraft(draft({ ...baseExercise, intendedUnilateralMode: "unilateral" }))[0],
    /does not support unilateral/i,
  );
});

test("legacy My Bulk exercise order is stored separately without changing canonical definitions", () => {
  const targets = {
    calories: 2900,
    protein: 130,
    carbs: 380,
    fat: 88,
    water: 3,
    startWeight: 61.5,
    targetWeight: 75,
    legacyExerciseOrder: {
      "Chest & Back": ["Pull-Ups", "Incline Dumbbell Press"],
    },
  };
  const ordered = orderedExerciseDefs(targets, "Chest & Back").map((exercise) => exercise.name);
  assert.deepEqual(ordered.slice(0, 2), ["Pull-Ups", "Incline Dumbbell Press"]);
  assert.equal(new Set(ordered).size, ordered.length);
  assert.equal(ordered.length, 5);
});

test("training UI supports generated, preset and empty custom paths without replacing legacy logging", async () => {
  const [component, editor, picker, route, query, migration, editMigration] = await Promise.all([
    read("src/components/TrainingPlanSetup.tsx"),
    read("src/components/TrainingPlanEditor.tsx"),
    read("src/components/PlanExercisePicker.tsx"),
    read("src/routes/_authenticated/bulk/training.tsx"),
    read("src/lib/training-plans-query.ts"),
    read("supabase/migrations/20260905180000_bulk_training_plans.sql"),
    read("supabase/migrations/20260906120000_edit_bulk_training_plans.sql"),
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
  assert.match(editor, /Save Changes/);
  assert.match(editor, /Add Workout Day/);
  assert.match(editor, /Add Exercise/);
  assert.match(editor, /Historical workouts will stay unchanged/);
  assert.match(editor, /Move .* up/);
  assert.match(editor, /Move .* down/);
  assert.match(editor, /Replace/);
  assert.match(editor, /Execution mode/);
  assert.match(picker, /createCustomExercise/);
  assert.match(picker, /useExerciseLibrary/);
  assert.match(editMigration, /save_bulk_training_plan/);
  assert.match(editMigration, /FOR UPDATE OF p/);
  assert.match(editMigration, /source_system_exercise_id/);
  assert.match(editMigration, /Exercise does not support unilateral mode/);
  assert.doesNotMatch(editMigration, /bulk_workouts|bulk_training_plan_templates\s+SET/);
});
