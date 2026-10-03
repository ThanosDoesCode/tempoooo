import { createFileRoute, Link } from "@tanstack/react-router";
import { format, startOfWeek } from "date-fns";
import { Check, ChevronRight } from "lucide-react";
import { AppShell } from "@/components/AppShell";
import { PageSkeleton } from "@/components/PageSkeleton";
import { DataError } from "@/components/ui-kit";
import { TodayChallenge } from "@/components/TodayChallenge";
import { ChallengeInviteReceiver } from "@/components/ChallengeInviteReceiver";
import { iso } from "@/lib/calc";
import { useAppData, useActions, useBulkMeta } from "@/lib/store";
import { preferredBulkMembership, useMemberships } from "@/lib/bulk-access";
import { useBulkWeights } from "@/lib/bulk-progress-query";
import { useBulkNutritionDay } from "@/lib/bulk-nutrition-query";
import { totalNutrition } from "@/lib/bulk-nutrition";
import {
  useActiveBulkTrainingSession,
  useCompletedSessionDates,
} from "@/lib/bulk-training-sessions";
import { useActiveTrainingPlan } from "@/lib/training-plans-query";
import {
  collectCompletedWorkouts,
  countWorkoutsInRange,
  resolveWeeklyWorkoutTarget,
} from "@/lib/goal-metrics";
import { useLocalDay } from "@/lib/use-local-day";
import { useState } from "react";

export const Route = createFileRoute("/_authenticated/bulk/")({
  head: () => ({ meta: [{ title: "Tempo" }] }),
  component: TodayPage,
});
function TodayPage() {
  const today = useLocalDay();
  const memberships = useMemberships();
  const owner = preferredBulkMembership(memberships.data);
  const data = useAppData();
  const { bulkId } = useBulkMeta();
  const id = owner ? bulkId : null;
  const publicGoal = owner?.is_public === true;
  const weights = useBulkWeights(publicGoal ? id : null, today);
  const nutrition = useBulkNutritionDay(publicGoal ? id : null, today);
  const from = iso(startOfWeek(new Date(), { weekStartsOn: 1 }));
  const sessions = useCompletedSessionDates(id, from, today);
  const activeSession = useActiveBulkTrainingSession(publicGoal ? id : null);
  const plan = useActiveTrainingPlan(publicGoal ? id : null);
  const { saveDay } = useActions();
  const [restPending, setRestPending] = useState(false);
  const [restError, setRestError] = useState(false);
  const day = owner ? data?.days[today] : undefined;
  const ready =
    owner &&
    data &&
    (!publicGoal || (!weights.isLoading && !nutrition.isLoading)) &&
    !sessions.isLoading &&
    !plan.isLoading;
  const failure = owner ? [weights, nutrition, sessions, plan].find((q) => q.error) : undefined;
  const weight = publicGoal
    ? weights.data?.find((w) => w.logDate === today)?.weightKg
    : day?.weight;
  // Normalized snapshots win. Older JSON totals remain honest compatibility data, never seeded meals.
  const totals = nutrition.data?.day
    ? totalNutrition(nutrition.data.entries)
    : {
        calories: day?.calories ?? 0,
        protein: day?.protein ?? 0,
        carbs: day?.carbs ?? 0,
        fat: day?.fat ?? 0,
      };
  const completed = collectCompletedWorkouts({
    sessions: sessions.data ?? null,
    legacyWorkouts: owner ? (data?.workouts ?? null) : null,
    legacyDays: owner ? (data?.days ?? null) : null,
  });
  const workoutDone = completed.some((w) => w.workoutDate === today);
  const rest = day?.restDay === true;
  const habits = [
    weight != null,
    day?.sleepHours != null && day.sleepQuality != null,
    workoutDone || rest,
    (nutrition.data?.entries.length ?? 0) > 0 || day?.calories != null,
  ];
  const target = resolveWeeklyWorkoutTarget({
    weeklyWorkoutGoal: data?.targets.weeklyWorkoutGoal ?? 5,
    targetDaysPerWeek: data?.targets.trainingDaysPerWeek ?? null,
    activePlanDaysPerWeek: plan.data?.trainingDaysPerWeek ?? null,
  });
  const habit = (label: string, subtitle: string, done: boolean, to: string) => (
    <Link
      key={label}
      to={to}
      preload="intent"
      className="flex min-h-[62px] items-center gap-[14px] border-t border-border first:border-t-0"
    >
      <span
        aria-label={done ? "Complete" : "Not complete"}
        className={
          done
            ? "grid h-6 w-6 shrink-0 place-items-center rounded-full bg-primary text-primary-foreground"
            : "h-6 w-6 shrink-0 rounded-full border-2 border-muted-foreground/40"
        }
      >
        {done ? <Check className="h-3.5 w-3.5" aria-hidden="true" /> : null}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-[15px] font-medium">{label}</span>
        <span className="num block text-[13px] text-muted-foreground">{subtitle}</span>
      </span>
      {label === "Workout" && !done ? (
        <span className="rounded-full bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground">
          {activeSession.data ? "Resume" : plan.data ? "Start" : "Choose plan"}
        </span>
      ) : (
        <ChevronRight className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
      )}
    </Link>
  );
  return (
    <AppShell>
      <div className="space-y-[14px]">
        <header>
          <p className="text-sm text-muted-foreground">{format(new Date(), "EEEE, d MMMM")}</p>
          <h1 className="mt-1 text-[30px] font-semibold tracking-tight">Today</h1>
        </header>
        <ChallengeInviteReceiver />
        <TodayChallenge />
        {memberships.isLoading ? (
          <PageSkeleton />
        ) : !owner ? (
          <div className="card-surface space-y-[14px] p-5">
            <h2 className="text-[17px] font-medium">Track more, if you want</h2>
            <p className="text-sm text-muted-foreground">
              Weight, workouts and meals, all optional.
            </p>
            <Link
              to="/bulk-onboarding"
              className="grid h-12 place-items-center rounded-[14px] bg-secondary font-semibold"
            >
              Set up fitness tools
            </Link>
          </div>
        ) : failure ? (
          <DataError
            message="Could not load today's habits. Your data is unchanged."
            onRetry={() => void failure.refetch()}
          />
        ) : !ready ? (
          <PageSkeleton label="Loading today's habits" />
        ) : (
          <>
            <div className="flex justify-between px-1 text-[13px] text-muted-foreground">
              <span>Today's habits</span>
              <span>{habits.filter(Boolean).length} of 4 done</span>
            </div>
            <div className="card-surface px-4 py-0.5">
              {habit(
                "Weigh-in",
                weight == null ? "Add today's weight" : `${weight} kg`,
                habits[0]!,
                "/bulk/morning",
              )}
              {habit(
                "Sleep",
                day?.sleepHours == null
                  ? "Add sleep and quality"
                  : `${day.sleepHours} hours · quality ${day.sleepQuality ?? "not logged"} of 5`,
                habits[1]!,
                "/bulk/morning",
              )}
              {habit(
                "Workout",
                workoutDone
                  ? "Workout completed"
                  : rest
                    ? "Rest day"
                    : (activeSession.data?.workoutDayName ??
                      plan.data?.name ??
                      "Choose a training plan"),
                habits[2]!,
                "/bulk/training",
              )}
              {habit(
                "Meals",
                `${totals.calories} of ${nutrition.data?.day?.targets.calories ?? data?.targets.calories ?? 0} kcal`,
                habits[3]!,
                "/bulk/meals",
              )}
            </div>
            <p className="px-1 text-[13px] text-muted-foreground">
              {countWorkoutsInRange(completed, from, today)}
              {target == null ? " workouts this week" : ` of ${target} workouts this week`}
              {day?.steps != null ? ` · ${day.steps.toLocaleString()} steps today` : ""}
            </p>
            {!workoutDone ? (
              <button
                disabled={restPending}
                aria-pressed={rest}
                className="min-h-11 text-sm text-primary"
                onClick={async () => {
                  if (restPending) return;
                  setRestPending(true);
                  setRestError(false);
                  try {
                    await saveDay(today, { restDay: !rest });
                  } catch {
                    setRestError(true);
                  } finally {
                    setRestPending(false);
                  }
                }}
              >
                {restPending ? "Saving rest day…" : rest ? "Undo rest day" : "Mark rest day"}
              </button>
            ) : null}
            {restError ? (
              <p role="alert" className="text-sm text-danger">
                Could not save rest day. Try again.
              </p>
            ) : null}
            {day?.mealPlan || !publicGoal ? (
              <Link
                to="/bulk/daily-log"
                className="inline-flex min-h-11 items-center text-sm text-muted-foreground"
              >
                Daily log & legacy nutrition
              </Link>
            ) : null}
          </>
        )}
      </div>
    </AppShell>
  );
}
