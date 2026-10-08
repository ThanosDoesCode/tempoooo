import type { PersonalRecord } from "./personal-records.ts";
import type { ProgressRange } from "./progress-period.ts";
import { strengthProgress } from "./strength-progress.ts";

/** Count configured lifts, not only those with comparable history in this period. */
export function trackedLiftSummary(
  records: PersonalRecord[],
  trackedNames: string[],
  range: ProgressRange,
) {
  const comparisons = [...new Set(trackedNames)].map((name) =>
    records
      .filter((record) => record.name === name)
      .map((record) => strengthProgress(record, range)),
  );
  return {
    total: comparisons.length,
    comparable: comparisons.filter((lifts) => lifts.some((lift) => lift.changeKg != null)).length,
    // Unilateral records can have two sides; each configured lift counts at most once.
    up: comparisons.filter((lifts) => lifts.some((lift) => lift.improved)).length,
  };
}

export type BodyweightTrend = {
  arrow: "↑" | "↓" | "→";
  tone: "positive" | "negative" | "neutral";
  label: string;
};

/** Use the existing average-weight delta unchanged; only interpret its direction and color. */
export function bodyweightTrend(
  delta: number | null | undefined,
  currentKg: number | null | undefined,
  goal: { startWeight?: number; targetWeight?: number; goal?: string | undefined },
): BodyweightTrend | undefined {
  if (delta == null || !Number.isFinite(delta)) return undefined;
  // The UI reports kg to one decimal: changes rounding to zero are neutral.
  if (Math.abs(delta) < 0.05)
    return { arrow: "→", tone: "neutral", label: "Weight effectively unchanged" };
  const arrow = delta > 0 ? "↑" : "↓";
  const movement = delta > 0 ? "Weight increased" : "Weight decreased";
  const { startWeight, targetWeight } = goal;
  if (
    goal.goal === "maintain" ||
    !startWeight ||
    !targetWeight ||
    startWeight === targetWeight ||
    currentKg == null ||
    !Number.isFinite(currentKg)
  )
    return { arrow, tone: "neutral", label: `${movement}; no directional goal` };
  const previousKg = currentKg - delta;
  const closer = Math.abs(targetWeight - currentKg) - Math.abs(targetWeight - previousKg);
  return {
    arrow,
    tone: closer < 0 ? "positive" : closer > 0 ? "negative" : "neutral",
    label: `${movement}; ${closer < 0 ? "toward goal" : closer > 0 ? "away from goal" : "unchanged distance to goal"}`,
  };
}
