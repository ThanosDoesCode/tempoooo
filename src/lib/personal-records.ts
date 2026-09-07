import type { BulkTrainingSession } from "./bulk-training-session-domain.ts";
import type { AppData, ExerciseEntry } from "./types.ts";
import { effectiveLoad, exerciseMetrics, isWorkingRep } from "./training.ts";

export type RecordPerformance = {
  date: string;
  load: number | null;
  reps: number;
  repLoad: number | null;
  repCount: number;
  volume: number | null;
  bodyweight: number | null;
};

export type PersonalRecord = {
  key: string;
  exerciseId: string | null;
  name: string;
  side: "left" | "right" | null;
  isBodyweight: boolean;
  performances: RecordPerformance[];
  bestWeight: RecordPerformance | null;
  bestReps: RecordPerformance | null;
  bestVolume: RecordPerformance | null;
};

function summarize(
  key: string,
  exerciseId: string | null,
  name: string,
  side: PersonalRecord["side"],
  isBodyweight: boolean,
  performances: RecordPerformance[],
): PersonalRecord {
  const byDate = [...performances].sort((a, b) => b.date.localeCompare(a.date));
  const withLoad = byDate.filter((item) => item.load != null);
  const withVolume = byDate.filter((item) => item.volume != null);
  return {
    key,
    exerciseId,
    name,
    side,
    isBodyweight,
    performances: byDate,
    bestWeight: [...withLoad].sort((a, b) => b.load! - a.load! || b.reps - a.reps)[0] ?? null,
    bestReps:
      [...byDate].sort(
        (a, b) => b.repCount - a.repCount || (b.repLoad ?? -1) - (a.repLoad ?? -1),
      )[0] ?? null,
    bestVolume: [...withVolume].sort((a, b) => b.volume! - a.volume!)[0] ?? null,
  };
}

export function derivePublicPersonalRecords(sessions: BulkTrainingSession[]): PersonalRecord[] {
  const grouped = new Map<
    string,
    {
      exerciseId: string | null;
      name: string;
      side: PersonalRecord["side"];
      isBodyweight: boolean;
      performances: RecordPerformance[];
    }
  >();

  for (const session of sessions) {
    if (session.status !== "completed" || !session.completedAt) continue;
    for (const exercise of session.exercises) {
      const identity = exercise.sourceExerciseId ?? `name:${exercise.name}`;
      const sides = exercise.executionMode === "unilateral" ? (["left", "right"] as const) : [null];
      for (const side of sides) {
        const sets = exercise.sets.filter((set) => set.isComplete);
        const values = sets.flatMap((set) => {
          const reps =
            side === "left" ? set.leftReps : side === "right" ? set.rightReps : set.bilateralReps;
          const load =
            side === "left"
              ? set.leftWeight
              : side === "right"
                ? set.rightWeight
                : set.bilateralWeight;
          return reps != null && reps > 0
            ? [{ load, reps, volume: load == null ? null : load * reps }]
            : [];
        });
        if (!values.length) continue;
        const key = `${identity}:${side ?? "bilateral"}`;
        const group = grouped.get(key) ?? {
          exerciseId: exercise.sourceExerciseId,
          name: exercise.name,
          side,
          isBodyweight: exercise.isBodyweight,
          performances: [],
        };
        const strongest = [...values].sort(
          (a, b) => (b.load ?? -1) - (a.load ?? -1) || b.reps - a.reps,
        )[0]!;
        const mostReps = [...values].sort(
          (a, b) => b.reps - a.reps || (b.load ?? -1) - (a.load ?? -1),
        )[0]!;
        group.performances.push({
          date: session.completedAt,
          load: strongest.load,
          reps: strongest.reps,
          repLoad: mostReps.load,
          repCount: mostReps.reps,
          volume: values.some((item) => item.volume == null)
            ? null
            : values.reduce((sum, item) => sum + item.volume!, 0),
          bodyweight: null,
        });
        grouped.set(key, group);
      }
    }
  }

  return [...grouped.entries()]
    .map(([key, group]) =>
      summarize(
        key,
        group.exerciseId,
        group.name,
        group.side,
        group.isBodyweight,
        group.performances,
      ),
    )
    .sort((a, b) => a.name.localeCompare(b.name) || (a.side ?? "").localeCompare(b.side ?? ""));
}

function legacyPerformance(date: string, entry: ExerciseEntry): RecordPerformance | null {
  const reps = entry.reps.filter(isWorkingRep);
  if (!reps.length) return null;
  return {
    date,
    load: effectiveLoad(entry),
    reps: Math.max(...reps),
    repLoad: effectiveLoad(entry),
    repCount: Math.max(...reps),
    volume: exerciseMetrics(entry).volume,
    bodyweight: entry.bodyweight ?? null,
  };
}

export function deriveLegacyPersonalRecords(data: AppData): PersonalRecord[] {
  const grouped = new Map<string, { entry: ExerciseEntry; performances: RecordPerformance[] }>();
  for (const workout of Object.values(data.workouts)) {
    if (workout.status === "draft") continue;
    for (const entry of workout.entries) {
      const performance = legacyPerformance(workout.date, entry);
      if (!performance) continue;
      const group = grouped.get(entry.exercise) ?? { entry, performances: [] };
      group.performances.push(performance);
      grouped.set(entry.exercise, group);
    }
  }
  return [...grouped.entries()]
    .map(([name, group]) =>
      summarize(
        `legacy:${name}:bilateral`,
        null,
        name,
        null,
        group.entry.bodyweight != null,
        group.performances,
      ),
    )
    .sort((a, b) => a.name.localeCompare(b.name));
}
