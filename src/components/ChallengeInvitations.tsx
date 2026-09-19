import { useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import { Card, PendingLabel, SectionTitle } from "@/components/ui-kit";
import { useChallengeInvitations } from "@/lib/challenge-invitations";
import {
  acceptChallengeInvitationById,
  declineChallengeInvitation,
} from "@/lib/privileged-rpcs.functions";

export function ChallengeInvitations() {
  const invitations = useChallengeInvitations();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [pending, setPending] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const refresh = async () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: ["challenge-invitations", "mine"] }),
      queryClient.invalidateQueries({ queryKey: ["challenge", "mine"] }),
      queryClient.invalidateQueries({ queryKey: ["challenge-members"] }),
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
  if (!invitations.data?.length && !invitations.isError) return null;
  return (
    <Card className="mt-3">
      <SectionTitle>Invitations {invitations.data?.length ?? 0}</SectionTitle>
      {invitations.isError ? (
        <button
          className="min-h-11 text-sm font-semibold text-primary"
          onClick={() => void invitations.refetch()}
        >
          Retry invitations
        </button>
      ) : (
        <div className="space-y-3">
          {invitations.data?.map((invitation) => (
            <div key={invitation.invitation_id} className="rounded-xl border border-border p-3">
              <p className="font-semibold">{invitation.challenge_name}</p>
              <p className="mt-1 text-xs text-muted-foreground">
                @{invitation.inviter_username} invited you · {Number(invitation.weekly_target_km)}{" "}
                km weekly target
              </p>
              <div className="mt-3 grid grid-cols-2 gap-2">
                <button
                  className="min-h-11 rounded-xl border border-border text-sm font-semibold"
                  disabled={pending !== null}
                  onClick={() => void decline(invitation.invitation_id)}
                >
                  Decline
                </button>
                <button
                  className="min-h-11 rounded-xl bg-primary text-sm font-semibold text-primary-foreground disabled:opacity-60"
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
            </div>
          ))}
        </div>
      )}
      {error ? (
        <p className="mt-2 text-xs text-danger" role="alert">
          {error}
        </p>
      ) : null}
    </Card>
  );
}
