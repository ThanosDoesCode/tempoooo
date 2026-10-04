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

/**
 * The Progress sections a user actually has usable data for — not merely what the onboarding guard
 * allows. Endurance needs challenge context; Strength needs logged training; Body & food needs a
 * weight, a logged day or a photo. Overview always shows and adapts to the rest. Order matches the
 * handoff (Overview · Endurance · Strength · Body & food).
 */
export function availableProgressSections(
  data: AppData | null,
  hasChallenge: boolean,
): ProgressSection[] {
  const sections: ProgressSection[] = ["overview"];
  if (hasChallenge) sections.push("endurance");
  if (data && hasStrengthData(data)) sections.push("strength");
  if (data && hasBodyFoodData(data)) sections.push("body");
  return sections;
}
