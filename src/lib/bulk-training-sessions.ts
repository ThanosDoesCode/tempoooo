import { queryOptions, useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { readRetryDelay, shouldRetryRead } from "./network-errors";
import type {
  BulkTrainingSession,
  BulkTrainingSessionExercise,
  BulkTrainingSet,
  EditableSessionSet,
} from "./bulk-training-session-domain";
export type {
  BulkTrainingSession,
  BulkTrainingSessionExercise,
  BulkTrainingSet,
  EditableSessionSet,
} from "./bulk-training-session-domain";

type SessionRow = {
  id: string;
  bulk_profile_id: string;
  training_plan_id: string | null;
  plan_name_snapshot: string;
  workout_day_name_snapshot: string;
  workout_day_order_snapshot: number;
  status: string;
  started_at: string;
  completed_at: string | null;
  updated_at: string;
};

type ExerciseRow = {
  id: string;
  session_id: string;
  source_plan_exercise_id: string | null;
  source_exercise_id: string | null;
  exercise_name_snapshot: string;
  exercise_order: number;
  execution_mode: string;
  is_bodyweight: boolean;
  target_sets: number;
  target_rep_min: number;
  target_rep_max: number;
  notes_snapshot: string | null;
};

type SetRow = {
  id: string;
  session_exercise_id: string;
  set_order: number;
  is_extra: boolean;
  is_complete: boolean;
  bilateral_weight: number | null;
  bilateral_reps: number | null;
  left_weight: number | null;
  left_reps: number | null;
  right_weight: number | null;
  right_reps: number | null;
};

const numberOrNull = (value: number | null) => (value == null ? null : Number(value));

function mapSessions(
  sessions: SessionRow[],
  exercises: ExerciseRow[],
  sets: SetRow[],
): BulkTrainingSession[] {
  return sessions.map((session) => ({
    id: session.id,
    bulkProfileId: session.bulk_profile_id,
    trainingPlanId: session.training_plan_id,
    planName: session.plan_name_snapshot,
    workoutDayName: session.workout_day_name_snapshot,
    workoutDayOrder: session.workout_day_order_snapshot,
    status: session.status as BulkTrainingSession["status"],
    startedAt: session.started_at,
    completedAt: session.completed_at,
    updatedAt: session.updated_at,
    exercises: exercises
      .filter((exercise) => exercise.session_id === session.id)
      .sort((a, b) => a.exercise_order - b.exercise_order)
      .map((exercise) => ({
        id: exercise.id,
        sourcePlanExerciseId: exercise.source_plan_exercise_id,
        sourceExerciseId: exercise.source_exercise_id,
        name: exercise.exercise_name_snapshot,
        order: exercise.exercise_order,
        executionMode: exercise.execution_mode as BulkTrainingSessionExercise["executionMode"],
        isBodyweight: exercise.is_bodyweight,
        targetSets: exercise.target_sets,
        targetRepMin: exercise.target_rep_min,
        targetRepMax: exercise.target_rep_max,
        notes: exercise.notes_snapshot,
        sets: sets
          .filter((set) => set.session_exercise_id === exercise.id)
          .sort((a, b) => a.set_order - b.set_order)
          .map((set) => ({
            id: set.id,
            order: set.set_order,
            isExtra: set.is_extra,
            isComplete: set.is_complete,
            bilateralWeight: numberOrNull(set.bilateral_weight),
            bilateralReps: set.bilateral_reps,
            leftWeight: numberOrNull(set.left_weight),
            leftReps: set.left_reps,
            rightWeight: numberOrNull(set.right_weight),
            rightReps: set.right_reps,
          })),
      })),
  }));
}

async function hydrateSessions(sessions: SessionRow[]): Promise<BulkTrainingSession[]> {
  if (!sessions.length) return [];
  const sessionIds = sessions.map((session) => session.id);
  const { data: exercises, error: exerciseError } = await supabase
    .from("bulk_training_session_exercises")
    .select("*")
    .in("session_id", sessionIds)
    .order("exercise_order");
  if (exerciseError) throw exerciseError;
  const exerciseIds = (exercises ?? []).map((exercise) => exercise.id);
  const sets = exerciseIds.length
    ? await supabase
        .from("bulk_training_session_sets")
        .select("*")
        .in("session_exercise_id", exerciseIds)
        .order("set_order")
    : { data: [], error: null };
  if (sets.error) throw sets.error;
  return mapSessions(sessions, (exercises ?? []) as ExerciseRow[], (sets.data ?? []) as SetRow[]);
}

export async function fetchRecentCompletedBulkTrainingSessions(bulkProfileId: string, limit = 30) {
  const { data, error } = await supabase
    .from("bulk_training_sessions")
    .select("*")
    .eq("bulk_profile_id", bulkProfileId)
    .eq("status", "completed")
    .order("completed_at", { ascending: false })
    .limit(limit);
  if (error) throw error;
  return hydrateSessions((data ?? []) as SessionRow[]);
}

export const activeBulkTrainingSessionQueryOptions = (bulkProfileId: string | null) =>
  queryOptions({
    queryKey: ["bulk-training-session", "active", bulkProfileId],
    enabled: !!bulkProfileId,
    queryFn: async () => {
      if (!bulkProfileId) return null;
      const { data, error } = await supabase
        .from("bulk_training_sessions")
        .select("*")
        .eq("bulk_profile_id", bulkProfileId)
        .eq("status", "in_progress")
        .maybeSingle();
      if (error) throw error;
      return data ? (await hydrateSessions([data as SessionRow]))[0]! : null;
    },
    staleTime: 0,
    retry: shouldRetryRead,
    retryDelay: readRetryDelay,
  });

export const bulkTrainingSessionQueryOptions = (sessionId: string | null) =>
  queryOptions({
    queryKey: ["bulk-training-session", sessionId],
    enabled: !!sessionId,
    queryFn: async () => {
      if (!sessionId) return null;
      const { data, error } = await supabase
        .from("bulk_training_sessions")
        .select("*")
        .eq("id", sessionId)
        .maybeSingle();
      if (error) throw error;
      return data ? (await hydrateSessions([data as SessionRow]))[0]! : null;
    },
    staleTime: 0,
    retry: shouldRetryRead,
    retryDelay: readRetryDelay,
  });

export const completedBulkTrainingSessionsQueryOptions = (
  bulkProfileId: string | null,
  from: string,
  to: string,
) =>
  queryOptions({
    queryKey: ["bulk-training-sessions", "completed", bulkProfileId, from, to],
    enabled: !!bulkProfileId,
    queryFn: async () => {
      if (!bulkProfileId) return [];
      const { data, error } = await supabase
        .from("bulk_training_sessions")
        .select("*")
        .eq("bulk_profile_id", bulkProfileId)
        .eq("status", "completed")
        .gte("completed_at", from)
        .lt("completed_at", to)
        .order("completed_at", { ascending: false });
      if (error) throw error;
      return hydrateSessions((data ?? []) as SessionRow[]);
    },
    staleTime: 30_000,
    retry: shouldRetryRead,
    retryDelay: readRetryDelay,
  });

export function useActiveBulkTrainingSession(bulkProfileId: string | null) {
  return useQuery(activeBulkTrainingSessionQueryOptions(bulkProfileId));
}

export function useBulkTrainingSession(sessionId: string | null) {
  return useQuery(bulkTrainingSessionQueryOptions(sessionId));
}

export function useCompletedBulkTrainingSessions(
  bulkProfileId: string | null,
  from: string,
  to: string,
) {
  return useQuery(completedBulkTrainingSessionsQueryOptions(bulkProfileId, from, to));
}

export async function startBulkTrainingSession(planDayId: string): Promise<string> {
  const { data, error } = await supabase.rpc("start_bulk_training_session", {
    _plan_day: planDayId,
  });
  if (error) throw error;
  return data;
}

export async function saveBulkTrainingSet(sessionId: string, set: EditableSessionSet) {
  const { error } = await supabase.rpc("save_bulk_training_session_set", {
    _session: sessionId,
    _set: set.id,
    _bilateral_weight: set.bilateralWeight,
    _bilateral_reps: set.bilateralReps,
    _left_weight: set.leftWeight,
    _left_reps: set.leftReps,
    _right_weight: set.rightWeight,
    _right_reps: set.rightReps,
  });
  if (error) throw error;
}

export async function addBulkTrainingSet(sessionId: string, exerciseId: string) {
  const { data, error } = await supabase.rpc("add_bulk_training_session_set", {
    _session: sessionId,
    _exercise: exerciseId,
  });
  if (error) throw error;
  return data;
}

export async function removeBulkTrainingSet(sessionId: string, setId: string) {
  const { error } = await supabase.rpc("remove_bulk_training_session_set", {
    _session: sessionId,
    _set: setId,
  });
  if (error) throw error;
}

export async function finishBulkTrainingSession(sessionId: string, confirmIncomplete: boolean) {
  const { data, error } = await supabase.rpc("finish_bulk_training_session", {
    _session: sessionId,
    _confirm_incomplete: confirmIncomplete,
  });
  if (error) throw error;
  return data;
}

export async function discardBulkTrainingSession(sessionId: string) {
  const { error } = await supabase.rpc("discard_bulk_training_session", {
    _session: sessionId,
  });
  if (error) throw error;
}
