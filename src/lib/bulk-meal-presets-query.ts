import { queryOptions, useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { readRetryDelay, shouldRetryRead } from "./network-errors";
import type { BulkMealInput, BulkMealPreset, BulkMealUnit } from "./bulk-meal-presets";

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
      const [meals, ingredients] = await Promise.all([
        supabase
          .from("bulk_meal_presets")
          .select("*")
          .eq("bulk_profile_id", bulkProfileId)
          .order("sort_order"),
        supabase.from("bulk_meal_preset_ingredients").select("*").order("sort_order"),
      ]);
      if (meals.error) throw meals.error;
      if (ingredients.error) throw ingredients.error;
      const ingredientRows = (ingredients.data ?? []) as IngredientRow[];
      return ((meals.data ?? []) as MealRow[]).map((meal) => ({
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
        ingredients: ingredientRows
          .filter((ingredient) => ingredient.meal_preset_id === meal.id)
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
