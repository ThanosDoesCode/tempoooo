import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import { format, parseISO } from "date-fns";
import { AppShell, PageHeader } from "@/components/AppShell";
import { ChallengeTermsSummary } from "@/components/challenge-rules";
import { Card, DataError, Note, PendingLabel, SectionTitle } from "@/components/ui-kit";
import { useAuth } from "@/lib/auth";
import {
  targetOverrideForWeek,
  todayIn,
  useMyChallenge,
  useWeekTargets,
  weekBounds,
  weekNumberOf,
  type Challenge,
  type WeekTargetOverride,
} from "@/lib/challenge";
import { countryListLabel } from "@/lib/countries";
import { userFacingError } from "@/lib/network-errors";
import { setChallengeWeekTarget } from "@/lib/privileged-rpcs.functions";

export const Route = createFileRoute("/_authenticated/challenge/targets")({
  head: () => ({ meta: [{ title: "Tempo" }] }),
  component: Targets,
});

function Targets() {
  const { user } = useAuth();
  const challengeQuery = useMyChallenge();
  const { data: challenge, isLoading, error } = challengeQuery;
  const targetsQuery = useWeekTargets(challenge?.id);
  const currentWeek = challenge ? weekNumberOf(challenge, todayIn(challenge.timezone)) : 0;
  const firstFuture = Math.max(1, currentWeek + 1);
  const futureWeeks = challenge
    ? Array.from(
        { length: Math.max(0, challenge.duration_weeks - firstFuture + 1) },
        (_, index) => firstFuture + index,
      )
    : [];

  return (
    <AppShell>
      <PageHeader title="Weekly terms" subtitle="Base terms stay fixed; future targets can vary." />
      {isLoading || (challenge && targetsQuery.isLoading) ? (
        <div className="h-40 animate-pulse rounded-2xl bg-card" aria-label="Loading weekly terms" />
      ) : null}
      {error || targetsQuery.error ? (
        <DataError
          message="Weekly targets could not be loaded. Your saved terms are unchanged."
          onRetry={() => void Promise.all([challengeQuery.refetch(), targetsQuery.refetch()])}
        />
      ) : null}
      {!isLoading && !error && !challenge ? (
        <Note>You are not part of a challenge yet.</Note>
      ) : null}
      {challenge && !targetsQuery.error ? (
        <>
          <Card>
            <SectionTitle>Base target · {formatTarget(challenge.weekly_target_km)} km</SectionTitle>
            <p className="text-sm leading-6 text-muted-foreground">
              A future week inherits this target unless the creator adds an override. Penalties,
              travel rules and other agreed terms remain immutable.
            </p>
            <div className="mt-3">
              <ChallengeTermsSummary terms={challenge} />
            </div>
            <p className="mt-3 text-sm text-muted-foreground">
              {challenge.travel_pause_enabled
                ? `A participant who pauses outside ${countryListLabel(challenge.travel_pause_home_countries, "disjunction")} has a 0 km target and no penalty for that week.`
                : "Travel pauses are not allowed under this Challenge's agreed terms."}
            </p>
            <Link
              to="/challenge/payments"
              className="mt-4 flex min-h-11 items-center justify-center rounded-xl bg-primary px-3 py-2 text-center text-sm font-semibold text-primary-foreground"
            >
              Open Money and travel settings
            </Link>
          </Card>

          <section className="mt-5">
            <SectionTitle>Locked weeks</SectionTitle>
            <Note>
              {currentWeek < 1
                ? "The Challenge has not started. Every scheduled week is still eligible for a future override."
                : `Weeks 1–${Math.min(currentWeek, challenge.duration_weeks)} are current or past and cannot be changed.`}
            </Note>
          </section>

          <section className="mt-5">
            <SectionTitle>Upcoming weeks</SectionTitle>
            {futureWeeks.length ? (
              <div className="space-y-2">
                {futureWeeks.map((weekNumber) => (
                  <FutureWeekTarget
                    key={weekNumber}
                    challenge={challenge}
                    weekNumber={weekNumber}
                    override={targetsQuery.data?.find(
                      (target) => target.week_number === weekNumber,
                    )}
                    canEdit={challenge.created_by === user?.id}
                  />
                ))}
              </div>
            ) : (
              <Note>There are no future weeks left in this Challenge.</Note>
            )}
            {challenge.created_by !== user?.id && futureWeeks.length ? (
              <p className="mt-3 text-xs text-muted-foreground">
                Upcoming targets are read-only. Only the Challenge creator can change them.
              </p>
            ) : null}
          </section>
        </>
      ) : null}
    </AppShell>
  );
}

function FutureWeekTarget({
  challenge,
  weekNumber,
  override,
  canEdit,
}: {
  challenge: Challenge;
  weekNumber: number;
  override: WeekTargetOverride | undefined;
  canEdit: boolean;
}) {
  const queryClient = useQueryClient();
  const effective = targetOverrideForWeek(challenge, override ? [override] : [], weekNumber);
  const bounds = weekBounds(challenge, weekNumber);
  const [value, setValue] = useState(String(effective));
  const [busy, setBusy] = useState<"save" | "reset" | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const mutate = async (targetKm: number | null) => {
    if (busy) return;
    setBusy(targetKm === null ? "reset" : "save");
    setMessage(null);
    setError(null);
    try {
      await setChallengeWeekTarget({ data: { challenge: challenge.id, weekNumber, targetKm } });
      await queryClient.invalidateQueries({ queryKey: ["challenge-week-targets", challenge.id] });
      if (targetKm === null) setValue(String(challenge.weekly_target_km));
      setMessage(targetKm === null ? "Base target restored." : "Future target saved.");
    } catch (cause) {
      setError(userFacingError(cause, "update the future target"));
    } finally {
      setBusy(null);
    }
  };

  return (
    <details className="group card-surface overflow-hidden">
      <summary className="flex min-h-11 cursor-pointer list-none items-center gap-3 px-3 py-2.5 [&::-webkit-details-marker]:hidden">
        <span className="min-w-0 flex-1">
          <span className="block text-sm font-semibold">Week {weekNumber}</span>
          <span className="block text-[11px] text-muted-foreground">
            {format(parseISO(bounds.start), "d MMM")}–{format(parseISO(bounds.end), "d MMM yyyy")}
          </span>
        </span>
        <span className="text-right">
          <span className="num block text-sm font-semibold">{formatTarget(effective)} km</span>
          <span className="block text-[10px] text-muted-foreground">
            {override ? "Overridden" : "Inherited"}
          </span>
        </span>
      </summary>
      {canEdit ? (
        <div className="border-t border-border p-3">
          <label className="text-xs font-medium text-muted-foreground">
            Target for Week {weekNumber}
            <div className="mt-1 flex items-center rounded-xl border border-input bg-elevated">
              <input
                type="number"
                min="1"
                max="500"
                step="0.01"
                inputMode="decimal"
                value={value}
                disabled={busy !== null}
                onChange={(event) => setValue(event.target.value)}
                className="num min-h-11 min-w-0 flex-1 bg-transparent px-3 text-base outline-none"
              />
              <span className="pr-3">km</span>
            </div>
          </label>
          <div className="mt-2 grid grid-cols-2 gap-2">
            <button
              type="button"
              disabled={busy !== null || !override}
              onClick={() => void mutate(null)}
              className="min-h-11 rounded-xl border border-border px-3 text-sm font-medium disabled:opacity-50"
            >
              {busy === "reset" ? <PendingLabel>Resetting…</PendingLabel> : "Use base target"}
            </button>
            <button
              type="button"
              disabled={busy !== null}
              onClick={() => void mutate(Number(value))}
              className="min-h-11 rounded-xl bg-primary px-3 text-sm font-semibold text-primary-foreground disabled:opacity-50"
            >
              {busy === "save" ? <PendingLabel>Saving…</PendingLabel> : "Save target"}
            </button>
          </div>
          {message ? (
            <p role="status" className="mt-2 text-xs text-good">
              {message}
            </p>
          ) : null}
          {error ? (
            <p role="alert" className="mt-2 text-xs text-danger">
              {error}
            </p>
          ) : null}
        </div>
      ) : null}
    </details>
  );
}

function formatTarget(value: number | string | null | undefined) {
  if (value === null || value === undefined) return "—";
  return new Intl.NumberFormat("en", { maximumFractionDigits: 2 }).format(Number(value));
}
