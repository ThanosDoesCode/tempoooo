import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { presentationComponent } from "./presentation-component-fixture.mjs";
import * as periods from "../src/lib/progress-period.ts";
import {
  strengthProgress,
  progressRecordEvents,
  trainingAdherence,
  workingPerformanceLabel,
} from "../src/lib/strength-progress.ts";
import { derivePublicPersonalRecords, mergePersonalRecords } from "../src/lib/personal-records.ts";
import { runningPeriodStats, enduranceSummary } from "../src/lib/endurance-progress.ts";
import { nutritionWindow, weightPeriodTrend } from "../src/lib/progress-model-core.ts";

const range = { start: "2026-07-07", end: "2026-10-07" };
const p = (date, load, reps, volume = load * reps) => ({
  date,
  load,
  reps,
  repLoad: load,
  repCount: reps,
  volume,
  bodyweight: null,
});
function record(performances, overrides = {}) {
  return mergePersonalRecords(
    [
      {
        key: "press",
        exerciseId: "press",
        name: "Press",
        side: null,
        isBodyweight: false,
        performances: [],
        bestWeight: null,
        bestReps: null,
        bestVolume: null,
        ...overrides,
      },
    ],
    [
      {
        key: "press",
        exerciseId: "press",
        name: "Press",
        side: null,
        isBodyweight: false,
        performances,
        ...overrides,
      },
    ],
  ).find((item) => item.performances.length);
}
const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("all five calendar-month periods have a stable three-month default and month-end handling", () => {
  assert.deepEqual(periods.PROGRESS_PERIODS, ["1", "3", "6", "12", "all"]);
  assert.equal(periods.DEFAULT_PROGRESS_PERIOD, "3");
  assert.deepEqual(periods.progressRange("1", "2026-03-31"), {
    start: "2026-02-28",
    end: "2026-03-31",
  });
  assert.deepEqual(periods.progressRange("all", "2026-10-07"), { start: null, end: "2026-10-07" });
  assert.equal(
    periods.progressRangeDays(periods.progressRange("all", "2026-10-07"), "1999-01-01"),
    10142,
  );
  assert.equal(periods.recordsPeriodTitle("all"), "All-time records");
  assert.equal(periods.recordsPeriodTitle("6"), "Records · Last 6 months");
  assert.equal(periods.inProgressRange("2026-10-08", range), false);
});

test("period preference persists between hook consumers and deep links, including unavailable storage", () => {
  const storage = new Map();
  const modules = {
    react: { useSyncExternalStore: (_, read) => read(), useCallback: (callback) => callback },
    "./progress-period.ts": periods,
    "./challenge.ts": {},
    "./progress-sections.ts": {},
    "./progress-model.ts": {},
    "./training-plans-query.ts": {},
    "./strength-estimates.ts": {},
    "./types.ts": {},
  };
  const hook = presentationComponent("src/lib/progress-view.ts", modules, {
    localStorage: {
      getItem: (key) => storage.get(key),
      setItem: (key, value) => storage.set(key, value),
    },
  });
  assert.equal(hook.useProgressPeriod()[0], "3");
  hook.useProgressPeriod()[1]("6");
  assert.equal(hook.useProgressPeriod()[0], "6");
  assert.equal(storage.get(periods.PROGRESS_PERIOD_KEY), "6");
  hook.useProgressPeriod()[1]("all");
  assert.equal(hook.useProgressPeriod()[0], "all");
  const unavailable = presentationComponent("src/lib/progress-view.ts", modules);
  unavailable.useProgressPeriod()[1]("12");
  assert.equal(unavailable.useProgressPeriod()[0], "12");
});

test("all four Progress roots use the same period; no fixed-week or plan-start summaries remain", async () => {
  for (const file of [
    "progress.tsx",
    "progress_.endurance.tsx",
    "progress_.strength.tsx",
    "progress_.body.tsx",
  ]) {
    const source = await read(`src/routes/_authenticated/bulk/${file}`);
    assert.match(source, /useProgressPeriod\(\)/);
    assert.match(source, /PeriodPicker/);
    assert.doesNotMatch(source, /BULK_START|usePeriodWeeks|monthAgo/);
  }
});

test("actual same-rep working loads are primary and comparisons respect the period", () => {
  const r = record([p("2026-01-01", 10, 10), p("2026-07-08", 24, 10), p("2026-09-01", 26, 10)]);
  const selected = strengthProgress(r, range);
  assert.equal(selected.changeKg, 2);
  assert.equal(selected.baseline.load, 24);
  assert.equal(selected.latest.load, 26);
  assert.equal(workingPerformanceLabel(r, selected.latest), "26 kg × 10");
  assert.equal(strengthProgress(r, { start: null, end: range.end }).changeKg, 16);
  assert.ok(Math.abs(selected.estimate.current - 26 * (1 + 10 / 30)) < 1e-9);
});

test("different-rep performances do not invent kg improvement; one session never invents a percentage", () => {
  const nonComparable = strengthProgress(
    record([p("2026-08-01", 20, 15), p("2026-09-01", 25, 3)]),
    range,
  );
  assert.equal(nonComparable.changeKg, null);
  assert.equal(nonComparable.latest.load, 25);
  const single = strengthProgress(record([p("2026-08-01", 20, 10)]), range);
  assert.equal(single.sessions, 1);
  assert.equal(single.estimate.changePct, null);
  assert.equal(single.changeKg, null);
});

test("bodyweight and unilateral working performances keep their meaning and do not compare unrelated sides", () => {
  const left = record([p("2026-08-01", 20, 10), p("2026-09-01", 22, 10)], { side: "left" });
  assert.equal(strengthProgress(left, range).changeKg, 2);
  assert.equal(workingPerformanceLabel(left, left.performances[0]), "22 kg × 10 · left");
  const bw = record([p("2026-08-01", 0, 10), p("2026-09-01", 5, 10)], { isBodyweight: true });
  assert.equal(strengthProgress(bw, range).changeKg, null);
  assert.equal(workingPerformanceLabel(bw, bw.performances[0]), "Bodyweight + 5 kg × 10");
});

test("working analytics keep existing completed/warmup/incomplete exclusion", () => {
  const exercise = {
    name: "Press",
    sourceExerciseId: "press",
    executionMode: "bilateral",
    isBodyweight: false,
    sets: [
      { setType: "warmup", isComplete: true, bilateralWeight: 100, bilateralReps: 10 },
      { setType: "normal", isComplete: false, bilateralWeight: 90, bilateralReps: 10 },
      { setType: "normal", isComplete: true, bilateralWeight: 24, bilateralReps: 10 },
    ],
  };
  const records = derivePublicPersonalRecords([
    { status: "in_progress", exercises: [exercise] },
    { status: "completed", completedAt: "2026-09-01", exercises: [exercise] },
  ]);
  assert.equal(records[0].bestWeight.load, 24);
  assert.equal(strengthProgress(records[0], range).sessions, 1);
});

test("adherence uses real completed counts for the selected range; zero goals and All time avoid fabricated denominators", () => {
  const workouts = Array.from({ length: 9 }, (_, i) => ({
    workoutDate: `2026-09-${String(i + 1).padStart(2, "0")}`,
  }));
  const result = trainingAdherence(workouts, { start: "2026-09-01", end: "2026-09-28" }, 5);
  assert.deepEqual(result, { completed: 9, planned: 20, percentage: 45 });
  assert.equal(trainingAdherence(workouts, range, 0).percentage, null);
  assert.equal(trainingAdherence(workouts, { start: null, end: range.end }, 5).planned, null);
  assert.equal(
    trainingAdherence(workouts, { start: "2026-10-01", end: range.end }, 5).completed,
    0,
  );
});

test("records replay existing PR comparisons before range filtering, newest first, retaining repeated exercise events", () => {
  const r = record([
    p("2026-06-01", 24, 10),
    p("2026-08-01", 20, 10),
    p("2026-09-01", 26, 10),
    p("2026-10-01", 28, 10),
  ]);
  const events = progressRecordEvents([r], range);
  assert.equal(events.length, 6); // three real record categories, on each of two improved sessions
  assert.ok(events.every((event) => event.performance.load >= 26));
  assert.equal(events[0].performance.date, "2026-10-01");
  assert.equal(new Set(events.map((event) => event.id)).size, events.length);
  assert.equal(progressRecordEvents([r], { start: null, end: range.end }).length, 9);
  assert.equal(progressRecordEvents([r], { start: "2026-10-02", end: range.end }).length, 0);
});

const activity = (id, date, type, distance, seconds, user = "me") => ({
  id,
  activity_date: date,
  activity_type: type,
  user_id: user,
  distance_km: distance,
  duration_seconds: seconds,
  created_at: `${date}T10:00:00Z`,
  is_qualified: true,
});
test("raw running counts, distance, longest run and weighted pace exclude rides and other users", () => {
  const values = [
    activity("a", "2026-09-01", "run", 5, 1500),
    activity("b", "2026-09-02", "run", 10, 3600),
    activity("ride", "2026-09-01", "cycle", 100, 1000),
    activity("other", "2026-09-01", "run", 99, 60, "other"),
  ];
  const stats = runningPeriodStats(values, "me", range);
  assert.equal(stats.runs, 2);
  assert.equal(stats.distanceKm, 15);
  assert.equal(stats.longestRunKm, 10);
  assert.equal(stats.durationSeconds, 5100);
  assert.equal(stats.pace, 340);
  assert.equal(stats.points.length, 2);
  assert.ok(stats.runsPerWeek > 0);
});

test("pace compares distance-weighted current and previous calendar periods, not the previous run", () => {
  const current = periods.progressRange("1", "2026-10-07");
  const previous = periods.previousProgressRange("1", "2026-10-07");
  const stats = runningPeriodStats(
    [
      activity("a", "2026-08-20", "run", 5, 1650),
      activity("b", "2026-09-20", "run", 5, 1500),
      activity("c", "2026-10-01", "run", 5, 1500),
    ],
    "me",
    current,
    previous,
  );
  assert.equal(stats.paceChange, 30);
  assert.equal(stats.previousPace, 330);
  const one = runningPeriodStats(
    [activity("b", "2026-09-20", "run", 5, 1500)],
    "me",
    current,
    previous,
  );
  assert.equal(one.paceChange, null);
  assert.equal(one.points.length, 1);
  assert.equal(runningPeriodStats([], "me", current).pace, null);
});

test("untimed runs never fabricate pace or total running time; sparse All time has no invented weeks", () => {
  const stats = runningPeriodStats([activity("a", "2026-10-07", "run", 5, null)], "me", {
    start: null,
    end: range.end,
  });
  assert.equal(stats.runs, 1);
  assert.equal(stats.pace, null);
  assert.equal(stats.durationSeconds, null);
  assert.equal(stats.runsPerWeek, null);
});

test("weekly target markers use historical targets, preserve pauses and misses, and selected-period streaks", () => {
  const weeks = [
    { user_id: "me", week_number: 1, week_start: "2026-06-01", equivalent_km: 10, target_km: 10 },
    { user_id: "me", week_number: 2, week_start: "2026-08-01", equivalent_km: 15, target_km: 15 },
    { user_id: "me", week_number: 4, week_start: "2026-09-01", equivalent_km: 0, target_km: 20 },
    {
      user_id: "me",
      week_number: 5,
      week_start: "2026-09-08",
      equivalent_km: 0,
      target_km: 20,
      paused: true,
    },
  ];
  const summary = enduranceSummary(weeks, "me", range);
  assert.equal(summary.bars.length, 3);
  assert.deepEqual(
    summary.bars.map((bar) => bar.targetKm),
    [15, 20, 20],
  );
  assert.equal(summary.weeksHit, 1);
  assert.equal(summary.activeWeeks, 2);
  assert.equal(summary.bestStreak, 1);
  assert.equal(summary.currentStreak, 0);
  assert.equal(summary.averageTargetKm, 17.5);
});

test("Food summaries and plotted days honor selected range and preserve historical targets", () => {
  const days = [
    { date: "2026-06-01", calories: 2000, target: 2000 },
    { date: "2026-09-01", calories: 2400, target: 2400 },
    { date: "2026-10-01", calories: 2900, target: 2900 },
  ];
  const summary = nutritionWindow(days, 1, range.end, range);
  assert.equal(summary.loggedDays, 2);
  assert.equal(summary.onTargetDays, 2);
  assert.deepEqual(
    summary.series.map((d) => d.target),
    [2400, 2900],
  );
  assert.equal(nutritionWindow(days, 1, range.end, { start: null, end: range.end }).loggedDays, 3);
  assert.equal(summary.past.length, 2);
});

test("All-time weight charts begin at earliest observed data, never arbitrary dates or future points", () => {
  const weights = { "1999-01-01": 60, "2026-09-01": 70, "2026-10-01": 71, "2026-12-01": 80 };
  assert.deepEqual(
    weightPeriodTrend(weights, { start: null, end: range.end }).series.map((point) => point.date),
    ["1999-01-01", "2026-09-01", "2026-10-01"],
  );
  assert.equal(weightPeriodTrend(weights, range).latest.weightKg, 71);
  assert.equal(weightPeriodTrend({}, range).latest, null);
});

test("shared chart tooltip formats real food values in high contrast, including original target", () => {
  const { ProgressChartTooltip } = presentationComponent("src/components/ProgressChartTooltip.tsx");
  const html = renderToStaticMarkup(
    React.createElement(ProgressChartTooltip, {
      kind: "food",
      active: true,
      payload: [{ payload: { date: "2026-10-07", calories: 2900, target: 2900 } }],
    }),
  );
  assert.match(html, /Wed 7 Oct/);
  assert.match(html, /2,900 kcal/);
  assert.match(html, /Target 2,900/);
  assert.match(html, /border-border bg-card/);
  assert.match(html, /font-semibold text-foreground/);
  assert.doesNotMatch(html, /kcal\s*:/);
  assert.match(html, /max-w-\[min/);
});

test("pace tooltip shows real date, distance, pace and duration; native run picker is keyboard accessible", async () => {
  const { ProgressChartTooltip } = presentationComponent("src/components/ProgressChartTooltip.tsx");
  const html = renderToStaticMarkup(
    React.createElement(ProgressChartTooltip, {
      kind: "pace",
      active: true,
      payload: [
        { payload: { date: "2026-10-04", distanceKm: 5.8, pace: 316, durationSeconds: 1832 } },
      ],
    }),
  );
  assert.match(html, /Sun 4 Oct/);
  assert.match(html, /5:16 \/km/);
  assert.match(html, /5.8 km · 30:32/);
  const source = await read("src/routes/_authenticated/bulk/progress_.endurance.tsx");
  assert.match(source, /aria-label="Run details"/);
  assert.match(source, /setSelectedRun/);
  assert.match(source, /h-32/);
  assert.match(source, /Dashed markers show each week/);
  assert.match(source, /than previous period/);
  assert.match(source, /Missing week data/);
  assert.doesNotMatch(source, /Sparkline|Ride speed/);
});

test("records drilldown reuses existing route and exercise histories without a 500-session cap", async () => {
  const source = await read("src/routes/_authenticated/bulk/prs.tsx");
  assert.match(source, /progressRecordEvents\(records, progressRange\(period\)\)/);
  assert.match(source, /useStrengthModel\(\)/);
  assert.match(source, /search=\{\{ record: event.record.key \}\}/);
  assert.doesNotMatch(source, /fetchRecentCompletedBulkTrainingSessions|500/);
});

test("missing weekly records never fabricate a continuous target streak", () => {
  const weeks = [1, 3].map((week_number) => ({
    user_id: "me",
    week_number,
    week_start: `2026-09-${week_number === 1 ? "01" : "15"}`,
    equivalent_km: 15,
    target_km: 15,
  }));
  const summary = enduranceSummary(weeks, "me", range);
  assert.equal(summary.bars.length, 2);
  assert.equal(summary.bestStreak, 1);
  assert.equal(summary.currentStreak, 1);
});

test("Progress timestamp windows include the full local day behind UTC without shifting date-only legacy records", () => {
  const previous = process.env.TZ;
  process.env.TZ = "America/Los_Angeles";
  try {
    const localRange = { start: "2026-10-06", end: "2026-10-06" };
    assert.equal(periods.inProgressRange("2026-10-07T03:00:00Z", localRange), true);
    assert.equal(periods.inProgressRange("2026-10-06", localRange), true);
    assert.equal(periods.inProgressRange("2026-10-07T08:00:00Z", localRange), false);
    assert.equal(periods.progressEndInstant("2026-10-06"), "2026-10-07T07:00:00.000Z");
  } finally {
    if (previous == null) delete process.env.TZ;
    else process.env.TZ = previous;
  }
});

test("separate record improvements with identical timestamps retain distinct list identities", () => {
  const r = record([p("2026-09-01T10:00:00Z", 24, 10), p("2026-09-01T10:00:00Z", 26, 10)]);
  const events = progressRecordEvents([r], range);
  assert.equal(events.filter((event) => event.kind === "weight").length, 2);
  assert.equal(new Set(events.map((event) => event.id)).size, events.length);
});
