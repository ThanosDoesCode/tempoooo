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
import { nutritionMacroStatus, totalNutrition } from "@/lib/bulk-nutrition";
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
import { useRef, useState } from "react";
import { useChallengeInvitations } from "@/lib/challenge-invitations";

export const Route = createFileRoute("/_authenticated/bulk/")({
  head: () => ({ meta: [{ title: "Tempo" }] }),
  component: TodayPage,
});
function TodayPage() {
  const today = useLocalDay();
  const memberships = useMemberships();
  const invitations = useChallengeInvitations();
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
  const restSaving = useRef(false);
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
  // Today's Meals row shows complete only once the day's calorie target is reached — meal logging
  // on its own is not completion. The deeper Goal day-completion requirement (goal-metrics
  // `dayCompletionRequirements`, "Meal logged") is intentionally "any meal logged" and is unchanged.
  const mealTarget = nutrition.data?.day?.targets.calories ?? data?.targets.calories ?? 0;
  const mealsComplete =
    mealTarget > 0 && nutritionMacroStatus(totals.calories, mealTarget).status !== "under";
  // Presentation only: weight and sleep remain separate persisted Goal requirements.
  const sleep = day?.sleepHours;
  const morningSubtitle =
    weight == null && sleep == null
      ? "Add weight and sleep"
      : weight == null
        ? `${sleep} h sleep · add weight`
        : sleep == null
          ? `${weight} kg · add sleep`
          : `${weight} kg · ${sleep} h sleep`;
  const habits = [weight != null && sleep != null, workoutDone || rest, mealsComplete];
  const target = resolveWeeklyWorkoutTarget({
    weeklyWorkoutGoal: data?.targets.weeklyWorkoutGoal ?? 5,
    targetDaysPerWeek: data?.targets.trainingDaysPerWeek ?? null,
    activePlanDaysPerWeek: plan.data?.trainingDaysPerWeek ?? null,
  });
  const weeklyCount = countWorkoutsInRange(completed, from, today);
  const weeklyContext =
    target == null
      ? `${weeklyCount} workouts this week`
      : `${weeklyCount} of ${target} workouts this week`;
  const workoutSubtitle = `${activeSession.data ? `${activeSession.data.workoutDayName} · In progress` : workoutDone ? "Workout completed" : rest ? "Rest day" : (plan.data?.name ?? "Choose a training plan")} · ${weeklyContext}`;
  async function toggleRestDay() {
    if (restSaving.current) return;
    restSaving.current = true;
    setRestPending(true);
    setRestError(false);
    try {
      await saveDay(today, { restDay: !rest });
    } catch {
      setRestError(true);
    } finally {
      restSaving.current = false;
      setRestPending(false);
    }
  }
  const habit = (label: string, subtitle: string, done: boolean, to: string) => (
    <Link
      key={label}
      to={to}
      preload="intent"
      className="flex min-h-[62px] items-center justify-between gap-[14px] border-t border-border first:border-t-0"
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
      <ChevronRight className="control-chevron text-muted-foreground" aria-hidden="true" />
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
        {memberships.isLoading ? (
          <PageSkeleton />
        ) : !owner ? (
          <div className="card-surface rounded-[20px] space-y-[14px] p-5">
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
              <span>
                {habits.filter(Boolean).length} of {habits.length} done
              </span>
            </div>
            <div className="card-surface rounded-[20px] px-4 py-0.5">
              {habit("Morning check-in", morningSubtitle, habits[0]!, "/bulk/morning")}
              <div className="border-t border-border" role="group" aria-label="Workout">
                <div className="flex min-h-[62px] items-center gap-[14px] py-2">
                  <Link
                    to="/bulk/training"
                    preload="intent"
                    className="flex min-w-0 flex-1 items-center gap-[14px]"
                  >
                    <span
                      aria-label={habits[1] ? "Complete" : "Not complete"}
                      className={
                        habits[1]
                          ? "grid h-6 w-6 shrink-0 place-items-center rounded-full bg-primary text-primary-foreground"
                          : "h-6 w-6 shrink-0 rounded-full border-2 border-muted-foreground/40"
                      }
                    >
                      {habits[1] ? <Check className="h-3.5 w-3.5" aria-hidden="true" /> : null}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block text-[15px] font-medium">Workout</span>
                      <span className="num block truncate text-[13px] text-muted-foreground">
                        {activeSession.data
                          ? `${activeSession.data.workoutDayName} · In progress`
                          : workoutDone
                            ? "Workout completed"
                            : rest
                              ? "Rest day"
                              : (plan.data?.name ?? "Choose a training plan")}
                      </span>
                      <span className="num block text-[12px] text-muted-foreground/80">
                        {weeklyContext}
                      </span>
                    </span>
                  </Link>
                  {!habits[1] || activeSession.data ? (
                    <Link
                      to="/bulk/training"
                      preload="intent"
                      className="inline-flex h-9 shrink-0 items-center rounded-full bg-primary px-4 text-[13px] font-semibold text-primary-foreground active:opacity-80"
                    >
                      {activeSession.data ? "Resume" : plan.data ? "Start" : "Choose plan"}
                    </Link>
                  ) : workoutDone ? (
                    <ChevronRight
                      className="control-chevron text-muted-foreground"
                      aria-hidden="true"
                    />
                  ) : null}
                  {!workoutDone && rest ? (
                    <button
                      type="button"
                      disabled={restPending}
                      aria-pressed={rest}
                      aria-busy={restPending}
                      className="inline-flex h-9 shrink-0 items-center rounded-full bg-secondary px-4 text-[13px] font-medium disabled:opacity-60"
                      onClick={() => void toggleRestDay()}
                    >
                      {restPending ? "Saving…" : "Undo"}
                    </button>
                  ) : null}
                </div>
                {!workoutDone && !rest && !activeSession.data ? (
                  <button
                    type="button"
                    disabled={restPending}
                    aria-pressed={rest}
                    aria-busy={restPending}
                    className="-mt-1 mb-2 ml-[38px] text-[12px] font-medium text-muted-foreground underline-offset-2 hover:underline disabled:opacity-60"
                    onClick={() => void toggleRestDay()}
                  >
                    {restPending ? "Saving rest day…" : "Taking a rest day?"}
                  </button>
                ) : null}
                {restError ? (
                  <p role="alert" className="pb-2 pl-[38px] text-[13px] text-danger">
                    Could not save rest day. Try again.
                  </p>
                ) : null}
              </div>
              {habit(
                "Meals",
                `${totals.calories} of ${mealTarget} kcal`,
                habits[2]!,
                "/bulk/meals",
              )}
            </div>
          </>
        )}
        <TodayChallenge hideDiscovery={invitations.isLoading || !!invitations.data?.length} />
      </div>
    </AppShell>
  );
}
