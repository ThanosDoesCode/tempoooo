import {
  validateTrainingExercises,
  type TrainingPlanDay,
  type TrainingPlanExercise,
} from "./training-plans.ts";
import type { PrivateWorkout } from "./workout-templates-query";

/** Copy prescriptions, never the row IDs or a relationship to their source container. */
export function copyWorkoutExercises(exercises: TrainingPlanExercise[]): TrainingPlanExercise[] {
  return [...exercises]
    .sort((a, b) => a.order - b.order)
    .map((exercise, index) => ({
      ...exercise,
      id: `exercise:${crypto.randomUUID()}`,
      order: index + 1,
    }));
}
function validateCopy(exercises: TrainingPlanExercise[]) {
  const errors = validateTrainingExercises(exercises, "Workout");
  if (exercises.some((exercise) => !exercise.exerciseId))
    errors.push("Replace unavailable exercises before copying.");
  if (errors.length) throw new Error(errors[0]);
}
export function workoutToPlanDay(
  workout: PrivateWorkout,
  day: TrainingPlanDay,
  name = workout.title,
): TrainingPlanDay {
  if (!name.trim() || name.trim().length > 60)
    throw new Error("Plan-day name must be between 1 and 60 characters.");
  validateCopy(workout.exercises);
  return { ...day, name: name.trim(), exercises: copyWorkoutExercises(workout.exercises) };
}
export type WorkoutCopyRequest = {
  requestId: string;
  title: string;
  exercises: TrainingPlanExercise[];
  expectedUpdatedAt?: string;
};
/** Capture once at the action boundary, so a retry cannot copy a different draft. */
export function planDayCopyRequest(day: TrainingPlanDay, title: string): WorkoutCopyRequest {
  if (title.trim().length < 2 || title.trim().length > 80)
    throw new Error("Workout name must be between 2 and 80 characters.");
  validateCopy(day.exercises);
  return {
    requestId: crypto.randomUUID(),
    title: title.trim(),
    exercises: copyWorkoutExercises(day.exercises),
  };
}
const prescriptions = (exercises: TrainingPlanExercise[]) =>
  [...exercises]
    .sort((a, b) => a.order - b.order)
    .map((exercise) => ({
      exerciseId: exercise.exerciseId,
      sets: exercise.sets,
      repMin: exercise.repMin,
      repMax: exercise.repMax,
      executionMode: exercise.intendedUnilateralMode,
      notes: exercise.notes?.trim() || null,
    }));
/** Used only to reconcile a lost save response. Names are snapshotted by the server from the library. */
export function matchesWorkoutCopy(workout: PrivateWorkout, request: WorkoutCopyRequest) {
  return (
    workout.title === request.title &&
    JSON.stringify(prescriptions(workout.exercises)) ===
      JSON.stringify(prescriptions(request.exercises))
  );
}
