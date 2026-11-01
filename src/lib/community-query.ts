import { infiniteQueryOptions, queryOptions, useQuery } from "@tanstack/react-query";
import type { QueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { readRetryDelay, shouldRetryRead } from "./network-errors";

export type CommunityPerson = {
  user_id: string;
  username: string;
  relationship_state: "none" | "outgoing_pending" | "incoming_pending" | "friends";
  /** Current request lifecycle, never a client-supplied actor identity. */
  request_id: string | null;
};
export type CommunityPeoplePage = { people: CommunityPerson[]; next_cursor: string | null };
export type CommunityList = "incoming" | "outgoing" | "friends" | "blocked";
export type CommunityAction =
  "send" | "accept" | "decline" | "cancel" | "remove" | "block" | "unblock";
export const communityKey = (userId: string | undefined) => ["community", userId] as const;
const readPolicy = { staleTime: 30_000, retry: shouldRetryRead, retryDelay: readRetryDelay };
export const normalizePeopleSearch = (query: string) =>
  query.trim().toLowerCase().replace(/^@/, "");
export const validPeopleSearch = (query: string) => /^[a-z0-9_]{2,20}$/.test(query);
export const communityBadgeLabel = (count: number) => (count > 9 ? "9+" : String(count));

export const communityCountOptions = (userId: string | undefined, enabled = true) =>
  queryOptions({
    queryKey: [...communityKey(userId), "incoming-count"],
    enabled: !!userId && enabled,
    ...readPolicy,
    queryFn: async ({ signal }) => {
      const { data, error } = await supabase.rpc("community_incoming_count").abortSignal(signal);
      if (error) throw error;
      return data ?? 0;
    },
  });
export const useCommunityCount = (userId: string | undefined, enabled = true) =>
  useQuery(communityCountOptions(userId, enabled));

export const communitySearchOptions = (userId: string | undefined, input: string) => {
  const query = normalizePeopleSearch(input);
  return queryOptions({
    queryKey: [...communityKey(userId), "search", query],
    enabled: !!userId && validPeopleSearch(query),
    ...readPolicy,
    queryFn: async ({ signal }): Promise<CommunityPerson[]> => {
      const { data, error } = await supabase
        .rpc("search_community_people", { _query: query })
        .abortSignal(signal);
      if (error) throw error;
      return (data ?? []) as CommunityPerson[];
    },
  });
};
export const communityProfileOptions = (userId: string | undefined, other: string) =>
  queryOptions({
    queryKey: [...communityKey(userId), "profile", other],
    enabled: !!userId,
    ...readPolicy,
    queryFn: async ({ signal }): Promise<CommunityPerson | null> => {
      const { data, error } = await supabase
        .rpc("get_community_profile", { _user: other })
        .abortSignal(signal);
      if (error) throw error;
      return (data?.[0] ?? null) as CommunityPerson | null;
    },
  });
export const communityListOptions = (userId: string | undefined, kind: CommunityList) =>
  infiniteQueryOptions({
    queryKey: [...communityKey(userId), "list", kind],
    enabled: !!userId,
    ...readPolicy,
    initialPageParam: undefined as string | undefined,
    queryFn: async ({ pageParam, signal }): Promise<CommunityPeoplePage> => {
      const { data, error } = await supabase
        .rpc("list_community_people", {
          _kind: kind,
          ...(pageParam ? { _after: pageParam } : {}),
        })
        .abortSignal(signal);
      if (error) throw error;
      return data as unknown as CommunityPeoplePage;
    },
    getNextPageParam: (lastPage: CommunityPeoplePage, _pages, lastCursor) => {
      const next = lastPage.next_cursor;
      return next && next !== lastCursor ? next : undefined;
    },
  });
/** Overlapping refreshes/pages may share a row, but the UI must never render it twice. */
export function communityPeople(pages: CommunityPeoplePage[] | undefined) {
  return [
    ...new Map(
      (pages ?? []).flatMap((page) => page.people).map((person) => [person.user_id, person]),
    ).values(),
  ];
}
const actionRPCs = {
  send: "send_community_friend_request",
  accept: "accept_community_friend_request",
  decline: "decline_community_friend_request",
  cancel: "cancel_community_friend_request",
  remove: "remove_community_friend",
} as const;
export async function changeCommunityRelationship(
  action: CommunityAction,
  person: CommunityPerson,
  requestId?: string,
) {
  if (action === "block" || action === "unblock") {
    const { error } = await supabase.rpc(
      action === "block" ? "block_community_user" : "unblock_community_user",
      { _user: person.user_id },
    );
    if (error) throw error;
    return;
  }
  const token = action === "send" ? requestId : person.request_id;
  if (!token) throw new Error("Request changed. Refresh and try again.");
  const { error } = await supabase.rpc(actionRPCs[action], {
    _user: person.user_id,
    _request_id: token,
  });
  if (error) throw error;
}
export async function refreshCommunity(client: QueryClient, userId: string) {
  // Keep relationship state and the same account's inbox/read state in sync.
  await Promise.all([
    client.invalidateQueries({ queryKey: communityKey(userId) }),
    // The same successful transaction can create or resolve in-app friend events.
    client.invalidateQueries({ queryKey: ["account-notifications", userId] }),
  ]);
}
