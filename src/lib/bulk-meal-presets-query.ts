import { queryOptions, useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { readRetryDelay, shouldRetryRead } from "./network-errors";
import type { BulkMealInput, BulkMealPreset, BulkMealUnit } from "./bulk-meal-presets";
import { QUERY_ID_BATCH_SIZE, QUERY_PAGE_SIZE, readAllByKey } from "./query-pagination";

type MealRow = {
  id: string;
  bulk_profile_id: string;
  name: string;
  description: string | null;
  sort_order: number;
  calories: number;
  protein_g: number;
  carbs_g: number;
  fat_g: number;
  created_at: string;
  updated_at: string;
  source_key: string | null;
  show_in_quick_add: boolean;
};

type IngredientRow = {
  id: string;
  meal_preset_id: string;
  name: string;
  quantity: number;
  unit: string;
  sort_order: number;
};

export const bulkMealPresetsQueryKey = (bulkProfileId: string) => [
  "bulk-meal-presets",
  bulkProfileId,
];

export const bulkMealPresetsQueryOptions = (bulkProfileId: string) =>
  queryOptions({
    queryKey: bulkMealPresetsQueryKey(bulkProfileId),
    queryFn: async (): Promise<BulkMealPreset[]> => {
      const meals = await readAllByKey<MealRow>(
        (cursor) => {
          let query = supabase
            .from("bulk_meal_presets")
            .select("*")
            .eq("bulk_profile_id", bulkProfileId)
            .order("id")
            .limit(QUERY_PAGE_SIZE);
          if (cursor) query = query.gt("id", cursor);
          return query;
        },
        (row) => row.id,
      );
      const byMeal = new Map<string, IngredientRow[]>();
      for (let offset = 0; offset < meals.length; offset += QUERY_ID_BATCH_SIZE) {
        const ids = meals.slice(offset, offset + QUERY_ID_BATCH_SIZE).map((meal) => meal.id);
        const rows = await readAllByKey<IngredientRow>(
          (cursor) => {
            let query = supabase
              .from("bulk_meal_preset_ingredients")
              .select("*")
              .in("meal_preset_id", ids)
              .order("id")
              .limit(QUERY_PAGE_SIZE);
            if (cursor) query = query.gt("id", cursor);
            return query;
          },
          (row) => row.id,
        );
        for (const row of rows) {
          const own = byMeal.get(row.meal_preset_id) ?? [];
          own.push(row);
          byMeal.set(row.meal_preset_id, own);
        }
      }
      return meals
        .sort((a, b) => a.sort_order - b.sort_order || a.id.localeCompare(b.id))
        .map((meal) => ({
          id: meal.id,
          bulkProfileId: meal.bulk_profile_id,
          name: meal.name,
          description: meal.description,
          sortOrder: meal.sort_order,
          calories: Number(meal.calories),
          protein: Number(meal.protein_g),
          carbs: Number(meal.carbs_g),
          fat: Number(meal.fat_g),
          createdAt: meal.created_at,
          updatedAt: meal.updated_at,
          sourceKey: meal.source_key,
          showInQuickAdd: meal.show_in_quick_add,
          ingredients: (byMeal.get(meal.id) ?? [])
            .sort((a, b) => a.sort_order - b.sort_order || a.id.localeCompare(b.id))
            .map((ingredient) => ({
              id: ingredient.id,
              name: ingredient.name,
              quantity: Number(ingredient.quantity),
              unit: ingredient.unit as BulkMealUnit,
              sortOrder: ingredient.sort_order,
            })),
        }));
    },
    enabled: !!bulkProfileId,
    staleTime: 60_000,
    gcTime: 10 * 60_000,
    retry: shouldRetryRead,
    retryDelay: readRetryDelay,
  });

export function useBulkMealPresets(bulkProfileId: string | null) {
  return useQuery(bulkMealPresetsQueryOptions(bulkProfileId ?? ""));
}

const ingredientsJson = (input: BulkMealInput) =>
  input.ingredients.map((ingredient) => ({
    name: ingredient.name,
    quantity: ingredient.quantity,
    unit: ingredient.unit,
  }));

export async function createBulkMealPreset(input: BulkMealInput): Promise<string> {
  const { data, error } = await supabase.rpc("create_bulk_meal_preset", {
    _name: input.name,
    _description: input.description ?? "",
    _calories: input.calories,
    _protein: input.protein,
    _carbs: input.carbs,
    _fat: input.fat,
    _ingredients: ingredientsJson(input),
  });
  if (error) throw error;
  return data;
}

export async function updateBulkMealPreset(
  meal: BulkMealPreset,
  input: BulkMealInput,
): Promise<string> {
  const { data, error } = await supabase.rpc("update_bulk_meal_preset", {
    _meal: meal.id,
    _expected_updated_at: meal.updatedAt,
    _name: input.name,
    _description: input.description ?? "",
    _calories: input.calories,
    _protein: input.protein,
    _carbs: input.carbs,
    _fat: input.fat,
    _ingredients: ingredientsJson(input),
  });
  if (error) throw error;
  return data;
}

export async function duplicateBulkMealPreset(mealId: string): Promise<string> {
  const { data, error } = await supabase.rpc("duplicate_bulk_meal_preset", { _meal: mealId });
  if (error) throw error;
  return data;
}

export async function deleteBulkMealPreset(mealId: string): Promise<void> {
  const { data, error } = await supabase.rpc("delete_bulk_meal_preset", { _meal: mealId });
  if (error) throw error;
  if (!data) throw new Error("Meal could not be deleted");
}

export async function moveBulkMealPreset(mealId: string, direction: -1 | 1): Promise<void> {
  const { data, error } = await supabase.rpc("move_bulk_meal_preset", {
    _meal: mealId,
    _direction: direction,
  });
  if (error) throw error;
  if (!data) throw new Error("Meal cannot move in that direction");
}

export async function setBulkMealPresetQuickAddVisibility(
  mealId: string,
  visible: boolean,
): Promise<void> {
  const { data, error } = await supabase.rpc("set_bulk_meal_preset_quick_add_visibility", {
    _meal: mealId,
    _visible: visible,
  });
  if (error) throw error;
  if (!data) throw new Error("Meal unavailable or not owned by your account");
}
