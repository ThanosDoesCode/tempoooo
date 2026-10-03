import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import vm from "node:vm";
import ts from "typescript";
import { checkInDraft, validateCheckIn } from "../src/lib/daily-check-in.ts";
import * as nutrition from "../src/lib/bulk-nutrition.ts";
import { mainTabForPath, LOG_ACTIONS, isFocusScreen } from "../src/lib/main-navigation.ts";

const read = (p) => readFile(new URL(`../${p}`, import.meta.url), "utf8");
const require = createRequire(import.meta.url);
const checkSource = await read("src/components/DailyCheckIn.tsx");
const mealSource = await read("src/components/BulkNutritionLog.tsx");
const iso = (d) => require("date-fns").format(d, "yyyy-MM-dd");
const jsx = (type, props) => ({ type, props });
function nodes(tree, predicate) {
  if (!tree || typeof tree !== "object") return [];
  if (Array.isArray(tree)) return tree.flatMap((child) => nodes(child, predicate));
  return [...(predicate(tree) ? [tree] : []), ...nodes(tree.props?.children, predicate)];
}
function texts(tree) {
  if (tree == null || typeof tree === "boolean") return "";
  if (Array.isArray(tree)) return tree.map(texts).join(" ");
  if (typeof tree === "object") return texts(tree.props?.children);
  return String(tree);
}
// Execute actual component handlers with stable hook slots; no copied write/calculation logic.
function fixture(source, exportName, props, options = {}) {
  const slots = [],
    calls = [],
    cache = [],
    destinations = [];
  let index = 0,
    uuid = 0,
    fail = options.fail ?? false;
  const query = { data: options.day ?? { day: null, entries: [] }, isLoading: false, error: null };
  const presetQuery = { data: options.presets ?? [], isLoading: false, error: null };
  const record = async (name, ...args) => {
    calls.push([name, ...args]);
    if (fail) throw new Error("Network request failed");
    return name === "createPreset" ? "created-preset" : undefined;
  };
  const modules = {
    react: {
      useState(initial) {
        const i = index++;
        if (!slots[i]) slots[i] = { value: typeof initial === "function" ? initial() : initial };
        return [
          slots[i].value,
          (next) => {
            slots[i].value = typeof next === "function" ? next(slots[i].value) : next;
          },
        ];
      },
      useRef(initial) {
        const i = index++;
        return (slots[i] ??= { current: initial });
      },
      useMemo(f) {
        return f();
      },
    },
    "react/jsx-runtime": { jsx, jsxs: jsx, Fragment: "fragment" },
    "@tanstack/react-query": {
      useQueryClient: () => ({ invalidateQueries: async (c) => cache.push(c.queryKey) }),
    },
    "@tanstack/react-router": {
      Link: "Link",
      useNavigate: () => async (d) => destinations.push(d),
      createFileRoute: () => (config) => config,
    },
    sonner: { toast: { success: (m) => calls.push(["success", m]) } },
    "@/lib/daily-check-in": { checkInDraft, validateCheckIn },
    "@/lib/calc": { iso },
    "@/lib/store": { useActions: () => ({ saveDay: (...a) => record("saveDay", ...a) }) },
    "@/lib/bulk-progress-query": {
      bulkWeightQueryKey: (id) => ["bulk-weight-entries", id],
      saveBulkWeight: (...a) => record("saveWeight", ...a),
    },
    "@/lib/bulk-nutrition": nutrition,
    "@/lib/network-errors": { userFacingError: () => "Failed. Your entered data is still here." },
    "@/lib/bulk-nutrition-query": {
      useBulkNutritionDay: () => query,
      bulkNutritionDayQueryKey: (id, date) => ["nutrition", id, date],
      logBulkMealPreset: (...a) => record("logPreset", ...a),
      createBulkNutritionEntry: (...a) => record("createEntry", ...a),
      updateBulkNutritionEntry: (...a) => record("updateEntry", ...a),
      deleteBulkNutritionEntry: (...a) => record("deleteEntry", ...a),
    },
    "@/lib/bulk-meal-presets-query": {
      useBulkMealPresets: () => presetQuery,
      bulkMealPresetsQueryKey: (id) => ["presets", id],
      createBulkMealPreset: (...a) => record("createPreset", ...a),
    },
  };
  const context = {
    exports: {},
    crypto: { randomUUID: () => `request-${++uuid}` },
    window: { confirm: () => true },
    require(name) {
      if (options.modules?.[name]) return options.modules[name];
      if (modules[name]) return modules[name];
      if (name === "date-fns") return require(name);
      if (name.includes("ui") || name === "lucide-react")
        return new Proxy({}, { get: (_, key) => String(key) });
      throw new Error(`Unexpected module ${name}`);
    },
  };
  vm.runInNewContext(
    ts.transpileModule(source, {
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2022,
        jsx: ts.JsxEmit.ReactJSX,
      },
    }).outputText,
    context,
  );
  const render = () => {
    index = 0;
    return exportName === "Route"
      ? context.exports.Route.component(props)
      : context.exports[exportName](props);
  };
  return {
    render,
    calls,
    cache,
    destinations,
    query,
    setFail: (value) => {
      fail = value;
    },
  };
}
const checkProps = {
  profileId: "owner",
  date: "2026-10-03",
  publicGoal: true,
  weightNote: "keep me",
};
const mealProps = {
  bulkProfileId: "owner",
  selectedDate: "2026-10-03",
  currentTargets: { calories: 2500, protein: 150, carbs: 300, fat: 70 },
  onDateChange() {},
};
const entry = {
  id: "entry",
  name: "Yogurt",
  calories: 200,
  protein: 20,
  carbs: 15,
  fat: 5,
  note: "original note",
  ingredients: [],
  sourceType: "custom",
  updatedAt: "version",
  sortOrder: 0,
};
const preset = { ...entry, id: "preset", name: "My breakfast" };
const find = (tree, name) =>
  nodes(tree, (n) => (typeof n.type === "function" ? n.type.name === name : n.type === name))[0];

// Pure validation/prefill: no yesterday/UTC or stale-day defaults.
test("Phase 4 fresh check-in is blank; today's saved weight/sleep and yesterday's steps prefill", () => {
  assert.deepEqual(checkInDraft(), {
    weight: "",
    sleep: "",
    quality: null,
    steps: "",
    waist: "",
    restingHr: "",
  });
  assert.deepEqual(checkInDraft({ sleepHours: 7.25, sleepQuality: 4 }, 81.6, { steps: 9000 }), {
    weight: "81.6",
    sleep: "7.25",
    quality: 4,
    steps: "9000",
    waist: "",
    restingHr: "",
  });
  const valid = validateCheckIn({
    ...checkInDraft(),
    weight: "81,65",
    sleep: "7,25",
    quality: 4,
    steps: "9000",
  });
  assert.equal(valid.weight, 81.65);
  assert.equal(valid.patch.sleepHours, 7.25);
  assert.deepEqual(valid.errors, []);
  for (const invalid of [{ weight: "0" }, { sleep: "25" }, { steps: "1.5" }, { quality: 6 }])
    assert.ok(validateCheckIn({ ...checkInDraft(), ...invalid }).errors.length);
});

test("Phase 4 check-in writes today's owner weight and yesterday's steps, guards double taps, invalidates Today", async () => {
  const f = fixture(checkSource, "DailyCheckIn", checkProps);
  let tree = f.render();
  nodes(tree, (n) => n.props?.["aria-label"] === "Weight")[0].props.onChange({
    target: { value: "81,6" },
  });
  nodes(f.render(), (n) => n.props?.["aria-label"] === "Sleep")[0].props.onChange({
    target: { value: "7.25" },
  });
  nodes(
    f.render(),
    (n) => n.props?.["aria-label"] === "Steps yesterday (optional)",
  )[0].props.onChange({ target: { value: "8000" } });
  const save = nodes(f.render(), (n) => n.props?.["aria-busy"] != null)[0].props.onClick;
  save();
  save();
  await new Promise((r) => setImmediate(r));
  assert.equal(f.calls.filter(([n]) => n === "saveWeight").length, 1);
  const weight = f.calls.find(([n]) => n === "saveWeight");
  assert.equal(weight[1], "owner");
  assert.equal(weight[2].note, "keep me");
  assert.equal(weight[2].logDate, "2026-10-03");
  assert.equal(
    f.calls.find(([n, date]) => n === "saveDay" && date === "2026-10-02")[2].steps,
    8000,
  );
  assert.ok(f.cache.some((key) => key[0] === "bulk-weight-entries"));
  assert.equal(f.destinations[0].to, "/bulk");
});

test("Phase 4 failed check-in preserves values, stays on form and retries without fabricated success", async () => {
  const f = fixture(checkSource, "DailyCheckIn", { ...checkProps, weight: 80 }, { fail: true });
  nodes(f.render(), (n) => n.props?.["aria-busy"] != null)[0].props.onClick();
  await new Promise((r) => setImmediate(r));
  assert.equal(nodes(f.render(), (n) => n.props?.["aria-label"] === "Weight")[0].props.value, "80");
  assert.match(texts(f.render()), /Your entered data is still here/);
  assert.equal(f.destinations.length, 0);
  assert.equal(f.calls.filter(([n]) => n === "success").length, 0);
  f.setFail(false);
  nodes(f.render(), (n) => n.props?.["aria-busy"] != null)[0].props.onClick();
  await new Promise((r) => setImmediate(r));
  assert.equal(f.destinations.length, 1);
});

test("Phase 4 custom meal preserves date/macros, clears on confirmed success and refetches daily totals", async () => {
  const f = fixture(mealSource, "BulkNutritionLog", { ...mealProps, mode: "add" });
  find(f.render(), "NutritionEntryEditor").props.onChange({
    name: "Snack",
    calories: "200",
    protein: "20",
    carbs: "15",
    fat: "5",
    note: "",
  });
  const editor = find(f.render(), "NutritionEntryEditor");
  editor.props.onSave();
  editor.props.onSave();
  await new Promise((r) => setImmediate(r));
  const calls = f.calls.filter(([n]) => n === "createEntry");
  assert.equal(calls.length, 1);
  assert.equal(calls[0][1], "2026-10-03");
  for (const key of ["calories", "protein", "carbs", "fat"])
    assert.equal(calls[0][3][key], entry[key]);
  assert.equal(find(f.render(), "NutritionEntryEditor"), undefined);
  assert.equal(f.destinations[0].to, "/bulk/meals");
  assert.equal(f.destinations[0].search.date, "2026-10-03");
  assert.ok(f.cache.some((k) => k[0] === "nutrition" && k[2] === "2026-10-03"));
});

test("Phase 4 saved meal uses original preset logging path; failed save preserves draft/request identity", async () => {
  const f = fixture(
    mealSource,
    "BulkNutritionLog",
    { ...mealProps, mode: "add" },
    { presets: [preset], fail: true },
  );
  find(f.render(), "select").props.onChange({ target: { value: "preset" } });
  find(f.render(), "NutritionEntryEditor").props.onSave();
  await new Promise((r) => setImmediate(r));
  assert.equal(find(f.render(), "NutritionEntryEditor").props.editor.draft.name, "My breakfast");
  assert.equal(f.destinations.length, 0);
  f.setFail(false);
  find(f.render(), "NutritionEntryEditor").props.onSave();
  await new Promise((r) => setImmediate(r));
  const calls = f.calls.filter(([n]) => n === "logPreset");
  assert.equal(calls.length, 2);
  assert.equal(calls[0][1], "preset");
  assert.equal(calls[0][3], calls[1][3]);
  assert.equal(f.calls.filter(([n]) => n === "createEntry").length, 0);
});

test("Phase 4 Save for quick add creates one preset then logs that preset; edit/delete remain confirmed", async () => {
  const f = fixture(mealSource, "BulkNutritionLog", { ...mealProps, mode: "add" });
  let editor = find(f.render(), "NutritionEntryEditor");
  editor.props.onChange({
    name: "Snack",
    calories: "200",
    protein: "20",
    carbs: "15",
    fat: "5",
    note: "",
  });
  find(f.render(), "NutritionEntryEditor").props.onSaveQuick(true);
  find(f.render(), "NutritionEntryEditor").props.onSave();
  await new Promise((r) => setImmediate(r));
  assert.equal(f.calls.filter(([n]) => n === "createPreset").length, 1);
  assert.equal(f.calls.find(([n]) => n === "logPreset")[1], "created-preset");
  const g = fixture(mealSource, "BulkNutritionLog", mealProps, {
    day: { day: { targets: mealProps.currentTargets }, entries: [entry] },
  });
  find(g.render(), "NutritionEntryCard").props.onEdit();
  editor = find(g.render(), "NutritionEntryEditor");
  assert.equal(editor.props.editor.draft.note, "original note");
  editor.props.onSave();
  await new Promise((r) => setImmediate(r));
  assert.equal(g.calls.find(([n]) => n === "updateEntry")[1].id, "entry");
  find(g.render(), "NutritionEntryCard").props.onDelete();
  await new Promise((r) => setImmediate(r));
  assert.equal(g.calls.find(([n]) => n === "deleteEntry")[1], "entry");
});

test("Phase 4 real nutrition totals remain central, target snapshots win, no premature empty state or seeded meals", () => {
  const f = fixture(
    mealSource,
    "BulkNutritionLog",
    { ...mealProps, legacyTotals: { calories: 3000, protein: 100, carbs: 300, fat: 80 } },
    { day: { day: { targets: mealProps.currentTargets }, entries: [entry] } },
  );
  const summary = find(f.render(), "NutritionOverview").props.summary;
  assert.equal(summary.calories.consumed, 200);
  assert.equal(summary.calories.delta, 2300);
  assert.equal(summary.protein.consumed, 20);
  assert.equal(summary.carbs.consumed, 15);
  assert.equal(summary.fat.consumed, 5);
  f.query.isLoading = true;
  assert.doesNotMatch(texts(f.render()), /Nothing logged for this day/);
  f.query.isLoading = false;
  f.query.data = { day: null, entries: [] };
  assert.equal(find(f.render(), "NutritionOverview").props.summary.calories.consumed, 3000);
  assert.match(texts(f.render()), /individual meals were not recorded/);
  assert.match(texts(f.render()), /No meal presets yet/);
});

test("Phase 4 routes retain Today, invitation, local calendar, native Back and unchanged workout entry", async () => {
  const actions = Object.fromEntries(LOG_ACTIONS.map((a) => [a.key, a.to]));
  assert.equal(actions["weigh-in"], "/bulk/morning");
  assert.equal(actions.meal, "/bulk/meals/add");
  assert.equal(actions.workout, "/bulk/training");
  assert.equal(mainTabForPath("/bulk/morning"), "today");
  assert.equal(mainTabForPath("/bulk/meals/add"), "today");
  assert.equal(isFocusScreen("/bulk/morning"), false); // CheckIn HTML retains the shared bar.
  const [today, morning, add, calendar, guard] = await Promise.all([
    read("src/routes/_authenticated/bulk/index.tsx"),
    read("src/routes/_authenticated/bulk/morning.tsx"),
    read("src/routes/_authenticated/bulk/meals_.add.tsx"),
    read("src/lib/use-local-day.ts"),
    read("src/routes/_authenticated/bulk/route.tsx"),
  ]);
  assert.match(today, /<ChallengeInviteReceiver \/>/);
  assert.match(today, /useBulkNutritionDay\(publicGoal \? id : null, today\)/);
  assert.match(today, /collectCompletedWorkouts/);
  assert.match(today, /restDay: !rest/);
  assert.doesNotMatch(today, /MEAL_PLANS|WORKOUT_TYPES\.map|useActivities/);
  assert.match(morning, /key=\{`\$\{bulkId\}:\$\{today\}`\}/);
  assert.match(morning, /weights\.isLoading/);
  assert.match(add, /mode="add"/);
  assert.match(calendar, /visibilitychange/);
  assert.doesNotMatch(calendar, /toISOString/);
  assert.match(guard, /location\.pathname === "\/bulk"/);
  for (const source of [checkSource, mealSource, today, morning, add])
    assert.doesNotMatch(source, /location\.reload|SUPABASE_SERVICE_ROLE_KEY/);
  // Existing local-calendar utility avoids UTC day shifting at the local midnight boundary.
  const before = new Date(2026, 9, 3, 23, 59);
  const after = new Date(2026, 9, 4, 0, 0);
  assert.equal(iso(before), "2026-10-03");
  assert.equal(iso(after), "2026-10-04");
});

test("Phase 4 Today renders persisted habits and invitation, then skeleton/error instead of false empty state", async () => {
  const source = await read("src/routes/_authenticated/bulk/index.tsx");
  const q = (data) => ({ data, isLoading: false, error: null });
  const weight = q([{ logDate: "2026-10-03", weightKg: 81.6 }]);
  const dailyNutrition = q({ day: { targets: mealProps.currentTargets }, entries: [entry] });
  const membership = q([{ is_public: true }]);
  const f = fixture(
    source,
    "Route",
    {},
    {
      modules: {
        "@/components/AppShell": { AppShell: "AppShell" },
        "@/components/PageSkeleton": { PageSkeleton: "PageSkeleton" },
        "@/components/TodayChallenge": { TodayChallenge: "TodayChallenge" },
        "@/components/ChallengeInviteReceiver": {
          ChallengeInviteReceiver: "ChallengeInviteReceiver",
        },
        "@/lib/use-local-day": { useLocalDay: () => "2026-10-03" },
        "@/lib/bulk-access": {
          preferredBulkMembership: () => ({ is_public: true }),
          useMemberships: () => membership,
        },
        "@/lib/store": {
          useAppData: () => ({
            days: { "2026-10-03": { sleepHours: 7.25, sleepQuality: 4 } },
            workouts: {},
            targets: mealProps.currentTargets,
          }),
          useBulkMeta: () => ({ bulkId: "owner" }),
          useActions: () => ({ saveDay() {} }),
        },
        "@/lib/bulk-progress-query": { useBulkWeights: () => weight },
        "@/lib/bulk-nutrition-query": { useBulkNutritionDay: () => dailyNutrition },
        "@/lib/bulk-training-sessions": {
          useCompletedSessionDates: () => q([]),
          useActiveBulkTrainingSession: () => q(null),
        },
        "@/lib/training-plans-query": {
          useActiveTrainingPlan: () => q({ name: "My actual plan", trainingDaysPerWeek: 3 }),
        },
        "@/lib/goal-metrics": {
          collectCompletedWorkouts: () => [],
          countWorkoutsInRange: () => 0,
          resolveWeeklyWorkoutTarget: () => 3,
        },
      },
    },
  );
  const tree = f.render();
  assert.match(texts(tree), /81.6 kg/);
  assert.match(texts(tree), /7.25 hours/);
  assert.match(texts(tree), /200 of 2500 kcal/);
  assert.match(texts(tree), /My actual plan/);
  assert.ok(find(tree, "ChallengeInviteReceiver"));
  weight.isLoading = true;
  assert.ok(find(f.render(), "PageSkeleton"));
  assert.doesNotMatch(texts(f.render()), /Add today's weight|200 of 2500 kcal/);
  weight.isLoading = false;
  weight.error = new Error("network");
  assert.ok(find(f.render(), "DataError"));
});

test("Phase 4 legacy check-in retains separate JSON weight path without normalized data writes", async () => {
  const f = fixture(checkSource, "DailyCheckIn", {
    ...checkProps,
    publicGoal: false,
    weight: 77.5,
    day: { sleepHours: 8, sleepQuality: 5 },
  });
  nodes(f.render(), (n) => n.props?.["aria-busy"] != null)[0].props.onClick();
  await new Promise((r) => setImmediate(r));
  assert.equal(f.calls.filter(([n]) => n === "saveWeight").length, 0);
  const day = f.calls.find(([n]) => n === "saveDay");
  assert.equal(day[1], "2026-10-03");
  assert.equal(day[2].weight, 77.5);
  assert.equal(day[2].sleepHours, 8);
  assert.equal(day[2].sleepQuality, 5);
});
