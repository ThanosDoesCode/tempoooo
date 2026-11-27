import type { BulkWeeklyProgressSummary } from "./bulk-progress";
import type { Targets } from "./types";
import type { BulkCalorieReviewHistory } from "./bulk-progress-query";
import {
  classifyWeeklyWeightChange,
  RECOMMENDATION_MIN_CURRENT_WEIGH_INS,
  RECOMMENDATION_MIN_PREVIOUS_WEIGH_INS,
  RECOMMENDATION_MIN_NUTRITION_DAYS,
  type BulkWeeklyRecommendation,
} from "./bulk-weekly-recommendation.ts";

export type WeeklyCoachAvailability = "loading" | "error" | "ready";
export type CalorieReviewState = "eligible" | "changed" | "unknown";

export function calorieReviewState(
  history: BulkCalorieReviewHistory | undefined,
  currentCalories: number | null,
): CalorieReviewState {
  if (history?.baselineCalories == null || !Number.isFinite(history.baselineCalories))
    return "unknown";
  return history.changedSinceReview || history.baselineCalories !== currentCalories
    ? "changed"
    : "eligible";
}
type CoachRow = { value: string; detail: string };
export type WeeklyProgressCoachModel = {
  weight: CoachRow;
  training: CoachRow;
  nutrition: CoachRow;
  action: CoachRow & { kind: "setup" | "weigh" | "log" | "train" | "review_calories" | "continue" };
};

/** Presentation only: evidence, pace and calorie decisions belong to the existing engine. */
export function weeklyProgressCoach(
  summary: BulkWeeklyProgressSummary,
  configured: Partial<Targets> | null | undefined,
  recommendation: BulkWeeklyRecommendation,
  calorieState: CalorieReviewState,
): WeeklyProgressCoachModel {
  const goal = configured?.goal;
  const rate = summary.targetWeeklyGainKg;
  const hasPace =
    !!goal &&
    rate != null &&
    Number.isFinite(rate) &&
    (goal === "maintain" ? rate === 0 : rate > 0);
  const reliable =
    summary.weightEntryCount >= RECOMMENDATION_MIN_CURRENT_WEIGH_INS &&
    summary.previousWeightEntryCount >= RECOMMENDATION_MIN_PREVIOUS_WEIGH_INS &&
    summary.weightChangeKg != null &&
    Number.isFinite(summary.weightChangeKg);
  const weight: CoachRow = !hasPace
    ? { value: "Weight goal not configured", detail: "Choose a goal and intended weekly pace." }
    : !reliable
      ? {
          value: "Not enough weight data",
          detail: `Needs ${RECOMMENDATION_MIN_CURRENT_WEIGH_INS}+ weigh-ins in the completed week and ${RECOMMENDATION_MIN_PREVIOUS_WEIGH_INS}+ in the week before (${summary.weightEntryCount} and ${summary.previousWeightEntryCount} logged).`,
        }
      : (() => {
          const change = summary.weightChangeKg!;
          const pace = classifyWeeklyWeightChange(goal!, rate!, change);
          const description =
            pace === "on"
              ? "On pace"
              : goal === "maintain"
                ? "Outside maintenance range"
                : (goal === "cut" ? pace === "below" : pace === "above")
                  ? "Faster than intended"
                  : "Slower than intended";
          return {
            value: `${change > 0 ? "+" : ""}${change.toFixed(2)} kg · ${description.toLowerCase()}`,
            detail:
              goal === "maintain"
                ? "Goal: maintain weight · completed-week averages."
                : `Goal: ${goal === "cut" ? "lose" : "gain"} ${rate} kg/week · completed-week averages.`,
          };
        })();
  const target = summary.plannedWorkouts;
  const shortfall = target != null && summary.completedWorkouts < target;
  const training: CoachRow = {
    value:
      target == null
        ? `${summary.completedWorkouts} workouts completed`
        : `${summary.completedWorkouts} of ${target} workouts · ${shortfall ? "below goal" : "goal met"}`,
    detail:
      target == null
        ? "Weekly workout target not configured."
        : "Compared with your current configured goal.",
  };
  const unknownTargets = summary.nutritionLoggedDays - (summary.nutritionTargetedDays ?? 0);
  const enoughNutrition =
    summary.nutritionLoggedDays >= RECOMMENDATION_MIN_NUTRITION_DAYS && unknownTargets === 0;
  const nutrition: CoachRow = {
    value: `${summary.nutritionLoggedDays} of 7 days logged`,
    detail:
      unknownTargets > 0
        ? `${unknownTargets} logged day${unknownTargets === 1 ? " has" : "s have"} no recorded calorie target. Full-day intake isn’t verified.`
        : "Logged entries only; full-day intake isn’t verified.",
  };
  let action: WeeklyProgressCoachModel["action"];
  if (!hasPace) {
    action = {
      kind: "setup",
      value: "Set your weight goal",
      detail: "Choose your goal and intended pace before assessing weight progress.",
    };
  } else if (!reliable) {
    action = {
      kind: "weigh",
      value: "Build a reliable weight trend",
      detail: `Log weight on at least ${RECOMMENDATION_MIN_CURRENT_WEIGH_INS} days next week. Two sufficiently logged completed weeks are needed.`,
    };
  } else if (recommendation.reasonCode === "goal_reached") {
    action = { kind: "setup", value: "Review your weight goal", detail: recommendation.reasonText };
  } else if (!enoughNutrition) {
    action = {
      kind: "log",
      value: "Improve nutrition coverage",
      detail:
        unknownTargets > 0
          ? "Keep logging meals. Unknown historical targets prevent a reliable calorie assessment."
          : `Log meals on at least ${RECOMMENDATION_MIN_NUTRITION_DAYS} days next week. Missing days aren’t counted as zero intake.`,
    };
  } else if (target == null) {
    action = {
      kind: "setup",
      value: "Set your weekly workout target",
      detail: "Choose the number of workouts you want to complete each week.",
    };
  } else if (shortfall) {
    action = {
      kind: "train",
      value: `Aim for ${target} workouts next week`,
      detail: "Focus on meeting your configured workout goal before changing calories.",
    };
  } else if (recommendation.reasonCode === "missing_target") {
    action = {
      kind: "setup",
      value: "Review your nutrition target",
      detail: "A saved calorie target is needed before a calorie adjustment can be reviewed.",
    };
  } else if (
    recommendation.decision === "increase_calories" ||
    recommendation.decision === "decrease_calories"
  ) {
    action =
      calorieState === "eligible"
        ? {
            kind: "review_calories",
            value: recommendation.headline,
            detail: `${recommendation.reasonText} Review ${recommendation.recommendedCalories} kcal/day; nothing changes until you confirm.`,
          }
        : {
            kind: "continue",
            value: "Keep calories steady",
            detail:
              calorieState === "changed"
                ? "Your calorie target changed after this review week. Wait for a new completed week before another adjustment."
                : "Calorie target history is unavailable for this review. No adjustment is offered.",
          };
  } else {
    action = {
      kind: "continue",
      value: recommendation.headline,
      detail: recommendation.reasonText,
    };
  }
  return { weight, training, nutrition, action };
}
