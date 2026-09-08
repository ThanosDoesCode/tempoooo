import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Dumbbell, Lock, LogOut, Mail, RotateCcw } from "lucide-react";
import { AppShell, PageHeader } from "@/components/AppShell";
import { Card, Note, SectionTitle } from "@/components/ui-kit";
import { ChallengeInviteCard } from "@/components/ChallengeInvite";
import { useAuth, signOut } from "@/lib/auth";
import { deactivatePublicGoal, useMemberships } from "@/lib/bulk-access";
import { useChallengeMembers, useMyChallenge } from "@/lib/challenge";
import { clearBulk, resetBulkData } from "@/lib/store";
import { useAcknowledgeGoal, useGoalDiscovery } from "@/lib/goal-discovery";

export const Route = createFileRoute("/_authenticated/profile")({
  head: () => ({
    meta: [
      { title: "Tempo" },
      {
        name: "description",
        content: "See the account you are signed in with and create or open your Tempo Goal plan.",
      },
      { property: "og:title", content: "Tempo" },
      {
        property: "og:description",
        content: "Manage your account and your Tempo Goal plan access.",
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
  const queryClient = useQueryClient();
  const { data: memberships, isLoading: bulkAccessLoading } = useMemberships();
  const goalDiscovery = useGoalDiscovery();
  const acknowledgeGoal = useAcknowledgeGoal();
  const { data: challenge } = useMyChallenge();
  const { data: challengeMembers } = useChallengeMembers(challenge?.id);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [resetStep, setResetStep] = useState<0 | 1>(0);
  const [resetTargets, setResetTargets] = useState(false);
  const [resetDone, setResetDone] = useState(false);
  const [signingOut, setSigningOut] = useState(false);
  const acknowledgementStarted = useRef(false);

  const ownedPlan = memberships?.find((m) => m.role === "owner" && m.is_active !== false);
  const canInvite = !!challenge && (challengeMembers?.length ?? 0) < 2;

  useEffect(() => {
    if (
      ownedPlan ||
      goalDiscovery.isLoading ||
      goalDiscovery.data?.goal_seen_at != null ||
      acknowledgementStarted.current
    )
      return;
    acknowledgementStarted.current = true;
    void acknowledgeGoal().catch(() => {
      acknowledgementStarted.current = false;
    });
  }, [acknowledgeGoal, goalDiscovery.data?.goal_seen_at, goalDiscovery.isLoading, ownedPlan]);

  const reset = async () => {
    if (!ownedPlan) return;
    setBusy(true);
    setError(null);
    setResetStep(0);
    try {
      if (ownedPlan.is_public) {
        await deactivatePublicGoal();
        clearBulk();
        queryClient.setQueryData(
          ["bulk-memberships"],
          memberships?.map((membership) =>
            membership.bulk_profile_id === ownedPlan.bulk_profile_id
              ? { ...membership, is_active: false }
              : membership,
          ) ?? [],
        );
        await queryClient.invalidateQueries({
          predicate: ({ queryKey }) => String(queryKey[0] ?? "").startsWith("bulk"),
        });
      } else {
        await resetBulkData(ownedPlan.bulk_profile_id, {
          photos: true,
          targets: resetTargets,
        });
      }
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

      {resetDone && !ownedPlan ? (
        <Note>Your Goal plan was reset. Completed history remains available after setup.</Note>
      ) : null}

      <Card>
        <SectionTitle>Signed in as</SectionTitle>
        <div className="flex items-center gap-2 text-sm">
          <Mail className="h-4 w-4 text-muted-foreground" />
          <span className="font-medium">{user?.email ?? "…"}</span>
        </div>
      </Card>

      {bulkAccessLoading ? (
        <div className="mt-3 h-36 animate-pulse rounded-2xl bg-card" aria-label="Loading plan" />
      ) : ownedPlan ? (
        <Card className="mt-3">
          <SectionTitle>{ownedPlan.is_public ? "My Goal Plan" : "My Bulk Plan"}</SectionTitle>
          <button
            onClick={() => void navigate({ to: "/bulk" })}
            className="min-h-11 w-full rounded-xl bg-primary py-3 text-sm font-semibold text-primary-foreground"
          >
            {ownedPlan.is_public ? "Open My Goal" : "Open My Bulk"}
          </button>
          {error ? <p className="mt-2 text-xs text-danger">{error}</p> : null}
        </Card>
      ) : (
        <Card className="mt-3 border-dashed">
          <div className="flex items-start gap-3">
            <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-elevated text-muted-foreground">
              <Lock className="h-4 w-4" aria-hidden="true" />
            </span>
            <div>
              <div className="flex items-center gap-2">
                <SectionTitle>Get My Goal Plan</SectionTitle>
                {goalDiscovery.isSuccess && goalDiscovery.data?.goal_seen_at == null ? (
                  <span className="rounded-full bg-primary/15 px-2 py-0.5 text-[10px] font-semibold uppercase text-primary">
                    New
                  </span>
                ) : null}
              </div>
              <p className="text-sm leading-6 text-muted-foreground">
                Build a personalized nutrition and training setup based on your goals, experience
                and schedule.
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={() => void navigate({ to: "/bulk-onboarding" })}
            className="mt-4 flex min-h-11 w-full items-center justify-center gap-2 rounded-xl bg-primary px-4 py-3 text-sm font-semibold text-primary-foreground active:scale-[0.98]"
          >
            <Dumbbell className="h-4 w-4" aria-hidden="true" /> Start My Goal
          </button>
        </Card>
      )}

      {canInvite ? (
        <div className="mt-3">
          <ChallengeInviteCard challengeId={challenge.id} />
        </div>
      ) : null}

      {ownedPlan ? (
        <Card className="mt-3">
          <SectionTitle>Danger zone</SectionTitle>
          <Note>
            {ownedPlan.is_public
              ? "Resetting removes the active Goal setup and returns you to onboarding. Completed workout and nutrition history stays unchanged."
              : "Resetting clears every daily log, workout, weekly note and progress photo on your plan. The plan itself stays in place. This cannot be undone."}
          </Note>
          {!ownedPlan.is_public ? (
            <label className="mt-3 flex items-center gap-2 text-xs text-muted-foreground">
              <input
                type="checkbox"
                checked={resetTargets}
                onChange={(e) => setResetTargets(e.target.checked)}
                className="h-4 w-4 accent-primary"
              />
              Also restore the default targets
            </label>
          ) : null}
          {resetStep === 0 ? (
            <button
              onClick={() => {
                setResetDone(false);
                setResetStep(1);
              }}
              className="mt-3 flex w-full items-center justify-center gap-2 rounded-xl border border-danger/50 py-3 text-sm font-semibold text-danger"
            >
              <RotateCcw className="h-4 w-4" /> Reset my {ownedPlan.is_public ? "Goal" : "bulk"}{" "}
              plan
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
            <p className="mt-2 text-xs text-good">
              Your {ownedPlan.is_public ? "Goal" : "bulk"} plan is now empty.
            </p>
          ) : null}
        </Card>
      ) : null}

      <Card className="mt-3">
        <SectionTitle>Session</SectionTitle>
        <button
          disabled={signingOut}
          onClick={() => {
            if (signingOut) return;
            setSigningOut(true);
            void signOut()
              .then((signedOut) => {
                if (signedOut) {
                  void navigate({ to: "/auth", replace: true });
                  return;
                }
                setSigningOut(false);
              })
              .catch(() => setSigningOut(false));
          }}
          className="flex min-h-11 w-full items-center justify-center gap-2 rounded-xl border border-border py-3 text-sm font-medium text-muted-foreground active:scale-[0.98] disabled:opacity-60"
        >
          <LogOut className="h-4 w-4" /> {signingOut ? "Signing out…" : "Sign out"}
        </button>
      </Card>
    </AppShell>
  );
}
