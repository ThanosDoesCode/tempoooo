import {
  DEFAULT_NUTRITION_TARGETS,
  type Equipment,
  type ExperienceLevel,
  type TrainingSetupPreference,
} from "./bulk-onboarding.ts";

export type WorkoutType = "Chest & Back" | "Legs" | "Arms & Shoulders" | "Rest";
export type SplitType = Exclude<WorkoutType, "Rest">;

export type MealPlanId = "beef" | "lentil" | "kebab" | "salmon" | "custom";

export type MealSnapshot = {
  name: string;
  base: string[];
  meals: string[];
  extras?: string[] | undefined;
  macros: { calories: number; protein: number; carbs: number; fat: number } | null;
};

export type DailyLog = {
  date: string; // yyyy-MM-dd
  weight?: number | undefined;
  waist?: number | undefined;
  sleepHours?: number | undefined;
  sleepQuality?: number | undefined;
  restingHr?: number | undefined;
  calories?: number | undefined;
  protein?: number | undefined;
  carbs?: number | undefined;
  fat?: number | undefined;
  mealPlan?: MealPlanId | undefined;
  mealSnapshot?: MealSnapshot | undefined;
  creatine?: boolean | undefined;
  water?: number | undefined;
  steps?: number | undefined;
  cyclingKm?: number | undefined;
  runningKm?: number | undefined;
  cardioMin?: number | undefined;
  note?: string | undefined;
  gym?: boolean | undefined;
  workoutType?: WorkoutType | undefined;
};

export type ExerciseEntry = {
  exercise: string;
  weight?: number | undefined;
  reps: (number | undefined)[]; // 3 sets
  notes?: string | undefined;
  bodyweight?: number | undefined; // Session snapshot, never inferred for historical entries.
  addedWeight?: number | undefined;
  assistance?: number | undefined; // Reserved for assisted bodyweight movements.
  loadMode?: "bodyweight" | "added" | "assisted" | undefined;
  noteTags?: string[] | undefined;
  rpe?: number | undefined;
};

export type Workout = {
  date: string;
  type: SplitType;
  entries: ExerciseEntry[];
  status?: "draft" | "completed" | undefined; // Missing means legacy, not confirmed complete.
  sessionNote?: string | undefined;
  startedAt?: string | undefined;
  completedAt?: string | undefined;
  durationSeconds?: number | undefined;
  durationOverrideSeconds?: number | undefined;
  sessionBodyweight?: number | undefined;
};

export type PhotoSet = {
  id: string;
  date: string;
  weight?: number | undefined;
  front?: string | undefined;
  side?: string | undefined;
  back?: string | undefined;
};

export type Targets = {
  calories: number;
  protein: number;
  carbs: number;
  fat: number;
  water: number;
  startWeight: number;
  targetWeight: number;
  targetWeeklyGainKg?: number | undefined;
  experienceLevel?: ExperienceLevel | undefined;
  trainingDaysPerWeek?: number | undefined;
  availableEquipment?: Equipment[] | undefined;
  trainingSetupPreference?: TrainingSetupPreference | undefined;
  onboardingCompletedAt?: string | undefined;
  exerciseSetupNotes?: Record<string, string> | undefined;
  legacyExerciseOrder?: Partial<Record<SplitType, string[]>> | undefined;
};

export type AppData = {
  days: Record<string, DailyLog>;
  workouts: Record<string, Workout>; // key = date
  photos: PhotoSet[];
  weekNotes: Record<string, string>; // key = week start yyyy-MM-dd
  targets: Targets;
};

/** Acceptable daily ranges, shown instead of a single hard number. */
export const RANGES = {
  calories: [2800, 3000] as const,
  protein: [125, 140] as const,
  carbs: [350, 410] as const,
  fat: [80, 90] as const,
  water: [3, 4] as const,
};

export type ExerciseDef = {
  name: string;
  min: number;
  max: number;
  loadKind?: "bodyweight" | "dumbbell-pair";
};

export const EXERCISES: Record<SplitType, ExerciseDef[]> = {
  "Chest & Back": [
    { name: "Incline Dumbbell Press", min: 6, max: 10, loadKind: "dumbbell-pair" },
    { name: "Cable Low-to-High Fly", min: 10, max: 15 },
    { name: "Pull-Ups", min: 5, max: 10, loadKind: "bodyweight" },
    { name: "Cable Rows", min: 8, max: 12 },
    { name: "Face Pulls", min: 12, max: 18 },
  ],
  Legs: [
    { name: "Leg Extensions", min: 10, max: 15 },
    { name: "Declined Leg Press", min: 8, max: 12 },
    { name: "Romanian Deadlifts", min: 6, max: 10 },
    { name: "Leg Curls", min: 10, max: 15 },
    { name: "Calf Raises", min: 12, max: 20 },
    { name: "Cable Crunches", min: 10, max: 15 },
    { name: "Hanging Leg Raises", min: 8, max: 15, loadKind: "bodyweight" },
  ],
  "Arms & Shoulders": [
    { name: "Chin-Ups", min: 5, max: 10, loadKind: "bodyweight" },
    { name: "Incline Dumbbell Curls", min: 8, max: 12, loadKind: "dumbbell-pair" },
    { name: "Tricep Pushdowns", min: 10, max: 15 },
    { name: "Overhead Tricep Extensions", min: 10, max: 15 },
    { name: "Lateral Raises", min: 12, max: 18 },
    { name: "Cable Crunches", min: 10, max: 15 },
    { name: "Hanging Leg Raises", min: 8, max: 15, loadKind: "bodyweight" },
  ],
};

const EXERCISE_LABELS: Record<string, string> = {
  "Incline Dumbbell Press": "Dumbbell Incline Press",
  "Cable Low-to-High Fly": "Cable Low-to-High",
  "Incline Dumbbell Curls": "Incline Bicep Curls",
};

export const exerciseLabel = (name: string) => EXERCISE_LABELS[name] ?? name;
export const splitLabel = (name: SplitType) => (name === "Arms & Shoulders" ? "Arms" : name);

export const ALL_EXERCISES: ExerciseDef[] = Array.from(
  new Map(
    Object.values(EXERCISES)
      .flat()
      .map((entry) => [entry.name, entry]),
  ).values(),
);

export const exerciseDef = (name: string): ExerciseDef | undefined =>
  ALL_EXERCISES.find((e) => e.name === name);

export function orderedExerciseDefs(targets: Targets, split: SplitType): ExerciseDef[] {
  const canonical = EXERCISES[split];
  const saved = targets.legacyExerciseOrder?.[split];
  if (!saved?.length) return canonical;
  const byName = new Map(canonical.map((exercise) => [exercise.name, exercise]));
  const ordered = saved.flatMap((name) => {
    const exercise = byName.get(name);
    if (!exercise) return [];
    byName.delete(name);
    return [exercise];
  });
  return [...ordered, ...byName.values()];
}

export const DEFAULT_DATA: AppData = {
  days: {},
  workouts: {},
  photos: [],
  weekNotes: {},
  targets: {
    ...DEFAULT_NUTRITION_TARGETS,
    water: 3,
    startWeight: 61.5,
    targetWeight: 75,
  },
};
