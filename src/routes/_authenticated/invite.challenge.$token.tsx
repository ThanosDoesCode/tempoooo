import { createFileRoute, useNavigate, useParams } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { AppShell, PageHeader } from "@/components/AppShell";
import { Card, Note } from "@/components/ui-kit";
import { supabase } from "@/integrations/supabase/client";

export const Route = createFileRoute("/_authenticated/invite/challenge/$token")({
  head: () => ({
    meta: [
      { title: "Challenge invitation — Lean Bulk Tracker" },
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

  useEffect(() => {
    void (async () => {
      const { error } = await supabase.rpc("accept_challenge_invitation", { _token: token });
      if (error) setError(error.message);
      else void navigate({ to: "/challenge" });
    })();
  }, [token, navigate]);

  return (
    <AppShell>
      <PageHeader title="Invitation" subtitle="Checking your invitation." />
      <Card>{error ? <p className="text-sm text-danger">{error}</p> : <Note>Accepting…</Note>}</Card>
    </AppShell>
  );
}
