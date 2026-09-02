import { createFileRoute, useNavigate, useParams } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { AppShell, PageHeader } from "@/components/AppShell";
import { Card, Note, PendingLabel } from "@/components/ui-kit";
import { acceptChallengeInvitation } from "@/lib/privileged-rpcs.functions";

export const Route = createFileRoute("/_authenticated/invite/challenge/$token")({
  head: () => ({
    meta: [
      { title: "Challenge invitation — Tempo" },
      {
        name: "description",
        content:
          "Accept an invitation to a private two-person 52-week running and cycling challenge.",
      },
      { property: "og:title", content: "Challenge invitation" },
      { property: "og:description", content: "15 equivalent km per week, for 52 weeks." },
    ],
  }),
  component: AcceptChallenge,
});

function AcceptChallenge() {
  const { token } = useParams({ from: "/_authenticated/invite/challenge/$token" });
  const navigate = useNavigate();
  const [error, setError] = useState<string | null>(null);
  const [retryKey, setRetryKey] = useState(0);

  useEffect(() => {
    setError(null);
    void (async () => {
      try {
        await acceptChallengeInvitation({ data: { token } });
        void navigate({ to: "/challenge" });
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : "Could not accept invitation");
      }
    })();
  }, [token, navigate, retryKey]);

  return (
    <AppShell>
      <PageHeader title="Invitation" subtitle="Checking your invitation." />
      <Card>
        {error ? (
          <div role="alert">
            <p className="text-sm font-semibold text-danger">Could not accept this invitation</p>
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
            <PendingLabel>Accepting invitation…</PendingLabel>
          </Note>
        )}
      </Card>
    </AppShell>
  );
}
