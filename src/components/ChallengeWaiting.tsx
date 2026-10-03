import { Link, useNavigate } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { differenceInCalendarDays, format, parseISO } from "date-fns";
import { Card, Note, PendingLabel } from "@/components/ui-kit";
import { userFacingError } from "@/lib/network-errors";
import { cancelPendingChallenge } from "@/lib/privileged-rpcs.functions";
import { km, type Challenge, type OutgoingInvitation } from "@/lib/challenge";

/**
 * Creator's view of a still-pending challenge (opponent has not accepted). Replaces the old
 * "Week 0 of N" state. Bottom nav stays visible (rendered inside AppShell by the parent screen).
 */
export function ChallengeWaiting({
  challenge,
  invitation,
}: {
  challenge: Challenge;
  invitation: OutgoingInvitation;
}) {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [shareNote, setShareNote] = useState<string | null>(null);
  const [cancelArmed, setCancelArmed] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const atUser = `@${invitation.invited_username}`;
  const expires = parseISO(invitation.expires_at);
  const daysLeft = Math.max(0, differenceInCalendarDays(expires, new Date()));

  const share = async () => {
    const url = window.location.origin;
    const text = `I've set up a Tempo challenge for us. Open Tempo to accept — ${atUser}.`;
    try {
      if (typeof navigator !== "undefined" && navigator.share) {
        await navigator.share({ title: "Tempo challenge", text, url });
        return;
      }
      await navigator.clipboard.writeText(url);
      setShareNote("Invite link copied");
    } catch (cause) {
      // A user cancelling the native share sheet is not an error.
      if (cause instanceof DOMException && cause.name === "AbortError") return;
      try {
        await navigator.clipboard.writeText(url);
        setShareNote("Invite link copied");
      } catch {
        setShareNote("Couldn’t share the link. Try again.");
      }
    }
  };

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
    <>
      <header className="fade-up mb-1">
        <p className="text-sm text-muted-foreground">{challenge.duration_weeks}-week challenge</p>
        <h1 className="mt-1 text-3xl font-semibold tracking-tight">Waiting for {atUser}</h1>
      </header>

      <Card className="space-y-3 p-5">
        <div className="flex items-center gap-3">
          <span className="h-2.5 w-2.5 flex-none rounded-full bg-warn" aria-hidden="true" />
          <span className="text-[15px]">
            Invite sent. It expires in {daysLeft} day{daysLeft === 1 ? "" : "s"} (
            {format(expires, "d MMM")}).
          </span>
        </div>
        <p className="text-sm text-muted-foreground">
          {atUser} will see it when they open Tempo. You can also send them the link.
        </p>
        <button
          type="button"
          onClick={() => void share()}
          className="flex h-[52px] w-full items-center justify-center rounded-[16px] bg-primary text-base font-semibold text-primary-foreground active:scale-[0.99]"
        >
          Share invite link
        </button>
        {shareNote ? (
          <p role="status" className="text-[13px] text-good">
            {shareNote}
          </p>
        ) : null}
      </Card>

      <Card className="space-y-1 p-5">
        <p className="text-base font-medium">
          Starts {format(parseISO(challenge.start_date), "EEEE d MMM")}
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
    </>
  );
}
