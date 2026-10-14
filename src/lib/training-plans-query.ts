import { queryOptions, useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { developmentErrorDiagnostic, readRetryDelay, shouldRetryRead } from "@/lib/network-errors";
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
  bulk_exercises?: {
    name?: string;
    supports_unilateral?: boolean;
    is_bodyweight?: boolean;
  } | null;
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
    supportsUnilateral: row.bulk_exercises?.supports_unilateral ?? false,
    isBodyweight: row.bulk_exercises?.is_bodyweight ?? false,
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
            "id,template_day_id,exercise_id,exercise_order,sets,rep_min,rep_max,intended_unilateral_mode,notes,bulk_exercises(name,supports_unilateral,is_bodyweight)",
          )
          .order("exercise_order"),
      ]);
      const error = templates.error ?? days.error ?? exercises.error;
      if (error) {
        developmentErrorDiagnostic("training_plan_templates", error);
        throw error;
      }
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

const PLAN_COLUMNS =
  "id,source_template_id,plan_type,name,description,experience_level,training_days_per_week,updated_at,created_at";

type PlanRow = {
  id: string;
  source_template_id: string | null;
  plan_type: string;
  name: string;
  description: string;
  experience_level: string | null;
  training_days_per_week: number;
  updated_at: string;
  created_at: string;
};

async function loadFullPlan(plan: PlanRow): Promise<UserTrainingPlan> {
  const { data: days, error: daysError } = await supabase
    .from("bulk_training_plan_days")
    .select(
      "id,day_order,name,bulk_training_plan_exercises(id,exercise_id,source_system_exercise_id,exercise_name,exercise_order,sets,rep_min,rep_max,intended_unilateral_mode,notes,bulk_exercises!bulk_training_plan_exercises_exercise_id_fkey(supports_unilateral,is_bodyweight))",
    )
    .eq("plan_id", plan.id)
    .order("day_order");
  if (daysError) {
    developmentErrorDiagnostic("active_training_plan_days", daysError);
    throw daysError;
  }
  return {
    id: plan.id,
    sourceTemplateId: plan.source_template_id,
    planType: plan.plan_type as UserTrainingPlan["planType"],
    name: plan.name,
    description: plan.description,
    experienceLevel: plan.experience_level as UserTrainingPlan["experienceLevel"],
    trainingDaysPerWeek: plan.training_days_per_week,
    updatedAt: plan.updated_at,
    createdAt: plan.created_at,
    days: (days ?? []).map((day) => ({
      id: day.id,
      order: day.day_order,
      name: day.name,
      exercises: ((day.bulk_training_plan_exercises ?? []) as ExerciseRow[])
        .sort((a, b) => a.exercise_order - b.exercise_order)
        .map(mapExercise),
    })),
  };
}

export type TrainingPlanSummary = {
  id: string;
  name: string;
  planType: UserTrainingPlan["planType"];
  dayCount: number;
  active: boolean;
  createdAt: string;
};

/** Active plan first, then remaining plans newest first. */
export function sortTrainingPlanSummaries(plans: TrainingPlanSummary[]): TrainingPlanSummary[] {
  return [...plans].sort(
    (a, b) => Number(b.active) - Number(a.active) || b.createdAt.localeCompare(a.createdAt),
  );
}

export const activeTrainingPlanQueryOptions = (bulkProfileId: string | null) =>
  queryOptions({
    queryKey: ["bulk-training-plan", bulkProfileId],
    enabled: !!bulkProfileId,
    queryFn: async (): Promise<UserTrainingPlan | null> => {
      if (!bulkProfileId) return null;
      const { data: plan, error } = await supabase
        .from("bulk_training_plans")
        .select(PLAN_COLUMNS)
        .eq("bulk_profile_id", bulkProfileId)
        .eq("active", true)
        .maybeSingle();
      if (error) {
        developmentErrorDiagnostic("active_training_plan", error);
        throw error;
      }
      if (!plan) return null;
      return loadFullPlan(plan as PlanRow);
    },
    staleTime: 60 * 1000,
    retry: shouldRetryRead,
    retryDelay: readRetryDelay,
  });

export const trainingPlansQueryOptions = (bulkProfileId: string | null) =>
  queryOptions({
    queryKey: ["bulk-training-plans", bulkProfileId],
    enabled: !!bulkProfileId,
    queryFn: async (): Promise<TrainingPlanSummary[]> => {
      if (!bulkProfileId) return [];
      const { data, error } = await supabase
        .from("bulk_training_plans")
        .select("id,name,plan_type,active,created_at,bulk_training_plan_days(count)")
        .eq("bulk_profile_id", bulkProfileId);
      if (error) {
        developmentErrorDiagnostic("training_plans", error);
        throw error;
      }
      return sortTrainingPlanSummaries(
        (data ?? []).map((plan) => ({
          id: plan.id,
          name: plan.name,
          planType: plan.plan_type as UserTrainingPlan["planType"],
          dayCount: (plan.bulk_training_plan_days as { count: number }[])?.[0]?.count ?? 0,
          active: plan.active,
          createdAt: plan.created_at,
        })),
      );
    },
    staleTime: 60 * 1000,
    retry: shouldRetryRead,
    retryDelay: readRetryDelay,
  });

export const trainingPlanByIdQueryOptions = (planId: string | null) =>
  queryOptions({
    queryKey: ["bulk-training-plan-detail", planId],
    enabled: !!planId,
    queryFn: async (): Promise<UserTrainingPlan | null> => {
      if (!planId) return null;
      const { data: plan, error } = await supabase
        .from("bulk_training_plans")
        .select(PLAN_COLUMNS)
        .eq("id", planId)
        .maybeSingle();
      if (error) {
        developmentErrorDiagnostic("training_plan_detail", error);
        throw error;
      }
      if (!plan) return null;
      return loadFullPlan(plan as PlanRow);
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

export function useTrainingPlans(bulkProfileId: string | null) {
  return useQuery(trainingPlansQueryOptions(bulkProfileId));
}

export function useTrainingPlanById(planId: string | null) {
  return useQuery(trainingPlanByIdQueryOptions(planId));
}

export async function activateTrainingPlan(planId: string): Promise<void> {
  const { error } = await supabase.rpc("activate_bulk_training_plan", { _plan_id: planId });
  if (error) {
    developmentErrorDiagnostic("activate_training_plan", error);
    throw error;
  }
}

export async function deleteTrainingPlan(planId: string): Promise<boolean> {
  const { data, error } = await supabase.rpc("delete_bulk_training_plan", { _plan_id: planId });
  if (error) {
    developmentErrorDiagnostic("delete_training_plan", error);
    throw error;
  }
  return data;
}

// requestId must be held stable by the caller across retries of one logical action so the RPC's
// _request_id PK dedupes a replayed request; see useStableRequestId in the callers.
export async function duplicateTrainingPlan(planId: string, requestId: string): Promise<string> {
  const { data, error } = await supabase.rpc("duplicate_bulk_training_plan", {
    _plan_id: planId,
    _request_id: requestId,
  });
  if (error) {
    developmentErrorDiagnostic("duplicate_training_plan", error);
    throw error;
  }
  return data;
}

export async function instantiateTrainingPlan(
  templateId: string,
  planType: "generated" | "tempo_preset",
  requestId: string,
): Promise<string> {
  const { data, error } = await supabase.rpc("instantiate_bulk_training_plan", {
    _template_id: templateId,
    _plan_type: planType,
    _request_id: requestId,
  });
  if (error) {
    developmentErrorDiagnostic("instantiate_training_plan", error);
    throw error;
  }
  return data;
}

export async function switchTrainingPlan(
  templateId: string,
  planType: "generated" | "tempo_preset",
): Promise<string> {
  const { data, error } = await supabase.rpc("switch_bulk_training_plan", {
    _template_id: templateId,
    _plan_type: planType,
  });
  if (error) {
    developmentErrorDiagnostic("switch_training_plan", error);
    throw error;
  }
  return data;
}

export async function createEmptyTrainingPlan(name: string, requestId: string): Promise<string> {
  const { data, error } = await supabase.rpc("create_empty_bulk_training_plan", {
    _name: name,
    _request_id: requestId,
  });
  if (error) {
    developmentErrorDiagnostic("create_empty_training_plan", error);
    throw error;
  }
  return data;
}

export async function switchToEmptyTrainingPlan(name: string): Promise<string> {
  const { data, error } = await supabase.rpc("switch_to_empty_bulk_training_plan", {
    _name: name,
  });
  if (error) {
    developmentErrorDiagnostic("switch_to_empty_training_plan", error);
    throw error;
  }
  return data;
}

export type SaveTrainingPlanInput = {
  id: string;
  expectedUpdatedAt: string;
  name: string;
  days: {
    name: string;
    exercises: {
      exerciseId: string;
      sets: number;
      repMin: number;
      repMax: number;
      executionMode: "bilateral" | "unilateral";
      notes: string | null;
    }[];
  }[];
};

export async function saveTrainingPlan(input: SaveTrainingPlanInput): Promise<string> {
  const { data, error } = await supabase.rpc("save_bulk_training_plan", {
    _plan: input.id,
    _expected_updated_at: input.expectedUpdatedAt,
    _name: input.name,
    _days: input.days,
  });
  if (error) {
    developmentErrorDiagnostic("save_training_plan", error);
    throw error;
  }
  return data;
}
