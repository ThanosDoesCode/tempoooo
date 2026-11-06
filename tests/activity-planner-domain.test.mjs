// A far-west zone: any UTC parsing of "YYYY-MM-DD" would shift dates back a day here.
process.env.TZ = "Pacific/Pago_Pago";

import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { presentationComponent } from "./presentation-component-fixture.mjs";

const planner = await import("../src/lib/planner.ts");
const {
  calendarGrid,
  canStartPlanned,
  comparePlanned,
  gridRange,
  groupPlannerWeeks,
  isPlannerDate,
  monthTitle,
  parsePlannedDistance,
  parsePlannedMinutes,
  parsePlannedNote,
  plannedCounts,
  plannedDayLabel,
  plannedDetail,
  plannedStatus,
  plannedTitle,
  plannedWhen,
  selectedDayHeading,
  shiftMonth,
  weekStart,
} = planner;

const item = (overrides = {}) => ({
  id: "a",
  type: "run",
  date: "2026-10-03",
  time: null,
  source: null,
  planDayId: null,
  templateId: null,
  workoutName: null,
  exerciseCount: null,
  distanceKm: null,
  durationSeconds: null,
  note: null,
  sessionId: null,
  sessionStatus: null,
  challengeActivityId: null,
  loggedDistanceKm: null,
  loggedDurationSeconds: null,
  updatedAt: "2026-10-01T00:00:00.000000+00:00",
  ...overrides,
});
const workout = (overrides = {}) =>
  item({
    type: "workout",
    source: "plan_day",
    planDayId: "day",
    workoutName: "Upper B",
    exerciseCount: 6,
    ...overrides,
  });
const TODAY = "2026-10-02"; // a Friday

// ---------------------------------------------------------------- local dates
test("local calendar dates never shift through UTC, even far west of UTC", () => {
  assert.equal(new Date().getTimezoneOffset() > 600, true, "test runs in UTC-11");
  assert.equal(plannedDayLabel("2026-10-02", TODAY), "Today");
  assert.equal(plannedDayLabel("2026-10-03", TODAY), "Tomorrow");
  assert.equal(plannedDayLabel("2026-10-04", TODAY), "Sunday");
  assert.equal(plannedDayLabel("2026-10-05", TODAY), "Monday");
  assert.equal(plannedDayLabel("2026-10-17", TODAY), "Sat 17 Oct");
  assert.equal(weekStart("2026-10-04"), "2026-09-28"); // Sunday belongs to the Monday-first week
  assert.equal(weekStart("2026-10-05"), "2026-10-05");
  assert.equal(selectedDayHeading(TODAY, TODAY), "Today, Friday 2 October");
  assert.equal(isPlannerDate("2026-02-29"), false);
  assert.equal(isPlannerDate("2028-02-29"), true);
});

test("optional time shows Any time, never an invented midnight", () => {
  assert.equal(plannedWhen(item({ date: "2026-10-04" }), TODAY), "Sunday · any time");
  assert.equal(plannedWhen(item({ time: "09:00" }), TODAY), "Tomorrow · 09:00");
  assert.equal(plannedDetail(item({ distanceKm: 20, type: "ride" })), "Any time");
  assert.doesNotMatch(plannedDetail(item()), /00:00/);
});

test("titles keep raw planned distance; a Ride is never converted to Challenge km", () => {
  assert.equal(plannedTitle(item({ type: "ride", distanceKm: 20 })), "Ride · 20 km");
  assert.equal(plannedTitle(item({ distanceKm: 6.5 })), "Run · 6.5 km");
  assert.equal(plannedTitle(item()), "Run");
  assert.equal(plannedTitle(workout()), "Upper B");
  assert.equal(
    plannedDetail(item({ time: "09:00", durationSeconds: 1800 })),
    "09:00 · about 30 min",
  );
  assert.equal(
    plannedDetail(item({ time: "07:00", note: "Lycabettus loop" })),
    "07:00 · Lycabettus loop",
  );
  assert.equal(plannedDetail(workout({ time: "18:00" })), "18:00 · from your plan");
  assert.equal(
    plannedDetail(workout({ source: "my_workout", time: "18:30" })),
    "18:30 · My Workouts",
  );
});

test("ordering is date, then time (Any time last), then stable id; cancelled rows do not exist", () => {
  const rows = [
    item({ id: "c", date: "2026-10-03" }),
    item({ id: "b", date: "2026-10-03", time: "09:00" }),
    item({ id: "a", date: "2026-10-03", time: "09:00" }),
    item({ id: "z", date: "2026-10-02", time: "23:00" }),
  ];
  assert.deepEqual(
    [...rows].sort(comparePlanned).map((row) => row.id),
    ["z", "a", "b", "c"],
  );
});

// ---------------------------------------------------------------- completion is read-derived
test("completion comes only from real linked history; a link alone is not completion", () => {
  assert.equal(plannedStatus(workout()), "planned");
  assert.equal(
    plannedStatus(workout({ sessionId: "s", sessionStatus: "in_progress" })),
    "in_progress",
  );
  assert.equal(plannedStatus(workout({ sessionId: "s", sessionStatus: "completed" })), "completed");
  assert.equal(plannedStatus(item({ challengeActivityId: "x" })), "completed");
  assert.equal(plannedStatus(item()), "planned");
  assert.equal(
    plannedDetail(
      item({ challengeActivityId: "x", loggedDistanceKm: 4, loggedDurationSeconds: 1340 }),
    ),
    "Completed · 4 km · 5:35 /km",
  );
});

test("only a current-plan workout on its own local day offers Start", () => {
  assert.equal(canStartPlanned(workout({ date: TODAY }), TODAY), true);
  assert.equal(canStartPlanned(workout({ date: "2026-10-03" }), TODAY), false);
  assert.equal(
    canStartPlanned(
      workout({ date: TODAY, source: "my_workout", planDayId: null, templateId: "t" }),
      TODAY,
    ),
    false,
  );
  assert.equal(canStartPlanned(workout({ date: TODAY, planDayId: null }), TODAY), false);
  assert.equal(
    canStartPlanned(workout({ date: TODAY, sessionId: "s", sessionStatus: "completed" }), TODAY),
    false,
  );
  assert.equal(canStartPlanned(item({ date: TODAY }), TODAY), false);
});

// ---------------------------------------------------------------- Agenda weeks
test("Agenda groups Monday-first local weeks with real counts and ranges", () => {
  const rows = [
    item({ id: "1", date: "2026-10-01", challengeActivityId: "x" }),
    workout({ id: "2", date: "2026-10-02", time: "18:00" }),
    item({ id: "3", date: "2026-10-03", time: "09:00", distanceKm: 5 }),
    item({ id: "4", type: "ride", date: "2026-10-04", distanceKm: 20 }),
    workout({ id: "5", date: "2026-09-29" }),
    workout({ id: "6", date: "2026-10-05" }),
    item({ id: "7", date: "2026-10-28" }),
  ];
  const weeks = groupPlannerWeeks(rows, TODAY);
  assert.deepEqual(
    weeks.map((week) => [week.label, week.aside, week.items.map((row) => row.id).join("")]),
    [
      ["This week", "2 workouts · 2 runs · 1 ride", "51234"],
      ["Next week", "5 to 11 Oct", "6"],
      ["Week of 26 Oct", "26 Oct to 1 Nov", "7"],
    ],
  );
  assert.equal(plannedCounts([item()]), "1 run");
  assert.equal(plannedCounts([]), "");
});

// ---------------------------------------------------------------- Calendar grid
test("calendar grid is Monday-first, includes outside-month days, and handles leap/year boundaries", () => {
  const october = calendarGrid("2026-10");
  assert.equal(october[0][0].date, "2026-09-28");
  assert.equal(october[0][0].inMonth, false);
  assert.equal(october.at(-1).at(-1).date, "2026-11-08");
  assert.ok(october.every((week) => week.length === 7));
  assert.equal(october.flat().filter((day) => day.inMonth).length, 31);
  assert.deepEqual(gridRange("2026-10"), { from: "2026-09-28", to: "2026-11-08" });

  assert.equal(
    calendarGrid("2028-02")
      .flat()
      .filter((day) => day.inMonth).length,
    29,
  );
  assert.equal(
    calendarGrid("2027-02")
      .flat()
      .filter((day) => day.inMonth).length,
    28,
  );
  assert.equal(shiftMonth("2026-12", 1), "2027-01");
  assert.equal(shiftMonth("2027-01", -1), "2026-12");
  assert.equal(monthTitle("2026-10"), "October 2026");
  // A month starting on Monday has no leading days.
  assert.equal(calendarGrid("2027-02")[0][0].date, "2027-02-01");
});

const flatDates = (month) =>
  calendarGrid(month)
    .flat()
    .map((day) => day.date);

test("every month renders a fixed 6x7 grid: 42 consecutive local days starting on a Monday", () => {
  for (let year = 2024; year <= 2030; year++) {
    for (let m = 1; m <= 12; m++) {
      const month = `${year}-${String(m).padStart(2, "0")}`;
      const weeks = calendarGrid(month);
      assert.equal(weeks.length, 6, month);
      assert.ok(
        weeks.every((week) => week.length === 7),
        month,
      );
      const days = weeks.flat();
      assert.equal(days.length, 42, month);
      // Monday-first, consecutive, no duplicates, local dates only.
      assert.equal(new Date(`${days[0].date}T12:00:00`).getDay(), 1, month);
      for (let i = 1; i < days.length; i++) {
        const prev = new Date(`${days[i - 1].date}T12:00:00`);
        prev.setDate(prev.getDate() + 1);
        const expected = `${prev.getFullYear()}-${String(prev.getMonth() + 1).padStart(2, "0")}-${String(prev.getDate()).padStart(2, "0")}`;
        assert.equal(days[i].date, expected, `${month} cell ${i}`);
      }
      // The month itself is contiguous: leading = previous month, trailing = next month.
      const first = days.findIndex((day) => day.inMonth);
      const inMonth = days.filter((day) => day.inMonth);
      const daysInMonth = new Date(year, m, 0).getDate();
      assert.equal(inMonth.length, daysInMonth, month);
      assert.equal(inMonth[0].date, `${month}-01`, month);
      assert.equal(inMonth.at(-1).date, `${month}-${daysInMonth}`, month);
      assert.ok(first < 7, month);
      assert.ok(
        days.slice(0, first).every((day) => !day.inMonth && day.date < `${month}-01`),
        month,
      );
      assert.ok(
        days.slice(first + daysInMonth).every((day) => !day.inMonth && day.date > `${month}-31`),
        month,
      );
      assert.equal(
        days.slice(first, first + daysInMonth).every((day) => day.inMonth),
        true,
      );
    }
  }
});

test("short, leap, 5-row and 6-row months all fill to 42 with correct filler dates", () => {
  // February 2027 (non-leap) starts on a Monday: no leading days, 14 trailing March days.
  const feb2027 = flatDates("2027-02");
  assert.equal(feb2027[0], "2027-02-01");
  assert.equal(feb2027[27], "2027-02-28");
  assert.deepEqual(feb2027.slice(28), [
    ...Array.from({ length: 14 }, (_, i) => `2027-03-${String(i + 1).padStart(2, "0")}`),
  ]);
  // February 2028 (leap) starts on a Tuesday: 31 January leads, 29 February is present.
  const feb2028 = calendarGrid("2028-02").flat();
  assert.equal(feb2028[0].date, "2028-01-31");
  assert.equal(feb2028[0].inMonth, false);
  assert.ok(feb2028.some((day) => day.date === "2028-02-29" && day.inMonth));
  assert.equal(feb2028[30].date, "2028-03-01");
  assert.equal(feb2028.at(-1).date, "2028-03-12");
  // October 2026 needs 5 rows: one extra trailing week of November is added.
  const oct2026 = flatDates("2026-10");
  assert.deepEqual(oct2026.slice(0, 3), ["2026-09-28", "2026-09-29", "2026-09-30"]);
  assert.deepEqual(oct2026.slice(-8), [
    "2026-11-01",
    "2026-11-02",
    "2026-11-03",
    "2026-11-04",
    "2026-11-05",
    "2026-11-06",
    "2026-11-07",
    "2026-11-08",
  ]);
  // August 2026 needs 6 rows on its own: Saturday start, Monday 31 August.
  const aug2026 = flatDates("2026-08");
  assert.equal(aug2026[0], "2026-07-27");
  assert.equal(aug2026[5], "2026-08-01");
  assert.equal(aug2026[35], "2026-08-31");
  assert.equal(aug2026.at(-1), "2026-09-06");
  // Year boundaries: December fills into January, January leads from December.
  assert.equal(flatDates("2026-12").at(-1), "2027-01-10");
  assert.equal(flatDates("2027-01")[0], "2026-12-28");
  assert.deepEqual(gridRange("2027-02"), { from: "2027-02-01", to: "2027-03-14" });
});

test("the 42-day grid never shifts dates in extreme UTC offsets", () => {
  const expected = JSON.stringify(["2028-01-31", "2028-03-12", "2026-07-27", "2026-09-06"]);
  for (const zone of ["Pacific/Kiritimati", "Pacific/Pago_Pago", "Europe/Stockholm"]) {
    const child = spawnSync(
      process.execPath,
      [
        "--input-type=module",
        "-e",
        'import {calendarGrid} from "./src/lib/planner.ts"; const d=(m)=>calendarGrid(m).flat(); const a=d("2028-02"), b=d("2026-08"); console.log(JSON.stringify([a[0].date,a.at(-1).date,b[0].date,b.at(-1).date]))',
      ],
      { cwd: new URL("..", import.meta.url), env: { ...process.env, TZ: zone }, encoding: "utf8" },
    );
    assert.equal(child.status, 0, `${zone}: ${child.stderr}`);
    assert.equal(child.stdout.trim(), expected, zone);
  }
});

// ---------------------------------------------------------------- form parsing
test("distance accepts comma or dot and is optional; minutes are whole and stored as seconds", () => {
  assert.deepEqual(parsePlannedDistance(""), { value: null, error: null });
  assert.deepEqual(parsePlannedDistance("5,5"), { value: 5.5, error: null });
  assert.deepEqual(parsePlannedDistance("5.25"), { value: 5.25, error: null });
  assert.deepEqual(parsePlannedDistance(" 20 "), { value: 20, error: null });
  assert.match(parsePlannedDistance("5,").error ?? "", /^$/); // trailing separator is a valid 5
  assert.equal(parsePlannedDistance("abc").value, null);
  assert.match(parsePlannedDistance("abc").error, /distance/i);
  assert.match(parsePlannedDistance("0").error, /between/);
  assert.match(parsePlannedDistance("1000.5").error, /between/);

  assert.deepEqual(parsePlannedMinutes(""), { value: null, error: null });
  assert.deepEqual(parsePlannedMinutes("30"), { value: 1800, error: null });
  assert.deepEqual(parsePlannedMinutes("30.5"), { value: 1805, error: null });
  assert.match(parsePlannedMinutes("0").error, /between/);
  assert.match(parsePlannedMinutes("1441").error, /between/);

  assert.deepEqual(parsePlannedNote("  "), { value: null, error: null });
  assert.deepEqual(parsePlannedNote(" Easy pace "), { value: "Easy pace", error: null });
  assert.match(parsePlannedNote("x".repeat(201)).error, /200/);
});

// ---------------------------------------------------------------- canonical read model
test("rows map through one model; a link whose history is gone never reads as completed", () => {
  const { toPlanned, PLANNER_COLUMNS } = presentationComponent("src/lib/planner-query.ts", {
    "@tanstack/react-query": { queryOptions: (options) => options, useQuery: () => ({}) },
    "@/integrations/supabase/client": { supabase: {} },
    "@/lib/network-errors": {
      developmentErrorDiagnostic() {},
      readRetryDelay() {},
      shouldRetryRead() {},
    },
    "./planner": planner,
  });
  const base = {
    id: "a",
    activity_type: "workout",
    planned_date: "2026-10-02",
    planned_time: "18:00:00",
    workout_source_type: "plan_day",
    training_plan_day_id: "day",
    workout_template_id: null,
    workout_name_snapshot: "Upper B",
    exercise_count_snapshot: 6,
    planned_distance_km: null,
    planned_duration_seconds: null,
    note: null,
    workout_session_id: "s",
    challenge_activity_id: null,
    updated_at: "2026-10-01T00:00:00.123456+00:00",
    bulk_training_sessions: { status: "completed" },
    challenge_activities: null,
  };
  const done = toPlanned(base);
  assert.equal(done.time, "18:00");
  assert.equal(plannedStatus(done), "completed");
  assert.equal(done.updatedAt, base.updated_at); // microseconds survive for stale-safe edits
  assert.equal(plannedStatus(toPlanned({ ...base, bulk_training_sessions: null })), "planned");
  const ride = toPlanned({
    ...base,
    activity_type: "ride",
    workout_source_type: null,
    training_plan_day_id: null,
    workout_name_snapshot: null,
    workout_session_id: null,
    bulk_training_sessions: null,
    planned_time: null,
    planned_distance_km: "20.00",
    challenge_activity_id: "x",
    challenge_activities: null, // deleted activity -> not completed
  });
  assert.equal(ride.distanceKm, 20);
  assert.equal(ride.time, null);
  assert.equal(plannedStatus(ride), "planned");
  // Linked history is embedded as status/raw values only: no sets, exercises or evidence paths.
  assert.doesNotMatch(PLANNER_COLUMNS, /exercise_name|sets|evidence|signed/);
});

test("planned duration shares clock separators while retaining optional/minimum/maximum rules", () => {
  for (const raw of ["15,35", "15.35", "15:35"])
    assert.deepEqual(parsePlannedMinutes(raw), { value: 935, error: null });
  assert.deepEqual(parsePlannedMinutes("45"), { value: 2700, error: null });
  assert.deepEqual(parsePlannedMinutes(""), { value: null, error: null });
  assert.deepEqual(parsePlannedMinutes("24:00:00"), { value: 86400, error: null });
  for (const raw of ["0,45", "24:00:01"]) assert.match(parsePlannedMinutes(raw).error, /between/);
  for (const raw of ["15,60", "15.", "15,", "15:"])
    assert.match(parsePlannedMinutes(raw).error, /duration/);
});
