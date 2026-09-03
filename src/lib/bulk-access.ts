import { queryOptions, useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import type { BulkRole } from "./store";
import { readRetryDelay, shouldRetryRead } from "./network-errors";

export type Membership = {
  bulk_profile_id: string;
  role: BulkRole;
  owner_id: string;
  allow_editor: boolean;
};

export const bulkOwnerQueryOptions = () =>
  queryOptions({
    queryKey: ["bulk-memberships"],
    queryFn: async (): Promise<Membership[]> => {
      const { data, error } = await supabase
        .from("bulk_members")
        .select("bulk_profile_id, role, bulk_profiles(owner_id, allow_editor)");
      if (error) throw error;
      return (data ?? [])
        .filter((r) => r.role === "owner")
        .map((r) => ({
          bulk_profile_id: r.bulk_profile_id,
          role: r.role as BulkRole,
          owner_id: (r.bulk_profiles as { owner_id: string } | null)?.owner_id ?? "",
          allow_editor:
            (r.bulk_profiles as { allow_editor: boolean } | null)?.allow_editor ?? false,
        }));
    },
    staleTime: 5 * 60 * 1000,
    gcTime: 30 * 60 * 1000,
    retry: shouldRetryRead,
    retryDelay: readRetryDelay,
  });

export function useMemberships() {
  return useQuery(bulkOwnerQueryOptions());
}
