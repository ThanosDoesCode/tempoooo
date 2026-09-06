import { queryOptions, useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { calculateMuscleCoverage, type CoverageExerciseMetadata } from "./bulk-muscle-coverage";
import { readRetryDelay, shouldRetryRead } from "./network-errors";
import type { UserTrainingPlan } from "./training-plans";

export const bulkMuscleCoverageQueryKey = (plan: UserTrainingPlan | null) =>
  ["bulk-muscle-coverage", plan?.id ?? "none", plan?.updatedAt ?? "none"] as const;

export const bulkMuscleCoverageQueryOptions = (plan: UserTrainingPlan | null) =>
  queryOptions({
    queryKey: bulkMuscleCoverageQueryKey(plan),
    enabled: !!plan,
    queryFn: async () => {
      if (!plan) return calculateMuscleCoverage(null, []);
      const ids = [
        ...new Set(
          plan.days.flatMap((day) =>
            day.exercises.map((exercise) => exercise.exerciseId).filter((id): id is string => !!id),
          ),
        ),
      ];
      if (!ids.length) return calculateMuscleCoverage(plan, []);
      const { data, error } = await supabase
        .from("bulk_exercises")
        .select("id,primary_muscle,secondary_muscles,active")
        .in("id", ids);
      if (error) throw error;
      return calculateMuscleCoverage(plan, (data ?? []) as CoverageExerciseMetadata[]);
    },
    staleTime: 5 * 60_000,
    gcTime: 15 * 60_000,
    retry: shouldRetryRead,
    retryDelay: readRetryDelay,
  });

export const useBulkMuscleCoverage = (plan: UserTrainingPlan | null) =>
  useQuery(bulkMuscleCoverageQueryOptions(plan));
