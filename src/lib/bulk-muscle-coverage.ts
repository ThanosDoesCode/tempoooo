import { MUSCLE_GROUPS, type LibraryExercise, type MuscleGroup } from "./exercise-library.ts";
import type { UserTrainingPlan } from "./training-plans.ts";

export const PRIMARY_SET_WEIGHT = 1;
export const SECONDARY_SET_WEIGHT = 0.5;
export const COVERAGE_THRESHOLDS = { moderate: 4, high: 8, veryHigh: 16 } as const;

export type MuscleCoverageStatus = "not_trained" | "low" | "moderate" | "high" | "very_high";
export type MuscleCoverage = {
  muscle: MuscleGroup;
  primarySets: number;
  secondarySets: number;
  effectiveSets: number;
  exerciseCount: number;
  dayCount: number;
  status: MuscleCoverageStatus;
};
export type CoverageAdvisory = {
  id: string;
  label: string;
  kind: "gap" | "distribution" | "high_volume";
  message: string;
  muscles: MuscleGroup[];
};
export type CoverageGroup = {
  id: "back" | "shoulders" | "core";
  label: string;
  muscles: MuscleGroup[];
  effectiveSets: number;
  hasMeaningfulCoverage: boolean;
};
export type BulkMuscleCoverageResult = {
  muscles: MuscleCoverage[];
  groups: CoverageGroup[];
  summary: { headline: string; gapCount: number; trainedMuscleCount: number };
  gaps: CoverageAdvisory[];
  highVolume: CoverageAdvisory[];
  advisories: CoverageAdvisory[];
  balanced: boolean;
  dataStatus: "complete" | "incomplete_metadata" | "no_plan";
  missingExerciseIds: string[];
};

export type CoverageExerciseMetadata = Pick<
  LibraryExercise,
  "id" | "primary_muscle" | "secondary_muscles" | "active"
>;

const MUSCLE_LABELS: Partial<Record<MuscleGroup, string>> = {
  upper_back: "Upper back",
  front_delts: "Front delts",
  side_delts: "Side delts",
  rear_delts: "Rear delts",
  lower_back: "Lower back",
};
export const muscleLabel = (muscle: MuscleGroup) =>
  MUSCLE_LABELS[muscle] ?? muscle.charAt(0).toUpperCase() + muscle.slice(1);

export function coverageStatus(effectiveSets: number): MuscleCoverageStatus {
  if (effectiveSets === 0) return "not_trained";
  if (effectiveSets < COVERAGE_THRESHOLDS.moderate) return "low";
  if (effectiveSets < COVERAGE_THRESHOLDS.high) return "moderate";
  if (effectiveSets <= COVERAGE_THRESHOLDS.veryHigh) return "high";
  return "very_high";
}

const GAP_GROUPS: Array<{ id: string; label: string; muscles: MuscleGroup[] }> = [
  { id: "chest", label: "Chest", muscles: ["chest"] },
  { id: "back", label: "Pulling and back", muscles: ["lats", "upper_back"] },
  { id: "shoulders", label: "Shoulders", muscles: ["front_delts", "side_delts", "rear_delts"] },
  { id: "biceps", label: "Biceps", muscles: ["biceps"] },
  { id: "triceps", label: "Triceps", muscles: ["triceps"] },
  { id: "quads", label: "Quads", muscles: ["quads"] },
  { id: "hamstrings", label: "Hamstrings", muscles: ["hamstrings"] },
  { id: "glutes", label: "Glutes", muscles: ["glutes"] },
  { id: "calves", label: "Calves", muscles: ["calves"] },
  { id: "core", label: "Core", muscles: ["abs", "obliques", "lower_back"] },
];

export function calculateMuscleCoverage(
  plan: Pick<UserTrainingPlan, "days"> | null,
  metadata: CoverageExerciseMetadata[],
): BulkMuscleCoverageResult {
  const values = new Map(
    MUSCLE_GROUPS.map((muscle) => [
      muscle,
      { primarySets: 0, secondarySets: 0, exercises: new Set<string>(), days: new Set<string>() },
    ]),
  );
  const byId = new Map(metadata.map((exercise) => [exercise.id, exercise]));
  const missing = new Set<string>();

  for (const day of plan?.days ?? []) {
    for (const planned of day.exercises) {
      if (!planned.exerciseId) {
        missing.add(planned.id);
        continue;
      }
      const exercise = byId.get(planned.exerciseId);
      if (!exercise?.active) {
        missing.add(planned.exerciseId);
        continue;
      }
      const sets = Number.isFinite(planned.sets) && planned.sets > 0 ? planned.sets : 0;
      if (!sets) continue;
      const primary = values.get(exercise.primary_muscle)!;
      primary.primarySets += sets;
      primary.exercises.add(planned.exerciseId);
      primary.days.add(day.id);
      for (const muscle of new Set(exercise.secondary_muscles)) {
        if (muscle === exercise.primary_muscle || !values.has(muscle)) continue;
        const secondary = values.get(muscle)!;
        secondary.secondarySets += sets;
        secondary.exercises.add(planned.exerciseId);
        secondary.days.add(day.id);
      }
    }
  }

  const muscles = MUSCLE_GROUPS.map((muscle): MuscleCoverage => {
    const value = values.get(muscle)!;
    const effectiveSets = Number(
      (value.primarySets * PRIMARY_SET_WEIGHT + value.secondarySets * SECONDARY_SET_WEIGHT).toFixed(
        2,
      ),
    );
    return {
      muscle,
      primarySets: value.primarySets,
      secondarySets: value.secondarySets,
      effectiveSets,
      exerciseCount: value.exercises.size,
      dayCount: value.days.size,
      status: coverageStatus(effectiveSets),
    };
  });
  const get = (muscle: MuscleGroup) => muscles.find((row) => row.muscle === muscle)!;
  const groupDefinitions: Array<Pick<CoverageGroup, "id" | "label" | "muscles">> = [
    { id: "back", label: "Back", muscles: ["lats", "upper_back"] },
    { id: "shoulders", label: "Shoulders", muscles: ["front_delts", "side_delts", "rear_delts"] },
    { id: "core", label: "Core", muscles: ["abs", "obliques", "lower_back"] },
  ];
  const groups: CoverageGroup[] = groupDefinitions.map((group) => ({
    ...group,
    effectiveSets: Number(
      group.muscles.reduce((sum, muscle) => sum + get(muscle).effectiveSets, 0).toFixed(2),
    ),
    hasMeaningfulCoverage: group.muscles.some(
      (muscle) => get(muscle).effectiveSets >= COVERAGE_THRESHOLDS.moderate,
    ),
  }));

  const gaps = GAP_GROUPS.filter(
    (group) =>
      !group.muscles.some((muscle) => get(muscle).effectiveSets >= COVERAGE_THRESHOLDS.moderate),
  ).map((group): CoverageAdvisory => ({
    id: `gap:${group.id}`,
    label: group.label,
    kind: "gap",
    muscles: group.muscles,
    message: `${group.label} has low coverage. Consider adding relevant working sets if it is a priority.`,
  }));
  const distribution: CoverageAdvisory[] = (["side_delts", "rear_delts"] as MuscleGroup[])
    .filter((muscle) => get(muscle).effectiveSets === 0)
    .map((muscle) => ({
      id: `distribution:${muscle}`,
      label: muscleLabel(muscle),
      kind: "distribution",
      muscles: [muscle],
      message: `${muscleLabel(muscle)} receive no direct or indirect work, even if total shoulder volume is high.`,
    }));
  const highVolume = muscles
    .filter((row) => row.status === "very_high")
    .map((row): CoverageAdvisory => ({
      id: `high:${row.muscle}`,
      label: muscleLabel(row.muscle),
      kind: "high_volume",
      muscles: [row.muscle],
      message: `${muscleLabel(row.muscle)} receives very high weekly volume when direct and indirect work are combined.`,
    }));
  const balanced = gaps.length === 0;
  return {
    muscles,
    groups,
    summary: {
      headline: balanced
        ? "Good overall coverage"
        : `${gaps.length} muscle group${gaps.length === 1 ? " has" : "s have"} low coverage`,
      gapCount: gaps.length,
      trainedMuscleCount: muscles.filter((row) => row.effectiveSets > 0).length,
    },
    gaps,
    highVolume,
    advisories: [...gaps, ...distribution, ...highVolume],
    balanced,
    dataStatus: !plan?.days.length ? "no_plan" : missing.size ? "incomplete_metadata" : "complete",
    missingExerciseIds: [...missing].sort(),
  };
}
