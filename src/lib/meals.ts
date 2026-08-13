import type { MealPlanId } from "./types";

export type MealPlan = {
  id: MealPlanId;
  name: string;
  short: string;
  base: string[];
  meals: string[];
  macros: { calories: number; protein: number; carbs: number; fat: number } | null;
};

export const MEAL_PLANS: MealPlan[] = [
  {
    id: "beef",
    name: "Beef day",
    short: "Beef",
    base: ["Milkshake", "Grötbröd + cheese"],
    meals: ["Beef pasta ×2", "146 g dry pasta each", "1/6 cooked beef sauce batch each"],
    macros: { calories: 2900, protein: 132, carbs: 382, fat: 88 },
  },
  {
    id: "lentil",
    name: "Lentil day",
    short: "Lentil",
    base: ["Milkshake", "Grötbröd + cheese"],
    meals: ["Lentil pasta ×2", "146 g dry pasta each", "1/6 lentil sauce batch each"],
    macros: { calories: 2880, protein: 126, carbs: 400, fat: 82 },
  },
  {
    id: "kebab",
    name: "Chicken kebab day",
    short: "Kebab",
    base: ["Milkshake", "Grötbröd + cheese"],
    meals: ["Chicken kebab plate ×2", "180 g dry rice each", "1/6 kebab chicken batch each"],
    macros: { calories: 2920, protein: 140, carbs: 375, fat: 86 },
  },
  {
    id: "salmon",
    name: "Salmon day",
    short: "Salmon",
    base: ["Milkshake", "Grötbröd + cheese"],
    meals: ["Salmon + potatoes ×2", "400 g potatoes each", "150 g salmon each"],
    macros: { calories: 2890, protein: 134, carbs: 360, fat: 90 },
  },
  {
    id: "custom",
    name: "Custom day",
    short: "Custom",
    base: [],
    meals: ["Log calories and macros manually"],
    macros: null,
  },
];

export const mealPlan = (id: MealPlanId | undefined) =>
  id ? MEAL_PLANS.find((m) => m.id === id) : undefined;
