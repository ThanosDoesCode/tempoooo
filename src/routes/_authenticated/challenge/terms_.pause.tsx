import { createFileRoute } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { format, parseISO } from "date-fns";
import { AppShell, PageHeader } from "@/components/AppShell";
import { Card, DataError, Note, PendingLabel } from "@/components/ui-kit";
import { useAuth } from "@/lib/auth";
import { userFacingError } from "@/lib/network-errors";
import { COUNTRIES, countryListLabel, countryName } from "@/lib/countries";
import {
  removeTravelPause,
  setTravelPause,
  todayIn,
  useChallengeMembers,
  useMyChallenge,
  useTravelPauses,
  weekBounds,
  weekNumberOf,
  type Challenge,
} from "@/lib/challenge";

export const Route = createFileRoute("/_authenticated/challenge/terms_/pause")({
  head: () => ({ meta: [{ title: "Tempo" }] }),
  component: PauseWeek,
});

function PauseWeek() {
  const challengeQuery = useMyChallenge();
  const { data: challenge, isLoading, error } = challengeQuery;
  const pausesQuery = useTravelPauses(challenge?.id);

  return (
    <AppShell>
      <PageHeader
        title="Pause a week"
        subtitle={
          challenge?.travel_pause_enabled
            ? `When you’re travelling outside ${countryListLabel(challenge.travel_pause_home_countries, "disjunction")}.`
            : "Travelling resets a week to no target and no penalty."
        }
        backTo="/challenge/terms"
        backLabel="Terms"
      />
      {isLoading || (challenge && pausesQuery.isLoading) ? (
        <div className="h-64 animate-pulse rounded-[20px] bg-card" aria-label="Loading weeks" />
      ) : error || pausesQuery.error ? (
        <DataError
          message="Travel pauses could not be loaded. Nothing was changed."
          onRetry={() => void Promise.all([challengeQuery.refetch(), pausesQuery.refetch()])}
        />
      ) : !challenge ? (
        <Note>You are not part of a challenge yet.</Note>
      ) : !challenge.travel_pause_enabled ? (
        <Note>Travel pauses are not allowed under this challenge’s agreed terms.</Note>
      ) : (
        <PauseEditor challenge={challenge} pauses={pausesQuery.data ?? []} />
      )}
    </AppShell>
  );
}

function PauseEditor({
  challenge,
  pauses,
}: {
  challenge: Challenge;
  pauses: NonNullable<ReturnType<typeof useTravelPauses>["data"]>;
}) {
  const { user } = useAuth();
  const qc = useQueryClient();
  const membersQuery = useChallengeMembers(challenge.id);
  const currentWeek = Math.max(1, weekNumberOf(challenge, todayIn(challenge.timezone)));
  const eligibleWeeks = Array.from(
    { length: Math.max(0, challenge.duration_weeks - currentWeek + 1) },
    (_, index) => currentWeek + index,
  );

  const [week, setWeek] = useState<number>(eligibleWeeks[0] ?? currentWeek);
  const [country, setCountry] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [removeArmed, setRemoveArmed] = useState<string | null>(null);
  const [removing, setRemoving] = useState<string | null>(null);

  const name = (id: string) =>
    id === user?.id ? "You" : (membersQuery.data?.find((m) => m.userId === id)?.name ?? "Athlete");

  const save = async () => {
    const code = country.trim();
    if (!code) {
      setError("Select the country you are travelling to.");
      return;
    }
    if (challenge.travel_pause_home_countries.includes(code)) {
      setError(
        `The challenge stays active in ${countryListLabel(challenge.travel_pause_home_countries)}.`,
      );
      return;
    }
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      await setTravelPause(challenge.id, week, code);
      await qc.invalidateQueries({ queryKey: ["challenge-travel-pauses"] });
      setCountry("");
      setNotice(`Week ${week} is paused for your trip to ${countryName(code)}.`);
    } catch (e) {
      setError(userFacingError(e, "save the travel pause", { inputPreserved: true }));
    } finally {
      setBusy(false);
    }
  };

  const undo = async (id: string) => {
    setRemoving(id);
    setError(null);
    setNotice(null);
    try {
      await removeTravelPause(id);
      await qc.invalidateQueries({ queryKey: ["challenge-travel-pauses"] });
      setRemoveArmed(null);
      setNotice("Travel pause removed. That week is active again.");
    } catch (e) {
      setError(userFacingError(e, "remove the travel pause"));
    } finally {
      setRemoving(null);
    }
  };

  const bounds = weekBounds(challenge, week);

  return (
    <div className="space-y-3.5">
      {eligibleWeeks.length ? (
        <>
          <p className="px-1 text-[13px] text-muted-foreground">Which week?</p>
          <div className="rounded-[20px] bg-card px-4" role="radiogroup" aria-label="Week">
            {eligibleWeeks.slice(0, 8).map((n) => {
              const wb = weekBounds(challenge, n);
              const on = week === n;
              return (
                <button
                  key={n}
                  type="button"
                  role="radio"
                  aria-checked={on}
                  onClick={() => setWeek(n)}
                  className="flex min-h-[54px] w-full items-center gap-3 border-t border-border text-left text-[15px] first:border-t-0"
                >
                  <span
                    className={`h-5 w-5 flex-none rounded-full ${
                      on ? "border-[6px] border-primary" : "border-2 border-[oklch(38%_.01_260)]"
                    }`}
                  />
                  <span>
                    Week {n} · {format(parseISO(wb.start), "d MMM")}–
                    {format(parseISO(wb.end), "d MMM")}
                  </span>
                </button>
              );
            })}
          </div>

          <p className="px-1 text-[13px] text-muted-foreground">Where are you going?</p>
          <select
            aria-label="Country"
            value={country}
            disabled={busy}
            onChange={(e) => setCountry(e.target.value)}
            className="h-[54px] w-full rounded-[14px] border border-input bg-card px-4 text-[15px] font-semibold outline-none"
          >
            <option value="">Select a country…</option>
            {COUNTRIES.filter((c) => !challenge.travel_pause_home_countries.includes(c.code)).map(
              (c) => (
                <option key={c.code} value={c.code}>
                  {c.name}
                </option>
              ),
            )}
          </select>

          <div className="rounded-[16px] bg-card px-4 py-3.5 text-sm leading-relaxed">
            Week {week} ({format(parseISO(bounds.start), "d MMM")}–
            {format(parseISO(bounds.end), "d MMM")}) becomes{" "}
            <b className="font-semibold">0 km, no penalty</b> for you. Your opponent keeps their
            normal target. You can undo it until the week starts.
          </div>

          <button
            type="button"
            disabled={busy || !country}
            onClick={() => void save()}
            className="h-[54px] w-full rounded-[16px] bg-primary text-base font-semibold text-primary-foreground disabled:opacity-60"
          >
            {busy ? <PendingLabel>Pausing…</PendingLabel> : `Pause week ${week}`}
          </button>
        </>
      ) : (
        <Note>There are no upcoming weeks left to pause in this challenge.</Note>
      )}

      {error ? (
        <p role="alert" className="text-[13px] text-danger">
          {error}
        </p>
      ) : null}
      {notice ? (
        <p role="status" className="text-[13px] text-good">
          {notice}
        </p>
      ) : null}

      {pauses.length ? (
        <div className="space-y-2">
          <p className="px-1 text-[13px] text-muted-foreground">Paused weeks</p>
          {pauses.map((pause) => {
            const canUndo = pause.user_id === user?.id && pause.week_number >= currentWeek;
            return (
              <Card key={pause.id} className="flex items-center gap-3 p-4">
                <div className="min-w-0 flex-1">
                  <p className="text-[15px] font-medium">
                    {name(pause.user_id)} · Week {pause.week_number}
                  </p>
                  <p className="text-[13px] text-muted-foreground">
                    {countryName(pause.country)} · 0 km, no penalty
                  </p>
                </div>
                {canUndo ? (
                  <div className="flex items-center gap-1.5">
                    {removeArmed === pause.id ? (
                      <button
                        type="button"
                        disabled={removing !== null}
                        onClick={() => setRemoveArmed(null)}
                        className="min-h-11 rounded-lg px-2.5 text-[13px] font-medium text-muted-foreground"
                      >
                        Cancel
                      </button>
                    ) : null}
                    <button
                      type="button"
                      disabled={removing !== null}
                      onClick={() => {
                        if (removeArmed !== pause.id) {
                          setRemoveArmed(pause.id);
                          return;
                        }
                        void undo(pause.id);
                      }}
                      className={`min-h-11 rounded-lg px-3 text-[13px] font-semibold disabled:opacity-60 ${
                        removeArmed === pause.id ? "bg-danger text-white" : "bg-elevated"
                      }`}
                    >
                      {removing === pause.id ? (
                        <PendingLabel>Removing…</PendingLabel>
                      ) : removeArmed === pause.id ? (
                        "Confirm"
                      ) : (
                        "Undo"
                      )}
                    </button>
                  </div>
                ) : null}
              </Card>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}
