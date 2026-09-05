import { queryOptions, useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { readRetryDelay, shouldRetryRead } from "@/lib/network-errors";
import type {
  TrainingPlanDay,
  TrainingPlanExercise,
  TrainingPlanTemplate,
  UserTrainingPlan,
} from "@/lib/training-plans";

type ExerciseRow = {
  id: string;
  exercise_id: string | null;
  source_system_exercise_id?: string | null;
  exercise_order: number;
  sets: number;
  rep_min: number;
  rep_max: number;
  intended_unilateral_mode: "bilateral" | "unilateral";
  notes: string | null;
  exercise_name?: string;
  bulk_exercises?: { name: string } | null;
};

function mapExercise(row: ExerciseRow): TrainingPlanExercise {
  return {
    id: row.id,
    exerciseId: row.exercise_id,
    sourceSystemExerciseId: row.source_system_exercise_id ?? row.exercise_id,
    name: row.exercise_name ?? row.bulk_exercises?.name ?? "Exercise",
    order: row.exercise_order,
    sets: row.sets,
    repMin: row.rep_min,
    repMax: row.rep_max,
    intendedUnilateralMode: row.intended_unilateral_mode,
    notes: row.notes,
  };
}

export const trainingPlanTemplatesQueryOptions = () =>
  queryOptions({
    queryKey: ["bulk-training-plan-templates"],
    queryFn: async (): Promise<TrainingPlanTemplate[]> => {
      const [templates, days, exercises] = await Promise.all([
        supabase
          .from("bulk_training_plan_templates")
          .select(
            "id,slug,name,description,experience_level,training_days_per_week,required_equipment,split_summary",
          )
          .eq("active", true)
          .order("experience_level")
          .order("training_days_per_week"),
        supabase
          .from("bulk_training_plan_template_days")
          .select("id,template_id,day_order,name")
          .order("day_order"),
        supabase
          .from("bulk_training_plan_template_exercises")
          .select(
            "id,template_day_id,exercise_id,exercise_order,sets,rep_min,rep_max,intended_unilateral_mode,notes,bulk_exercises(name)",
          )
          .order("exercise_order"),
      ]);
      const error = templates.error ?? days.error ?? exercises.error;
      if (error) throw error;
      const exerciseRows = (exercises.data ?? []) as (ExerciseRow & { template_day_id: string })[];
      return (templates.data ?? []).map((template) => ({
        id: template.id,
        slug: template.slug,
        name: template.name,
        description: template.description,
        experienceLevel: template.experience_level as TrainingPlanTemplate["experienceLevel"],
        trainingDaysPerWeek: template.training_days_per_week,
        requiredEquipment: template.required_equipment as TrainingPlanTemplate["requiredEquipment"],
        splitSummary: template.split_summary,
        days: (days.data ?? [])
          .filter((day) => day.template_id === template.id)
          .map((day): TrainingPlanDay => ({
            id: day.id,
            order: day.day_order,
            name: day.name,
            exercises: exerciseRows
              .filter((exercise) => exercise.template_day_id === day.id)
              .map(mapExercise),
          })),
      }));
    },
    staleTime: 10 * 60 * 1000,
    retry: shouldRetryRead,
    retryDelay: readRetryDelay,
  });

export const activeTrainingPlanQueryOptions = (bulkProfileId: string | null) =>
  queryOptions({
    queryKey: ["bulk-training-plan", bulkProfileId],
    enabled: !!bulkProfileId,
    queryFn: async (): Promise<UserTrainingPlan | null> => {
      if (!bulkProfileId) return null;
      const { data: plan, error } = await supabase
        .from("bulk_training_plans")
        .select(
          "id,source_template_id,plan_type,name,description,experience_level,training_days_per_week",
        )
        .eq("bulk_profile_id", bulkProfileId)
        .eq("active", true)
        .maybeSingle();
      if (error) throw error;
      if (!plan) return null;
      const { data: days, error: daysError } = await supabase
        .from("bulk_training_plan_days")
        .select(
          "id,day_order,name,bulk_training_plan_exercises(id,exercise_id,source_system_exercise_id,exercise_name,exercise_order,sets,rep_min,rep_max,intended_unilateral_mode,notes)",
        )
        .eq("plan_id", plan.id)
        .order("day_order");
      if (daysError) throw daysError;
      return {
        id: plan.id,
        sourceTemplateId: plan.source_template_id,
        planType: plan.plan_type as UserTrainingPlan["planType"],
        name: plan.name,
        description: plan.description,
        experienceLevel: plan.experience_level as UserTrainingPlan["experienceLevel"],
        trainingDaysPerWeek: plan.training_days_per_week,
        days: (days ?? []).map((day) => ({
          id: day.id,
          order: day.day_order,
          name: day.name,
          exercises: ((day.bulk_training_plan_exercises ?? []) as ExerciseRow[])
            .sort((a, b) => a.exercise_order - b.exercise_order)
            .map(mapExercise),
        })),
      };
    },
    staleTime: 60 * 1000,
    retry: shouldRetryRead,
    retryDelay: readRetryDelay,
  });

export function useTrainingPlanTemplates() {
  return useQuery(trainingPlanTemplatesQueryOptions());
}

export function useActiveTrainingPlan(bulkProfileId: string | null) {
  return useQuery(activeTrainingPlanQueryOptions(bulkProfileId));
}

export async function instantiateTrainingPlan(
  templateId: string,
  planType: "generated" | "tempo_preset",
): Promise<string> {
  const { data, error } = await supabase.rpc("instantiate_bulk_training_plan", {
    _template_id: templateId,
    _plan_type: planType,
  });
  if (error) throw error;
  return data;
}

export async function createEmptyTrainingPlan(name: string): Promise<string> {
  const { data, error } = await supabase.rpc("create_empty_bulk_training_plan", {
    _name: name,
  });
  if (error) throw error;
  return data;
}
