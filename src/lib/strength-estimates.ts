import type { PersonalRecord } from "./personal-records.ts";
import { EXERCISES, orderedExerciseDefs, type AppData, type SplitType } from "./types.ts";
import type { UserTrainingPlan } from "./training-plans.ts";

/**
 * Default tracked lifts: the first exercise of each plan day (split), in the user's own order. This
 * is a derived default — the Strength screen lets the user override it, kept as a local preference.
 */
export function defaultTrackedLifts(data: AppData | UserTrainingPlan | null): string[] {
  const days =
    data && "days" in data && "id" in data
      ? [...data.days]
          .sort((a, b) => a.order - b.order)
          .map((day) =>
            [...day.exercises]
              .sort((a, b) => a.order - b.order)
              .filter((e) => !e.isBodyweight && e.repMin > 0 && e.repMax >= e.repMin)
              .map((e) => e.name),
          )
      : data && "targets" in data
        ? (Object.keys(EXERCISES) as SplitType[]).map((split) =>
            orderedExerciseDefs(data.targets, split)
              .filter((e) => e.loadKind !== "bodyweight")
              .map((e) => e.name),
          )
        : [];
  const names: string[] = [];
  for (const day of days) {
    const first = day.find((name) => !names.includes(name));
    if (first) names.push(first);
    if (names.length === 6) break;
  }
  return names;
}

export function trackedLiftCandidates(plan: UserTrainingPlan | null, records: PersonalRecord[]) {
  const fromPlan = [
    ...new Set(plan?.days.flatMap((day) => day.exercises.map((e) => e.name)) ?? []),
  ];
  const history = [
    ...new Set(
      records
        .filter((r) => r.performances.some((p) => p.load != null && p.load > 0))
        .map((r) => r.name),
    ),
  ].filter((name) => !fromPlan.includes(name));
  return { fromPlan, history };
}

export function resolveTrackedLifts(
  defaults: string[],
  override: string[] | null,
  available: string[],
) {
  return [...new Set(override ?? defaults)].filter((name) => available.includes(name));
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
