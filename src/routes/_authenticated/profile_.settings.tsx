import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { ChevronRight, LogOut } from "lucide-react";
import * as Dialog from "@radix-ui/react-dialog";
import { DeleteAccountDialog } from "@/components/DeleteAccountDialog";
import { NavRows } from "@/components/NavRows";
import { AppShell, PageHeader } from "@/components/AppShell";
import { PageSkeleton } from "@/components/PageSkeleton";
import { Card, SectionTitle } from "@/components/ui-kit";
import { ChallengeDataExport } from "@/components/ChallengeDataExport";
import { clearDeletedAccountSession, signOut, useAuth } from "@/lib/auth";
import { preferredBulkMembership, useBulkAdmin, useMemberships } from "@/lib/bulk-access";
import {
  normalizeUsername,
  useAccountProfile,
  usernameValidationError,
} from "@/lib/account-profile";
import { checkUsernameAvailability, saveAccountUsername } from "@/lib/privileged-rpcs.functions";

export const Route = createFileRoute("/_authenticated/profile_/settings")({
  head: () => ({ meta: [{ title: "Tempo" }] }),
  component: SettingsPage,
});

function SettingsPage() {
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
  const { data: isAdmin } = useBulkAdmin();
  const [signingOut, setSigningOut] = useState(false);
  const [signOutError, setSignOutError] = useState<string | null>(null);
  const [editingUsername, setEditingUsername] = useState(false);
  const [username, setUsername] = useState("");
  const [usernameBusy, setUsernameBusy] = useState(false);
  const [usernameError, setUsernameError] = useState<string | null>(null);
  const [usernameCheckFailed, setUsernameCheckFailed] = useState(false);
  const [usernameAvailable, setUsernameAvailable] = useState<boolean | null>(null);

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

  return (
    <AppShell>
      <PageHeader title="Settings" backTo="/profile" backLabel="You" />

      <section aria-label="Account" className="space-y-3">
        <h2 className="px-1 text-[13px] font-medium text-muted-foreground">Account</h2>
        <div className="rounded-[20px] bg-card p-4">
          <p className="text-[13px] text-muted-foreground">Signed in as</p>
          <p className="mt-0.5 break-all text-[15px] font-medium">{user?.email ?? "…"}</p>
        </div>
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
              className="flex min-h-14 w-full items-center justify-between gap-3 rounded-[20px] bg-card px-4 text-left text-[15px] font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring active:bg-elevated"
            >
              Edit username
              <span className="flex items-center gap-2 text-muted-foreground">
                <span className="text-[13px]">@{accountProfile.data?.username ?? "…"}</span>
                <ChevronRight className="control-chevron" aria-hidden="true" />
              </span>
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
                Other players use this to find you. Changing it keeps your account and Challenge
                identity intact.
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
                      data: { username: normalizeUsername(username), completeOnboarding: false },
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

      <div className="mt-4">
        <NavRows
          title="Notifications"
          rows={[
            {
              to: "/profile/notifications",
              label: "Notification settings",
              hint: "Browser permission and Challenge updates",
            },
          ]}
        />
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
            title="Fitness"
            rows={
              ownedPlan
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
                  ]
            }
          />
        )}
      </section>

      <div className="mt-4">
        <h2 className="px-1 pb-3 text-[13px] font-medium text-muted-foreground">Your data</h2>
        <ChallengeDataExport />
      </div>

      {isAdmin ? (
        <div className="mt-4">
          <NavRows
            title="Administration"
            rows={[{ to: "/bulk/diagnostics", label: "Production diagnostics" }]}
          />
        </div>
      ) : null}

      <section aria-label="Account actions" className="mt-6 space-y-3">
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
        {signOutError ? (
          <p role="alert" className="text-sm text-warn">
            {signOutError}
          </p>
        ) : null}
        <div className="border-t border-border pt-4">
          <h2 className="px-1 pb-2 text-[13px] font-medium text-destructive">Danger zone</h2>
          <DeleteAccountDialog
            onDeleted={async () => {
              await clearDeletedAccountSession();
              queryClient.clear();
              await navigate({ to: "/auth", replace: true });
            }}
          />
        </div>
      </section>
    </AppShell>
  );
}
