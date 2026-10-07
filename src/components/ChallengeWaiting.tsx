import { Link, useNavigate } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { differenceInCalendarDays, format, parseISO } from "date-fns";
import { Card, Note, PendingLabel } from "@/components/ui-kit";
import { userFacingError } from "@/lib/network-errors";
import { cancelPendingChallenge } from "@/lib/privileged-rpcs.functions";
import { ChallengeShareInvite } from "./ChallengeShareInvite";
import { ChallengeInviteCard } from "./ChallengeInvite";
import { MainPageHeader } from "./MainPageHeader";
import { km, type Challenge, type OutgoingInvitation } from "@/lib/challenge";

/**
 * Creator's view of a still-pending challenge (opponent has not accepted). Replaces the old
 * "Week 0 of N" state. Bottom nav stays visible (rendered inside AppShell by the parent screen).
 */
export function ChallengeWaiting({
  challenge,
  invitation,
  expired = false,
}: {
  challenge: Challenge;
  invitation: OutgoingInvitation | null;
  expired?: boolean;
}) {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [cancelArmed, setCancelArmed] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const atUser = invitation ? `@${invitation.invited_username}` : "your opponent";
  const expires = invitation ? parseISO(invitation.expires_at) : null;
  const daysLeft = expires ? Math.max(0, differenceInCalendarDays(expires, new Date())) : 0;

  const cancel = async () => {
    if (!cancelArmed) {
      setCancelArmed(true);
      return;
    }
    setCancelling(true);
    setError(null);
    try {
      await cancelPendingChallenge({ data: { challenge: challenge.id } });
      await qc.invalidateQueries({
        predicate: (query) => String(query.queryKey[0]).startsWith("challenge"),
      });
      void navigate({ to: "/challenge" });
    } catch (cause) {
      setError(userFacingError(cause, "cancel the challenge"));
      setCancelling(false);
    }
  };

  return (
    <div className="space-y-3.5">
      <MainPageHeader title={`Waiting for ${atUser}`} />

      <Card className="space-y-3.5 rounded-[20px] p-5">
        <div className="flex items-center justify-between gap-3">
          <span className="text-[15px] font-medium">
            {expired ? "Invite expired" : invitation ? "Invite sent" : "Invite your opponent"}
          </span>
          <span className="rounded-full bg-secondary px-3 py-1 text-xs text-muted-foreground">
            {expired ? "Expired" : "Pending"}
          </span>
        </div>
        {expires ? (
          <p className="text-[13px] text-muted-foreground">
            {expired ? "Expired" : `Expires in ${daysLeft} day${daysLeft === 1 ? "" : "s"}`} (
            {format(expires, "d MMM")})
          </p>
        ) : null}
        <p className="text-sm text-muted-foreground">
          {expired || !invitation
            ? "Send a fresh invitation below. Your challenge terms stay the same."
            : `${atUser} will see it when they open Tempo. You can also send them the link.`}
        </p>
        {invitation && !expired ? (
          <ChallengeShareInvite username={invitation.invited_username} />
        ) : null}
      </Card>
      {expired || !invitation ? <ChallengeInviteCard challengeId={challenge.id} /> : null}

      <Card className="space-y-1 rounded-[20px] p-5">
        <p className="text-base font-medium">
          Starts {format(parseISO(challenge.start_date), "EEEE d MMM")}
        </p>
        <p className="text-sm text-muted-foreground">
          {km(Number(challenge.weekly_target_km))} a week · {challenge.duration_weeks} weeks
        </p>
        <p className="text-sm text-muted-foreground">
          The first week runs Monday to Sunday in {challenge.timezone} time.
        </p>
      </Card>

      <div className="rounded-[20px] bg-card px-4">
        <Link
          to="/challenge/terms"
          className="flex min-h-[54px] items-center gap-3 text-[15px] active:opacity-80"
        >
          <span className="flex-1">See the terms</span>
          <span className="text-muted-foreground">
            {km(Number(challenge.weekly_target_km))} a week
          </span>
        </Link>
        <button
          type="button"
          disabled={cancelling}
          onClick={() => void cancel()}
          className="flex min-h-[54px] w-full items-center border-t border-border text-left text-[15px] font-medium text-danger disabled:opacity-60"
        >
          {cancelling ? (
            <PendingLabel>Cancelling…</PendingLabel>
          ) : cancelArmed ? (
            "Tap again to cancel this challenge"
          ) : (
            "Cancel this challenge"
          )}
        </button>
      </div>

      {cancelArmed && !cancelling ? (
        <button
          type="button"
          onClick={() => setCancelArmed(false)}
          className="h-11 w-full rounded-[14px] text-[13px] font-medium text-muted-foreground"
        >
          Keep waiting
        </button>
      ) : null}
      {error ? (
        <p role="alert" className="text-[13px] text-danger">
          {error}
        </p>
      ) : null}
      {!cancelArmed ? (
        <Note>
          Cancelling removes the invite and the challenge. You can start a new one anytime.
        </Note>
      ) : null}
    </div>
  );
}
