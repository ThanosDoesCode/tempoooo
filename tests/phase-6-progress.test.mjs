import * as progressCore from "../src/lib/progress-model-core.ts";
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import vm from "node:vm";
import ts from "typescript";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { presentationComponent } from "./presentation-component-fixture.mjs";
import * as calc from "../src/lib/calc.ts";
import * as types from "../src/lib/types.ts";

import { mainTabForPath } from "../src/lib/main-navigation.ts";
import {
  epleyEstimatedMax,
  liftEstimate,
  defaultTrackedLifts,
  trackedLiftCandidates,
  resolveTrackedLifts,
} from "../src/lib/strength-estimates.ts";
import {
  enduranceSummary,
  paceTrend,
  periodRange,
  rivalComparison,
  runningPeriodStats,
} from "../src/lib/endurance-progress.ts";
import {
  availableProgressSections,
  hasBodyFoodData,
  hasStrengthData,
} from "../src/lib/progress-sections.ts";
import * as periods from "../src/lib/progress-period.ts";
import * as strengthProgressHelpers from "../src/lib/strength-progress.ts";
import { activityPage, collectActivityPages } from "../src/lib/challenge-activity-data.ts";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

// --------------------------------------------------------------- pure helpers

test("Epley estimated max follows weight × (1 + reps / 30)", () => {
  assert.equal(epleyEstimatedMax(100, 0), 100);
  assert.equal(epleyEstimatedMax(100, 30), 200);
  assert.ok(Math.abs(epleyEstimatedMax(30, 10) - 40) < 1e-9);
});

test("liftEstimate uses the best set per session, a plan-start baseline, and skips bodyweight-only", () => {
  const record = {
    name: "Incline Dumbbell Press",
    performances: [
      { date: "2026-08-20", load: 24, reps: 10 }, // before plan start — ignored as baseline
      { date: "2026-09-01", load: 24, reps: 12 },
      { date: "2026-10-01", load: 26, reps: 10 },
    ],
  };
  const estimate = liftEstimate(record, "2026-09-01");
  assert.equal(estimate.series.length, 3);
  assert.ok(Math.abs(estimate.current - epleyEstimatedMax(26, 10)) < 1e-9);
  // Baseline is the first session on/after plan start, never today's target.
  assert.equal(estimate.baselineDate, "2026-09-01");
  assert.equal(estimate.trend, "up");

  const bodyweightOnly = liftEstimate({
    name: "Pull-Ups",
    performances: [{ date: "x", load: null, reps: 8 }],
  });
  assert.equal(bodyweightOnly.trend, "insufficient");
  assert.equal(bodyweightOnly.current, null);
});

test("default tracked lifts are the first lift of each plan day", () => {
  const names = defaultTrackedLifts({ targets: {} });
  assert.equal(names.length, 3);
  assert.ok(names.includes("Incline Dumbbell Press"));
});

test("endurance summary reuses settled week rows: paused/hit/missed, streak, averages", () => {
  const weeks = [
    {
      user_id: "me",
      week_number: 1,
      week_start: "2026-10-01",
      week_end: "2026-10-07",
      equivalent_km: 0,
      target_km: 15,
      paused: true,
      running_km: 0,
      cycling_km: 0,
    },
    {
      user_id: "me",
      week_number: 2,
      equivalent_km: 8.4,
      target_km: 15,
      paused: false,
      running_km: 8.4,
      cycling_km: 0,
    },
    {
      user_id: "me",
      week_number: 3,
      equivalent_km: 16,
      target_km: 15,
      paused: false,
      running_km: 16,
      cycling_km: 0,
    },
    {
      user_id: "me",
      week_number: 4,
      equivalent_km: 15.2,
      target_km: 15,
      paused: false,
      running_km: 10,
      cycling_km: 6,
    },
    {
      user_id: "rival",
      week_number: 2,
      equivalent_km: 20,
      target_km: 15,
      paused: false,
      running_km: 20,
      cycling_km: 0,
    },
  ];
  const summary = enduranceSummary(weeks, "me", 4);
  assert.equal(summary.bars.length, 4);
  assert.equal(summary.pausedWeeks, 1);
  assert.equal(summary.activeWeeks, 3);
  assert.equal(summary.weeksHit, 2); // weeks 3 and 4
  assert.equal(summary.bestStreak, 2); // consecutive hits, paused week does not break
  assert.ok(Math.abs(summary.avgKmPerActiveWeek - (8.4 + 16 + 15.2) / 3) < 1e-9);
  assert.equal(summary.targetKm, 15);

  const rival = rivalComparison(weeks, "rival");
  assert.equal(rival.weeksHit, 1);
  assert.equal(rival.activeWeeks, 1);
});

test("pace trend uses the dominant qualifying activity type", () => {
  const activities = [
    {
      user_id: "me",
      activity_type: "run",
      distance_km: 5,
      duration_seconds: 1500,
      activity_date: "2026-09-10",
      is_qualified: true,
    },
    {
      user_id: "me",
      activity_type: "run",
      distance_km: 6,
      duration_seconds: 1680,
      activity_date: "2026-09-20",
      is_qualified: true,
    },
    {
      user_id: "me",
      activity_type: "cycle",
      distance_km: 20,
      duration_seconds: 3600,
      activity_date: "2026-09-15",
      is_qualified: true,
    },
    {
      user_id: "other",
      activity_type: "run",
      distance_km: 99,
      duration_seconds: 100,
      activity_date: "2026-09-21",
      is_qualified: true,
    },
  ];
  const trend = paceTrend(activities, "me");
  assert.equal(trend.kind, "run");
  assert.equal(trend.series.length, 2);
  assert.equal(trend.longestRunKm, 6);
  assert.equal(paceTrend([], "me").latest, null); // 0-point safe
});

// --------------------------------------------------------------- Overview

test("Progress Overview shows enabled areas and a deterministic insight, Progress tab stays active", async () => {
  const [overview, chrome, view] = await Promise.all([
    read("src/routes/_authenticated/bulk/progress.tsx"),
    read("src/components/ProgressChrome.tsx"),
    read("src/lib/progress-view.ts"),
  ]);
  // Product availability keeps the four sections stable, regardless of analytics history.
  assert.match(chrome, /Overview/);
  assert.match(chrome, /Endurance/);
  assert.match(chrome, /Strength/);
  assert.match(chrome, /Body & food/);
  assert.match(view, /availableProgressSections\(\{ hasFitnessTools: mode !== "none" \}\)/);
  // One shared Overview for public and legacy (only "none" is gated); a plain-language insight.
  assert.match(overview, /bulkPlanModeFor\(memberships\.data, bulkId\)/);
  assert.match(overview, /planMode === "none"/);
  assert.match(overview, /OwnProgress/);
  assert.doesNotMatch(overview, /<PublicBulkProgress/);
  assert.match(overview, /buildInsight/);
  assert.match(overview, /to="\/bulk\/check-in"/); // Weekly review row, not an embedded form
  // Every Progress descendant lights the Progress tab.
  for (const path of [
    "/bulk/progress",
    "/bulk/progress/endurance",
    "/bulk/progress/strength",
    "/bulk/progress/strength/Goblet",
    "/bulk/progress/body",
    "/bulk/progress/body/food",
    "/bulk/progress/photos",
  ])
    assert.equal(mainTabForPath(path), "progress");
});

test("Overview keeps honest empty states instead of hiding product areas", async () => {
  const overview = await read("src/routes/_authenticated/bulk/progress.tsx");
  assert.match(overview, /planMode === "none"/);
  assert.match(overview, /animate-pulse/);
  assert.match(overview, /sections\.includes\("strength"\) \?/);
  assert.match(overview, /No data yet/);
  assert.match(overview, /Log your first weight/);
  assert.match(overview, /Start logging meals/);
  assert.match(overview, /food\.loggedDays > 0/);
});

// --------------------------------------------------------------- Endurance

test("Endurance uses existing challenge data only and reuses challenge helpers", async () => {
  const endurance = await read("src/routes/_authenticated/bulk/progress_.endurance.tsx");
  assert.match(endurance, /useWeeks\(challengeId\)/);
  assert.match(endurance, /useMyChallenge\(\)/);
  assert.match(endurance, /enduranceSummary\(/);
  assert.match(endurance, /rivalComparison\(/);
  assert.match(endurance, /runningPeriodStats\(/);
  // Money comes from the stored payment rows, not a re-derivation.
  assert.match(endurance, /usePayments\(challengeId\)/);
  // Deep-link safe empty state when there is no challenge.
  assert.match(endurance, /No challenge yet/);
});

// --------------------------------------------------------------- Strength

test("Strength shows real working performance with secondary Epley, period, Edit and records/history", async () => {
  const strength = await read("src/routes/_authenticated/bulk/progress_.strength.tsx");
  assert.match(strength, /useTrackedLifts\(data\)/);
  assert.match(strength, /strengthProgress\(record, range\)/);
  assert.match(strength, /comparable tracked lifts improved/);
  assert.match(strength, /aria-expanded=\{editing\}/); // Edit toggle
  assert.match(strength, /to="\/bulk\/progress\/strength\/\$lift"/);
  assert.match(strength, /to="\/bulk\/prs"/);
  assert.match(strength, /to="\/bulk\/training\/history"/);
  // Plan-start comparison is period-independent (no period picker on this view).
  assert.match(strength, /PeriodPicker/);
});

test("Lift detail charts per-session estimated max, marks the record, and reuses progression for advice", async () => {
  const lift = await read("src/routes/_authenticated/bulk/progress_.strength_.$lift.tsx");
  assert.match(lift, /backTo="\/bulk\/progress\/strength"/);
  assert.match(lift, /backLabel="Strength"/);
  assert.match(lift, /strengthProgress\(record, progressRange\(period\)\)/);
  assert.match(lift, /chart\.length >= 2 \?/); // 0/1-point safe
  assert.match(lift, /Record/);
  // Next-session advice reuses the existing own-mode progression verdict, never a new engine.
  assert.match(lift, /progressionFor\(data, entry, latest\.date\)/);
  assert.match(lift, /def\.min.*def\.max/s);
});

// --------------------------------------------------------------- Body & food

test("Body & food reuses the shared 7-day-average model and goal math and links to food/review/photos", async () => {
  const [body, core] = await Promise.all([
    read("src/routes/_authenticated/bulk/progress_.body.tsx"),
    read("src/lib/progress-model-core.ts"),
  ]);
  // The weight model drives it; the authoritative 7-day average is one shared trailing computation.
  assert.match(body, /useWeightModel\(range\)/);
  assert.match(core, /export function trailingAvg/);
  assert.match(core, /export function weightTrend/);
  assert.match(body, /weight\.points >= 2 \?/); // chart guard
  assert.match(body, /Goal \{fmt\(weight\.goal\.target, 1\)\}/);
  assert.match(body, /to="\/bulk\/progress\/body\/food"/);
  assert.match(body, /to="\/bulk\/check-in"/);
  assert.match(body, /to="\/bulk\/progress\/photos"/);
});

test("Food details summarises the week against the target and shows past days as totals only", async () => {
  const food = await read("src/routes/_authenticated/bulk/progress_.body_.food.tsx");
  assert.match(food, /backTo="\/bulk\/progress\/body" backLabel="Body & food"/);
  assert.match(food, /useFoodModel\(progressRange\(period\)\)/);
  assert.match(food, /food\.knownTargetDays \?\? food\.loggedDays/);
  assert.match(food, /food\.loggedDays \?/); // bars only when a day is logged
  assert.match(food, /food\.past\.map/); // past days as plain totals
  assert.match(food, /to="\/bulk\/meals\/history"/);
});

// --------------------------------------------------------------- Photos

test("Progress photos are a private, owner-scoped, angle-first screen that returns to Body & food", async () => {
  const photos = await read("src/routes/_authenticated/bulk/progress_.photos.tsx");
  assert.match(photos, /createFileRoute\("\/_authenticated\/bulk\/progress_\/photos"\)/);
  assert.match(photos, /backTo="\/bulk\/progress\/body"/);
  assert.match(photos, /backLabel="Body & food"/);
  assert.match(photos, /role="tablist" aria-label="Angle"/);
  assert.match(photos, /useActions\(\)/);
  assert.match(photos, /optimizeBulkPhoto/);
  assert.match(photos, /Only you can see these/);
  assert.match(photos, /role === "owner"/);
  assert.doesNotMatch(photos, /getPublicUrl|public = true/);
});

// --------------------------------------------------------------- regression

test("the two recent UX fixes stay intact", async () => {
  const [today, more] = await Promise.all([
    read("src/routes/_authenticated/bulk/index.tsx"),
    read("src/routes/_authenticated/bulk/training_.more.tsx"),
  ]);
  // Today meals complete only when the calorie target is reached.
  assert.match(today, /nutritionMacroStatus\(totals\.calories, mealTarget\)\.status !== "under"/);
  // Muscle coverage keeps its expand affordance.
  assert.match(more, /aria-expanded=\{coverageOpen\}/);
});

// ------------------------------------------------- alignment pass (round 2)

const appData = (over = {}) => ({
  workouts: {},
  days: {},
  photos: [],
  weekNotes: {},
  targets: { calories: 2500 },
  ...over,
});
const loggedWorkout = {
  "2026-09-01": {
    date: "2026-09-01",
    type: "Legs",
    status: "completed",
    entries: [{ exercise: "Leg Extensions", weight: 40, reps: [10] }],
  },
};

test("Progress data predicates remain unchanged; navigation availability is feature-driven", () => {
  // The legacy data predicates (also used for the legacy mode's flags).
  assert.equal(hasStrengthData(appData({ workouts: loggedWorkout })), true);
  assert.equal(hasStrengthData(appData()), false);
  assert.equal(hasBodyFoodData(appData({ days: { d: { date: "d", weight: 70 } } })), true);
  assert.equal(hasBodyFoodData(appData({ photos: [{ id: "p", date: "d" }] })), true);
  assert.equal(hasBodyFoodData(appData()), false);

  assert.deepEqual(availableProgressSections({ hasFitnessTools: true }), [
    "overview",
    "endurance",
    "strength",
    "body",
  ]);
  assert.deepEqual(availableProgressSections({ hasFitnessTools: false }), [
    "overview",
    "endurance",
  ]);
});

test("every Progress sub-route renders a safe empty state on a direct deep link", async () => {
  const [endurance, strength, body, food] = await Promise.all([
    read("src/routes/_authenticated/bulk/progress_.endurance.tsx"),
    read("src/routes/_authenticated/bulk/progress_.strength.tsx"),
    read("src/routes/_authenticated/bulk/progress_.body.tsx"),
    read("src/routes/_authenticated/bulk/progress_.body_.food.tsx"),
  ]);
  assert.match(endurance, /No challenge yet/);
  assert.match(strength, /No tracked lifts yet|Not enough data yet/);
  assert.match(body, /No weigh-ins yet/);
  assert.match(food, /no days logged yet/);
});

test("endurance period metrics cover all qualifying activities in the period, not a recent slice", () => {
  // An older run is the longest and the earliest trend point; a non-qualifying run is excluded.
  const activities = [
    {
      user_id: "me",
      activity_type: "run",
      distance_km: 12,
      duration_seconds: 3600,
      activity_date: "2026-09-02",
      is_qualified: true,
    },
    {
      user_id: "me",
      activity_type: "run",
      distance_km: 5,
      duration_seconds: 1500,
      activity_date: "2026-09-25",
      is_qualified: true,
    },
    {
      user_id: "me",
      activity_type: "run",
      distance_km: 99,
      duration_seconds: 100,
      activity_date: "2026-09-26",
      is_qualified: false,
    },
  ];
  const trend = paceTrend(activities, "me");
  assert.equal(trend.series.length, 2); // the non-qualifying run is excluded
  assert.equal(trend.longestRunKm, 12); // the older qualifying run is still the longest
  assert.equal(trend.first, 300); // oldest-first: 3600s / 12km

  const weeks = [
    { user_id: "me", week_number: 1, week_start: "2026-09-01", week_end: "2026-09-07" },
    { user_id: "me", week_number: 2, week_start: "2026-09-08", week_end: "2026-09-14" },
    { user_id: "me", week_number: 3, week_start: "2026-09-15", week_end: "2026-09-21" },
  ];
  assert.deepEqual(periodRange(weeks, "me", 2), { start: "2026-09-08", end: "2026-09-21" });
  assert.equal(periodRange([], "me", 4), null);
});

test("endurance route loads the full-period activity query, not the recent feed", async () => {
  const endurance = await read("src/routes/_authenticated/bulk/progress_.endurance.tsx");
  assert.match(endurance, /useEnduranceActivities\(challengeId, range\)/);
  assert.match(endurance, /previousProgressRange\(period\)/);
  assert.doesNotMatch(endurance, /useActivities\(/); // no bounded recent-feed fallback
});

test("historical nutrition target snapshots are used where they exist (normalized/public) and not faked for legacy", async () => {
  const [history, food] = await Promise.all([
    read("src/routes/_authenticated/bulk/meals_.history.tsx"),
    read("src/routes/_authenticated/bulk/progress_.body_.food.tsx"),
  ]);
  // Normalized/public per-day snapshot: adherence is judged against the day's own stored targets.
  assert.match(history, /useBulkNutritionDay\(isPublic \? bulkId : null/);
  assert.match(
    history,
    /nutritionSummary\(nutrition\.data\.entries, nutrition\.data\.day\.targets\)/,
  );
  // Legacy Food Details past days are totals only — the past list renders kcal, no target verdict.
  assert.match(food, /past\.map\(\(d\) => \([\s\S]*fmt0\(d\.calories\)\} kcal/);
});

test("Weekly review is restyled to the handoff while keeping Check-In logic and route", async () => {
  const checkIn = await read("src/routes/_authenticated/bulk/check-in.tsx");
  assert.match(checkIn, /createFileRoute\("\/_authenticated\/bulk\/check-in"\)/); // same route/model
  assert.match(checkIn, /backTo="\/bulk\/progress"/); // parent-aware back
  assert.match(checkIn, /What to do next week/); // one primary recommendation
  for (const title of ["Body", "Food", "Training", "Activity and sleep"])
    assert.match(checkIn, new RegExp(`title="${title}"`)); // four grouped cards
  assert.match(checkIn, /Copy summary for ChatGPT/);
  assert.match(checkIn, /more weigh-in/); // calibrating state
  // Business logic preserved: recommendation engine, notes persistence, public review.
  assert.match(checkIn, /s\.advice\.decision/);
  assert.match(checkIn, /goalWeightStatus|goalStatus/);
  assert.match(checkIn, /setWeekNote/);
  assert.match(checkIn, /<PublicWeeklyReview/);
});

// ------------------------------------------- endurance pagination (round 3)

const run = (i, distanceKm, durationSeconds) => {
  const day = String(28 - i).padStart(2, "0"); // newest first, like the server ordering
  return {
    id: `run-${String(i).padStart(2, "0")}`,
    user_id: "me",
    activity_type: "run",
    distance_km: distanceKm,
    duration_seconds: durationSeconds,
    activity_date: `2026-09-${day}`,
    created_at: `2026-09-${day}T08:00:00.000Z`,
    is_qualified: true,
  };
};

/** A fake cursor-paged source over an ordered list, mirroring the real server paging. */
const pagedSource = (ordered, pageSize) => (cursor) => {
  const startIdx = cursor ? ordered.findIndex((a) => a.id === cursor.id) + 1 : 0;
  return Promise.resolve(activityPage(ordered.slice(startIdx, startIdx + pageSize + 1), pageSize));
};

test("period-scoped endurance activities are paged to exhaustion, not capped at one page", async () => {
  // 25 qualifying runs across a period; the longest (99 km) is the OLDEST, so it lands on a later page.
  const ordered = Array.from({ length: 25 }, (_, i) =>
    run(i, i === 24 ? 99 : 5 + (i % 4), 1500 + i * 10),
  );
  const pageSize = 10;

  const collected = await collectActivityPages(pagedSource(ordered, pageSize));
  assert.equal(collected.length, 25); // all three pages aggregated, deduped by id

  const trend = paceTrend(collected, "me");
  assert.equal(trend.series.length, 25); // every page participates in the trend
  assert.equal(trend.longestRunKm, 99); // a later-page activity is the longest run
  // Oldest activity (page 3) is first in the date-ordered trend: 99 km over its duration.
  const oldest = ordered[24];
  assert.equal(trend.first, oldest.duration_seconds / oldest.distance_km);
});

test("overlapping page boundaries never double-count an activity", async () => {
  const [r1, r2, r3] = [run(0, 5, 1500), run(1, 6, 1500), run(2, 7, 1500)];
  // A deliberately broken source where r2 appears on two consecutive pages.
  const pages = [
    {
      rows: [r1, r2],
      next: { activity_date: r2.activity_date, created_at: r2.created_at, id: r2.id },
    },
    { rows: [r2, r3], next: null },
  ];
  let call = 0;
  const collected = await collectActivityPages(() => Promise.resolve(pages[call++]));
  assert.equal(collected.length, 3); // r2 counted once despite the overlap
  assert.equal(collected.filter((a) => a.id === r2.id).length, 1);
});

test("the Endurance query pages the shared fetch within the selected range", async () => {
  const challenge = await read("src/lib/challenge.ts");
  assert.match(challenge, /collectActivityPages\(\(cursor\) =>/);
  assert.match(challenge, /fetchActivityPage\(challengeId, cursor, range, pageSize\)/);
  assert.match(challenge, /pageSize = ACTIVITY_PAGE_SIZE/); // sensible fixed page size, range-bounded
});

// ------------------------------------------- public-mode primary (round 4)

test("normalized/public users get the new Overview IA, never the old PublicBulkProgress dashboard", async () => {
  const [overview, model, view] = await Promise.all([
    read("src/routes/_authenticated/bulk/progress.tsx"),
    read("src/lib/progress-model.ts"),
    read("src/lib/progress-view.ts"),
  ]);
  // The route renders OwnProgress for public and legacy alike — the old dashboard is gone from it.
  assert.doesNotMatch(overview, /PublicBulkProgress/);
  assert.doesNotMatch(overview, /Weekly trends across weight, training and nutrition/);
  assert.match(overview, /return <OwnProgress data=\{data\} \/>/);
  // Public mode reads normalized Supabase data; legacy reads the store — one shared view-model.
  assert.match(model, /useBulkWeights/);
  assert.match(model, /useBulkProgressNutrition/);
  assert.match(model, /useCompletedBulkTrainingSessions/);
  assert.match(model, /derivePublicPersonalRecords/);
  assert.match(model, /mode === "public"/);
  // Nutrition adherence in public mode uses each day's own stored target snapshot.
  assert.match(model, /target: day\.targetCalories/);
  // Both authorized fitness modes expose the same areas, even with no normalized rows yet.
  assert.match(view, /hasFitnessTools: mode !== "none"/);
});

test("Progress photos are mode-aware: public uses the private normalized photo store", async () => {
  const photos = await read("src/routes/_authenticated/bulk/progress_.photos.tsx");
  assert.match(photos, /mode === "public"/);
  assert.match(photos, /useBulkProgressPhotos/);
  assert.match(photos, /uploadBulkProgressPhoto/);
  assert.match(photos, /deleteBulkProgressPhoto/);
  // Still private: signed URLs only, owner-only delete, no public URLs.
  assert.match(photos, /photo\.signedUrl/);
  assert.doesNotMatch(photos, /getPublicUrl|public = true/);
});

// ------------------------------------------- mode-aware photo count (round 5)

test("Body & food photo count is mode-aware (normalized for public, legacy otherwise)", async () => {
  const { resolvePhotoCount } = await import("../src/lib/progress-model-core.ts");
  // Public user with normalized photos shows the normalized count, not the (empty) legacy count.
  assert.equal(resolvePhotoCount("public", 3, 0), 3);
  // Legacy user shows the legacy count.
  assert.equal(resolvePhotoCount("legacy", 0, 2), 2);
  // Zero-photo state still works in both modes.
  assert.equal(resolvePhotoCount("public", 0, 0), 0);
  assert.equal(resolvePhotoCount("legacy", 0, 0), 0);

  const [body, model] = await Promise.all([
    read("src/routes/_authenticated/bulk/progress_.body.tsx"),
    read("src/lib/progress-model.ts"),
  ]);
  assert.match(body, /const photoCount = usePhotoCount\(\)/);
  // Count is owner-scoped metadata, independent of bounded signed gallery pages.
  assert.match(model, /useBulkProgressPhotoCount\(publicId\)/);
  assert.match(
    model,
    /resolvePhotoCount\(mode, photos\.data \?\? 0, data\?\.photos\.length \?\? 0\)/,
  );
});

// ------------------------------------------- date-range fix (round 6)

test("weightTrend builds a chronological trailing window ending today (not the future)", async () => {
  const { weightTrend } = await import("../src/lib/progress-model-core.ts");

  // Oct 4, trailing 4 weeks (28 days): starts 27 days earlier, ends today, oldest-first.
  const oct = weightTrend({}, 28, "2026-10-04");
  assert.equal(oct.series.length, 28);
  assert.equal(oct.series[0].date, "2026-09-07");
  assert.equal(oct.series[27].date, "2026-10-04");
  assert.ok(oct.series.every((p) => p.date <= "2026-10-04")); // never a future date
  assert.ok(oct.series[0].date < oct.series[27].date); // chronological

  // Month boundary.
  const mar = weightTrend({}, 28, "2026-03-01");
  assert.equal(mar.series[0].date, "2026-02-02");
  assert.equal(mar.series[27].date, "2026-03-01");

  // Year boundary.
  const jan = weightTrend({}, 28, "2026-01-10");
  assert.equal(jan.series[0].date, "2025-12-14");
  assert.equal(jan.series[27].date, "2026-01-10");

  // Leap vs non-leap: Mar 1 2024 (leap) reaches back one day further into Feb than 2026 does.
  assert.equal(weightTrend({}, 28, "2024-03-01").series[0].date, "2024-02-03");
  assert.equal(weightTrend({}, 28, "2026-03-01").series[0].date, "2026-02-02");

  // The 7-day average is a real trailing average over the day→weight map.
  const trend = weightTrend({ "2026-10-03": 64, "2026-10-04": 66 }, 28, "2026-10-04");
  assert.equal(trend.avgKg, 65);
  assert.equal(trend.latest.date, "2026-10-04");
});

// Execute the actual route/components and availability hook with empty or measured query results.
// The adapters remain mocked at their boundary; existing pure-math tests cover their calculations.
async function progressFixture(options = {}) {
  const require = createRequire(import.meta.url);
  const mode = options.mode ?? "public";
  const q = (data) => ({ data, isLoading: false, error: null });
  const weight = options.weight ?? {
    latestKg: null,
    hasData: false,
    loading: false,
    series: [],
    goal: { remainingKg: null },
  };
  const food = options.food ?? {
    loggedDays: 0,
    onTargetDays: 0,
    loading: false,
    week7: [],
    series: [],
    past: [],
    avgKcal: null,
    target: 2500,
  };
  const strength = options.strength ?? { records: [], workoutRecords: [], loading: false };
  const data = appData({ targets: { calories: 2500, weeklyWorkoutGoal: 4 } });
  const modules = {
    react: React,
    "./NotificationBell": { NotificationBell: () => null },
    "react/jsx-runtime": require("react/jsx-runtime"),
    "@tanstack/react-router": {
      Link: ({ to, preload, params, ...props }) => React.createElement("a", { ...props, href: to }),
      createFileRoute: () => (config) => ({
        ...config,
        useParams: () => ({ lift: options.lift ?? "Incline Dumbbell Press" }),
        useSearch: () => ({}),
      }),
    },
    "@/components/AppShell": {
      AppShell: ({ children }) => React.createElement("main", {}, children),
      PageHeader: ({ title }) => React.createElement("h1", {}, title),
    },
    "@/components/ui-kit": {
      Card: ({ children, className }) => React.createElement("div", { className }, children),
    },
    "@/lib/store": { useAppData: () => data, useBulkMeta: () => ({ bulkId: "owner" }) },
    "@/lib/bulk-access": { useMemberships: () => q([]), bulkPlanModeFor: () => mode },
    "@/lib/auth": { useAuth: () => ({ user: { id: "me" } }) },
    "@/lib/challenge": {
      useMyChallenge: () => q(options.challenge ?? null),
      useWeeks: () => q(options.weeks ?? []),
      useChallengeMembers: () => q([]),
      usePayments: () => q([]),
      useEnduranceActivities: () => q([]),
      ...calc,
      formatPace: () => "",
      eur: () => "",
    },
    "@/lib/progress-model": {
      useProgressMode: () => ({ mode, publicId: mode === "public" ? "owner" : null }),
      useWeightModel: () => weight,
      useFoodModel: () => food,
      useStrengthModel: () => strength,
    },
    "@/lib/calc": calc,
    "@/lib/progress-period": periods,
    "@/lib/progress-model-core": progressCore,
    "@/lib/strength-progress": strengthProgressHelpers,
    "@/components/ProgressChartTooltip": presentationComponent(
      "src/components/ProgressChartTooltip.tsx",
    ),
    "@/components/ui/native-select": presentationComponent("src/components/ui/native-select.tsx"),
    recharts: require("recharts"),
    "@/lib/strength-estimates": {
      epleyEstimatedMax,
      liftEstimate,
      defaultTrackedLifts,
      trackedLiftCandidates,
      resolveTrackedLifts,
    },
    "@/lib/training-plans-query": {
      useActiveTrainingPlan: () =>
        q(
          Object.hasOwn(options, "plan")
            ? options.plan
            : {
                id: "plan",
                days: defaultTrackedLifts(data).map((name, order) => ({
                  order,
                  exercises: [{ name, order: 0, isBodyweight: false, repMin: 8, repMax: 12 }],
                })),
              },
        ),
    },
    "@/lib/types": types,
    "@/lib/goal-metrics": require("../src/lib/goal-metrics.ts"),
    "@/lib/progress-sections": { availableProgressSections },
    "@/lib/endurance-progress": {
      enduranceSummary,
      paceTrend,
      periodRange,
      rivalComparison,
      runningPeriodStats,
    },
  };
  const cache = {};
  async function prepare(file) {
    if (cache[file]) return;
    const source = await read(file);
    for (const target of ["src/components/ProgressChrome.tsx", "src/lib/progress-view.ts"])
      if (target !== file && !cache[target] && !file.endsWith("progress-view.ts"))
        await prepare(target);
    const context = {
      exports: {},
      require(name) {
        if (modules[name]) return modules[name];
        if (name === "./progress-period.ts") return periods;
        if (name === "./challenge.ts") return modules["@/lib/challenge"];
        if (name === "./progress-model.ts") return modules["@/lib/progress-model"];
        if (name === "./progress-sections.ts") return modules["@/lib/progress-sections"];
        if (name === "./strength-estimates.ts") return modules["@/lib/strength-estimates"];
        if (name === "./training-plans-query.ts") return modules["@/lib/training-plans-query"];
        if (name === "./types.ts") return types;
        if (name === "@/lib/progress-view") return cache["src/lib/progress-view.ts"];
        if (name === "@/components/ProgressChrome")
          return cache["src/components/ProgressChrome.tsx"];
        if (name === "./MainPageHeader")
          return presentationComponent("src/components/MainPageHeader.tsx", modules);
        if (name === "@/components/ui/native-select")
          return presentationComponent("src/components/ui/native-select.tsx");
        if (name === "date-fns" || name === "lucide-react") return require(name);
        throw new Error(`Unexpected import ${name} in ${file}`);
      },
    };
    vm.runInNewContext(
      ts.transpileModule(source, {
        compilerOptions: {
          module: ts.ModuleKind.CommonJS,
          target: ts.ScriptTarget.ES2022,
          jsx: ts.JsxEmit.ReactJSX,
        },
      }).outputText,
      context,
    );
    cache[file] = context.exports;
  }
  // Prepare view first; Chrome reads this hook rather than a duplicated availability mock.
  await prepare("src/lib/progress-view.ts");
  await prepare("src/components/ProgressChrome.tsx");
  return {
    async render(file) {
      await prepare(file);
      return renderToStaticMarkup(React.createElement(cache[file].Route.component));
    },
    picker(period) {
      return renderToStaticMarkup(
        React.createElement(cache["src/components/ProgressChrome.tsx"].PeriodPicker, {
          period,
          onChange() {},
        }),
      );
    },
    nav(active) {
      return renderToStaticMarkup(
        React.createElement(cache["src/components/ProgressChrome.tsx"].ProgressNav, { active }),
      );
    },
  };
}
const overviewPath = "src/routes/_authenticated/bulk/progress.tsx";
const tileMarkup = (html) =>
  [...html.matchAll(/<a\b[^>]*class="[^"]*min-h-\[150px\][^"]*"[^>]*>[\s\S]*?<\/a>/g)].map(
    (m) => m[0],
  );

test("empty enabled public and legacy Overview renders four honest tiles and stable segmented navigation", async () => {
  for (const mode of ["public", "legacy"]) {
    const fixture = await progressFixture({ mode });
    const html = await fixture.render(overviewPath);
    const tiles = tileMarkup(html);
    assert.equal(tiles.length, 4);
    for (const [index, label] of ["Endurance", "Strength", "Body", "Food"].entries())
      assert.match(tiles[index], new RegExp(label));
    assert.match(tiles[0], /No data yet.*Log a run or ride/s);
    assert.match(tiles[1], /No data yet.*Complete a workout/s);
    assert.match(tiles[2], /Log your first weight/);
    assert.match(tiles[3], /Start logging meals/);
    for (const tile of tiles)
      assert.doesNotMatch(tile, /\b\d+(?:\.\d+)? (?:km|kg)|\d+ of \d+|<svg|↑/);
    assert.doesNotMatch(html, /bg-primary\/10/); // No claims when no data exists.
    for (const active of ["overview", "endurance", "strength", "body"]) {
      const nav = fixture.nav(active);
      assert.equal((nav.match(/<a\b/g) ?? []).length, 4);
      assert.equal((nav.match(/aria-current="page"/g) ?? []).length, 1);
    }
  }
});

test("Body/Food retain real values and insight without inventing missing Strength/Endurance", async () => {
  for (const weight of [
    { latestKg: 70, hasData: true, loading: false, series: [], goal: { remainingKg: 5 } },
    { latestKg: null, hasData: false, loading: false, series: [], goal: { remainingKg: 5 } },
  ]) {
    const fixture = await progressFixture({
      weight,
      food: { loggedDays: 7, onTargetDays: 5, loading: false },
    });
    const html = await fixture.render(overviewPath);
    const tiles = tileMarkup(html);
    assert.equal(tiles.length, 4);
    assert.match(tiles[0], /No data yet.*Log a run or ride/s);
    assert.match(tiles[1], /No data yet/);
    assert.match(tiles[2], weight.latestKg != null ? /70.0 kg/ : /Log your first weight/);
    assert.match(tiles[3], /5 of 7/);
    const insight = html.match(/<p class="[^"]*bg-primary\/10[^"]*">([\s\S]*?)<\/p>/)?.[1];
    assert.ok(insight);
    assert.doesNotMatch(insight, /main lifts|endurance/);
    assert.match(
      insight,
      weight.latestKg != null ? /5.0 kg from your goal/ : /calorie target on 5 of 7/,
    );
  }
});

test("one measurable workout calibrates Strength rather than claiming a fake improvement", async () => {
  const fixture = await progressFixture({
    strength: {
      records: [
        {
          name: "Incline Dumbbell Press",
          performances: [{ date: "2026-09-01", load: 24, reps: 10 }],
        },
      ],
      workoutRecords: [],
      loading: false,
    },
  });
  const html = await fixture.render(overviewPath);
  assert.match(tileMarkup(html)[1], /No data yet.*Complete a workout/s);
  assert.doesNotMatch(tileMarkup(html)[1], /tracked lifts up|↑/);
});

test("empty direct Strength and Endurance routes render actionable states without records/history dead ends", async () => {
  const fixture = await progressFixture();
  const strength = await fixture.render("src/routes/_authenticated/bulk/progress_.strength.tsx");
  assert.match(strength, /Tracked lifts.*No data yet/s);
  assert.match(strength, /href="\/bulk\/training"/);
  assert.doesNotMatch(strength, /0 of 0|href="\/bulk\/prs"|href="\/bulk\/training\/history"/);
  const endurance = await fixture.render("src/routes/_authenticated/bulk/progress_.endurance.tsx");
  assert.match(endurance, /Start a challenge to unlock endurance trends/);
  assert.match(endurance, /href="\/challenge"/);
  assert.doesNotMatch(endurance, /<polyline|a week, on average/);
});

test("measured Endurance and Strength still use real summaries, trends and supported insight", async () => {
  const fixture = await progressFixture({
    challenge: { id: "challenge" },
    weeks: [
      {
        user_id: "me",
        week_number: 1,
        week_start: "2026-10-01",
        week_end: "2026-10-07",
        equivalent_km: 16,
        target_km: 15,
        paused: false,
        running_km: 16,
        cycling_km: 0,
      },
    ],
    strength: {
      records: [
        {
          name: "Incline Dumbbell Press",
          performances: [
            { date: "2026-09-01", load: 24, reps: 10 },
            { date: "2026-09-08", load: 26, reps: 10 },
          ],
        },
      ],
      workoutRecords: [],
      loading: false,
    },
  });
  const html = await fixture.render(overviewPath);
  const tiles = tileMarkup(html);
  assert.equal(tiles.length, 4);
  assert.match(tiles[0], /16.0 km.*a week · latest target 15/s);
  assert.match(tiles[1], /1 of 1.*tracked lifts up/s);
  const insight = html.match(/<p class="[^"]*bg-primary\/10[^"]*">([\s\S]*?)<\/p>/)?.[1];
  assert.match(insight, /endurance target in 1 of 1 active week/);
  assert.match(insight, /1 of 1 tracked lifts are up/);
});

test("Progress controls retain equal-width centered segments and a single explicit select chevron", async () => {
  const fixture = await progressFixture();
  const nav = fixture.nav("body");
  assert.match(nav, /flex gap-1/);
  const links = [...nav.matchAll(/<a\b[^>]*>/g)].map((match) => match[0]);
  assert.equal(links.length, 4);
  for (const link of links) {
    assert.match(link, /min-h-11 min-w-0 flex-1 basis-0/);
    assert.match(link, /justify-center/);
    assert.match(link, /px-1/);
    assert.match(link, /focus-visible:ring-inset/);
  }
  assert.equal((nav.match(/aria-current="page"/g) ?? []).length, 1);
  const picker = fixture.picker("3");
  assert.match(picker, /<select[^>]*appearance-none[^>]*bg-none/);
  assert.match(picker, /min-h-11/);
  assert.equal((picker.match(/<svg/g) ?? []).length, 1);
  assert.match(picker, /lucide-chevron-down/);
  assert.doesNotMatch(picker, /rotate-90/);
  assert.match(picker, /<span class="sr-only">Period<\/span>/);
  assert.match(picker, /value="3" selected="">Last 3 months/);
});

test("Today, Progress and Challenge share the safe-area-aware shell inset and 14px header rhythm", async () => {
  const [shell, waiting, today] = await Promise.all([
    read("src/components/AppShell.tsx"),
    read("src/components/ChallengeWaiting.tsx"),
    read("src/routes/_authenticated/bulk/index.tsx"),
  ]);
  assert.match(shell, /px-5/);
  assert.match(shell, /pt-\[max\(1.5rem,env\(safe-area-inset-top\)\)\]/);
  assert.doesNotMatch(shell, /isChallenge.*pt-4/);
  assert.match(waiting, /space-y-3.5/);
  assert.doesNotMatch(waiting, /header className="fade-up mb-1"/);
  assert.match(today, /space-y-\[14px\]/);
  const fixture = await progressFixture();
  const html = await fixture.render(overviewPath);
  assert.match(html, /<header class="[^"]*grid grid-cols-\[minmax\(0,1fr\)_auto\]/);
  assert.doesNotMatch(html, /<header[^>]*pt-6/);
  const tiles = tileMarkup(html);
  assert.equal(tiles.length, 4);
  assert.match(tiles[0], /No data yet.*Log a run or ride/s);
  assert.match(tiles[1], /No data yet.*Complete a workout/s);
  assert.match(tiles[1], /text-\[11px\] tracking-tight min-\[360px\]:text-\[13px\]/);
  assert.doesNotMatch(tiles[0] + tiles[1], /<svg|Not enough data|build your trends|start tracking/);
});

test("Strength with no active public plan never invents planned-workout adherence", async () => {
  const fixture = await progressFixture({ plan: null });
  const html = await fixture.render("src/routes/_authenticated/bulk/progress_.strength.tsx");
  assert.match(html, /completed workouts/);
  assert.doesNotMatch(html, /training adherence|of \d+ planned workouts/);
  assert.match(html, /Choose a training plan and weekly workout goal/);
});

test("one working Strength session renders actual load before secondary estimated 1RM and no fake change", async () => {
  const record = {
    key: "press",
    name: "Incline Dumbbell Press",
    side: null,
    exerciseId: "press",
    isBodyweight: false,
    performances: [
      { date: "2026-09-01", load: 24, reps: 10, repCount: 10, repLoad: 24, volume: 240 },
    ],
    bestWeight: null,
    bestReps: null,
    bestVolume: null,
  };
  const fixture = await progressFixture({
    strength: { records: [record], workoutRecords: [], loading: false },
  });
  const html = await fixture.render("src/routes/_authenticated/bulk/progress_.strength.tsx");
  assert.match(html, /24 kg × 10/);
  assert.match(html, /One session/);
  assert.match(html, /Estimated 1RM 32.0 kg/);
  assert.ok(html.indexOf("24 kg × 10") < html.indexOf("Estimated 1RM 32.0"));
  assert.doesNotMatch(html, /vs start of period|Estimated 1RM[^<]*%/);
});

test("bodyweight-only lift detail preserves actual reps even without an estimated-max load", async () => {
  const fixture = await progressFixture({
    lift: "Pull Up",
    strength: {
      records: [
        {
          key: "pull",
          name: "Pull Up",
          isBodyweight: true,
          side: null,
          performances: [{ date: "2026-09-01", load: null, reps: 10 }],
          bestWeight: null,
        },
      ],
      workoutRecords: [],
      loading: false,
    },
  });
  const html = await fixture.render("src/routes/_authenticated/bulk/progress_.strength_.$lift.tsx");
  assert.match(html, /Bodyweight × 10/);
  assert.match(html, /One session/);
  assert.doesNotMatch(html, /Not enough data yet|Estimated 1RM — kg/);
});
