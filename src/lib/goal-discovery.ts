import { queryOptions, useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";

export const goalDiscoveryQueryOptions = () =>
  queryOptions({
    queryKey: ["goal-discovery"],
    queryFn: async () => {
      const { data: auth } = await supabase.auth.getUser();
      if (!auth.user) return null;
      const { data, error } = await supabase
        .from("profiles")
        .select("goal_seen_at")
        .eq("id", auth.user.id)
        .single();
      if (error) throw error;
      return data;
    },
    staleTime: 5 * 60_000,
  });

export function useGoalDiscovery() {
  return useQuery(goalDiscoveryQueryOptions());
}

export function useAcknowledgeGoal() {
  const queryClient = useQueryClient();
  return useCallback(async () => {
    const seenAt = new Date().toISOString();
    const previous = queryClient.getQueryData<{ goal_seen_at: string | null } | null>([
      "goal-discovery",
    ]);
    queryClient.setQueryData(["goal-discovery"], { goal_seen_at: seenAt });
    const { data: auth } = await supabase.auth.getUser();
    if (!auth.user) {
      queryClient.setQueryData(["goal-discovery"], previous);
      throw new Error("Not authenticated");
    }
    const { error } = await supabase
      .from("profiles")
      .update({ goal_seen_at: seenAt })
      .eq("id", auth.user.id);
    if (error) {
      queryClient.setQueryData(["goal-discovery"], previous);
      throw error;
    }
  }, [queryClient]);
}
