import { addDays, format, parseISO, startOfWeek } from "date-fns";
import {
  EXERCISES,
  exerciseDef,
  type AppData,
  type ExerciseEntry,
  type SplitType,
  type Workout,
} from "./types.ts";

export const NOTE_TAGS = [
  "Good form",
  "Bad form",
  "Easy",
  "Hard",
  "Near failure",
  "Pain/discomfort",
] as const;
const valid = (n: unknown): n is number => typeof n === "number" && Number.isFinite(n);
export const isWorkingRep = (r: unknown): r is number => valid(r) && Number.isInteger(r) && r > 0;
export const workingReps = (entry: ExerciseEntry) => entry.reps.filter(isWorkingRep);
export const isBodyweight = (name: string) => exerciseDef(name)?.loadKind === "bodyweight";
export type BodyweightMode = "bodyweight" | "added" | "assisted";
export function bodyweightMode(entry: ExerciseEntry): BodyweightMode {
  if (entry.loadMode) return entry.loadMode;
  if ((entry.assistance ?? 0) > 0) return "assisted";
  if ((entry.addedWeight ?? 0) > 0) return "added";
  return "bodyweight";
}
export const volumeMultiplier = (name: string) =>
  exerciseDef(name)?.loadKind === "dumbbell-pair" ? 2 : 1;
export const metricNumber = (n: number) => n.toLocaleString("en-GB", { maximumFractionDigits: 2 });

export function bodyweightOn(data: AppData, date: string): number | undefined {
  return Object.values(data.days)
    .filter((d) => d.date <= date && valid(d.weight) && d.weight > 0)
    .sort((a, b) => b.date.localeCompare(a.date))[0]?.weight;
}

export function effectiveLoad(entry: ExerciseEntry): number | null {
  if (!isBodyweight(entry.exercise))
    return valid(entry.weight) && entry.weight >= 0 ? entry.weight : null;
  // Do not reinterpret legacy "weight" as added weight or fill missing historical bodyweight.
  if (!valid(entry.bodyweight) || entry.bodyweight <= 0) return null;
  const mode = entry.loadMode;
  // Legacy entries had no explicit mode and could contain both values; preserve that calculation.
  const added = mode == null || mode === "added" ? (entry.addedWeight ?? 0) : 0;
  const assistance = mode == null || mode === "assisted" ? (entry.assistance ?? 0) : 0;
  if (!valid(added) || !valid(assistance) || added < 0 || assistance < 0) return null;
  const load = entry.bodyweight + added - assistance;
  return load > 0 ? load : null;
}

export function exerciseMetrics(entry: ExerciseEntry) {
  const reps = workingReps(entry);
  const totalReps = reps.reduce((a, b) => a + b, 0);
  const load = effectiveLoad(entry);
  return {
    workingSets: reps.length,
    totalReps,
    volume:
      reps.length === 0
        ? 0
        : load == null
          ? null
          : load * volumeMultiplier(entry.exercise) * totalReps,
  };
}

export function workoutMetrics(workout: Workout) {
  const entries = workout.entries.map(exerciseMetrics);
  return {
    workingSets: entries.reduce((sum, e) => sum + e.workingSets, 0),
    totalReps: entries.reduce((sum, e) => sum + e.totalReps, 0),
    volume: entries.some((e) => e.volume == null)
      ? null
      : entries.reduce((sum, e) => sum + (e.volume ?? 0), 0),
  };
}

export function createWorkout(data: AppData, date: string, type: SplitType): Workout {
  const sessionBodyweight = bodyweightOn(data, date);
  return {
    date,
    type,
    status: "draft",
    ...(sessionBodyweight ? { sessionBodyweight } : {}),
    entries: EXERCISES[type].map((def) => ({
      exercise: def.name,
      reps: [undefined, undefined, undefined],
      ...(isBodyweight(def.name)
        ? { bodyweight: sessionBodyweight, loadMode: "bodyweight" as const, addedWeight: 0 }
        : {}),
    })),
  };
}

export function setSessionBodyweight(workout: Workout, value: number | undefined): Workout {
  return {
    ...workout,
    sessionBodyweight: value,
    entries: workout.entries.map((entry) =>
      isBodyweight(entry.exercise) ? { ...entry, bodyweight: value } : entry,
    ),
  };
}

/** Copies only current-session set data; exercise-level load fields already apply to every set. */
export function repeatPreviousSet(entry: ExerciseEntry, setIndex: number): ExerciseEntry {
  if (setIndex < 1 || setIndex >= entry.reps.length) return entry;
  const previous = entry.reps[setIndex - 1];
  if (!isWorkingRep(previous) || entry.reps[setIndex] != null) return entry;
  const reps = [...entry.reps];
  reps[setIndex] = previous;
  return { ...entry, reps };
}

/** Applies the Same shortcut without creating timestamps or changing exercise-level metadata. */
export function repeatPreviousWorkoutSet(
  workout: Workout,
  exercise: string,
  setIndex: number,
): Workout {
  const current = workout.entries.find((entry) => entry.exercise === exercise);
  if (!current) return workout;
  const repeated = repeatPreviousSet(current, setIndex);
  if (repeated === current) return workout;
  return {
    ...workout,
    entries: workout.entries.map((entry) => (entry === current ? repeated : entry)),
  };
}

export const restSecondsRemaining = (deadlineMs: number, nowMs = Date.now()) =>
  Math.max(0, Math.ceil((deadlineMs - nowMs) / 1000));

/** Only new drafts get automatic timing; legacy sessions never get invented starts. */
export function updateExercise(
  workout: Workout,
  name: string,
  patch: Partial<ExerciseEntry>,
  now = new Date(),
): Workout {
  const compatiblePatch =
    isBodyweight(name) && patch.loadMode == null
      ? {
          ...patch,
          ...((patch.assistance ?? 0) > 0
            ? { loadMode: "assisted" as const }
            : (patch.addedWeight ?? 0) > 0
              ? { loadMode: "added" as const }
              : {}),
        }
      : patch;
  const next = {
    ...workout,
    entries: workout.entries.map((e) => (e.exercise === name ? { ...e, ...compatiblePatch } : e)),
  };
  if (!next.entries.some((e) => e.exercise === name))
    next.entries.push({
      exercise: name,
      reps: [undefined, undefined, undefined],
      ...compatiblePatch,
    });
  if (next.status === "draft" && !next.startedAt && workoutMetrics(next).workingSets > 0)
    next.startedAt = now.toISOString();
  return next;
}

export function workoutDuration(workout: Workout, now = new Date()): number | null {
  if (valid(workout.durationOverrideSeconds) && workout.durationOverrideSeconds >= 0)
    return workout.durationOverrideSeconds;
  if (
    workout.status === "completed" &&
    valid(workout.durationSeconds) &&
    workout.durationSeconds >= 0
  )
    return workout.durationSeconds;
  if (!workout.startedAt) return null;
  const start = Date.parse(workout.startedAt);
  const end = workout.completedAt ? Date.parse(workout.completedAt) : now.getTime();
  return Number.isFinite(start) && Number.isFinite(end) && end >= start
    ? Math.round((end - start) / 1000)
    : null;
}

export function completeWorkout(workout: Workout, now = new Date()): Workout {
  if (!workoutMetrics(workout).workingSets)
    throw new Error("Log at least one working set before completing this workout.");
  return {
    ...workout,
    status: "completed",
    completedAt: workout.completedAt ?? now.toISOString(),
    durationSeconds:
      workoutDuration({ ...workout, durationOverrideSeconds: undefined }, now) ?? undefined,
  };
}

export function trainingTotals(data: AppData, on = new Date()) {
  const today = format(on, "yyyy-MM-dd");
  const week = format(startOfWeek(on, { weekStartsOn: 1 }), "yyyy-MM-dd");
  const month = today.slice(0, 7);
  const completed = Object.values(data.workouts).filter(
    (w) => w.status === "completed" && w.date <= today && workoutMetrics(w).workingSets > 0,
  );
  const aggregate = (workouts: Workout[]) => {
    const metrics = workouts.map(workoutMetrics);
    const durations = workouts.map((w) => workoutDuration(w)).filter((d): d is number => d != null);
    return {
      count: workouts.length,
      volume: metrics.some((m) => m.volume == null)
        ? null
        : metrics.reduce((sum, m) => sum + (m.volume ?? 0), 0),
      averageDuration: durations.length
        ? durations.reduce((a, b) => a + b, 0) / durations.length
        : null,
      timedCount: durations.length,
    };
  };
  return {
    week: aggregate(completed.filter((w) => w.date >= week)),
    month: aggregate(completed.filter((w) => w.date.startsWith(month))),
    allTime: aggregate(completed),
    legacyCount: Object.values(data.workouts).filter(
      (w) => w.status == null && workoutMetrics(w).workingSets > 0,
    ).length,
  };
}

export function entryLoadLabel(entry: ExerciseEntry): string {
  const load = effectiveLoad(entry);
  if (load != null)
    return `${metricNumber(load)} kg${isBodyweight(entry.exercise) ? " effective load" : ""}`;
  if (isBodyweight(entry.exercise) && entry.weight != null)
    return `${metricNumber(entry.weight)} kg recorded (bodyweight unknown)`;
  return "Load unavailable";
}

export function notesPreview(entry: ExerciseEntry): string {
  return [
    ...(entry.noteTags ?? []),
    ...(entry.rpe != null ? [`RPE ${entry.rpe}`] : []),
    entry.notes?.trim(),
  ]
    .filter(Boolean)
    .join(" · ");
}

/** Recent = last 90 calendar days, as of the viewed training date. Actual sets only. */
export function bestRecentSet(data: AppData, exercise: string, date: string) {
  const since = format(addDays(parseISO(date), -89), "yyyy-MM-dd");
  const candidates = Object.values(data.workouts)
    .filter((w) => w.status !== "draft" && w.date >= since && w.date <= date)
    .flatMap((w) =>
      w.entries
        .filter((e) => e.exercise === exercise)
        .flatMap((entry) => {
          const load = effectiveLoad(entry);
          return load == null
            ? []
            : workingReps(entry).map((reps) => ({ date: w.date, load, reps, entry }));
        }),
    );
  if (!candidates.length) return null;
  const def = exerciseDef(exercise);
  const mostReps = Math.max(...candidates.map((s) => s.reps));
  const comparableFloor = Math.max(def?.min ?? 1, Math.min(def?.max ?? mostReps, mostReps) - 2);
  const comparable = candidates.filter((s) => s.reps >= comparableFloor);
  return (
    (comparable.length ? comparable : candidates.filter((s) => s.reps === mostReps)).sort(
      (a, b) => b.load - a.load || b.reps - a.reps || b.date.localeCompare(a.date),
    )[0] ?? null
  );
}
