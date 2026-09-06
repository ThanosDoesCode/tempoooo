import type { BulkMealUnit } from "./bulk-meal-presets";

export type NutritionMacros = {
  calories: number;
  protein: number;
  carbs: number;
  fat: number;
};

export type NutritionIngredientSnapshot = {
  name: string;
  quantity: number;
  unit: BulkMealUnit;
};

export type BulkNutritionDay = {
  id: string;
  bulkProfileId: string;
  logDate: string;
  targets: NutritionMacros;
  createdAt: string;
  updatedAt: string;
};

export type BulkNutritionEntry = NutritionMacros & {
  id: string;
  nutritionDayId: string;
  sourceMealPresetId: string | null;
  sourceType: "preset" | "custom";
  name: string;
  ingredients: NutritionIngredientSnapshot[];
  note: string | null;
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
};

export type NutritionDayData = {
  day: BulkNutritionDay | null;
  entries: BulkNutritionEntry[];
};

export type NutritionMacroStatus = {
  consumed: number;
  target: number;
  delta: number;
  status: "under" | "at" | "over";
};

export type NutritionSummary = {
  totals: NutritionMacros;
  calories: NutritionMacroStatus;
  protein: NutritionMacroStatus;
  carbs: NutritionMacroStatus;
  fat: NutritionMacroStatus;
};

export type NutritionEntryDraft = {
  name: string;
  calories: string;
  protein: string;
  carbs: string;
  fat: string;
  note: string;
};

export type NutritionEntryInput = NutritionMacros & { name: string; note: string | null };

export const emptyNutritionEntryDraft = (): NutritionEntryDraft => ({
  name: "",
  calories: "",
  protein: "",
  carbs: "",
  fat: "",
  note: "",
});

export function nutritionEntryDraft(entry: BulkNutritionEntry): NutritionEntryDraft {
  return {
    name: entry.name,
    calories: String(entry.calories),
    protein: String(entry.protein),
    carbs: String(entry.carbs),
    fat: String(entry.fat),
    note: entry.note ?? "",
  };
}

function round(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

export function totalNutrition(entries: BulkNutritionEntry[]): NutritionMacros {
  return entries.reduce(
    (total, entry) => ({
      calories: round(total.calories + entry.calories),
      protein: round(total.protein + entry.protein),
      carbs: round(total.carbs + entry.carbs),
      fat: round(total.fat + entry.fat),
    }),
    { calories: 0, protein: 0, carbs: 0, fat: 0 },
  );
}

export function nutritionMacroStatus(consumed: number, target: number): NutritionMacroStatus {
  const delta = round(Math.abs(target - consumed));
  return {
    consumed: round(consumed),
    target: round(target),
    delta,
    status: consumed < target ? "under" : consumed > target ? "over" : "at",
  };
}

export function nutritionSummary(
  entries: BulkNutritionEntry[],
  targets: NutritionMacros,
): NutritionSummary {
  const totals = totalNutrition(entries);
  return {
    totals,
    calories: nutritionMacroStatus(totals.calories, targets.calories),
    protein: nutritionMacroStatus(totals.protein, targets.protein),
    carbs: nutritionMacroStatus(totals.carbs, targets.carbs),
    fat: nutritionMacroStatus(totals.fat, targets.fat),
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

export function validateNutritionEntryDraft(draft: NutritionEntryDraft): {
  input?: NutritionEntryInput;
  errors: string[];
} {
  const errors: string[] = [];
  const name = draft.name.trim();
  const note = draft.note.trim();
  if (name.length < 1 || name.length > 100)
    errors.push("Entry name must be between 1 and 100 characters.");
  if (note.length > 240) errors.push("Note must be 240 characters or fewer.");
  const calories = decimal(draft.calories, "Calories", 20_000, errors);
  const protein = decimal(draft.protein, "Protein", 2_000, errors);
  const carbs = decimal(draft.carbs, "Carbs", 3_000, errors);
  const fat = decimal(draft.fat, "Fat", 2_000, errors);
  return errors.length
    ? { errors }
    : { input: { name, note: note || null, calories, protein, carbs, fat }, errors };
}

export function isIsoLocalDay(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(year!, month! - 1, day!, 12);
  return date.getFullYear() === year && date.getMonth() === month! - 1 && date.getDate() === day;
}
