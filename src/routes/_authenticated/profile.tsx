import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { LogOut, Mail, RotateCcw } from "lucide-react";
import { AppShell, PageHeader } from "@/components/AppShell";
import { Card, Note, SectionTitle } from "@/components/ui-kit";
import { ChallengeInviteCard } from "@/components/ChallengeInvite";
import { useAuth, signOut } from "@/lib/auth";
import { useMemberships } from "@/lib/bulk-access";
import { useChallengeMembers, useMyChallenge } from "@/lib/challenge";
import { resetBulkData } from "@/lib/store";

export const Route = createFileRoute("/_authenticated/profile")({
  head: () => ({
    meta: [
      { title: "Tempo" },
      {
        name: "description",
        content: "See the account you are signed in with and create or open your lean bulk plan.",
      },
      { property: "og:title", content: "Tempo" },
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
  const { data: memberships } = useMemberships();
  const { data: challenge } = useMyChallenge();
  const { data: challengeMembers } = useChallengeMembers(challenge?.id);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [resetStep, setResetStep] = useState<0 | 1>(0);
  const [resetTargets, setResetTargets] = useState(false);
  const [resetDone, setResetDone] = useState(false);

  const ownedPlan = memberships?.find((m) => m.role === "owner");
  const canInvite = !!challenge && (challengeMembers?.length ?? 0) < 2;

  const reset = async () => {
    if (!ownedPlan) return;
    setBusy(true);
    setError(null);
    setResetStep(0);
    try {
      await resetBulkData(ownedPlan.bulk_profile_id, { photos: true, targets: resetTargets });
      setResetDone(true);
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

      {ownedPlan ? (
        <Card className="mt-3">
          <SectionTitle>Private Bulk</SectionTitle>
          <button
            onClick={() => void navigate({ to: "/bulk" })}
            className="min-h-11 w-full rounded-xl bg-primary py-3 text-sm font-semibold text-primary-foreground"
          >
            Open my bulk plan
          </button>
          {error ? <p className="mt-2 text-xs text-danger">{error}</p> : null}
        </Card>
      ) : null}

      {canInvite ? (
        <div className="mt-3">
          <ChallengeInviteCard challengeId={challenge.id} />
        </div>
      ) : null}

      {ownedPlan ? (
        <Card className="mt-3">
          <SectionTitle>Danger zone</SectionTitle>
          <Note>
            Resetting clears every daily log, workout, weekly note and progress photo on your plan.
            The plan itself and the people you shared it with stay in place. This cannot be undone.
          </Note>
          <label className="mt-3 flex items-center gap-2 text-xs text-muted-foreground">
            <input
              type="checkbox"
              checked={resetTargets}
              onChange={(e) => setResetTargets(e.target.checked)}
              className="h-4 w-4 accent-primary"
            />
            Also restore the default targets
          </label>
          {resetStep === 0 ? (
            <button
              onClick={() => {
                setResetDone(false);
                setResetStep(1);
              }}
              className="mt-3 flex w-full items-center justify-center gap-2 rounded-xl border border-danger/50 py-3 text-sm font-semibold text-danger"
            >
              <RotateCcw className="h-4 w-4" /> Reset my bulk plan
            </button>
          ) : (
            <div className="mt-3 grid grid-cols-2 gap-2">
              <button
                onClick={() => setResetStep(0)}
                className="rounded-xl border border-border py-3 text-sm font-medium"
              >
                Cancel
              </button>
              <button
                onClick={() => void reset()}
                disabled={busy}
                className="rounded-xl bg-danger py-3 text-sm font-semibold text-primary-foreground disabled:opacity-60"
              >
                {busy ? "Resetting…" : "Yes, erase it"}
              </button>
            </div>
          )}
          {resetDone ? (
            <p className="mt-2 text-xs text-good">Your bulk plan is now empty.</p>
          ) : null}
        </Card>
      ) : null}

      <Card className="mt-3">
        <SectionTitle>Session</SectionTitle>
        <button
          onClick={() => {
            void signOut().then((signedOut) => {
              if (signedOut) void navigate({ to: "/auth", replace: true });
            });
          }}
          className="flex w-full items-center justify-center gap-2 rounded-xl border border-border py-3 text-sm font-medium text-muted-foreground"
        >
          <LogOut className="h-4 w-4" /> Sign out
        </button>
      </Card>
    </AppShell>
  );
}
