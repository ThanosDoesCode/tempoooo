import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { LogOut, Mail, Plus } from "lucide-react";
import { AppShell, PageHeader } from "@/components/AppShell";
import { Card, Note, SectionTitle } from "@/components/ui-kit";
import { useAuth, signOut } from "@/lib/auth";
import { createBulkProfile, useMemberships } from "@/lib/bulk-access";

export const Route = createFileRoute("/_authenticated/profile")({
  head: () => ({
    meta: [
      { title: "Profile — Lean Bulk Tracker" },
      {
        name: "description",
        content: "See the account you are signed in with and create or open your lean bulk plan.",
      },
      { property: "og:title", content: "Profile — Lean Bulk Tracker" },
      {
        property: "og:description",
        content: "Manage your account and your lean bulk plan access.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: ProfilePage,
});

function ProfilePage() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const { data: memberships, isLoading, refetch } = useMemberships();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const hasBulk = (memberships?.length ?? 0) > 0;

  const create = async () => {
    setBusy(true);
    setError(null);
    try {
      await createBulkProfile();
      await refetch();
      void navigate({ to: "/bulk" });
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <AppShell>
      <PageHeader title="Profile" subtitle="Your account and plan access" />

      <Card>
        <SectionTitle>Signed in as</SectionTitle>
        <div className="flex items-center gap-2 text-sm">
          <Mail className="h-4 w-4 text-muted-foreground" />
          <span className="font-medium">{user?.email ?? "…"}</span>
        </div>
      </Card>

      <Card className="mt-3">
        <SectionTitle>Bulk plan</SectionTitle>
        {isLoading ? (
          <div className="h-9 animate-pulse rounded-xl bg-elevated" />
        ) : hasBulk ? (
          <button
            onClick={() => void navigate({ to: "/bulk" })}
            className="w-full rounded-xl bg-primary py-3 text-sm font-semibold text-primary-foreground"
          >
            Open my bulk plan
          </button>
        ) : (
          <div className="space-y-2">
            <Note>
              This account has no bulk plan yet. Create one to unlock Today, Training, Progress and
              Check-In.
            </Note>
            <button
              onClick={() => void create()}
              disabled={busy}
              className="flex w-full items-center justify-center gap-2 rounded-xl bg-primary py-3 text-sm font-semibold text-primary-foreground disabled:opacity-60"
            >
              <Plus className="h-4 w-4" />
              {busy ? "Creating…" : "Create my bulk plan"}
            </button>
          </div>
        )}
        {error ? <p className="mt-2 text-xs text-danger">{error}</p> : null}
      </Card>

      <Card className="mt-3">
        <SectionTitle>Session</SectionTitle>
        <button
          onClick={() => void signOut()}
          className="flex w-full items-center justify-center gap-2 rounded-xl border border-border py-3 text-sm font-medium text-muted-foreground"
        >
          <LogOut className="h-4 w-4" /> Sign out
        </button>
      </Card>
    </AppShell>
  );
}
