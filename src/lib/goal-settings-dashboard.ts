import { queryOptions, useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { readRetryDelay, shouldRetryRead } from "./network-errors";

export const goalSettingsDashboardQueryOptions = (profileId: string | null) =>
  queryOptions({
    queryKey: ["goal-settings-dashboard", profileId],
    enabled: !!profileId,
    queryFn: async () => {
      if (!profileId) return null;
      const [profile, notes] = await Promise.all([
        supabase.from("bulk_profiles").select("created_at").eq("id", profileId).single(),
        supabase
          .from("bulk_week_notes")
          .select("week_start")
          .eq("bulk_profile_id", profileId)
          .order("week_start"),
      ]);
      if (profile.error) throw profile.error;
      if (notes.error) throw notes.error;
      return {
        goalStartedAt: profile.data.created_at,
        completedWeekStarts: (notes.data ?? []).map((row) => row.week_start),
      };
    },
    staleTime: 0,
    retry: shouldRetryRead,
    retryDelay: readRetryDelay,
  });

export const useGoalSettingsDashboard = (profileId: string | null) =>
  useQuery(goalSettingsDashboardQueryOptions(profileId));
