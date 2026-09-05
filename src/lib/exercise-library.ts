export const MUSCLE_GROUPS = [
  "chest",
  "lats",
  "upper_back",
  "traps",
  "front_delts",
  "side_delts",
  "rear_delts",
  "biceps",
  "triceps",
  "forearms",
  "quads",
  "hamstrings",
  "glutes",
  "calves",
  "adductors",
  "abductors",
  "abs",
  "obliques",
  "lower_back",
] as const;

export const EXERCISE_EQUIPMENT = [
  "barbell",
  "dumbbell",
  "cable",
  "machine",
  "smith_machine",
  "bench",
  "pull_up_bar",
  "bodyweight",
  "kettlebell",
  "resistance_band",
  "plate",
  "trap_bar",
  "ez_bar",
] as const;

export const MOVEMENT_PATTERNS = [
  "horizontal_push",
  "vertical_push",
  "horizontal_pull",
  "vertical_pull",
  "squat",
  "hinge",
  "lunge",
  "knee_extension",
  "knee_flexion",
  "hip_extension",
  "hip_abduction",
  "hip_adduction",
  "elbow_flexion",
  "elbow_extension",
  "shoulder_abduction",
  "shoulder_flexion",
  "shoulder_extension",
  "calf_raise",
  "core_flexion",
  "anti_extension",
  "anti_rotation",
  "rotation",
  "carry",
  "other",
] as const;

export const EXERCISE_EXPERIENCE_LEVELS = ["beginner", "intermediate", "advanced"] as const;
export const EXERCISE_LIBRARY_PAGE_SIZE = 40;

export type MuscleGroup = (typeof MUSCLE_GROUPS)[number];
export type ExerciseEquipment = (typeof EXERCISE_EQUIPMENT)[number];
export type MovementPattern = (typeof MOVEMENT_PATTERNS)[number];
export type ExerciseExperienceLevel = (typeof EXERCISE_EXPERIENCE_LEVELS)[number];
export type ExerciseCategory = "strength" | "bodyweight" | "core" | "carry";
export type UnilateralMode = "bilateral" | "unilateral";

export type LibraryExercise = {
  id: string;
  owner_id: string | null;
  slug: string;
  name: string;
  primary_muscle: MuscleGroup;
  secondary_muscles: MuscleGroup[];
  equipment: ExerciseEquipment[];
  movement_pattern: MovementPattern;
  category: ExerciseCategory;
  supports_unilateral: boolean;
  default_unilateral_mode: UnilateralMode;
  is_bodyweight: boolean;
  is_system: boolean;
  active: boolean;
  min_experience: ExerciseExperienceLevel;
  created_at: string;
  updated_at: string;
};

export type ExerciseLibraryFilters = {
  search?: string | undefined;
  primaryMuscle?: MuscleGroup | undefined;
  equipment?: ExerciseEquipment | undefined;
  unilateralOnly?: boolean | undefined;
  experienceLevel?: ExerciseExperienceLevel | undefined;
  origin?: "all" | "system" | "custom" | undefined;
};

const experienceRank: Record<ExerciseExperienceLevel, number> = {
  beginner: 0,
  intermediate: 1,
  advanced: 2,
};

export function exerciseSlug(name: string): string {
  return name
    .normalize("NFKD")
    .toLowerCase()
    .replace(/\p{M}+/gu, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 72);
}

export function exerciseMatchesFilters(
  exercise: LibraryExercise,
  filters: ExerciseLibraryFilters,
): boolean {
  const search = filters.search?.trim().toLocaleLowerCase();
  if (search && !exercise.name.toLocaleLowerCase().includes(search)) return false;
  if (filters.primaryMuscle && exercise.primary_muscle !== filters.primaryMuscle) return false;
  if (filters.equipment && !exercise.equipment.includes(filters.equipment)) return false;
  if (filters.unilateralOnly && !exercise.supports_unilateral) return false;
  if (filters.origin === "system" && !exercise.is_system) return false;
  if (filters.origin === "custom" && exercise.is_system) return false;
  if (
    filters.experienceLevel &&
    experienceRank[exercise.min_experience] > experienceRank[filters.experienceLevel]
  )
    return false;
  return exercise.active;
}

export function filterExerciseLibrary(
  exercises: LibraryExercise[],
  filters: ExerciseLibraryFilters,
  limit = EXERCISE_LIBRARY_PAGE_SIZE,
): LibraryExercise[] {
  return exercises
    .filter((exercise) => exerciseMatchesFilters(exercise, filters))
    .sort((left, right) => left.name.localeCompare(right.name))
    .slice(0, Math.max(0, limit));
}

export function mergeExerciseLibrary(
  systemExercises: LibraryExercise[],
  customExercises: LibraryExercise[],
): LibraryExercise[] {
  return Array.from(
    new Map(
      [...systemExercises, ...customExercises].map((exercise) => [exercise.id, exercise]),
    ).values(),
  );
}

export function exerciseById(exercises: LibraryExercise[], id: string) {
  return exercises.find((exercise) => exercise.id === id);
}
