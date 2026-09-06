import type { BulkWeeklyProgressSummary } from "./bulk-progress";

export const RECOMMENDATION_MIN_CURRENT_WEIGH_INS = 3;
export const RECOMMENDATION_MIN_PREVIOUS_WEIGH_INS = 3;
export const RECOMMENDATION_MIN_NUTRITION_DAYS = 4;
export const RECOMMENDATION_WEIGHT_TOLERANCE_KG = 0.15;
export const RECOMMENDATION_CALORIE_STEP = 150;
export const RECOMMENDATION_CALORIE_ADHERENCE_RATIO = 0.95;
export const RECOMMENDATION_LOW_TRAINING_RATIO = 0.5;

export type BulkRecommendationDecision =
  "maintain" | "increase_calories" | "decrease_calories" | "insufficient_data";

export type BulkRecommendationReason =
  | "on_target"
  | "below_target_good_adherence"
  | "below_target_low_adherence"
  | "below_target_low_training"
  | "above_target_confirmed"
  | "above_target_single_week"
  | "insufficient_weight_data"
  | "insufficient_history"
  | "insufficient_nutrition_data"
  | "missing_target"
  | "goal_reached";

export type BulkWeeklyRecommendation = {
  decision: BulkRecommendationDecision;
  reasonCode: BulkRecommendationReason;
  recommendedCalories: number | null;
  currentTargetCalories: number | null;
  calorieDelta: number;
  actualWeeklyChangeKg: number | null;
  targetWeeklyGainKg: number | null;
  dataQuality: "insufficient" | "limited" | "strong";
  weightConfidence: "insufficient" | "strong";
  nutritionConfidence: "limited" | "strong";
  trainingContext: "unknown" | "low" | "adequate";
  headline: string;
  reasonText: string;
};

export type BulkWeeklyRecommendationInput = {
  summary: BulkWeeklyProgressSummary;
  previousTrendChangeKg: number | null;
  previousTrendComparable: boolean;
  targetWeightReached: boolean;
};

const practicalCalories = (current: number, direction: 1 | -1) =>
  direction === 1
    ? Math.floor((current + RECOMMENDATION_CALORIE_STEP) / 50) * 50
    : Math.ceil((current - RECOMMENDATION_CALORIE_STEP) / 50) * 50;

const copyFor = (reason: BulkRecommendationReason, calories: number | null) => {
  const current =
    calories == null ? "your current target" : `${Math.round(calories).toLocaleString()} kcal`;
  switch (reason) {
    case "on_target":
      return [
        "Maintain current calories",
        `Your completed-week weight trend is close to target. Keep ${current}.`,
      ] as const;
    case "below_target_good_adherence":
      return [
        "Increase calories slightly",
        "Weight gain was below target despite consistent intake and training. A small adjustment is reasonable.",
      ] as const;
    case "below_target_low_adherence":
      return [
        "Keep the target and improve consistency",
        `Average intake was below the current target. Aim to hit ${current} more consistently before increasing it.`,
      ] as const;
    case "below_target_low_training":
      return [
        "Maintain calories and train consistently",
        "Training consistency was low. Complete a more representative training week before raising calories.",
      ] as const;
    case "above_target_confirmed":
      return [
        "Decrease calories slightly",
        "Weight gain exceeded the target range across two comparable completed weeks. A small reduction is reasonable.",
      ] as const;
    case "above_target_single_week":
      return [
        "Maintain and recheck",
        "Weight gain was above target for one completed week. Keep calories steady and confirm the trend before reducing them.",
      ] as const;
    case "insufficient_nutrition_data":
      return [
        "Maintain while collecting nutrition data",
        "Weight data is available, but at least four logged nutrition days are needed before changing the target.",
      ] as const;
    case "goal_reached":
      return [
        "Goal reached",
        "Your target weight has been reached. Keep the current target for now; this Bulk check-in does not create a cutting plan.",
      ] as const;
    case "missing_target":
      return [
        "Target unavailable",
        "A valid weekly gain and calorie target are required before Tempo can evaluate an adjustment.",
      ] as const;
    case "insufficient_history":
      return [
        "Keep current targets for now",
        "We need two completed weeks of weight data before adjusting calories.",
      ] as const;
    default:
      return [
        "Collect more weight data",
        "Log at least three weigh-ins in each of two completed weeks before adjusting calories.",
      ] as const;
  }
};

export function recommendBulkCalories(
  input: BulkWeeklyRecommendationInput,
): BulkWeeklyRecommendation {
  const s = input.summary;
  const weightStrong =
    s.weightEntryCount >= RECOMMENDATION_MIN_CURRENT_WEIGH_INS &&
    s.previousWeightEntryCount >= RECOMMENDATION_MIN_PREVIOUS_WEIGH_INS;
  const nutritionStrong = s.nutritionLoggedDays >= RECOMMENDATION_MIN_NUTRITION_DAYS;
  const trainingContext =
    s.plannedWorkouts == null
      ? "unknown"
      : s.plannedWorkouts > 0 &&
          s.completedWorkouts / s.plannedWorkouts < RECOMMENDATION_LOW_TRAINING_RATIO
        ? "low"
        : "adequate";
  const base = (
    decision: BulkRecommendationDecision,
    reasonCode: BulkRecommendationReason,
    recommended: number | null,
    quality: BulkWeeklyRecommendation["dataQuality"],
  ): BulkWeeklyRecommendation => {
    const [headline, reasonText] = copyFor(reasonCode, s.targetCalories);
    return {
      decision,
      reasonCode,
      recommendedCalories: recommended,
      currentTargetCalories: s.targetCalories,
      calorieDelta:
        recommended != null && s.targetCalories != null ? recommended - s.targetCalories : 0,
      actualWeeklyChangeKg: s.weightChangeKg,
      targetWeeklyGainKg: s.targetWeeklyGainKg,
      dataQuality: quality,
      weightConfidence: weightStrong ? "strong" : "insufficient",
      nutritionConfidence: nutritionStrong ? "strong" : "limited",
      trainingContext,
      headline,
      reasonText,
    };
  };
  if (
    s.targetWeeklyGainKg == null ||
    s.targetWeeklyGainKg <= 0 ||
    s.targetCalories == null ||
    s.targetCalories <= 0
  )
    return base("insufficient_data", "missing_target", null, "insufficient");
  if (s.previousWeightAverageKg == null || s.weightChangeKg == null)
    return base("insufficient_data", "insufficient_history", s.targetCalories, "insufficient");
  if (!weightStrong)
    return base("insufficient_data", "insufficient_weight_data", s.targetCalories, "insufficient");
  if (input.targetWeightReached)
    return base(
      "maintain",
      "goal_reached",
      s.targetCalories,
      nutritionStrong ? "strong" : "limited",
    );
  if (!nutritionStrong)
    return base("maintain", "insufficient_nutrition_data", s.targetCalories, "limited");

  const lower = s.targetWeeklyGainKg - RECOMMENDATION_WEIGHT_TOLERANCE_KG;
  const upper = s.targetWeeklyGainKg + RECOMMENDATION_WEIGHT_TOLERANCE_KG;
  const adherenceGood =
    s.averageCalories != null &&
    (s.averageCalories >= s.targetCalories * RECOMMENDATION_CALORIE_ADHERENCE_RATIO ||
      s.calorieAdherentDays >= Math.ceil(s.nutritionLoggedDays / 2));
  if (s.weightChangeKg < lower) {
    if (!adherenceGood)
      return base("maintain", "below_target_low_adherence", s.targetCalories, "strong");
    if (trainingContext === "low")
      return base("maintain", "below_target_low_training", s.targetCalories, "strong");
    return base(
      "increase_calories",
      "below_target_good_adherence",
      practicalCalories(s.targetCalories, 1),
      "strong",
    );
  }
  if (s.weightChangeKg > upper) {
    const confirmed =
      input.previousTrendComparable &&
      input.previousTrendChangeKg != null &&
      input.previousTrendChangeKg > upper;
    return confirmed
      ? base(
          "decrease_calories",
          "above_target_confirmed",
          practicalCalories(s.targetCalories, -1),
          "strong",
        )
      : base("maintain", "above_target_single_week", s.targetCalories, "strong");
  }
  return base("maintain", "on_target", s.targetCalories, "strong");
}
