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
 * allows. The caller computes the three flags from whichever data source the user's mode uses
 * (legacy logs or normalized Supabase rows), so availability is identical across modes. Overview
 * always shows and adapts to the rest. Order matches the handoff.
 */
export function availableProgressSections(flags: {
  hasChallenge: boolean;
  hasStrength: boolean;
  hasBodyFood: boolean;
}): ProgressSection[] {
  const sections: ProgressSection[] = ["overview"];
  if (flags.hasChallenge) sections.push("endurance");
  if (flags.hasStrength) sections.push("strength");
  if (flags.hasBodyFood) sections.push("body");
  return sections;
}
