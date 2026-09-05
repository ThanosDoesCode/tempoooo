import { queryOptions, useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import {
  EXERCISE_LIBRARY_PAGE_SIZE,
  exerciseSlug,
  type ExerciseEquipment,
  type ExerciseExperienceLevel,
  type ExerciseLibraryFilters,
  type LibraryExercise,
  type MuscleGroup,
} from "@/lib/exercise-library";
import { readRetryDelay, shouldRetryRead } from "@/lib/network-errors";

const selectExercise =
  "id,owner_id,slug,name,primary_muscle,secondary_muscles,equipment,movement_pattern,category,supports_unilateral,default_unilateral_mode,is_bodyweight,is_system,active,min_experience,created_at,updated_at";

function searchPattern(value: string) {
  return `%${value.trim().replace(/[\\%_]/g, "\\$&")}%`;
}

function allowedExperience(level: ExerciseExperienceLevel) {
  if (level === "beginner") return ["beginner"];
  if (level === "intermediate") return ["beginner", "intermediate"];
  return ["beginner", "intermediate", "advanced"];
}

export const exerciseLibraryQueryOptions = (filters: ExerciseLibraryFilters = {}, page = 0) =>
  queryOptions({
    queryKey: ["bulk-exercise-library", filters, page],
    queryFn: async () => {
      const from = Math.max(0, page) * EXERCISE_LIBRARY_PAGE_SIZE;
      let query = supabase
        .from("bulk_exercises")
        .select(selectExercise)
        .eq("active", true)
        .order("name")
        .range(from, from + EXERCISE_LIBRARY_PAGE_SIZE);
      if (filters.search?.trim()) query = query.ilike("name", searchPattern(filters.search));
      if (filters.primaryMuscle) query = query.eq("primary_muscle", filters.primaryMuscle);
      if (filters.equipment) query = query.contains("equipment", [filters.equipment]);
      if (filters.unilateralOnly) query = query.eq("supports_unilateral", true);
      if (filters.origin === "system") query = query.eq("is_system", true);
      if (filters.origin === "custom") query = query.eq("is_system", false);
      if (filters.experienceLevel)
        query = query.in("min_experience", allowedExperience(filters.experienceLevel));
      const { data, error } = await query;
      if (error) throw error;
      const rows = (data ?? []) as LibraryExercise[];
      return {
        exercises: rows.slice(0, EXERCISE_LIBRARY_PAGE_SIZE),
        hasMore: rows.length > EXERCISE_LIBRARY_PAGE_SIZE,
      };
    },
    staleTime: 5 * 60 * 1000,
    gcTime: 30 * 60 * 1000,
    retry: shouldRetryRead,
    retryDelay: readRetryDelay,
  });

export function useExerciseLibrary(filters: ExerciseLibraryFilters = {}, page = 0) {
  return useQuery(exerciseLibraryQueryOptions(filters, page));
}

export const systemExerciseQueryOptions = (
  filters: Omit<ExerciseLibraryFilters, "origin"> = {},
  page = 0,
) => exerciseLibraryQueryOptions({ ...filters, origin: "system" }, page);

export const customExerciseQueryOptions = (
  filters: Omit<ExerciseLibraryFilters, "origin"> = {},
  page = 0,
) => exerciseLibraryQueryOptions({ ...filters, origin: "custom" }, page);

export async function fetchLibraryExercise(id: string): Promise<LibraryExercise | null> {
  const { data, error } = await supabase
    .from("bulk_exercises")
    .select(selectExercise)
    .eq("id", id)
    .eq("active", true)
    .maybeSingle();
  if (error) throw error;
  return data as LibraryExercise | null;
}

export type CustomExerciseInput = {
  name: string;
  primaryMuscle: MuscleGroup;
  secondaryMuscles?: MuscleGroup[] | undefined;
  equipment: ExerciseEquipment[];
  supportsUnilateral: boolean;
};

function customExerciseValues(input: CustomExerciseInput) {
  const name = input.name.trim();
  const slug = exerciseSlug(name);
  if (name.length < 2 || name.length > 80 || !slug) throw new Error("invalid_exercise_name");
  const equipment = [...new Set(input.equipment)];
  if (!equipment.length) throw new Error("exercise_equipment_required");
  return {
    name,
    slug,
    primary_muscle: input.primaryMuscle,
    secondary_muscles: [...new Set(input.secondaryMuscles ?? [])].filter(
      (muscle) => muscle !== input.primaryMuscle,
    ),
    equipment,
    supports_unilateral: input.supportsUnilateral,
    is_bodyweight: equipment.includes("bodyweight"),
    category: equipment.includes("bodyweight") ? ("bodyweight" as const) : ("strength" as const),
  };
}

export async function createCustomExercise(input: CustomExerciseInput) {
  const values = customExerciseValues(input);
  const { data, error } = await supabase
    .from("bulk_exercises")
    .insert({
      ...values,
      movement_pattern: "other",
      default_unilateral_mode: "bilateral",
      is_system: false,
    })
    .select(selectExercise)
    .single();
  if (error) throw error;
  return data as LibraryExercise;
}

export async function updateCustomExercise(id: string, input: CustomExerciseInput) {
  if (!id.startsWith("custom:")) throw new Error("invalid_custom_exercise");
  const values = customExerciseValues(input);
  const { data, error } = await supabase
    .from("bulk_exercises")
    .update(values)
    .eq("id", id)
    .eq("is_system", false)
    .select(selectExercise)
    .single();
  if (error) throw error;
  return data as LibraryExercise;
}

export async function deleteCustomExercise(id: string) {
  if (!id.startsWith("custom:")) throw new Error("system_exercise_is_read_only");
  const { error } = await supabase
    .from("bulk_exercises")
    .delete()
    .eq("id", id)
    .eq("is_system", false);
  if (error) throw error;
}
