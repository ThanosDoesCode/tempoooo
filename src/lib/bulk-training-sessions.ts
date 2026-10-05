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
  workout_date: string;
  bodyweight_kg: number | null;
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
  set_type?: string;
  rpe?: number | null;
  bilateral_weight: number | null;
  bilateral_reps: number | null;
  left_weight: number | null;
  left_reps: number | null;
  right_weight: number | null;
  right_reps: number | null;
};

const numberOrNull = (value: number | null) => (value == null ? null : Number(value));

const HISTORY_READ_PAGE_SIZE = 200;

/** Immutable IDs provide a stable cursor; never accept a truncated history as complete. */
async function readAllById<Row extends { id: string }>(
  page: (cursor: string | null) => PromiseLike<{ data: Row[] | null; error: unknown }>,
) {
  const rows: Row[] = [];
  let cursor: string | null = null;
  while (true) {
    const result = await page(cursor);
    if (result.error) throw result.error;
    const batch = result.data ?? [];
    rows.push(...batch);
    if (batch.length < HISTORY_READ_PAGE_SIZE) return rows;
    const next = batch[batch.length - 1]!.id;
    if (cursor && next <= cursor) throw new Error("Workout history cursor did not advance");
    cursor = next;
  }
}

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
    workoutDate: session.workout_date,
    bodyweightKg: numberOrNull(session.bodyweight_kg),
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
            setType: (set.set_type ?? "normal") as BulkTrainingSet["setType"],
            rpe: numberOrNull(set.rpe ?? null),
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
  const result: BulkTrainingSession[] = [];
  // Bound IN lists as well as response sizes, including large completed histories.
  for (let offset = 0; offset < sessions.length; offset += 20) {
    const batch = sessions.slice(offset, offset + 20);
    const exercises = await readAllById<ExerciseRow>((cursor) => {
      let query = supabase
        .from("bulk_training_session_exercises")
        .select("*")
        .in(
          "session_id",
          batch.map((session) => session.id),
        )
        .order("id")
        .limit(HISTORY_READ_PAGE_SIZE);
      if (cursor) query = query.gt("id", cursor);
      return query;
    });
    const sets: SetRow[] = [];
    for (let offset = 0; offset < exercises.length; offset += 50) {
      const ids = exercises.slice(offset, offset + 50).map((exercise) => exercise.id);
      sets.push(
        ...(await readAllById<SetRow>((cursor) => {
          let query = supabase
            .from("bulk_training_session_sets")
            .select("*")
            .in("session_exercise_id", ids)
            .order("id")
            .limit(HISTORY_READ_PAGE_SIZE);
          if (cursor) query = query.gt("id", cursor);
          return query;
        })),
      );
    }
    result.push(...mapSessions(batch, exercises, sets));
  }
  return result;
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
      const data = await readAllById<SessionRow>((cursor) => {
        let query = supabase
          .from("bulk_training_sessions")
          .select("*")
          .eq("bulk_profile_id", bulkProfileId)
          .eq("status", "completed")
          .gte("completed_at", from)
          .lt("completed_at", to)
          .order("id")
          .limit(HISTORY_READ_PAGE_SIZE);
        if (cursor) query = query.gt("id", cursor);
        return query;
      });
      data.sort(
        (a, b) => b.completed_at!.localeCompare(a.completed_at!) || b.id.localeCompare(a.id),
      );
      return hydrateSessions(data);
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

/** Completed sessions by persisted workout_date (inclusive local dates). Lightweight: no sets. */
export const completedSessionDatesQueryOptions = (
  bulkProfileId: string | null,
  fromDate: string,
  toDate: string,
) =>
  queryOptions({
    queryKey: ["bulk-training-sessions", "completed-dates", bulkProfileId, fromDate, toDate],
    enabled: !!bulkProfileId,
    queryFn: async () => {
      if (!bulkProfileId) return [];
      const data = await readAllById<{
        id: string;
        status: string;
        workout_date: string;
        source_plan_day_id: string | null;
      }>((cursor) => {
        let query = supabase
          .from("bulk_training_sessions")
          .select("id, status, workout_date, source_plan_day_id")
          .eq("bulk_profile_id", bulkProfileId)
          .eq("status", "completed")
          .gte("workout_date", fromDate)
          .lte("workout_date", toDate)
          .order("id")
          .limit(HISTORY_READ_PAGE_SIZE);
        if (cursor) query = query.gt("id", cursor);
        return query;
      });
      return data.map((row) => ({
        id: row.id,
        status: row.status,
        workoutDate: row.workout_date,
        planDayId: (row as { source_plan_day_id?: string | null }).source_plan_day_id ?? null,
      }));
    },
    staleTime: 30_000,
    retry: shouldRetryRead,
    retryDelay: readRetryDelay,
  });

export function useCompletedSessionDates(
  bulkProfileId: string | null,
  fromDate: string,
  toDate: string,
) {
  return useQuery(completedSessionDatesQueryOptions(bulkProfileId, fromDate, toDate));
}

export async function startBulkTrainingSession(planDayId: string): Promise<string> {
  const now = new Date();
  const workoutDate = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
  const { data, error } = await supabase.rpc(
    "start_bulk_training_session_for_date" as never,
    {
      _plan_day: planDayId,
      _workout_date: workoutDate,
    } as never,
  );
  if (error) throw error;
  return data as string;
}

export async function refreshActiveBulkTrainingBodyweight(profileId: string) {
  const { error } = await supabase.rpc(
    "refresh_active_bulk_training_bodyweight" as never,
    {
      _profile: profileId,
    } as never,
  );
  if (error) throw error;
}

export async function saveBulkTrainingSet(sessionId: string, set: EditableSessionSet) {
  const { error } = await supabase.rpc(
    "save_bulk_training_session_set_details" as never,
    {
      _session: sessionId,
      _set: set.id,
      _bilateral_weight: set.bilateralWeight,
      _bilateral_reps: set.bilateralReps,
      _left_weight: set.leftWeight,
      _left_reps: set.leftReps,
      _right_weight: set.rightWeight,
      _right_reps: set.rightReps,
      _set_type: set.setType,
      _rpe: set.rpe,
    } as never,
  );
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

export async function deleteCompletedBulkTrainingSession(sessionId: string) {
  const { data, error } = await supabase.rpc(
    "delete_completed_bulk_training_session" as never,
    { _session: sessionId } as never,
  );
  if (error) throw error;
  if (!data) throw new Error("Completed workout not found");
}

export async function deleteLegacyBulkWorkout(day: string) {
  const { data, error } = await supabase.rpc(
    "delete_legacy_bulk_workout" as never,
    {
      _day: day,
    } as never,
  );
  if (error) throw error;
  if (!data) throw new Error("Historical workout not found");
}

export async function correctCompletedBulkTrainingSet(sessionId: string, set: EditableSessionSet) {
  const { error } = await supabase.rpc(
    "correct_completed_bulk_training_set" as never,
    {
      _session: sessionId,
      _set: set.id,
      _bilateral_weight: set.bilateralWeight,
      _bilateral_reps: set.bilateralReps,
      _left_weight: set.leftWeight,
      _left_reps: set.leftReps,
      _right_weight: set.rightWeight,
      _right_reps: set.rightReps,
      _set_type: set.setType,
      _rpe: set.rpe,
    } as never,
  );
  if (error) throw error;
}

export async function correctCompletedBulkTrainingTime(
  sessionId: string,
  date: string,
  start: string,
  end: string,
) {
  const { error } = await supabase.rpc(
    "correct_completed_bulk_training_time" as never,
    {
      _session: sessionId,
      _workout_date: date,
      _started_at: new Date(start).toISOString(),
      _completed_at: new Date(end).toISOString(),
      _timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    } as never,
  );
  if (error) throw error;
}

export async function repeatCompletedBulkTrainingSession(
  sessionId: string,
  date: string,
): Promise<string> {
  const { data, error } = await supabase.rpc(
    "repeat_completed_bulk_training_session" as never,
    {
      _session: sessionId,
      _workout_date: date,
    } as never,
  );
  if (error) throw error;
  return data as string;
}

/** Refresh every existing history/PR/progression/Strength consumer after corrections/deletion. */
export const workoutHistoryInvalidationKeys = [
  ["bulk-training-session"],
  ["bulk-training-sessions"],
  ["bulk-personal-records"],
  ["bulk-progression"],
  ["bulk-progress-summary"],
  ["goal-settings-dashboard"],
];

export async function correctLegacyBulkWorkoutTime(
  day: string,
  date: string,
  start: string,
  end: string,
) {
  const { error } = await supabase.rpc(
    "correct_legacy_bulk_workout_time" as never,
    {
      _day: day,
      _workout_date: date,
      _started_at: new Date(start).toISOString(),
      _completed_at: new Date(end).toISOString(),
      _timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    } as never,
  );
  if (error) throw error;
}
export async function repeatLegacyBulkWorkout(day: string, date: string): Promise<string> {
  const { data, error } = await supabase.rpc(
    "repeat_legacy_bulk_workout" as never,
    { _day: day, _workout_date: date } as never,
  );
  if (error) throw error;
  return data as string;
}
