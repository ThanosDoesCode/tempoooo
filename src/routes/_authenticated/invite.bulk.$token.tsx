import { createFileRoute, useNavigate, useParams } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { AppShell, PageHeader } from "@/components/AppShell";
import { Card, Note } from "@/components/ui-kit";
import { acceptBulkInvitation } from "@/lib/privileged-rpcs.functions";

export const Route = createFileRoute("/_authenticated/invite/bulk/$token")({
  head: () => ({
    meta: [
      { title: "Bulk invitation — Lean Bulk Tracker" },
      {
        name: "description",
        content: "Accept a private invitation to view or help log a shared lean bulk tracker.",
      },
      { property: "og:title", content: "Bulk invitation" },
      { property: "og:description", content: "Invite-only access to a shared bulk tracker." },
    ],
  }),
  component: AcceptBulk,
});

function AcceptBulk() {
  const { token } = useParams({ from: "/_authenticated/invite/bulk/$token" });
  const navigate = useNavigate();
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void (async () => {
      try {
        await acceptBulkInvitation({ data: { token } });
        void navigate({ to: "/bulk" });
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : "Could not accept invitation");
      }
    })();
  }, [token, navigate]);

  return (
    <AppShell>
      <PageHeader title="Invitation" subtitle="Checking your invitation." />
      <Card>
        {error ? <p className="text-sm text-danger">{error}</p> : <Note>Accepting…</Note>}
      </Card>
    </AppShell>
  );
}
