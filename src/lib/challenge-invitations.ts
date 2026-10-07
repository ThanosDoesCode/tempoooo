import { queryOptions, useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { listMyChallengeInvitations } from "./privileged-rpcs.functions";
import { readRetryDelay, shouldRetryRead } from "./network-errors";

export const challengeInvitationsQueryOptions = () =>
  queryOptions({
    queryKey: ["challenge-invitations", "mine"],
    queryFn: () => listMyChallengeInvitations(),
    staleTime: 30_000,
    gcTime: 10 * 60_000,
    retry: shouldRetryRead,
    retryDelay: readRetryDelay,
  });

export function useChallengeInvitations() {
  const invitations = useQuery(challengeInvitationsQueryOptions());
  const [now, setNow] = useState(Date.now);
  // The server lists outstanding invitations only. Also expire cached cards/badges on time,
  // without introducing read receipts or changing server-side acceptance rules.
  useEffect(() => {
    const current = Date.now();
    const nextExpiry = invitations.data
      ?.map((invitation) => Date.parse(invitation.expires_at))
      .filter((expiry) => expiry > current)
      .sort((a, b) => a - b)[0];
    if (nextExpiry == null) return;
    const timer = setTimeout(
      () => setNow(Date.now()),
      Math.min(nextExpiry - current + 1, 2_147_483_647),
    );
    return () => clearTimeout(timer);
  }, [invitations.data, now]);
  return {
    ...invitations,
    data: invitations.data?.filter(
      (invitation) => Date.parse(invitation.expires_at) > Math.max(now, Date.now()),
    ),
  };
}
