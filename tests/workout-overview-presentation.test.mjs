import { test } from "node:test";
import assert from "node:assert/strict";
import { accountUI } from "./account-ui-fixture.mjs";
import * as presentation from "../src/lib/workout-overview-presentation.ts";
import { perSetRepObjective } from "../src/lib/bulk-next-session-guidance.ts";
const { workoutOverviewPresentation: show } = presentation;
const prescription = {
  planExerciseId: "slot",
  exerciseId: "system:press",
  executionMode: "bilateral",
  isBodyweight: false,
  targetSets: 3,
  repMin: 8,
  repMax: 12,
};
const previous = (reps = [12, 12, 12], overrides = {}) =>
  reps.map((n) => ({
    setType: "normal",
    bilateralLoad: 54,
    bilateralReps: n,
    leftLoad: 16,
    rightLoad: 16,
    leftReps: n,
    rightReps: n,
    ...overrides,
  }));
const result = (overrides = {}) => ({
  planExerciseId: "slot",
  exerciseId: "system:press",
  executionMode: "bilateral",
  isBodyweight: false,
  sourceSessionId: "previous",
  decision: "increase_load",
  reasonCode: "rep_ceiling_reached",
  currentLoad: 54,
  recommendedLoad: 57.5,
  leftCurrentLoad: null,
  rightCurrentLoad: null,
  leftRecommendedLoad: null,
  rightRecommendedLoad: null,
  targetSets: 3,
  repTargetMin: 8,
  repTargetMax: 12,
  targetTotalReps: null,
  weakerSide: null,
  dataStatus: "usable",
  previousPerformance: previous(),
  previousBySetType: { warmup: [], normal: [], failure: [], drop: [] },
  ...overrides,
});

test("weighted overview separates today's exact load from previous performance without repeating prescription", () => {
  const output = show(result(), prescription);
  assert.deepEqual(output.today, ["57.5 kg"]);
  assert.deepEqual(output.lastTime, ["54 kg · 12 / 12 / 12"]);
  assert.doesNotMatch(output.today.join(), /Use|Keep|3 sets|8–12/);
});

test("matching unilateral sets collapse only when every left/right load and rep pair matches", () => {
  const value = result({
    executionMode: "unilateral",
    leftRecommendedLoad: 17.5,
    rightRecommendedLoad: 17.5,
    previousPerformance: previous([12, 10, 10]),
  });
  const output = show(value, { ...prescription, executionMode: "unilateral" });
  assert.deepEqual(output.today, ["17.5 kg each side"]);
  assert.deepEqual(output.lastTime, ["16 kg · 12 / 10 / 10 each side"]);
});

test("rep progression uses the existing exact per-set objective; it does not round or reorder reps", () => {
  const value = result({
    executionMode: "unilateral",
    decision: "maintain_load_increase_reps",
    reasonCode: "build_reps",
    leftRecommendedLoad: 12.5,
    rightRecommendedLoad: 12.5,
    previousPerformance: previous([10, 10, 10], { leftLoad: 12, rightLoad: 12 }),
    repTargetMin: 10,
    repTargetMax: 15,
  });
  const output = show(value, {
    ...prescription,
    executionMode: "unilateral",
    repMin: 10,
    repMax: 15,
  });
  assert.deepEqual(output.today, ["12.5 kg each side · 10 / 10 / 11"]);
  assert.deepEqual(output.lastTime, ["12 kg · 10 / 10 / 10 each side"]);
  assert.deepEqual(perSetRepObjective(value), [10, 10, 11]);
});

test("unweighted bodyweight and added-load recommendations retain their existing meaning", () => {
  const value = result({
    isBodyweight: true,
    decision: "increase_reps",
    reasonCode: "bodyweight_build_reps",
    recommendedLoad: 0,
    previousPerformance: previous([7, 6, 6], { bilateralLoad: 0 }),
    repTargetMin: 5,
    repTargetMax: 10,
  });
  const output = show(value, { ...prescription, isBodyweight: true, repMin: 5, repMax: 10 });
  assert.deepEqual(output.today, ["7 / 6 / 7 reps"]);
  assert.deepEqual(output.lastTime, ["7 / 6 / 6 reps"]);
  const added = show(
    { ...value, decision: "add_load", reasonCode: "bodyweight_rep_ceiling", recommendedLoad: 2.5 },
    { ...prescription, isBodyweight: true, repMin: 5, repMax: 10 },
  );
  assert.deepEqual(added.today, ["+2.5 kg"]);
  const weighted = show(
    {
      ...value,
      decision: "increase_load",
      recommendedLoad: 5,
      previousPerformance: previous([10, 10, 10], { bilateralLoad: 2.5 }),
    },
    { ...prescription, isBodyweight: true, repMin: 5, repMax: 10 },
  );
  assert.deepEqual(weighted.today, ["+5 kg"]);
  assert.deepEqual(weighted.lastTime, ["+2.5 kg · 10 / 10 / 10"]);
});

test("asymmetric loads or even one different rep retain separate L/R lines and weaker-side instruction", () => {
  const sets = previous([12, 10, 10]).map((s, i) => ({
    ...s,
    rightLoad: 15,
    rightReps: [11, 10, 9][i],
  }));
  const value = result({
    executionMode: "unilateral",
    decision: "maintain_load_increase_reps",
    reasonCode: "unequal_side_loads",
    leftRecommendedLoad: 16,
    rightRecommendedLoad: 15,
    weakerSide: "right",
    previousPerformance: sets,
  });
  const output = show(value, { ...prescription, executionMode: "unilateral" });
  assert.deepEqual(output.lastTime, ["L 16 kg · 12 / 10 / 10", "R 15 kg · 11 / 10 / 9"]);
  assert.deepEqual(output.today, ["L 16 kg · 11 / 10 / 10", "R 15 kg · 11 / 10 / 10"]);
  assert.equal(output.note, "Let the right side set the pace.");
  const oneRep = show(
    {
      ...value,
      previousPerformance: previous([12, 10, 10]).map((s, i) => ({
        ...s,
        rightReps: i === 1 ? 9 : s.rightReps,
      })),
    },
    prescription,
  );
  assert.equal(oneRep.lastTime.length, 2);
});

test("missing values, variable set loads and unavailable history never become invented matching sides", () => {
  assert.deepEqual(show(undefined, prescription).today, ["Follow the prescription"]);
  assert.deepEqual(show(undefined, prescription).lastTime, ["No previous session"]);
  const missing = show(
    result({
      executionMode: "unilateral",
      dataStatus: "partial",
      previousPerformance: previous([12, 10, 10], { rightLoad: null }),
    }),
    prescription,
  );
  assert.deepEqual(missing.today, ["Follow the prescription"]);
  assert.equal(missing.lastTime.length, 2);
  assert.match(missing.lastTime[1], /load —/);
  assert.doesNotMatch(missing.lastTime.join(), /each side|0 kg/);
  const variable = show(
    result({
      previousPerformance: previous([12, 10, 8]).map((s, i) => ({
        ...s,
        bilateralLoad: [20, 22.5, 25][i],
      })),
    }),
    prescription,
  );
  assert.deepEqual(variable.lastTime, ["20 kg × 12 / 22.5 kg × 10 / 25 kg × 8"]);
});

test("reduce/repeat loads and any genuinely different prescription are retained without changing progression", () => {
  for (const decision of ["reduce_load", "repeat_target"]) {
    const value = result({
      decision,
      reasonCode:
        decision === "reduce_load" ? "repeated_below_rep_floor" : "incomplete_planned_sets",
      recommendedLoad: 20,
    });
    const before = structuredClone(value);
    assert.deepEqual(show(value, prescription).today, ["20 kg"]);
    assert.deepEqual(value, before);
  }
  assert.deepEqual(
    show(result({ targetSets: 4, repTargetMin: 5, repTargetMax: 8 }), prescription).today,
    ["57.5 kg · 4 × 5–8"],
  );
});

function overviewFixture() {
  const starts = [];
  const names = [
    "Incline Dumbbell Bench Press with a deliberately long exercise name",
    "Pull-Up",
    "Seated Cable Row",
  ];
  const exercises = names.map((name, i) => ({
    id: "slot" + i,
    exerciseId: "system:press",
    name,
    sets: 3,
    repMin: 8,
    repMax: 12,
    intendedUnilateralMode: "bilateral",
    isBodyweight: false,
    notes: null,
  }));
  const ui = accountUI(
    "src/components/TrainingPlanSetup.tsx",
    "TrainingPlanOverview",
    {
      "@/components/ui/native-select": { NativeSelect: "select" },
      "@/components/ui/button": { Button: "button" },
      "@/lib/training-plans": {},
      "@/lib/training-plans-query": {},
      "@/lib/bulk-onboarding": {},
      "@/lib/network-errors": {},
      "@tanstack/react-query": {},
      "@/lib/workout-overview-presentation": presentation,
    },
    {
      plan: {
        name: "Original Tempo program",
        days: [{ id: "day", name: "Chest & Back", order: 1, exercises }],
      },
      onStart: (id) => starts.push(id),
      startingDayId: null,
      workoutActive: false,
      progression: Object.fromEntries(exercises.map((ex) => [ex.id, result()])),
    },
  );
  return { ui, starts };
}

test("authored overview uses Today/Last time definition rows, one prescription, numbered exercises and wrapping values", () => {
  const { ui, starts } = overviewFixture();
  try {
    assert.equal(ui.find("h1")[0].props.children, "Chest & Back");
    assert.match(ui.text(), /Workout day/);
    assert.equal(ui.find("li").length, 3);
    assert.deepEqual(
      ui.find("dt").map((n) => n.props.children),
      ["Today", "Last time", "Today", "Last time", "Today", "Last time"],
    );
    assert.ok(ui.find("dd").every((n) => /min-w-0 break-words/.test(n.props.className)));
    assert.ok(
      ui
        .find("p")
        .some(
          (n) =>
            String(n.props.children).includes("deliberately long") &&
            /break-words/.test(n.props.className),
        ),
    );
    assert.ok(
      ui
        .find("div")
        .some((n) => n.props.className?.includes("min-[375px]:grid-cols-[64px_minmax(0,1fr)]")),
    );
    assert.doesNotMatch(ui.text(), /Previous:|Use |Keep |3 sets|8–12 reps each/);
    assert.equal((ui.text().match(/3 × 8–12/g) ?? []).length, 3);
    assert.match(ui.find("ol")[0].props.className, /divide-y/);
    ui.button("Start workout").props.onClick();
    assert.deepEqual(starts, ["day"]);
  } finally {
    ui.dispose();
  }
});
