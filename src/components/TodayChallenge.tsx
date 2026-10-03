import { Link } from "@tanstack/react-router";
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
import { PageSkeleton } from "./PageSkeleton";
import { DataError } from "./ui-kit";

export function TodayChallenge() {
  const { user } = useAuth();
  const query = useMyChallenge();
  const challenge = query.data;
  const members = useChallengeMembers(challenge?.id);
  const n = challenge ? weekNumberOf(challenge, todayIn(challenge.timezone)) : 0;
  const bounds = challenge ? weekBounds(challenge, Math.max(1, n)) : { start: "", end: "" };
  const summary = useActivitySummary(challenge?.id, bounds);
  const targets = useWeekTargets(challenge?.id);
  const pauses = useTravelPauses(challenge?.id);
  if (query.isLoading) return <PageSkeleton label="Loading challenge" />;
  if (query.error)
    return (
      <DataError message="Could not load your challenge." onRetry={() => void query.refetch()} />
    );
  if (!challenge)
    return (
      <div className="card-surface space-y-[14px] p-5">
        <div>
          <h2 className="text-xl font-semibold">Start your first challenge</h2>
          <p className="mt-1 text-[15px] text-muted-foreground">
            Keep each other moving, with something at stake.
          </p>
        </div>
        {[
          "Pick a friend and a weekly km target",
          "Log runs and rides with a screenshot",
          "Miss the target, follow your agreed stakes",
        ].map((text, i) => (
          <p key={text} className="flex items-center gap-3 text-[15px]">
            <span className="grid h-[26px] w-[26px] shrink-0 place-items-center rounded-full bg-primary/15 text-[13px] font-semibold text-primary">
              {i + 1}
            </span>
            {text}
          </p>
        ))}
        <Link
          to="/challenge/new"
          className="grid h-[52px] place-items-center rounded-[16px] bg-primary font-semibold text-primary-foreground"
        >
          Start a challenge
        </Link>
      </div>
    );
  if (n < 1 || n > challenge.duration_weeks)
    return (
      <Link to="/challenge" className="card-surface block space-y-1 p-[18px]">
        <h2 className="text-[17px] font-medium">
          {n < 1 ? "Your challenge starts soon" : "Challenge complete"}
        </h2>
        <p className="text-sm text-muted-foreground">
          {n < 1 ? `Starts ${challenge.start_date}` : "See your results and history"}
        </p>
      </Link>
    );
  if (members.isLoading || summary.isLoading || targets.isLoading || pauses.isLoading)
    return <PageSkeleton label="Loading weekly progress" />;
  const failed = [members, summary, targets, pauses].find((q) => q.error);
  if (failed)
    return (
      <DataError message="Could not load weekly progress." onRetry={() => void failed.refetch()} />
    );
  const opponent = members.data?.find((m) => m.userId !== user?.id);
  const myKm = summary.data?.find((r) => r.userId === user?.id)?.equivalent ?? 0;
  const opponentKm = summary.data?.find((r) => r.userId === opponent?.userId)?.equivalent ?? 0;
  const target = resolvedTargetForWeek(challenge, targets.data, pauses.data, user?.id ?? "", n);
  const penalty =
    target === 0
      ? { atRisk: false, line: "Week paused · no penalty" }
      : weekPenaltyMessage(myKm, target, challenge);
  return (
    <Link to="/challenge" className="card-surface flex flex-col gap-[14px] p-[18px]">
      <div className="flex flex-wrap justify-between gap-2 text-[13px] text-muted-foreground">
        <span>{opponent ? `Challenge with ${opponent.name}` : "Waiting for your opponent"}</span>
        <span>{Math.max(0, Math.ceil(hoursLeft(challenge, n) / 24))} days left</span>
      </div>
      <div className="num">
        <span className="text-[52px] font-semibold leading-none tracking-tight">
          {myKm.toFixed(1)}
        </span>
        <span className="text-xl text-muted-foreground"> / {target} km</span>
      </div>
      <div className="h-2 overflow-hidden rounded-full bg-secondary">
        <div
          className="h-full rounded-full bg-primary"
          style={{ width: `${target > 0 ? Math.min(100, (myKm / target) * 100) : 0}%` }}
        />
      </div>
      <div className="flex flex-wrap justify-between gap-2 text-sm">
        <span className={penalty.atRisk ? "text-warn" : "text-muted-foreground"}>
          {penalty.line}
        </span>
        {opponent ? (
          <span className="text-muted-foreground">
            {opponent.name} {opponentKm.toFixed(1)} km
          </span>
        ) : null}
      </div>
    </Link>
  );
}
