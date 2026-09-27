import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  collectCompletedWorkouts,
  countWorkoutsInRange,
  dayCompletionPercent,
  dayCompletionRequirements,
  formatWorkoutProgress,
  goalWeightStatus,
  resolveWeeklyWorkoutTarget,
} from "../src/lib/goal-metrics.ts";

test("sessions count by stable id, including two on the same date", () => {
  const records = collectCompletedWorkouts({
    sessions: [
      { id: "a", status: "completed", workoutDate: "2026-09-21" },
      { id: "b", status: "completed", workoutDate: "2026-09-21" },
      { id: "a", status: "completed", workoutDate: "2026-09-21" },
      { id: "c", status: "in_progress", workoutDate: "2026-09-22" },
    ],
  });
  assert.equal(records.length, 2);
});

test("legacy and normalized records on the same date are not merged", () => {
  const records = collectCompletedWorkouts({
    sessions: [{ id: "s", status: "completed", workoutDate: "2026-09-21" }],
    legacyWorkouts: { "2026-09-21": { date: "2026-09-21", status: "completed" } },
    legacyDays: { "2026-09-21": { gym: true }, "2026-09-22": { gym: true } },
  });
  assert.deepEqual(
    records.map((r) => r.key),
    ["session:s", "legacy:2026-09-21", "legacy:2026-09-22"],
  );
  assert.equal(countWorkoutsInRange(records, "2026-09-21", "2026-09-21"), 2);
});

test("draft legacy workouts do not count", () => {
  const records = collectCompletedWorkouts({
    legacyWorkouts: { "2026-09-21": { date: "2026-09-21", status: "draft" } },
    legacyDays: { "2026-09-21": { gym: true } },
  });
  assert.equal(records.length, 0);
});

test("weekly goal is independent of plan structure and never a hardcoded default", () => {
  // The explicit weekly goal wins over both the plan's day count and the onboarding preference:
  // a 3-day plan with a 5-workout weekly goal must report 5, not 3.
  assert.equal(
    resolveWeeklyWorkoutTarget({
      weeklyWorkoutGoal: 5,
      activePlanDaysPerWeek: 3,
      targetDaysPerWeek: 3,
    }),
    5,
  );
  // Without an explicit goal, the plan's day count no longer wins over the onboarding target.
  assert.equal(resolveWeeklyWorkoutTarget({ activePlanDaysPerWeek: 3, targetDaysPerWeek: 5 }), 5);
  assert.equal(
    resolveWeeklyWorkoutTarget({ activePlanDaysPerWeek: null, targetDaysPerWeek: 4 }),
    4,
  );
  // Plan day count remains the last-resort fallback when nothing else is configured.
  assert.equal(resolveWeeklyWorkoutTarget({ activePlanDaysPerWeek: 3 }), 3);
  assert.equal(resolveWeeklyWorkoutTarget({}), null);
  assert.equal(resolveWeeklyWorkoutTarget({ weeklyWorkoutGoal: 0 }), null);
  assert.equal(formatWorkoutProgress(2, null), "2");
  assert.equal(formatWorkoutProgress(4, 5), "4/5");
});

const allInputs = {
  bodyweightRecorded: true,
  sleepRecorded: true,
  activityRecorded: true,
  mealLogged: true,
  workoutCompleted: true,
  restDay: false,
};

test("five equally weighted requirements, 20% each", () => {
  assert.equal(dayCompletionPercent(dayCompletionRequirements(allInputs)), 100);
  assert.equal(
    dayCompletionPercent(dayCompletionRequirements({ ...allInputs, workoutCompleted: false })),
    80,
  );
  assert.equal(
    dayCompletionPercent(
      dayCompletionRequirements({
        bodyweightRecorded: true,
        sleepRecorded: false,
        activityRecorded: false,
        mealLogged: false,
        workoutCompleted: false,
        restDay: false,
      }),
    ),
    20,
  );
});

test("rest day satisfies the workout requirement without a workout", () => {
  const reqs = dayCompletionRequirements({ ...allInputs, workoutCompleted: false, restDay: true });
  const workout = reqs.find((r) => r.key === "workout");
  assert.equal(workout.done, true);
  assert.equal(workout.label, "Rest day");
  assert.equal(dayCompletionPercent(reqs), 100);
});

test("a completed workout takes precedence over an explicit rest day", () => {
  const reqs = dayCompletionRequirements({ ...allInputs, workoutCompleted: true, restDay: true });
  const workout = reqs.find((r) => r.key === "workout");
  assert.equal(workout.label, "Workout completed");
  assert.equal(workout.done, true);
});

test("missing workout and no rest day leaves the requirement open", () => {
  const reqs = dayCompletionRequirements({ ...allInputs, workoutCompleted: false, restDay: false });
  const workout = reqs.find((r) => r.key === "workout");
  assert.equal(workout.done, false);
  assert.equal(workout.label, "Workout or rest day");
});

const w = (logDate, weightKg) => ({ logDate, weightKg });

test("goal status calibrates without enough weigh-ins", () => {
  const status = goalWeightStatus({
    weights: [w("2026-09-22", 70)],
    today: "2026-09-24",
    goal: "gain",
  });
  assert.equal(status.label, "CALIBRATING");
  assert.equal(status.changeKg, null);
});

test("estimate never reports TOO FAST; confirmed weeks can", () => {
  const lastWeek = [w("2026-09-14", 70), w("2026-09-16", 70), w("2026-09-18", 70)];
  const estimate = goalWeightStatus({
    weights: [...lastWeek, w("2026-09-21", 71), w("2026-09-22", 71)],
    today: "2026-09-24",
    goal: "gain",
    targetWeeklyGainKg: 0.25,
  });
  assert.equal(estimate.basis, "estimate");
  assert.equal(estimate.label, "ABOVE PACE");
  const confirmed = goalWeightStatus({
    weights: [w("2026-09-07", 69), w("2026-09-09", 69), w("2026-09-11", 69), ...lastWeek],
    today: "2026-09-24",
    goal: "gain",
    targetWeeklyGainKg: 0.25,
  });
  assert.equal(confirmed.basis, "confirmed");
  assert.equal(confirmed.label, "TOO FAST");
});

test("Goal pages no longer hardcode a weekly workout target", async () => {
  for (const file of [
    "src/routes/_authenticated/bulk/index.tsx",
    "src/routes/_authenticated/bulk/check-in.tsx",
  ]) {
    const source = await readFile(new URL(`../${file}`, import.meta.url), "utf8");
    assert.doesNotMatch(source, /\}\/5`/);
  }
  const settings = await readFile(
    new URL("../src/routes/_authenticated/bulk/more.tsx", import.meta.url),
    "utf8",
  );
  assert.doesNotMatch(settings, /LineChart|buildCheckInConsistency/);
  assert.match(settings, /NutritionTargetsEditor/);
});
