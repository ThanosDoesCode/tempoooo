export type InvitationEventType =
  | "challenge_invitation_received"
  | "challenge_invitation_accepted"
  | "challenge_invitation_declined";

export type AccountNotification = {
  id: string;
  recipient_user_id: string;
  actor_user_id: string;
  actor_username: string | null;
  event_type: InvitationEventType;
  challenge_id: string;
  invitation_id: string;
  created_at: string;
  read_at: string | null;
  invitation_expires_at: string;
  invitation_pending: boolean;
};

export function notificationMessage(event: AccountNotification): string {
  const actor =
    event.actor_username && /^[a-z0-9_]{3,20}$/i.test(event.actor_username)
      ? `@${event.actor_username}`
      : "A Tempo user";
  switch (event.event_type) {
    case "challenge_invitation_received":
      return `${actor} invited you to a Challenge.`;
    case "challenge_invitation_accepted":
      return `${actor} accepted your challenge invitation.`;
    case "challenge_invitation_declined":
      return `${actor} declined your challenge invitation.`;
  }
}

/** Pending invitations remain actionable even after reading. Count their received event once. */
export function notificationBadgeCount(
  events: AccountNotification[],
  invitations: { invitation_id: string }[],
): number {
  const actionable = new Set(invitations.map((invitation) => invitation.invitation_id));
  const unread = new Set<string>();
  for (const event of events) {
    if (event.read_at) continue;
    if (event.event_type === "challenge_invitation_received") {
      if (actionable.has(event.invitation_id)) continue;
    }
    unread.add(event.id);
  }
  return actionable.size + unread.size;
}
