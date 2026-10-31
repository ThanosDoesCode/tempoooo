import { test } from "node:test";
import assert from "node:assert/strict";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createRequire } from "node:module";
import { presentationComponent } from "./presentation-component-fixture.mjs";
import {
  derivePublicPersonalRecords,
  mergePersonalRecords,
  personalRecordImprovements,
} from "../src/lib/personal-records.ts";
import {
  groupExerciseRecords,
  resolveExerciseRecord,
  normalizeTrackedPreferences,
  trackedExerciseOptions,
  exerciseRecordPresentation,
} from "../src/lib/exercise-records.ts";
import { progressRecordEvents, strengthProgress } from "../src/lib/strength-progress.ts";
import {
  liftEstimate,
  epleyEstimatedMax,
  defaultTrackedLifts,
} from "../src/lib/strength-estimates.ts";
import { trackedLiftSummary } from "../src/lib/progress-presentation.ts";
import * as periods from "../src/lib/progress-period.ts";
import * as calc from "../src/lib/calc.ts";
import * as types from "../src/lib/types.ts";

const require = createRequire(import.meta.url);
const h = React.createElement;
const range = { start: "2026-09-01", end: "2026-10-30" };
const name = "Incline Dumbbell Bench Press";
function session(day, left = 18, right = left, extra = {}) {
  return {
    id: `session:${day}`,
    status: "completed",
    startedAt: `${day}T10:00:00Z`,
    completedAt: `${day}T11:00:00Z`,
    workoutDate: day,
    bodyweightKg: 70,
    exercises: [
      {
        id: `snapshot:${day}`,
        sourceExerciseId: "press",
        name,
        executionMode: "unilateral",
        isBodyweight: false,
        sets: [
          {
            id: `set:${day}`,
            setType: "normal",
            isComplete: true,
            leftWeight: left,
            leftReps: 8,
            rightWeight: right,
            rightReps: 8,
          },
        ],
        ...extra,
      },
    ],
  };
}
const records = (...sessions) => derivePublicPersonalRecords(sessions);
const group = (values) => groupExerciseRecords(values)[0];
const plan = {
  id: "plan",
  days: [
    {
      order: 1,
      exercises: [
        { exerciseId: "press", name, order: 1, isBodyweight: false, repMin: 8, repMax: 12 },
      ],
    },
  ],
};

function markup(
  file,
  values,
  { search = {}, lift = "press", keys = ["press"], selectedPlan = plan } = {},
) {
  const wrapper = ({ children }) => h("div", {}, children);
  const chrome = Object.fromEntries(
    ["ProgressHeader", "ProgressNav", "PeriodPicker", "ProgressRow"].map((key) => [key, wrapper]),
  );
  const charts = Object.fromEntries(
    ["CartesianGrid", "Line", "LineChart", "ResponsiveContainer", "Tooltip", "XAxis", "YAxis"].map(
      (key) => [key, wrapper],
    ),
  );
  const options = trackedExerciseOptions(selectedPlan, values, []);
  const compiled = presentationComponent(file, {
    react: React,
    "@tanstack/react-router": {
      createFileRoute: () => (config) => ({
        ...config,
        useSearch: () => search,
        useParams: () => ({ lift }),
      }),
      Link: ({ to, params, search, preload, ...props }) =>
        h("a", { ...props, href: to, "data-key": search?.record ?? params?.lift }),
    },
    "@/components/AppShell": {
      AppShell: wrapper,
      PageHeader: ({ title, subtitle }) =>
        h("header", {}, h("h1", {}, title), subtitle ? h("p", {}, subtitle) : null),
    },
    "@/components/HistoryBackLink": {
      HistoryBackLink: () => h("a", { href: "/bulk/prs" }, "Back"),
    },
    "@/components/ui-kit": {
      Card: ({ children, className }) => h("section", { className }, children),
      DataError: wrapper,
      SectionTitle: wrapper,
    },
    "@/components/ProgressChrome": chrome,
    "@/components/ProgressChartTooltip": { ProgressChartTooltip: wrapper },
    "@/lib/progress-model": {
      useStrengthModel: () => ({ records: values, workoutRecords: [], loading: false }),
      useProgressMode: () => ({ mode: "public", publicId: "owner" }),
    },
    "@/lib/training-plans-query": { useActiveTrainingPlan: () => ({ data: selectedPlan }) },
    "@/lib/progress-view": {
      useProgressPeriod: () => ["all", () => {}],
      useTrackedLifts: () => [
        keys,
        () => {},
        () => {},
        {
          fromPlan: options.fromPlan,
          history: options.history,
          labels: Object.fromEntries(options.options.map((option) => [option.key, option.name])),
        },
        false,
      ],
      chartAxis: {},
      chartTooltip: {},
    },
    "@/lib/store": { useAppData: () => ({ workouts: {}, targets: {} }) },
    "@/lib/calc": calc,
    "@/lib/types": types,
    "@/lib/network-errors": { userFacingError: () => "Error" },
    "@/lib/strength-progress": require("../src/lib/strength-progress.ts"),
    "@/lib/progress-period": periods,
    "@/lib/progress-presentation": { trackedLiftSummary },
    recharts: charts,
  });
  return renderToStaticMarkup(h(compiled.Route.component));
}
const strengthPath = "src/routes/_authenticated/bulk/progress_.strength.tsx";
const detailPath = "src/routes/_authenticated/bulk/progress_.strength_.$lift.tsx";
const prsPath = "src/routes/_authenticated/bulk/prs.tsx";

test("canonical identity groups left/right once by exercise ID without modifying side records", () => {
  const values = records(session("2026-09-02"));
  const snapshot = structuredClone(values);
  const groups = groupExerciseRecords(values);
  assert.equal(groups.length, 1);
  assert.equal(groups[0].key, "press");
  assert.equal(groups[0].name, name);
  assert.equal(groups[0].records.length, 2);
  assert.deepEqual(values, snapshot);
  assert.equal(resolveExerciseRecord(groups, "press:left"), groups[0]);
  assert.equal(resolveExerciseRecord(groups, name), groups[0]);
});
test("equal meaningful side performances collapse to each side; uneven load/reps never average", () => {
  const equal = exerciseRecordPresentation(group(records(session("2026-09-02"))), range);
  assert.equal(equal.summary, "18 kg × 8 each side");
  assert.ok(Math.abs(equal.commonEstimate - 22.8) < 1e-9);
  const uneven = exerciseRecordPresentation(group(records(session("2026-09-02", 18, 16))), range);
  assert.equal(uneven.summary, null);
  assert.equal(uneven.rows[0].value, "18 kg × 8");
  assert.equal(uneven.rows[1].value, "16 kg × 8");
  assert.equal(uneven.commonEstimate, null);
  assert.ok(Math.abs(uneven.rows[1].estimate - 20.2666666667) < 1e-8);
  const reps = session("2026-09-03");
  reps.exercises[0].sets[0].rightReps = 7;
  assert.equal(exerciseRecordPresentation(group(records(reps)), range).summary, null);
});
test("left PR compares only to left even when the right side is heavier, and right can fail to PR", () => {
  const prior = records(session("2026-09-02", 18, 30));
  const after = records(session("2026-09-02", 18, 30), session("2026-09-09", 20, 28));
  const improvements = personalRecordImprovements(prior, after);
  assert.ok(improvements.some((event) => event.record.side === "left" && event.kind === "weight"));
  assert.ok(improvements.every((event) => event.record.side === "left"));
  const current = progressRecordEvents(after, range).filter((event) =>
    event.performance.date.startsWith("2026-09-09"),
  );
  assert.ok(current.length > 0);
  assert.ok(current.every((event) => event.record.side === "left"));
});
test("right PR compares only to right; both sides can independently improve", () => {
  const prior = records(session("2026-09-02", 30, 18));
  const rightOnly = records(session("2026-09-02", 30, 18), session("2026-09-09", 28, 20));
  assert.ok(
    personalRecordImprovements(prior, rightOnly).every((event) => event.record.side === "right"),
  );
  const both = records(session("2026-09-02", 18, 16), session("2026-09-09", 20, 18));
  assert.deepEqual(
    [
      ...new Set(
        personalRecordImprovements(records(session("2026-09-02", 18, 16)), both).map(
          (event) => event.record.side,
        ),
      ),
    ].sort(),
    ["left", "right"],
  );
});
test("unilateral estimated max uses canonical Epley independently, never doubled or summed", () => {
  const values = records(session("2026-09-02", 18, 16));
  assert.equal(liftEstimate(values[0]).current, epleyEstimatedMax(18, 8));
  assert.equal(liftEstimate(values[1]).current, epleyEstimatedMax(16, 8));
  assert.notEqual(liftEstimate(values[0]).current, epleyEstimatedMax(36, 8));
  const model = exerciseRecordPresentation(group(values), range, "best");
  assert.ok(Math.abs(model.rows[0].estimate - 22.8) < 1e-9);
  assert.ok(Math.abs(model.rows[1].estimate - 20.2666666667) < 1e-8);
});
test("comparisons stay same-side and same-rep, collapsing identical wording only", () => {
  const values = records(session("2026-09-02", 18, 16), session("2026-09-09", 20, 18));
  const model = exerciseRecordPresentation(group(values), range);
  assert.match(model.commonComparison, /^\+2 kg/);
  assert.equal(model.rows[0].progress.changeKg, 2);
  assert.equal(model.rows[1].progress.changeKg, 2);
  const sparse = session("2026-09-09", 20, 18);
  sparse.exercises[0].sets[0].rightReps = 10;
  const separate = exerciseRecordPresentation(
    group(records(session("2026-09-02", 18, 16), sparse)),
    range,
  );
  assert.equal(separate.commonComparison, null);
  assert.equal(separate.rows[0].progress.changeKg, 2);
  assert.equal(separate.rows[1].progress.changeKg, null);
});
test("one-sided history is explicit; latest performances from different sessions do not pretend to match", () => {
  const left = records(session("2026-09-02"))[0];
  const model = exerciseRecordPresentation(group([left]), range);
  assert.equal(model.summary, null);
  assert.equal(model.rows.length, 1);
  const right = records(session("2026-09-09"))[1];
  assert.equal(exerciseRecordPresentation(group([left, right]), range).summary, null);
});
test("distinct custom exercises with the same label retain independent PRs and tracked identities", () => {
  const a = session("2026-09-02", 18, 16, { sourceExerciseId: "custom:a" });
  const b = session("2026-09-09", 30, 28, { sourceExerciseId: "custom:b" });
  const merged = mergePersonalRecords(records(a, b), []);
  assert.equal(merged.length, 4);
  assert.equal(groupExerciseRecords(merged).length, 2);
  assert.equal(
    merged.find((r) => r.exerciseId === "custom:a" && r.side === "left").bestWeight.load,
    18,
  );
  assert.equal(resolveExerciseRecord(groupExerciseRecords(merged), name), undefined);
});
test("unambiguous legacy compatibility remains merged, ambiguous names are not assigned to another custom exercise", () => {
  const values = records(session("2026-09-02", 18, 16));
  const legacy = { ...values[0], key: "legacy-press-left", exerciseId: null };
  assert.equal(mergePersonalRecords(values, [legacy]).length, 2);
  const other = records(session("2026-09-09", 30, 28, { sourceExerciseId: "custom:b" }));
  assert.equal(mergePersonalRecords([...values, ...other], [legacy]).length, 5);
});
test("legacy side preferences normalize to IDs and preserve unrelated/unavailable preferences", () => {
  const options = trackedExerciseOptions(plan, records(session("2026-09-02")), []).options;
  const normalized = normalizeTrackedPreferences(
    ["press:left", "press:right", `${name} · left`, `${name} · right`, "Squat", "removed-lift"],
    options,
  );
  assert.deepEqual(normalized, ["press", "Squat", "removed-lift"]);
  assert.deepEqual(normalizeTrackedPreferences([name, name], options), ["press"]);
});
test("profile-local preference normalization persists safely and leaves other profiles untouched", () => {
  const storage = new Map([
    [
      "tempo:progress-tracked-lifts",
      JSON.stringify({
        owner: ["press:left", "press:right", "Squat"],
        other: ["Do not change:right"],
      }),
    ],
  ]);
  let value,
    scope = "owner";
  const hook = presentationComponent(
    "src/lib/progress-view.ts",
    {
      react: {
        useState(initial) {
          value ??= typeof initial === "function" ? initial() : initial;
          return [
            value,
            (next) => {
              value = next;
            },
          ];
        },
      },
      "./challenge.ts": {},
      "./progress-sections.ts": {},
      "./progress-period.ts": periods,
      "./progress-model.ts": {
        useProgressMode: () => ({ mode: "public", publicId: scope, bulkId: scope }),
        useStrengthModel: () => ({ records: records(session("2026-09-02")) }),
      },
      "./training-plans-query.ts": {
        useActiveTrainingPlan: () => ({ data: plan, isLoading: false }),
      },
      "./strength-estimates.ts": { defaultTrackedLifts },
      "./types.ts": types,
    },
    {
      localStorage: {
        getItem: (key) => storage.get(key) ?? null,
        setItem: (key, next) => storage.set(key, next),
      },
    },
  );
  assert.deepEqual(Array.from(hook.useTrackedLifts({ targets: {} })[0]), ["press"]);
  const stored = JSON.parse(storage.get("tempo:progress-tracked-lifts"));
  assert.deepEqual(stored.owner, ["press", "Squat"]);
  assert.deepEqual(stored.other, ["Do not change:right"]);
  hook.useTrackedLifts({ targets: {} })[1]([]);
  assert.deepEqual(JSON.parse(storage.get("tempo:progress-tracked-lifts")).owner, ["Squat"]);
  hook.useTrackedLifts({ targets: {} })[2]();
  assert.equal(JSON.parse(storage.get("tempo:progress-tracked-lifts")).owner, undefined);
  assert.deepEqual(JSON.parse(storage.get("tempo:progress-tracked-lifts")).other, [
    "Do not change:right",
  ]);
});
test("bilateral records and estimates remain unchanged and render once beside one unilateral card", () => {
  const bilateral = session("2026-09-02", 18, 16, {
    sourceExerciseId: "bench",
    name: "Barbell Bench Press",
    executionMode: "bilateral",
  });
  bilateral.exercises[0].sets = [
    { isComplete: true, setType: "normal", bilateralWeight: 80, bilateralReps: 5 },
  ];
  const values = records(session("2026-09-02"), bilateral);
  const bench = values.find((r) => r.exerciseId === "bench");
  assert.equal(bench.bestWeight.load, 80);
  assert.equal(liftEstimate(bench).current, epleyEstimatedMax(80, 5));
  const html = markup(strengthPath, values, { keys: ["press", "bench"] });
  assert.equal((html.match(/data-key="press"/g) ?? []).length, 1);
  assert.equal((html.match(/data-key="bench"/g) ?? []).length, 1);
  assert.match(html, /80 kg × 5/);
});
test("Personal Records renders one canonical exercise link and equal-side summary/estimate", () => {
  const html = markup(prsPath, records(session("2026-09-02")));
  assert.equal((html.match(/data-key="press"/g) ?? []).length, 1);
  assert.equal((html.match(new RegExp(name, "g")) ?? []).length, 1);
  assert.match(html, /18 kg × 8 each side/);
  assert.match(html, /22.8 kg each side/);
  assert.doesNotMatch(html, /Bench Press · (left|right)/);
});
test("Strength renders one card for unequal sides and one shared comparison state for equal sides", () => {
  const unequal = markup(strengthPath, records(session("2026-09-02", 18, 16)));
  assert.equal((unequal.match(/data-key="press"/g) ?? []).length, 1);
  assert.match(unequal, /Left/);
  assert.match(unequal, /Right/);
  assert.match(unequal, /18 kg × 8/);
  assert.match(unequal, /16 kg × 8/);
  assert.match(unequal, /Left estimated 1RM:.*22.8/);
  assert.match(unequal, /Right estimated 1RM:.*20.3/);
  const equal = markup(strengthPath, records(session("2026-09-02"), session("2026-09-09")));
  assert.equal((equal.match(/kg vs start of period/g) ?? []).length, 1);
  assert.match(equal, /18 kg × 8 each side/);
});
test("no-comparison copy occurs once per exercise, including two non-comparable sessions", () => {
  const later = session("2026-09-09", 20);
  later.exercises[0].sets[0].leftReps = 10;
  later.exercises[0].sets[0].rightReps = 10;
  const html = markup(strengthPath, records(session("2026-09-02"), later));
  assert.equal((html.match(/No comparable previous session yet/g) ?? []).length, 1);
});
test("old side-specific PR deep links open one exercise with both independent histories", () => {
  const html = markup(prsPath, records(session("2026-09-02", 18, 16)), {
    search: { record: "press:right" },
  });
  assert.equal((html.match(new RegExp(name, "g")) ?? []).length, 1);
  assert.match(html, />Left<\/h2>/);
  assert.match(html, />Right<\/h2>/);
  assert.match(html, /18 kg/);
  assert.match(html, /16 kg/);
  assert.match(html, /num mt-1 break-words text-sm font-semibold/);
});
test("period PR events stay complete and chronological inside one exercise card", () => {
  const values = records(session("2026-09-02", 18, 16), session("2026-09-09", 20, 18));
  const html = markup(prsPath, values, { search: { period: "all" } });
  assert.equal((html.match(/data-key="press"/g) ?? []).length, 1);
  assert.equal(
    (html.match(/Weight PR|Rep PR|Volume PR/g) ?? []).length,
    progressRecordEvents(values, range).length,
  );
  assert.ok(html.indexOf("9 Sep 2026") < html.indexOf("2 Sep 2026"));
});
test("lift detail resolves canonical ID, shows both side histories and no duplicate previous comparison", () => {
  const first = session("2026-09-02", 18, 16),
    second = session("2026-09-09", 20, 18);
  const html = markup(detailPath, records(first, second));
  assert.equal((html.match(new RegExp(name, "g")) ?? []).length, 1);
  assert.match(html, />Left<\/h2>/);
  assert.match(html, />Right<\/h2>/);
  assert.equal((html.match(/kg vs start of period/g) ?? []).length, 1);
});
test("tracked summary counts a unilateral exercise once for canonical and old aliases", () => {
  const values = records(session("2026-09-02", 18, 16), session("2026-09-09", 20, 18));
  assert.deepEqual(trackedLiftSummary(values, ["press", "press:left", "press:right"], range), {
    total: 1,
    comparable: 1,
    up: 1,
  });
});

test("preserved legacy bilateral history joins its unambiguous exercise without inventing a side", () => {
  const values = records(session("2026-09-02"));
  const legacy = { ...values[0], key: `legacy:${name}:bilateral`, exerciseId: null, side: null };
  const groups = groupExerciseRecords([...values, legacy]);
  assert.equal(groups.length, 1);
  assert.equal(groups[0].key, "press");
  assert.equal(groups[0].records.length, 3);
  assert.equal(groups[0].records.find((r) => r.key === legacy.key).side, null);
  const presentation = exerciseRecordPresentation(groups[0], range);
  assert.equal(presentation.summary, null);
  assert.deepEqual(
    presentation.rows.map((row) => row.label),
    ["Standard", "Left", "Right"],
  );
});

test("best PR summary and latest working snapshot remain distinct, with no fabricated history", () => {
  const older = session("2026-09-02", 20, 18),
    newer = session("2026-09-09", 18, 16);
  const exercise = group(records(older, newer));
  const best = exerciseRecordPresentation(exercise, range, "best"),
    latest = exerciseRecordPresentation(exercise, range);
  assert.equal(best.rows[0].performance.load, 20);
  assert.equal(latest.rows[0].performance.load, 18);
  assert.equal(best.rows[1].performance.load, 18);
  assert.equal(latest.rows[1].performance.load, 16);
});

test("period PR grouping retains old name-only events beside normalized side events", () => {
  const values = records(session("2026-09-02"));
  const legacy = { ...values[0], key: `legacy:${name}:bilateral`, exerciseId: null, side: null };
  const mixed = [...values, legacy];
  const html = markup(prsPath, mixed, { search: { period: "all" } });
  assert.equal((html.match(/data-key="press"/g) ?? []).length, 1);
  assert.equal(
    (html.match(/Weight PR|Rep PR|Volume PR/g) ?? []).length,
    progressRecordEvents(mixed, range).length,
  );
});

test("secondary estimated-max change is retained per side and for bilateral lifts", () => {
  const values = records(session("2026-09-02", 18, 16), session("2026-09-09", 20, 18));
  const model = exerciseRecordPresentation(group(values), range);
  assert.equal(model.rows[0].estimateChange, strengthProgress(values[0], range).estimate.changePct);
  assert.equal(model.rows[1].estimateChange, strengthProgress(values[1], range).estimate.changePct);
  const html = markup(strengthPath, values);
  assert.match(html, /Left estimated 1RM:.*25.3 kg · \+11%/);
  assert.ok(
    html.includes(
      `Right estimated 1RM: 22.8 kg · ${calc.signed(model.rows[1].estimateChange, 0)}%`,
    ),
  );
  const bilateral = values.map((record) => ({
    ...record,
    side: null,
    exerciseId: "bench",
    key: "bench:bilateral",
    name: "Bench",
  }))[0];
  assert.match(
    markup(strengthPath, [bilateral], { keys: ["bench"] }),
    /Estimated 1RM.*25.3 kg · \+11%/,
  );
});
