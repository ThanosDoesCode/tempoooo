import type { BulkProgressionResult, BulkProgressionTargetInput } from "./bulk-progression.ts";
import {
  buildBulkNextSessionGuidance,
  formatPreviousPerformance,
  perSetRepObjective,
} from "./bulk-next-session-guidance.ts";

const known = (value: number | null): value is number => value != null && Number.isFinite(value);
const load = (value: number, bodyweight: boolean) => `${bodyweight ? "+" : ""}${value} kg`;

/** Format the existing snapshot, without merging different sides or deriving new performances. */
function lastTime(result: BulkProgressionResult | null | undefined): string[] {
  const sets = result?.previousPerformance;
  if (!result || !sets?.length) return ["No previous session"];
  const show = (side?: "left" | "right") => {
    const projected = side
      ? sets.map((set) => ({
          ...set,
          bilateralLoad: set[`${side}Load`],
          bilateralReps: set[`${side}Reps`],
        }))
      : sets;
    const text = formatPreviousPerformance({
      ...result,
      executionMode: "bilateral",
      previousPerformance: projected,
    })!;
    const unweighted =
      result.isBodyweight &&
      projected.every((set) => set.bilateralLoad == null || set.bilateralLoad === 0);
    return `${text}${unweighted ? " reps" : ""}`;
  };
  if (result.executionMode === "bilateral") return [show()];
  const identical = sets.every(
    (set) =>
      known(set.leftLoad) &&
      known(set.rightLoad) &&
      known(set.leftReps) &&
      known(set.rightReps) &&
      set.leftLoad === set.rightLoad &&
      set.leftReps === set.rightReps,
  );
  return identical ? [`${show("left")} each side`] : [`L ${show("left")}`, `R ${show("right")}`];
}

/** Overview copy only. Decisions, loads and rep objectives come from the existing engine. */
export function workoutOverviewPresentation(
  result: BulkProgressionResult | null | undefined,
  prescription: BulkProgressionTargetInput,
) {
  const guidance = buildBulkNextSessionGuidance(result, prescription);
  const previous = lastTime(result);
  if (!result || result.dataStatus !== "usable" || result.decision === "insufficient_data")
    return {
      today: ["Follow the prescription"],
      lastTime: previous,
      note: null,
      reasonText: guidance.reasonText,
    };

  const buildingReps =
    result.decision === "maintain_load_increase_reps" || result.decision === "increase_reps";
  const objective = buildingReps ? perSetRepObjective(result) : null;
  const repText = objective?.join(" / ");
  let today: string[];
  if (result.decision === "add_load") {
    // Retain the existing guidance's added-load fallback too; do not invent another rule.
    today = [guidance.targetText.split(" · ")[0]!];
  } else if (result.executionMode === "unilateral") {
    const left = result.leftRecommendedLoad;
    const right = result.rightRecommendedLoad;
    if (known(left) && known(right) && left === right) {
      today =
        result.isBodyweight && left === 0
          ? [repText ? `${repText} reps each side` : "Bodyweight each side"]
          : [`${load(left, result.isBodyweight)} each side${repText ? ` · ${repText}` : ""}`];
    } else {
      today = [
        `L ${known(left) ? load(left, result.isBodyweight) : "Current load"}${repText ? ` · ${repText}` : ""}`,
        `R ${known(right) ? load(right, result.isBodyweight) : "Current load"}${repText ? ` · ${repText}` : ""}`,
      ];
    }
  } else if (
    result.isBodyweight &&
    (result.decision === "increase_reps" || result.recommendedLoad === 0)
  ) {
    today = [repText ? `${repText} reps` : "Bodyweight"];
  } else if (known(result.recommendedLoad)) {
    today = [
      `${load(result.recommendedLoad, result.isBodyweight)}${repText ? ` · ${repText}` : ""}`,
    ];
  } else {
    today = ["Follow the prescription"];
  }

  // Normally these match the single prescription above. Never conceal a different target.
  if (
    result.targetSets !== prescription.targetSets ||
    result.repTargetMin !== prescription.repMin ||
    result.repTargetMax !== prescription.repMax
  )
    today = today.map(
      (line) => `${line} · ${result.targetSets} × ${result.repTargetMin}–${result.repTargetMax}`,
    );

  return {
    today,
    lastTime: previous,
    note:
      buildingReps &&
      result.executionMode === "unilateral" &&
      result.weakerSide &&
      result.weakerSide !== "balanced"
        ? `Let the ${result.weakerSide} side set the pace.`
        : null,
    reasonText: guidance.reasonText,
  };
}
