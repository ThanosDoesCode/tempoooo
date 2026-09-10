import { queryOptions, useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import type { BulkRole } from "./store";
import { readRetryDelay, shouldRetryRead } from "./network-errors";
export {
  accountProductMode,
  activeBulkMemberships,
  preferredBulkMembership,
  type AccountProductMode,
} from "./bulk-mode";
import { activeBulkMemberships } from "./bulk-mode";

export type Membership = {
  bulk_profile_id: string;
  role: BulkRole;
  owner_id: string;
  allow_editor: boolean;
  is_public: boolean;
  is_active: boolean;
};

export const bulkMembershipFor = (
  memberships: Membership[] | undefined,
  bulkProfileId: string | null,
) => memberships?.find((membership) => membership.bulk_profile_id === bulkProfileId);

export type BulkPlanMode = "public" | "legacy" | "none";

export const bulkPlanModeFor = (
  memberships: Membership[] | undefined,
  bulkProfileId: string | null,
): BulkPlanMode => {
  const membership = bulkMembershipFor(memberships, bulkProfileId);
  if (!membership || membership.is_active === false) return "none";
  return membership.is_public ? "public" : "legacy";
};

export const bulkOwnerQueryOptions = () =>
  queryOptions({
    queryKey: ["bulk-memberships"],
    queryFn: async (): Promise<Membership[]> => {
      const { data, error } = await supabase
        .from("bulk_members")
        .select("bulk_profile_id, role, bulk_profiles(owner_id, allow_editor, goal_status)");
      if (error) throw error;
      return (data ?? [])
        .filter((r) => r.role === "owner")
        .map((r) => {
          const profile = r.bulk_profiles as unknown as {
            owner_id: string;
            allow_editor: boolean;
            goal_status: "active" | "inactive" | null;
          } | null;
          return {
            bulk_profile_id: r.bulk_profile_id,
            role: r.role as BulkRole,
            owner_id: profile?.owner_id ?? "",
            allow_editor: profile?.allow_editor ?? false,
            is_public: profile?.goal_status != null,
            is_active: profile?.goal_status !== "inactive",
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

export async function deactivatePublicGoal(): Promise<string> {
  const { data, error } = await supabase.rpc("deactivate_public_goal");
  if (error) throw error;
  return data;
}
