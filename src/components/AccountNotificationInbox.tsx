import { useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import { ChallengeInvitations } from "./ChallengeInvitations";
import { useNotificationInbox } from "@/lib/account-notifications";
import { notificationMessage, type AccountNotification } from "@/lib/account-notification-model";
import { supabase } from "@/integrations/supabase/client";

export function AccountNotificationInbox() {
  const { events, invitations } = useNotificationInbox();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [pending, setPending] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const actionable = new Set(invitations.data?.map((invitation) => invitation.invitation_id));
  const history =
    events.data?.filter(
      (event) =>
        event.event_type !== "challenge_invitation_received" ||
        !actionable.has(event.invitation_id),
    ) ?? [];

  const read = async (event: AccountNotification, open = false) => {
    if (pending) return;
    setPending(event.id);
    setError(null);
    try {
      if (!event.read_at) {
        const result = await supabase.rpc("mark_account_notification_read", {
          _notification: event.id,
        });
        if (result.error || !result.data) throw new Error("Read receipt unavailable");
        await queryClient.invalidateQueries({ queryKey: ["account-notifications"] });
      }
      if (open) await navigate({ to: "/challenge", search: { challenge: event.challenge_id } });
    } catch {
      setError("Could not update this notification. Please try again.");
    } finally {
      setPending(null);
    }
  };

  return (
    <div className="space-y-4">
      {invitations.data?.length || invitations.isError ? <ChallengeInvitations inbox /> : null}
      {events.isLoading ? (
        <div
          className="h-20 animate-pulse rounded-2xl bg-card"
          aria-label="Loading notifications"
        />
      ) : null}
      {events.isError ? (
        <button
          type="button"
          className="min-h-11 text-sm font-semibold text-primary"
          onClick={() => void events.refetch()}
        >
          Retry notifications
        </button>
      ) : null}
      {!events.isLoading &&
      !invitations.isLoading &&
      !events.isError &&
      !invitations.isError &&
      !history.length &&
      !actionable.size ? (
        <div className="rounded-[20px] bg-card p-5">
          <h2 className="text-base font-semibold">You're all caught up.</h2>
          <p className="mt-1 text-sm text-muted-foreground">No new notifications.</p>
        </div>
      ) : null}
      {error ? (
        <p role="alert" className="text-sm text-danger">
          {error}
        </p>
      ) : null}
      {history.map((event) => (
        <article key={event.id} className="min-w-0 rounded-[20px] bg-card p-4">
          <p className={event.read_at ? "text-sm text-muted-foreground" : "text-sm font-semibold"}>
            {notificationMessage(event)}
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            {new Date(event.created_at).toLocaleDateString()} · {event.read_at ? "Read" : "Unread"}
          </p>
          {event.event_type === "challenge_invitation_received" &&
          (!event.invitation_pending || Date.parse(event.invitation_expires_at) <= Date.now()) ? (
            <p className="mt-1 text-xs text-muted-foreground">
              This invitation is no longer pending.
            </p>
          ) : null}
          <div className="mt-2 flex flex-wrap items-center gap-x-4">
            {event.event_type !== "challenge_invitation_received" ? (
              <button
                type="button"
                disabled={pending === event.id}
                className="min-h-11 text-sm font-semibold text-primary disabled:opacity-50"
                onClick={() => void read(event, true)}
              >
                Open Challenge
              </button>
            ) : null}
            {!event.read_at ? (
              <button
                type="button"
                disabled={pending === event.id}
                className="min-h-11 text-sm text-muted-foreground disabled:opacity-50"
                onClick={() => void read(event)}
              >
                Mark as read
              </button>
            ) : null}
          </div>
        </article>
      ))}
    </div>
  );
}
