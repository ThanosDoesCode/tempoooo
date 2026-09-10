import { queryOptions, useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { readRetryDelay, shouldRetryRead } from "./network-errors";

export const USERNAME_PATTERN = /^[a-z0-9_]{3,20}$/;
export const RESERVED_USERNAMES = new Set(["admin", "administrator", "tempo", "support", "system"]);

export function normalizeUsername(value: string) {
  return value.trim().toLowerCase().replace(/^@/, "");
}

export function usernameValidationError(value: string): string | null {
  const username = normalizeUsername(value);
  if (!USERNAME_PATTERN.test(username))
    return "Use 3–20 lowercase letters, numbers, or underscores.";
  if (RESERVED_USERNAMES.has(username)) return "That username is reserved.";
  return null;
}

export function challengeUsernameError(error: unknown, username: string) {
  const message = error instanceof Error ? error.message : "";
  const handle = `@${normalizeUsername(username)}`;
  if (/not found/i.test(message)) return `We couldn't find ${handle}.`;
  if (/invite yourself/i.test(message)) return "You can't invite yourself.";
  if (/already been sent/i.test(message))
    return `An invitation has already been sent to ${handle}.`;
  if (/already part|already full/i.test(message))
    return "This person is already part of the Challenge.";
  return "We couldn't create the invitation. Check your connection and try again.";
}

export type AccountProfile = {
  id: string;
  username: string | null;
  account_onboarded_at: string | null;
};

export const accountProfileQueryOptions = (userId: string | undefined) =>
  queryOptions({
    queryKey: ["account-profile", userId],
    enabled: !!userId,
    queryFn: async ({ signal }) => {
      const { data, error } = await supabase
        .from("profiles")
        .select("id,username,account_onboarded_at")
        .eq("id", userId!)
        .abortSignal(signal)
        .maybeSingle();
      if (error) throw error;
      return data as AccountProfile | null;
    },
    staleTime: 5 * 60_000,
    retry: shouldRetryRead,
    retryDelay: readRetryDelay,
  });

export function useAccountProfile(userId: string | undefined) {
  return useQuery(accountProfileQueryOptions(userId));
}
