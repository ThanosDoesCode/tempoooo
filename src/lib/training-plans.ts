import type { Equipment, ExperienceLevel, TrainingSetupPreference } from "./bulk-onboarding.ts";
import {
  EXERCISE_EQUIPMENT,
  type ExerciseEquipment,
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
  days: TrainingPlanDay[];
};

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
