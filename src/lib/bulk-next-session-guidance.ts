import type {
  BulkProgressionPreviousSet,
  BulkProgressionReason,
  BulkProgressionResult,
  BulkProgressionTargetInput,
} from "./bulk-progression";

export type BulkNextSessionGuidance = {
  headline: string;
  targetText: string;
  reasonText: string;
  previousPerformanceText: string | null;
  decision: BulkProgressionResult["decision"];
  weakerSide: BulkProgressionResult["weakerSide"];
  priority: "progress" | "rebuild" | "repeat" | "baseline";
};

const REASONS: Record<BulkProgressionReason, string> = {
  no_history: "No previous session yet. Start with the plan prescription.",
  ambiguous_exercise_identity: "No reliable previous target for this plan slot yet.",
  incompatible_history: "No compatible previous session yet. Use the plan target.",
  incomplete_planned_sets: "Repeat the target before progressing.",
  inconsistent_working_loads: "Use the current target again and build a consistent baseline.",
  rep_ceiling_reached: "You reached the top of the rep range. Increase the load next time.",
  build_reps: "Keep the same weight and aim to add reps.",
  repeated_below_rep_floor:
    "Your last two sessions stayed below the target range. Reduce the load slightly and rebuild.",
  weaker_side_below_ceiling: "Keep the load the same and let the weaker side catch up.",
  unequal_side_loads: "Keep each side at its current load and build reps.",
  bodyweight_build_reps: "Keep bodyweight the same and aim to add reps.",
  bodyweight_rep_ceiling: "You reached the top of the rep range across the planned sets.",
  weighted_bodyweight_ceiling:
    "You reached the top of the rep range with added weight. Increase it next time.",
};

const finite = (value: number | null | undefined): value is number =>
  value != null && Number.isFinite(value);

const kg = (value: number) => `${Number(value.toFixed(2))} kg`;
const externalKg = (value: number) => `+${kg(value)}`;
const planTarget = (target: Pick<BulkProgressionTargetInput, "targetSets" | "repMin" | "repMax">) =>
  `${target.targetSets} × ${target.repMin}–${target.repMax} reps`;

function reps(values: Array<number | null>) {
  return values.map((value) => (value == null ? "—" : value)).join(" / ");
}

function allSame(values: number[]) {
  return values.length > 0 && values.every((value) => value === values[0]);
}

function formatBilateralPrevious(sets: BulkProgressionPreviousSet[], bodyweight: boolean) {
  const repValues = sets.map((set) => set.bilateralReps);
  const loads = sets.map((set) => set.bilateralLoad).filter(finite);
  const unweighted =
    bodyweight && sets.every((set) => !finite(set.bilateralLoad) || set.bilateralLoad === 0);
  if (unweighted) return reps(repValues);
  if (loads.length === sets.length && allSame(loads)) {
    const load = bodyweight ? externalKg(loads[0]!) : kg(loads[0]!);
    return `${load} · ${reps(repValues)}`;
  }
  return sets
    .map((set) => {
      const load = finite(set.bilateralLoad)
        ? bodyweight
          ? externalKg(set.bilateralLoad)
          : kg(set.bilateralLoad)
        : "load —";
      return `${load} × ${set.bilateralReps ?? "—"}`;
    })
    .join(" / ");
}

function formatUnilateralSide(
  label: "Left" | "Right",
  sets: BulkProgressionPreviousSet[],
  bodyweight: boolean,
) {
  const loadKey = label === "Left" ? "leftLoad" : "rightLoad";
  const repKey = label === "Left" ? "leftReps" : "rightReps";
  const loads = sets.map((set) => set[loadKey]).filter(finite);
  const repValues = sets.map((set) => set[repKey]);
  const unweighted = bodyweight && sets.every((set) => !finite(set[loadKey]) || set[loadKey] === 0);
  if (unweighted) return `${label}: ${reps(repValues)}`;
  if (loads.length === sets.length && allSame(loads)) {
    const load = bodyweight ? externalKg(loads[0]!) : kg(loads[0]!);
    return `${label} ${load}: ${reps(repValues)}`;
  }
  return `${label}: ${sets
    .map((set) => {
      const load = set[loadKey];
      const shown = finite(load) ? (bodyweight ? externalKg(load) : kg(load)) : "load —";
      return `${shown} × ${set[repKey] ?? "—"}`;
    })
    .join(" / ")}`;
}

export function formatPreviousPerformance(result: BulkProgressionResult): string | null {
  const sets = result.previousPerformance;
  if (!sets?.length) return null;
  return result.executionMode === "unilateral"
    ? `${formatUnilateralSide("Left", sets, result.isBodyweight)} · ${formatUnilateralSide("Right", sets, result.isBodyweight)}`
    : formatBilateralPrevious(sets, result.isBodyweight);
}

function previousRepTotal(result: BulkProgressionResult) {
  const sets = result.previousPerformance ?? [];
  if (result.executionMode === "unilateral") {
    const left = sets.reduce((sum, set) => sum + (set.leftReps ?? 0), 0);
    const right = sets.reduce((sum, set) => sum + (set.rightReps ?? 0), 0);
    return Math.min(left, right);
  }
  return sets.reduce((sum, set) => sum + (set.bilateralReps ?? 0), 0);
}

export function sensibleRepObjective(result: BulkProgressionResult): number | null {
  if (!result.previousPerformance?.length) return null;
  const ceiling = result.targetSets * result.repTargetMax;
  const previous = previousRepTotal(result);
  if (!Number.isFinite(previous) || previous <= 0 || ceiling <= 0) return null;
  return Math.min(previous + 1, ceiling);
}

function repObjectiveText(result: BulkProgressionResult) {
  const objective = sensibleRepObjective(result) ?? result.targetTotalReps;
  if (!objective) return `build reps toward ${result.repTargetMax}`;
  const ceiling = result.targetSets * result.repTargetMax;
  return objective >= ceiling
    ? `aim for ${ceiling} total reps`
    : `aim for ${objective}+ total reps`;
}

function sideTargets(result: BulkProgressionResult, verb: "keep" | "use") {
  const left = result.leftRecommendedLoad;
  const right = result.rightRecommendedLoad;
  const show = (value: number) => (result.isBodyweight ? externalKg(value) : kg(value));
  if (finite(left) && finite(right) && left === right)
    return `${verb === "keep" ? "Keep" : "Use"} ${show(left)} each side`;
  return `Left: ${verb} ${finite(left) ? show(left) : "current load"} · Right: ${verb} ${finite(right) ? show(right) : "current load"}`;
}

function targetText(result: BulkProgressionResult) {
  const prescription = planTarget({
    targetSets: result.targetSets,
    repMin: result.repTargetMin,
    repMax: result.repTargetMax,
  });
  if (result.decision === "insufficient_data") return `Use the plan target · ${prescription}`;
  if (result.decision === "add_load")
    return `${externalKg(result.recommendedLoad ?? 2.5)} · ${prescription}`;
  if (result.decision === "increase_load") {
    if (result.executionMode === "unilateral")
      return `${sideTargets(result, "use")} · ${prescription}`;
    if (!finite(result.recommendedLoad)) return prescription;
    return `${result.isBodyweight ? externalKg(result.recommendedLoad) : kg(result.recommendedLoad)} · ${prescription}`;
  }
  if (result.decision === "reduce_load") {
    if (result.executionMode === "unilateral")
      return `${sideTargets(result, "use")} · rebuild inside ${result.repTargetMin}–${result.repTargetMax} reps`;
    if (!finite(result.recommendedLoad)) return `Repeat ${prescription}`;
    const load = result.isBodyweight
      ? externalKg(result.recommendedLoad)
      : kg(result.recommendedLoad);
    return `${load} · rebuild inside ${result.repTargetMin}–${result.repTargetMax} reps`;
  }
  if (result.decision === "repeat_target") {
    if (
      result.executionMode === "unilateral" &&
      (finite(result.leftRecommendedLoad) || finite(result.rightRecommendedLoad))
    )
      return `${sideTargets(result, "keep")} · repeat ${result.repTargetMin}–${result.repTargetMax} reps`;
    if (finite(result.recommendedLoad) && (!result.isBodyweight || result.recommendedLoad > 0))
      return `${result.isBodyweight ? externalKg(result.recommendedLoad) : kg(result.recommendedLoad)} · repeat ${result.repTargetMin}–${result.repTargetMax} reps`;
    return `Repeat ${prescription}`;
  }
  if (result.executionMode === "unilateral") {
    const sides = sideTargets(result, "keep");
    if (result.weakerSide && result.weakerSide !== "balanced")
      return `${sides} and bring the ${result.weakerSide} side closer to ${result.repTargetMax} reps`;
    return `${sides} and build reps`;
  }
  const objective = repObjectiveText(result);
  if (result.isBodyweight && (!finite(result.recommendedLoad) || result.recommendedLoad === 0))
    return objective[0]!.toUpperCase() + objective.slice(1);
  return `${finite(result.recommendedLoad) ? `${result.isBodyweight ? externalKg(result.recommendedLoad) : kg(result.recommendedLoad)} · ` : ""}${objective}`;
}

const headline = (result: BulkProgressionResult) => {
  if (result.decision === "increase_load" || result.decision === "add_load") return "Increase load";
  if (result.decision === "reduce_load") return "Rebuild in range";
  if (result.decision === "repeat_target") return "Repeat target";
  if (result.decision === "insufficient_data")
    return result.reasonCode === "no_history" ? "First session" : "Use plan target";
  return "Build reps";
};

export function buildBulkNextSessionGuidance(
  result: BulkProgressionResult | null | undefined,
  fallback: BulkProgressionTargetInput,
): BulkNextSessionGuidance {
  if (!result)
    return {
      headline: "Plan target",
      targetText: planTarget(fallback),
      reasonText: "Progression guidance is unavailable. Use the current plan prescription.",
      previousPerformanceText: null,
      decision: "insufficient_data",
      weakerSide: null,
      priority: "baseline",
    };
  return {
    headline: headline(result),
    targetText: targetText(result),
    reasonText: REASONS[result.reasonCode],
    previousPerformanceText: formatPreviousPerformance(result),
    decision: result.decision,
    weakerSide: result.weakerSide,
    priority:
      result.decision === "reduce_load"
        ? "rebuild"
        : result.decision === "repeat_target"
          ? "repeat"
          : result.decision === "insufficient_data"
            ? "baseline"
            : "progress",
  };
}
