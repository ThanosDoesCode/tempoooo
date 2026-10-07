import { queryOptions, useQuery } from "@tanstack/react-query";
import { useAuth } from "./auth";
import { useChallengeInvitations } from "./challenge-invitations";
import { listAccountNotifications } from "./privileged-rpcs.functions";
import { readRetryDelay, shouldRetryRead } from "./network-errors";
import { notificationBadgeCount } from "./account-notification-model";

export const accountNotificationsQueryOptions = (userId: string | undefined) =>
  queryOptions({
    queryKey: ["account-notifications", userId],
    enabled: !!userId,
    queryFn: () => listAccountNotifications(),
    staleTime: 30_000,
    gcTime: 10 * 60_000,
    retry: shouldRetryRead,
    retryDelay: readRetryDelay,
  });

export function useNotificationInbox() {
  const { user } = useAuth();
  const events = useQuery(accountNotificationsQueryOptions(user?.id));
  const invitations = useChallengeInvitations();
  return {
    events,
    invitations,
    badgeCount: notificationBadgeCount(events.data ?? [], invitations.data ?? []),
  };
}
