export type WorkoutType = "Chest & Back" | "Legs" | "Arms & Shoulders" | "Rest";
export type SplitType = Exclude<WorkoutType, "Rest">;

export type MealPlanId = "beef" | "lentil" | "kebab" | "salmon" | "custom";

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
    { name: "Declined Leg Press", min: 8, max: 12 },
    { name: "Leg Extensions", min: 10, max: 15 },
    { name: "Romanian Deadlifts", min: 6, max: 10 },
    { name: "Leg Curls", min: 10, max: 15 },
    { name: "Calf Raises", min: 12, max: 20 },
  ],
  "Arms & Shoulders": [
    { name: "Chin-Ups", min: 5, max: 10, loadKind: "bodyweight" },
    { name: "Incline Dumbbell Curls", min: 8, max: 12, loadKind: "dumbbell-pair" },
    { name: "Tricep Pushdowns", min: 10, max: 15 },
    { name: "Overhead Tricep Extensions", min: 10, max: 15 },
    { name: "Lateral Raises", min: 12, max: 18 },
  ],
};

export const ALL_EXERCISES: ExerciseDef[] = Object.values(EXERCISES).flat();

export const exerciseDef = (name: string): ExerciseDef | undefined =>
  ALL_EXERCISES.find((e) => e.name === name);

export const DEFAULT_DATA: AppData = {
  days: {},
  workouts: {},
  photos: [],
  weekNotes: {},
  targets: {
    calories: 2900,
    protein: 130,
    carbs: 380,
    fat: 88,
    water: 3,
    startWeight: 61.5,
    targetWeight: 75,
  },
};
