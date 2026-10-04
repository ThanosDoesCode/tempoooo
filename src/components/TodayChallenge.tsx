import { Link } from "@tanstack/react-router";
import { format, parseISO } from "date-fns";
import { ChevronRight } from "lucide-react";
import { useAuth } from "@/lib/auth";
import {
  useMyChallenge,
  useOutgoingInvitation,
  useChallengeMembers,
  useActivitySummary,
  useWeekTargets,
  useTravelPauses,
  resolvedTargetForWeek,
  weekNumberOf,
  weekBounds,
  todayIn,
  hoursLeft,
  weekPenaltyMessage,
} from "@/lib/challenge";
import { challengeParticipation, usePendingChallengeRefresh } from "@/lib/challenge-participation";
import { ChallengeShareInvite } from "./ChallengeShareInvite";
import { DataError } from "./ui-kit";

function SummarySkeleton({ label }: { label: string }) {
  return (
    <div
      role="status"
      aria-label={label}
      className="card-surface rounded-[20px] h-24 motion-safe:animate-pulse"
    >
      <span className="sr-only">{label}</span>
    </div>
  );
}

export function TodayChallenge({ hideDiscovery = false }: { hideDiscovery?: boolean }) {
  const { user } = useAuth();
  const query = useMyChallenge();
  const challenge = query.data;
  const members = useChallengeMembers(challenge?.id);
  const isCreator = !!challenge && challenge.created_by === user?.id;
  const outgoing = useOutgoingInvitation(challenge?.id, isCreator);
  const waiting =
    isCreator &&
    !outgoing.data?.accepted_at &&
    !members.data?.some((member) => member.userId !== user?.id);
  const now = usePendingChallengeRefresh(challenge?.id, waiting, outgoing.data?.expires_at);
  const participation = challengeParticipation(
    challenge,
    user?.id,
    members.data,
    outgoing.data,
    now,
  );
  const n = challenge ? weekNumberOf(challenge, todayIn(challenge.timezone)) : 0;
  const bounds = challenge ? weekBounds(challenge, Math.max(1, n)) : { start: "", end: "" };
  const summary = useActivitySummary(challenge?.id, bounds);
  const targets = useWeekTargets(challenge?.id);
  const pauses = useTravelPauses(challenge?.id);
  if (query.isLoading) return <SummarySkeleton label="Loading challenge" />;
  if (query.error)
    return (
      <DataError message="Could not load your challenge." onRetry={() => void query.refetch()} />
    );
  if (!challenge)
    return hideDiscovery ? null : (
      <Link
        to="/challenge"
        preload="intent"
        className="card-surface rounded-[20px] flex min-h-16 items-center justify-between gap-3 px-4 py-3 active:opacity-80"
      >
        <span>
          <span className="block text-[15px] font-medium">Challenge</span>
          <span className="block text-[13px] text-muted-foreground">Start one with a friend</span>
        </span>
        <ChevronRight className="h-5 w-5 shrink-0 text-muted-foreground" aria-hidden="true" />
      </Link>
    );
  if (members.isLoading || (isCreator && outgoing.isLoading))
    return <SummarySkeleton label="Loading challenge status" />;
  const statusError = [members, ...(isCreator ? [outgoing] : [])].find((q) => q.error);
  if (statusError)
    return (
      <DataError
        message="Could not load challenge status."
        onRetry={() => void statusError.refetch()}
      />
    );
  if (participation !== "accepted") {
    const username = outgoing.data?.invited_username;
    const expired = participation === "expired";
    return (
      <section className="card-surface rounded-[20px] space-y-3.5 p-5">
        <Link to="/challenge" preload="intent" className="block space-y-2 active:opacity-80">
          <div className="flex items-start justify-between gap-3">
            <h2 className="min-w-0 break-words text-[15px] font-medium">
              {username ? `Challenge with @${username}` : "Challenge"}
            </h2>
            <span className="shrink-0 rounded-full bg-secondary px-3 py-1 text-xs text-muted-foreground">
              {expired ? "Expired" : "Pending"}
            </span>
          </div>
          <p className="text-base font-medium">
            {expired
              ? "Send a fresh invitation"
              : username
                ? "Waiting for them to accept"
                : "Invite your opponent"}
          </p>
          <p className="text-[13px] text-muted-foreground">
            {challenge.weekly_target_km} km / week · {challenge.duration_weeks} weeks
          </p>
          <p className="text-[13px] text-muted-foreground">
            Starts {format(parseISO(challenge.start_date), "d MMM yyyy")}
          </p>
        </Link>
        {username && !expired ? (
          <ChallengeShareInvite username={username} compact />
        ) : (
          <Link
            to="/challenge"
            preload="intent"
            className="flex min-h-11 items-center font-medium text-primary"
          >
            Invite your opponent <ChevronRight className="ml-1 h-4 w-4" aria-hidden="true" />
          </Link>
        )}
      </section>
    );
  }
  if (n < 1 || n > challenge.duration_weeks)
    return (
      <Link
        to="/challenge"
        preload="intent"
        className="card-surface rounded-[20px] block space-y-1 px-4 py-3 active:opacity-80"
      >
        <h2 className="text-[15px] font-medium">
          {n < 1 ? "Your challenge starts soon" : "Challenge complete"}
        </h2>
        <p className="text-sm text-muted-foreground">
          {n < 1 ? `Starts ${challenge.start_date}` : "See your results and history"}
        </p>
      </Link>
    );
  if (members.isLoading || summary.isLoading || targets.isLoading || pauses.isLoading)
    return <SummarySkeleton label="Loading weekly progress" />;
  const failed = [members, summary, targets, pauses].find((q) => q.error);
  if (failed)
    return (
      <DataError message="Could not load weekly progress." onRetry={() => void failed.refetch()} />
    );
  const opponent = members.data?.find((m) => m.userId !== user?.id);
  const myKm = summary.data?.find((r) => r.userId === user?.id)?.equivalent ?? 0;
  const opponentKm = summary.data?.find((r) => r.userId === opponent?.userId)?.equivalent ?? 0;
  // Username snapshots are available to the creator; otherwise use the existing member display name.
  const opponentLabel =
    outgoing.data?.invited_user_id === opponent?.userId && outgoing.data
      ? `@${outgoing.data.invited_username}`
      : opponent?.name;
  const target = resolvedTargetForWeek(challenge, targets.data, pauses.data, user?.id ?? "", n);
  const penalty =
    target === 0
      ? { atRisk: false, line: "Week paused · no penalty" }
      : weekPenaltyMessage(myKm, target, challenge);
  return (
    <Link
      to="/challenge"
      preload="intent"
      className="card-surface rounded-[20px] block space-y-3.5 p-5 active:opacity-80"
    >
      <div className="flex items-start justify-between gap-3 text-[13px] text-muted-foreground">
        <h2 className="min-w-0 break-words">
          {opponentLabel ? `Challenge with ${opponentLabel}` : "Challenge"}
        </h2>
        <span className="shrink-0">
          {Math.max(0, Math.ceil(hoursLeft(challenge, n) / 24))} days left
        </span>
      </div>
      <p className="num">
        <span className="text-[52px] font-semibold leading-none tracking-tight">
          {myKm.toFixed(1)}
        </span>
        <span className="text-xl text-muted-foreground"> / {target} km</span>
      </p>
      <div
        className="h-1.5 overflow-hidden rounded-full bg-secondary"
        role="progressbar"
        aria-label="Your weekly challenge progress"
        aria-valuemin={0}
        aria-valuemax={target > 0 ? target : 1}
        aria-valuenow={Math.min(Math.max(0, myKm), target > 0 ? target : 1)}
        aria-valuetext={`${myKm.toFixed(1)} of ${target} challenge km${target === 0 ? ", week paused" : ""}`}
      >
        <div
          className="h-full rounded-full bg-primary"
          style={{ width: `${target > 0 ? Math.min(100, (myKm / target) * 100) : 0}%` }}
        />
      </div>
      <div className="flex flex-wrap items-start justify-between gap-x-3 gap-y-1 text-sm leading-relaxed">
        <span className={penalty.atRisk ? "text-warn" : "text-muted-foreground"}>
          {penalty.line}
        </span>
        {opponent ? (
          <span className="text-muted-foreground">
            {opponentLabel} {opponentKm.toFixed(1)} km
          </span>
        ) : null}
      </div>
    </Link>
  );
}
