import type {
  BulkSetType,
  BulkTrainingSession,
  BulkTrainingSessionExercise,
  BulkTrainingSet,
} from "./bulk-training-session-domain.ts";

export const PUBLIC_BULK_LOAD_INCREMENT_KG = 2.5;

export type BulkProgressionDecision =
  | "increase_load"
  | "maintain_load_increase_reps"
  | "reduce_load"
  | "increase_reps"
  | "add_load"
  | "repeat_target"
  | "insufficient_data";

export type BulkProgressionReason =
  | "no_history"
  | "ambiguous_exercise_identity"
  | "incompatible_history"
  | "incomplete_planned_sets"
  | "inconsistent_working_loads"
  | "rep_ceiling_reached"
  | "build_reps"
  | "repeated_below_rep_floor"
  | "weaker_side_below_ceiling"
  | "unequal_side_loads"
  | "bodyweight_build_reps"
  | "bodyweight_rep_ceiling"
  | "weighted_bodyweight_ceiling";

export type BulkProgressionTargetInput = {
  planExerciseId: string;
  exerciseId: string | null;
  executionMode: "bilateral" | "unilateral";
  isBodyweight: boolean;
  targetSets: number;
  repMin: number;
  repMax: number;
};

export type BulkProgressionPreviousSet = {
  setType: BulkSetType;
  bilateralLoad: number | null;
  bilateralReps: number | null;
  leftLoad: number | null;
  leftReps: number | null;
  rightLoad: number | null;
  rightReps: number | null;
};

export type BulkProgressionPreviousBySetType = Record<BulkSetType, BulkProgressionPreviousSet[]>;

export type BulkProgressionResult = {
  planExerciseId: string;
  exerciseId: string | null;
  executionMode: "bilateral" | "unilateral";
  isBodyweight: boolean;
  sourceSessionId: string | null;
  decision: BulkProgressionDecision;
  reasonCode: BulkProgressionReason;
  currentLoad: number | null;
  recommendedLoad: number | null;
  leftCurrentLoad: number | null;
  rightCurrentLoad: number | null;
  leftRecommendedLoad: number | null;
  rightRecommendedLoad: number | null;
  targetSets: number;
  repTargetMin: number;
  repTargetMax: number;
  targetTotalReps: number | null;
  weakerSide: "left" | "right" | "balanced" | null;
  dataStatus: "none" | "partial" | "usable";
  previousPerformance: BulkProgressionPreviousSet[] | null;
  previousBySetType: BulkProgressionPreviousBySetType;
};

type Occurrence = {
  sessionId: string;
  completedAt: string;
  exercise: BulkTrainingSessionExercise;
};

const empty = (
  target: BulkProgressionTargetInput,
  reasonCode: BulkProgressionReason,
): BulkProgressionResult => ({
  planExerciseId: target.planExerciseId,
  exerciseId: target.exerciseId,
  executionMode: target.executionMode,
  isBodyweight: target.isBodyweight,
  sourceSessionId: null,
  decision: "insufficient_data",
  reasonCode,
  currentLoad: null,
  recommendedLoad: null,
  leftCurrentLoad: null,
  rightCurrentLoad: null,
  leftRecommendedLoad: null,
  rightRecommendedLoad: null,
  targetSets: target.targetSets,
  repTargetMin: target.repMin,
  repTargetMax: target.repMax,
  targetTotalReps: null,
  weakerSide: null,
  dataStatus: "none",
  previousPerformance: null,
  previousBySetType: {
    warmup: [],
    normal: [],
    failure: [],
    drop: [],
  },
});

export function practicalLoad(value: number) {
  return Math.max(
    0,
    Math.round((value + Number.EPSILON) / PUBLIC_BULK_LOAD_INCREMENT_KG) *
      PUBLIC_BULK_LOAD_INCREMENT_KG,
  );
}

function median(values: number[]) {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle]! : (sorted[middle - 1]! + sorted[middle]!) / 2;
}

const persistedSetType = (set: BulkTrainingSet): BulkSetType => set.setType ?? "normal";

// Plan progression is based on the prescribed normal working sets. Special set
// types remain in history and can be shown under Previous, but they must not
// displace or inflate the working-set progression target.
const plannedWorkingSets = (exercise: BulkTrainingSessionExercise) =>
  exercise.sets
    .filter((set) => !set.isExtra && persistedSetType(set) === "normal")
    .slice(0, exercise.targetSets);

const toPreviousSet = (set: BulkTrainingSet): BulkProgressionPreviousSet => ({
  setType: persistedSetType(set),
  bilateralLoad: set.bilateralWeight,
  bilateralReps: set.bilateralReps,
  leftLoad: set.leftWeight,
  leftReps: set.leftReps,
  rightLoad: set.rightWeight,
  rightReps: set.rightReps,
});

const previousPerformance = (exercise: BulkTrainingSessionExercise): BulkProgressionPreviousSet[] =>
  plannedWorkingSets(exercise).map(toPreviousSet);

const SET_TYPES: BulkSetType[] = ["warmup", "normal", "failure", "drop"];

function previousBySetType(history: Occurrence[]): BulkProgressionPreviousBySetType {
  return Object.fromEntries(
    SET_TYPES.map((setType) => {
      const latestCompatible = history.find((item) =>
        item.exercise.sets.some((set) => set.isComplete && persistedSetType(set) === setType),
      );
      const sets = latestCompatible
        ? latestCompatible.exercise.sets
            .filter((set) => set.isComplete && persistedSetType(set) === setType)
            .sort((a, b) => a.order - b.order)
            .map(toPreviousSet)
        : [];
      return [setType, sets];
    }),
  ) as BulkProgressionPreviousBySetType;
}

export function previousPerformanceForActiveSet(
  result: BulkProgressionResult | null | undefined,
  currentSetTypes: BulkSetType[],
  setIndex: number,
) {
  const setType = currentSetTypes[setIndex];
  if (!setType) return undefined;
  const typeIndex = currentSetTypes
    .slice(0, setIndex)
    .filter((candidate) => candidate === setType).length;
  return result?.previousBySetType[setType]?.[typeIndex];
}

function validWeight(value: number | null) {
  return value != null && Number.isFinite(value) && value >= 0 && value <= 1000;
}

function validRep(value: number | null) {
  return value != null && Number.isInteger(value) && value > 0 && value <= 1000;
}

function consistent(values: number[]) {
  return values.length > 0 && Math.max(...values) - Math.min(...values) < 0.001;
}

function weightableBodyweight(exerciseId: string | null) {
  return !!exerciseId && /(?:pull-up|chin-up|dip)$/.test(exerciseId);
}

function occurrenceList(sessions: BulkTrainingSession[]): Occurrence[] {
  return sessions
    .filter((session) => session.status === "completed" && !!session.completedAt)
    .flatMap((session) =>
      session.exercises.map((exercise) => ({
        sessionId: session.id,
        completedAt: session.completedAt!,
        exercise,
      })),
    )
    .sort((a, b) => b.completedAt.localeCompare(a.completedAt));
}

function selectHistory(
  target: BulkProgressionTargetInput,
  targets: BulkProgressionTargetInput[],
  occurrences: Occurrence[],
) {
  if (!target.exerciseId) return { history: [] as Occurrence[], reason: "no_history" as const };
  const compatible = occurrences.filter(
    (item) =>
      item.exercise.sourceExerciseId === target.exerciseId &&
      item.exercise.executionMode === target.executionMode &&
      item.exercise.isBodyweight === target.isBodyweight,
  );
  const exact = compatible.filter(
    (item) => item.exercise.sourcePlanExerciseId === target.planExerciseId,
  );
  if (exact.length) return { history: exact, reason: null };
  const sameActiveIdentity = targets.filter(
    (item) => item.exerciseId === target.exerciseId && item.executionMode === target.executionMode,
  ).length;
  if (sameActiveIdentity > 1)
    return { history: [] as Occurrence[], reason: "ambiguous_exercise_identity" as const };
  if (!compatible.length) {
    const incompatibleExists = occurrences.some(
      (item) => item.exercise.sourceExerciseId === target.exerciseId,
    );
    return {
      history: [] as Occurrence[],
      reason: incompatibleExists ? ("incompatible_history" as const) : ("no_history" as const),
    };
  }
  return { history: compatible, reason: null };
}

function commonResult(
  target: BulkProgressionTargetInput,
  occurrence: Occurrence,
  allHistory: Occurrence[],
): BulkProgressionResult {
  return {
    ...empty(target, "build_reps"),
    sourceSessionId: occurrence.sessionId,
    dataStatus: "usable",
    previousPerformance: previousPerformance(occurrence.exercise),
    previousBySetType: previousBySetType(allHistory),
  };
}

function severeBilateral(
  occurrence: Occurrence,
  target: BulkProgressionTargetInput,
  weightedPhase: boolean,
) {
  const sets = plannedWorkingSets(occurrence.exercise);
  if (sets.length < target.targetSets) return false;
  return sets.every((set) => {
    if (!set.isComplete) return false;
    if (!validRep(set.bilateralReps)) return false;
    if (!target.isBodyweight)
      return validWeight(set.bilateralWeight) && set.bilateralReps! <= target.repMin - 3;
    const isWeighted = validWeight(set.bilateralWeight) && set.bilateralWeight! > 0;
    return isWeighted === weightedPhase && set.bilateralReps! <= target.repMin - 3;
  });
}

function bilateral(
  target: BulkProgressionTargetInput,
  allHistory: Occurrence[],
): BulkProgressionResult {
  const history = allHistory.filter((item) => plannedWorkingSets(item.exercise).length > 0);
  if (!history.length)
    return {
      ...empty(target, "incomplete_planned_sets"),
      decision: "repeat_target",
      dataStatus: "partial",
      previousBySetType: previousBySetType(allHistory),
    };
  const latest = history[0]!;
  const sets = plannedWorkingSets(latest.exercise);
  const base = commonResult(target, latest, allHistory);
  if (
    sets.length < target.targetSets ||
    sets.some((set) => !set.isComplete || !validRep(set.bilateralReps))
  )
    return {
      ...base,
      decision: "repeat_target",
      reasonCode: "incomplete_planned_sets",
      dataStatus: "partial",
    };

  const hasAddedLoad = target.isBodyweight && sets.some((set) => (set.bilateralWeight ?? 0) > 0);
  if (target.isBodyweight && !hasAddedLoad) {
    const allUnweighted = sets.every(
      (set) => set.bilateralWeight == null || set.bilateralWeight === 0,
    );
    if (!allUnweighted)
      return { ...base, decision: "repeat_target", reasonCode: "inconsistent_working_loads" };
    const reps = sets.map((set) => set.bilateralReps!);
    const atCeiling = reps.every((rep) => rep >= target.repMax);
    return {
      ...base,
      decision: atCeiling && weightableBodyweight(target.exerciseId) ? "add_load" : "increase_reps",
      reasonCode: atCeiling ? "bodyweight_rep_ceiling" : "bodyweight_build_reps",
      currentLoad: 0,
      recommendedLoad:
        atCeiling && weightableBodyweight(target.exerciseId) ? PUBLIC_BULK_LOAD_INCREMENT_KG : 0,
      targetTotalReps: atCeiling
        ? target.targetSets * target.repMax
        : reps.reduce((a, b) => a + b, 0) + 1,
    };
  }

  const weights = sets.map((set) => set.bilateralWeight).filter(validWeight) as number[];
  if (weights.length < target.targetSets)
    return {
      ...base,
      decision: "repeat_target",
      reasonCode: "incomplete_planned_sets",
      dataStatus: "partial",
    };
  const load = practicalLoad(median(weights));
  const allAtCeiling = sets.every((set) => set.bilateralReps! >= target.repMax);
  if (allAtCeiling && consistent(weights))
    return {
      ...base,
      decision: "increase_load",
      reasonCode: target.isBodyweight ? "weighted_bodyweight_ceiling" : "rep_ceiling_reached",
      currentLoad: load,
      recommendedLoad: practicalLoad(load + PUBLIC_BULK_LOAD_INCREMENT_KG),
    };
  const compatiblePhase = history.filter((item) =>
    target.isBodyweight
      ? plannedWorkingSets(item.exercise).some((set) => (set.bilateralWeight ?? 0) > 0)
      : true,
  );
  if (
    compatiblePhase.length >= 2 &&
    compatiblePhase.slice(0, 2).every((item) => severeBilateral(item, target, target.isBodyweight))
  )
    return {
      ...base,
      decision: "reduce_load",
      reasonCode: "repeated_below_rep_floor",
      currentLoad: load,
      recommendedLoad: practicalLoad(load - PUBLIC_BULK_LOAD_INCREMENT_KG),
    };
  return {
    ...base,
    decision: "maintain_load_increase_reps",
    reasonCode: consistent(weights) ? "build_reps" : "inconsistent_working_loads",
    currentLoad: load,
    recommendedLoad: load,
  };
}

function sideSummary(sets: BulkTrainingSet[], side: "left" | "right") {
  const reps = sets.map((set) => (side === "left" ? set.leftReps : set.rightReps));
  const weights = sets.map((set) => (side === "left" ? set.leftWeight : set.rightWeight));
  const validReps = reps.filter(validRep) as number[];
  const validWeights = weights.filter(validWeight) as number[];
  return {
    complete: validReps.length,
    totalReps: validReps.reduce((sum, rep) => sum + rep, 0),
    load: validWeights.length ? practicalLoad(median(validWeights)) : null,
    consistentLoad: validWeights.length === sets.length && consistent(validWeights),
    atCeiling: validReps.length === sets.length,
    reps,
  };
}

export function weakerSideFor(sets: BulkTrainingSet[]): "left" | "right" | "balanced" {
  const left = sideSummary(sets, "left");
  const right = sideSummary(sets, "right");
  if (left.complete !== right.complete) return left.complete < right.complete ? "left" : "right";
  if (left.totalReps !== right.totalReps)
    return left.totalReps < right.totalReps ? "left" : "right";
  if (left.load !== right.load) return (left.load ?? 0) < (right.load ?? 0) ? "left" : "right";
  return "balanced";
}

function severeUnilateral(occurrence: Occurrence, target: BulkProgressionTargetInput) {
  const sets = plannedWorkingSets(occurrence.exercise);
  if (sets.length < target.targetSets) return false;
  return sets.every(
    (set) =>
      set.isComplete &&
      validRep(set.leftReps) &&
      validRep(set.rightReps) &&
      set.leftReps! <= target.repMin - 3 &&
      set.rightReps! <= target.repMin - 3,
  );
}

function unilateral(
  target: BulkProgressionTargetInput,
  allHistory: Occurrence[],
): BulkProgressionResult {
  const history = allHistory.filter((item) => plannedWorkingSets(item.exercise).length > 0);
  if (!history.length)
    return {
      ...empty(target, "incomplete_planned_sets"),
      decision: "repeat_target",
      dataStatus: "partial",
      previousBySetType: previousBySetType(allHistory),
    };
  const latest = history[0]!;
  const sets = plannedWorkingSets(latest.exercise);
  const base = commonResult(target, latest, allHistory);
  const weakerSide = weakerSideFor(sets);
  if (
    sets.length < target.targetSets ||
    sets.some((set) => !set.isComplete || !validRep(set.leftReps) || !validRep(set.rightReps))
  )
    return {
      ...base,
      decision: "repeat_target",
      reasonCode: "incomplete_planned_sets",
      weakerSide,
      dataStatus: "partial",
    };
  const left = sideSummary(sets, "left");
  const right = sideSummary(sets, "right");
  if (!target.isBodyweight && (!left.consistentLoad || !right.consistentLoad))
    return {
      ...base,
      decision: "maintain_load_increase_reps",
      reasonCode: "inconsistent_working_loads",
      leftCurrentLoad: left.load,
      rightCurrentLoad: right.load,
      leftRecommendedLoad: left.load,
      rightRecommendedLoad: right.load,
      weakerSide,
    };
  const bothAtCeiling = sets.every(
    (set) => set.leftReps! >= target.repMax && set.rightReps! >= target.repMax,
  );
  const equalLoads = left.load === right.load;
  if (bothAtCeiling && equalLoads && (target.isBodyweight || left.load != null)) {
    const load = left.load ?? 0;
    return {
      ...base,
      decision: target.isBodyweight && load === 0 ? "increase_reps" : "increase_load",
      reasonCode:
        target.isBodyweight && load === 0
          ? "bodyweight_rep_ceiling"
          : target.isBodyweight
            ? "weighted_bodyweight_ceiling"
            : "rep_ceiling_reached",
      currentLoad: load,
      recommendedLoad:
        target.isBodyweight && load === 0 ? 0 : practicalLoad(load + PUBLIC_BULK_LOAD_INCREMENT_KG),
      leftCurrentLoad: left.load,
      rightCurrentLoad: right.load,
      leftRecommendedLoad:
        left.load == null ? null : practicalLoad(left.load + PUBLIC_BULK_LOAD_INCREMENT_KG),
      rightRecommendedLoad:
        right.load == null ? null : practicalLoad(right.load + PUBLIC_BULK_LOAD_INCREMENT_KG),
      weakerSide,
    };
  }
  if (history.length >= 2 && history.slice(0, 2).every((item) => severeUnilateral(item, target))) {
    return {
      ...base,
      decision: "reduce_load",
      reasonCode: "repeated_below_rep_floor",
      leftCurrentLoad: left.load,
      rightCurrentLoad: right.load,
      leftRecommendedLoad:
        left.load == null ? null : practicalLoad(left.load - PUBLIC_BULK_LOAD_INCREMENT_KG),
      rightRecommendedLoad:
        right.load == null ? null : practicalLoad(right.load - PUBLIC_BULK_LOAD_INCREMENT_KG),
      weakerSide,
    };
  }
  return {
    ...base,
    decision: "maintain_load_increase_reps",
    reasonCode: equalLoads ? "weaker_side_below_ceiling" : "unequal_side_loads",
    currentLoad: equalLoads ? left.load : null,
    recommendedLoad: equalLoads ? left.load : null,
    leftCurrentLoad: left.load,
    rightCurrentLoad: right.load,
    leftRecommendedLoad: left.load,
    rightRecommendedLoad: right.load,
    weakerSide,
  };
}

export function deriveBulkProgressionTargets(
  targets: BulkProgressionTargetInput[],
  sessions: BulkTrainingSession[],
) {
  const occurrences = occurrenceList(sessions);
  return Object.fromEntries(
    targets.map((target) => {
      const selected = selectHistory(target, targets, occurrences);
      const result = selected.reason
        ? empty(target, selected.reason)
        : target.executionMode === "unilateral"
          ? unilateral(target, selected.history)
          : bilateral(target, selected.history);
      return [target.planExerciseId, result];
    }),
  ) as Record<string, BulkProgressionResult>;
}
