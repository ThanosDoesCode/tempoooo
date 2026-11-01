export type InvitationEventType =
  | "challenge_invitation_received"
  | "challenge_invitation_accepted"
  | "challenge_invitation_declined";

export type CommunityEventType = "friend_request_received" | "friend_request_accepted";
export type AccountNotificationEventType = InvitationEventType | CommunityEventType;

export type AccountNotification = {
  id: string;
  recipient_user_id: string;
  actor_user_id: string;
  actor_username: string | null;
  event_type: AccountNotificationEventType;
  challenge_id: string | null;
  invitation_id: string | null;
  community_relationship_id: string | null;
  community_request_id: string | null;
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
    case "friend_request_received":
      return `${actor} sent you a friend request`;
    case "friend_request_accepted":
      return `${actor} accepted your friend request`;
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
      if (event.invitation_id && actionable.has(event.invitation_id)) continue;
    }
    unread.add(event.id);
  }
  return actionable.size + unread.size;
}

/** Friend events share the inbox, never a Challenge destination or browser push path. */
export function isCommunityNotification(event: AccountNotification): boolean {
  return (
    event.event_type === "friend_request_received" || event.event_type === "friend_request_accepted"
  );
}
