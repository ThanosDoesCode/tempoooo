export const LEAN_BULK_WEEKLY_GAIN_RANGE = [0.2, 0.3] as const;

export const WEEKLY_GAIN_OPTIONS = [0.1, 0.2, 0.25, 0.3] as const;

export const PHYSIQUE_GOALS = [
  { value: "gain", label: "Gain muscle" },
  { value: "cut", label: "Lose fat" },
  { value: "maintain", label: "Recomp / maintain" },
] as const;

export const EXPERIENCE_LEVELS = [
  { value: "beginner", label: "Beginner" },
  { value: "intermediate", label: "Intermediate" },
  { value: "advanced", label: "Advanced" },
] as const;

export const TRAINING_DAY_OPTIONS = [2, 3, 4, 5, 6] as const;

export const EQUIPMENT_OPTIONS = [
  { value: "full_gym", label: "Full/commercial gym" },
  { value: "barbell", label: "Barbell" },
  { value: "dumbbells", label: "Dumbbells" },
  { value: "cables", label: "Cables" },
  { value: "machines", label: "Machines" },
  { value: "bench", label: "Bench" },
  { value: "pull_up_bar", label: "Pull-up bar" },
  { value: "bodyweight_only", label: "Bodyweight only" },
] as const;

export const TRAINING_SETUP_OPTIONS = [
  { value: "generated", label: "Build a plan for me" },
  { value: "tempo_preset", label: "Choose a Tempo plan" },
  { value: "custom", label: "Create my own plan" },
] as const;

export const DEFAULT_NUTRITION_TARGETS = {
  calories: 2900,
  protein: 130,
  carbs: 380,
  fat: 88,
} as const;

export type InitialNutritionRecommendation = {
  calories: number;
  protein: number;
  carbs: number;
  fat: number;
};

type RecommendationInput = Pick<
  BulkOnboardingValues,
  "goal" | "currentWeightKg" | "targetWeightKg" | "targetWeeklyGainKg" | "trainingDaysPerWeek"
>;

const roundTo = (value: number, step: number) => Math.round(value / step) * step;
const clamp = (value: number, minimum: number, maximum: number) =>
  Math.min(maximum, Math.max(minimum, value));

/**
 * Produces conservative starting targets from the information collected during
 * onboarding. Weekly check-ins remain responsible for later calorie changes.
 */
export function recommendInitialNutritionTargets(
  input: RecommendationInput,
): InitialNutritionRecommendation | null {
  const { goal, currentWeightKg, targetWeightKg, targetWeeklyGainKg, trainingDaysPerWeek } = input;
  if (
    !Number.isFinite(currentWeightKg) ||
    !Number.isFinite(targetWeightKg) ||
    !Number.isFinite(targetWeeklyGainKg) ||
    !Number.isInteger(trainingDaysPerWeek) ||
    currentWeightKg < 20 ||
    currentWeightKg > 400 ||
    targetWeightKg > 450 ||
    targetWeightKg < 20 ||
    !PHYSIQUE_GOALS.some((option) => option.value === goal) ||
    trainingDaysPerWeek < 2 ||
    trainingDaysPerWeek > 6
  )
    return null;

  if (
    (goal === "gain" &&
      (targetWeightKg <= currentWeightKg ||
        targetWeeklyGainKg < 0.05 ||
        targetWeeklyGainKg > 1.5)) ||
    (goal === "cut" &&
      (targetWeightKg >= currentWeightKg ||
        targetWeeklyGainKg < 0.05 ||
        targetWeeklyGainKg > 1.5)) ||
    (goal === "maintain" &&
      (Math.abs(targetWeightKg - currentWeightKg) > Math.max(2, currentWeightKg * 0.05) ||
        targetWeeklyGainKg !== 0))
  )
    return null;

  const proteinFactor = goal === "cut" ? 2 : 1.8;
  const protein = roundTo(clamp(currentWeightKg * proteinFactor, 40, 300), 5);
  const fatFactor = goal === "cut" ? 0.7 : 0.8;
  const fatMinimum = goal === "cut" ? 45 : 50;
  const fat = roundTo(clamp(Math.max(currentWeightKg * fatFactor, fatMinimum), 40, 180), 5);
  const goalGapKg = targetWeightKg - currentWeightKg;
  const planningWeightKg =
    currentWeightKg + Math.sign(goalGapKg) * Math.min(Math.abs(goalGapKg) * 0.1, 2.5);
  const maintenanceFactor = 30 + trainingDaysPerWeek * 0.75;
  const maintenanceCalories = planningWeightKg * maintenanceFactor;
  const gainAdjustment = (targetWeeklyGainKg * 7700) / 7;
  const cutAdjustment = -clamp((Math.abs(targetWeeklyGainKg) * 7700) / 7, 250, 600);
  const calorieAdjustment = goal === "gain" ? gainAdjustment : goal === "cut" ? cutAdjustment : 0;
  const macroMinimumCalories = protein * 4 + fat * 9;
  const calories = clamp(
    roundTo(maintenanceCalories + calorieAdjustment, 50),
    Math.max(800, macroMinimumCalories + 20),
    10000,
  );
  const remainingCalories = Math.max(0, calories - macroMinimumCalories);
  const carbs = Math.min(1000, Math.floor(remainingCalories / 20) * 5);

  return { calories, protein, carbs, fat };
}

export type ExperienceLevel = (typeof EXPERIENCE_LEVELS)[number]["value"];
export type PhysiqueGoal = (typeof PHYSIQUE_GOALS)[number]["value"];
export type Equipment = (typeof EQUIPMENT_OPTIONS)[number]["value"];
export type TrainingSetupPreference = (typeof TRAINING_SETUP_OPTIONS)[number]["value"];

export type BulkOnboardingValues = {
  goal: PhysiqueGoal;
  currentWeightKg: number;
  targetWeightKg: number;
  targetWeeklyGainKg: number;
  experienceLevel: ExperienceLevel;
  trainingDaysPerWeek: number;
  availableEquipment: Equipment[];
  trainingSetupPreference: TrainingSetupPreference;
  calories: number;
  protein: number;
  carbs: number;
  fat: number;
};

export type BulkOnboardingField = keyof BulkOnboardingValues;
export type BulkOnboardingErrors = Partial<Record<BulkOnboardingField, string>>;

const experienceValues = new Set<string>(EXPERIENCE_LEVELS.map(({ value }) => value));
const goalValues = new Set<string>(PHYSIQUE_GOALS.map(({ value }) => value));
const equipmentValues = new Set<string>(EQUIPMENT_OPTIONS.map(({ value }) => value));
const setupValues = new Set<string>(TRAINING_SETUP_OPTIONS.map(({ value }) => value));

export function validateBulkOnboarding(values: BulkOnboardingValues): BulkOnboardingErrors {
  const errors: BulkOnboardingErrors = {};
  if (!goalValues.has(values.goal)) errors.goal = "Choose a physique goal.";
  if (
    !Number.isFinite(values.currentWeightKg) ||
    values.currentWeightKg < 20 ||
    values.currentWeightKg > 400
  )
    errors.currentWeightKg = "Enter a current weight between 20 and 400 kg.";
  if (
    !Number.isFinite(values.targetWeightKg) ||
    values.targetWeightKg < 20 ||
    values.targetWeightKg > 450
  )
    errors.targetWeightKg = "Enter a target weight between 20 and 450 kg.";
  else if (values.goal === "gain" && values.targetWeightKg <= values.currentWeightKg)
    errors.targetWeightKg = "A muscle-gain target must be above your current weight.";
  else if (values.goal === "cut" && values.targetWeightKg >= values.currentWeightKg)
    errors.targetWeightKg = "A fat-loss target must be below your current weight.";
  else if (
    values.goal === "maintain" &&
    Math.abs(values.targetWeightKg - values.currentWeightKg) >
      Math.max(2, values.currentWeightKg * 0.05)
  )
    errors.targetWeightKg = "A maintenance target should stay close to your current weight.";
  if (
    values.goal === "gain" &&
    (!Number.isFinite(values.targetWeeklyGainKg) ||
      values.targetWeeklyGainKg < 0.05 ||
      values.targetWeeklyGainKg > 1.5)
  )
    errors.targetWeeklyGainKg = "Enter a weekly gain between 0.05 and 1.5 kg.";
  if (
    values.goal === "cut" &&
    (!Number.isFinite(values.targetWeeklyGainKg) ||
      values.targetWeeklyGainKg < 0.05 ||
      values.targetWeeklyGainKg > 1.5)
  )
    errors.targetWeeklyGainKg = "Enter a weekly loss between 0.05 and 1.5 kg.";
  if (values.goal === "maintain" && values.targetWeeklyGainKg !== 0)
    errors.targetWeeklyGainKg = "Maintenance uses a 0 kg weekly change target.";
  if (!experienceValues.has(values.experienceLevel))
    errors.experienceLevel = "Choose your experience level.";
  if (!TRAINING_DAY_OPTIONS.includes(values.trainingDaysPerWeek as 2 | 3 | 4 | 5 | 6))
    errors.trainingDaysPerWeek = "Choose between 2 and 6 training days.";
  if (
    !values.availableEquipment.length ||
    values.availableEquipment.some((v) => !equipmentValues.has(v)) ||
    (values.availableEquipment.includes("bodyweight_only") && values.availableEquipment.length > 1)
  )
    errors.availableEquipment = "Choose at least one available equipment option.";
  if (!setupValues.has(values.trainingSetupPreference))
    errors.trainingSetupPreference = "Choose how you want to train.";
  if (!Number.isInteger(values.calories) || values.calories < 800 || values.calories > 10000)
    errors.calories = "Enter a daily calorie target between 800 and 10,000.";
  for (const key of ["protein", "carbs", "fat"] as const) {
    if (!Number.isInteger(values[key]) || values[key] < 1 || values[key] > 1000)
      errors[key] = `Enter ${key} between 1 and 1,000 g.`;
  }
  return errors;
}
