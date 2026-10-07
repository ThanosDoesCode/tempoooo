import {
  mergePersonalRecords,
  personalRecordImprovements,
  type PersonalRecord,
  type RecordPerformance,
} from "./personal-records.ts";
import { liftEstimate } from "./strength-estimates.ts";
import { inProgressRange, type ProgressRange } from "./progress-period.ts";

/** Presentation comparisons only; authoritative PR detection and Epley are unchanged. */
export function strengthProgress(record: PersonalRecord, range: ProgressRange) {
  const performances = record.performances
    .filter((p) => inProgressRange(p.date, range))
    .sort((a, b) => a.date.localeCompare(b.date));
  const latest = performances.at(-1) ?? null;
  // The existing reader separates unilateral sides and gives one working performance per session.
  // Require identical reps and known external loads. Never present bodyweight changes as lifted kg.
  const baseline =
    latest && !record.isBodyweight && latest.load != null
      ? (performances.find(
          (p) => p.reps === latest.reps && p.load != null && p.date !== latest.date,
        ) ?? null)
      : null;
  const changeKg = baseline && latest ? latest.load! - baseline.load! : null;
  return {
    latest,
    baseline,
    changeKg,
    sessions: new Set(performances.map((p) => p.date)).size,
    estimate: liftEstimate({ ...record, performances }),
    improved: changeKg != null && changeKg > 0,
  };
}
export function workingPerformanceLabel(record: PersonalRecord, p: RecordPerformance | null) {
  if (!p) return "No data yet";
  const load = p.load?.toLocaleString("en-GB", { maximumFractionDigits: 1 });
  const value = record.isBodyweight
    ? record.key.startsWith("legacy:") && p.load != null
      ? `${load} kg effective load`
      : p.load
        ? `Bodyweight + ${load} kg`
        : "Bodyweight"
    : load != null
      ? `${load} kg`
      : "Load not recorded";
  return `${value} × ${p.reps}${record.side ? ` · ${record.side}` : ""}`;
}
export type ProgressRecordEvent = ReturnType<typeof personalRecordImprovements>[number] & {
  id: string;
};
/** Replay the existing chronological PR comparisons; filter events only AFTER lifetime detection. */
export function progressRecordEvents(
  records: PersonalRecord[],
  range: ProgressRange,
): ProgressRecordEvent[] {
  return records
    .flatMap((record) => {
      let previous: PersonalRecord[] = [
        { ...record, performances: [], bestWeight: null, bestReps: null, bestVolume: null },
      ];
      const events: ProgressRecordEvent[] = [];
      const byDate = [...record.performances].sort((a, b) => a.date.localeCompare(b.date));
      for (const [index, performance] of byDate.entries()) {
        const next = mergePersonalRecords(previous, [{ ...record, performances: [performance] }]);
        for (const event of personalRecordImprovements(previous, next)) {
          if (inProgressRange(event.performance.date, range))
            events.push({
              ...event,
              id: `${record.key}:${event.kind}:${event.performance.date}:${index}`,
            });
        }
        previous = next.map((summary) => ({
          ...summary,
          performances: [
            ...new Set(
              [summary.bestWeight, summary.bestReps, summary.bestVolume].filter(
                (p): p is RecordPerformance => p != null,
              ),
            ),
          ],
        }));
      }
      return events;
    })
    .sort(
      (a, b) => b.performance.date.localeCompare(a.performance.date) || a.id.localeCompare(b.id),
    );
}

export function trainingAdherence(
  workouts: { workoutDate: string }[],
  range: ProgressRange,
  weeklyGoal: number | null,
) {
  const completed = workouts.filter((workout) =>
    inProgressRange(workout.workoutDate, range),
  ).length;
  // The model has no historical weekly-goal schedule. Never extrapolate it across All time.
  const days = range.start
    ? Math.round((Date.parse(range.end) - Date.parse(range.start)) / 86400000) + 1
    : null;
  const planned =
    days != null && weeklyGoal != null && weeklyGoal > 0
      ? Math.round((days * weeklyGoal) / 7)
      : null;
  return {
    completed,
    planned,
    percentage: planned ? Math.round((completed / planned) * 100) : null,
  };
}
