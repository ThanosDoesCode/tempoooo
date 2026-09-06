export const BULK_MEAL_UNITS = [
  "g",
  "ml",
  "piece",
  "slice",
  "tbsp",
  "tsp",
  "pack",
  "serving",
] as const;

export type BulkMealUnit = (typeof BULK_MEAL_UNITS)[number];

export type BulkMealIngredient = {
  id: string;
  name: string;
  quantity: number;
  unit: BulkMealUnit;
  sortOrder: number;
};

export type BulkMealPreset = {
  id: string;
  bulkProfileId: string;
  name: string;
  description: string | null;
  sortOrder: number;
  calories: number;
  protein: number;
  carbs: number;
  fat: number;
  createdAt: string;
  updatedAt: string;
  ingredients: BulkMealIngredient[];
};

export type BulkMealIngredientInput = {
  name: string;
  quantity: number;
  unit: BulkMealUnit;
};

export type BulkMealInput = {
  name: string;
  description: string | null;
  calories: number;
  protein: number;
  carbs: number;
  fat: number;
  ingredients: BulkMealIngredientInput[];
};

export type BulkMealDraftIngredient = {
  key: string;
  name: string;
  quantity: string;
  unit: BulkMealUnit;
};

export type BulkMealDraft = {
  name: string;
  description: string;
  calories: string;
  protein: string;
  carbs: string;
  fat: string;
  ingredients: BulkMealDraftIngredient[];
};

export const emptyBulkMealDraft = (): BulkMealDraft => ({
  name: "",
  description: "",
  calories: "",
  protein: "",
  carbs: "",
  fat: "",
  ingredients: [],
});

export function bulkMealDraft(preset: BulkMealPreset): BulkMealDraft {
  return {
    name: preset.name,
    description: preset.description ?? "",
    calories: String(preset.calories),
    protein: String(preset.protein),
    carbs: String(preset.carbs),
    fat: String(preset.fat),
    ingredients: preset.ingredients.map((ingredient) => ({
      key: ingredient.id,
      name: ingredient.name,
      quantity: String(ingredient.quantity),
      unit: ingredient.unit,
    })),
  };
}

function decimal(value: string, label: string, maximum: number, errors: string[]): number {
  const normalized = value.trim().replace(",", ".");
  if (!/^\d+(?:\.\d+)?$/.test(normalized)) {
    errors.push(`${label} must be a valid number.`);
    return 0;
  }
  const parsed = Number(normalized);
  if (!Number.isFinite(parsed) || parsed < 0 || parsed > maximum)
    errors.push(`${label} must be between 0 and ${maximum}.`);
  return parsed;
}

export function validateBulkMealDraft(draft: BulkMealDraft): {
  input?: BulkMealInput;
  errors: string[];
} {
  const errors: string[] = [];
  const name = draft.name.trim();
  const description = draft.description.trim();
  if (name.length < 2 || name.length > 80)
    errors.push("Meal name must be between 2 and 80 characters.");
  if (description.length > 240) errors.push("Description must be 240 characters or fewer.");
  if (draft.ingredients.length > 30) errors.push("A meal can have at most 30 ingredients.");

  const calories = decimal(draft.calories, "Calories", 20_000, errors);
  const protein = decimal(draft.protein, "Protein", 2_000, errors);
  const carbs = decimal(draft.carbs, "Carbs", 3_000, errors);
  const fat = decimal(draft.fat, "Fat", 2_000, errors);

  const ingredients = draft.ingredients.map((ingredient, index) => {
    const ingredientName = ingredient.name.trim();
    if (ingredientName.length < 1 || ingredientName.length > 100)
      errors.push(`Ingredient ${index + 1} needs a name of 100 characters or fewer.`);
    const quantity = decimal(
      ingredient.quantity,
      `Ingredient ${index + 1} quantity`,
      100_000,
      errors,
    );
    if (quantity <= 0) errors.push(`Ingredient ${index + 1} quantity must be greater than 0.`);
    if (!BULK_MEAL_UNITS.includes(ingredient.unit))
      errors.push(`Ingredient ${index + 1} has an unsupported unit.`);
    return { name: ingredientName, quantity, unit: ingredient.unit };
  });

  return errors.length
    ? { errors }
    : {
        errors,
        input: {
          name,
          description: description || null,
          calories,
          protein,
          carbs,
          fat,
          ingredients,
        },
      };
}

export function moveDraftIngredient(
  ingredients: BulkMealDraftIngredient[],
  index: number,
  direction: -1 | 1,
): BulkMealDraftIngredient[] {
  const destination = index + direction;
  if (index < 0 || destination < 0 || destination >= ingredients.length) return ingredients;
  const next = [...ingredients];
  [next[index], next[destination]] = [next[destination]!, next[index]!];
  return next;
}
