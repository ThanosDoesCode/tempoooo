import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useRef } from "react";
import { startOfWeek } from "date-fns";
import { ChevronRight, Flame, Settings } from "lucide-react";
import { AppShell } from "@/components/AppShell";
import { MainPageHeader } from "@/components/MainPageHeader";
import { PageSkeleton } from "@/components/PageSkeleton";
import { useAuth } from "@/lib/auth";
import { accountProductMode, preferredBulkMembership, useMemberships } from "@/lib/bulk-access";
import { useAccountProfile } from "@/lib/account-profile";
import { useAcknowledgeGoal, useGoalDiscovery } from "@/lib/goal-discovery";
import { useStreak } from "@/lib/streak";
import { useAppData, useBulkMeta } from "@/lib/store";
import { useLocalDay } from "@/lib/use-local-day";
import { useActiveTrainingPlan } from "@/lib/training-plans-query";
import { useCompletedSessionDates } from "@/lib/bulk-training-sessions";
import {
  collectCompletedWorkouts,
  countWorkoutsInRange,
  resolveWeeklyWorkoutTarget,
} from "@/lib/goal-metrics";
import { iso } from "@/lib/calc";

export const Route = createFileRoute("/_authenticated/profile")({
  head: () => ({
    meta: [
      { title: "Tempo" },
      {
        name: "description",
        content: "See the account you are signed in with and create or open your Tempo Goal plan.",
      },
      { property: "og:title", content: "Tempo" },
      {
        property: "og:description",
        content: "Manage your account and your Tempo Goal plan access.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: ProfilePage,
});

const GOAL_LABEL: Record<string, string> = { gain: "Bulk", cut: "Cut", maintain: "Maintain" };

function ProfilePage() {
  const { user } = useAuth();
  const accountProfile = useAccountProfile(user?.id);
  const { data: memberships, isLoading: membershipsLoading } = useMemberships();
  const goalDiscovery = useGoalDiscovery();
  const acknowledgeGoal = useAcknowledgeGoal();
  const acknowledgementStarted = useRef(false);

  const ownedPlan = preferredBulkMembership(memberships);
  const mode = accountProductMode(memberships);
  const core = mode === "core";

  // Clear the "New Fitness tools" badge once a Challenge-only user has seen the You tab.
  useEffect(() => {
    if (
      ownedPlan ||
      goalDiscovery.isLoading ||
      goalDiscovery.isError ||
      goalDiscovery.data?.goal_seen_at != null ||
      acknowledgementStarted.current
    )
      return;
    acknowledgementStarted.current = true;
    void acknowledgeGoal().catch(() => {
      acknowledgementStarted.current = false;
    });
  }, [
    acknowledgeGoal,
    goalDiscovery.data?.goal_seen_at,
    goalDiscovery.isError,
    goalDiscovery.isLoading,
    ownedPlan,
  ]);

  const username = accountProfile.data?.username;
  const initials = (username ?? user?.email ?? "").slice(0, 2).toUpperCase();
  const descriptor = core ? "Challenge only" : "Fitness";

  return (
    <AppShell>
      <MainPageHeader title="You">
        <Link
          to="/profile/settings"
          aria-label="Settings"
          className="grid h-11 w-11 place-items-center rounded-full text-muted-foreground active:opacity-80"
        >
          <Settings className="h-5 w-5" aria-hidden="true" />
        </Link>
      </MainPageHeader>

      <div className="mb-5 flex items-center gap-3">
        <span
          aria-hidden="true"
          className="grid h-14 w-14 shrink-0 place-items-center rounded-full bg-elevated text-lg font-semibold"
        >
          {initials}
        </span>
        <div className="min-w-0">
          <p className="break-all text-xl font-semibold">@{username ?? "…"}</p>
          <p className="mt-0.5 break-all text-[13px] text-muted-foreground">
            {user?.email ?? "…"} · {descriptor}
          </p>
        </div>
      </div>

      <StreakSummary />

      {membershipsLoading ? (
        <div className="mt-4">
          <PageSkeleton label="Loading profile" />
        </div>
      ) : core ? (
        !ownedPlan ? (
          <Link
            to="/bulk-onboarding"
            className="mt-4 block rounded-[20px] bg-card p-5 active:bg-elevated"
          >
            <p className="text-[15px] font-medium">Set up fitness tools</p>
            <p className="mt-1 text-[13px] text-muted-foreground">
              Optional training, meals and Goal targets. Your Challenge works without them.
            </p>
          </Link>
        ) : null
      ) : (
        <FitnessSummary ownedPublic={ownedPlan?.is_public === true} />
      )}
    </AppShell>
  );
}

function StreakSummary() {
  const { data } = useStreak();
  const current = data?.current ?? 0;
  const best = data?.best ?? 0;
  return (
    <Link
      to="/streak"
      aria-label={`Streak, ${current} ${current === 1 ? "week" : "weeks"}`}
      className="flex items-center gap-3 rounded-[20px] bg-card p-4 active:bg-elevated"
    >
      <span className="grid h-11 w-11 flex-none place-items-center rounded-full bg-orange-500/15">
        <Flame className="h-5 w-5 text-orange-400" aria-hidden="true" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="num block text-[17px] font-semibold">
          {current} {current === 1 ? "week" : "weeks"}
        </span>
        <span className="block text-[13px] text-muted-foreground">
          {current === 0 && best === 0 ? "Start your first week" : `Best ${best}`}
        </span>
      </span>
      <ChevronRight className="control-chevron text-muted-foreground" aria-hidden="true" />
    </Link>
  );
}

function SummaryRow({
  to,
  label,
  value,
  hint,
}: {
  to: string;
  label: string;
  value: string;
  hint?: string;
}) {
  return (
    <Link
      to={to}
      className="flex min-h-[56px] items-center justify-between gap-3 border-t border-border first:border-t-0 active:opacity-80"
    >
      <span className="min-w-0 flex-1">
        <span className="block text-[15px] font-medium">{label}</span>
        {hint ? (
          <span className="mt-0.5 block text-[13px] text-muted-foreground">{hint}</span>
        ) : null}
      </span>
      <span className="flex items-center gap-2">
        <span className="num text-[15px] font-semibold">{value}</span>
        <ChevronRight className="control-chevron text-muted-foreground" aria-hidden="true" />
      </span>
    </Link>
  );
}

/** Fitness mode: a concise overview, not a second Progress screen. */
function FitnessSummary({ ownedPublic }: { ownedPublic: boolean }) {
  const data = useAppData();
  const { bulkId } = useBulkMeta();
  const today = useLocalDay();
  const from = iso(startOfWeek(new Date(), { weekStartsOn: 1 }));
  const sessions = useCompletedSessionDates(ownedPublic ? bulkId : null, from, today);
  const plan = useActiveTrainingPlan(ownedPublic ? bulkId : null);
  const targets = data?.targets;

  const goalLabel = targets?.goal ? (GOAL_LABEL[targets.goal] ?? "Goal") : null;
  const latestWeight = data
    ? Object.entries(data.days)
        .filter(([, day]) => day.weight != null)
        .sort((a, b) => (a[0] < b[0] ? 1 : -1))[0]?.[1]?.weight
    : undefined;

  const target = resolveWeeklyWorkoutTarget({
    weeklyWorkoutGoal: targets?.weeklyWorkoutGoal ?? null,
    targetDaysPerWeek: targets?.trainingDaysPerWeek ?? null,
    activePlanDaysPerWeek: plan.data?.trainingDaysPerWeek ?? null,
  });
  const completed = collectCompletedWorkouts({
    sessions: sessions.data ?? null,
    legacyWorkouts: data?.workouts ?? null,
    legacyDays: data?.days ?? null,
  });
  const weeklyCount = countWorkoutsInRange(completed, from, today);

  return (
    <section className="mt-4 rounded-[20px] bg-card px-4">
      <h2 className="pt-4 text-[13px] font-medium text-muted-foreground">Your fitness</h2>
      <div className="mt-1">
        {goalLabel ? (
          <SummaryRow
            to="/bulk/more"
            label="Goal"
            value={`${goalLabel} · ${targets?.targetWeight ?? "—"} kg`}
            {...(latestWeight != null ? { hint: `Now ${latestWeight} kg` } : {})}
          />
        ) : null}
        <SummaryRow
          to="/bulk/training"
          label="Training"
          value={target == null ? `${weeklyCount}` : `${weeklyCount} / ${target}`}
          hint={plan.data?.name ?? "This week"}
        />
        {targets?.calories ? (
          <SummaryRow
            to="/bulk/meals"
            label="Nutrition"
            value={`${targets.calories} kcal`}
            hint="Daily target"
          />
        ) : null}
      </div>
      <div className="pb-2" />
    </section>
  );
}
