import { queryOptions, useQuery, type QueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { developmentErrorDiagnostic, readRetryDelay, shouldRetryRead } from "@/lib/network-errors";
import {
  comparePlanned,
  plannedStatus,
  type PlannedActivity,
  type PlannedActivityType,
  type WorkoutSource,
} from "./planner";

// The ONE canonical Planner read model. Agenda, Calendar, the detail sheet and Today all map rows
// through `toPlanned`; only the bounds differ. Linked history is embedded as status/raw values only.
export const PLANNER_COLUMNS =
  "id,activity_type,planned_date,planned_time,workout_source_type,training_plan_day_id,workout_template_id,workout_name_snapshot,exercise_count_snapshot,planned_distance_km,planned_duration_seconds,note,workout_session_id,challenge_activity_id,updated_at,bulk_training_sessions(status),challenge_activities(distance_km,duration_seconds)";

/** Today shows at most this many unresolved upcoming items; the server applies the same cap. */
export const TODAY_UPCOMING_LIMIT = 3;
/** The Planner route's own (larger, still bounded) range read. */
export const PLANNER_RANGE_LIMIT = 500;

type PlannerRow = {
  id: string;
  activity_type: string;
  planned_date: string;
  planned_time: string | null;
  workout_source_type: string | null;
  training_plan_day_id: string | null;
  workout_template_id: string | null;
  workout_name_snapshot: string | null;
  exercise_count_snapshot: number | null;
  planned_distance_km: number | string | null;
  planned_duration_seconds: number | null;
  note: string | null;
  workout_session_id: string | null;
  challenge_activity_id: string | null;
  updated_at: string;
  bulk_training_sessions: { status: string } | null;
  challenge_activities: { distance_km: number | string; duration_seconds: number | null } | null;
};

const num = (value: number | string | null | undefined) => (value == null ? null : Number(value));

export function toPlanned(row: PlannerRow): PlannedActivity {
  const session = row.bulk_training_sessions;
  const activity = row.challenge_activities;
  return {
    id: row.id,
    type: row.activity_type as PlannedActivityType,
    date: row.planned_date,
    time: row.planned_time ? row.planned_time.slice(0, 5) : null,
    source: (row.workout_source_type as WorkoutSource | null) ?? null,
    planDayId: row.training_plan_day_id,
    templateId: row.workout_template_id,
    workoutName: row.workout_name_snapshot,
    exerciseCount: row.exercise_count_snapshot,
    distanceKm: num(row.planned_distance_km),
    durationSeconds: row.planned_duration_seconds,
    note: row.note,
    // A link whose history row is gone (or unreadable) is treated as unlinked: never fake completion.
    sessionId: session ? row.workout_session_id : null,
    sessionStatus:
      session?.status === "completed" || session?.status === "in_progress" ? session.status : null,
    challengeActivityId: activity ? row.challenge_activity_id : null,
    loggedDistanceKm: activity ? num(activity.distance_km) : null,
    loggedDurationSeconds: activity?.duration_seconds ?? null,
    updatedAt: row.updated_at,
  };
}

export const plannerKey = (profileId: string | null) => ["planned-activities", profileId] as const;

/** Inclusive local-date range, shared by Agenda and Calendar. */
export const plannerRangeQueryOptions = (profileId: string | null, from: string, to: string) =>
  queryOptions({
    queryKey: [...plannerKey(profileId), "range", from, to],
    enabled: !!profileId,
    queryFn: async (): Promise<PlannedActivity[]> => {
      if (!profileId) return [];
      const { data, error } = await supabase
        .from("planned_activities")
        .select(PLANNER_COLUMNS)
        .eq("bulk_profile_id", profileId)
        .gte("planned_date", from)
        .lte("planned_date", to)
        .order("planned_date")
        .order("planned_time", { nullsFirst: false })
        .order("id")
        .limit(PLANNER_RANGE_LIMIT);
      if (error) {
        developmentErrorDiagnostic("planner_range", error);
        throw error;
      }
      return (data as unknown as PlannerRow[]).map(toPlanned).sort(comparePlanned);
    },
    staleTime: 30_000,
    retry: shouldRetryRead,
    retryDelay: readRetryDelay,
  });

export const plannedItemQueryOptions = (profileId: string | null, id: string | null) =>
  queryOptions({
    queryKey: [...plannerKey(profileId), "item", id],
    enabled: !!profileId && !!id,
    queryFn: async (): Promise<PlannedActivity | null> => {
      if (!profileId || !id) return null;
      const { data, error } = await supabase
        .from("planned_activities")
        .select(PLANNER_COLUMNS)
        .eq("bulk_profile_id", profileId)
        .eq("id", id)
        .maybeSingle();
      if (error) {
        developmentErrorDiagnostic("planner_item", error);
        throw error;
      }
      return data ? toPlanned(data as unknown as PlannerRow) : null;
    },
    staleTime: 30_000,
    retry: shouldRetryRead,
    retryDelay: readRetryDelay,
  });

/**
 * Today's ONE bounded Planner read. The server excludes completed rows BEFORE applying the limit
 * (planner_upcoming), so completed items can never hide later planned ones. No exercise detail,
 * no month, no history.
 */
export const plannerUpcomingQueryOptions = (profileId: string | null, today: string) =>
  queryOptions({
    queryKey: [...plannerKey(profileId), "upcoming", today],
    enabled: !!profileId,
    queryFn: async (): Promise<PlannedActivity[]> => {
      if (!profileId) return [];
      const { data, error } = await supabase
        .rpc("planner_upcoming", {
          _profile: profileId,
          _from: today,
          _limit: TODAY_UPCOMING_LIMIT,
        })
        .select(PLANNER_COLUMNS);
      if (error) {
        developmentErrorDiagnostic("planner_upcoming", error);
        throw error;
      }
      return (data as unknown as PlannerRow[])
        .map(toPlanned)
        .filter((item) => plannedStatus(item) !== "completed")
        .sort(comparePlanned)
        .slice(0, TODAY_UPCOMING_LIMIT);
    },
    staleTime: 60_000,
    retry: shouldRetryRead,
    retryDelay: readRetryDelay,
  });

export const usePlannerRange = (profileId: string | null, from: string, to: string) =>
  useQuery(plannerRangeQueryOptions(profileId, from, to));
export const usePlannedItem = (profileId: string | null, id: string | null) =>
  useQuery(plannedItemQueryOptions(profileId, id));
export const usePlannerUpcoming = (profileId: string | null, today: string) =>
  useQuery(plannerUpcomingQueryOptions(profileId, today));

// ---------------------------------------------------------------- writes (RPC only)

export type PlannedInput = {
  type: PlannedActivityType;
  date: string;
  time: string | null;
  source: WorkoutSource | null;
  planDayId: string | null;
  templateId: string | null;
  distanceKm: number | null;
  durationSeconds: number | null;
  note: string | null;
};

const fieldArgs = (input: PlannedInput) => ({
  _planned_time: input.time,
  _workout_source_type: input.type === "workout" ? input.source : null,
  _training_plan_day_id: input.type === "workout" ? input.planDayId : null,
  _workout_template_id: input.type === "workout" ? input.templateId : null,
  _distance_km: input.type === "workout" ? null : input.distanceKm,
  _duration_seconds: input.type === "workout" ? null : input.durationSeconds,
  _note: input.note,
});

function fail(phase: string, error: unknown): never {
  developmentErrorDiagnostic(phase, error);
  throw error;
}

export async function createPlannedActivity(input: PlannedInput, requestId: string) {
  const { data, error } = await supabase.rpc("create_planned_activity", {
    _request_id: requestId,
    _activity_type: input.type,
    _planned_date: input.date,
    ...fieldArgs(input),
  });
  if (error) fail("planner_create", error);
  return data as string;
}

export async function updatePlannedActivity(
  id: string,
  expectedUpdatedAt: string,
  input: PlannedInput,
) {
  const { data, error } = await supabase.rpc("update_planned_activity", {
    _id: id,
    _expected_updated_at: expectedUpdatedAt,
    _planned_date: input.date,
    ...fieldArgs(input),
  });
  if (error) fail("planner_update", error);
  return data as string;
}

export async function reschedulePlannedActivity(id: string, date: string, time: string | null) {
  const { error } = await supabase.rpc("reschedule_planned_activity", {
    _id: id,
    _planned_date: date,
    _planned_time: time,
  });
  if (error) fail("planner_reschedule", error);
}

export async function deletePlannedActivity(id: string) {
  const { data, error } = await supabase.rpc("delete_planned_activity", { _id: id });
  if (error) fail("planner_delete", error);
  return data as boolean;
}

/** After the EXISTING start RPC: links only a same-day, same-plan-day session (false otherwise). */
export async function linkPlannedSession(id: string, sessionId: string) {
  const { data, error } = await supabase.rpc("link_planned_activity_session", {
    _id: id,
    _session: sessionId,
  });
  if (error) fail("planner_link_session", error);
  return data as boolean;
}

/** After a SUCCESSFUL Challenge save only. */
export async function linkPlannedChallengeActivity(id: string, activityId: string) {
  const { data, error } = await supabase.rpc("link_planned_activity_challenge_activity", {
    _id: id,
    _activity: activityId,
  });
  if (error) fail("planner_link_activity", error);
  return data as boolean;
}

export const invalidatePlanner = (client: QueryClient) =>
  client.invalidateQueries({ queryKey: ["planned-activities"] });
