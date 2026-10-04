import type { PersonalRecord } from "./personal-records.ts";
import { EXERCISES, orderedExerciseDefs, type AppData, type SplitType } from "./types.ts";

/**
 * Default tracked lifts: the first exercise of each plan day (split), in the user's own order. This
 * is a derived default — the Strength screen lets the user override it, kept as a local preference.
 */
export function defaultTrackedLifts(data: AppData): string[] {
  return (Object.keys(EXERCISES) as SplitType[]).flatMap((split) => {
    const first = orderedExerciseDefs(data.targets, split)[0];
    return first ? [first.name] : [];
  });
}

export type EstimatedMaxPoint = { date: string; value: number; load: number; reps: number };

export type LiftEstimate = {
  record: PersonalRecord;
  /** Per-session estimated max, oldest first. Empty when no set has a logged load. */
  series: EstimatedMaxPoint[];
  current: number | null;
  /** The first estimate on/after the baseline date (plan start), else the earliest estimate. */
  baseline: number | null;
  baselineDate: string | null;
  changeKg: number | null;
  changePct: number | null;
  trend: "up" | "flat" | "down" | "insufficient";
};

/**
 * Epley one-rep-max estimate from a single set. This is a Progress *visualization* only — it does
 * not touch the authoritative PR/volume logic in personal-records / training.
 */
export const epleyEstimatedMax = (load: number, reps: number) => load * (1 + reps / 30);

/**
 * Per-session estimated max for one lift, using the best (heaviest) qualifying set already chosen
 * per session by `deriveLegacyPersonalRecords`. Bodyweight-only sessions (no logged load) are
 * skipped rather than invented, so a lift with no external load reports `insufficient`.
 */
export function liftEstimate(record: PersonalRecord, baselineDate?: string | null): LiftEstimate {
  const series: EstimatedMaxPoint[] = record.performances
    .filter((performance) => performance.load != null && performance.load > 0)
    .map((performance) => ({
      date: performance.date,
      load: performance.load as number,
      reps: performance.reps,
      value: epleyEstimatedMax(performance.load as number, performance.reps),
    }))
    .sort((a, b) => a.date.localeCompare(b.date));

  if (series.length === 0) {
    return {
      record,
      series,
      current: null,
      baseline: null,
      baselineDate: null,
      changeKg: null,
      changePct: null,
      trend: "insufficient",
    };
  }

  const current = series[series.length - 1]!.value;
  const basePoint =
    (baselineDate ? series.find((point) => point.date >= baselineDate) : undefined) ?? series[0]!;
  const baseline = basePoint.value;
  const changeKg = series.length >= 2 ? current - baseline : null;
  const changePct = changeKg != null && baseline > 0 ? (changeKg / baseline) * 100 : null;
  const trend: LiftEstimate["trend"] =
    changePct == null ? "insufficient" : changePct > 1 ? "up" : changePct < -1 ? "down" : "flat";

  return {
    record,
    series,
    current,
    baseline,
    baselineDate: basePoint.date,
    changeKg,
    changePct,
    trend,
  };
}
