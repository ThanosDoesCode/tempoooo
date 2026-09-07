import { queryOptions, useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import type { BulkRole } from "./store";
import { readRetryDelay, shouldRetryRead } from "./network-errors";

export type Membership = {
  bulk_profile_id: string;
  role: BulkRole;
  owner_id: string;
  allow_editor: boolean;
  is_public: boolean;
};

export const bulkOwnerQueryOptions = () =>
  queryOptions({
    queryKey: ["bulk-memberships"],
    queryFn: async (): Promise<Membership[]> => {
      const { data, error } = await supabase
        .from("bulk_members")
        .select(
          "bulk_profile_id, role, bulk_profiles(owner_id, allow_editor, bulk_targets(payload))",
        );
      if (error) throw error;
      return (data ?? [])
        .filter((r) => r.role === "owner")
        .map((r) => {
          const profile = r.bulk_profiles as unknown as {
            owner_id: string;
            allow_editor: boolean;
            bulk_targets:
              { payload: Record<string, unknown> } | { payload: Record<string, unknown> }[] | null;
          } | null;
          const targets = Array.isArray(profile?.bulk_targets)
            ? profile.bulk_targets[0]
            : profile?.bulk_targets;
          return {
            bulk_profile_id: r.bulk_profile_id,
            role: r.role as BulkRole,
            owner_id: profile?.owner_id ?? "",
            allow_editor: profile?.allow_editor ?? false,
            is_public: !!targets?.payload?.["trainingSetupPreference"],
          };
        });
    },
    staleTime: 5 * 60 * 1000,
    gcTime: 30 * 60 * 1000,
    retry: shouldRetryRead,
    retryDelay: readRetryDelay,
  });

export const bulkAdminQueryOptions = () =>
  queryOptions({
    queryKey: ["bulk-admin"],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("is_bulk_admin");
      if (error) throw error;
      return data === true;
    },
    staleTime: 5 * 60 * 1000,
    gcTime: 30 * 60 * 1000,
    retry: shouldRetryRead,
    retryDelay: readRetryDelay,
  });

export function useMemberships() {
  return useQuery(bulkOwnerQueryOptions());
}

export function useBulkAdmin() {
  return useQuery(bulkAdminQueryOptions());
}
