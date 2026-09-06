export type BulkTrainingSet = {
  id: string;
  order: number;
  isExtra: boolean;
  isComplete: boolean;
  bilateralWeight: number | null;
  bilateralReps: number | null;
  leftWeight: number | null;
  leftReps: number | null;
  rightWeight: number | null;
  rightReps: number | null;
};

export type BulkTrainingSessionExercise = {
  id: string;
  sourceExerciseId: string | null;
  name: string;
  order: number;
  executionMode: "bilateral" | "unilateral";
  isBodyweight: boolean;
  targetSets: number;
  targetRepMin: number;
  targetRepMax: number;
  notes: string | null;
  sets: BulkTrainingSet[];
};

export type BulkTrainingSession = {
  id: string;
  bulkProfileId: string;
  trainingPlanId: string | null;
  planName: string;
  workoutDayName: string;
  workoutDayOrder: number;
  status: "in_progress" | "completed";
  startedAt: string;
  completedAt: string | null;
  updatedAt: string;
  exercises: BulkTrainingSessionExercise[];
};

export type EditableSessionSet = Omit<BulkTrainingSet, "order" | "isExtra" | "isComplete">;

export function isSessionSetComplete(
  set: EditableSessionSet,
  exercise: BulkTrainingSessionExercise,
) {
  if (exercise.executionMode === "bilateral")
    return set.bilateralReps != null && (exercise.isBodyweight || set.bilateralWeight != null);
  return (
    set.leftReps != null &&
    set.rightReps != null &&
    (exercise.isBodyweight || (set.leftWeight != null && set.rightWeight != null))
  );
}

export function sessionSetLabel(set: BulkTrainingSet, exercise: BulkTrainingSessionExercise) {
  if (exercise.executionMode === "unilateral") {
    const side = (prefix: "L" | "R", weight: number | null, reps: number | null) => {
      if (reps == null) return `${prefix} —`;
      return exercise.isBodyweight && weight == null
        ? `${prefix} ${reps} reps`
        : `${prefix} ${weight ?? 0} kg × ${reps}`;
    };
    return `${side("L", set.leftWeight, set.leftReps)} | ${side("R", set.rightWeight, set.rightReps)}`;
  }
  if (set.bilateralReps == null) return "Incomplete";
  if (exercise.isBodyweight && set.bilateralWeight == null) return `${set.bilateralReps} reps`;
  const prefix = exercise.isBodyweight && (set.bilateralWeight ?? 0) > 0 ? "+" : "";
  return `${prefix}${set.bilateralWeight ?? 0} kg × ${set.bilateralReps}`;
}
