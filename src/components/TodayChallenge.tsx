import { Link } from "@tanstack/react-router";
import { ChevronRight } from "lucide-react";
import { useAuth } from "@/lib/auth";
import {
  useMyChallenge,
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
  const target = resolvedTargetForWeek(challenge, targets.data, pauses.data, user?.id ?? "", n);
  const penalty =
    target === 0
      ? { atRisk: false, line: "Week paused · no penalty" }
      : weekPenaltyMessage(myKm, target, challenge);
  return (
    <Link
      to="/challenge"
      preload="intent"
      className="card-surface rounded-[20px] block space-y-2 px-4 py-3 active:opacity-80"
    >
      <h2 className="text-[15px] font-medium">
        {opponent ? `Challenge with ${opponent.name}` : "Waiting for your opponent"}
      </h2>
      <p className="num text-[13px] text-muted-foreground">
        <span className="font-medium text-foreground">
          {myKm.toFixed(1)} / {target} km
        </span>{" "}
        · {Math.max(0, Math.ceil(hoursLeft(challenge, n) / 24))}d left
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
      <p className="text-xs leading-relaxed">
        <span className={penalty.atRisk ? "text-warn" : "text-muted-foreground"}>
          {penalty.line}
        </span>
      </p>
    </Link>
  );
}
