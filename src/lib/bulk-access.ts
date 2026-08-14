import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import type { BulkRole } from "./store";

export type Membership = {
  bulk_profile_id: string;
  role: BulkRole;
  owner_id: string;
  allow_editor: boolean;
};

export function useMemberships() {
  return useQuery({
    queryKey: ["bulk-memberships"],
    queryFn: async (): Promise<Membership[]> => {
      const { data, error } = await supabase
        .from("bulk_members")
        .select("bulk_profile_id, role, bulk_profiles(owner_id, allow_editor)");
      if (error) throw error;
      return (data ?? []).map((r) => ({
        bulk_profile_id: r.bulk_profile_id,
        role: r.role as BulkRole,
        owner_id: (r.bulk_profiles as { owner_id: string } | null)?.owner_id ?? "",
        allow_editor: (r.bulk_profiles as { allow_editor: boolean } | null)?.allow_editor ?? false,
      }));
    },
  });
}

export async function createBulkProfile() {
  const { data, error } = await supabase.rpc("ensure_bulk_profile");
  if (error) throw error;
  return data as string;
}
