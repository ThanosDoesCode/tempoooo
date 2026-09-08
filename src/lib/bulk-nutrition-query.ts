import { queryOptions, useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import type { Json } from "@/integrations/supabase/types";
import { readRetryDelay, shouldRetryRead } from "./network-errors";
import type {
  BulkNutritionEntry,
  NutritionDayData,
  NutritionEntryInput,
  NutritionIngredientSnapshot,
} from "./bulk-nutrition";
import { iso } from "./calc";

const localToday = () => iso(new Date());

type DayRow = {
  id: string;
  bulk_profile_id: string;
  log_date: string;
  target_calories: number;
  target_protein_g: number;
  target_carbs_g: number;
  target_fat_g: number;
  created_at: string;
  updated_at: string;
};

type EntryRow = {
  id: string;
  nutrition_day_id: string;
  source_meal_preset_id: string | null;
  source_type: string;
  name_snapshot: string;
  calories: number;
  protein_g: number;
  carbs_g: number;
  fat_g: number;
  ingredient_snapshot: Json;
  note: string | null;
  sort_order: number;
  created_at: string;
  updated_at: string;
};

export const bulkNutritionDayQueryKey = (bulkProfileId: string, logDate: string) => [
  "bulk-nutrition-day",
  bulkProfileId,
  logDate,
];

export const bulkNutritionDayQueryOptions = (bulkProfileId: string, logDate: string) =>
  queryOptions({
    queryKey: bulkNutritionDayQueryKey(bulkProfileId, logDate),
    queryFn: async (): Promise<NutritionDayData> => {
      const dayResult = await supabase
        .from("bulk_nutrition_days")
        .select("*")
        .eq("bulk_profile_id", bulkProfileId)
        .eq("log_date", logDate)
        .maybeSingle();
      if (dayResult.error) throw dayResult.error;
      if (!dayResult.data) return { day: null, entries: [] };
      const row = dayResult.data as DayRow;
      const entryResult = await supabase
        .from("bulk_nutrition_entries")
        .select("*")
        .eq("nutrition_day_id", row.id)
        .order("sort_order");
      if (entryResult.error) throw entryResult.error;
      return {
        day: {
          id: row.id,
          bulkProfileId: row.bulk_profile_id,
          logDate: row.log_date,
          targets: {
            calories: Number(row.target_calories),
            protein: Number(row.target_protein_g),
            carbs: Number(row.target_carbs_g),
            fat: Number(row.target_fat_g),
          },
          createdAt: row.created_at,
          updatedAt: row.updated_at,
        },
        entries: ((entryResult.data ?? []) as EntryRow[]).map(mapEntry),
      };
    },
    enabled: !!bulkProfileId && !!logDate,
    staleTime: 30_000,
    gcTime: 10 * 60_000,
    retry: shouldRetryRead,
    retryDelay: readRetryDelay,
  });

function mapEntry(row: EntryRow): BulkNutritionEntry {
  return {
    id: row.id,
    nutritionDayId: row.nutrition_day_id,
    sourceMealPresetId: row.source_meal_preset_id,
    sourceType: row.source_type as "preset" | "custom",
    name: row.name_snapshot,
    calories: Number(row.calories),
    protein: Number(row.protein_g),
    carbs: Number(row.carbs_g),
    fat: Number(row.fat_g),
    ingredients: row.ingredient_snapshot as unknown as NutritionIngredientSnapshot[],
    note: row.note,
    sortOrder: row.sort_order,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function useBulkNutritionDay(bulkProfileId: string | null, logDate: string) {
  return useQuery(bulkNutritionDayQueryOptions(bulkProfileId ?? "", logDate));
}

export async function logBulkMealPreset(
  presetId: string,
  logDate: string,
  requestId: string,
): Promise<string> {
  const { data, error } = await supabase.rpc("log_bulk_meal_preset", {
    _preset: presetId,
    _log_date: logDate,
    _request_id: requestId,
    _local_today: localToday(),
  });
  if (error) throw error;
  return data;
}

export async function createBulkNutritionEntry(
  logDate: string,
  requestId: string,
  input: NutritionEntryInput,
): Promise<string> {
  const { data, error } = await supabase.rpc("create_bulk_nutrition_entry", {
    _log_date: logDate,
    _request_id: requestId,
    _name: input.name,
    _calories: input.calories,
    _protein: input.protein,
    _carbs: input.carbs,
    _fat: input.fat,
    _note: input.note,
    _local_today: localToday(),
  });
  if (error) throw error;
  return data;
}

export async function updateBulkNutritionEntry(
  entry: BulkNutritionEntry,
  input: NutritionEntryInput,
): Promise<string> {
  const { data, error } = await supabase.rpc("update_bulk_nutrition_entry", {
    _entry: entry.id,
    _expected_updated_at: entry.updatedAt,
    _name: input.name,
    _calories: input.calories,
    _protein: input.protein,
    _carbs: input.carbs,
    _fat: input.fat,
    _note: input.note,
    _local_today: localToday(),
  });
  if (error) throw error;
  return data;
}

export async function deleteBulkNutritionEntry(entryId: string): Promise<void> {
  const { data, error } = await supabase.rpc("delete_bulk_nutrition_entry", {
    _entry: entryId,
    _local_today: localToday(),
  });
  if (error) throw error;
  if (!data) throw new Error("Nutrition entry could not be deleted");
}
