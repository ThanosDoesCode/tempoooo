import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { DEFAULT_DATA } from "../src/lib/types.ts";
import {
  deriveLegacyPersonalRecords,
  derivePublicPersonalRecords,
} from "../src/lib/personal-records.ts";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

const trainingSet = (overrides = {}) => ({
  id: crypto.randomUUID(),
  order: 1,
  isExtra: false,
  isComplete: true,
  bilateralWeight: 20,
  bilateralReps: 8,
  leftWeight: null,
  leftReps: null,
  rightWeight: null,
  rightReps: null,
  ...overrides,
});

const publicSession = (overrides = {}) => ({
  id: crypto.randomUUID(),
  bulkProfileId: "profile-a",
  trainingPlanId: "plan-a",
  planName: "Plan",
  workoutDayName: "Day",
  workoutDayOrder: 1,
  status: "completed",
  startedAt: "2026-09-06T09:00:00Z",
  completedAt: "2026-09-06T10:00:00Z",
  updatedAt: "2026-09-06T10:00:00Z",
  exercises: [],
  ...overrides,
});

const publicExercise = (overrides = {}) => ({
  id: crypto.randomUUID(),
  sourcePlanExerciseId: "plan-row-a",
  sourceExerciseId: "system:cable-row",
  name: "Cable Row",
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

test("public PRs use completed sets, keep stable identities and expose each record category", () => {
  const completed = publicSession({
    exercises: [
      publicExercise({
        name: "Renamed Cable Row",
        sets: [
          trainingSet({ bilateralWeight: 20, bilateralReps: 12 }),
          trainingSet({ bilateralWeight: 25, bilateralReps: 8 }),
          trainingSet({ bilateralWeight: 30, bilateralReps: 20, isComplete: false }),
        ],
      }),
    ],
  });
  const draft = publicSession({
    status: "in_progress",
    completedAt: null,
    exercises: [
      publicExercise({ sets: [trainingSet({ bilateralWeight: 100, bilateralReps: 20 })] }),
    ],
  });
  const records = derivePublicPersonalRecords([completed, draft]);
  assert.equal(records.length, 1);
  assert.equal(records[0].exerciseId, "system:cable-row");
  assert.equal(records[0].bestWeight.load, 25);
  assert.equal(records[0].bestReps.repCount, 12);
  assert.equal(records[0].bestReps.repLoad, 20);
  assert.equal(records[0].bestVolume.volume, 440);
  assert.equal(records[0].bestWeight.date, completed.completedAt);
});

test("public unilateral PRs remain side-specific and bodyweight never invents missing mass", () => {
  const unilateral = publicExercise({
    sourceExerciseId: "system:split-squat",
    name: "Split Squat",
    executionMode: "unilateral",
    sets: [
      trainingSet({
        bilateralWeight: null,
        bilateralReps: null,
        leftWeight: 18,
        leftReps: 10,
        rightWeight: 20,
        rightReps: 8,
      }),
    ],
  });
  const bodyweight = publicExercise({
    sourceExerciseId: "system:pull-up",
    name: "Pull-Up",
    isBodyweight: true,
    sets: [trainingSet({ bilateralWeight: 10, bilateralReps: 6 })],
  });
  const records = derivePublicPersonalRecords([
    publicSession({ exercises: [unilateral, bodyweight] }),
  ]);
  const sides = records.filter((record) => record.exerciseId === "system:split-squat");
  assert.deepEqual(
    sides.map((record) => record.side),
    ["left", "right"],
  );
  assert.deepEqual(
    sides.map((record) => record.bestWeight.load),
    [18, 20],
  );
  const pullUp = records.find((record) => record.exerciseId === "system:pull-up");
  assert.equal(pullUp.isBodyweight, true);
  assert.equal(pullUp.bestWeight.load, 10);
  assert.equal(pullUp.bestWeight.bodyweight, null);
});

test("legacy PRs reuse effective load and dumbbell-pair volume while excluding drafts", () => {
  const data = structuredClone(DEFAULT_DATA);
  data.workouts = {
    "2026-09-05": {
      date: "2026-09-05",
      type: "Chest & Back",
      status: "completed",
      entries: [
        { exercise: "Incline Dumbbell Press", weight: 16, reps: [10, 10, 6] },
        {
          exercise: "Pull-Ups",
          bodyweight: 70,
          addedWeight: 10,
          loadMode: "added",
          reps: [6, 5, 4],
        },
      ],
    },
    "2026-09-06": {
      date: "2026-09-06",
      type: "Chest & Back",
      status: "draft",
      entries: [{ exercise: "Incline Dumbbell Press", weight: 100, reps: [20, 20, 20] }],
    },
  };
  const records = deriveLegacyPersonalRecords(data);
  const press = records.find((record) => record.name === "Incline Dumbbell Press");
  const pullUp = records.find((record) => record.name === "Pull-Ups");
  assert.equal(press.bestWeight.load, 16);
  assert.equal(press.bestVolume.volume, 832);
  assert.equal(pullUp.bestWeight.load, 80);
  assert.equal(pullUp.bestWeight.bodyweight, 70);
});

test("legacy exercise add keeps origin context, blocks duplicates and completed edits", async () => {
  const [session, library, types] = await Promise.all([
    read("src/components/TrainingSession.tsx"),
    read("src/routes/_authenticated/bulk/exercises.tsx"),
    read("src/lib/types.ts"),
  ]);
  assert.match(session, /search=\{\{ addTo: workout\.type, date \}\}/);
  assert.match(library, /const addingToWorkout = !!addTo && !!date/);
  assert.match(library, /title=\{addingToWorkout \? "Add to workout"/);
  assert.match(library, /Completed workouts cannot be changed/);
  assert.match(library, /definitionAlreadySaved/);
  assert.match(library, /workoutAlreadyUpdated/);
  assert.match(library, /Adding\.\.\./);
  assert.match(library, /inputPreserved: true/);
  assert.match(library, /navigate\(\{ to: "\/bulk\/training", replace: true \}\)/);
  assert.match(types, /legacyExerciseDefinitions/);
});

test("Goal discovery is persisted on the self-owned profile and activation acknowledges it", async () => {
  const [migration, discovery, profile, onboarding, initial] = await Promise.all([
    read("supabase/migrations/20260907140000_goal_discoverability.sql"),
    read("src/lib/goal-discovery.ts"),
    read("src/routes/_authenticated/profile.tsx"),
    read("src/routes/_authenticated/bulk-onboarding.tsx"),
    read("supabase/migrations/20260814022015_2e6c5c26-4d84-4ec5-a74b-36c614623b97.sql"),
  ]);
  assert.match(migration, /ADD COLUMN goal_seen_at timestamptz/);
  assert.doesNotMatch(migration, /CREATE POLICY|GRANT|DISABLE ROW LEVEL SECURITY/);
  assert.match(initial, /profiles self update[\s\S]*id = auth\.uid\(\)/);
  assert.match(discovery, /\.eq\("id", auth\.user\.id\)/);
  assert.match(discovery, /setQueryData\(\["goal-discovery"\]/);
  assert.match(profile, /acknowledgeGoal\(\)/);
  assert.match(onboarding, /await acknowledgeGoal\(\)\.catch/);
});

test("nested navigation, evidence recovery and sign-out stay local and responsive", async () => {
  const [shell, profile, evidence] = await Promise.all([
    read("src/components/AppShell.tsx"),
    read("src/routes/_authenticated/profile.tsx"),
    read("src/components/ChallengeEvidenceViewer.tsx"),
  ]);
  assert.match(shell, /ArrowLeft/);
  assert.match(shell, /min-h-11/);
  assert.match(profile, /setSigningOut\(true\)/);
  assert.match(profile, /Signing out…/);
  assert.match(profile, /disabled=\{signingOut\}/);
  assert.doesNotMatch(profile, /location\.reload/);
  assert.match(evidence, /phase: "local_recovery"/);
  assert.match(evidence, /setState\(\{ status: "unavailable"/);
  assert.doesNotMatch(evidence, /throw error/);
});
