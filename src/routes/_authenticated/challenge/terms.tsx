import { ChevronDown } from "lucide-react";
import { createFileRoute } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { AppShell, PageHeader } from "@/components/AppShell";
import { DataError, Note, PendingLabel } from "@/components/ui-kit";
import { TermsCards } from "@/components/challenge-terms-view";
import { useAuth } from "@/lib/auth";
import { userFacingError } from "@/lib/network-errors";
import {
  leaveChallenge,
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
  const [leaveArmed, setLeaveArmed] = useState(false);
  const [leaving, setLeaving] = useState(false);
  const [leaveError, setLeaveError] = useState<string | null>(null);

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
      <TermsCards terms={challenge} timezone={challenge.timezone} manage />

      <details className="group rounded-[20px] bg-card">
        <summary className="disclosure-summary min-h-[52px] px-[18px] text-[13px] font-medium text-muted-foreground">
          Leave this challenge
          <ChevronDown className="disclosure-chevron text-muted-foreground" aria-hidden="true" />
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
