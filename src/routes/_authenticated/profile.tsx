import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { ChevronRight, Flame, Settings } from "lucide-react";
import { AppShell } from "@/components/AppShell";
import { SignOutButton } from "@/components/SignOutButton";
import { HistoryBackLink } from "@/components/HistoryBackLink";
import { PageSkeleton } from "@/components/PageSkeleton";
import { useAuth } from "@/lib/auth";
import { accountProductMode, preferredBulkMembership, useMemberships } from "@/lib/bulk-access";
import { useAccountProfile } from "@/lib/account-profile";
import { useAcknowledgeGoal, useGoalDiscovery } from "@/lib/goal-discovery";
import { useStreak, useThisWeekRingProgress } from "@/lib/streak";
import { useAppData, useBulkMeta } from "@/lib/store";
import { useLocalDay } from "@/lib/use-local-day";
import { useCompletedSessionDates, useCompletedWorkoutCount } from "@/lib/bulk-training-sessions";
import { collectCompletedWorkouts } from "@/lib/goal-metrics";
import { useActivitySummary, useEnduranceActivities, useMyChallenge } from "@/lib/challenge";
import { usePhotoCount } from "@/lib/progress-model";
import { activityGrid, activityGridStart, type ActivityCell } from "@/lib/activity-grid";

export const Route = createFileRoute("/_authenticated/profile")({
  head: () => ({
    meta: [
      { title: "Tempo" },
      {
        name: "description",
        content: "Your Tempo profile: streak, activity and account.",
      },
      { property: "og:title", content: "Tempo" },
      { property: "og:description", content: "Your Tempo profile: streak, activity and account." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: ProfilePage,
});

const km = (value: number) => (value >= 100 ? Math.round(value) : Math.round(value * 10) / 10);

function ProfilePage() {
  const { user } = useAuth();
  const profile = useAccountProfile(user?.id).data;
  const { data: memberships, isLoading: membershipsLoading } = useMemberships();
  const goalDiscovery = useGoalDiscovery();
  const acknowledgeGoal = useAcknowledgeGoal();
  const acknowledgementStarted = useRef(false);
  const [avatarFailed, setAvatarFailed] = useState(false);

  const ownedPlan = preferredBulkMembership(memberships);
  const mode = accountProductMode(memberships);
  const core = mode === "core";
  const publicFitness = mode === "public";
  const { bulkId } = useBulkMeta();
  const appData = useAppData();
  const today = useLocalDay();
  const gridStart = activityGridStart(today);

  const streak = useStreak();
  const ringProgress = useThisWeekRingProgress(streak.data?.thisWeek ?? null);
  const challenge = useMyChallenge().data;
  const summary = useActivitySummary(challenge?.id);
  const rides = useEnduranceActivities(challenge?.id, { start: gridStart, end: today });
  const sessions = useCompletedSessionDates(publicFitness ? bulkId : null, gridStart, today);
  const workoutCount = useCompletedWorkoutCount(publicFitness ? bulkId : null);
  const photoCount = usePhotoCount();

  // Clear the "New Fitness tools" dot once a Challenge-only user has opened their profile.
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

  const username = profile?.username;
  const initials = (username ?? user?.email ?? "").slice(0, 2).toUpperCase();
  const avatar = avatarFailed ? null : (profile?.avatar_url ?? null);

  // Ring = this week's ACTIVE streak goals that are done (real, from the streak RPC).
  const activeRings = streak.data?.activeRings ?? [];
  const ringsDone = activeRings.filter((ring) => ring.state === "closed").length;
  const ringFraction = activeRings.length ? ringsDone / activeRings.length : 0;

  // One real weekly line: Challenge distance if this week has a Run goal, else the Train goal.
  const run = ringProgress.run;
  const train = ringProgress.train;
  const weekLine =
    run?.kind === "count" && run.target != null
      ? `${km(run.current)} of ${km(run.target)} km`
      : train?.kind === "count" && train.target != null
        ? `${train.current} of ${train.target} workouts`
        : null;

  const mine = summary.data?.find((row) => row.userId === user?.id);
  const stats = [
    mine ? { value: String(km(mine.stats.totalKm)), label: "km run & ridden" } : null,
    publicFitness && workoutCount.data != null
      ? { value: String(workoutCount.data), label: "workouts" }
      : null,
    streak.data ? { value: String(streak.data.best), label: "best streak" } : null,
  ].filter((stat): stat is { value: string; label: string } => stat !== null);

  const trainedDates = collectCompletedWorkouts({
    sessions: sessions.data ?? null,
    legacyWorkouts: appData?.workouts ?? null,
    legacyDays: appData?.days ?? null,
  }).map((record) => record.workoutDate);
  const rideDates = (rides.data ?? [])
    .filter((activity) => activity.user_id === user?.id)
    .map((activity) => activity.activity_date);
  const grid = activityGrid([...trainedDates, ...rideDates], today);

  return (
    <AppShell>
      <header className="mb-2 flex items-center justify-between">
        <HistoryBackLink fallback="/today" iconOnly />
        <Link
          to="/profile/settings"
          aria-label="Settings"
          className="grid h-11 w-11 place-items-center rounded-full text-muted-foreground hover:bg-elevated active:opacity-80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <Settings className="h-5 w-5" aria-hidden="true" />
        </Link>
      </header>

      <section className="flex flex-col items-center text-center">
        <div
          className="relative h-28 w-28"
          aria-label={
            activeRings.length
              ? `This week's streak goals: ${ringsDone} of ${activeRings.length} done`
              : undefined
          }
        >
          <svg viewBox="0 0 112 112" className="absolute inset-0 -rotate-90" aria-hidden="true">
            <circle
              cx="56"
              cy="56"
              r="52"
              fill="none"
              strokeWidth="5"
              className="stroke-elevated"
            />
            <circle
              cx="56"
              cy="56"
              r="52"
              fill="none"
              strokeWidth="5"
              strokeLinecap="round"
              className="stroke-primary transition-[stroke-dashoffset] duration-500"
              strokeDasharray={2 * Math.PI * 52}
              strokeDashoffset={2 * Math.PI * 52 * (1 - ringFraction)}
            />
          </svg>
          <span className="absolute inset-2 grid place-items-center overflow-hidden rounded-full bg-elevated text-3xl font-semibold">
            {avatar ? (
              <img
                src={avatar}
                alt=""
                referrerPolicy="no-referrer"
                onError={() => setAvatarFailed(true)}
                className="h-full w-full object-cover"
              />
            ) : (
              initials
            )}
          </span>
          {streak.data ? (
            <Link
              to="/streak"
              aria-label={`Streak, ${streak.data.current} ${streak.data.current === 1 ? "week" : "weeks"}`}
              className="absolute -bottom-2 left-1/2 inline-flex min-h-7 -translate-x-1/2 items-center gap-1 rounded-full bg-orange-500 px-2.5 text-[13px] font-semibold text-white ring-4 ring-background"
            >
              <Flame className="h-3.5 w-3.5" aria-hidden="true" />
              <span className="num">{streak.data.current}</span>
            </Link>
          ) : null}
        </div>
        <h1 className="mt-5 w-full break-all text-2xl font-semibold tracking-tight">
          @{username ?? "…"}
        </h1>
        {weekLine ? (
          <p className="mt-1 text-[13px] text-muted-foreground">
            This week <span className="num font-medium text-primary">{weekLine}</span>
          </p>
        ) : null}
      </section>

      {stats.length ? (
        <dl
          className={`mt-5 grid ${stats.length === 3 ? "grid-cols-3" : stats.length === 2 ? "grid-cols-2" : "grid-cols-1"} divide-x divide-border text-center`}
        >
          {stats.map((stat) => (
            <div key={stat.label} className="min-w-0 px-1">
              <dt className="sr-only">{stat.label}</dt>
              <dd className="num text-[22px] font-semibold leading-7">{stat.value}</dd>
              <dd className="truncate text-[12px] text-muted-foreground" aria-hidden="true">
                {stat.label}
              </dd>
            </div>
          ))}
        </dl>
      ) : null}

      <section className="mt-5 rounded-[20px] bg-card p-4">
        <div className="grid grid-cols-2 gap-3">
          <div className="min-w-0">
            <p className="text-[13px] text-muted-foreground">Streak</p>
            <p className="mt-0.5 inline-flex items-center gap-1.5">
              <Flame className="h-4 w-4 text-orange-400" aria-hidden="true" />
              <span className="num text-xl font-semibold">{streak.data?.current ?? 0}</span>
              <span className="text-[13px] text-muted-foreground">
                {streak.data?.current === 1 ? "week" : "weeks"}
              </span>
            </p>
          </div>
          <div className="min-w-0">
            <p className="text-[13px] text-muted-foreground">Active days</p>
            <p className="mt-0.5">
              <span className="num text-xl font-semibold">{grid.perWeek}</span>{" "}
              <span className="text-[13px] text-muted-foreground">a week</span>
            </p>
          </div>
        </div>
        <ActivityHeatmap columns={grid.columns} />
        <div className="mt-2 flex justify-between text-[11px] text-muted-foreground">
          <span>13 weeks ago</span>
          <span>Today</span>
        </div>
        <p className="mt-1 text-[11px] text-muted-foreground">
          {core
            ? "Each square is a day you ran or rode."
            : "Each square is a day you trained, ran or rode."}
        </p>
      </section>

      {membershipsLoading ? (
        <div className="mt-4">
          <PageSkeleton label="Loading profile" />
        </div>
      ) : (
        <nav aria-label="Profile" className="mt-4 rounded-[20px] bg-card px-4">
          <ProfileRow to="/challenge/history" label="Challenges" />
          {!core ? (
            <>
              <ProfileRow to="/bulk/prs" label="Personal records" />
              <ProfileRow
                to="/bulk/progress/photos"
                label="Progress photos"
                {...(photoCount > 0 ? { value: String(photoCount) } : {})}
              />
            </>
          ) : null}
          {core && !ownedPlan ? (
            <ProfileRow to="/bulk-onboarding" label="Set up fitness tools" />
          ) : null}
        </nav>
      )}
      <div className="mt-5 border-t border-border pt-3">
        <SignOutButton />
      </div>
    </AppShell>
  );
}

/** Frequency view of active days (Monday-start columns); not the official weekly streak. */
function ActivityHeatmap({ columns }: { columns: ActivityCell[][] }) {
  return (
    <div
      role="img"
      aria-label="Active days over the last 13 weeks"
      className="mt-4 grid grid-flow-col grid-cols-[repeat(14,minmax(0,1fr))] grid-rows-7 gap-[3px]"
    >
      {columns.flat().map((cell) => (
        <span
          key={cell.date}
          className={`aspect-square rounded-[3px] ${
            cell.future
              ? "bg-transparent"
              : cell.count >= 2
                ? "bg-primary"
                : cell.count === 1
                  ? "bg-primary/50"
                  : "bg-elevated"
          } ${cell.today ? "ring-1 ring-foreground/60" : ""}`}
        />
      ))}
    </div>
  );
}

function ProfileRow({ to, label, value }: { to: string; label: string; value?: string }) {
  return (
    <Link
      to={to}
      className="flex min-h-14 items-center justify-between gap-3 border-t border-border first:border-t-0 active:opacity-80"
    >
      <span className="min-w-0 flex-1 truncate text-[15px] font-medium">{label}</span>
      <span className="flex shrink-0 items-center gap-2 text-[13px] text-muted-foreground">
        {value ? <span className="num">{value}</span> : null}
        <ChevronRight className="control-chevron" aria-hidden="true" />
      </span>
    </Link>
  );
}
