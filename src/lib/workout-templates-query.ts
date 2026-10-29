import { queryOptions, useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { developmentErrorDiagnostic, readRetryDelay, shouldRetryRead } from "@/lib/network-errors";
import { QUERY_PAGE_SIZE, readAllByKey } from "./query-pagination";
import type { TrainingPlanExercise } from "@/lib/training-plans";

export type WorkoutSummary = {
  id: string;
  title: string;
  exerciseCount: number;
  createdAt: string;
};
export type PrivateWorkout = {
  id: string;
  title: string;
  updatedAt: string;
  exercises: TrainingPlanExercise[];
};

export const workoutListKey = (userId: string | null, profileId: string | null) =>
  ["workout-templates", userId, profileId] as const;
export const workoutDetailKey = (
  userId: string | null,
  profileId: string | null,
  id: string | null,
) => ["workout-template", userId, profileId, id] as const;

export const myWorkoutsQueryOptions = (userId: string | null, profileId: string | null) =>
  queryOptions({
    queryKey: workoutListKey(userId, profileId),
    enabled: !!userId && !!profileId,
    queryFn: async (): Promise<WorkoutSummary[]> => {
      if (!userId || !profileId) return [];
      const rows = await readAllByKey(
        (cursor) => {
          let query = supabase
            .from("workout_templates")
            .select("id,title,created_at,workout_template_exercises(count)")
            .eq("bulk_profile_id", profileId)
            .eq("is_system", false)
            .eq("visibility", "private")
            .order("id")
            .limit(QUERY_PAGE_SIZE);
          if (cursor) query = query.gt("id", cursor);
          return query;
        },
        (row) => row.id,
      );
      return rows
        .map((row) => ({
          id: row.id,
          title: row.title,
          createdAt: row.created_at,
          exerciseCount: row.workout_template_exercises[0]?.count ?? 0,
        }))
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt) || b.id.localeCompare(a.id));
    },
    staleTime: 30_000,
    retry: shouldRetryRead,
    retryDelay: readRetryDelay,
  });

export const workoutByIdQueryOptions = (
  userId: string | null,
  profileId: string | null,
  id: string | null,
) =>
  queryOptions({
    queryKey: workoutDetailKey(userId, profileId, id),
    enabled: !!userId && !!profileId && !!id,
    queryFn: async (): Promise<PrivateWorkout | null> => {
      if (!userId || !profileId || !id) return null;
      const { data: workout, error } = await supabase
        .from("workout_templates")
        .select("id,title,updated_at")
        .eq("id", id)
        .eq("bulk_profile_id", profileId)
        .eq("is_system", false)
        .eq("visibility", "private")
        .maybeSingle();
      if (error) throw error;
      if (!workout) return null;
      const { data, error: exercisesError } = await supabase
        .from("workout_template_exercises")
        .select(
          "id,exercise_id,source_system_exercise_id,exercise_name,exercise_order,sets,rep_min,rep_max,intended_unilateral_mode,notes,bulk_exercises!workout_template_exercises_exercise_id_fkey(supports_unilateral,is_bodyweight)",
        )
        .eq("workout_template_id", id)
        .order("exercise_order");
      if (exercisesError) throw exercisesError;
      return {
        id: workout.id,
        title: workout.title,
        updatedAt: workout.updated_at,
        exercises: (data ?? []).map((row) => ({
          id: row.id,
          exerciseId: row.exercise_id,
          sourceSystemExerciseId: row.source_system_exercise_id,
          name: row.exercise_name,
          order: row.exercise_order,
          sets: row.sets,
          repMin: row.rep_min,
          repMax: row.rep_max,
          intendedUnilateralMode:
            row.intended_unilateral_mode as TrainingPlanExercise["intendedUnilateralMode"],
          notes: row.notes,
          supportsUnilateral: row.bulk_exercises?.supports_unilateral ?? false,
          isBodyweight: row.bulk_exercises?.is_bodyweight ?? false,
        })),
      };
    },
    staleTime: 0,
    retry: shouldRetryRead,
    retryDelay: readRetryDelay,
  });

export const useMyWorkouts = (user: string | null, profile: string | null) =>
  useQuery(myWorkoutsQueryOptions(user, profile));
export const usePrivateWorkout = (user: string | null, profile: string | null, id: string | null) =>
  useQuery(workoutByIdQueryOptions(user, profile, id));

export async function createWorkout(title: string, requestId: string): Promise<string> {
  const { data, error } = await supabase.rpc("create_workout_template", {
    _title: title.trim(),
    _request_id: requestId,
  });
  if (error) throw error;
  return data;
}

export async function saveWorkout(input: PrivateWorkout): Promise<string> {
  const { data, error } = await supabase.rpc("save_workout_template_exercises", {
    _template: input.id,
    _expected_updated_at: input.updatedAt,
    _title: input.title.trim(),
    _exercises: input.exercises.map((exercise) => ({
      exerciseId: exercise.exerciseId,
      sets: exercise.sets,
      repMin: exercise.repMin,
      repMax: exercise.repMax,
      executionMode: exercise.intendedUnilateralMode,
      notes: exercise.notes?.trim() || null,
    })),
  });
  if (error) {
    developmentErrorDiagnostic("save_workout_template", error);
    throw error;
  }
  return data;
}

export async function duplicateWorkout(id: string, requestId: string): Promise<string> {
  const { data, error } = await supabase.rpc("duplicate_workout_template", {
    _template_id: id,
    _request_id: requestId,
  });
  if (error) throw error;
  return data;
}

export async function deleteWorkout(id: string): Promise<boolean> {
  const { data, error } = await supabase.rpc("delete_workout_template", { _template_id: id });
  if (error) throw error;
  return data;
}
