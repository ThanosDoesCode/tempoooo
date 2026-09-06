import type { Equipment, ExperienceLevel, TrainingSetupPreference } from "./bulk-onboarding.ts";
import {
  EXERCISE_EQUIPMENT,
  type ExerciseEquipment,
  type LibraryExercise,
  type UnilateralMode,
} from "./exercise-library.ts";

export type TrainingPlanExercise = {
  id: string;
  exerciseId: string | null;
  sourceSystemExerciseId: string | null;
  name: string;
  order: number;
  sets: number;
  repMin: number;
  repMax: number;
  intendedUnilateralMode: UnilateralMode;
  notes: string | null;
  supportsUnilateral: boolean;
};

export type TrainingPlanDay = {
  id: string;
  order: number;
  name: string;
  exercises: TrainingPlanExercise[];
};

export type TrainingPlanTemplate = {
  id: string;
  slug: string;
  name: string;
  description: string;
  experienceLevel: ExperienceLevel;
  trainingDaysPerWeek: number;
  requiredEquipment: ExerciseEquipment[];
  splitSummary: string;
  days: TrainingPlanDay[];
};

export type UserTrainingPlan = {
  id: string;
  sourceTemplateId: string | null;
  planType: TrainingSetupPreference;
  name: string;
  description: string;
  experienceLevel: ExperienceLevel | null;
  trainingDaysPerWeek: number;
  updatedAt: string;
  days: TrainingPlanDay[];
};

export type EditableTrainingPlan = Pick<UserTrainingPlan, "id" | "name" | "updatedAt" | "days">;

export function moveOrderedItem<T>(items: T[], from: number, to: number): T[] {
  if (from < 0 || from >= items.length || to < 0 || to >= items.length || from === to) return items;
  const next = [...items];
  const [item] = next.splice(from, 1);
  next.splice(to, 0, item!);
  return next;
}

export function replaceTrainingPlanExercise(
  current: TrainingPlanExercise,
  replacement: LibraryExercise,
): TrainingPlanExercise {
  return {
    ...current,
    exerciseId: replacement.id,
    sourceSystemExerciseId: replacement.is_system ? replacement.id : null,
    name: replacement.name,
    supportsUnilateral: replacement.supports_unilateral,
    intendedUnilateralMode:
      replacement.supports_unilateral && current.intendedUnilateralMode === "unilateral"
        ? "unilateral"
        : "bilateral",
  };
}

export function validateTrainingPlanDraft(plan: EditableTrainingPlan): string[] {
  const errors: string[] = [];
  if (plan.name.trim().length < 2 || plan.name.trim().length > 80)
    errors.push("Plan name must be between 2 and 80 characters.");
  if (plan.days.length > 6) errors.push("A plan can contain up to 6 workout days.");
  plan.days.forEach((day, dayIndex) => {
    if (!day.name.trim() || day.name.trim().length > 60)
      errors.push(`Day ${dayIndex + 1} needs a valid name.`);
    if (day.exercises.length > 20)
      errors.push(`${day.name || `Day ${dayIndex + 1}`} can contain up to 20 exercises.`);
    day.exercises.forEach((exercise) => {
      if (!Number.isInteger(exercise.sets) || exercise.sets < 1 || exercise.sets > 10)
        errors.push(`${exercise.name}: sets must be between 1 and 10.`);
      if (
        !Number.isInteger(exercise.repMin) ||
        !Number.isInteger(exercise.repMax) ||
        exercise.repMin < 1 ||
        exercise.repMax > 100 ||
        exercise.repMin > exercise.repMax
      )
        errors.push(`${exercise.name}: enter a valid rep range from 1 to 100.`);
      if (exercise.intendedUnilateralMode === "unilateral" && !exercise.supportsUnilateral)
        errors.push(`${exercise.name} does not support unilateral mode.`);
      if ((exercise.notes?.length ?? 0) > 240)
        errors.push(`${exercise.name}: notes must be 240 characters or less.`);
    });
  });
  return errors;
}

const FULL_GYM_EQUIPMENT = new Set<ExerciseEquipment>(EXERCISE_EQUIPMENT);

const equipmentMap: Record<Equipment, ExerciseEquipment[]> = {
  full_gym: [...FULL_GYM_EQUIPMENT],
  barbell: ["barbell"],
  dumbbells: ["dumbbell"],
  cables: ["cable"],
  machines: ["machine", "smith_machine"],
  bench: ["bench"],
  pull_up_bar: ["pull_up_bar"],
  bodyweight_only: ["bodyweight"],
};

export function availableExerciseEquipment(selected: Equipment[]): Set<ExerciseEquipment> {
  if (selected.includes("full_gym")) return new Set(FULL_GYM_EQUIPMENT);
  const available = new Set<ExerciseEquipment>(["bodyweight"]);
  selected.forEach((item) => equipmentMap[item].forEach((equipment) => available.add(equipment)));
  return available;
}

export type PlanCompatibility = {
  exactExperience: boolean;
  exactDays: boolean;
  equipmentCompatible: boolean;
  missingEquipment: ExerciseEquipment[];
  exact: boolean;
};

export function planCompatibility(
  plan: TrainingPlanTemplate,
  experienceLevel: ExperienceLevel,
  trainingDaysPerWeek: number,
  equipment: Equipment[],
): PlanCompatibility {
  const available = availableExerciseEquipment(equipment);
  const missingEquipment = plan.requiredEquipment.filter((item) => !available.has(item));
  const exactExperience = plan.experienceLevel === experienceLevel;
  const exactDays = plan.trainingDaysPerWeek === trainingDaysPerWeek;
  const equipmentCompatible = missingEquipment.length === 0;
  return {
    exactExperience,
    exactDays,
    equipmentCompatible,
    missingEquipment,
    exact: exactExperience && exactDays && equipmentCompatible,
  };
}

const experienceRank: Record<ExperienceLevel, number> = {
  beginner: 0,
  intermediate: 1,
  advanced: 2,
};

export function rankTrainingPlans(
  plans: TrainingPlanTemplate[],
  experienceLevel: ExperienceLevel,
  trainingDaysPerWeek: number,
  equipment: Equipment[],
): TrainingPlanTemplate[] {
  return [...plans].sort((left, right) => {
    const a = planCompatibility(left, experienceLevel, trainingDaysPerWeek, equipment);
    const b = planCompatibility(right, experienceLevel, trainingDaysPerWeek, equipment);
    const score = (plan: TrainingPlanTemplate, compatibility: PlanCompatibility) =>
      (compatibility.equipmentCompatible
        ? 0
        : 10_000 + compatibility.missingEquipment.length * 100) +
      Math.abs(plan.trainingDaysPerWeek - trainingDaysPerWeek) * 20 +
      Math.abs(experienceRank[plan.experienceLevel] - experienceRank[experienceLevel]) * 10;
    return score(left, a) - score(right, b) || left.name.localeCompare(right.name);
  });
}

export function recommendTrainingPlan(
  plans: TrainingPlanTemplate[],
  experienceLevel: ExperienceLevel,
  trainingDaysPerWeek: number,
  equipment: Equipment[],
): TrainingPlanTemplate | null {
  return rankTrainingPlans(plans, experienceLevel, trainingDaysPerWeek, equipment)[0] ?? null;
}

export function formatEquipment(value: ExerciseEquipment): string {
  return value.replaceAll("_", " ");
}
