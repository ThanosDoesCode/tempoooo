import { createFileRoute, Link } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo } from "react";
import { differenceInCalendarDays, format, parseISO } from "date-fns";
import { Bike, ChevronRight, Footprints, Plus } from "lucide-react";
import { PageSkeleton, ActivityFeedSkeleton } from "@/components/PageSkeleton";
import { AppShell } from "@/components/AppShell";
import { Card, DataError, Note } from "@/components/ui-kit";
import { useAuth } from "@/lib/auth";

import { finalizeChallenge } from "@/lib/privileged-rpcs.functions";
import {
  formatPace,
  hoursLeft,
  km,
  owedText,
  paymentsQueryOptions,
  qualifiedEquivalentKm,
  resolvedTargetForWeek,
  useActivitySummary,
  targetOverrideForWeek,
  todayIn,
  useActivities,
  useChallengeMembers,
  useMyChallenge,
  useOutgoingInvitation,
  usePayments,
  useTravelPauses,
  useWeekTargets,
  useWeeks,
  weekPenaltyMessage,
  weeksQueryOptions,
  weekPaused,
  weekBounds,
  weekNumberOf,
  activityMetrics,
  type Activity,
} from "@/lib/challenge";
import { ChallengeInviteCard } from "@/components/ChallengeInvite";
import { challengeParticipation, usePendingChallengeRefresh } from "@/lib/challenge-participation";
import { ChallengeWaiting } from "@/components/ChallengeWaiting";
import { MainPageHeader } from "@/components/MainPageHeader";
import { ChallengeParticipantHeading, ChallengeStatus } from "@/components/ChallengeParticipant";
import { ChallengeInvitations } from "@/components/ChallengeInvitations";

export const Route = createFileRoute("/_authenticated/challenge/")({
  validateSearch: (search: Record<string, unknown>): { challenge?: string | undefined } => ({
    challenge:
      typeof search["challenge"] === "string" &&
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(search["challenge"])
        ? search["challenge"]
        : undefined,
  }),
  head: () => ({
    meta: [
      { title: "Tempo" },
      {
        name: "description",
        content:
          "Track this week's equivalent kilometres, live penalty and remaining distance in your private two-person endurance challenge.",
      },
      { property: "og:title", content: "Tempo" },
      {
        property: "og:description",
        content: "Configurable equivalent km targets, running and cycling, tiered penalties.",
      },
    ],
  }),
  component: ChallengeHome,
});

function ChallengeHome() {
  const { user } = useAuth();
  const qc = useQueryClient();
  const { challenge: challengeId } = Route.useSearch();
  const challengeQuery = useMyChallenge(challengeId);
  const { data: challenge, isLoading, error: challengeError } = challengeQuery;
  const membersQuery = useChallengeMembers(challenge?.id);
  const { data: members, isLoading: membersLoading, error: membersError } = membersQuery;
  const pausesQuery = useTravelPauses(challenge?.id);
  const { data: travelPauses, isLoading: pausesLoading, error: pausesError } = pausesQuery;
  const weeksQuery = useWeeks(challenge?.id);
  const weekTargetsQuery = useWeekTargets(challenge?.id);
  const {
    data: weekTargets,
    isLoading: weekTargetsLoading,
    error: weekTargetsError,
  } = weekTargetsQuery;
  const paymentsQuery = usePayments(challenge?.id);

  // Lazy, deterministic server-side finalization of any closed weeks.
  useEffect(() => {
    if (!challenge) return;
    void finalizeChallenge({ data: { challenge: challenge.id } }).then(() =>
      qc.invalidateQueries({ queryKey: ["challenge-weeks", challenge.id] }),
    );
  }, [challenge, qc]);

  // Warm the two small datasets used by History and Money.
  useEffect(() => {
    if (!challenge) return;
    void qc.prefetchQuery(weeksQueryOptions(challenge.id));
    void qc.prefetchQuery(paymentsQueryOptions(challenge.id));
  }, [challenge, qc]);

  const week = useMemo(() => {
    if (!challenge) return null;
    const n = weekNumberOf(challenge, todayIn(challenge.timezone));
    return { n, ...weekBounds(challenge, n), hours: hoursLeft(challenge, n) };
  }, [challenge]);

  const isCreator = !!challenge && challenge.created_by === user?.id;
  const outgoingQuery = useOutgoingInvitation(challenge?.id, isCreator);
  const waiting =
    isCreator &&
    !outgoingQuery.data?.accepted_at &&
    !members?.some((member) => member.userId !== user?.id);
  const now = usePendingChallengeRefresh(challenge?.id, waiting, outgoingQuery.data?.expires_at);
  const participation = challengeParticipation(
    challenge,
    user?.id,
    members,
    outgoingQuery.data,
    now,
  );

  const range = week ? { start: week.start, end: week.end } : { start: "", end: "" };
  const summaryQuery = useActivitySummary(challenge?.id, range);
  const activitiesQuery = useActivities(challenge?.id, range);
  const { activities, isLoading: activitiesLoading, error: activitiesError } = activitiesQuery;

  if (isLoading) {
    return (
      <AppShell>
        <ChallengeHeader />
        <PageSkeleton label="Loading Challenge" />
      </AppShell>
    );
  }

  if (challengeError && !challenge) {
    return (
      <AppShell>
        <ChallengeHeader />
        <DataError
          message="Check your connection and try loading your challenge again."
          onRetry={() => void challengeQuery.refetch()}
        />
      </AppShell>
    );
  }

  if (!challenge) {
    return (
      <AppShell>
        <ChallengeHeader subtitle="A private two-person endurance bet." />
        <ChallengeInvitations />
        <Card className="mt-3 space-y-3 p-[18px]">
          <p className="text-[15px] leading-relaxed">
            Start a private challenge with one friend: a weekly km target, running and cycling, and
            a penalty when someone falls short.
          </p>
          <Link
            to="/challenge/new"
            className="flex h-[54px] items-center justify-center rounded-[16px] bg-primary text-base font-semibold text-primary-foreground"
          >
            Create a challenge
          </Link>
          <Note>
            Joining is invite-only. If a friend invited you, open your notification inbox or accept
            here.
          </Note>
        </Card>
      </AppShell>
    );
  }

  const today = todayIn(challenge.timezone);
  const opponent = members?.find((member) => member.userId !== user?.id);
  const zero = { running: 0, cycling: 0, equivalent: 0 };
  const meTotals = summaryQuery.data?.find((row) => row.userId === user?.id) ?? zero;
  const opponentTotals = opponent
    ? (summaryQuery.data?.find((row) => row.userId === opponent.userId) ?? zero)
    : null;
  const mePaused = !!(week && user && weekPaused(travelPauses, user.id, week.n));
  const opponentPaused = !!(week && opponent && weekPaused(travelPauses, opponent.userId, week.n));
  const commonTarget = week
    ? targetOverrideForWeek(challenge, weekTargets, week.n)
    : Number(challenge.weekly_target_km);
  const meTarget =
    week && user
      ? resolvedTargetForWeek(challenge, weekTargets, travelPauses, user.id, week.n)
      : commonTarget;
  const opponentTarget =
    week && opponent
      ? resolvedTargetForWeek(challenge, weekTargets, travelPauses, opponent.userId, week.n)
      : commonTarget;
  const myActivities = activities.filter((activity) => activity.user_id === user?.id);
  const needsOpponent = !membersLoading && (members?.length ?? 0) < (challenge.max_members ?? 2);
  const progressLoading =
    membersLoading || summaryQuery.isLoading || pausesLoading || weekTargetsLoading;

  const penalty = mePaused
    ? { atRisk: false, line: "This week is paused — 0 km, no penalty." }
    : weekPenaltyMessage(meTotals.equivalent, meTarget, challenge);

  const finishedWeeks = new Set((weeksQuery.data ?? []).map((w) => w.week_number)).size;
  const openPayments = (paymentsQuery.data ?? []).filter((p) => p.status !== "confirmed_paid");
  const iOwe = openPayments
    .filter((p) => p.payer_id === user?.id)
    .reduce((s, p) => s + Number(p.amount_eur), 0);
  const owedToMe = openPayments
    .filter((p) => p.recipient_id === user?.id)
    .reduce((s, p) => s + Number(p.amount_eur), 0);
  const moneyHint =
    iOwe > 0
      ? `You owe ${owedText(iOwe, challenge.legacy_photo_owed)}`
      : owedToMe > 0
        ? `You’re owed ${owedText(owedToMe, challenge.legacy_photo_owed)}`
        : "All square";

  const preStart = !!week && week.n < 1;

  // Creator is still waiting for the opponent to accept: the pending/Waiting screen (no "Week 0").
  if (membersLoading || (isCreator && outgoingQuery.isLoading)) {
    return (
      <AppShell>
        <ChallengeHeader />
        <PageSkeleton label="Loading challenge status" />
      </AppShell>
    );
  }
  if (membersError || (isCreator && outgoingQuery.error)) {
    return (
      <AppShell>
        <ChallengeHeader />
        <DataError
          message="Could not load challenge status."
          onRetry={() => {
            void membersQuery.refetch();
            if (isCreator) void outgoingQuery.refetch();
          }}
        />
      </AppShell>
    );
  }
  if (participation !== "accepted") {
    return (
      <AppShell>
        <ChallengeWaiting
          challenge={challenge}
          invitation={outgoingQuery.data ?? null}
          expired={participation === "expired"}
        />
        <ChallengeInvitations />
      </AppShell>
    );
  }

  // Both accepted but the first Monday has not arrived yet: a pre-start card, never "Week 0".
  if (preStart) {
    return (
      <AppShell>
        <MainPageHeader title="Starts soon" />
        <ChallengeInvitations />
        <Card className="space-y-1 p-5">
          <p className="break-words text-sm text-muted-foreground">
            {opponent ? `With ${opponent.name} · ` : ""}
            {challenge.duration_weeks}-week challenge
          </p>
          <p className="text-base font-medium">
            Starts {format(parseISO(challenge.start_date), "EEEE d MMM")}
          </p>
          <p className="text-sm text-muted-foreground">
            Your first week runs Monday to Sunday in {challenge.timezone} time. Log runs and rides
            once it begins.
          </p>
        </Card>
        <div className="mt-3.5 rounded-[20px] bg-card px-4">
          <DestinationRow
            to="/challenge/terms"
            label="See the terms"
            hint={`${new Intl.NumberFormat("en", { maximumFractionDigits: 1 }).format(commonTarget)} km a week`}
          />
        </div>
      </AppShell>
    );
  }

  return (
    <AppShell>
      <MainPageHeader title="This week" />
      <ChallengeInvitations />

      {membersError || activitiesError || summaryQuery.error || pausesError || weekTargetsError ? (
        <div className="mb-3">
          <DataError
            title="Some challenge data did not load"
            message="Your saved data is unchanged. Retry to refresh progress, activities, and travel pauses."
            onRetry={() => {
              void Promise.all([
                membersQuery.refetch(),
                activitiesQuery.refetch(),
                summaryQuery.refetch(),
                pausesQuery.refetch(),
                weekTargetsQuery.refetch(),
              ]);
            }}
          />
        </div>
      ) : null}

      <Card className="space-y-3.5 p-5">
        <div className="flex items-start justify-between gap-3 text-[13px] text-muted-foreground">
          <div className="min-w-0">
            <p className="text-sm font-medium text-foreground">
              Week {week?.n} of {challenge.duration_weeks}
            </p>
            <p className="mt-1">
              {week
                ? `${format(parseISO(week.start), "EEE d")} – ${format(parseISO(week.end), "EEE d MMM")}`
                : ""}
            </p>
          </div>
          <span className="shrink-0">{daysLeft(week?.hours ?? 0)}</span>
        </div>

        <ParticipantBar
          label="You"
          totals={meTotals}
          target={meTarget}
          paused={mePaused}
          barClass="bg-primary"
          loading={progressLoading}
        />
        <div className="border-t border-border pt-3.5">
          <ParticipantBar
            label={opponent?.name ?? "Opponent"}
            totals={opponentTotals}
            target={opponentTarget}
            paused={opponentPaused}
            barClass="bg-chart-2"
            loading={progressLoading}
            missing={!opponent}
          />
        </div>

        {!progressLoading ? (
          <ChallengeStatus atRisk={penalty.atRisk}>{penalty.line}</ChallengeStatus>
        ) : null}
      </Card>

      <Link
        to="/challenge/add"
        className="mt-3.5 flex h-[52px] items-center justify-center gap-2 rounded-[16px] bg-primary text-base font-semibold text-primary-foreground active:scale-[0.99]"
      >
        <Plus className="h-5 w-5" strokeWidth={2.4} aria-hidden="true" /> Add run or ride
      </Link>

      <section className="mt-5">
        <p className="mx-1 mb-1.5 text-[13px] font-medium text-muted-foreground">Your activities</p>
        {activitiesLoading ? (
          <ActivityFeedSkeleton />
        ) : myActivities.length ? (
          <div className="rounded-[20px] bg-card px-4">
            {myActivities.map((activity) => (
              <ActivityRow key={activity.id} activity={activity} today={today} />
            ))}
          </div>
        ) : (
          <Note>No runs or rides yet this week. Add one when you have its screenshot.</Note>
        )}
        {activitiesQuery.hasNextPage ? (
          <button
            type="button"
            disabled={activitiesQuery.isFetchingNextPage}
            onClick={() => void activitiesQuery.fetchNextPage()}
            className="mt-2 min-h-11 w-full rounded-[14px] bg-card text-[13px] font-medium text-muted-foreground disabled:opacity-60"
          >
            {activitiesQuery.isFetchingNextPage ? "Loading older…" : "Load older"}
          </button>
        ) : null}
      </section>

      <section className="mt-3.5">
        <div className="rounded-[20px] bg-card px-4">
          <DestinationRow
            to="/challenge/history"
            label="History"
            hint={
              finishedWeeks
                ? `${finishedWeeks} finished week${finishedWeeks === 1 ? "" : "s"}`
                : "No finished weeks yet"
            }
          />
          <DestinationRow
            to="/challenge/terms"
            label="Terms & travel pause"
            hint={`${new Intl.NumberFormat("en", { maximumFractionDigits: 1 }).format(commonTarget)} km`}
          />
          <DestinationRow
            to="/challenge/money"
            label="Money"
            hint={moneyHint}
            hintTone={iOwe > 0 ? "warn" : "muted"}
          />
        </div>
      </section>

      {needsOpponent ? (
        <section className="mt-5 space-y-2">
          <Note>
            Your opponent has not joined yet. Your progress is saved; send them a fresh invitation
            link when they are ready.
          </Note>
          <ChallengeInviteCard challengeId={challenge.id} />
        </section>
      ) : null}
    </AppShell>
  );
}

type ProgressTotals = { running: number; cycling: number; equivalent: number };

function ChallengeHeader({ subtitle }: { subtitle?: string }) {
  return (
    <>
      <MainPageHeader title="Challenge" />
      {subtitle ? <p className="mb-3.5 text-sm text-muted-foreground">{subtitle}</p> : null}
    </>
  );
}

function ParticipantBar({
  label,
  totals,
  target,
  barClass,
  loading = false,
  paused = false,
  missing = false,
}: {
  label: string;
  totals: ProgressTotals | null;
  target: number;
  barClass: string;
  loading?: boolean;
  paused?: boolean;
  missing?: boolean;
}) {
  if (loading) {
    return (
      <div className="space-y-2">
        <div className="h-5 w-32 animate-pulse rounded-md bg-elevated" />
        <div className="h-2 animate-pulse rounded-full bg-elevated" />
      </div>
    );
  }
  if (missing || !totals) {
    return (
      <div className="space-y-2.5">
        <ChallengeParticipantHeading label={label} />
        <div className="h-2 rounded-full bg-elevated" />
        <p className="text-[13px] text-muted-foreground">Hasn’t joined yet</p>
      </div>
    );
  }
  const equivalent = totals.equivalent;
  const pct = target > 0 ? Math.min(100, (equivalent / target) * 100) : 0;
  return (
    <div className="space-y-2.5">
      <ChallengeParticipantHeading
        label={label}
        status={paused ? "Paused" : undefined}
        value={equivalent.toFixed(1)}
        suffix={`/ ${target.toFixed(target % 1 === 0 ? 0 : 1)} km`}
      />
      <div className="h-2 overflow-hidden rounded-full bg-elevated">
        <div
          className={`h-full rounded-full transition-all duration-500 ${barClass}`}
          style={{ width: `${paused ? 100 : pct}%` }}
        />
      </div>
    </div>
  );
}

function ActivityRow({ activity, today }: { activity: Activity; today: string }) {
  const metrics = activityMetrics(activity);
  const run = activity.activity_type === "run";
  const eq = qualifiedEquivalentKm(activity);
  return (
    <Link
      to="/challenge/activity/$activityId"
      params={{ activityId: activity.id }}
      preload="intent"
      className="flex min-h-[52px] items-center justify-between gap-3 border-t border-border py-2.5 first:border-t-0 active:opacity-80"
    >
      <span
        className={`grid h-9 w-9 flex-none place-items-center rounded-[11px] ${
          run ? "bg-primary/15 text-primary" : "bg-chart-2/15 text-chart-2"
        }`}
      >
        {run ? (
          <Footprints className="h-4 w-4" aria-hidden="true" />
        ) : (
          <Bike className="h-4 w-4" aria-hidden="true" />
        )}
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-[15px] font-medium">
          {run ? "Run" : "Ride"} · {Number(activity.distance_km).toFixed(1)} km
        </p>
        <p className="text-[13px] text-muted-foreground">
          {activityDay(activity.activity_date, today)}
          {activity.duration_seconds
            ? run
              ? ` · ${formatPace(metrics.averagePace).replace(" min/km", " /km")}`
              : ` · ${metrics.averageSpeed?.toFixed(1)} km/h`
            : ""}
        </p>
      </div>
      <span
        className={`num text-[15px] font-semibold ${metrics.qualified ? "" : "text-muted-foreground"}`}
      >
        {metrics.qualified ? `+${eq.toFixed(1)}` : "0"}
      </span>
      <ChevronRight className="control-chevron text-muted-foreground" aria-hidden="true" />
    </Link>
  );
}

function DestinationRow({
  to,
  label,
  hint,
  hintTone,
}: {
  to: string;
  label: string;
  hint: string;
  hintTone?: "warn" | "muted";
}) {
  return (
    <Link
      to={to}
      preload="intent"
      className="flex min-h-[52px] items-center justify-between gap-3 border-t border-border first:border-t-0 active:opacity-80"
    >
      <span className="flex-1 text-[15px] font-medium">{label}</span>
      <span
        className={`text-[13px] ${hintTone === "warn" ? "text-warn-soft" : "text-muted-foreground"}`}
      >
        {hint}
      </span>
      <ChevronRight className="control-chevron text-muted-foreground" aria-hidden="true" />
    </Link>
  );
}

function daysLeft(hours: number) {
  const days = Math.max(0, Math.ceil(hours / 24));
  return `${days} day${days === 1 ? "" : "s"} left`;
}

function activityDay(day: string, today: string) {
  const difference = differenceInCalendarDays(parseISO(today), parseISO(day));
  if (difference === 0) return "Today";
  if (difference === 1) return "Yesterday";
  return format(parseISO(day), "EEE d MMM");
}
