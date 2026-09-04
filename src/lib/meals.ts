import type { MealPlanId, MealSnapshot } from "./types";

type MacroTotals = { calories: number; protein: number; carbs: number; fat: number };

export type MealPlan = {
  id: MealPlanId;
  name: string;
  short: string;
  base: string[];
  mainMealDescription: string;
  batchDescription: string[];
  perMealQuantities: string[];
  mealsPerDay: number;
  meals: string[];
  macros: MacroTotals | null;
};

export const DAILY_BASE = {
  meals: [
    {
      name: "Milkshake",
      quantities: [
        "100 g banana",
        "200 g Arla Köket Greek yoghurt 10%",
        "100 g ICA oats",
        "330 ml Arla 3% milk",
        "5 g creatine",
      ],
      macros: { calories: 900, protein: 31, carbs: 109, fat: 37 },
    },
    {
      name: "Grötbröd + cheese",
      quantities: ["2 slices Grötbröd", "40 g Prästost Mild 35%"],
      macros: { calories: 420, protein: 20, carbs: 41, fat: 19 },
    },
  ],
  macros: { calories: 1320, protein: 51, carbs: 150, fat: 56 },
} satisfies {
  meals: { name: string; quantities: string[]; macros: MacroTotals }[];
  macros: MacroTotals;
};

type PresetDefinition = Omit<MealPlan, "base" | "meals">;

function preset(definition: PresetDefinition): MealPlan {
  return {
    ...definition,
    base: DAILY_BASE.meals.map((meal) => meal.name),
    meals: [
      `${definition.mainMealDescription} ×${definition.mealsPerDay}`,
      ...definition.perMealQuantities,
    ],
  };
}

export const MEAL_PLANS: MealPlan[] = [
  preset({
    id: "beef",
    name: "Beef day",
    short: "Beef",
    mainMealDescription: "Beef pasta",
    batchDescription: [
      "750 g ICA 5% minced beef",
      "780 g passata",
      "45 g olive oil",
      "1 large onion, garlic, basil, cinnamon and mint",
      "876 g dry ICA Spirali",
      "6 main meals over 3 days",
    ],
    perMealQuantities: ["146 g dry ICA Spirali each", "1/6 finished beef sauce batch each"],
    mealsPerDay: 2,
    macros: { calories: 2900, protein: 141, carbs: 375, fat: 87 },
  }),
  preset({
    id: "lentil",
    name: "Lentil day",
    short: "Lentil",
    mainMealDescription: "Lentils + rice",
    batchDescription: [
      "500 g dry Lidl lentils",
      "250 g dry Ben’s Original rice",
      "500 g ICA passata",
      "40 g olive oil",
      "1 large onion, garlic, basil, seasoning and water as needed",
      "4 main meals over 2 days",
    ],
    perMealQuantities: ["62.5 g dry Ben’s Original rice each", "1/4 finished lentil batch each"],
    mealsPerDay: 2,
    macros: { calories: 2800, protein: 123, carbs: 362, fat: 81 },
  }),
  preset({
    id: "kebab",
    name: "Kebab day",
    short: "Kebab",
    mainMealDescription: "Chicken kebab",
    batchDescription: [
      "300 g ICA Basic Kycklingkebab",
      "125 g dry Ben’s Original rice",
      "4 slices Grötbröd",
      "20 g Heinz mayo",
      "2 main meals over 1 day",
    ],
    perMealQuantities: [
      "150 g chicken kebab each",
      "62.5 g dry Ben’s Original rice each",
      "2 slices Grötbröd each",
      "10 g Heinz mayo each",
    ],
    mealsPerDay: 2,
    macros: { calories: 2835, protein: 135, carbs: 343, fat: 95 },
  }),
  preset({
    id: "salmon",
    name: "Salmon day",
    short: "Salmon",
    mainMealDescription: "Salmon + rice",
    batchDescription: [
      "250 g raw salmon",
      "300 g dry Ben’s Original rice",
      "No mayo",
      "2 main meals over 1 day",
    ],
    perMealQuantities: ["125 g salmon each", "150 g dry Ben’s Original rice each"],
    mealsPerDay: 2,
    macros: { calories: 2830, protein: 118, carbs: 380, fat: 89 },
  }),
  {
    id: "custom",
    name: "Custom day",
    short: "Custom",
    base: [],
    mainMealDescription: "Manual nutrition",
    batchDescription: [],
    perMealQuantities: [],
    mealsPerDay: 0,
    meals: ["Log calories and macros manually"],
    macros: null,
  },
];

export const mealPlan = (id: MealPlanId | undefined) =>
  id ? MEAL_PLANS.find((meal) => meal.id === id) : undefined;

export function mealPlanSnapshot(plan: MealPlan): MealSnapshot {
  return {
    name: plan.name,
    base: [...plan.base],
    meals: [...plan.meals],
    macros: plan.macros ? { ...plan.macros } : null,
  };
}
