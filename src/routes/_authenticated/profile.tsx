import { PageSkeleton } from "@/components/PageSkeleton";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { LogOut, ChevronRight } from "lucide-react";
import * as Dialog from "@radix-ui/react-dialog";
import { DeleteAccountDialog } from "@/components/DeleteAccountDialog";
import { NavRows } from "@/components/NavRows";
import { AppShell, PageHeader } from "@/components/AppShell";
import { Card, SectionTitle } from "@/components/ui-kit";
import { ChallengeDataExport } from "@/components/ChallengeDataExport";
import { clearDeletedAccountSession, useAuth, signOut } from "@/lib/auth";
import { preferredBulkMembership, useBulkAdmin, useMemberships } from "@/lib/bulk-access";
import { useAcknowledgeGoal, useGoalDiscovery } from "@/lib/goal-discovery";
import {
  normalizeUsername,
  useAccountProfile,
  usernameValidationError,
} from "@/lib/account-profile";
import { checkUsernameAvailability, saveAccountUsername } from "@/lib/privileged-rpcs.functions";

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
  const accountProfile = useAccountProfile(user?.id);
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const {
    data: memberships,
    isLoading: bulkAccessLoading,
    isError: bulkAccessError,
    refetch: refetchBulkAccess,
  } = useMemberships();
  const goalDiscovery = useGoalDiscovery();
  const acknowledgeGoal = useAcknowledgeGoal();
  const { data: isAdmin } = useBulkAdmin();
  const [signingOut, setSigningOut] = useState(false);
  const [signOutError, setSignOutError] = useState<string | null>(null);
  const [editingUsername, setEditingUsername] = useState(false);
  const [username, setUsername] = useState("");
  const [usernameBusy, setUsernameBusy] = useState(false);
  const [usernameError, setUsernameError] = useState<string | null>(null);
  const [usernameCheckFailed, setUsernameCheckFailed] = useState(false);
  const [usernameAvailable, setUsernameAvailable] = useState<boolean | null>(null);
  const acknowledgementStarted = useRef(false);

  useEffect(() => {
    if (!editingUsername || usernameValidationError(username)) {
      setUsernameAvailable(null);
      return;
    }
    setUsernameCheckFailed(false);
    const normalized = normalizeUsername(username);
    let active = true;
    setUsernameAvailable(null);
    const timer = window.setTimeout(() => {
      void checkUsernameAvailability({ data: { username: normalized } })
        .then((available) => {
          if (active) setUsernameAvailable(available);
        })
        .catch(() => {
          if (active) setUsernameCheckFailed(true);
        });
    }, 350);
    return () => {
      active = false;
      window.clearTimeout(timer);
    };
  }, [editingUsername, username]);

  const ownedPlan = preferredBulkMembership(memberships);

  useEffect(() => {
    if (
      ownedPlan ||
      goalDiscovery.isLoading ||
      goalDiscovery.isError ||
      goalDiscovery.data?.goal_seen_at != null ||
      acknowledgementStarted.current
    )
      return;
    acknowledgementStarted.current = true;
    void acknowledgeGoal().catch(() => {
      acknowledgementStarted.current = false;
    });
  }, [
    acknowledgeGoal,
    goalDiscovery.data?.goal_seen_at,
    goalDiscovery.isError,
    goalDiscovery.isLoading,
    ownedPlan,
  ]);

  return (
    <AppShell>
      <PageHeader title="You" />
      <div className="mb-6 flex items-center gap-3">
        <span
          aria-hidden="true"
          className="grid h-14 w-14 shrink-0 place-items-center rounded-full bg-elevated text-lg font-semibold"
        >
          {(accountProfile.data?.username ?? user?.email ?? "").slice(0, 2).toUpperCase()}
        </span>
        <div className="min-w-0">
          <p className="break-all text-xl font-semibold">@{accountProfile.data?.username ?? "…"}</p>
          <p className="mt-1 break-all text-[13px] text-muted-foreground">{user?.email ?? "…"}</p>
        </div>
      </div>

      <section className="mt-4">
        {bulkAccessLoading ? (
          <PageSkeleton label="Loading plan" />
        ) : bulkAccessError ? (
          <Card>
            <SectionTitle>Fitness tools</SectionTitle>
            <p className="text-sm leading-6 text-muted-foreground">
              Tempo couldn't check your fitness setup. Your account and Challenge are still safe.
            </p>
            <button
              type="button"
              onClick={() => void refetchBulkAccess()}
              className="account-secondary mt-3"
            >
              Retry
            </button>
          </Card>
        ) : (
          <NavRows
            title="Settings"
            rows={[
              ...(ownedPlan
                ? [
                    {
                      to: "/bulk/more",
                      label: "Goal settings",
                      hint: "Daily targets and weekly workout goal",
                    },
                    {
                      to: "/bulk/training",
                      label: "Training plan",
                      hint: "Your workouts and plan tools",
                    },
                  ]
                : [
                    {
                      to: "/bulk-onboarding",
                      label: "Set up fitness tools",
                      hint: "Optional training, meals and Goal targets",
                    },
                  ]),
              {
                to: "/profile/notifications",
                label: "Notification settings",
                hint: "Browser permission and Challenge updates",
              },
            ]}
          />
        )}
        <Dialog.Root
          open={editingUsername}
          onOpenChange={(open) => {
            if (usernameBusy) return;
            setEditingUsername(open);
            if (!open) setUsernameError(null);
          }}
        >
          <Dialog.Trigger asChild>
            <button
              type="button"
              onClick={() => {
                setUsername(accountProfile.data?.username ?? "");
                setUsernameError(null);
              }}
              className="mt-3 flex min-h-14 w-full items-center justify-between gap-3 rounded-[20px] bg-card px-4 text-left text-[15px] font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring active:bg-elevated"
            >
              Edit username
              <ChevronRight className="control-chevron text-muted-foreground" aria-hidden="true" />
            </button>
          </Dialog.Trigger>
          <Dialog.Portal>
            <Dialog.Overlay className="fixed inset-0 z-50 bg-black/70" />
            <Dialog.Content
              className="fixed left-1/2 top-1/2 z-50 w-[calc(100%-2.5rem)] max-w-md -translate-x-1/2 -translate-y-1/2 rounded-[20px] border border-border bg-card p-5"
              onEscapeKeyDown={(event) => {
                if (usernameBusy) event.preventDefault();
              }}
              onPointerDownOutside={(event) => {
                if (usernameBusy) event.preventDefault();
              }}
            >
              <Dialog.Title className="text-2xl font-semibold">Edit username</Dialog.Title>
              <Dialog.Description className="mt-2 text-sm leading-6 text-muted-foreground">
                Friends use this to find you. Changing it keeps your account and Challenge identity
                intact.
              </Dialog.Description>
              <label className="mt-4 block text-[13px] text-muted-foreground">
                Username
                <input
                  className="account-input mt-2"
                  disabled={usernameBusy}
                  value={username}
                  maxLength={21}
                  autoCapitalize="none"
                  autoCorrect="off"
                  aria-invalid={!!usernameValidationError(username) || usernameAvailable === false}
                  onChange={(event) => {
                    setUsername(event.target.value);
                    setUsernameError(null);
                  }}
                />
              </label>
              <p aria-live="polite" className="mt-2 min-h-5 text-[13px] text-muted-foreground">
                {usernameValidationError(username) ??
                  (usernameCheckFailed
                    ? "Availability could not be checked. Save to retry."
                    : usernameAvailable === null
                      ? "Checking availability…"
                      : usernameAvailable
                        ? `@${normalizeUsername(username)} is available`
                        : "That username is already taken.")}
              </p>
              {usernameError ? (
                <p role="alert" className="mt-2 text-sm text-warn">
                  {usernameError}
                </p>
              ) : null}
              <div className="mt-5 grid grid-cols-2 gap-2">
                <Dialog.Close asChild>
                  <button type="button" disabled={usernameBusy} className="account-secondary">
                    Cancel
                  </button>
                </Dialog.Close>
                <button
                  type="button"
                  disabled={
                    usernameBusy ||
                    usernameAvailable === false ||
                    normalizeUsername(username) === accountProfile.data?.username
                  }
                  onClick={() => {
                    const validation = usernameValidationError(username);
                    if (validation) {
                      setUsernameError(validation);
                      return;
                    }
                    setUsernameBusy(true);
                    setUsernameError(null);
                    void saveAccountUsername({
                      data: {
                        username: normalizeUsername(username),
                        completeOnboarding: false,
                      },
                    })
                      .then(() =>
                        queryClient.invalidateQueries({ queryKey: ["account-profile", user?.id] }),
                      )
                      .then(() => setEditingUsername(false))
                      .catch((cause: unknown) =>
                        setUsernameError(
                          /taken|unique/i.test(cause instanceof Error ? cause.message : "")
                            ? "That username is already taken."
                            : "We couldn't update your username. Try again.",
                        ),
                      )
                      .finally(() => setUsernameBusy(false));
                  }}
                  className="account-primary"
                >
                  {usernameBusy ? "Saving…" : "Save"}
                </button>
              </div>
            </Dialog.Content>
          </Dialog.Portal>
        </Dialog.Root>
      </section>

      <ChallengeDataExport />
      {isAdmin ? (
        <div className="mt-4">
          <NavRows
            title="Administration"
            rows={[{ to: "/bulk/diagnostics", label: "Production diagnostics" }]}
          />
        </div>
      ) : null}

      <section aria-label="Account actions" className="mt-5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <button
            type="button"
            disabled={signingOut}
            onClick={() => {
              if (signingOut) return;
              setSigningOut(true);
              setSignOutError(null);
              void signOut()
                .then((signedOut) => {
                  if (signedOut) {
                    void navigate({ to: "/auth", replace: true });
                    return;
                  }
                  setSignOutError("Could not sign out. Please try again.");
                  setSigningOut(false);
                })
                .catch(() => {
                  setSignOutError("Could not sign out. Please try again.");
                  setSigningOut(false);
                });
            }}
            className="flex min-h-11 items-center gap-2 rounded-xl px-3 text-sm font-medium text-muted-foreground hover:bg-elevated focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-60"
          >
            <LogOut className="h-4 w-4" aria-hidden="true" />{" "}
            {signingOut ? "Signing out…" : "Sign out"}
          </button>
          <DeleteAccountDialog
            onDeleted={async () => {
              await clearDeletedAccountSession();
              queryClient.clear();
              await navigate({ to: "/auth", replace: true });
            }}
          />
        </div>
        {signOutError ? (
          <p role="alert" className="mt-2 text-sm text-warn">
            {signOutError}
          </p>
        ) : null}
      </section>
    </AppShell>
  );
}
