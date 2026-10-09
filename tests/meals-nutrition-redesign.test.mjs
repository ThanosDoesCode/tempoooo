import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createMemoryHistory } from "@tanstack/history";
import { queryOptions } from "@tanstack/react-query";
import { accountUI } from "./account-ui-fixture.mjs";
import { presentationComponent } from "./presentation-component-fixture.mjs";
import * as nutrition from "../src/lib/bulk-nutrition.ts";
import { nutritionCalendarSlots, nutritionWindow } from "../src/lib/progress-model-core.ts";
import { nutritionWeekSummary } from "../src/lib/bulk-progress.ts";
import { iso } from "../src/lib/calc.ts";
const ready = (data) => ({ data, isLoading: false, error: null });
const macros = { calories: 2400, protein: 140, carbs: 300, fat: 80 };
const today = iso(new Date());

function mealUI({
  mode = "overview",
  date = "2001-01-01",
  data = { day: null, entries: [], effectiveTargets: null },
  category = null,
} = {}) {
  const calls = [];
  const destinations = [];
  const ui = accountUI(
    "src/components/BulkNutritionLog.tsx",
    "BulkNutritionLog",
    {
      "./NutritionDateStrip": { NutritionDateStrip: "NutritionDateStrip" },
      "@tanstack/react-query": { useQueryClient: () => ({ invalidateQueries: async () => {} }) },
      "@tanstack/react-router": {
        Link: "Link",
        useNavigate: () => async (destination) => destinations.push(destination),
      },
      "@/lib/bulk-nutrition": nutrition,
      "@/lib/calc": { iso },
      "@/lib/network-errors": { userFacingError: () => "Could not save" },
      "@/lib/bulk-nutrition-query": {
        useBulkNutritionDay: () => ready(data),
        bulkNutritionDayQueryKey: (profile, date) => [profile, date],
        createBulkNutritionEntry: async (...args) => calls.push(args),
        updateBulkNutritionEntry: async (...args) => calls.push(args),
      },
      "@/lib/bulk-meal-presets-query": { useBulkMealPresets: () => ready([]) },
      "@/components/ui/native-select": { NativeSelect: "select" },
      "@/components/ui/input": { Input: "input" },
      "@/components/ui/textarea": { Textarea: "textarea" },
      "@/components/ui/button": { Button: "button" },
      "@/components/ui-kit": { Field: "label", DataError: "DataError", PendingLabel: "span" },
      sonner: { toast: { success: () => {} } },
    },
    {
      bulkProfileId: "owner",
      selectedDate: date,
      currentTargets: macros,
      onDateChange() {},
      mode,
      initialCategory: category,
    },
    { crypto: { randomUUID: () => "request" }, window: { confirm: () => true } },
  );
  return { ui, calls, destinations };
}

test("calendar slots include every day across month boundaries without inserting missing intakes into analytics", () => {
  const days = [
    { date: "2026-09-29", calories: 2400, target: 2400, protein: 140, carbs: 300, fat: 80 },
    { date: "2026-10-02", calories: 0, target: null, protein: 0, carbs: 0, fat: 0 },
  ];
  const range = { start: "2026-09-29", end: "2026-10-02" };
  const model = nutritionWindow(days, 4, range.end, range);
  const slots = nutritionCalendarSlots(model.series, range);
  assert.deepEqual(
    slots.map((day) => day.date),
    ["2026-09-29", "2026-09-30", "2026-10-01", "2026-10-02"],
  );
  assert.deepEqual(
    slots.map((day) => day.calories),
    [2400, null, null, 0],
  );
  assert.equal(model.loggedDays, 2);
  assert.equal(model.knownTargetDays, 1);
  assert.equal(model.onTargetDays, 1);
  assert.equal(model.avgKcal, 1200);
  assert.equal(slots[1].onTarget, false);
  assert.equal(slots[1].target, null);
  assert.equal(
    nutritionCalendarSlots(model.series, { start: null, end: range.end })[0].date,
    "2026-09-29",
  );
});

test("unknown targets differ from zero and never become target adherence failures", () => {
  assert.equal(nutrition.nutritionSummary([], null).calories.status, "unknown");
  assert.equal(nutrition.nutritionSummary([], null).calories.target, null);
  assert.equal(nutrition.nutritionSummary([], { ...macros, calories: 0 }).calories.target, 0);
  const result = nutritionWeekSummary(
    [
      { logDate: "2026-10-05", calories: 2400, protein: 140, targetCalories: 2400 },
      { logDate: "2026-10-06", calories: 1800, protein: 120, targetCalories: null },
      { logDate: "2026-10-07", calories: null, protein: null, targetCalories: 2400 },
    ],
    "2026-10-05",
  );
  assert.equal(result.loggedDays, 2);
  assert.equal(result.targetedDays, 1);
  assert.equal(result.calorieAdherentDays, 1);
});

test("Meals shows compact category sections, retains unclassified entries and never substitutes current targets for history", () => {
  const entry = {
    id: "meal",
    name: "A very long preserved meal name",
    calories: 500,
    protein: 40,
    carbs: 60,
    fat: 12,
    ingredients: [],
    note: null,
    sourceType: "custom",
    mealCategory: null,
  };
  const f = mealUI({ data: { day: { targets: null }, entries: [entry] } });
  try {
    assert.match(f.ui.text(), /Target unavailable for this day/);
    for (const label of ["Breakfast", "Lunch", "Dinner", "Snacks", "Other logged meals"])
      assert.match(f.ui.text(), new RegExp(label));
    assert.doesNotMatch(f.ui.text(), /2400/);
    for (const category of nutrition.MEAL_CATEGORIES) {
      const link = f.ui
        .find("Link")
        .find((node) => node.props.children && node.props.search?.category === category);
      assert.equal(link.props.search.date, "2001-01-01");
      assert.equal(link.props.to, "/bulk/meals/add");
    }
    assert.ok(
      f.ui.find("button").some((node) => node.props["aria-label"] === `Edit ${entry.name}`),
    );
  } finally {
    f.ui.dispose();
  }
});

test("historical Add meal submits the selected date and category, clears only on success and uses date-neutral copy", async () => {
  const f = mealUI({ mode: "add", category: "dinner" });
  try {
    assert.doesNotMatch(f.ui.text(), /Add to today/);
    for (const [index, value] of ["Dinner", "600", "40", "70", "20"].entries())
      f.ui.find("input")[index].props.onChange({ target: { value } });
    f.ui.button("Add meal").props.onClick();
    await f.ui.flush();
    assert.equal(f.calls.length, 1);
    assert.equal(f.calls[0][0], "2001-01-01");
    assert.equal(f.calls[0][2].mealCategory, "dinner");
    assert.deepEqual(JSON.parse(JSON.stringify(f.destinations)), [
      { to: "/bulk/meals", search: { date: "2001-01-01" } },
    ]);
  } finally {
    f.ui.dispose();
  }
});

test("date strip navigates the true local month boundary, indicates Today and disables future days", () => {
  const changes = [];
  const ui = accountUI(
    "src/components/NutritionDateStrip.tsx",
    "NutritionDateStrip",
    {
      "./TempoDateTimePicker": { TempoDatePicker: "TempoDatePicker" },
      "@/lib/calc": { iso },
    },
    { selectedDate: "2026-09-30", today: "2026-10-02", onChange: (date) => changes.push(date) },
  );
  try {
    const days = ui.find("button").filter((node) => node.props["aria-pressed"] !== undefined);
    assert.equal(days.length, 7);
    assert.equal(days.filter((node) => node.props["aria-pressed"]).length, 1);
    const next = days.find((node) => node.props["aria-label"] === "Thursday 1 October 2026");
    next.props.onClick();
    assert.equal(changes[0], "2026-10-01");
    assert.ok(days.some((node) => node.props.disabled));
    assert.equal(
      days.find((node) => node.props["aria-current"] === "date").props["aria-label"],
      "Friday 2 October 2026",
    );
    ui.find("TempoDatePicker")[0].props.onChange("2026-10-02");
    assert.equal(changes.at(-1), "2026-10-02");
  } finally {
    ui.dispose();
  }
});

test("Meals selection follows route search on Back/Forward rather than a copied React date state", () => {
  const history = createMemoryHistory({ initialEntries: ["/bulk/meals?date=2026-09-30"] });
  const ui = accountUI("src/routes/_authenticated/bulk/meals.tsx", "Route", {
    "@tanstack/react-router": {
      createFileRoute: () => (options) => ({
        options,
        useSearch: () => ({
          date: new URLSearchParams(history.location.search).get("date") ?? undefined,
        }),
      }),
      useNavigate: () => (destination) =>
        history.push(`${destination.to}?date=${destination.search.date}`),
      Link: "Link",
    },
    "@/components/AppShell": { AppShell: "main", PageHeader: "header" },
    "@/components/BulkNutritionLog": { BulkNutritionLog: "BulkNutritionLog" },
    "@/components/PageSkeleton": { PageSkeleton: "PageSkeleton" },
    "@/components/ui/button": { Button: "button" },
    "@/lib/use-local-day": { useLocalDay: () => today },
    "@/lib/bulk-nutrition": nutrition,
    "@/lib/meals": {},
    "@/lib/store": {
      useBulkMeta: () => ({ bulkId: "owner" }),
      useAppData: () => ({ days: {}, targets: macros }),
    },
    "@/lib/bulk-access": { useMemberships: () => ready([]), bulkPlanModeFor: () => "public" },
  });
  try {
    assert.equal(ui.find("header")[0].props.compact, true);
    assert.equal(ui.find("header")[0].props.subtitle, undefined);
    assert.equal(ui.find("BulkNutritionLog")[0].props.selectedDate, "2026-09-30");
    ui.find("BulkNutritionLog")[0].props.onDateChange("2026-10-01");
    assert.equal(ui.find("BulkNutritionLog")[0].props.selectedDate, "2026-10-01");
    history.back();
    assert.equal(ui.find("BulkNutritionLog")[0].props.selectedDate, "2026-09-30");
    history.forward();
    assert.equal(ui.find("BulkNutritionLog")[0].props.selectedDate, "2026-10-01");
    const shortcut = ui.find("header")[0].props.action;
    assert.equal(shortcut.props["aria-label"], "Back to today");
    shortcut.props.onClick();
    assert.equal(ui.find("BulkNutritionLog")[0].props.selectedDate, today);
    assert.equal(ui.find("header")[0].props.action, undefined);
  } finally {
    ui.dispose();
    history.destroy();
  }
});

test("nutrition query preserves unknown snapshots and drains capped entry pages with profile/date isolation", async () => {
  let cursor = null;
  const calls = [];
  const row = {
    id: "day",
    bulk_profile_id: "owner",
    log_date: "2001-01-01",
    target_calories: null,
  };
  const records = [
    { id: "1", sort_order: 2, meal_category: "breakfast" },
    { id: "2", sort_order: 1, meal_category: null },
  ].map((entry) => ({
    ...entry,
    nutrition_day_id: "day",
    source_type: "custom",
    calories: 0,
    protein_g: 0,
    carbs_g: 0,
    fat_g: 0,
    ingredient_snapshot: [],
  }));
  const supabase = {
    from: (table) => {
      const filters = [];
      const query = {
        select() {
          return this;
        },
        eq(...args) {
          filters.push(args);
          return this;
        },
        maybeSingle: async () => {
          calls.push(filters);
          return { data: row, error: null };
        },
        order() {
          return this;
        },
        limit() {
          return this;
        },
        gt(_, value) {
          cursor = value;
          return this;
        },
        then(resolve) {
          return Promise.resolve({
            data: cursor === null ? [records[0]] : cursor === "1" ? [records[1]] : [],
            error: null,
          }).then(resolve);
        },
      };
      return query;
    },
  };
  const q = presentationComponent("src/lib/bulk-nutrition-query.ts", {
    "@tanstack/react-query": { queryOptions },
    "@/integrations/supabase/client": { supabase },
    "./network-errors": {},
    "./calc": { iso },
  });
  const result = await q.bulkNutritionDayQueryOptions("owner", "2001-01-01").queryFn();
  assert.equal(result.day.targets, null);
  assert.deepEqual(calls[0], [
    ["bulk_profile_id", "owner"],
    ["log_date", "2001-01-01"],
  ]);
  assert.equal(result.entries.length, 2);
  assert.equal(result.entries[0].id, "2");
  assert.equal(result.entries[1].mealCategory, "breakfast");
});

test("Food tooltip distinguishes an empty slot from a genuine zero-calorie log", () => {
  const { ProgressChartTooltip } = presentationComponent("src/components/ProgressChartTooltip.tsx");
  const ui = accountUI(
    "src/components/ProgressChartTooltip.tsx",
    "ProgressChartTooltip",
    {},
    {
      kind: "food",
      active: true,
      payload: [{ payload: { date: "2026-10-01", calories: null, target: null } }],
    },
  );
  try {
    assert.match(ui.text(), /No meals logged/);
    assert.doesNotMatch(ui.text(), /0 kcal|Target/);
  } finally {
    ui.dispose();
  }
  assert.ok(
    ProgressChartTooltip({ kind: "food", active: true, payload: [{ payload: { calories: 0 } }] }),
  );
  const source = readFileSync(
    new URL("../src/routes/_authenticated/bulk/progress_.body_.food.tsx", import.meta.url),
    "utf8",
  );
  assert.match(source, /dataKey="plotCalories"/);
  assert.match(source, /filterNull=\{false\}/);
});
