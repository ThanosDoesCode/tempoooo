import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  deriveBulkProgressionTargets,
  practicalLoad,
  weakerSideFor,
} from "../src/lib/bulk-progression.ts";

const target = (overrides = {}) => ({
  planExerciseId: "plan-exercise",
  exerciseId: "system:bench-press",
  executionMode: "bilateral",
  isBodyweight: false,
  targetSets: 3,
  repMin: 8,
  repMax: 12,
  ...overrides,
});
const set = (order, overrides = {}) => ({
  id: `set-${order}`,
  order,
  isExtra: false,
  isComplete: true,
  bilateralWeight: 20,
  bilateralReps: 10,
  leftWeight: null,
  leftReps: null,
  rightWeight: null,
  rightReps: null,
  ...overrides,
});
const exercise = (sets, overrides = {}) => ({
  id: "session-exercise",
  sourcePlanExerciseId: "plan-exercise",
  sourceExerciseId: "system:bench-press",
  name: "Bench Press",
  order: 1,
  executionMode: "bilateral",
  isBodyweight: false,
  targetSets: 3,
  targetRepMin: 8,
  targetRepMax: 12,
  notes: null,
  sets,
  ...overrides,
});
const session = (exerciseValue, daysAgo = 0) => ({
  id: `session-${daysAgo}`,
  bulkProfileId: "profile",
  trainingPlanId: "plan",
  planName: "Plan",
  workoutDayName: "Upper",
  workoutDayOrder: 1,
  status: "completed",
  startedAt: `2026-09-0${6 - daysAgo}T10:00:00Z`,
  completedAt: `2026-09-0${6 - daysAgo}T11:00:00Z`,
  updatedAt: `2026-09-0${6 - daysAgo}T11:00:00Z`,
  exercises: [exerciseValue],
});
const result = (targetValue, sessions, allTargets = [targetValue]) =>
  deriveBulkProgressionTargets(allTargets, sessions)[targetValue.planExerciseId];

test("first session and incompatible execution history return structured insufficient data", () => {
  assert.deepEqual(
    [result(target(), []).decision, result(target(), []).reasonCode],
    ["insufficient_data", "no_history"],
  );
  const old = session(
    exercise([], { executionMode: "unilateral", sourceExerciseId: "system:bench-press" }),
  );
  assert.equal(result(target(), [old]).reasonCode, "incompatible_history");
});

test("bilateral progression uses planned sets, practical loads and ignores extra sets", () => {
  const complete = [1, 2, 3].map((order) =>
    set(order, { bilateralWeight: 22.5, bilateralReps: 12 }),
  );
  complete.push(set(4, { isExtra: true, bilateralWeight: 10, bilateralReps: 2 }));
  const progressed = result(target(), [session(exercise(complete))]);
  assert.deepEqual(
    [progressed.decision, progressed.currentLoad, progressed.recommendedLoad],
    ["increase_load", 22.5, 25],
  );
  const mixed = result(target(), [
    session(
      exercise([
        set(1, { bilateralReps: 12 }),
        set(2, { bilateralReps: 10 }),
        set(3, { bilateralReps: 9 }),
      ]),
    ),
  ]);
  assert.equal(mixed.decision, "maintain_load_increase_reps");
  assert.equal(practicalLoad(23.1), 22.5);
});

test("incomplete or invalid planned data cannot produce positive progression", () => {
  const incomplete = result(target(), [
    session(exercise([set(1, { bilateralReps: 12 }), set(2, { bilateralReps: 12 })])),
  ]);
  assert.deepEqual(
    [incomplete.decision, incomplete.reasonCode],
    ["repeat_target", "incomplete_planned_sets"],
  );
  const invalid = result(target(), [
    session(
      exercise([1, 2, 3].map((order) => set(order, { bilateralWeight: -1, bilateralReps: 12 }))),
    ),
  ]);
  assert.equal(invalid.decision, "repeat_target");
  const extraOnly = result(target(), [
    session(exercise([set(4, { isExtra: true, bilateralReps: 12 })])),
  ]);
  assert.equal(extraOnly.decision, "repeat_target");
  const explicitlyIncomplete = result(target(), [
    session(
      exercise(
        [1, 2, 3].map((order) => set(order, { isComplete: order !== 2, bilateralReps: 12 })),
      ),
    ),
  ]);
  assert.equal(explicitlyIncomplete.decision, "repeat_target");
});

test("unilateral progression is governed by the weaker side without averaging sides", () => {
  const unilateralTarget = target({
    exerciseId: "system:one-arm-row",
    executionMode: "unilateral",
  });
  const uniExercise = (rows) =>
    exercise(rows, {
      sourceExerciseId: "system:one-arm-row",
      executionMode: "unilateral",
    });
  const row = (order, leftReps, rightReps, leftWeight = 10, rightWeight = 10) =>
    set(order, {
      bilateralWeight: null,
      bilateralReps: null,
      leftWeight,
      leftReps,
      rightWeight,
      rightReps,
    });
  const rightWeak = [row(1, 12, 12), row(2, 12, 10), row(3, 12, 9)];
  const leftWeak = [row(1, 12, 12), row(2, 10, 12), row(3, 9, 12)];
  assert.deepEqual(
    [
      result(unilateralTarget, [session(uniExercise(rightWeak))]).decision,
      weakerSideFor(rightWeak),
    ],
    ["maintain_load_increase_reps", "right"],
  );
  assert.equal(weakerSideFor(leftWeak), "left");
  const balanced = [row(1, 12, 12), row(2, 12, 12), row(3, 12, 12)];
  assert.deepEqual(
    [result(unilateralTarget, [session(uniExercise(balanced))]).decision, weakerSideFor(balanced)],
    ["increase_load", "balanced"],
  );
  const unequal = [row(1, 12, 12, 10, 12.5), row(2, 12, 12, 10, 12.5), row(3, 12, 12, 10, 12.5)];
  const unequalResult = result(unilateralTarget, [session(uniExercise(unequal))]);
  assert.deepEqual(
    [
      unequalResult.decision,
      unequalResult.reasonCode,
      unequalResult.leftRecommendedLoad,
      unequalResult.rightRecommendedLoad,
    ],
    ["maintain_load_increase_reps", "unequal_side_loads", 10, 12.5],
  );
});

test("bodyweight progression separates reps, added load and total body mass", () => {
  const pullUp = target({
    exerciseId: "system:pull-up",
    isBodyweight: true,
    repMin: 6,
    repMax: 10,
  });
  const body = (reps, weight = null) =>
    exercise(
      reps.map((value, index) => set(index + 1, { bilateralWeight: weight, bilateralReps: value })),
      { sourceExerciseId: "system:pull-up", isBodyweight: true, targetRepMin: 6, targetRepMax: 10 },
    );
  assert.equal(result(pullUp, [session(body([8, 8, 7]))]).decision, "increase_reps");
  const add = result(pullUp, [session(body([10, 10, 10]))]);
  assert.deepEqual([add.decision, add.recommendedLoad], ["add_load", 2.5]);
  const weighted = result(pullUp, [session(body([10, 10, 10], 10))]);
  assert.deepEqual(
    [weighted.decision, weighted.currentLoad, weighted.recommendedLoad],
    ["increase_load", 10, 12.5],
  );
});

test("current prescriptions, stable identities and duplicate movements are handled explicitly", () => {
  const historical = session(
    exercise(
      [1, 2, 3].map((order) => set(order, { bilateralReps: 8 })),
      {
        sourcePlanExerciseId: "old-plan-exercise",
        sourceExerciseId: "custom:stable",
      },
    ),
  );
  const readded = target({
    planExerciseId: "new-plan-exercise",
    exerciseId: "custom:stable",
    repMin: 6,
    repMax: 8,
  });
  assert.equal(result(readded, [historical]).decision, "increase_load");
  const replacement = target({ planExerciseId: "replacement", exerciseId: "system:different" });
  assert.equal(result(replacement, [historical]).reasonCode, "no_history");
  const duplicate = target({ planExerciseId: "duplicate", exerciseId: "custom:stable" });
  assert.equal(
    result(duplicate, [historical], [readded, duplicate]).reasonCode,
    "ambiguous_exercise_identity",
  );
  assert.equal(historical.exercises[0].sets[0].bilateralReps, 8);
});

test("load reduction requires two severe compatible completed occurrences", () => {
  const poor = (daysAgo) =>
    session(
      exercise([1, 2, 3].map((order) => set(order, { bilateralWeight: 20, bilateralReps: 5 }))),
      daysAgo,
    );
  const one = result(target(), [poor(0)]);
  assert.equal(one.decision, "maintain_load_increase_reps");
  const two = result(target(), [poor(0), poor(1)]);
  assert.deepEqual([two.decision, two.recommendedLoad], ["reduce_load", 17.5]);
});

test("public progression integration is batched, derived and invalidated without touching legacy logic", async () => {
  const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");
  const [query, sessions, training, workout, legacy] = await Promise.all([
    read("src/lib/bulk-progression-query.ts"),
    read("src/lib/bulk-training-sessions.ts"),
    read("src/routes/_authenticated/bulk/training.tsx"),
    read("src/components/BulkWorkoutSession.tsx"),
    read("src/lib/calc.ts"),
  ]);
  assert.match(query, /fetchRecentCompletedBulkTrainingSessions/);
  assert.match(sessions, /\.in\("session_id", sessionIds\)/);
  assert.match(sessions, /\.in\("session_exercise_id", exerciseIds\)/);
  assert.doesNotMatch(query, /progressionFor/);
  assert.match(training, /useBulkProgressionTargets/);
  assert.match(workout, /buildBulkNextSessionGuidance/);
  assert.match(workout, /invalidateQueries\(\{ queryKey: \["bulk-progression"\] \}\)/);
  assert.match(legacy, /repDelta >= 2/);
  assert.match(legacy, /repDelta <= -3/);
});
