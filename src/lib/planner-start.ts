import { useRef, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import {
  startBulkTrainingSession,
  useActiveBulkTrainingSession,
} from "@/lib/bulk-training-sessions";
import { developmentErrorDiagnostic, userFacingError } from "@/lib/network-errors";
import type { PlannedActivity } from "@/lib/planner";
import { invalidatePlanner, linkPlannedSession } from "@/lib/planner-query";

/**
 * Start a planned current-plan workout through the EXISTING start path (or resume the active
 * session, which never creates a duplicate). The planner link is attempted afterwards and only
 * succeeds for a same-day, same-plan-day session; it never blocks the workout itself.
 */
export function usePlannedWorkoutStart(profileId: string | null) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const activeSession = useActiveBulkTrainingSession(profileId);
  const starting = useRef(false);
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  async function start(item: PlannedActivity) {
    if (starting.current || !item.planDayId || activeSession.isLoading || activeSession.error)
      return;
    starting.current = true;
    setPendingId(item.id);
    setError(null);
    try {
      const sessionId =
        item.sessionId && item.sessionStatus === "in_progress"
          ? item.sessionId
          : (activeSession.data?.id ?? (await startBulkTrainingSession(item.planDayId)));
      if (!item.sessionId) {
        try {
          await linkPlannedSession(item.id, sessionId);
        } catch (linkError) {
          developmentErrorDiagnostic("planner_start_link", linkError);
        }
      }
      await queryClient.invalidateQueries({ queryKey: ["bulk-training-session"] });
      void invalidatePlanner(queryClient);
      await navigate({ to: "/bulk/workout/$sessionId", params: { sessionId } });
    } catch (startError) {
      setError(userFacingError(startError, "start your workout"));
    } finally {
      starting.current = false;
      setPendingId(null);
    }
  }
  return { start, pendingId, error, activeSession: activeSession.data ?? null };
}

export type PlannedWorkoutStart = ReturnType<typeof usePlannedWorkoutStart>;
