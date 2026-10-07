import { useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import * as Dialog from "@radix-ui/react-dialog";
import { format, parseISO } from "date-fns";
import { Card, PendingLabel, SectionTitle } from "@/components/ui-kit";
import { ChallengeInvitationDetails } from "@/components/ChallengeInvitationDetails";
import { useChallengeInvitations } from "@/lib/challenge-invitations";
import {
  acceptChallengeInvitationById,
  declineChallengeInvitation,
} from "@/lib/privileged-rpcs.functions";

export function ChallengeInvitations({ inbox = false }: { inbox?: boolean }) {
  const invitations = useChallengeInvitations();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [pending, setPending] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const refresh = async () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: ["challenge-invitations", "mine"] }),
      queryClient.invalidateQueries({ queryKey: ["challenge"] }),
      queryClient.invalidateQueries({ queryKey: ["challenge-members"] }),
      queryClient.invalidateQueries({ queryKey: ["account-notifications"] }),
    ]);

  const accept = async (invitationId: string) => {
    if (pending) return;
    setPending(invitationId);
    setError(null);
    try {
      await acceptChallengeInvitationById({ data: { invitationId } });
      await refresh();
      await navigate({ to: "/challenge" });
    } catch {
      setError(
        "This invitation could not be accepted. It may have expired or the Challenge may be full.",
      );
    } finally {
      setPending(null);
    }
  };

  const decline = async (invitationId: string) => {
    if (pending) return;
    setPending(invitationId);
    setError(null);
    try {
      await declineChallengeInvitation({ data: { invitationId } });
      await refresh();
    } catch {
      setError("This invitation could not be declined. Try again.");
    } finally {
      setPending(null);
    }
  };

  if (invitations.isLoading)
    return (
      <div
        className="mt-3 h-24 animate-pulse rounded-2xl bg-card"
        aria-label="Loading invitations"
      />
    );
  if (!invitations.data?.length && !invitations.isError) {
    return inbox ? (
      <div className="rounded-[20px] bg-card p-5">
        <h2 className="text-base font-semibold">You're all caught up.</h2>
        <p className="mt-1 text-sm text-muted-foreground">No new notifications.</p>
      </div>
    ) : null;
  }
  return (
    <section
      aria-label={inbox ? "New notifications" : "Challenge invitations"}
      className={inbox ? "" : "mt-3"}
    >
      <SectionTitle>{inbox ? "New" : "Invitations"}</SectionTitle>
      {invitations.isError ? (
        <button
          type="button"
          className="min-h-11 text-sm font-semibold text-primary"
          onClick={() => void invitations.refetch()}
        >
          Retry invitations
        </button>
      ) : (
        <div className="space-y-3">
          {invitations.data?.map((invitation) => (
            <Card key={invitation.invitation_id} className="min-w-0 p-4">
              <h3 className="break-words font-semibold">{invitation.challenge_name}</h3>
              <p className="mt-1 break-words text-[13px] text-muted-foreground [overflow-wrap:anywhere]">
                @{invitation.inviter_username} invited you · {Number(invitation.weekly_target_km)}{" "}
                km weekly target
              </p>
              <p className="mt-1 text-xs text-muted-foreground">
                {invitation.duration_weeks} weeks · Expires{" "}
                {format(parseISO(invitation.expires_at), "d MMM")}
              </p>
              <Dialog.Root>
                <Dialog.Trigger asChild>
                  <button
                    type="button"
                    className="min-h-11 text-left text-[13px] font-medium text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    Read the full terms
                    <span className="sr-only">
                      {" "}
                      for {invitation.challenge_name} from @{invitation.inviter_username}
                    </span>
                  </button>
                </Dialog.Trigger>
                <Dialog.Portal>
                  <Dialog.Overlay className="fixed inset-0 z-50 bg-black/60" />
                  <Dialog.Content className="fixed left-1/2 top-1/2 z-50 max-h-[85dvh] w-[calc(100%-2rem)] max-w-md -translate-x-1/2 -translate-y-1/2 overflow-y-auto rounded-[20px] border border-border bg-background p-5">
                    <Dialog.Title className="break-words text-xl font-semibold">
                      {invitation.challenge_name}
                    </Dialog.Title>
                    <Dialog.Description className="mb-4 mt-1 break-all text-sm text-muted-foreground">
                      Invitation from @{invitation.inviter_username}
                    </Dialog.Description>
                    <ChallengeInvitationDetails invitation={invitation} />
                    <Dialog.Close asChild>
                      <button
                        type="button"
                        className="mt-4 min-h-11 w-full rounded-xl bg-elevated text-sm font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                      >
                        Close
                      </button>
                    </Dialog.Close>
                  </Dialog.Content>
                </Dialog.Portal>
              </Dialog.Root>
              <div className="mt-3 grid grid-cols-2 gap-2">
                <button
                  type="button"
                  aria-label={`Decline ${invitation.challenge_name} invitation from @${invitation.inviter_username}`}
                  className="min-h-11 rounded-xl border border-border text-sm font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring active:bg-elevated disabled:opacity-60"
                  disabled={pending !== null}
                  onClick={() => void decline(invitation.invitation_id)}
                >
                  Decline
                </button>
                <button
                  type="button"
                  aria-label={`Accept ${invitation.challenge_name} invitation from @${invitation.inviter_username}`}
                  className="min-h-11 rounded-xl bg-primary text-sm font-semibold text-primary-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring active:opacity-80 disabled:opacity-60"
                  disabled={pending !== null}
                  onClick={() => void accept(invitation.invitation_id)}
                >
                  {pending === invitation.invitation_id ? (
                    <PendingLabel>Working</PendingLabel>
                  ) : (
                    "Accept"
                  )}
                </button>
              </div>
            </Card>
          ))}
        </div>
      )}
      {error ? (
        <p className="mt-2 text-xs text-danger" role="alert">
          {error}
        </p>
      ) : null}
    </section>
  );
}
