import { queryOptions, useQuery } from "@tanstack/react-query";
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
  return useQuery(challengeInvitationsQueryOptions());
}
