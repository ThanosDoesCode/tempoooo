import { queryOptions, useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { mondayOf } from "./goal-metrics";
import { readRetryDelay, shouldRetryRead } from "./network-errors";
import { DEFAULT_DATA, type DailyLog, type Targets, type Workout } from "./types";

export const bulkTodayQueryKey = (profileId: string | null, today: string) =>
  ["bulk-today", profileId, today] as const;

type TodayData = {
  targets: Targets;
  days: Record<string, DailyLog>;
  workouts: Record<string, Pick<Workout, "date" | "status" | "type">>;
};

/** Only today's check-in and this week's completion metadata, never historical payloads/photos. */
export const bulkTodayQueryOptions = (profileId: string | null, today: string) =>
  queryOptions({
    queryKey: bulkTodayQueryKey(profileId, today),
    enabled: !!profileId,
    queryFn: async (): Promise<TodayData | null> => {
      if (!profileId) return null;
      const from = mondayOf(today);
      const [targets, day, gymDays, workouts] = await Promise.all([
        supabase
          .from("bulk_targets")
          .select("payload")
          .eq("bulk_profile_id", profileId)
          .maybeSingle(),
        supabase
          .from("bulk_days")
          .select("payload")
          .eq("bulk_profile_id", profileId)
          .eq("day", today)
          .maybeSingle(),
        supabase
          .from("bulk_days")
          .select("day,gym:payload->gym")
          .eq("bulk_profile_id", profileId)
          .gte("day", from)
          .lte("day", today)
          .order("day")
          .limit(7),
        supabase
          .from("bulk_workouts")
          .select("day,date:payload->>date,status:payload->>status,type:payload->>type")
          .eq("bulk_profile_id", profileId)
          .gte("day", from)
          .lte("day", today)
          .order("day")
          .limit(7),
      ]);
      for (const result of [targets, day, gymDays, workouts]) if (result.error) throw result.error;
      const days: TodayData["days"] = {};
      for (const row of gymDays.data ?? [])
        days[row.day] = { date: row.day, gym: Boolean(row.gym) };
      if (day.data) days[today] = { ...(day.data.payload as DailyLog), date: today };
      return {
        targets: {
          ...DEFAULT_DATA.targets,
          ...((targets.data?.payload ?? {}) as Partial<Targets>),
        },
        days,
        workouts: Object.fromEntries(
          (workouts.data ?? []).map((row) => [
            row.day,
            {
              date: row.date || row.day,
              status: row.status as Workout["status"],
              type: row.type as Workout["type"],
            },
          ]),
        ),
      };
    },
    // Re-entering Today after legacy edits must read confirmed data, not an old snapshot.
    staleTime: 0,
    retry: shouldRetryRead,
    retryDelay: readRetryDelay,
  });

export const useBulkToday = (profileId: string | null, today: string) =>
  useQuery(bulkTodayQueryOptions(profileId, today));
