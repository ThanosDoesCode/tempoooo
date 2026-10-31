import { test } from "node:test";
import assert from "node:assert/strict";
import { enduranceUI, formatPace, activityButton as button } from "./endurance-ui-fixture.mjs";
import { runningPeriodStats } from "../src/lib/endurance-progress.ts";
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
function fixture({ values = activities, previous = null } = {}) {
  return enduranceUI({ values, range, previous });
}

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
  assert.match(fixture({ values: [], recordedWeeks: [] }).text(), /No runs yet/);
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

test("weekly hierarchy shows raw running distance without Challenge targets or converted values", () => {
  const ui = fixture();
  assert.match(ui.text(), /Weekly running distance2.3 km\/week/);
  assert.doesNotMatch(ui.text(), /Target|weeks hit|paused week|equivalent|Dashed markers/);
  assert.equal(ui.find("button").filter((n) => n.props["aria-label"]?.includes("km,")).length, 4);
  const bar = button(ui, "7 Sep:");
  assert.match(bar.props["aria-label"], /5.0 km, 1 run/);
  assert.match(bar.props.className, /min-h-11 min-w-0/);
  bar.props.onClick();
  assert.match(ui.text(), /Week of 7 Sep5.0 km · 1 run/);
  assert.equal(button(ui, "7 Sep:").props["aria-pressed"], true);
});

test("weekly focus/hover details show real zero-activity weeks, with earlier weeks explicitly reachable", () => {
  const ui = fixture();
  button(ui, "14 Sep:").props.onFocus();
  assert.match(ui.text(), /Week of 14 Sep0.0 km · 0 runs/);
  button(ui, "28 Sep:").props.onMouseEnter();
  assert.match(ui.text(), /Week of 28 Sep0.0 km · 0 runs/);
  button(ui, "Previous weeks").props.onClick();
  assert.ok(button(ui, "31 Aug:"));
  assert.equal(button(ui, "Previous weeks").props.disabled, true);
  button(ui, "Next weeks").props.onClick();
  assert.ok(button(ui, "28 Sep:"));
});
