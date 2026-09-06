import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { isSessionSetComplete, sessionSetLabel } from "../src/lib/bulk-training-session-domain.ts";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");
const set = (overrides = {}) => ({
  id: "set",
  order: 1,
  isExtra: false,
  isComplete: false,
  bilateralWeight: null,
  bilateralReps: null,
  leftWeight: null,
  leftReps: null,
  rightWeight: null,
  rightReps: null,
  ...overrides,
});
const exercise = (overrides = {}) => ({
  id: "exercise",
  sourcePlanExerciseId: "plan-exercise",
  sourceExerciseId: "system:test",
  name: "Test movement",
  order: 1,
  executionMode: "bilateral",
  isBodyweight: false,
  targetSets: 3,
  targetRepMin: 8,
  targetRepMax: 12,
  notes: null,
  sets: [],
  ...overrides,
});

test("bilateral, unilateral and bodyweight completion rules preserve asymmetric performance", () => {
  assert.equal(
    isSessionSetComplete(set({ bilateralWeight: 22.5, bilateralReps: 10 }), exercise()),
    true,
  );
  assert.equal(
    isSessionSetComplete(
      set({ leftWeight: 10, leftReps: 10, rightWeight: 12.5, rightReps: 8 }),
      exercise({ executionMode: "unilateral" }),
    ),
    true,
  );
  assert.equal(
    isSessionSetComplete(
      set({ leftWeight: 10, leftReps: 10, rightWeight: 10 }),
      exercise({ executionMode: "unilateral" }),
    ),
    false,
  );
  assert.equal(
    isSessionSetComplete(set({ bilateralReps: 10 }), exercise({ isBodyweight: true })),
    true,
  );
});

test("completed-history labels distinguish standard, unilateral, bodyweight and added load", () => {
  assert.equal(
    sessionSetLabel(set({ bilateralWeight: 22.5, bilateralReps: 10 }), exercise()),
    "22.5 kg × 10",
  );
  assert.equal(
    sessionSetLabel(
      set({ leftWeight: 10, leftReps: 10, rightWeight: 10, rightReps: 8 }),
      exercise({ executionMode: "unilateral" }),
    ),
    "L 10 kg × 10 | R 10 kg × 8",
  );
  assert.equal(
    sessionSetLabel(set({ bilateralReps: 10 }), exercise({ isBodyweight: true })),
    "10 reps",
  );
  assert.equal(
    sessionSetLabel(
      set({ bilateralWeight: 5, bilateralReps: 8 }),
      exercise({ isBodyweight: true }),
    ),
    "+5 kg × 8",
  );
});

test("public workout UI resumes durable sessions and confirms incomplete finish/discard", async () => {
  const [training, overview, workout, history, query, migration, cache] = await Promise.all([
    read("src/routes/_authenticated/bulk/training.tsx"),
    read("src/components/TrainingPlanSetup.tsx"),
    read("src/components/BulkWorkoutSession.tsx"),
    read("src/routes/_authenticated/bulk/history.tsx"),
    read("src/lib/bulk-training-sessions.ts"),
    read("supabase/migrations/20260906180000_public_bulk_workout_sessions.sql"),
    read("src/lib/query-cancellation.ts"),
  ]);
  assert.match(overview, /Start Workout/);
  assert.match(training, /Resume Workout/);
  assert.match(workout, /Use left weight for both/);
  assert.match(workout, /Add Extra Set/);
  assert.match(workout, /Finish with incomplete sets/);
  assert.match(workout, /permanently discarded/);
  assert.match(workout, /Retry save/);
  assert.match(workout, /tempo:bulk-workout-draft/);
  assert.match(workout, /localStorage\.removeItem/);
  assert.match(history, /Completed plan workouts/);
  assert.match(history, /CompletedWorkout/);
  assert.match(query, /staleTime: 0/);
  assert.match(cache, /bulk-training-session/);
  assert.match(migration, /bulk_training_sessions_one_active_uidx/);
  assert.match(migration, /SECURITY DEFINER SET search_path = ''/);
  assert.match(migration, /Completed workouts cannot be changed/);
  assert.doesNotMatch(migration, /UPDATE public\.bulk_workouts|DELETE FROM public\.bulk_workouts/);
});
