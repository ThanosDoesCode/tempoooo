import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  completedSessionVolume,
  completedWorkingSets,
  isSessionSetComplete,
  sessionElapsedSeconds,
  sessionSetLabel,
  sessionSetVolume,
  skippedSessionSets,
} from "../src/lib/bulk-training-session-domain.ts";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");
const set = (overrides = {}) => ({
  id: "set",
  order: 1,
  isExtra: false,
  isComplete: false,
  setType: "normal",
  rpe: null,
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

test("live workout metrics count completed working sets and use a real elapsed deadline", () => {
  assert.equal(sessionSetVolume(set({ bilateralWeight: 20, bilateralReps: 10 }), exercise()), 200);
  assert.equal(
    sessionSetVolume(
      set({ bilateralWeight: 20, bilateralReps: 10, setType: "warmup" }),
      exercise(),
    ),
    0,
  );
  assert.equal(sessionSetVolume(set({ bilateralWeight: 20 }), exercise()), 0);
  assert.equal(
    sessionSetVolume(
      set({ leftWeight: 10, leftReps: 8, rightWeight: 12, rightReps: 7 }),
      exercise({ executionMode: "unilateral" }),
    ),
    164,
  );
  assert.equal(
    sessionElapsedSeconds("2026-09-15T10:00:00.000Z", Date.parse("2026-09-15T10:02:03.000Z")),
    123,
  );
  assert.equal(
    sessionElapsedSeconds(
      "2026-09-15T10:00:00.000Z",
      Date.parse("2026-09-15T11:00:00.000Z"),
      "2026-09-15T10:04:05.000Z",
    ),
    245,
  );
});

test("history summaries count only completed working sets and keep skipped plans secondary", () => {
  const session = {
    exercises: [
      exercise({
        sets: [
          set({ id: "logged", isComplete: true, bilateralWeight: 20, bilateralReps: 10 }),
          set({
            id: "warmup",
            isComplete: true,
            setType: "warmup",
            bilateralWeight: 10,
            bilateralReps: 10,
          }),
          set({ id: "skipped" }),
        ],
      }),
    ],
  };
  assert.equal(completedWorkingSets(session), 1);
  assert.equal(completedSessionVolume(session), 200);
  assert.equal(skippedSessionSets(session), 1);
});

test("public workout UI resumes durable compact sessions and protects set metadata", async () => {
  const [training, overview, workout, history, query, migration, metadataMigration, cache] =
    await Promise.all([
      read("src/routes/_authenticated/bulk/training.tsx"),
      read("src/components/TrainingPlanSetup.tsx"),
      read("src/components/BulkWorkoutSession.tsx"),
      read("src/routes/_authenticated/bulk/training_.history.tsx"),
      read("src/lib/bulk-training-sessions.ts"),
      read("supabase/migrations/20260906180000_public_bulk_workout_sessions.sql"),
      read("supabase/migrations/20260915120000_workout_set_metadata.sql"),
      read("src/lib/query-cancellation.ts"),
    ]);
  assert.match(overview, /Start Workout/);
  assert.match(training, /Resume Workout/);
  for (const label of ["Duration", "Volume", "Previous", "KG", "Reps", "RPE", "Done"])
    assert.match(workout, new RegExp(`>${label}<`));
  assert.match(workout, /Add Set/);
  assert.match(workout, /SET_TYPES/);
  assert.match(workout, /RPE_VALUES/);
  assert.match(workout, /data-set-swipe=\{set\.id\}/);
  assert.match(workout, /dragOffset >= 34/);
  assert.match(workout, /touchAction: "pan-y"/);
  assert.match(workout, /<Trash2[^>]*aria-hidden="true"/);
  assert.match(workout, /canRemove=\{exercise\.sets\.length > 1\}/);
  assert.match(workout, /const \[openSetId, setOpenSetId\]/);
  assert.doesNotMatch(workout, />\s*Remove Set\s*</);
  assert.match(workout, /previousPerformance/);
  assert.match(workout, /min-w-\[330px\]/);
  assert.match(workout, /Finish with incomplete sets/);
  assert.match(workout, /permanently discarded/);
  assert.match(workout, /Save failed/);
  assert.match(workout, />\s*Retry\s*</);
  assert.match(workout, /tempo:bulk-workout-draft/);
  assert.match(workout, /localStorage\.removeItem/);
  assert.match(history, /Training history/);
  assert.match(history, /PublicWorkoutCard/);
  assert.match(history, /PublicWorkoutDetail/);
  assert.match(history, /Delete workout\?/);
  assert.match(history, /completedWorkingSets/);
  assert.match(history, /completedSessionVolume/);
  assert.match(query, /staleTime: 0/);
  assert.match(cache, /bulk-training-session/);
  assert.match(migration, /bulk_training_sessions_one_active_uidx/);
  assert.match(migration, /SECURITY DEFINER SET search_path = ''/);
  assert.match(migration, /Completed workouts cannot be changed/);
  assert.match(metadataMigration, /ADD COLUMN set_type/);
  assert.match(metadataMigration, /ADD COLUMN rpe/);
  assert.match(metadataMigration, /RPE must be between 6 and 10 in half-point steps/);
  assert.match(metadataMigration, /An exercise must keep at least one set/);
  assert.match(metadataMigration, /SECURITY DEFINER SET search_path = ''/);
  assert.match(metadataMigration, /FROM PUBLIC, anon/);
  assert.doesNotMatch(migration, /UPDATE public\.bulk_workouts|DELETE FROM public\.bulk_workouts/);
});
