import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";
import { accountUI } from "./account-ui-fixture.mjs";
import { enduranceSummary, runningPeriodStats } from "../src/lib/endurance-progress.ts";
import { fmt, fmt0 } from "../src/lib/calc.ts";

// Use the actual shared formatter, including its unit, so duplicated units cannot hide in a mock.
const context = { exports: {} };
const formatter = readFileSync(new URL("../src/lib/challenge.ts", import.meta.url), "utf8").match(
  /export function formatPace[\s\S]*?\n}/,
)[0];
vm.runInNewContext(
  ts.transpileModule(formatter, {
    compilerOptions: { module: ts.ModuleKind.CommonJS },
  }).outputText,
  context,
);
const { formatPace } = context.exports;
const range = { start: "2026-09-01", end: "2026-09-30" };
const activity = (id, date, distance, duration) => ({
  id,
  user_id: "me",
  activity_type: "run",
  activity_date: date,
  created_at: `${date}T12:00:00Z`,
  distance_km: distance,
  duration_seconds: duration,
});
const activities = [activity("a", "2026-09-07", 5, 1500), activity("b", "2026-09-21", 5, 1740)];
const weeks = [
  { user_id: "me", week_number: 1, week_start: "2026-09-07", equivalent_km: 15.1, target_km: 15 },
  { user_id: "me", week_number: 2, week_start: "2026-09-14", equivalent_km: 18.6, target_km: 20 },
  {
    user_id: "me",
    week_number: 4,
    week_start: "2026-09-28",
    equivalent_km: 0,
    target_km: 20,
    paused: true,
  },
];
function fixture({ values = activities, recordedWeeks = weeks, previous = null } = {}) {
  return accountUI(
    "src/routes/_authenticated/bulk/progress_.endurance.tsx",
    "EnduranceBody",
    {
      recharts: Object.fromEntries(
        ["Line", "LineChart", "ResponsiveContainer", "Tooltip", "XAxis", "YAxis"].map((n) => [
          n,
          n,
        ]),
      ),
      "@/components/ProgressChartTooltip": { ProgressChartTooltip: "ProgressChartTooltip" },
      "@/components/ProgressChrome": {},
      "@/lib/progress-view": { chartAxis: {}, chartTooltip: {} },
      "@/lib/calc": { fmt, fmt0 },
      "@/lib/auth": {},
      "@/lib/challenge": { formatPace },
      "@/lib/endurance-progress": {},
      "@/lib/progress-period": {},
    },
    {
      summary: enduranceSummary(recordedWeeks, "me", range),
      runs: runningPeriodStats(values, "me", range, previous),
      rival: {},
      opponent: null,
      moneyLine: null,
    },
  );
}
const button = (ui, prefix) =>
  ui.find("button").find((n) => n.props["aria-label"]?.startsWith(prefix));

test("pace hierarchy uses one unit, the real timed count and only one selected-run detail panel", () => {
  const ui = fixture({ values: [...activities, activity("untimed", "2026-09-23", 5, null)] });
  assert.match(ui.text(), /Average pace5:24 min\/kmAcross 2 timed runs/);
  assert.doesNotMatch(
    ui.text(),
    /min\/km \/km|Distance-weighted pace from timed runs|Previous 5:|One run/,
  );
  assert.equal(ui.find("select").length, 0);
  assert.equal(ui.find("Tooltip")[0].props.content(), null);
  assert.match(ui.text(), /21 Sep5.0 km · 5:48 min\/km · 29:00/);
  assert.equal(ui.text().split("5.0 km · 5:48 min/km · 29:00").length - 1, 1);
  assert.doesNotMatch(ui.text(), /than previous period/);
});

test("chart points and compact keyboard controls select actual runs, retain selection and disable boundaries", () => {
  const ui = fixture();
  button(ui, "Previous run").props.onClick();
  assert.match(ui.text(), /7 Sep5.0 km · 5:00 min\/km · 25:00/);
  assert.equal(button(ui, "Previous run").props.disabled, true);
  const line = ui.find("Line")[0];
  const point = line.props.dot({
    cx: 20,
    cy: 20,
    payload: runningPeriodStats(activities, "me", range).points[1],
  });
  assert.equal(point.props.role, "button");
  assert.equal(point.props.tabIndex, 0);
  let prevented = false;
  point.props.onKeyDown({
    key: "Enter",
    preventDefault() {
      prevented = true;
    },
  });
  assert.equal(prevented, true);
  assert.match(ui.text(), /21 Sep5.0 km · 5:48 min\/km · 29:00/);
  assert.equal(button(ui, "Next run").props.disabled, true);
  const selected = ui
    .find("Line")[0]
    .props.dot({ payload: runningPeriodStats(activities, "me", range).points[1] });
  assert.equal(selected.props["aria-pressed"], true);
  ui.find("LineChart")[0].props.onClick({ activePayload: [{ payload: { id: "a" } }] });
  assert.match(ui.text(), /7 Sep5.0 km/);
  button(ui, "Next run").props.onClick();
  assert.match(ui.text(), /21 Sep5.0 km/);
  assert.match(button(ui, "Previous run").props.className, /h-11 w-11/);
});

test("pace axis has simple labels, is reversed, and plots unchanged real values without animation", () => {
  const ui = fixture();
  const axis = ui.find("YAxis")[0];
  assert.equal(axis.props.reversed, true);
  assert.equal(axis.props.tickFormatter(300), "5:00");
  assert.equal(axis.props.tickFormatter(360), "6:00");
  assert.deepEqual(
    ui.find("LineChart")[0].props.data,
    runningPeriodStats(activities, "me", range).points,
  );
  assert.equal(ui.find("Line")[0].props.isAnimationActive, false);
});

for (const [label, duration, expected] of [
  ["one timed run", 1500, "Across 1 timed run"],
  ["missing duration", null, "No timed runs yet"],
  ["missing pace", 0, "No timed runs yet"],
]) {
  test(`pace sparse state: ${label}`, () => {
    const ui = fixture({ values: [activity("a", "2026-09-07", 5, duration)] });
    assert.match(ui.text(), new RegExp(expected));
    assert.equal(ui.find("LineChart").length, 0);
    assert.equal(button(ui, "Previous run"), undefined);
    assert.doesNotMatch(ui.text(), /than previous period|NaN|Infinity/);
  });
}

test("no activities keeps the intentional empty state", () => {
  assert.match(fixture({ values: [], recordedWeeks: [] }).text(), /No activities yet/);
});

test("previous-period comparison keeps weighted semantics and only shows a valid concise comparison", () => {
  const ui = fixture({
    values: [...activities, activity("previous", "2026-08-21", 5, 1680)],
    previous: { start: "2026-08-01", end: "2026-08-31" },
  });
  assert.match(ui.text(), /12 sec\/km faster than previous period/);
  assert.doesNotMatch(ui.text(), /· Previous/);
  const slower = fixture({
    values: [...activities, activity("previous", "2026-08-21", 5, 1500)],
    previous: { start: "2026-08-01", end: "2026-08-31" },
  });
  assert.match(slower.text(), /24 sec\/km slower than previous period/);
});

test("weekly hierarchy removes repeated status/target copy until an actual week is selected", () => {
  const ui = fixture();
  assert.match(ui.text(), /16.9 km\/weekTarget 20 km1\/2 weeks hit1 paused week/);
  assert.doesNotMatch(
    ui.text(),
    /a week, on average|Latest target \d|Challenge-equivalent km|Dashed markers|Target 15/,
  );
  assert.equal(ui.find("button").filter((n) => n.props["aria-pressed"] === true).length, 0);
  const bar = button(ui, "7 Sep:");
  assert.match(bar.props["aria-label"], /15.1 km, target 15.0 km, Hit/);
  assert.match(bar.props.className, /min-h-11 min-w-11/);
  bar.props.onClick();
  assert.match(ui.text(), /7 Sep15.1 km · Target 15 kmHit/);
  assert.equal(button(ui, "7 Sep:").props["aria-pressed"], true);
});

test("weekly focus/hover details preserve historical targets, misses, pauses, zero activity and missing-week information", () => {
  const ui = fixture();
  button(ui, "14 Sep:").props.onFocus();
  assert.match(ui.text(), /18.6 km · Target 20 kmMissed by 1.4 km/);
  button(ui, "28 Sep:").props.onMouseEnter();
  assert.match(ui.text(), /0.0 km · Target 20 kmPaused/);
  assert.match(button(ui, "28 Sep:").props["aria-label"], /missing week data/);
  const noActivity = fixture({ recordedWeeks: [{ ...weeks[0], equivalent_km: 0 }] });
  button(noActivity, "7 Sep:").props.onClick();
  assert.match(noActivity.text(), /No activity · Missed by 15.0 km/);
});
