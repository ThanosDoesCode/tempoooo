import { createFileRoute, useNavigate, useParams } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { AppShell, PageHeader } from "@/components/AppShell";
import { ChallengeTermsSummary } from "@/components/challenge-rules";
import { Card, Note, PendingLabel, SectionTitle } from "@/components/ui-kit";
import {
  acceptChallengeInvitation,
  previewChallengeInvitation,
} from "@/lib/privileged-rpcs.functions";
import type { ChallengeInvitationTerms } from "@/lib/privileged-rpcs.server";
import { countryListLabel } from "@/lib/countries";

export const Route = createFileRoute("/_authenticated/invite/challenge/$token")({
  head: () => ({
    meta: [
      { title: "Tempo" },
      {
        name: "description",
        content:
          "Accept an invitation to a private two-person 52-week running and cycling challenge.",
      },
      { property: "og:title", content: "Tempo" },
      {
        property: "og:description",
        content: "Review the weekly target and penalty consequences before joining Tempo.",
      },
    ],
  }),
  component: AcceptChallenge,
});

function AcceptChallenge() {
  const { token } = useParams({ from: "/_authenticated/invite/challenge/$token" });
  const navigate = useNavigate();
  const [error, setError] = useState<string | null>(null);
  const [retryKey, setRetryKey] = useState(0);
  const [terms, setTerms] = useState<ChallengeInvitationTerms | null>(null);
  const [accepting, setAccepting] = useState(false);

  useEffect(() => {
    setError(null);
    setTerms(null);
    void (async () => {
      try {
        setTerms(await previewChallengeInvitation({ data: { token } }));
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : "Could not load invitation");
      }
    })();
  }, [token, navigate, retryKey]);

  const accept = async () => {
    if (!terms || accepting) return;
    setAccepting(true);
    setError(null);
    try {
      await acceptChallengeInvitation({ data: { token } });
      void navigate({ to: "/challenge" });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not accept this invitation");
      setAccepting(false);
    }
  };

  return (
    <AppShell>
      <PageHeader
        title="Invitation"
        subtitle={
          terms ? "Review the Challenge terms before accepting." : "Checking your invitation."
        }
        backTo="/challenge"
        backLabel="Challenge"
      />
      <Card>
        {terms ? (
          <div>
            <SectionTitle>{terms.challenge_name}</SectionTitle>
            <p className="mb-3 text-xs text-muted-foreground">
              {terms.duration_weeks} weeks · {Number(terms.weekly_target_km)} challenge km each week
            </p>
            <ChallengeTermsSummary terms={terms} />
            <div className="mt-3 rounded-xl border border-border bg-elevated p-3 text-xs">
              <p className="font-semibold">Travel pause terms</p>
              <p className="mt-1 text-muted-foreground">
                {terms.travel_pause_enabled
                  ? `Participants may pause their own full week while travelling outside ${countryListLabel(terms.travel_pause_home_countries, "disjunction")}. A paused week has a 0 km target and no penalty.`
                  : "Travel pauses are not allowed for this Challenge."}
              </p>
            </div>
            <Note>
              The weekly target, penalty terms, and travel-pause rules cannot change after
              acceptance.
            </Note>
            {error ? (
              <p role="alert" className="mt-3 text-xs text-danger">
                {error}
              </p>
            ) : null}
            <button
              type="button"
              disabled={accepting}
              onClick={() => void accept()}
              className="mt-3 min-h-11 w-full rounded-xl bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground disabled:opacity-60"
            >
              {accepting ? <PendingLabel>Accepting invitation…</PendingLabel> : "Accept challenge"}
            </button>
          </div>
        ) : error ? (
          <div role="alert">
            <p className="text-sm font-semibold text-danger">Could not load this invitation</p>
            <p className="mt-1 text-xs text-muted-foreground">{error}</p>
            <button
              type="button"
              onClick={() => setRetryKey((key) => key + 1)}
              className="mt-3 min-h-11 rounded-xl border border-danger/40 px-4 py-2 text-sm font-semibold text-danger"
            >
              Try again
            </button>
          </div>
        ) : (
          <Note>
            <PendingLabel>Loading invitation terms…</PendingLabel>
          </Note>
        )}
      </Card>
    </AppShell>
  );
}
