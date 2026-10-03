import { createFileRoute, Link } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { AppShell, PageHeader } from "@/components/AppShell";
import { Card, DataError, Note, PendingLabel } from "@/components/ui-kit";
import { useAuth } from "@/lib/auth";
import { userFacingError } from "@/lib/network-errors";
import { countryListLabel } from "@/lib/countries";
import {
  challengeTerms,
  eur,
  leaveChallenge,
  owedText,
  penaltyBands,
  useChallengeMembers,
  useMyChallenge,
  type Challenge,
} from "@/lib/challenge";

export const Route = createFileRoute("/_authenticated/challenge/terms")({
  head: () => ({
    meta: [
      { title: "Tempo" },
      {
        name: "description",
        content:
          "The agreed rules of your challenge: weekly target, what counts, penalties and travel pause.",
      },
    ],
  }),
  component: Terms,
});

function Terms() {
  const { user } = useAuth();
  const challengeQuery = useMyChallenge();
  const { data: challenge, isLoading, error } = challengeQuery;
  const membersQuery = useChallengeMembers(challenge?.id);
  const opponent = membersQuery.data?.find((member) => member.userId !== user?.id);

  return (
    <AppShell>
      <PageHeader
        title="Terms"
        subtitle={
          opponent
            ? `Agreed by you and ${opponent.name}. They don’t change mid-challenge.`
            : "Agreed when the challenge started. They don’t change mid-challenge."
        }
        backTo="/challenge"
        backLabel="This week"
      />
      {isLoading ? (
        <div className="h-64 animate-pulse rounded-[20px] bg-card" aria-label="Loading terms" />
      ) : error ? (
        <DataError
          message="Your terms are unchanged. Check your connection and try again."
          onRetry={() => void challengeQuery.refetch()}
        />
      ) : !challenge ? (
        <Note>Join or create a challenge to see its agreed rules.</Note>
      ) : (
        <TermsContent challenge={challenge} />
      )}
    </AppShell>
  );
}

function TermsContent({ challenge }: { challenge: Challenge }) {
  const qc = useQueryClient();
  const terms = challengeTerms(challenge);
  const bands = penaltyBands(challenge);
  const money = terms.penalty_mode === "money";
  const [leaveArmed, setLeaveArmed] = useState(false);
  const [leaving, setLeaving] = useState(false);
  const [leaveError, setLeaveError] = useState<string | null>(null);

  const consequence = (band: "high" | "medium" | "low") => {
    if (money) {
      const amount = {
        high: terms.penalty_high_eur,
        medium: terms.penalty_medium_eur,
        low: terms.penalty_low_eur,
      }[band];
      return owedText(amount, terms.legacy_photo_owed);
    }
    return (
      {
        high: terms.penalty_high_custom,
        medium: terms.penalty_medium_custom,
        low: terms.penalty_low_custom,
      }[band] ?? "Custom consequence"
    );
  };

  const doLeave = async () => {
    setLeaving(true);
    setLeaveError(null);
    try {
      await leaveChallenge(challenge.id);
      await qc.invalidateQueries({
        predicate: (query) => String(query.queryKey[0]).startsWith("challenge"),
      });
    } catch (e) {
      setLeaveError(userFacingError(e, "leave the challenge"));
      setLeaving(false);
    }
  };

  return (
    <div className="space-y-3.5">
      <Card className="space-y-2.5 p-[18px]">
        <h2 className="text-[13px] font-medium text-muted-foreground">Every week</h2>
        <p className="num text-[28px] font-semibold leading-none">{formatKm(bands.target)} km</p>
        <p className="text-sm text-muted-foreground">
          Monday to Sunday, {challenge.timezone} time. Extra km don’t carry over.
        </p>
        <Link to="/challenge/terms/override" className="text-sm font-medium text-primary">
          Change one week’s target
        </Link>
      </Card>

      <Card className="space-y-2.5 p-[18px]">
        <h2 className="text-[13px] font-medium text-muted-foreground">What counts</h2>
        <TermLine label="Run" value="1 km = 1 km, under 7:00 /km" />
        <TermLine label="Ride" value="3 km = 1 km, over 18 km/h" />
        <TermLine label="Proof" value="A screenshot for each one" />
      </Card>

      <Card className="space-y-2.5 p-[18px]">
        <h2 className="text-[13px] font-medium text-muted-foreground">If you fall short</h2>
        <TermLine
          label={`${formatKm(bands.target)} km or more`}
          value={money ? eur(0) : "No penalty"}
          strong
        />
        <TermLine
          label={`${formatKm(bands.mediumBelow)} to ${formatKm(bands.target)} km`}
          value={consequence("low")}
          strong
        />
        <TermLine
          label={`${formatKm(bands.highBelow)} to ${formatKm(bands.mediumBelow)} km`}
          value={consequence("medium")}
          strong
        />
        <TermLine
          label={`Under ${formatKm(bands.highBelow)} km`}
          value={consequence("high")}
          strong
          warn
        />
      </Card>

      <Card className="space-y-3 p-[18px]">
        <h2 className="text-[13px] font-medium text-muted-foreground">Travelling?</h2>
        {terms.travel_pause_enabled ? (
          <>
            <p className="text-[15px] leading-relaxed">
              Outside {countryListLabel(terms.travel_pause_home_countries, "disjunction")} you can
              pause a full week. No target, no penalty. Your opponent keeps going.
            </p>
            <Link
              to="/challenge/terms/pause"
              className="flex h-12 items-center justify-center rounded-[14px] bg-elevated text-[15px] font-semibold"
            >
              Pause a week
            </Link>
          </>
        ) : (
          <p className="text-[15px] leading-relaxed text-muted-foreground">
            Travel pauses are not allowed under this challenge’s agreed terms.
          </p>
        )}
      </Card>

      <details className="group rounded-[20px] bg-card">
        <summary className="flex min-h-[52px] cursor-pointer list-none items-center px-[18px] text-[13px] font-medium text-muted-foreground [&::-webkit-details-marker]:hidden">
          Leave this challenge
          <span className="ml-auto text-muted-foreground transition-transform group-open:rotate-90">
            ›
          </span>
        </summary>
        <div className="border-t border-border px-[18px] py-3.5">
          <p className="text-[13px] leading-relaxed text-muted-foreground">
            Leaving removes you from {challenge.name}. Your logged activities stay in the record.
          </p>
          <button
            type="button"
            disabled={leaving}
            onClick={() => {
              if (!leaveArmed) {
                setLeaveArmed(true);
                return;
              }
              void doLeave();
            }}
            className={`mt-3 h-12 w-full rounded-[14px] text-[15px] font-semibold disabled:opacity-60 ${
              leaveArmed ? "bg-danger text-white" : "bg-elevated text-danger"
            }`}
          >
            {leaving ? (
              <PendingLabel>Leaving…</PendingLabel>
            ) : leaveArmed ? (
              "Confirm and leave"
            ) : (
              "Leave this challenge"
            )}
          </button>
          {leaveArmed && !leaving ? (
            <button
              type="button"
              onClick={() => setLeaveArmed(false)}
              className="mt-2 h-11 w-full rounded-[14px] text-[13px] font-medium text-muted-foreground"
            >
              Cancel
            </button>
          ) : null}
          {leaveError ? (
            <p role="alert" className="mt-2 text-[13px] text-danger">
              {leaveError}
            </p>
          ) : null}
        </div>
      </details>
    </div>
  );
}

function TermLine({
  label,
  value,
  strong,
  warn,
}: {
  label: string;
  value: string;
  strong?: boolean;
  warn?: boolean;
}) {
  return (
    <div className="flex min-h-[30px] items-center justify-between gap-3 text-[15px]">
      <span>{label}</span>
      <span
        className={`${strong ? "num text-right font-semibold" : "text-right text-muted-foreground"} ${
          warn ? "text-warn" : ""
        }`}
      >
        {value}
      </span>
    </div>
  );
}

function formatKm(value: number) {
  return new Intl.NumberFormat("en", { maximumFractionDigits: 1 }).format(value);
}
