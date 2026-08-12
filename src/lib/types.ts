export type WorkoutType = "Chest & Back" | "Legs" | "Arms & Shoulders" | "Rest";

export type DailyLog = {
  date: string; // yyyy-MM-dd
  weight?: number;
  waist?: number;
  sleepHours?: number;
  sleepQuality?: number;
  calories?: number;
  protein?: number;
  carbs?: number;
  fat?: number;
  creatine?: boolean;
  water?: number;
  steps?: number;
  cyclingKm?: number;
  runningKm?: number;
  cardioMin?: number;
  note?: string;
  gym?: boolean;
  workoutType?: WorkoutType;
};

export type ExerciseEntry = {
  exercise: string;
  weight?: number;
  reps: (number | undefined)[]; // 3 sets
  notes?: string;
};

export type Workout = {
  date: string;
  type: Exclude<WorkoutType, "Rest">;
  entries: ExerciseEntry[];
};

export type PhotoSet = {
  id: string;
  date: string;
  weight?: number;
  front?: string;
  side?: string;
  back?: string;
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

export const EXERCISES: Record<Exclude<WorkoutType, "Rest">, string[]> = {
  "Chest & Back": [
    "Incline Dumbbell Press",
    "Cable Low-to-High Fly",
    "Pull-Ups",
    "Cable Rows",
    "Face Pulls",
  ],
  Legs: [
    "Declined Leg Press",
    "Leg Extensions",
    "Romanian Deadlifts",
    "Leg Curls",
    "Calf Raises",
  ],
  "Arms & Shoulders": [
    "Chin-Ups",
    "Incline Dumbbell Curls",
    "Tricep Pushdowns",
    "Overhead Tricep Extensions",
    "Lateral Raises",
  ],
};

export const DEFAULT_DATA: AppData = {
  days: {},
  workouts: {},
  photos: [],
  weekNotes: {},
  targets: {
    calories: 2900,
    protein: 130,
    carbs: 380,
    fat: 85,
    water: 3,
    startWeight: 61.5,
    targetWeight: 75,
  },
};
