import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  runningPeriodStats,
  cyclingPeriodStats,
  rawWeeklyDistance,
} from "../src/lib/endurance-progress.ts";
import { enduranceUI, activityButton } from "./endurance-ui-fixture.mjs";
import { collectActivityPages, activityPage } from "../src/lib/challenge-activity-data.ts";

const range = { start: "2026-09-01", end: "2026-09-28" };
const activity = (id, type, date, km, seconds, user = "me") => ({
  id,
  user_id: user,
  activity_type: type,
  activity_date: date,
  created_at: `${date}T12:00:00Z`,
  distance_km: km,
  duration_seconds: seconds,
  equivalent_km: km / 3,
  qualifying_equivalent_km: km / 3,
  is_qualified: false,
  average_speed_kmh: 999,
  average_pace_seconds_per_km: 999,
});
const ride = (id, date, km, seconds, user) => activity(id, "cycle", date, km, seconds, user);
const run = (id, date, km, seconds, user) => activity(id, "run", date, km, seconds, user);
const values = [
  ride("ride-a", "2026-09-07", 10, 1800),
  ride("ride-b", "2026-09-21", 30, 7200),
  ride("untimed", "2026-09-22", 8, null),
  run("run-a", "2026-09-07", 5, 1500),
  run("run-b", "2026-09-21", 5, 1740),
];
const uiFor = (rows = values, options = {}) => enduranceUI({ values: rows, range, ...options });
const selectRide = (ui) => ui.button("Ride").props.onClick();
const closeTo = (a, b) => assert.ok(Math.abs(a - b) < 1e-9, `${a} != ${b}`);

test("running analytics remain identical with cycling data present, including stored non-qualifying runs", () => {
  const mixed = runningPeriodStats(values, "me", range);
  assert.deepEqual(
    mixed,
    runningPeriodStats(
      values.filter((a) => a.activity_type === "run"),
      "me",
      range,
    ),
  );
  assert.equal(mixed.runs, 2);
  assert.equal(mixed.distanceKm, 10);
  assert.equal(mixed.pace, 324);
  assert.equal(mixed.durationSeconds, 3240);
  assert.equal(mixed.longestRunKm, 5);
  assert.equal(mixed.runsPerWeek, 0.5);
  const ui = uiFor();
  assert.match(ui.text(), /Average pace5:24 min\/kmAcross 2 timed runs/);
  assert.match(ui.text(), /Running distance|Longest run|Runs per week|Running time/);
  assert.doesNotMatch(ui.text(), /Cycling distance|km\/h/);
});

test("cycling stats use raw distance, real ride count, longest ride, period frequency and timed duration", () => {
  const stats = cyclingPeriodStats(values, "me", range);
  assert.equal(stats.rides, 3);
  assert.equal(stats.distanceKm, 48);
  assert.equal(stats.longestRideKm, 30);
  assert.equal(stats.ridesPerWeek, 0.75);
  assert.equal(stats.durationSeconds, 9000);
  assert.equal(stats.untimedRides, 1);
  assert.deepEqual(
    stats.points.map((p) => p.id),
    ["ride-a", "ride-b"],
  );
});

test("aggregate speed is total timed raw km / total recorded duration, never the mean of ride speeds", () => {
  const stats = cyclingPeriodStats(values, "me", range);
  assert.deepEqual(
    stats.points.map((p) => p.speed),
    [20, 15],
  );
  assert.equal(stats.speed, 16);
  assert.notEqual(stats.speed, 17.5);
  assert.notEqual(stats.speed, 999);
});

test("untimed/invalid timing still counts toward distance, count and longest ride but not speed or graph", () => {
  const rows = [
    ride("valid", "2026-09-07", 10, 1800),
    ...[null, 0, -2, NaN, Infinity].map((s, i) => ride(`invalid-${i}`, "2026-09-08", 12 + i, s)),
  ];
  const stats = cyclingPeriodStats(rows, "me", range);
  assert.equal(stats.rides, 6);
  assert.equal(stats.points.length, 1);
  assert.equal(stats.speed, 20);
  assert.equal(stats.untimedRides, 5);
  assert.equal(stats.longestRideKm, 16);
  assert.equal(stats.durationSeconds, 1800);
  assert.equal(stats.distanceKm, 80);
});

test("cycling filters other users, runs, previous/future rows and invalid distance", () => {
  const rows = [
    ...values,
    ride("other", "2026-09-07", 1000, 50, "other"),
    ride("before", "2026-08-31", 100, 50),
    ride("future", "2026-09-29", 100, 50),
    ...[0, -1, NaN, Infinity].map((km, i) => ride(`bad-${i}`, "2026-09-07", km, 1800)),
  ];
  assert.deepEqual(cyclingPeriodStats(rows, "me", range), cyclingPeriodStats(values, "me", range));
  assert.deepEqual(
    rawWeeklyDistance(rows, "me", range, "cycle"),
    rawWeeklyDistance(values, "me", range, "cycle"),
  );
});

test("ride points have deterministic date/creation/id ordering", () => {
  const a = ride("a", "2026-09-07", 10, 1800),
    b = ride("b", "2026-09-07", 10, 1800),
    c = ride("c", "2026-09-07", 10, 1800);
  c.created_at = "2026-09-07T11:00:00Z";
  assert.deepEqual(
    cyclingPeriodStats([b, a, c], "me", range).points.map((p) => p.id),
    ["c", "a", "b"],
  );
});

test("ride period comparison uses the same weighted speed and omits comparison when unavailable", () => {
  const previous = { start: "2026-08-01", end: "2026-08-31" };
  const stats = cyclingPeriodStats(
    [...values, ride("old", "2026-08-21", 12, 3600)],
    "me",
    range,
    previous,
  );
  assert.equal(stats.previousSpeed, 12);
  assert.equal(stats.speedChange, 4);
  const ui = uiFor([...values, ride("old", "2026-08-21", 12, 3600)], { previous });
  selectRide(ui);
  assert.match(ui.text(), /4.0 km\/h faster than previous period/);
  const none = uiFor();
  selectRide(none);
  assert.doesNotMatch(none.text(), /than previous period/);
});

test("Run/Ride selector switches all analytics locally and restores run selection without navigation", () => {
  const ui = uiFor();
  assert.equal(ui.button("Run").props["aria-pressed"], true);
  activityButton(ui, "Previous run").props.onClick();
  assert.match(ui.text(), /7 Sep5.0 km · 5:00 min\/km/);
  selectRide(ui);
  assert.equal(ui.button("Ride").props["aria-pressed"], true);
  assert.match(ui.text(), /Average speed16.0 km\/hAcross 2 timed rides/);
  assert.match(
    ui.text(),
    /3Rides48.0 kmCycling distance30.0 kmLongest ride0.8Rides per week2 h 30 minCycling time · timed rides/,
  );
  assert.doesNotMatch(ui.text(), /Average pace|Running distance|min\/km/);
  assert.equal(ui.find("Line")[0].props.dataKey, "speed");
  ui.button("Run").props.onClick();
  assert.match(ui.text(), /7 Sep5.0 km · 5:00 min\/km/);
  assert.equal(ui.find("Line")[0].props.dataKey, "pace");
});

test("cycling chart uses speed with faster values higher; pace retains reversed seconds/km axis", () => {
  const ui = uiFor();
  assert.equal(ui.find("YAxis")[0].props.reversed, true);
  selectRide(ui);
  assert.equal(ui.find("YAxis")[0].props.reversed, false);
  assert.equal(ui.find("YAxis")[0].props.tickFormatter(18.9), "18.9");
  assert.deepEqual(
    ui.find("LineChart")[0].props.data,
    cyclingPeriodStats(values, "me", range).points,
  );
  assert.equal(ui.find("Line")[0].props.isAnimationActive, false);
  assert.equal(ui.find("Line")[0].props.activeDot, false);
  assert.equal(ui.find("LineChart")[0].props.accessibilityLayer, true);
});

test("ride detail uses actual distance/speed/duration once and previous/next/point keyboard selection works", () => {
  const rows = [ride("a", "2026-09-07", 10, 1800), ride("b", "2026-09-21", 7.86, 1500)];
  const ui = uiFor(rows);
  selectRide(ui);
  assert.match(ui.text(), /21 Sep7.86 km · 18.9 km\/h · 25 min/);
  assert.equal(ui.text().split("7.86 km · 18.9 km/h · 25 min").length - 1, 1);
  activityButton(ui, "Previous ride").props.onClick();
  assert.match(ui.text(), /7 Sep10.00 km · 20.0 km\/h · 30 min/);
  assert.equal(activityButton(ui, "Previous ride").props.disabled, true);
  const point = ui
    .find("Line")[0]
    .props.dot({ cx: 10, cy: 10, payload: cyclingPeriodStats(rows, "me", range).points[1] });
  assert.equal(point.props.role, "button");
  assert.equal(point.props.tabIndex, 0);
  let prevented = false;
  point.props.onKeyDown({
    key: " ",
    preventDefault() {
      prevented = true;
    },
  });
  assert.equal(prevented, true);
  assert.equal(activityButton(ui, "Next ride").props.disabled, true);
  const selected = ui
    .find("Line")[0]
    .props.dot({ payload: cyclingPeriodStats(rows, "me", range).points[1] });
  assert.equal(selected.props["aria-pressed"], true);
  assert.equal(selected.props.children[0].props.r, 22);
});

test("Ride stays selectable with no rides; Run remains usable and retains its original empty timing state", () => {
  const ui = uiFor(values.filter((a) => a.activity_type === "run"));
  selectRide(ui);
  assert.match(ui.text(), /No rides yet/);
  assert.equal(ui.find("LineChart").length, 0);
  assert.doesNotMatch(ui.text(), /Average speed|NaN|Infinity/);
  ui.button("Run").props.onClick();
  assert.match(ui.text(), /Average pace/);
  const onlyRide = uiFor([ride("a", "2026-09-07", 12, 3600)]);
  assert.match(onlyRide.text(), /No runs yet/);
  selectRide(onlyRide);
  assert.match(onlyRide.text(), /Across 1 timed ride/);
  assert.equal(onlyRide.find("LineChart").length, 0);
});

test("untimed-only rides show real counts/distance with no fabricated speed or duration", () => {
  const ui = uiFor([ride("a", "2026-09-07", 40, null)]);
  selectRide(ui);
  assert.match(ui.text(), /No timed rides yet/);
  assert.match(ui.text(), /1Rides40.0 kmCycling distance40.0 kmLongest ride/);
  assert.doesNotMatch(ui.text(), /Cycling time|Average speed\d|NaN|Infinity/);
});

test("All time uses earliest actual ride for frequency; sparse history invents no rate", () => {
  const all = { start: null, end: "2026-09-28" };
  const stats = cyclingPeriodStats([ride("a", "2026-09-01", 10, 1800)], "me", all);
  assert.equal(stats.ridesPerWeek, 0.25);
  assert.equal(
    cyclingPeriodStats([ride("a", "2026-09-28", 10, 1800)], "me", all).ridesPerWeek,
    null,
  );
  assert.deepEqual(rawWeeklyDistance([], "me", all, "cycle"), { bars: [], kmPerWeek: null });
});

test("weekly chart independently totals raw run/ride kilometres, including non-qualifying activities", () => {
  const cycling = rawWeeklyDistance(values, "me", range, "cycle");
  const running = rawWeeklyDistance(values, "me", range, "run");
  assert.equal(
    cycling.bars.reduce((sum, b) => sum + b.distanceKm, 0),
    48,
  );
  assert.equal(
    running.bars.reduce((sum, b) => sum + b.distanceKm, 0),
    10,
  );
  assert.equal(cycling.kmPerWeek, 12);
  assert.equal(running.kmPerWeek, 2.5);
  assert.deepEqual(
    cycling.bars.find((b) => b.date === "2026-09-21"),
    { date: "2026-09-21", distanceKm: 38, count: 2 },
  );
  const ui = uiFor();
  selectRide(ui);
  assert.match(ui.text(), /Weekly cycling distance12.0 km\/week/);
  const bar = activityButton(ui, "21 Sep:");
  bar.props.onFocus();
  assert.match(ui.text(), /Week of 21 Sep38.0 km · 2 rides/);
  assert.doesNotMatch(ui.text(), /weeks hit|Target \d|Equivalent|equivalent/);
});

test("weekly raw range includes partial boundary weeks and remains timezone-safe across month/year", () => {
  const rows = [
    ride("a", "2025-12-31", 3, 600),
    ride("b", "2026-01-01", 4, 600),
    ride("before", "2025-12-28", 99, 600),
    ride("after", "2026-01-03", 99, 600),
  ];
  const previousTZ = process.env.TZ;
  try {
    for (const timezone of ["Europe/Stockholm", "America/Los_Angeles", "Pacific/Auckland"]) {
      process.env.TZ = timezone;
      assert.deepEqual(
        rawWeeklyDistance(rows, "me", { start: "2025-12-31", end: "2026-01-02" }, "cycle").bars,
        [{ date: "2025-12-29", distanceKm: 7, count: 2 }],
      );
    }
  } finally {
    if (previousTZ == null) delete process.env.TZ;
    else process.env.TZ = previousTZ;
  }
});

test("week browsing is bounded to four columns and makes all older raw weeks accessible", () => {
  const ui = uiFor();
  selectRide(ui);
  const bars = () => ui.find("button").filter((node) => node.props["aria-label"]?.includes("km,"));
  assert.equal(bars().length, 4);
  assert.equal(activityButton(ui, "Next weeks").props.disabled, true);
  activityButton(ui, "Previous weeks").props.onClick();
  assert.ok(activityButton(ui, "31 Aug:"));
  assert.equal(activityButton(ui, "Previous weeks").props.disabled, true);
  assert.equal(bars().length, 4);
});

test("complete paginated activity input includes older rides and deduplicates overlaps before aggregation", async () => {
  const rows = Array.from({ length: 25 }, (_, i) =>
    ride(String(i), `2026-09-${String(25 - i).padStart(2, "0")}`, i === 24 ? 50 : 10, 1800),
  );
  const collected = await collectActivityPages(async (cursor) => {
    const start = cursor ? rows.findIndex((a) => a.id === cursor.id) + 1 : 0;
    return activityPage(rows.slice(start, start + 11), 10);
  });
  const stats = cyclingPeriodStats(collected, "me", range);
  assert.equal(stats.rides, 25);
  assert.equal(stats.longestRideKm, 50);
  assert.equal(stats.distanceKm, 290);
  closeTo(stats.speed, (290 * 3600) / (25 * 1800));
});

test("Endurance source reuses canonical query without changing Challenge conversion/qualification/payment paths", () => {
  const source = readFileSync(
    new URL("../src/routes/_authenticated/bulk/progress_.endurance.tsx", import.meta.url),
    "utf8",
  );
  assert.match(source, /useEnduranceActivities\(challengeId, range\)/);
  assert.match(source, /previousProgressRange\(period\)/);
  assert.doesNotMatch(
    source,
    /equivalent_km|equivalentKm|usePayments|useWeeks|rivalComparison|penaltyFor|cycling_ratio/,
  );
  assert.match(source, /Challenge targets and standings/);
  assert.match(source, /grid grid-cols-2/);
  assert.match(source, /grid grid-cols-4/);
  assert.doesNotMatch(source, /overflow-x-auto|NativeSelect/);
  assert.match(source, /min-h-11/);
  assert.match(source, /h-11 w-11/);
});
