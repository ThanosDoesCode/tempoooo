import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import { mainTabForPath } from "../src/lib/main-navigation.ts";
import {
  epleyEstimatedMax,
  liftEstimate,
  defaultTrackedLifts,
} from "../src/lib/strength-estimates.ts";
import {
  enduranceSummary,
  paceTrend,
  periodRange,
  rivalComparison,
} from "../src/lib/endurance-progress.ts";
import {
  availableProgressSections,
  hasBodyFoodData,
  hasStrengthData,
} from "../src/lib/progress-sections.ts";
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

test("Progress Overview shows availability-aware tiles and a deterministic insight, Progress tab stays active", async () => {
  const [overview, chrome, view] = await Promise.all([
    read("src/routes/_authenticated/bulk/progress.tsx"),
    read("src/components/ProgressChrome.tsx"),
    read("src/lib/progress-view.ts"),
  ]);
  // Four-section nav; endurance only appears when the user has a challenge.
  assert.match(chrome, /Overview/);
  assert.match(chrome, /Endurance/);
  assert.match(chrome, /Strength/);
  assert.match(chrome, /Body & food/);
  assert.match(view, /availableProgressSections\(data, hasChallenge\)/);
  // Overview keeps the public/own split and a plain-language insight, not a chart wall.
  assert.match(overview, /bulkPlanModeFor\(memberships\.data, bulkId\)/);
  assert.match(overview, /planMode === "public"/);
  assert.match(overview, /OwnProgress/);
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

test("Overview avoids false zero/loading states and never fabricates empty product areas", async () => {
  const overview = await read("src/routes/_authenticated/bulk/progress.tsx");
  assert.match(overview, /planMode === "none"/);
  assert.match(overview, /animate-pulse/);
  // Strength/Food tiles only render with real data behind them.
  assert.match(overview, /hasWorkouts && strength\.total > 0/);
  assert.match(overview, /foodDays\.logged > 0/);
});

// --------------------------------------------------------------- Endurance

test("Endurance uses existing challenge data only and reuses challenge helpers", async () => {
  const endurance = await read("src/routes/_authenticated/bulk/progress_.endurance.tsx");
  assert.match(endurance, /useWeeks\(challengeId\)/);
  assert.match(endurance, /useMyChallenge\(\)/);
  assert.match(endurance, /enduranceSummary\(/);
  assert.match(endurance, /rivalComparison\(/);
  assert.match(endurance, /paceTrend\(/);
  // Money comes from the stored payment rows, not a re-derivation.
  assert.match(endurance, /usePayments\(challengeId\)/);
  // Deep-link safe empty state when there is no challenge.
  assert.match(endurance, /No challenge yet/);
});

// --------------------------------------------------------------- Strength

test("Strength shows Epley estimated max per tracked lift with an Edit control and records/history", async () => {
  const strength = await read("src/routes/_authenticated/bulk/progress_.strength.tsx");
  assert.match(strength, /useTrackedLifts\(data\)/);
  assert.match(strength, /liftEstimate\(record, BULK_START\)/);
  assert.match(strength, /main lifts up since/);
  assert.match(strength, /aria-expanded=\{editing\}/); // Edit toggle
  assert.match(strength, /to="\/bulk\/progress\/strength\/\$lift"/);
  assert.match(strength, /to="\/bulk\/prs"/);
  assert.match(strength, /to="\/bulk\/training\/history"/);
  // Plan-start comparison is period-independent (no period picker on this view).
  assert.doesNotMatch(strength, /PeriodPicker/);
});

test("Lift detail charts per-session estimated max, marks the record, and reuses progression for advice", async () => {
  const lift = await read("src/routes/_authenticated/bulk/progress_.strength_.$lift.tsx");
  assert.match(lift, /backTo="\/bulk\/progress\/strength"/);
  assert.match(lift, /backLabel="Strength"/);
  assert.match(lift, /liftEstimate\(record, BULK_START\)/);
  assert.match(lift, /chart\.length >= 2 \?/); // 0/1-point safe
  assert.match(lift, /Record/);
  // Next-session advice reuses the existing own-mode progression verdict, never a new engine.
  assert.match(lift, /progressionFor\(data, entry, latest\.date\)/);
  assert.match(lift, /def\.min.*def\.max/s);
});

// --------------------------------------------------------------- Body & food

test("Body & food reuses the 7-day average and goal math and links to food/review/photos", async () => {
  const body = await read("src/routes/_authenticated/bulk/progress_.body.tsx");
  assert.match(body, /avg7\(data, latest\.date\)/);
  assert.match(body, /avg7\(data, iso\(subDays\(parseISO\(latest\.date\), 7\)\)\)/);
  assert.match(body, /avgPoints >= 2 \?/); // chart guard
  assert.match(body, /Goal \{fmt\(target, 1\)\}/);
  assert.match(body, /to="\/bulk\/progress\/body\/food"/);
  assert.match(body, /to="\/bulk\/check-in"/);
  assert.match(body, /to="\/bulk\/progress\/photos"/);
});

test("Food details summarises the week against the target and shows past days as totals only", async () => {
  const food = await read("src/routes/_authenticated/bulk/progress_.body_.food.tsx");
  assert.match(food, /backTo="\/bulk\/progress\/body" backLabel="Body & food"/);
  assert.match(food, /on target \$\{onTarget\} of \$\{loggedDays\}/);
  assert.match(food, /loggedDays \?/); // bars only when a day is logged
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

test("Progress availability is data-driven, not mere onboarding enrolment", () => {
  assert.equal(hasStrengthData(appData({ workouts: loggedWorkout })), true);
  assert.equal(hasStrengthData(appData()), false);
  assert.equal(hasBodyFoodData(appData({ days: { d: { date: "d", weight: 70 } } })), true);
  assert.equal(hasBodyFoodData(appData({ photos: [{ id: "p", date: "d" }] })), true);
  assert.equal(hasBodyFoodData(appData()), false);

  const onlyWorkout = appData({ workouts: loggedWorkout });
  const onlyBody = appData({ days: { d: { date: "d", weight: 70 } } });
  const both = appData({ workouts: loggedWorkout, days: { d: { date: "d", weight: 70 } } });

  // Combinations the handoff calls out.
  assert.deepEqual(availableProgressSections(appData(), true), ["overview", "endurance"]);
  assert.deepEqual(availableProgressSections(onlyWorkout, false), ["overview", "strength"]);
  assert.deepEqual(availableProgressSections(onlyBody, false), ["overview", "body"]);
  assert.deepEqual(availableProgressSections(both, false), ["overview", "strength", "body"]);
  assert.deepEqual(availableProgressSections(both, true), [
    "overview",
    "endurance",
    "strength",
    "body",
  ]);
  // A deep link with no data at all still yields a valid (overview-only) set.
  assert.deepEqual(availableProgressSections(null, false), ["overview"]);
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
  assert.match(endurance, /periodRange\(weekRows\.data, user\.id, weeks\)/);
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
