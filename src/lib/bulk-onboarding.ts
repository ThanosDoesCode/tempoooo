export const LEAN_BULK_WEEKLY_GAIN_RANGE = [0.2, 0.3] as const;

export const WEEKLY_GAIN_OPTIONS = [0.1, 0.2, 0.25, 0.3] as const;

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

export type ExperienceLevel = (typeof EXPERIENCE_LEVELS)[number]["value"];
export type Equipment = (typeof EQUIPMENT_OPTIONS)[number]["value"];
export type TrainingSetupPreference = (typeof TRAINING_SETUP_OPTIONS)[number]["value"];

export type BulkOnboardingValues = {
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
const equipmentValues = new Set<string>(EQUIPMENT_OPTIONS.map(({ value }) => value));
const setupValues = new Set<string>(TRAINING_SETUP_OPTIONS.map(({ value }) => value));

export function validateBulkOnboarding(values: BulkOnboardingValues): BulkOnboardingErrors {
  const errors: BulkOnboardingErrors = {};
  if (
    !Number.isFinite(values.currentWeightKg) ||
    values.currentWeightKg < 20 ||
    values.currentWeightKg > 400
  )
    errors.currentWeightKg = "Enter a current weight between 20 and 400 kg.";
  if (!Number.isFinite(values.targetWeightKg) || values.targetWeightKg <= values.currentWeightKg)
    errors.targetWeightKg = "Target weight must be greater than your current weight.";
  else if (values.targetWeightKg > 450)
    errors.targetWeightKg = "Enter a target weight of 450 kg or less.";
  if (
    !Number.isFinite(values.targetWeeklyGainKg) ||
    values.targetWeeklyGainKg < 0.05 ||
    values.targetWeeklyGainKg > 1.5
  )
    errors.targetWeeklyGainKg = "Enter a weekly gain between 0.05 and 1.5 kg.";
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
