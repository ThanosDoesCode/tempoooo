import type { AppData } from "./types.ts";

export type ProgressSection = "overview" | "endurance" | "strength" | "body";

/** Meaningful training context: at least one non-draft workout with a logged set. */
export function hasStrengthData(data: AppData): boolean {
  return Object.values(data.workouts).some(
    (workout) =>
      workout.status !== "draft" &&
      workout.entries.some((entry) => entry.weight != null || entry.reps.some((r) => r != null)),
  );
}

/** Relevant body/food data: a logged weight, a logged calorie day, or a progress photo. */
export function hasBodyFoodData(data: AppData): boolean {
  return (
    Object.values(data.days).some((day) => day.weight != null || day.calories != null) ||
    data.photos.length > 0
  );
}

/** Product availability controls navigation; missing measurements only affect tile content. */
export function availableProgressSections(features: {
  hasFitnessTools: boolean;
}): ProgressSection[] {
  return features.hasFitnessTools
    ? ["overview", "endurance", "strength", "body"]
    : ["overview", "endurance"];
}
