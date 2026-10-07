import * as progressPeriods from "../src/lib/progress-period.ts";
import { test } from "node:test";
import assert from "node:assert/strict";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createRequire } from "node:module";
import { readFile } from "node:fs/promises";
import { presentationComponent } from "./presentation-component-fixture.mjs";
import {
  workoutHistory,
  groupWorkoutWeeks,
  previousSameWorkout,
  validateWorkoutTimes,
  historyDuration,
} from "../src/lib/workout-history.ts";
import {
  defaultTrackedLifts,
  trackedLiftCandidates,
  resolveTrackedLifts,
} from "../src/lib/strength-estimates.ts";
import { derivePublicPersonalRecords } from "../src/lib/personal-records.ts";
import * as history from "../src/lib/workout-history.ts";
import * as domain from "../src/lib/bulk-training-session-domain.ts";
import * as training from "../src/lib/training.ts";
import * as types from "../src/lib/types.ts";
const require = createRequire(import.meta.url);
const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");
const set = (id, type = "normal", load = 20, reps = 10) => ({
  id,
  order: 1,
  isExtra: false,
  isComplete: true,
  setType: type,
  rpe: 8,
  bilateralWeight: load,
  bilateralReps: reps,
  leftWeight: null,
  leftReps: null,
  rightWeight: null,
  rightReps: null,
});
const session = (id, date, load = 20) => ({
  id,
  bulkProfileId: "profile",
  trainingPlanId: "plan",
  planName: "Upper / Lower",
  workoutDayName: "Upper A",
  workoutDayOrder: 1,
  status: "completed",
  workoutDate: date,
  startedAt: `${date}T10:00:00Z`,
  completedAt: `${date}T10:52:00Z`,
  updatedAt: "version",
  bodyweightKg: 70,
  exercises: [
    {
      id: `exercise:${id}`,
      name: "Incline press",
      order: 1,
      sourceExerciseId: "incline",
      sourcePlanExerciseId: "plan-exercise",
      executionMode: "bilateral",
      isBodyweight: false,
      targetSets: 3,
      targetRepMin: 8,
      targetRepMax: 12,
      notes: "Bench 3",
      sets: [
        set(`${id}:W`, "warmup", 10),
        set(`${id}:1`, "normal", load),
        set(`${id}:F`, "failure", load),
        set(`${id}:D`, "drop", load),
      ],
    },
  ],
});
const plan = (days) => ({
  id: "plan",
  days: days.map((names, order) => ({
    order,
    exercises: names.map((name, index) => ({
      name,
      order: index,
      isBodyweight: name === "Pull-ups",
      repMin: 8,
      repMax: 12,
    })),
  })),
});

test("tracked defaults use first suitable lift per current plan day, skip bodyweight, dedupe and cap six", () => {
  assert.deepEqual(
    defaultTrackedLifts(plan([["Pull-ups", "Press"], ["Press", "Rows"], ["Squat"]])),
    ["Press", "Rows", "Squat"],
  );
  assert.equal(
    defaultTrackedLifts(plan(Array.from({ length: 8 }, (_, i) => [`Exercise ${i}`]))).length,
    6,
  );
  assert.deepEqual(defaultTrackedLifts(null), []);
});
test("tracked candidates are current plan and relevant measurable history, with explicit override/reset/plan-change handling", () => {
  const candidates = trackedLiftCandidates(plan([["Press", "Pull-ups"]]), [
    { name: "Old rows", performances: [{ load: 20 }] },
    { name: "No load", performances: [{ load: null }] },
  ]);
  assert.deepEqual(candidates, { fromPlan: ["Press", "Pull-ups"], history: ["Old rows"] });
  const available = [...candidates.fromPlan, ...candidates.history];
  assert.deepEqual(resolveTrackedLifts(["Press"], null, available), ["Press"]);
  assert.deepEqual(resolveTrackedLifts(["Press"], ["Old rows", "Removed", "Old rows"], available), [
    "Old rows",
  ]);
  assert.deepEqual(resolveTrackedLifts(["Press"], [], available), []);
});
test("workout history groups completed sessions by local Monday week, excludes zero sets and active sessions", () => {
  const empty = session("empty", "2026-10-05");
  empty.exercises[0].sets = [];
  const active = { ...session("active", "2026-10-05"), status: "in_progress", completedAt: null };
  const rows = workoutHistory(
    [
      session("a", "2026-10-01"),
      session("b", "2026-09-28"),
      session("c", "2026-09-26"),
      empty,
      active,
    ],
    null,
  );
  assert.equal(rows.length, 3);
  assert.equal(rows[0].name, "Upper A");
  const groups = groupWorkoutWeeks(rows, "2026-10-05");
  assert.equal(groups[0].label, "Last week · 28 Sep to 4 Oct");
  assert.equal(groups[0].workouts.length, 2);
  assert.equal(groups[1].workouts.length, 1);
});
test("working sets/volume exclude warmups but include failure/drop, and records reuse real PR summaries", () => {
  const rows = workoutHistory([session("a", "2026-09-28"), session("b", "2026-10-01", 24)], null);
  assert.equal(rows[0].workingSets, 3);
  assert.equal(rows[0].warmups, 1);
  assert.equal(rows[0].volume, 720);
  assert.equal(rows[0].records, 3);
  assert.ok(rows[0].recordSets.includes("b:1"));
  assert.equal(previousSameWorkout(rows[0], rows).volume, 600);
  assert.equal(derivePublicPersonalRecords([session("a", "2026-09-28")])[0].bestVolume.volume, 600);
  const without = workoutHistory([session("a", "2026-09-28")], null);
  assert.equal(without.length, 1);
  assert.equal(without[0].volume, 600);
});
test("comparison is same plan/day only; bodyweight absence remains unknown, legacy records remain separate", () => {
  const a = session("a", "2026-09-28");
  const b = { ...session("b", "2026-10-01"), trainingPlanId: "different" };
  assert.equal(
    previousSameWorkout(workoutHistory([a, b], null)[0], workoutHistory([a, b], null)),
    null,
  );
  const bw = session("bw", "2026-10-02");
  bw.bodyweightKg = null;
  bw.exercises[0].isBodyweight = true;
  assert.equal(workoutHistory([bw], null)[0].volume, null);
  const data = {
    workouts: {
      "2026-09-28": {
        date: "2026-09-28",
        type: "Chest & Back",
        entries: [{ exercise: "Press", weight: 20, reps: [10], rpe: 8, notes: "old" }],
      },
    },
  };
  assert.equal(workoutHistory([a], data).length, 2);
});
test("time validation rejects negative durations/mismatched local days and preserves long durations for Fix time", () => {
  assert.equal(validateWorkoutTimes("2026-10-02", "2026-10-02T00:05", "2026-10-02T00:45"), null);
  assert.ok(validateWorkoutTimes("2026-10-02", "2026-10-01T23:05", "2026-10-02T00:45"));
  assert.ok(validateWorkoutTimes("2026-10-02", "2026-10-02T00:45", "2026-10-02T00:05"));
  assert.equal(historyDuration(10 * 3600 + 46 * 60), "10 h 46 m");
});
const primitives = new Proxy(
  {},
  {
    get:
      (_, name) =>
      ({ children, ...props }) =>
        React.createElement("div", { "data-component": name }, children),
  },
);
const modules = {
  react: React,
  "react/jsx-runtime": require("react/jsx-runtime"),
  "@/lib/workout-history": history,
  "@/lib/bulk-training-session-domain": domain,
  "@/lib/training": training,
  "@tanstack/react-router": {
    Link: ({ to, params, search, preload, ...props }) =>
      React.createElement("a", { ...props, href: to }),
  },
  "./ui/button": {
    Button: ({ children, asChild, variant, size, ...props }) =>
      React.createElement("button", props, children),
  },
  "./ui-kit": {
    Card: ({ children, ...props }) => React.createElement("div", props, children),
    PendingLabel: ({ children }) => children,
  },
  "./DecimalInput": { DecimalInput: () => React.createElement("input") },
  "./TempoDateTimePicker": {
    TempoDatePicker: "TempoDatePicker",
    TempoDateTimePicker: "TempoDateTimePicker",
  },
  "./ui/native-select": {
    NativeSelect: ({ children, ...props }) => React.createElement("select", props, children),
  },
  "./ui/dropdown-menu": primitives,
  "./ui/dialog": primitives,
  "./ui/alert-dialog": primitives,
};
const components = presentationComponent("src/components/WorkoutHistory.tsx", modules);
const html = (Component, props) => renderToStaticMarkup(React.createElement(Component, props));
test("history handoff uses real N of M, unfinished Resume/Discard, day names and >4h Fix time", () => {
  const long = session("long", "2026-10-01");
  long.completedAt = "2026-10-01T20:46:00Z";
  const active = { ...session("active", "2026-10-05"), status: "in_progress", completedAt: null };
  active.exercises[0].sets = [];
  const output = html(components.WorkoutHistoryList, {
    rows: workoutHistory([long], null),
    today: "2026-10-05",
    expected: 4,
    planName: "Upper / Lower",
    planId: "plan",
    active,
    pending: false,
    onDiscard() {},
    onFixTime() {},
  });
  for (const text of [
    "1 of 4 done",
    "Unfinished workout",
    "nothing logged yet",
    "Resume",
    "Discard",
    "Upper A",
    "Timer was left running.",
    "Fix time",
  ])
    assert.ok(output.includes(text), text);
  assert.ok(output.includes("10 h 46 m"));
});
test("detail shows plan/day, real timestamps/metrics/BW, W/F/D/RPE/record, repeat/edit/time/delete", () => {
  const rows = workoutHistory(
    [session("old", "2026-09-28"), session("new", "2026-10-01", 24)],
    null,
  );
  const output = html(components.WorkoutDetail, {
    row: rows[0],
    previous: rows[1],
    pending: false,
    error: null,
    onRepeat() {},
    onDelete() {},
    onSaveSet: async () => true,
    onSaveTime: async () => true,
  });
  for (const text of [
    "Upper / Lower",
    "Day 1",
    "Upper A",
    "Thursday 1 Oct",
    "52 min",
    "sets + 1 warm-up",
    "720",
    "+120 kg volume",
    "Bodyweight that day 70.0 kg",
    "RPE 8",
    "Record",
    "Repeat this workout",
    "Edit sets",
    "Change date or time",
    "Delete",
    "text-warn",
    "text-danger",
    "text-chart-2",
  ])
    assert.ok(output.includes(text), text);
});
for (const [minutes, label] of [
  [5, "5 min"],
  [52, "52 min"],
  [72, "1 h 12 min"],
]) {
  test(`workout detail primary header displays the real ${label} duration, not a timestamp range`, () => {
    const source = session("duration", "2026-10-05");
    source.startedAt = new Date("2026-10-05T14:21").toISOString();
    source.completedAt = new Date(+new Date(source.startedAt) + minutes * 60_000).toISOString();
    const row = workoutHistory([source], null)[0];
    // An unrelated/stale display value cannot override the immutable timestamps.
    row.seconds = 900;
    assert.equal(history.workoutDetailDuration(row), label);
    const output = html(components.WorkoutDetail, {
      row,
      previous: null,
      pending: false,
      error: null,
      onRepeat() {},
      onDelete() {},
      onSaveSet: async () => true,
      onSaveTime: async () => true,
    });
    assert.ok(output.includes(`Monday 5 Oct · ${label}`));
    assert.doesNotMatch(output, /14:21 to 14:26/);
  });
}

test("workout detail only switches to hours once the real duration reaches an hour", () => {
  for (const [seconds, expected] of [
    [3599, "60 min"],
    [3600, "1 h 0 min"],
  ]) {
    const start = "2026-10-05T14:21:00Z";
    assert.equal(
      history.workoutDetailDuration({
        legacy: {
          startedAt: start,
          completedAt: new Date(+new Date(start) + seconds * 1000).toISOString(),
        },
      }),
      expected,
    );
  }
});

test("workout detail uses the existing safe duration fallback for missing, reversed or invalid timestamps", () => {
  for (const [start, end] of [
    [undefined, undefined],
    ["invalid", "invalid"],
    ["2026-10-05T14:26Z", "2026-10-05T14:21Z"],
  ]) {
    const row = { date: "2026-10-05", legacy: { startedAt: start, completedAt: end } };
    assert.equal(history.workoutDetailDuration(row), "Time unavailable");
  }
  assert.equal(
    history.workoutDetailDuration({
      legacy: { startedAt: "2026-10-05T14:21Z", completedAt: "2026-10-05T14:26Z" },
    }),
    "5 min",
  );
});

test("unavailable timestamps cannot crash the detail or hidden time editor", () => {
  const row = workoutHistory([session("missing-time", "2026-10-05")], null)[0];
  row.session.startedAt = "invalid";
  row.session.completedAt = undefined;
  assert.equal(history.localTimestampInput("invalid"), "");
  assert.equal(history.localTimestampInput(undefined), "");
  const output = html(components.WorkoutDetail, {
    row,
    previous: null,
    pending: false,
    error: null,
    onRepeat() {},
    onDelete() {},
    onSaveSet: async () => true,
    onSaveTime: async () => true,
  });
  assert.ok(output.includes("Monday 5 Oct · Time unavailable"));
});

test("historical correction keeps shared picker strings and the existing RPC/time validation path", async () => {
  const source = await read("src/components/WorkoutHistory.tsx");
  const route = await read("src/routes/_authenticated/bulk/training_.history.tsx");
  assert.match(source, /TempoDatePicker/);
  assert.match(source, /TempoDateTimePicker/);
  assert.match(source, /label="Start time"/);
  assert.match(source, /label="End time"/);
  assert.match(source, /validateWorkoutTimes\(date, start, end\)/);
  assert.match(route, /correctCompletedBulkTrainingTime/);
  const query = await read("src/lib/bulk-training-sessions.ts");
  assert.match(query, /new Date\(start\)\.toISOString\(\)/);
  assert.match(query, /new Date\(end\)\.toISOString\(\)/);
  assert.doesNotMatch(source, /type="date"|type="datetime-local"/);
});

test("history route preserves contextual Back and uses shared invalidations for every action", async () => {
  const source = await read("src/routes/_authenticated/bulk/training_.history.tsx");
  assert.match(source, /HistoryBackLink/);
  assert.match(source, /parentPath="\/bulk\/training\/history"/);
  assert.match(source, /search:\s*\{\}/);
  assert.match(source, /workoutHistoryInvalidationKeys/);
  assert.match(source, /correctCompletedBulkTrainingSet/);
  assert.match(source, /repeatCompletedBulkTrainingSession/);
  assert.doesNotMatch(source, /window\.location|history\.go\(-1\)/);
  const query = await read("src/lib/bulk-training-sessions.ts");
  for (const key of [
    "bulk-training-session",
    "bulk-training-sessions",
    "bulk-personal-records",
    "bulk-progression",
    "bulk-progress-summary",
  ])
    assert.ok(query.includes(key));
});

test("tracked preference keeps the existing key, supports remove/add/reset and is profile-isolated", () => {
  const key = "tempo:progress-tracked-lifts";
  const storage = new Map([[key, JSON.stringify(["Press"])]]);
  const slots = [];
  let index = 0;
  let profile = "a";
  let currentPlan = plan([["Press", "Rows"]]);
  const hook = presentationComponent(
    "src/lib/progress-view.ts",
    {
      react: {
        useState(initial) {
          const i = index++;
          slots[i] ??= typeof initial === "function" ? initial() : initial;
          return [
            slots[i],
            (value) => {
              slots[i] = value;
            },
          ];
        },
      },
      "./progress-period.ts": progressPeriods,
      "./challenge.ts": { useMyChallenge: () => ({ data: null }) },
      "./progress-sections.ts": { availableProgressSections: () => [] },
      "./progress-model.ts": {
        useProgressMode: () => ({ publicId: profile, bulkId: profile, mode: "public" }),
        useStrengthModel: () => ({ records: [] }),
      },
      "./training-plans-query.ts": {
        useActiveTrainingPlan: () => ({ data: currentPlan, isLoading: false }),
      },
      "./strength-estimates.ts": {
        defaultTrackedLifts,
        trackedLiftCandidates,
        resolveTrackedLifts,
      },
      "./types.ts": types,
    },
    {
      localStorage: {
        getItem: (key) => storage.get(key) ?? null,
        setItem: (key, value) => storage.set(key, value),
      },
    },
  );
  const render = () => {
    index = 0;
    return hook.useTrackedLifts({ targets: {} });
  };
  assert.deepEqual(Array.from(render()[0]), ["Press"]);
  render()[1](["Rows"]);
  assert.deepEqual(Array.from(render()[0]), ["Rows"]);
  currentPlan = plan([["Rows", "Squat"]]);
  assert.deepEqual(Array.from(render()[0]), ["Rows"]);
  render()[1]([]);
  assert.deepEqual(Array.from(render()[0]), []);
  render()[2]();
  assert.deepEqual(Array.from(render()[0]), ["Rows"]);
  profile = "b";
  currentPlan = plan([["Other"]]);
  assert.deepEqual(Array.from(render()[0]), ["Other"]);
  assert.ok(storage.has(key));
  assert.doesNotMatch(storage.get(key), /"b"/);
});

test("detail controls call real callbacks, editors preserve fields and deletion is confirmation-protected", async () => {
  const slots = [];
  let index = 0;
  const jsx = (type, props) => ({ type, props });
  const fakeReact = {
    useState(initial) {
      const i = index++;
      slots[i] ??= { value: typeof initial === "function" ? initial() : initial };
      return [
        slots[i].value,
        (value) => {
          slots[i].value = typeof value === "function" ? value(slots[i].value) : value;
        },
      ];
    },
  };
  const component = presentationComponent("src/components/WorkoutHistory.tsx", {
    ...modules,
    react: fakeReact,
    "react/jsx-runtime": { jsx, jsxs: jsx },
  });
  const find = (tree, predicate) =>
    !tree || typeof tree !== "object"
      ? []
      : Array.isArray(tree)
        ? tree.flatMap((item) => find(item, predicate))
        : [...(predicate(tree) ? [tree] : []), ...find(tree.props?.children, predicate)];
  const children = (tree) =>
    typeof tree === "object"
      ? Array.isArray(tree)
        ? tree.map(children).join(" ")
        : children(tree.props?.children)
      : String(tree ?? "");
  const row = workoutHistory([session("new", "2026-10-01")], null)[0];
  let repeated = 0,
    deleted = 0;
  const props = {
    row,
    previous: null,
    pending: false,
    error: null,
    onRepeat: () => repeated++,
    onDelete: () => deleted++,
    onSaveSet: async () => true,
    onSaveTime: async () => true,
  };
  const render = () => {
    index = 0;
    return component.WorkoutDetail(props);
  };
  find(
    render(),
    (node) => node.props?.onClick && children(node) === "Repeat this workout",
  )[0].props.onClick();
  assert.equal(repeated, 1);
  find(
    render(),
    (node) => node.props?.onSelect && children(node) === "Edit sets",
  )[0].props.onSelect();
  assert.ok(find(render(), (node) => node.type?.name === "HistoricalSetEditor").length);
  find(render(), (node) => node.props?.onSelect && children(node) === "Delete")[0].props.onSelect();
  const confirmation = find(render(), (node) => node.type?.name === "ConfirmWorkoutRemoval")[0];
  assert.equal(confirmation.props.open, true);
  assert.equal(deleted, 0);
  confirmation.props.onConfirm();
  assert.equal(deleted, 1);
  const drafts = [];
  index = 0;
  slots.length = 0;
  const editor = component.HistoricalSetEditor({
    set: row.session.exercises[0].sets[1],
    exercise: row.session.exercises[0],
    pending: false,
    onSave: async (draft) => {
      drafts.push(draft);
      return true;
    },
  });
  await editor.props.onSubmit({ preventDefault() {} });
  assert.equal(drafts[0].rpe, 8);
  assert.equal(drafts[0].setType, "normal");
  assert.equal(drafts[0].bilateralReps, 10);
});

test("deleting a legacy workout removes Strength count/records without touching same-day nutrition or gym flag", async () => {
  const { collectCompletedWorkouts } = await import("../src/lib/goal-metrics.ts");
  const data = {
    workouts: {
      "2026-09-28": {
        date: "2026-09-28",
        type: "Chest & Back",
        entries: [{ exercise: "Press", weight: 20, reps: [10] }],
      },
    },
    days: {
      "2026-09-28": {
        date: "2026-09-28",
        gym: true,
        weight: 70,
        calories: 2900,
        notes: "Preserve",
      },
    },
  };
  const before = structuredClone(data.days);
  const counts = () =>
    collectCompletedWorkouts({ legacyWorkouts: history.recordedLegacyWorkouts(data) });
  assert.equal(counts().length, 1);
  assert.equal(workoutHistory([], data).length, 1);
  delete data.workouts["2026-09-28"];
  assert.equal(counts().length, 0);
  assert.equal(workoutHistory([], data).length, 0);
  assert.deepEqual(data.days, before);
});

test("incremental history records match the authoritative PR summaries over mixed history and unilateral sets", async () => {
  const { deriveLegacyPersonalRecords, mergePersonalRecords, personalRecordImprovements } =
    await import("../src/lib/personal-records.ts");
  const sessions = Array.from({ length: 30 }, (_, i) => {
    const date = new Date(Date.UTC(2026, 8, i + 1)).toISOString().slice(0, 10);
    const row = session(String(i), date, 20 + (i % 4) * 2);
    if (i % 5 === 0) {
      row.exercises[0].executionMode = "unilateral";
      row.exercises[0].sets = row.exercises[0].sets.map((s) => ({
        ...s,
        bilateralWeight: null,
        bilateralReps: null,
        leftWeight: 20 + i,
        leftReps: 8,
        rightWeight: 22 + i,
        rightReps: 9,
      }));
    }
    return row;
  });
  const data = {
    workouts: {
      "2026-08-31": {
        date: "2026-08-31",
        type: "Chest & Back",
        entries: [{ exercise: "Incline press", weight: 18, reps: [12] }],
      },
    },
  };
  const rows = workoutHistory(sessions, data).reverse();
  const accumulated = [];
  const legacy = {};
  let before = [];
  for (const row of rows) {
    if (row.session) accumulated.push(row.session);
    if (row.legacy) legacy[row.date] = row.legacy;
    const after = mergePersonalRecords(
      derivePublicPersonalRecords(accumulated),
      deriveLegacyPersonalRecords({ ...data, workouts: legacy }),
    );
    const expected = personalRecordImprovements(before, after).filter(
      (i) => i.performance.date === (row.session?.completedAt ?? row.date),
    );
    assert.equal(row.records, expected.length, row.key);
    before = after;
  }
});

test("time editor preserves overnight calendar offsets when changing workout date and closes only on successful save", async () => {
  const slots = [];
  let index = 0;
  const jsx = (type, props) => ({ type, props });
  const component = presentationComponent("src/components/WorkoutHistory.tsx", {
    ...modules,
    react: {
      useState(initial) {
        const i = index++;
        slots[i] ??= { value: typeof initial === "function" ? initial() : initial };
        return [
          slots[i].value,
          (value) => {
            slots[i].value = typeof value === "function" ? value(slots[i].value) : value;
          },
        ];
      },
    },
    "react/jsx-runtime": { jsx, jsxs: jsx },
  });
  const source = session("overnight", "2026-10-01");
  source.startedAt = new Date("2026-10-01T23:45").toISOString();
  source.completedAt = new Date("2026-10-02T00:15").toISOString();
  const row = workoutHistory([source], null)[0];
  let saved,
    closed = 0,
    ok = false;
  const props = {
    row,
    open: true,
    pending: false,
    error: null,
    onOpenChange: () => closed++,
    onSave: async (...args) => {
      saved = args;
      return ok;
    },
  };
  const find = (tree, predicate) =>
    !tree || typeof tree !== "object"
      ? []
      : Array.isArray(tree)
        ? tree.flatMap((item) => find(item, predicate))
        : [...(predicate(tree) ? [tree] : []), ...find(tree.props?.children, predicate)];
  const render = () => {
    index = 0;
    return component.WorkoutTimeDialog(props);
  };
  find(render(), (n) => n.type === "TempoDatePicker")[0].props.onChange("2026-10-05");
  const inputs = find(render(), (n) => n.type === "TempoDateTimePicker");
  assert.equal(inputs[0].props.value, "2026-10-05T23:45");
  assert.equal(inputs[1].props.value, "2026-10-06T00:15");
  find(render(), (n) => n.type === "form")[0].props.onSubmit({ preventDefault() {} });
  await Promise.resolve();
  assert.deepEqual(Array.from(saved), ["2026-10-05", "2026-10-05T23:45", "2026-10-06T00:15"]);
  assert.equal(closed, 0);
  ok = true;
  find(render(), (n) => n.type === "form")[0].props.onSubmit({ preventDefault() {} });
  await Promise.resolve();
  assert.equal(closed, 1);
});

test("preserved legacy detail shows actual record sets, exercise-level RPE and all saved note tags", () => {
  const data = {
    workouts: {
      "2026-09-28": {
        date: "2026-09-28",
        type: "Chest & Back",
        entries: [
          {
            exercise: "Press",
            weight: 20,
            reps: [10, 8],
            rpe: 8,
            noteTags: ["Good form"],
            notes: "Bench 3",
          },
        ],
        startedAt: "2026-09-28T12:00Z",
        completedAt: "2026-09-28T12:40Z",
      },
    },
  };
  const row = workoutHistory([], data)[0];
  assert.ok(row.recordSets.includes(history.legacyRecordSetKey(row.date, "Press", 0)));
  assert.equal(row.recordSets.length, 1);
  const output = html(components.WorkoutDetail, {
    row,
    previous: null,
    pending: false,
    error: null,
    onRepeat() {},
    onDelete() {},
    onSaveSet: async () => true,
    onSaveTime: async () => true,
  });
  for (const text of ["Record", "Good form", "RPE 8", "Bench 3"])
    assert.ok(output.includes(text), text);
  assert.equal((output.match(/RPE 8/g) ?? []).length, 1);
});
