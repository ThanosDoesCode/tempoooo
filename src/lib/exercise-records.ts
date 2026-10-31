import { personalRecordNameKey, type PersonalRecord } from "./personal-records.ts";
import type { UserTrainingPlan } from "./training-plans.ts";
import { strengthProgress, workingPerformanceLabel } from "./strength-progress.ts";
import { epleyEstimatedMax } from "./strength-estimates.ts";
import type { ProgressRange } from "./progress-period.ts";

/** Exercise identity is independent of side. Side-specific records/calculations stay intact. */
export type ExerciseRecord = { key: string; name: string; records: PersonalRecord[] };
export type TrackedExercise = { key: string; name: string; aliases: string[] };
export const exerciseRecordKey = (record: PersonalRecord) => record.exerciseId ?? record.name;
export function groupExerciseRecords(records: PersonalRecord[]): ExerciseRecord[] {
  const grouped = new Map<string, ExerciseRecord>();
  // ID-bearing records first; old JSON can join the one unambiguous exercise
  // without pretending that its bilateral performance belongs to either side.
  for (const record of [
    ...records.filter((r) => r.exerciseId),
    ...records.filter((r) => !r.exerciseId),
  ]) {
    let key = exerciseRecordKey(record);
    if (!record.exerciseId && !grouped.has(key)) {
      const matching = [...grouped.values()].filter(
        (group) => personalRecordNameKey(group.name) === personalRecordNameKey(record.name),
      );
      if (matching.length === 1) key = matching[0]!.key;
    }
    const group = grouped.get(key) ?? { key, name: record.name, records: [] };
    group.records.push(record);
    grouped.set(key, group);
  }
  return [...grouped.values()];
}

export function resolveExerciseRecord(
  groups: ExerciseRecord[],
  value: string,
): ExerciseRecord | undefined {
  const exact = groups.find(
    (group) => group.key === value || group.records.some((record) => record.key === value),
  );
  if (exact) return exact;
  const named = groups.filter((group) => group.name === value);
  return named.length === 1 ? named[0] : undefined;
}

export function trackedExerciseOptions(
  plan: UserTrainingPlan | null,
  records: PersonalRecord[],
  legacyNames: string[],
) {
  const groups = groupExerciseRecords(records);
  const options = new Map<string, TrackedExercise>();
  const fromPlan: string[] = [];
  const defaults: string[] = [];
  for (const day of [...(plan?.days ?? [])].sort((a, b) => a.order - b.order)) {
    let defaultChosen = false;
    for (const exercise of [...day.exercises].sort((a, b) => a.order - b.order)) {
      const key =
        exercise.exerciseId ?? resolveExerciseRecord(groups, exercise.name)?.key ?? exercise.name;
      options.set(key, { key, name: exercise.name, aliases: [exercise.name] });
      if (!fromPlan.includes(key)) fromPlan.push(key);
      if (
        !defaultChosen &&
        !exercise.isBodyweight &&
        exercise.repMin > 0 &&
        exercise.repMax >= exercise.repMin &&
        !defaults.includes(key)
      ) {
        defaults.push(key);
        defaultChosen = true;
      }
    }
  }
  for (const name of legacyNames) {
    const key = resolveExerciseRecord(groups, name)?.key ?? name;
    if (!options.has(key)) options.set(key, { key, name, aliases: [name] });
    if (!fromPlan.includes(key)) fromPlan.push(key);
  }
  const history: string[] = [];
  for (const group of groups) {
    const existing = options.get(group.key);
    const aliases = [group.name, ...group.records.map((record) => record.key)];
    options.set(group.key, {
      key: group.key,
      name: existing?.name ?? group.name,
      aliases: [...(existing?.aliases ?? []), ...aliases],
    });
    if (
      !fromPlan.includes(group.key) &&
      group.records.some((r) => r.performances.some((p) => p.load != null && p.load > 0))
    )
      history.push(group.key);
  }
  return { options: [...options.values()], fromPlan, history, defaults: defaults.slice(0, 6) };
}

/** Preserve unknown/temporarily unavailable choices; normalize only unambiguous known aliases. */
export function normalizeTrackedPreferences(
  values: string[],
  options: TrackedExercise[],
): string[] {
  return [
    ...new Set(
      values.map((value) => {
        const exact = options.find((option) => option.key === value);
        if (exact) return exact.key;
        const named = options.filter((option) => option.name === value);
        if (named.length === 1) return named[0]!.key;
        const matching = options.filter((option) =>
          [option.key, option.name, ...option.aliases].some(
            (alias) =>
              alias === value ||
              ["left", "right"].some(
                (side) => value === `${alias}:${side}` || value === `${alias} · ${side}`,
              ),
          ),
        );
        return matching.length === 1 ? matching[0]!.key : value;
      }),
    ),
  ];
}

export function exerciseRecordPresentation(
  group: ExerciseRecord,
  range: ProgressRange,
  kind: "latest" | "best" = "latest",
) {
  const rows = [...group.records]
    .sort((a, b) => (a.side ?? "").localeCompare(b.side ?? ""))
    .map((record) => {
      const progress = strengthProgress(record, range);
      const performance =
        kind === "best" ? (record.bestWeight ?? record.bestReps) : progress.latest;
      const label =
        record.side === "left"
          ? "Left"
          : record.side === "right"
            ? "Right"
            : group.records.length > 1
              ? "Standard"
              : "";
      const comparison =
        progress.changeKg != null
          ? `${progress.changeKg > 0 ? "+" : ""}${progress.changeKg.toLocaleString("en-GB", { maximumFractionDigits: 1 })} kg vs start of period · same ${progress.latest!.reps} reps`
          : progress.sessions === 1
            ? "One session"
            : progress.latest
              ? "No comparable previous session yet"
              : null;
      const estimate =
        kind === "best"
          ? performance?.load != null && performance.load > 0
            ? epleyEstimatedMax(performance.load, performance.reps)
            : null
          : progress.estimate.current;
      return {
        record,
        label,
        performance,
        value: workingPerformanceLabel({ ...record, side: null }, performance),
        comparison,
        estimate,
        estimateChange: kind === "latest" ? progress.estimate.changePct : null,
        progress,
      };
    });
  const left = rows.find((row) => row.record.side === "left");
  const right = rows.find((row) => row.record.side === "right");
  const unilateral = !!left || !!right;
  const onlySides = unilateral && rows.every((row) => row.record.side != null);
  const equal =
    onlySides &&
    left?.performance &&
    right?.performance &&
    left.performance.load === right.performance.load &&
    left.performance.reps === right.performance.reps &&
    left.record.isBodyweight === right.record.isBodyweight &&
    (kind === "best" || left.performance.date === right.performance.date);
  const commonComparison =
    onlySides && left?.comparison && left.comparison === right?.comparison ? left.comparison : null;
  const equalEstimate =
    onlySides &&
    left?.estimate != null &&
    left.estimate === right?.estimate &&
    left.estimateChange === right.estimateChange;
  return {
    rows,
    unilateral,
    summary: equal
      ? `${left.value} each side`
      : rows.length === 1 && !unilateral
        ? rows[0]!.value
        : null,
    commonComparison,
    commonEstimate: equalEstimate ? left.estimate : null,
    commonEstimateChange: equalEstimate ? left.estimateChange : null,
  };
}
