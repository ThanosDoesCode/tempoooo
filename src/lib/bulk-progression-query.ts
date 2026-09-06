import { queryOptions, useQuery } from "@tanstack/react-query";
import { readRetryDelay, shouldRetryRead } from "./network-errors";
import { fetchRecentCompletedBulkTrainingSessions } from "./bulk-training-sessions";
import { deriveBulkProgressionTargets, type BulkProgressionTargetInput } from "./bulk-progression";

export const bulkProgressionQueryOptions = (
  bulkProfileId: string | null,
  targets: BulkProgressionTargetInput[],
  version: string,
) =>
  queryOptions({
    queryKey: ["bulk-progression", bulkProfileId, version],
    enabled: !!bulkProfileId && targets.length > 0,
    queryFn: async () => {
      if (!bulkProfileId) return {};
      const sessions = await fetchRecentCompletedBulkTrainingSessions(bulkProfileId, 30);
      return deriveBulkProgressionTargets(targets, sessions);
    },
    staleTime: 0,
    retry: shouldRetryRead,
    retryDelay: readRetryDelay,
  });

export function useBulkProgressionTargets(
  bulkProfileId: string | null,
  targets: BulkProgressionTargetInput[],
  version: string,
) {
  return useQuery(bulkProgressionQueryOptions(bulkProfileId, targets, version));
}
