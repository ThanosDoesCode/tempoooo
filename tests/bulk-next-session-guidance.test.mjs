import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  buildBulkNextSessionGuidance,
  formatPreviousPerformance,
  sensibleRepObjective,
} from "../src/lib/bulk-next-session-guidance.ts";
import { deriveBulkProgressionTargets } from "../src/lib/bulk-progression.ts";

const target = (overrides = {}) => ({
  planExerciseId: "plan-exercise",
  exerciseId: "system:bench-press",
  executionMode: "bilateral",
  isBodyweight: false,
  targetSets: 3,
  repMin: 8,
  repMax: 12,
  ...overrides,
});

const previousSet = (overrides = {}) => ({
  bilateralLoad: 22.5,
  bilateralReps: 10,
  leftLoad: null,
  leftReps: null,
  rightLoad: null,
  rightReps: null,
  ...overrides,
});

const result = (overrides = {}) => ({
  planExerciseId: "plan-exercise",
  exerciseId: "system:bench-press",
  executionMode: "bilateral",
  isBodyweight: false,
  sourceSessionId: "previous-session",
  decision: "maintain_load_increase_reps",
  reasonCode: "build_reps",
  currentLoad: 22.5,
  recommendedLoad: 22.5,
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
  previousPerformance: [
    previousSet({ bilateralReps: 12 }),
    previousSet({ bilateralReps: 11 }),
    previousSet({ bilateralReps: 10 }),
  ],
  ...overrides,
});

test("increase-load guidance formats the next practical load and current prescription", () => {
  const guidance = buildBulkNextSessionGuidance(
    result({ decision: "increase_load", reasonCode: "rep_ceiling_reached", recommendedLoad: 25 }),
    target(),
  );
  assert.equal(guidance.headline, "Increase load");
  assert.equal(guidance.targetText, "25 kg · 3 × 8–12 reps");
  assert.match(guidance.reasonText, /top of the rep range/i);
});

test("rep guidance advances total reps without exceeding the current plan ceiling", () => {
  const build = result();
  assert.equal(sensibleRepObjective(build), 34);
  assert.match(buildBulkNextSessionGuidance(build, target()).targetText, /34\+ total reps/);
  const nearCeiling = result({
    previousPerformance: [
      previousSet({ bilateralReps: 12 }),
      previousSet({ bilateralReps: 12 }),
      previousSet({ bilateralReps: 11 }),
    ],
  });
  assert.equal(sensibleRepObjective(nearCeiling), 36);
  assert.match(buildBulkNextSessionGuidance(nearCeiling, target()).targetText, /36 total reps/);
  assert.doesNotMatch(buildBulkNextSessionGuidance(nearCeiling, target()).targetText, /37/);
});

test("reduction and repeat guidance are neutral and preserve the plan range", () => {
  const reduction = buildBulkNextSessionGuidance(
    result({
      decision: "reduce_load",
      reasonCode: "repeated_below_rep_floor",
      recommendedLoad: 20,
    }),
    target(),
  );
  assert.equal(reduction.targetText, "20 kg · rebuild inside 8–12 reps");
  assert.match(reduction.reasonText, /last two sessions stayed below/);
  assert.doesNotMatch(reduction.reasonText, /fail|bad|poor/i);
  const repeat = buildBulkNextSessionGuidance(
    result({ decision: "repeat_target", reasonCode: "incomplete_planned_sets" }),
    target(),
  );
  assert.match(repeat.targetText, /repeat/i);
  assert.equal(repeat.reasonText, "Repeat the target before progressing.");
});

test("first, incompatible, ambiguous and unavailable history use neutral plan guidance", () => {
  for (const reasonCode of ["no_history", "incompatible_history", "ambiguous_exercise_identity"]) {
    const guidance = buildBulkNextSessionGuidance(
      result({
        decision: "insufficient_data",
        reasonCode,
        sourceSessionId: null,
        previousPerformance: null,
        dataStatus: "none",
      }),
      target(),
    );
    assert.equal(guidance.targetText, "Use the plan target · 3 × 8–12 reps");
    assert.equal(guidance.previousPerformanceText, null);
    assert.doesNotMatch(guidance.reasonText, /error|failed/i);
  }
  const unavailable = buildBulkNextSessionGuidance(undefined, target({ repMin: 6, repMax: 10 }));
  assert.equal(unavailable.targetText, "3 × 6–10 reps");
  assert.equal(unavailable.priority, "baseline");
});

test("bilateral previous performance represents stable and variable working loads", () => {
  assert.equal(formatPreviousPerformance(result()), "22.5 kg · 12 / 11 / 10");
  const variable = result({
    previousPerformance: [
      previousSet({ bilateralLoad: 20, bilateralReps: 12 }),
      previousSet({ bilateralLoad: 22.5, bilateralReps: 10 }),
      previousSet({ bilateralLoad: 25, bilateralReps: 8 }),
    ],
  });
  assert.equal(formatPreviousPerformance(variable), "20 kg × 12 / 22.5 kg × 10 / 25 kg × 8");
});

test("unilateral guidance keeps sides separate and names the weaker side", () => {
  const unilateral = (weakerSide, left = 10, right = 10) =>
    result({
      executionMode: "unilateral",
      reasonCode: left === right ? "weaker_side_below_ceiling" : "unequal_side_loads",
      currentLoad: left === right ? left : null,
      recommendedLoad: left === right ? left : null,
      leftCurrentLoad: left,
      rightCurrentLoad: right,
      leftRecommendedLoad: left,
      rightRecommendedLoad: right,
      weakerSide,
      previousPerformance: [
        previousSet({
          bilateralLoad: null,
          bilateralReps: null,
          leftLoad: left,
          leftReps: weakerSide === "left" ? 9 : 12,
          rightLoad: right,
          rightReps: weakerSide === "right" ? 9 : 12,
        }),
        previousSet({
          bilateralLoad: null,
          bilateralReps: null,
          leftLoad: left,
          leftReps: weakerSide === "left" ? 10 : 12,
          rightLoad: right,
          rightReps: weakerSide === "right" ? 10 : 12,
        }),
        previousSet({
          bilateralLoad: null,
          bilateralReps: null,
          leftLoad: left,
          leftReps: 12,
          rightLoad: right,
          rightReps: 12,
        }),
      ],
    });

  const right = buildBulkNextSessionGuidance(unilateral("right"), target());
  assert.match(right.previousPerformanceText, /Left 10 kg: 12 \/ 12 \/ 12/);
  assert.match(right.previousPerformanceText, /Right 10 kg: 9 \/ 10 \/ 12/);
  assert.match(right.targetText, /right side/);

  const left = buildBulkNextSessionGuidance(unilateral("left"), target());
  assert.match(left.targetText, /left side/);

  const balanced = buildBulkNextSessionGuidance(unilateral("balanced"), target());
  assert.doesNotMatch(balanced.targetText, /weaker|catch up|left side|right side/i);

  const unequal = buildBulkNextSessionGuidance(unilateral("left", 10, 12.5), target());
  assert.match(unequal.targetText, /Left: keep 10 kg/);
  assert.match(unequal.targetText, /Right: keep 12.5 kg/);
});

test("bodyweight guidance shows reps or external load without fake body mass", () => {
  const bodyweight = result({
    exerciseId: "system:pull-up",
    isBodyweight: true,
    decision: "increase_reps",
    reasonCode: "bodyweight_build_reps",
    currentLoad: 0,
    recommendedLoad: 0,
    repTargetMin: 6,
    repTargetMax: 10,
    previousPerformance: [
      previousSet({ bilateralLoad: null, bilateralReps: 10 }),
      previousSet({ bilateralLoad: null, bilateralReps: 9 }),
      previousSet({ bilateralLoad: null, bilateralReps: 8 }),
    ],
  });
  const repsGuidance = buildBulkNextSessionGuidance(bodyweight, target());
  assert.equal(repsGuidance.previousPerformanceText, "10 / 9 / 8");
  assert.match(repsGuidance.targetText, /28\+ total reps/);
  assert.doesNotMatch(`${repsGuidance.targetText} ${repsGuidance.previousPerformanceText}`, /0 kg/);

  const add = buildBulkNextSessionGuidance(
    {
      ...bodyweight,
      decision: "add_load",
      reasonCode: "bodyweight_rep_ceiling",
      recommendedLoad: 2.5,
    },
    target(),
  );
  assert.match(add.targetText, /^\+2\.5 kg/);

  const weighted = buildBulkNextSessionGuidance(
    {
      ...bodyweight,
      decision: "increase_load",
      reasonCode: "weighted_bodyweight_ceiling",
      currentLoad: 10,
      recommendedLoad: 12.5,
      previousPerformance: bodyweight.previousPerformance.map((set) => ({
        ...set,
        bilateralLoad: 10,
      })),
    },
    target(),
  );
  assert.match(weighted.previousPerformanceText, /^\+10 kg/);
  assert.match(weighted.targetText, /^\+12\.5 kg/);
  assert.doesNotMatch(weighted.targetText, /body ?mass|total load/i);
});

test("progression snapshots only planned sets so extras cannot inflate guidance", () => {
  const set = (order, reps, isExtra = false) => ({
    id: `set-${order}`,
    order,
    isExtra,
    isComplete: true,
    bilateralWeight: 20,
    bilateralReps: reps,
    leftWeight: null,
    leftReps: null,
    rightWeight: null,
    rightReps: null,
  });
  const session = {
    id: "session",
    bulkProfileId: "bulk",
    trainingPlanId: "plan",
    planName: "Plan",
    workoutDayName: "Day",
    workoutDayOrder: 1,
    status: "completed",
    startedAt: "2026-09-05T10:00:00Z",
    completedAt: "2026-09-05T11:00:00Z",
    updatedAt: "2026-09-05T11:00:00Z",
    exercises: [
      {
        id: "exercise",
        sourcePlanExerciseId: "plan-exercise",
        sourceExerciseId: "system:bench-press",
        name: "Bench Press",
        order: 1,
        executionMode: "bilateral",
        isBodyweight: false,
        targetSets: 3,
        targetRepMin: 8,
        targetRepMax: 12,
        notes: null,
        sets: [set(1, 10), set(2, 10), set(3, 9), set(4, 100, true)],
      },
    ],
  };
  const derived = deriveBulkProgressionTargets([target()], [session])["plan-exercise"];
  assert.equal(derived.previousPerformance.length, 3);
  assert.equal(sensibleRepObjective(derived), 30);
});

test("current plan range controls guidance after an edit", () => {
  const edited = result({ targetSets: 4, repTargetMin: 5, repTargetMax: 8 });
  const guidance = buildBulkNextSessionGuidance(edited, target());
  assert.match(guidance.targetText, /32 total reps/);
  assert.doesNotMatch(guidance.targetText, /8–12/);
});

test("guidance formatting does not mutate progression or session history", () => {
  const progression = result();
  const before = structuredClone(progression);
  buildBulkNextSessionGuidance(progression, target());
  assert.deepEqual(progression, before);

  const source = [{ ...previousSet() }];
  const sourceBefore = structuredClone(source);
  formatPreviousPerformance(result({ previousPerformance: source }));
  assert.deepEqual(source, sourceBefore);
});

test("overview and active workout render guidance from the one batched progression query", async () => {
  const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");
  const [overview, workout, query, sessions] = await Promise.all([
    read("src/components/TrainingPlanSetup.tsx"),
    read("src/components/BulkWorkoutSession.tsx"),
    read("src/lib/bulk-progression-query.ts"),
    read("src/lib/bulk-training-sessions.ts"),
  ]);
  assert.match(overview, /buildBulkNextSessionGuidance/);
  assert.match(overview, /Next:/);
  assert.match(workout, /Last time:/);
  assert.match(workout, /Target today:/);
  assert.match(workout, /Progression guidance is unavailable|buildBulkNextSessionGuidance/);
  assert.match(query, /fetchRecentCompletedBulkTrainingSessions\(bulkProfileId, 30\)/);
  assert.doesNotMatch(query, /forEach[\s\S]*fetchRecentCompletedBulkTrainingSessions/);
  assert.match(sessions, /\.in\("session_id", sessionIds\)/);
  assert.match(sessions, /\.in\("session_exercise_id", exerciseIds\)/);
});
