import { addDays, format, parseISO, startOfWeek } from "date-fns";
import {
  completedSessionVolume,
  completedWorkingSets,
  sessionElapsedSeconds,
  type BulkTrainingSession,
} from "./bulk-training-session-domain.ts";
import {
  deriveLegacyPersonalRecords,
  derivePublicPersonalRecords,
  mergePersonalRecords,
  personalRecordImprovements,
  personalRecordNameKey,
  type PersonalRecord,
} from "./personal-records.ts";
import { workoutDuration, workoutMetrics } from "./training.ts";
import { splitLabel, type AppData, type Workout } from "./types.ts";

export type HistoryWorkout = {
  key: string;
  name: string;
  planName: string;
  date: string;
  seconds: number | null;
  workingSets: number;
  warmups: number;
  volume: number | null;
  records: number;
  recordSets: string[];
  session?: BulkTrainingSession;
  legacy?: Workout;
};

export function workoutHistory(
  sessions: BulkTrainingSession[],
  data: AppData | null,
): HistoryWorkout[] {
  const rows: HistoryWorkout[] = [];
  for (const session of sessions) {
    if (
      session.status !== "completed" ||
      !session.completedAt ||
      !session.exercises.some((e) => e.sets.some((s) => s.isComplete))
    )
      continue;
    rows.push({
      key: session.id,
      name: session.workoutDayName,
      planName: session.planName,
      date: session.workoutDate,
      seconds: sessionElapsedSeconds(session.startedAt, 0, session.completedAt),
      workingSets: completedWorkingSets(session),
      warmups: session.exercises.reduce(
        (n, e) => n + e.sets.filter((s) => s.isComplete && s.setType === "warmup").length,
        0,
      ),
      volume: completedSessionVolume(session),
      records: 0,
      recordSets: [],
      session,
    });
  }
  for (const workout of Object.values(data?.workouts ?? {})) {
    if (
      workout.status === "draft" ||
      !workout.entries.some((e) => e.reps.some((r) => r != null && r > 0))
    )
      continue;
    const metrics = workoutMetrics(workout);
    rows.push({
      key: `legacy:${workout.date}`,
      name: splitLabel(workout.type),
      planName: "Original Tempo program",
      date: workout.date,
      seconds: workoutDuration(workout),
      workingSets: metrics.workingSets,
      warmups: 0,
      volume: metrics.volume,
      records: 0,
      recordSets: [],
      legacy: workout,
    });
  }
  rows.sort(
    (a, b) =>
      a.date.localeCompare(b.date) ||
      (a.session?.completedAt ?? a.legacy?.completedAt ?? a.date).localeCompare(
        b.session?.completedAt ?? b.legacy?.completedAt ?? b.date,
      ) ||
      a.key.localeCompare(b.key),
  );
  let summaries: PersonalRecord[] = [];
  for (const row of rows) {
    const current = row.session
      ? derivePublicPersonalRecords([row.session])
      : data && row.legacy
        ? deriveLegacyPersonalRecords({ ...data, workouts: { [row.date]: row.legacy } })
        : [];
    const after = mergePersonalRecords(summaries, current);
    const improvements = personalRecordImprovements(summaries, after).filter(
      (i) => i.performance.date === (row.session?.completedAt ?? row.date),
    );
    row.records = improvements.length;
    if (row.session) {
      for (const change of improvements.filter((i) => i.kind !== "volume")) {
        const e = row.session.exercises.find(
          (e) => personalRecordNameKey(e.name) === personalRecordNameKey(change.record.name),
        );
        const s = e?.sets.find(
          (s) =>
            s.isComplete &&
            s.setType !== "warmup" &&
            (change.record.side === "left"
              ? s.leftWeight ===
                  (change.kind === "reps" ? change.performance.repLoad : change.performance.load) &&
                s.leftReps ===
                  (change.kind === "reps" ? change.performance.repCount : change.performance.reps)
              : change.record.side === "right"
                ? s.rightWeight ===
                    (change.kind === "reps"
                      ? change.performance.repLoad
                      : change.performance.load) &&
                  s.rightReps ===
                    (change.kind === "reps" ? change.performance.repCount : change.performance.reps)
                : s.bilateralWeight ===
                    (change.kind === "reps"
                      ? change.performance.repLoad
                      : change.performance.load) &&
                  s.bilateralReps ===
                    (change.kind === "reps"
                      ? change.performance.repCount
                      : change.performance.reps)),
        );
        if (s && !row.recordSets.includes(s.id)) row.recordSets.push(s.id);
      }
    } else if (row.legacy) {
      for (const change of improvements.filter((i) => i.kind !== "volume")) {
        const entry = row.legacy.entries.find(
          (e) => personalRecordNameKey(e.exercise) === personalRecordNameKey(change.record.name),
        );
        const index = entry?.reps.findIndex(
          (reps) =>
            reps ===
            (change.kind === "reps" ? change.performance.repCount : change.performance.reps),
        );
        if (entry && index != null && index >= 0) {
          const key = legacyRecordSetKey(row.date, entry.exercise, index);
          if (!row.recordSets.includes(key)) row.recordSets.push(key);
        }
      }
    }
    // Only these real maxima are needed to compare the next workout. Retain the
    // authoritative PR summaries, without recalculating every historical set
    // for every row or growing a second copy of the full performance history.
    summaries = after.map((record) => ({
      ...record,
      performances: [...new Set([record.bestWeight, record.bestReps, record.bestVolume])].filter(
        (performance) => performance != null,
      ),
    }));
  }
  return rows.reverse();
}

export const legacyRecordSetKey = (date: string, exercise: string, index: number) =>
  `legacy:${date}:${exercise}:${index}`;

/** Strength counts actual retained logs, not a gym checkbox left after deletion. */
export function recordedLegacyWorkouts(data: AppData | null) {
  return Object.fromEntries(
    Object.entries(data?.workouts ?? {})
      .filter(
        ([, workout]) =>
          workout.status !== "draft" &&
          workout.entries.some((e) => e.reps.some((r) => r != null && r > 0)),
      )
      .map(([date, workout]) => [date, { date: workout.date, status: "completed" as const }]),
  );
}

export function groupWorkoutWeeks(rows: HistoryWorkout[], today: string) {
  const current = format(startOfWeek(parseISO(today), { weekStartsOn: 1 }), "yyyy-MM-dd");
  const last = format(addDays(parseISO(current), -7), "yyyy-MM-dd");
  const groups = new Map<string, HistoryWorkout[]>();
  for (const row of rows) {
    const key = format(startOfWeek(parseISO(row.date), { weekStartsOn: 1 }), "yyyy-MM-dd");
    groups.set(key, [...(groups.get(key) ?? []), row]);
  }
  return [...groups]
    .sort(([a], [b]) => b.localeCompare(a))
    .map(([start, workouts]) => ({
      start,
      workouts,
      label: `${start === current ? "This week · " : start === last ? "Last week · " : ""}${format(parseISO(start), "d MMM")} to ${format(addDays(parseISO(start), 6), "d MMM")}`,
    }));
}

export function previousSameWorkout(row: HistoryWorkout, rows: HistoryWorkout[]) {
  const index = rows.findIndex((r) => r.key === row.key);
  return (
    rows
      .slice(index + 1)
      .find((other) =>
        row.session && other.session
          ? row.session.trainingPlanId != null &&
            row.session.trainingPlanId === other.session.trainingPlanId &&
            row.session.workoutDayOrder === other.session.workoutDayOrder
          : row.legacy && other.legacy
            ? row.legacy.type === other.legacy.type
            : false,
      ) ?? null
  );
}

export function historyDuration(seconds: number | null) {
  if (seconds == null) return "Time unavailable";
  const minutes = Math.max(1, Math.round(seconds / 60));
  return minutes >= 60 ? `${Math.floor(minutes / 60)} h ${minutes % 60} m` : `${minutes} min`;
}

export function localTimestampInput(timestamp: string) {
  return format(new Date(timestamp), "yyyy-MM-dd'T'HH:mm");
}

export function validateWorkoutTimes(date: string, start: string, end: string) {
  const a = new Date(start),
    b = new Date(end);
  if (
    !date ||
    start.slice(0, 10) !== date ||
    !Number.isFinite(+a) ||
    !Number.isFinite(+b) ||
    +b <= +a
  )
    return "Choose a start on the workout date and an end after the start.";
  return null;
}
