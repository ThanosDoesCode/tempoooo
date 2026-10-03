import { createFileRoute } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { format, parseISO } from "date-fns";
import { AppShell, PageHeader } from "@/components/AppShell";
import { Card, DataError, Note, PendingLabel } from "@/components/ui-kit";
import { useAuth } from "@/lib/auth";
import { userFacingError } from "@/lib/network-errors";
import { setChallengeWeekTarget } from "@/lib/privileged-rpcs.functions";
import {
  challengeTerms,
  eur,
  targetOverrideForWeek,
  todayIn,
  useMyChallenge,
  useWeekTargets,
  weekBounds,
  weekNumberOf,
  type Challenge,
  type WeekTargetOverride,
} from "@/lib/challenge";

const INITIAL_VISIBLE = 6;

export const Route = createFileRoute("/_authenticated/challenge/terms_/override")({
  head: () => ({ meta: [{ title: "Tempo" }] }),
  component: TargetOverride,
});

function TargetOverride() {
  const challengeQuery = useMyChallenge();
  const { data: challenge, isLoading, error } = challengeQuery;
  const targetsQuery = useWeekTargets(challenge?.id);

  return (
    <AppShell>
      <PageHeader
        title="Change one week’s target"
        subtitle="For a holiday or a race week. Only the creator can do this, before the week starts."
        backTo="/challenge/terms"
        backLabel="Terms"
      />
      {isLoading || (challenge && targetsQuery.isLoading) ? (
        <div className="h-64 animate-pulse rounded-[20px] bg-card" aria-label="Loading weeks" />
      ) : error || targetsQuery.error ? (
        <DataError
          message="Week targets could not be loaded. Your saved terms are unchanged."
          onRetry={() => void Promise.all([challengeQuery.refetch(), targetsQuery.refetch()])}
        />
      ) : !challenge ? (
        <Note>You are not part of a challenge yet.</Note>
      ) : (
        <OverrideEditor challenge={challenge} overrides={targetsQuery.data ?? []} />
      )}
    </AppShell>
  );
}

function OverrideEditor({
  challenge,
  overrides,
}: {
  challenge: Challenge;
  overrides: WeekTargetOverride[];
}) {
  const { user } = useAuth();
  const qc = useQueryClient();
  const canEdit = challenge.created_by === user?.id;
  const terms = challengeTerms(challenge);

  const currentWeek = weekNumberOf(challenge, todayIn(challenge.timezone));
  const firstFuture = Math.max(1, currentWeek + 1);
  const futureWeeks = useMemo(
    () =>
      Array.from(
        { length: Math.max(0, challenge.duration_weeks - firstFuture + 1) },
        (_, index) => firstFuture + index,
      ),
    [challenge.duration_weeks, firstFuture],
  );

  const [showLater, setShowLater] = useState(false);
  const [selected, setSelected] = useState<number | null>(futureWeeks[0] ?? null);
  const [target, setTarget] = useState<number>(() =>
    futureWeeks[0]
      ? targetOverrideForWeek(challenge, overrides, futureWeeks[0])
      : terms.weekly_target_km,
  );
  const [busy, setBusy] = useState<"save" | "reset" | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  if (futureWeeks.length === 0) {
    return <Note>There are no future weeks left to change in this challenge.</Note>;
  }

  const visible = showLater ? futureWeeks : futureWeeks.slice(0, INITIAL_VISIBLE);
  const selectedHasOverride = overrides.some((o) => o.week_number === selected);

  const pick = (week: number) => {
    setSelected(week);
    setTarget(targetOverrideForWeek(challenge, overrides, week));
    setMessage(null);
    setError(null);
  };

  const mutate = async (targetKm: number | null) => {
    if (!selected || busy) return;
    setBusy(targetKm === null ? "reset" : "save");
    setMessage(null);
    setError(null);
    try {
      await setChallengeWeekTarget({
        data: { challenge: challenge.id, weekNumber: selected, targetKm },
      });
      await qc.invalidateQueries({ queryKey: ["challenge-week-targets", challenge.id] });
      if (targetKm === null) setTarget(terms.weekly_target_km);
      setMessage(targetKm === null ? "Base target restored." : `Week ${selected} saved.`);
    } catch (cause) {
      setError(userFacingError(cause, "update the week target"));
    } finally {
      setBusy(null);
    }
  };

  const bounds = selected ? weekBounds(challenge, selected) : null;

  return (
    <div className="space-y-3.5">
      <div className="rounded-[20px] bg-card px-4" role="radiogroup" aria-label="Week">
        {visible.map((week) => {
          const effective = targetOverrideForWeek(challenge, overrides, week);
          const overridden = overrides.some((o) => o.week_number === week);
          const wb = weekBounds(challenge, week);
          const on = selected === week;
          return (
            <button
              key={week}
              type="button"
              role="radio"
              aria-checked={on}
              onClick={() => pick(week)}
              className="flex min-h-[54px] w-full items-center gap-3 border-t border-border text-left text-[15px] first:border-t-0"
            >
              <span
                className={`h-5 w-5 flex-none rounded-full ${
                  on ? "border-[6px] border-primary" : "border-2 border-[oklch(38%_.01_260)]"
                }`}
              />
              <span className="flex-1">
                Week {week} · {format(parseISO(wb.start), "d MMM")}–
                {format(parseISO(wb.end), "d MMM")}
              </span>
              <span className="num text-muted-foreground">
                {formatKm(effective)} km{overridden ? " ·" : ""}
                {overridden ? <span className="text-primary"> changed</span> : null}
              </span>
            </button>
          );
        })}
        {futureWeeks.length > INITIAL_VISIBLE && !showLater ? (
          <button
            type="button"
            onClick={() => setShowLater(true)}
            className="flex min-h-[54px] w-full items-center border-t border-border text-[15px] font-medium text-primary"
          >
            Show later weeks
          </button>
        ) : null}
      </div>

      {canEdit && selected ? (
        <>
          <p className="px-1 text-[13px] text-muted-foreground">New target for week {selected}</p>
          <div className="flex h-16 items-center justify-between rounded-[14px] bg-card px-2">
            <button
              type="button"
              aria-label="Less"
              disabled={busy !== null || target <= 1}
              onClick={() => setTarget((value) => Math.max(1, Math.round(value) - 1))}
              className="h-12 w-12 rounded-xl bg-elevated text-2xl font-medium disabled:opacity-40"
            >
              –
            </button>
            <span className="num text-2xl font-semibold">{formatKm(target)} km</span>
            <button
              type="button"
              aria-label="More"
              disabled={busy !== null || target >= 500}
              onClick={() => setTarget((value) => Math.min(500, Math.round(value) + 1))}
              className="h-12 w-12 rounded-xl bg-elevated text-2xl font-medium disabled:opacity-40"
            >
              +
            </button>
          </div>
          <p className="px-1 text-[13px] leading-relaxed text-muted-foreground">
            {terms.penalty_mode === "money"
              ? `Penalty steps move with it: ${eur(terms.penalty_low_eur)} below ${formatKm(
                  target,
                )} km, ${eur(terms.penalty_medium_eur)} below ${formatKm(
                  (target * 2) / 3,
                )} km, ${eur(terms.penalty_high_eur)} below ${formatKm(
                  target / 3,
                )} km. Your opponent gets a notification.`
              : "Penalty bands scale with the new target. Your opponent gets a notification."}
          </p>
          <button
            type="button"
            disabled={busy !== null}
            onClick={() => void mutate(target)}
            className="h-[54px] w-full rounded-[16px] bg-primary text-base font-semibold text-primary-foreground disabled:opacity-60"
          >
            {busy === "save" ? <PendingLabel>Saving…</PendingLabel> : `Save week ${selected}`}
          </button>
          {selectedHasOverride ? (
            <button
              type="button"
              disabled={busy !== null}
              onClick={() => void mutate(null)}
              className="h-12 w-full rounded-[14px] bg-elevated text-[15px] font-semibold disabled:opacity-60"
            >
              {busy === "reset" ? <PendingLabel>Resetting…</PendingLabel> : "Use the base target"}
            </button>
          ) : null}
          {message ? (
            <p role="status" className="text-[13px] text-good">
              {message}
            </p>
          ) : null}
          {error ? (
            <p role="alert" className="text-[13px] text-danger">
              {error}
            </p>
          ) : null}
        </>
      ) : null}

      {!canEdit ? (
        <Note>
          {bounds
            ? "Only the challenge creator can change a week’s target. These upcoming targets are read-only for you."
            : "Only the challenge creator can change a week’s target."}
        </Note>
      ) : null}
    </div>
  );
}

function formatKm(value: number) {
  return new Intl.NumberFormat("en", { maximumFractionDigits: 1 }).format(value);
}
