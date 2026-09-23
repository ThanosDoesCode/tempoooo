import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { buildCheckInConsistency } from "../src/lib/goal-check-in-consistency.ts";
import {
  completedSessionVolume,
  sessionSetLabel,
  sessionSetVolume,
} from "../src/lib/bulk-training-session-domain.ts";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");
const set = (weight, reps) => ({
  id: "set-1",
  order: 1,
  isExtra: false,
  isComplete: true,
  setType: "normal",
  rpe: 8,
  bilateralWeight: weight,
  bilateralReps: reps,
  leftWeight: null,
  leftReps: null,
  rightWeight: null,
  rightReps: null,
});
const bodyweightExercise = (sets = []) => ({
  id: "exercise-1",
  sourcePlanExerciseId: "plan-exercise-1",
  sourceExerciseId: "pull-up",
  name: "Pull-Up",
  order: 1,
  executionMode: "bilateral",
  isBodyweight: true,
  targetSets: 3,
  targetRepMin: 6,
  targetRepMax: 10,
  notes: null,
  sets,
});

test("bodyweight volume uses the session snapshot while labels keep extra load separate", () => {
  const unweighted = set(0, 8);
  const weighted = set(10, 6);
  assert.equal(sessionSetLabel(unweighted, bodyweightExercise()), "BW × 8");
  assert.equal(sessionSetLabel(weighted, bodyweightExercise()), "+10 kg × 6");
  assert.equal(sessionSetVolume(unweighted, bodyweightExercise(), 61.4), 491.2);
  assert.ok(Math.abs(sessionSetVolume(weighted, bodyweightExercise(), 61.4) - 428.4) < 0.001);
  assert.equal(sessionSetVolume(unweighted, bodyweightExercise(), null), null);
  assert.equal(
    completedSessionVolume({
      id: "session",
      bulkProfileId: "profile",
      trainingPlanId: "plan",
      planName: "Plan",
      workoutDayName: "Day",
      workoutDayOrder: 1,
      status: "completed",
      startedAt: "2026-09-23T10:00:00Z",
      completedAt: "2026-09-23T11:00:00Z",
      updatedAt: "2026-09-23T11:00:00Z",
      workoutDate: "2026-09-23",
      bodyweightKg: 61.4,
      exercises: [bodyweightExercise([unweighted])],
    }),
    491.2,
  );
});

test("eight-week check-in consistency does not mark pre-goal or current weeks missed", () => {
  const weeks = buildCheckInConsistency(
    "2026-08-20T12:00:00Z",
    ["2026-08-24", "2026-09-07"],
    "2026-09-23",
  );
  assert.equal(weeks.length, 8);
  assert.equal(weeks.at(-1).status, "current-incomplete");
  assert.ok(weeks.some((week) => week.status === "completed"));
  assert.ok(weeks.some((week) => week.status === "missed"));
  assert.ok(weeks.some((week) => week.status === "not-started"));
});

test("Challenge uses the shared route-backed secondary navigation", async () => {
  const shell = await read("src/components/AppShell.tsx");
  assert.match(shell, /area === "challenge"\s*\? CHALLENGE_NAV/);
  assert.match(shell, /\{nav \? \([\s\S]*<SecondaryNavigation/);
  assert.doesNotMatch(shell, /aria-label="challenge sections" className="mb-4 overflow-x-auto"/);
});

test("Goal Today and Progress share structured weights and refresh active bodyweight", async () => {
  const [today, progressQuery] = await Promise.all([
    read("src/routes/_authenticated/bulk/index.tsx"),
    read("src/lib/bulk-progress-query.ts"),
  ]);
  assert.match(today, /useBulkWeights/);
  assert.match(today, /saveBulkWeight/);
  assert.match(today, /bulkWeightQueryKey/);
  assert.match(progressQuery, /onConflict: "bulk_profile_id,log_date"/);
  assert.match(progressQuery, /refreshActiveBulkTrainingBodyweight/);
});

test("bodyweight snapshot migration is owner-scoped and never backfills guessed history", async () => {
  const migration = await read(
    "supabase/migrations/20260923120000_snapshot_public_workout_bodyweight.sql",
  );
  assert.match(migration, /ADD COLUMN bodyweight_kg/);
  assert.match(migration, /w\.log_date<=_workout_date/);
  assert.match(migration, /s\.status='in_progress'/);
  assert.match(migration, /m\.user_id=caller AND m\.role='owner'/);
  assert.match(migration, /SECURITY DEFINER SET search_path = ''/);
  assert.match(migration, /REVOKE ALL.*FROM PUBLIC,anon/);
  assert.doesNotMatch(
    migration,
    /UPDATE public\.bulk_training_sessions[\s\S]*SET bodyweight_kg[\s\S]*status='completed'/,
  );
});
