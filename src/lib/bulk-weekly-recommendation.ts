import type { BulkWeeklyProgressSummary } from "./bulk-progress";
import type { PhysiqueGoal } from "./bulk-onboarding";

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
  | "calorie_boundary"
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
  goal?: PhysiqueGoal;
  summary: BulkWeeklyProgressSummary;
  /** Current saved target; summary.targetCalories remains the historical adherence reference. */
  currentTargetCalories?: number | null;
  previousTrendChangeKg: number | null;
  previousTrendComparable: boolean;
  targetWeightReached: boolean;
};

/** Shared pace classification for completed-week coaching and calorie recommendations. */
export function classifyWeeklyWeightChange(
  goal: PhysiqueGoal,
  rate: number,
  change: number,
): "below" | "on" | "above" {
  const expected = goal === "cut" ? -rate : goal === "maintain" ? 0 : rate;
  if (change < expected - RECOMMENDATION_WEIGHT_TOLERANCE_KG) return "below";
  if (change > expected + RECOMMENDATION_WEIGHT_TOLERANCE_KG) return "above";
  return "on";
}

const practicalCalories = (current: number, direction: 1 | -1) => {
  const rounded =
    direction === 1
      ? Math.floor((current + RECOMMENDATION_CALORIE_STEP) / 50) * 50
      : Math.ceil((current - RECOMMENDATION_CALORIE_STEP) / 50) * 50;
  const proposed = Math.min(10_000, Math.max(1000, rounded));
  const delta = proposed - current;
  if (Math.abs(delta) > RECOMMENDATION_CALORIE_STEP || delta * direction <= 0) return null;
  return proposed;
};

const copyFor = (reason: BulkRecommendationReason, calories: number | null, goal: PhysiqueGoal) => {
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
        goal === "cut" ? "Decrease calories slightly" : "Increase calories slightly",
        goal === "cut"
          ? "Weight loss was below target despite consistent intake and training. A small reduction is reasonable."
          : "Weight gain was below target despite consistent intake and training. A small adjustment is reasonable.",
      ] as const;
    case "below_target_low_adherence":
      return [
        "Keep the target and improve consistency",
        `Logged intake differed from its recorded targets. Keep ${current} and improve consistency before changing it.`,
      ] as const;
    case "below_target_low_training":
      return [
        "Maintain calories and train consistently",
        "Training consistency was low. Complete a more representative training week before changing calories.",
      ] as const;
    case "above_target_confirmed":
      return [
        goal === "cut" ? "Increase calories slightly" : "Decrease calories slightly",
        goal === "cut"
          ? "Weight loss exceeded the target range across two comparable completed weeks. A small increase is reasonable."
          : goal === "maintain"
            ? "Weight drift persisted across two comparable weeks. A small correction is reasonable."
            : "Weight gain exceeded the target range across two comparable completed weeks. A small reduction is reasonable.",
      ] as const;
    case "above_target_single_week":
      return [
        "Maintain and recheck",
        "Weight change was outside the target range for one completed week. Keep calories steady and confirm the trend first.",
      ] as const;
    case "insufficient_nutrition_data":
      return [
        "Maintain while collecting nutrition data",
        "Weight data is available, but at least four logged nutrition days are needed before changing the target.",
      ] as const;
    case "goal_reached":
      return [
        "Goal reached",
        "Your target weight has been reached. Keep the current target while you decide your next Goal phase.",
      ] as const;
    case "missing_target":
      return [
        "Target unavailable",
        "A valid weekly change and calorie target are required before Tempo can evaluate an adjustment.",
      ] as const;
    case "calorie_boundary":
      return [
        "No calorie adjustment available",
        "No change fits the supported calorie range and adjustment limit. Your target is unchanged.",
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
  const goal = input.goal ?? "gain";
  const currentCalories =
    input.currentTargetCalories === undefined ? s.targetCalories : input.currentTargetCalories;
  const weightStrong =
    s.weightEntryCount >= RECOMMENDATION_MIN_CURRENT_WEIGH_INS &&
    s.previousWeightEntryCount >= RECOMMENDATION_MIN_PREVIOUS_WEIGH_INS;
  const nutritionStrong =
    s.nutritionLoggedDays >= RECOMMENDATION_MIN_NUTRITION_DAYS &&
    (s.nutritionTargetedDays == null || s.nutritionTargetedDays === s.nutritionLoggedDays);
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
    if (
      (decision === "increase_calories" || decision === "decrease_calories") &&
      recommended == null
    ) {
      decision = "maintain";
      reasonCode = "calorie_boundary";
      recommended =
        currentCalories != null && currentCalories >= 1000 && currentCalories <= 10_000
          ? currentCalories
          : null;
    }
    const [headline, reasonText] = copyFor(reasonCode, currentCalories, goal);
    return {
      decision,
      reasonCode,
      recommendedCalories: recommended,
      currentTargetCalories: currentCalories,
      calorieDelta:
        recommended != null && currentCalories != null ? recommended - currentCalories : 0,
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
    (goal !== "maintain" && s.targetWeeklyGainKg <= 0) ||
    (goal === "maintain" && s.targetWeeklyGainKg !== 0) ||
    currentCalories == null ||
    !Number.isFinite(currentCalories) ||
    currentCalories <= 0
  )
    return base("insufficient_data", "missing_target", null, "insufficient");
  if (s.previousWeightAverageKg == null || s.weightChangeKg == null)
    return base("insufficient_data", "insufficient_history", currentCalories, "insufficient");
  if (!weightStrong)
    return base("insufficient_data", "insufficient_weight_data", currentCalories, "insufficient");
  if (input.targetWeightReached)
    return base(
      "maintain",
      "goal_reached",
      currentCalories,
      nutritionStrong ? "strong" : "limited",
    );
  if (!nutritionStrong)
    return base("maintain", "insufficient_nutrition_data", currentCalories, "limited");

  const pace = classifyWeeklyWeightChange(goal, s.targetWeeklyGainKg, s.weightChangeKg);
  const previousPace =
    input.previousTrendChangeKg == null
      ? null
      : classifyWeeklyWeightChange(goal, s.targetWeeklyGainKg, input.previousTrendChangeKg);
  const adherenceGood =
    s.averageCalories != null &&
    s.targetCalories != null &&
    (Math.abs(s.averageCalories - s.targetCalories) <=
      s.targetCalories * (1 - RECOMMENDATION_CALORIE_ADHERENCE_RATIO) ||
      s.calorieAdherentDays >= Math.ceil(s.nutritionLoggedDays / 2));
  if (pace === "below") {
    if (goal === "maintain") {
      const confirmed =
        input.previousTrendComparable &&
        input.previousTrendChangeKg != null &&
        previousPace === "below";
      return confirmed
        ? base(
            "increase_calories",
            "above_target_confirmed",
            practicalCalories(currentCalories, 1),
            "strong",
          )
        : base("maintain", "above_target_single_week", currentCalories, "strong");
    }
    if (goal === "cut") {
      const confirmed =
        input.previousTrendComparable &&
        input.previousTrendChangeKg != null &&
        previousPace === "below";
      return confirmed
        ? base(
            "increase_calories",
            "above_target_confirmed",
            practicalCalories(currentCalories, 1),
            "strong",
          )
        : base("maintain", "above_target_single_week", currentCalories, "strong");
    }
    if (!adherenceGood)
      return base("maintain", "below_target_low_adherence", currentCalories, "strong");
    if (trainingContext === "low")
      return base("maintain", "below_target_low_training", currentCalories, "strong");
    return base(
      "increase_calories",
      "below_target_good_adherence",
      practicalCalories(currentCalories, 1),
      "strong",
    );
  }
  if (pace === "above") {
    const confirmed =
      input.previousTrendComparable &&
      input.previousTrendChangeKg != null &&
      previousPace === "above";
    if (goal === "cut") {
      if (!adherenceGood)
        return base("maintain", "below_target_low_adherence", currentCalories, "strong");
      if (trainingContext === "low")
        return base("maintain", "below_target_low_training", currentCalories, "strong");
      return base(
        "decrease_calories",
        "below_target_good_adherence",
        practicalCalories(currentCalories, -1),
        "strong",
      );
    }
    return confirmed
      ? base(
          "decrease_calories",
          "above_target_confirmed",
          practicalCalories(currentCalories, -1),
          "strong",
        )
      : base("maintain", "above_target_single_week", currentCalories, "strong");
  }
  return base("maintain", "on_target", currentCalories, "strong");
}
