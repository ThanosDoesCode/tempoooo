// Shared, pure Goal metrics used by Today, Progress, Check-In and Training views.
// No framework or network imports so the logic stays testable and identical everywhere.

export type CompletedWorkoutRecord = {
  /** Stable identity: `session:<uuid>` for normalized sessions, `legacy:<date>` for legacy logs. */
  key: string;
  source: "session" | "legacy";
  workoutDate: string;
};

type SessionLike = { id: string; status: string; workoutDate: string };
type LegacyWorkoutLike = { date: string; status?: "draft" | "completed" | undefined };
type LegacyDayLike = { gym?: boolean | undefined };

/**
 * Builds the authoritative list of completed workouts.
 *
 * - Normalized sessions count once per stable session id when status is "completed",
 *   dated by their persisted workout_date. Multiple sessions on one date all count.
 * - Legacy storage keys workouts by calendar date (one legacy record per date), so the
 *   legacy identity is the date itself. A legacy date counts when its workout is
 *   completed, or when the legacy day was marked as a gym day and has no draft workout.
 * - There is no persisted link between legacy logs and normalized sessions, so they are
 *   never merged by matching dates. Both are kept as separate records.
 */
export function collectCompletedWorkouts(args: {
  sessions?: readonly SessionLike[] | null;
  legacyWorkouts?: Readonly<Record<string, LegacyWorkoutLike>> | null;
  legacyDays?: Readonly<Record<string, LegacyDayLike | undefined>> | null;
}): CompletedWorkoutRecord[] {
  const records = new Map<string, CompletedWorkoutRecord>();
  for (const session of args.sessions ?? []) {
    if (session.status !== "completed" || !session.workoutDate) continue;
    const key = `session:${session.id}`;
    if (!records.has(key))
      records.set(key, { key, source: "session", workoutDate: session.workoutDate });
  }
  const legacyDates = new Set<string>();
  for (const [date, workout] of Object.entries(args.legacyWorkouts ?? {})) {
    if (workout?.status === "completed") legacyDates.add(workout.date || date);
  }
  for (const [date, day] of Object.entries(args.legacyDays ?? {})) {
    if (day?.gym && args.legacyWorkouts?.[date]?.status !== "draft") legacyDates.add(date);
  }
  for (const date of legacyDates) {
    const key = `legacy:${date}`;
    records.set(key, { key, source: "legacy", workoutDate: date });
  }
  return [...records.values()].sort((a, b) => a.workoutDate.localeCompare(b.workoutDate));
}

export function countWorkoutsInRange(
  records: readonly CompletedWorkoutRecord[],
  from: string,
  to: string,
) {
  return records.filter((record) => record.workoutDate >= from && record.workoutDate <= to).length;
}

/**
 * Configured weekly workout goal. This is how many workouts the user aims to complete
 * per week and is deliberately independent of the plan's structured-day count: a 3-day
 * plan can carry a 5-workout weekly goal. The explicit `weeklyWorkoutGoal` wins; the
 * plan/onboarding day counts are only legacy fallbacks. Returns null when nothing is
 * configured; never guesses.
 */
export function resolveWeeklyWorkoutTarget(args: {
  weeklyWorkoutGoal?: number | null;
  activePlanDaysPerWeek?: number | null;
  targetDaysPerWeek?: number | null;
}): number | null {
  const valid = (value: number | null | undefined) =>
    typeof value === "number" && Number.isInteger(value) && value > 0 ? value : null;
  return (
    valid(args.weeklyWorkoutGoal) ??
    valid(args.targetDaysPerWeek) ??
    valid(args.activePlanDaysPerWeek)
  );
}

export function formatWorkoutProgress(completed: number, target: number | null) {
  return target == null ? `${completed}` : `${completed}/${target}`;
}

// ---------- Cross-module daily completion (public Goal) ----------

export type DayCompletionKey = "bodyweight" | "sleep" | "activity" | "meal" | "workout";

export type DayCompletionRequirement = {
  key: DayCompletionKey;
  label: string;
  done: boolean;
};

/**
 * Cross-module daily completion for the public Goal, from authoritative persisted records.
 * Five equally weighted (20% each) requirements:
 *  1. bodyweight recorded (bulk_weights),
 *  2. sleep duration AND quality recorded (bulk_days),
 *  3. daily activity actually entered — steps recorded, or cycling/running distance > 0
 *     (a bare zero never auto-counts),
 *  4. at least one meal logged (bulk_nutrition_entries),
 *  5. a workout completed (bulk_training_sessions) OR an explicit rest day (bulk_days).
 *
 * A genuinely completed workout takes precedence over an explicit rest day so the two can
 * never present a contradictory state.
 */
export function dayCompletionRequirements(inputs: {
  bodyweightRecorded: boolean;
  sleepRecorded: boolean;
  activityRecorded: boolean;
  mealLogged: boolean;
  workoutCompleted: boolean;
  restDay: boolean;
}): DayCompletionRequirement[] {
  const workoutLabel = inputs.workoutCompleted
    ? "Workout completed"
    : inputs.restDay
      ? "Rest day"
      : "Workout or rest day";
  return [
    { key: "bodyweight", label: "Bodyweight logged", done: inputs.bodyweightRecorded },
    { key: "sleep", label: "Sleep hours and quality", done: inputs.sleepRecorded },
    { key: "activity", label: "Daily activity", done: inputs.activityRecorded },
    { key: "meal", label: "Meal logged", done: inputs.mealLogged },
    { key: "workout", label: workoutLabel, done: inputs.workoutCompleted || inputs.restDay },
  ];
}

export function dayCompletionPercent(requirements: readonly DayCompletionRequirement[]) {
  if (!requirements.length) return 0;
  return Math.round((requirements.filter((r) => r.done).length / requirements.length) * 100);
}

// ---------- Weight trend and Goal status ----------

type WeightLike = { logDate: string; weightKg: number };

const MIN_CONFIRMED_WEIGH_INS = 3;
const MIN_ESTIMATE_WEIGH_INS = 2;

function shiftDay(day: string, days: number) {
  const date = new Date(`${day}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

export function mondayOf(day: string) {
  const date = new Date(`${day}T12:00:00Z`);
  const offset = (date.getUTCDay() + 6) % 7;
  return shiftDay(day, -offset);
}

function weekAverage(weights: readonly WeightLike[], weekStart: string) {
  const end = shiftDay(weekStart, 6);
  const values = weights
    .filter((entry) => entry.logDate >= weekStart && entry.logDate <= end)
    .map((entry) => entry.weightKg);
  const averageKg = values.length
    ? Number((values.reduce((sum, value) => sum + value, 0) / values.length).toFixed(2))
    : null;
  return { averageKg, count: values.length };
}

export type GoalStatusLabel =
  "CALIBRATING" | "ON TRACK" | "TOO SLOW" | "TOO FAST" | "ON PACE" | "BELOW PACE" | "ABOVE PACE";

export type GoalStatus = {
  label: GoalStatusLabel;
  tone: "good" | "warn" | "danger" | "muted";
  /** "confirmed" = two completed weeks; "estimate" = current week vs last completed week. */
  basis: "confirmed" | "estimate" | "insufficient";
  changeKg: number | null;
  currentAverageKg: number | null;
  detail: string;
};

/**
 * Goal status from weekly weight averages (Monday weeks).
 * Confirmed: last completed week vs the week before, each with >= 3 weigh-ins.
 * Estimate: current week (>= 2 weigh-ins) vs last completed week (>= 3 weigh-ins).
 * TOO FAST / TOO SLOW are only shown for confirmed changes.
 */
export function goalWeightStatus(args: {
  weights: readonly WeightLike[];
  today: string;
  goal: "gain" | "cut" | "maintain" | undefined;
  targetWeeklyGainKg?: number | null;
}): GoalStatus {
  const currentStart = mondayOf(args.today);
  const lastStart = shiftDay(currentStart, -7);
  const priorStart = shiftDay(currentStart, -14);
  const current = weekAverage(args.weights, currentStart);
  const last = weekAverage(args.weights, lastStart);
  const prior = weekAverage(args.weights, priorStart);
  const currentAverageKg = current.averageKg ?? last.averageKg;
  const goal = args.goal ?? "gain";
  const rate = Math.abs(args.targetWeeklyGainKg ?? 0.25);
  const expected = goal === "cut" ? -rate : goal === "maintain" ? 0 : rate;
  const tolerance = goal === "maintain" ? 0.2 : 0.1;

  const classify = (change: number) => {
    const diff = change - expected;
    if (Math.abs(diff) <= tolerance) return "on" as const;
    const tooFast =
      goal === "cut"
        ? diff < 0
        : goal === "maintain"
          ? Math.abs(change) > tolerance && change > 0
          : diff > 0;
    return tooFast ? ("fast" as const) : ("slow" as const);
  };

  if (last.count >= MIN_CONFIRMED_WEIGH_INS && prior.count >= MIN_CONFIRMED_WEIGH_INS) {
    const changeKg = Number((last.averageKg! - prior.averageKg!).toFixed(2));
    const verdict = classify(changeKg);
    return {
      label: verdict === "on" ? "ON TRACK" : verdict === "fast" ? "TOO FAST" : "TOO SLOW",
      tone: verdict === "on" ? "good" : "warn",
      basis: "confirmed",
      changeKg,
      currentAverageKg,
      detail: "Last completed week vs the week before",
    };
  }
  if (current.count >= MIN_ESTIMATE_WEIGH_INS && last.count >= MIN_CONFIRMED_WEIGH_INS) {
    const changeKg = Number((current.averageKg! - last.averageKg!).toFixed(2));
    const verdict = classify(changeKg);
    return {
      label: verdict === "on" ? "ON PACE" : verdict === "fast" ? "ABOVE PACE" : "BELOW PACE",
      tone: verdict === "on" ? "good" : "muted",
      basis: "estimate",
      changeKg,
      currentAverageKg,
      detail: "Estimate: this week so far vs last week",
    };
  }
  return {
    label: "CALIBRATING",
    tone: "muted",
    basis: "insufficient",
    changeKg: null,
    currentAverageKg,
    detail: `Needs ${MIN_CONFIRMED_WEIGH_INS}+ weigh-ins in each of two weeks`,
  };
}

/** Maps legacy day logs to weight entries so legacy and public accounts share one calculation. */
export function legacyDayWeights(
  days: Readonly<Record<string, { weight?: number | undefined } | undefined>>,
): WeightLike[] {
  return Object.entries(days)
    .filter(([, day]) => typeof day?.weight === "number")
    .map(([logDate, day]) => ({ logDate, weightKg: day!.weight! }));
}
