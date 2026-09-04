import { createFileRoute } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Download, Plane } from "lucide-react";
import { AppShell, PageHeader } from "@/components/AppShell";
import { RulesCard } from "@/components/challenge-rules";
import { Card, DataError, Note, PendingLabel, SectionTitle } from "@/components/ui-kit";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import {
  formatPace,
  owedText,
  removeTravelPause,
  reopenPayment,
  setTravelPause,
  settleMyDebts,
  summarizeActivities,
  todayIn,
  useActivities,
  usePayments,
  useChallengeMembers,
  useMyChallenge,
  useTravelPauses,
  useWeeks,
  weekBounds,
  weekNumberOf,
} from "@/lib/challenge";
import { downloadChallengeCsv } from "@/lib/challenge-export";
import { COUNTRIES, countryListLabel, countryName } from "@/lib/countries";
import { userFacingError } from "@/lib/network-errors";

export const Route = createFileRoute("/_authenticated/challenge/payments")({
  head: () => ({
    meta: [
      { title: "Tempo" },
      {
        name: "description",
        content: "Challenge penalties, settlements, finalized consequences and travel pauses.",
      },
      { property: "og:title", content: "Tempo" },
      { property: "og:description", content: "Owe, pay, confirm. Nothing is deleted." },
    ],
  }),
  component: Payments,
});

function Payments() {
  const { user } = useAuth();
  const qc = useQueryClient();
  const challengeQuery = useMyChallenge();
  const { data: challenge, isLoading: challengeLoading, error: challengeError } = challengeQuery;
  const membersQuery = useChallengeMembers(challenge?.id);
  const { data: members, isLoading: membersLoading, error: membersError } = membersQuery;
  const paymentsQuery = usePayments(challenge?.id);
  const { data: payments, isLoading: paymentsLoading, error: paymentsError } = paymentsQuery;
  const weeksQuery = useWeeks(challenge?.id);
  const { data: weeks, isLoading: weeksLoading, error: weeksError } = weeksQuery;
  const activitiesQuery = useActivities(challenge?.id);
  const {
    data: activities,
    isLoading: activitiesLoading,
    error: activitiesError,
  } = activitiesQuery;
  const pausesQuery = useTravelPauses(challenge?.id);
  const { data: travelPauses, isLoading: pausesLoading, error: pausesError } = pausesQuery;
  const [pending, setPending] = useState<{
    id: string;
    action: "mark" | "undo" | "confirm" | "settle" | "reopen";
  } | null>(null);
  const [settleArmed, setSettleArmed] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [showSettled, setShowSettled] = useState(false);
  const [pauseWeek, setPauseWeek] = useState("");
  const [pauseCountry, setPauseCountry] = useState("");
  const [travelPending, setTravelPending] = useState<string | null>(null);
  const [travelError, setTravelError] = useState<string | null>(null);
  const [travelNotice, setTravelNotice] = useState<string | null>(null);
  const [pauseRemoveArmed, setPauseRemoveArmed] = useState<string | null>(null);

  const rows = payments ?? [];
  const open = rows.filter((p) => p.status !== "confirmed_paid");
  const settled = rows.filter((p) => p.status === "confirmed_paid");
  const iOwe = open
    .filter((p) => p.payer_id === user?.id)
    .reduce((s, p) => s + Number(p.amount_eur), 0);
  const owedToMe = open
    .filter((p) => p.recipient_id === user?.id)
    .reduce((s, p) => s + Number(p.amount_eur), 0);

  const weekOf = (id: string) => weeks?.find((w) => w.id === id)?.week_number;
  const name = (id: string) =>
    id === user?.id ? "Me" : (members?.find((m) => m.userId === id)?.name ?? "Athlete");

  const currentWeek = challenge
    ? Math.max(1, weekNumberOf(challenge, todayIn(challenge.timezone)))
    : 1;
  const selectedPauseWeek = Number(pauseWeek || currentWeek);
  const comparison = (members ?? []).map((member) => ({
    ...member,
    stats: summarizeActivities(activities ?? [], member.userId),
  }));

  const refresh = () => qc.invalidateQueries({ queryKey: ["challenge-payments"] });

  const setStatus = async (id: string, status: "marked_paid" | "confirmed_paid" | "unpaid") => {
    const action =
      status === "marked_paid" ? "mark" : status === "confirmed_paid" ? "confirm" : "undo";
    setPending({ id, action });
    setError(null);
    setNotice(null);
    try {
      const { error: e } = await supabase
        .from("challenge_payments")
        .update({ status })
        .eq("id", id);
      if (e) throw e;
      await refresh();
      setNotice(
        status === "marked_paid"
          ? "Payment marked as paid."
          : status === "confirmed_paid"
            ? "Payment confirmed as received."
            : "Payment returned to unpaid.",
      );
    } catch (e) {
      setError(userFacingError(e, "update the payment"));
    } finally {
      setPending(null);
    }
  };

  const settleUp = async () => {
    if (!challenge || !user) return;
    setPending({ id: "settle", action: "settle" });
    setError(null);
    setNotice(null);
    try {
      await settleMyDebts(challenge.id, user.id);
      await refresh();
      setSettleArmed(false);
      setNotice("Your open payments are settled.");
    } catch (e) {
      setError(userFacingError(e, "settle your payments"));
    } finally {
      setPending(null);
    }
  };

  const reopen = async (id: string) => {
    setPending({ id, action: "reopen" });
    setError(null);
    setNotice(null);
    try {
      await reopenPayment(id);
      await refresh();
      setNotice("Payment reopened.");
    } catch (e) {
      setError(userFacingError(e, "reopen the payment"));
    } finally {
      setPending(null);
    }
  };

  const saveTravelPause = async () => {
    if (!challenge || !user) return;
    const country = pauseCountry.trim();
    if (!country) {
      setTravelError("Select the country you are travelling to.");
      return;
    }
    if (!challenge.travel_pause_enabled) {
      setTravelError("Travel pauses are disabled for this Challenge.");
      return;
    }
    if (challenge.travel_pause_home_countries.includes(country)) {
      setTravelError(
        `The Challenge remains active in ${countryListLabel(challenge.travel_pause_home_countries)}.`,
      );
      return;
    }
    setTravelPending("save");
    setTravelError(null);
    setTravelNotice(null);
    try {
      await setTravelPause(challenge.id, selectedPauseWeek, country);
      await qc.invalidateQueries({ queryKey: ["challenge-travel-pauses"] });
      setPauseCountry("");
      setTravelNotice(
        `Week ${selectedPauseWeek} is paused for your trip to ${countryName(country)}.`,
      );
    } catch (e) {
      setTravelError(userFacingError(e, "save the travel pause", { inputPreserved: true }));
    } finally {
      setTravelPending(null);
    }
  };

  const cancelTravelPause = async (id: string) => {
    setTravelPending(id);
    setTravelError(null);
    setTravelNotice(null);
    try {
      await removeTravelPause(id);
      await qc.invalidateQueries({ queryKey: ["challenge-travel-pauses"] });
      setPauseRemoveArmed(null);
      setTravelNotice("Travel pause removed. That week is active again.");
    } catch (e) {
      setTravelError(userFacingError(e, "remove the travel pause"));
    } finally {
      setTravelPending(null);
    }
  };

  const initialLoading =
    challengeLoading ||
    (!!challenge &&
      (membersLoading || paymentsLoading || weeksLoading || activitiesLoading || pausesLoading));
  const loadError =
    challengeError || membersError || paymentsError || weeksError || activitiesError || pausesError;

  if (initialLoading) {
    return (
      <AppShell>
        <PageHeader title="Money" subtitle="Loading penalties and travel settings…" />
        <div className="grid grid-cols-2 gap-3" aria-label="Loading money data">
          <div className="h-24 animate-pulse rounded-2xl bg-card" />
          <div className="h-24 animate-pulse rounded-2xl bg-card" />
        </div>
        <div className="mt-3 h-40 animate-pulse rounded-2xl bg-card" />
      </AppShell>
    );
  }

  if (loadError) {
    return (
      <AppShell>
        <PageHeader title="Money" subtitle="Penalties, payments, and travel pauses." />
        <DataError
          message="No payment or travel data was changed. Check your connection and try again."
          onRetry={() => {
            void Promise.all(
              challenge
                ? [
                    challengeQuery.refetch(),
                    membersQuery.refetch(),
                    paymentsQuery.refetch(),
                    weeksQuery.refetch(),
                    activitiesQuery.refetch(),
                    pausesQuery.refetch(),
                  ]
                : [challengeQuery.refetch()],
            );
          }}
        />
      </AppShell>
    );
  }

  if (!challenge) {
    return (
      <AppShell>
        <PageHeader title="Money" />
        <Note>Join or create a challenge before penalties and travel pauses can appear.</Note>
      </AppShell>
    );
  }

  const legacyPhotoOwed = challenge.legacy_photo_owed;
  const customConsequences = (weeks ?? []).filter(
    (week) => week.penalty_mode === "custom" && week.penalty_consequence,
  );

  return (
    <AppShell>
      <PageHeader
        title={challenge.penalty_mode === "money" ? "Money" : "Penalties"}
        subtitle={
          challenge.penalty_mode === "money"
            ? "Money penalties are created automatically when a week closes."
            : "Custom consequences are recorded automatically when a week closes."
        }
      />

      {challenge.penalty_mode === "money" ? (
        <div className="grid grid-cols-2 gap-3">
          <Card>
            <p className="text-[11px] uppercase tracking-wider text-muted-foreground">I owe</p>
            <p className="mt-1 text-xl font-semibold text-warn">
              {owedText(iOwe, legacyPhotoOwed)}
            </p>
            <p className="text-[11px] text-muted-foreground">Open penalties</p>
          </Card>
          <Card>
            <p className="text-[11px] uppercase tracking-wider text-muted-foreground">Owed to me</p>
            <p className="mt-1 text-xl font-semibold text-good">
              {owedText(owedToMe, legacyPhotoOwed)}
            </p>
            <p className="text-[11px] text-muted-foreground">Open penalties</p>
          </Card>
        </div>
      ) : (
        <Card>
          <SectionTitle>Finalized custom consequences</SectionTitle>
          {customConsequences.length ? (
            <div className="space-y-2">
              {customConsequences.map((week) => (
                <div
                  key={week.id}
                  className="rounded-xl border border-border bg-elevated px-3 py-2 text-sm"
                >
                  <p className="font-medium">
                    Week {week.week_number} · {name(week.user_id)}
                  </p>
                  <p className="mt-0.5 text-xs text-warn">{week.penalty_consequence}</p>
                </div>
              ))}
            </div>
          ) : (
            <Note>No custom consequences have been recorded yet.</Note>
          )}
        </Card>
      )}

      {challenge.penalty_mode === "money" && iOwe > 0 ? (
        <Card className="mt-3">
          <SectionTitle>Settle up</SectionTitle>
          <p className="text-xs text-muted-foreground">
            Once you have actually sent {owedText(iOwe, legacyPhotoOwed)}, clear everything you owe
            in one step. Your total goes back to zero and the items move to the settled list.
          </p>
          <button
            disabled={pending !== null}
            onClick={() => {
              if (!settleArmed) {
                setSettleArmed(true);
                return;
              }
              void settleUp();
            }}
            className={`mt-3 w-full rounded-xl py-2.5 text-sm font-semibold disabled:opacity-60 ${
              settleArmed ? "bg-good text-background" : "bg-primary text-primary-foreground"
            }`}
          >
            {pending?.id === "settle" ? (
              <PendingLabel>Settling payments…</PendingLabel>
            ) : settleArmed ? (
              `Confirm, I have paid ${owedText(iOwe, legacyPhotoOwed)}`
            ) : (
              "I have paid, reset my total"
            )}
          </button>
        </Card>
      ) : null}

      {error ? (
        <p role="alert" className="mt-2 text-xs text-danger">
          {error}
        </p>
      ) : null}
      {notice ? (
        <p role="status" className="mt-2 text-xs text-good">
          {notice}
        </p>
      ) : null}

      {challenge.penalty_mode === "money" ? (
        <div className="mt-4 space-y-2">
          <SectionTitle>Open obligations</SectionTitle>
          {open.length === 0 ? (
            <Note>
              No penalties are outstanding. New obligations appear only after a finalized week ends
              below {Number(challenge.weekly_target_km)} challenge km.
            </Note>
          ) : null}
          {open.map((p) => {
            const mine = p.payer_id === user?.id;
            return (
              <Card key={p.id} className="p-3">
                <div className="flex items-baseline justify-between">
                  <p className="text-sm font-medium">
                    {name(p.payer_id)} → {name(p.recipient_id)}
                  </p>
                  <span className="text-sm font-semibold">
                    {owedText(Number(p.amount_eur), legacyPhotoOwed)}
                  </span>
                </div>
                <p className="mt-1 text-[11px] text-muted-foreground">
                  Week {weekOf(p.week_id) ?? "?"} ·{" "}
                  {p.status === "unpaid" ? "Unpaid" : "Marked paid, awaiting confirmation"}
                </p>
                <div className="mt-2 flex gap-2">
                  {mine && p.status === "unpaid" ? (
                    <button
                      disabled={pending !== null}
                      onClick={() => void setStatus(p.id, "marked_paid")}
                      className="flex-1 rounded-xl bg-primary py-2 text-xs font-semibold text-primary-foreground disabled:opacity-60"
                    >
                      {pending?.id === p.id && pending.action === "mark" ? (
                        <PendingLabel>Marking paid…</PendingLabel>
                      ) : (
                        "Mark as paid"
                      )}
                    </button>
                  ) : null}
                  {mine && p.status === "marked_paid" ? (
                    <button
                      disabled={pending !== null}
                      onClick={() => void setStatus(p.id, "unpaid")}
                      className="flex-1 rounded-xl border border-border py-2 text-xs font-medium disabled:opacity-60"
                    >
                      {pending?.id === p.id && pending.action === "undo" ? (
                        <PendingLabel>Undoing…</PendingLabel>
                      ) : (
                        "Undo"
                      )}
                    </button>
                  ) : null}
                  {!mine && p.status === "marked_paid" ? (
                    <button
                      disabled={pending !== null}
                      onClick={() => void setStatus(p.id, "confirmed_paid")}
                      className="flex-1 rounded-xl bg-good py-2 text-xs font-semibold text-background disabled:opacity-60"
                    >
                      {pending?.id === p.id && pending.action === "confirm" ? (
                        <PendingLabel>Confirming…</PendingLabel>
                      ) : (
                        "Confirm received"
                      )}
                    </button>
                  ) : null}
                </div>
              </Card>
            );
          })}
        </div>
      ) : null}

      {challenge.penalty_mode === "money" && settled.length ? (
        <div className="mt-4">
          <SectionTitle
            right={
              <button
                onClick={() => setShowSettled((s) => !s)}
                className="text-xs font-medium text-primary"
              >
                {showSettled ? "Hide" : `Show (${settled.length})`}
              </button>
            }
          >
            Settled
          </SectionTitle>
          {showSettled ? (
            <div className="space-y-2">
              {settled.map((p) => (
                <Card key={p.id} className="p-3">
                  <div className="flex items-baseline justify-between">
                    <p className="text-sm font-medium">
                      {name(p.payer_id)} → {name(p.recipient_id)}
                    </p>
                    <span className="num text-sm text-muted-foreground">
                      {owedText(Number(p.amount_eur), legacyPhotoOwed)}
                    </span>
                  </div>
                  <p className="mt-1 text-[11px] text-good">
                    Week {weekOf(p.week_id) ?? "?"} · Settled
                  </p>
                  {p.settled_by === user?.id ? (
                    <button
                      disabled={pending !== null}
                      onClick={() => void reopen(p.id)}
                      className="mt-2 w-full rounded-xl border border-border py-2 text-xs font-medium disabled:opacity-60"
                    >
                      {pending?.id === p.id && pending.action === "reopen" ? (
                        <PendingLabel>Reopening…</PendingLabel>
                      ) : (
                        "Reopen, this was a mistake"
                      )}
                    </button>
                  ) : null}
                </Card>
              ))}
            </div>
          ) : null}
        </div>
      ) : null}

      <section className="mt-5">
        <SectionTitle>52-week comparison</SectionTitle>
        <div className="grid grid-cols-2 gap-3">
          {comparison.map((player) => (
            <Card key={player.userId} className="p-3">
              <p className="truncate text-xs font-semibold">
                {player.userId === user?.id ? "Me" : player.name}
              </p>
              <p className="num mt-2 text-xl font-semibold">{player.stats.totalKm.toFixed(1)} km</p>
              <p className="text-[11px] text-muted-foreground">Total real distance</p>
              <div className="mt-2 border-t border-border pt-2 text-[11px] text-muted-foreground">
                <p>{player.stats.challengeKm.toFixed(1)} qualifying challenge km</p>
                <p>
                  {player.stats.averageSpeedKmh === null
                    ? "Average speed —"
                    : `Average speed ${player.stats.averageSpeedKmh.toFixed(1)} km/h`}
                </p>
                <p>Run pace {formatPace(player.stats.runningPaceSecondsPerKm)}</p>
                <p>
                  {player.stats.cyclingSpeedKmh === null
                    ? "Ride speed —"
                    : `Ride speed ${player.stats.cyclingSpeedKmh.toFixed(1)} km/h`}
                </p>
              </div>
            </Card>
          ))}
        </div>
        {challenge && members ? (
          <button
            type="button"
            disabled={activitiesLoading}
            onClick={() =>
              downloadChallengeCsv(
                challenge,
                members,
                activities ?? [],
                weeks ?? [],
                travelPauses ?? [],
              )
            }
            className="mt-3 inline-flex w-full items-center justify-center gap-2 rounded-xl border border-border py-2.5 text-sm font-medium disabled:opacity-60"
          >
            <Download className="h-4 w-4" aria-hidden="true" />
            {activitiesLoading ? "Preparing challenge data…" : "Download challenge data (CSV)"}
          </button>
        ) : null}
        <Note>
          The export includes both players, every activity, stored pace and speed, qualifying
          distance, finalized penalties, and travel pauses. Activity records remain stored after the
          52 weeks end.
        </Note>
      </section>

      {challenge && user && currentWeek <= challenge.duration_weeks ? (
        <section className="mt-5">
          <SectionTitle>Travel pause</SectionTitle>
          <Card className="space-y-3 p-3">
            <div className="flex items-start gap-2">
              <Plane className="mt-0.5 h-4 w-4 shrink-0 text-primary" aria-hidden="true" />
              <p className="text-xs text-muted-foreground">
                {challenge.travel_pause_enabled
                  ? `Travelling outside ${countryListLabel(challenge.travel_pause_home_countries, "disjunction")}? Pause your own entire challenge week for a 0 km target and no penalty. Your opponent remains active.`
                  : "Travel pauses are not allowed under this Challenge's agreed terms."}
              </p>
            </div>
            {challenge.travel_pause_enabled ? (
              <>
                <div className="grid grid-cols-2 gap-2">
                  <label className="min-w-0">
                    <span className="mb-1 block text-[11px] uppercase tracking-wider text-muted-foreground">
                      Challenge week
                    </span>
                    <select
                      value={pauseWeek || String(currentWeek)}
                      disabled={travelPending !== null}
                      onChange={(event) => setPauseWeek(event.target.value)}
                      className="block min-w-0 w-full max-w-full rounded-xl border border-border bg-elevated px-3 py-2.5 text-sm outline-none"
                    >
                      {Array.from(
                        { length: challenge.duration_weeks - Math.max(1, currentWeek) + 1 },
                        (_, index) => Math.max(1, currentWeek) + index,
                      ).map((weekNumber) => {
                        const bounds = weekBounds(challenge, weekNumber);
                        return (
                          <option key={weekNumber} value={weekNumber}>
                            Week {weekNumber} · {bounds.start}
                          </option>
                        );
                      })}
                    </select>
                  </label>
                  <label className="min-w-0">
                    <span className="mb-1 block text-[11px] uppercase tracking-wider text-muted-foreground">
                      Country
                    </span>
                    <select
                      value={pauseCountry}
                      disabled={travelPending !== null}
                      onChange={(event) => setPauseCountry(event.target.value)}
                      className="block min-w-0 w-full max-w-full rounded-xl border border-border bg-elevated px-3 py-2.5 text-sm outline-none"
                    >
                      <option value="">Select…</option>
                      {COUNTRIES.filter(
                        (country) => !challenge.travel_pause_home_countries.includes(country.code),
                      ).map((country) => (
                        <option key={country.code} value={country.code}>
                          {country.name}
                        </option>
                      ))}
                    </select>
                  </label>
                </div>
                <button
                  type="button"
                  disabled={travelPending !== null || !pauseCountry}
                  onClick={() => void saveTravelPause()}
                  className="w-full rounded-xl bg-primary py-2.5 text-sm font-semibold text-primary-foreground disabled:opacity-60"
                >
                  {travelPending === "save" ? (
                    <PendingLabel>Pausing your week…</PendingLabel>
                  ) : (
                    "Pause my week"
                  )}
                </button>
              </>
            ) : null}
            {travelError ? (
              <p role="alert" className="text-xs text-danger">
                {travelError}
              </p>
            ) : null}
            {travelNotice ? (
              <p role="status" className="text-xs text-good">
                {travelNotice}
              </p>
            ) : null}
          </Card>

          {(travelPauses?.length ?? 0) > 0 ? (
            <div className="mt-2 space-y-2">
              {travelPauses?.map((pause) => (
                <Card key={pause.id} className="flex items-center gap-3 p-3">
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">
                      {name(pause.user_id)} · Week {pause.week_number}
                    </p>
                    <p className="text-[11px] text-muted-foreground">
                      {countryName(pause.country)} · penalty-free
                    </p>
                  </div>
                  {pause.user_id === user.id && pause.week_number >= currentWeek ? (
                    <div className="flex items-center gap-1">
                      {pauseRemoveArmed === pause.id ? (
                        <button
                          type="button"
                          disabled={travelPending !== null}
                          onClick={() => setPauseRemoveArmed(null)}
                          className="min-h-11 rounded-lg px-2.5 py-2 text-xs font-medium text-muted-foreground"
                        >
                          Cancel
                        </button>
                      ) : null}
                      <button
                        type="button"
                        disabled={travelPending !== null}
                        onClick={() => {
                          if (pauseRemoveArmed !== pause.id) {
                            setPauseRemoveArmed(pause.id);
                            return;
                          }
                          void cancelTravelPause(pause.id);
                        }}
                        className={`min-h-11 rounded-lg px-3 py-2 text-xs font-semibold disabled:opacity-60 ${
                          pauseRemoveArmed === pause.id
                            ? "bg-danger text-primary-foreground"
                            : "border border-border"
                        }`}
                      >
                        {travelPending === pause.id ? (
                          <PendingLabel>Removing…</PendingLabel>
                        ) : pauseRemoveArmed === pause.id ? (
                          "Confirm removal"
                        ) : (
                          "Remove pause"
                        )}
                      </button>
                    </div>
                  ) : null}
                </Card>
              ))}
            </div>
          ) : (
            <Note>
              {challenge.travel_pause_enabled
                ? `No travel pauses are scheduled. Keep participating normally unless you travel outside ${countryListLabel(challenge.travel_pause_home_countries, "disjunction")} and choose to pause your full week.`
                : "Travel pauses are disabled for this Challenge."}
            </Note>
          )}
        </section>
      ) : null}

      <section className="mt-5">
        <RulesCard terms={challenge} />
      </section>

      <Note>
        Only the payer can mark or settle a payment, only the recipient can confirm one they
        received, and a settle can be reopened only by the person who did it.
      </Note>
    </AppShell>
  );
}
