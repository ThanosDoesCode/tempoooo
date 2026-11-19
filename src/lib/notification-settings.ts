import { queryOptions, useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { readRetryDelay, shouldRetryRead } from "./network-errors";

export type NotificationCategory = "week_penalties" | "payments";
export type NotificationPreferences = Record<NotificationCategory, boolean>;
export type ChallengePushAccount = {
  accountEnabled: boolean;
  hasChallenge: boolean;
};

export const notificationAccountKey = (userId: string) =>
  ["notification-settings", userId, "account"] as const;
export const notificationPreferencesKey = (userId: string) =>
  ["notification-settings", userId, "categories"] as const;

async function readChallengePushAccount(
  userId: string,
  signal: AbortSignal,
): Promise<ChallengePushAccount> {
  const [account, membership] = await Promise.all([
    supabase
      .from("challenge_push_users")
      .select("enabled")
      .eq("user_id", userId)
      .abortSignal(signal)
      .maybeSingle(),
    supabase
      .from("challenge_members")
      .select("id")
      .eq("user_id", userId)
      .limit(1)
      .abortSignal(signal),
  ]);
  for (const { error } of [account, membership]) if (error) throw error;
  return {
    accountEnabled: account.data?.enabled ?? false,
    hasChallenge: !!membership.data?.length,
  };
}

export const notificationAccountOptions = (userId: string) =>
  queryOptions({
    queryKey: notificationAccountKey(userId),
    queryFn: ({ signal }) => readChallengePushAccount(userId, signal),
    retry: shouldRetryRead,
    retryDelay: readRetryDelay,
  });

export const notificationPreferencesOptions = (userId: string) =>
  queryOptions({
    queryKey: notificationPreferencesKey(userId),
    queryFn: async ({ signal }): Promise<NotificationPreferences> => {
      const { data, error } = await supabase
        .from("account_notification_preferences")
        .select("week_penalties,payments")
        .eq("user_id", userId)
        .abortSignal(signal)
        .maybeSingle();
      if (error) throw error;
      return data ?? { week_penalties: true, payments: true };
    },
    retry: shouldRetryRead,
    retryDelay: readRetryDelay,
  });

export function useNotificationSettings(userId: string) {
  // A failed preference read must not hide the account-wide opt-out or device controls.
  const account = useQuery(notificationAccountOptions(userId));
  const preferences = useQuery(notificationPreferencesOptions(userId));
  return { account, preferences };
}

export async function saveNotificationPreference(
  userId: string,
  category: NotificationCategory,
  enabled: boolean,
) {
  const { error } = await supabase.rpc("set_account_notification_preference", {
    _expected_user: userId,
    _category: category,
    _enabled: enabled,
  });
  if (error) throw error;
}
