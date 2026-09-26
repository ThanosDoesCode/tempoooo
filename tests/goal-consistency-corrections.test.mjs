import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  collectCompletedWorkouts,
  countWorkoutsInRange,
  goalWeightStatus,
  resolveWeeklyWorkoutTarget,
} from "../src/lib/goal-metrics.ts";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("Today and Check-In use the same Goal status calculation and weight source", async () => {
  const [today, checkIn] = await Promise.all([
    read("src/routes/_authenticated/bulk/index.tsx"),
    read("src/routes/_authenticated/bulk/check-in.tsx"),
  ]);
  for (const src of [today, checkIn]) {
    assert.match(src, /goalWeightStatus/);
    assert.match(src, /legacyDayWeights\(data\.days\)/);
    assert.match(src, /useBulkWeights\(/);
  }
  assert.doesNotMatch(checkIn, /bulkStatus\(data, addDays/);
  assert.doesNotMatch(checkIn, /status: data\.targets\.goal\s*\?\s*bulkStatus/);
});

test("Check-In status for the current week equals Today's status", () => {
  const weights = [
    { logDate: "2026-09-14", weightKg: 70 },
    { logDate: "2026-09-16", weightKg: 70.1 },
    { logDate: "2026-09-18", weightKg: 70 },
    { logDate: "2026-09-21", weightKg: 70.3 },
    { logDate: "2026-09-23", weightKg: 70.3 },
    { logDate: "2026-09-25", weightKg: 70.3 },
  ];
  const args = { weights, goal: "gain", targetWeeklyGainKg: 0.25 };
  const todayStatus = goalWeightStatus({ ...args, today: "2026-09-26" });
  // Check-In clamps the week end (Sunday) to today, so it evaluates the same day.
  const checkInStatus = goalWeightStatus({ ...args, today: "2026-09-26" });
  assert.deepEqual(checkInStatus, todayStatus);
  assert.equal(todayStatus.basis, "estimate");
  assert.ok(!["TOO FAST", "TOO SLOW"].includes(todayStatus.label));
});

test("insufficient weigh-ins give CALIBRATING and never TOO FAST or TOO SLOW", () => {
  const status = goalWeightStatus({
    weights: [
      { logDate: "2026-09-15", weightKg: 70 },
      { logDate: "2026-09-22", weightKg: 72 },
    ],
    today: "2026-09-26",
    goal: "gain",
  });
  assert.equal(status.label, "CALIBRATING");
});

test("Training and Goal share the workout count and configured target", async () => {
  const [training, summary, progress, checkIn] = await Promise.all([
    read("src/routes/_authenticated/bulk/training.tsx"),
    read("src/components/TrainingSummary.tsx"),
    read("src/components/PublicBulkProgress.tsx"),
    read("src/routes/_authenticated/bulk/check-in.tsx"),
  ]);
  for (const src of [training, summary, progress, checkIn]) {
    assert.match(src, /collectCompletedWorkouts/);
    assert.match(src, /resolveWeeklyWorkoutTarget/);
    assert.doesNotMatch(src, /\/\s*5\b(?!\d)[^0-9]*workouts/);
  }
  assert.equal(resolveWeeklyWorkoutTarget({}), null);
});

test("active sessions never count and same-day sessions are preserved", () => {
  const records = collectCompletedWorkouts({
    sessions: [
      { id: "chest-back", status: "completed", workoutDate: "2026-09-21" },
      { id: "legs", status: "completed", workoutDate: "2026-09-21" },
      { id: "arms", status: "in_progress", workoutDate: "2026-09-22" },
    ],
    legacyWorkouts: { "2026-09-20": { date: "2026-09-20", status: "completed" } },
  });
  assert.equal(countWorkoutsInRange(records, "2026-09-21", "2026-09-27"), 2);
  assert.equal(countWorkoutsInRange(records, "2026-09-14", "2026-09-27"), 3);
});

test("finishing a workout refreshes the queries the counters read", async () => {
  const [session, queries, training] = await Promise.all([
    read("src/components/BulkWorkoutSession.tsx"),
    read("src/lib/bulk-training-sessions.ts"),
    read("src/routes/_authenticated/bulk/training.tsx"),
  ]);
  assert.match(session, /invalidateQueries\(\{ queryKey: \["bulk-training-sessions"\] \}\)/);
  assert.match(queries, /\["bulk-training-sessions", "completed-dates"/);
  assert.match(queries, /source_plan_day_id/);
  assert.match(training, /completedDayIds/);
  assert.doesNotMatch(training, /setCount|\+\+\s*count/);
});

test("full weekly review lives on Check-In; Progress keeps a short summary and analytics", async () => {
  const [progress, checkIn] = await Promise.all([
    read("src/components/PublicBulkProgress.tsx"),
    read("src/routes/_authenticated/bulk/check-in.tsx"),
  ]);
  assert.match(checkIn, /<PublicWeeklyReview/);
  assert.match(checkIn, /Generate ChatGPT/);
  assert.match(checkIn, /setWeekNote/);
  const body = progress.slice(progress.indexOf("export function PublicBulkProgress("));
  const main = body.slice(0, body.indexOf("\nfunction "));
  assert.doesNotMatch(main, /<WeeklyCheckIn/);
  for (const piece of ["ThirtyDayWeightCard", "CheckInConsistencyCard", "ProgressPhotos"]) {
    assert.match(progress, new RegExp(piece));
  }
});

test("legacy history and independent Save Day remain", async () => {
  const [history, today, session] = await Promise.all([
    read("src/routes/_authenticated/bulk/history.tsx"),
    read("src/routes/_authenticated/bulk/index.tsx"),
    read("src/components/BulkWorkoutSession.tsx"),
  ]);
  assert.match(history, /createFileRoute/);
  assert.match(today, /saveDay/);
  assert.doesNotMatch(session, /saveDay/);
});
