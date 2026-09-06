import { addDays, format, parseISO, startOfWeek } from "date-fns";

export type BulkWeightEntry = {
  id: string;
  bulkProfileId: string;
  logDate: string;
  weightKg: number;
  note: string | null;
  createdAt: string;
  updatedAt: string;
};

export type BulkProgressPhoto = {
  id: string;
  bulkProfileId: string;
  logDate: string;
  storagePath: string;
  viewType: "front" | "side" | "back" | "other";
  note: string | null;
  signedUrl: string | null;
  createdAt: string;
};

export type BulkNutritionProgressDay = {
  logDate: string;
  calories: number;
  protein: number;
  targetCalories: number;
};

export type BulkWeeklyProgressSummary = {
  weekStart: string;
  weekEnd: string;
  weightAverageKg: number | null;
  previousWeightAverageKg: number | null;
  weightChangeKg: number | null;
  weightEntryCount: number;
  previousWeightEntryCount: number;
  targetWeeklyGainKg: number | null;
  averageCalories: number | null;
  averageProtein: number | null;
  nutritionLoggedDays: number;
  calorieAdherentDays: number;
  targetCalories: number | null;
  completedWorkouts: number;
  plannedWorkouts: number | null;
};

export const CALORIE_ADHERENCE_TOLERANCE = 0.1;
export const localDay = (date: Date) => format(date, "yyyy-MM-dd");

export function bulkWeek(day: string) {
  const start = startOfWeek(parseISO(day), { weekStartsOn: 1 });
  return { start: localDay(start), end: localDay(addDays(start, 6)) };
}

const rounded = (value: number, digits = 2) => Number(value.toFixed(digits));
const average = (values: number[]) =>
  values.length ? rounded(values.reduce((sum, value) => sum + value, 0) / values.length) : null;

export function weeklyWeightAverage(entries: BulkWeightEntry[], weekStart: string) {
  const end = localDay(addDays(parseISO(weekStart), 6));
  const values = entries
    .filter((entry) => entry.logDate >= weekStart && entry.logDate <= end)
    .map((entry) => entry.weightKg);
  return { averageKg: average(values), count: values.length };
}

export function goalProgress(
  entries: BulkWeightEntry[],
  weekAverageKg: number | null,
  startWeightKg: number,
  targetWeightKg: number,
) {
  const latest = [...entries].sort((a, b) => b.logDate.localeCompare(a.logDate))[0];
  const currentWeightKg = weekAverageKg ?? latest?.weightKg ?? null;
  if (currentWeightKg == null)
    return {
      currentWeightKg: null,
      source: null,
      gainedKg: null,
      remainingKg: null,
      percent: 0,
    } as const;
  const span = targetWeightKg - startWeightKg;
  const rawPercent =
    span === 0
      ? currentWeightKg >= targetWeightKg
        ? 100
        : 0
      : ((currentWeightKg - startWeightKg) / span) * 100;
  return {
    currentWeightKg,
    source: weekAverageKg != null ? "weekly_average" : "latest_weight",
    gainedKg: rounded(currentWeightKg - startWeightKg),
    remainingKg: rounded(targetWeightKg - currentWeightKg),
    percent: Math.min(100, Math.max(0, rawPercent)),
  } as const;
}

export function trainingConsistency(
  completedDates: string[],
  weekStart: string,
  planned: number | null,
) {
  const end = localDay(addDays(parseISO(weekStart), 6));
  const completed = completedDates.filter((day) => day >= weekStart && day <= end).length;
  return {
    completed,
    planned,
    percent: planned && planned > 0 ? Math.min(100, rounded((completed / planned) * 100, 0)) : null,
  };
}

export function nutritionWeekSummary(days: BulkNutritionProgressDay[], weekStart: string) {
  const end = localDay(addDays(parseISO(weekStart), 6));
  const current = days.filter((day) => day.logDate >= weekStart && day.logDate <= end);
  return {
    loggedDays: current.length,
    averageCalories: average(current.map((day) => day.calories)),
    averageProtein: average(current.map((day) => day.protein)),
    targetCalories: average(current.map((day) => day.targetCalories)),
    calorieAdherentDays: current.filter(
      (day) =>
        Math.abs(day.calories - day.targetCalories) <=
        day.targetCalories * CALORIE_ADHERENCE_TOLERANCE,
    ).length,
  };
}

export function weeklyProgressSummary(args: {
  selectedDay: string;
  weights: BulkWeightEntry[];
  nutritionDays: BulkNutritionProgressDay[];
  completedWorkoutDates: string[];
  plannedWorkouts: number | null;
  targetWeeklyGainKg: number | null;
  currentTargetCalories?: number | null;
}): BulkWeeklyProgressSummary {
  const week = bulkWeek(args.selectedDay);
  const previousStart = localDay(addDays(parseISO(week.start), -7));
  const currentWeight = weeklyWeightAverage(args.weights, week.start);
  const previousWeight = weeklyWeightAverage(args.weights, previousStart);
  const nutrition = nutritionWeekSummary(args.nutritionDays, week.start);
  const training = trainingConsistency(
    args.completedWorkoutDates,
    week.start,
    args.plannedWorkouts,
  );
  return {
    weekStart: week.start,
    weekEnd: week.end,
    weightAverageKg: currentWeight.averageKg,
    previousWeightAverageKg: previousWeight.averageKg,
    weightChangeKg:
      currentWeight.averageKg != null && previousWeight.averageKg != null
        ? rounded(currentWeight.averageKg - previousWeight.averageKg)
        : null,
    weightEntryCount: currentWeight.count,
    previousWeightEntryCount: previousWeight.count,
    targetWeeklyGainKg: args.targetWeeklyGainKg,
    averageCalories: nutrition.averageCalories,
    averageProtein: nutrition.averageProtein,
    nutritionLoggedDays: nutrition.loggedDays,
    calorieAdherentDays: nutrition.calorieAdherentDays,
    targetCalories: nutrition.targetCalories ?? args.currentTargetCalories ?? null,
    completedWorkouts: training.completed,
    plannedWorkouts: training.planned,
  };
}

export function validateWeight(weight: number, date: string, today: string, note: string) {
  if (!Number.isFinite(weight) || weight < 20 || weight > 400)
    return "Enter a weight between 20 and 400 kg.";
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || date > today)
    return "Weight date cannot be in the future.";
  if (note.length > 240) return "Note must be 240 characters or fewer.";
  return null;
}
