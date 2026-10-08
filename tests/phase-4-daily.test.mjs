import { presentationComponent } from "./presentation-component-fixture.mjs";
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import vm from "node:vm";
import ts from "typescript";
import { checkInDraft, validateCheckIn } from "../src/lib/daily-check-in.ts";
import * as nutrition from "../src/lib/bulk-nutrition.ts";
import { challengeParticipation } from "../src/lib/challenge-participation.ts";
import * as goalMetrics from "../src/lib/goal-metrics.ts";
import { mainTabForPath, LOG_ACTIONS, isFocusScreen } from "../src/lib/main-navigation.ts";

const read = (p) => readFile(new URL(`../${p}`, import.meta.url), "utf8");
const require = createRequire(import.meta.url);
const checkSource = await read("src/components/DailyCheckIn.tsx");
const mealSource = await read("src/components/BulkNutritionLog.tsx");
const todaySource = await read("src/routes/_authenticated/bulk/index.tsx");
const challengeSource = await read("src/components/TodayChallenge.tsx");
const iso = (d) => require("date-fns").format(d, "yyyy-MM-dd");
const jsx = (type, props) =>
  ["MainPageHeader", "ChallengeParticipantHeading", "ChallengeStatus"].includes(type?.name)
    ? type(props)
    : { type, props };
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
    "@/lib/challenge-invitations": {
      useChallengeInvitations: () => ({ data: [], isLoading: false }),
    },
    "@/components/NotificationBell": { NotificationBell: "NotificationBell" },
    "@/lib/daily-check-in": { checkInDraft, validateCheckIn },
    "@/lib/calc": { iso },
    "@/lib/store": { useActions: () => ({ saveDay: (...a) => record("saveDay", ...a) }) },
    "@/lib/bulk-progress-query": {
      bulkWeightQueryKey: (id) => ["bulk-weight-entries", id],
      saveBulkWeight: (...a) => record("saveWeight", ...a),
    },
    "./MealDeleteDialog": { MealDeleteDialog: "MealDeleteDialog" },
    "./NutritionDateStrip": { NutritionDateStrip: "NutritionDateStrip" },
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
      if (name.includes("ui") || name === "lucide-react" || name.endsWith("TempoDateTimePicker"))
        return new Proxy({}, { get: (_, key) => String(key) });
      if (name.endsWith("/MainPageHeader") || name === "./MainPageHeader")
        return presentationComponent("src/components/MainPageHeader.tsx", {
          "react/jsx-runtime": { jsx, jsxs: jsx, Fragment: "fragment" },
          "./NotificationBell": { NotificationBell: "NotificationBell" },
        });
      if (name.endsWith("/ChallengeParticipant") || name === "./ChallengeParticipant")
        return presentationComponent("src/components/ChallengeParticipant.tsx", {
          "react/jsx-runtime": { jsx, jsxs: jsx, Fragment: "fragment" },
        });
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
const preset = {
  ...entry,
  id: "preset",
  name: "My breakfast",
  sourceKey: null,
  showInQuickAdd: true,
};
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

test("Morning check-in keeps weight/sleep on the browser-local day and steps on the previous local day", async () => {
  const source = await read("src/lib/use-local-day.ts");
  const previousTimezone = process.env.TZ;
  const cases = [
    ["Europe/Stockholm", "2026-01-31T23:30:00Z", "2026-02-01", "2026-01-31"],
    ["Europe/Stockholm", "2025-12-31T23:30:00Z", "2026-01-01", "2025-12-31"],
    ["America/Los_Angeles", "2026-01-01T00:30:00Z", "2025-12-31", "2025-12-30"],
    ["Europe/Stockholm", "2026-03-28T23:30:00Z", "2026-03-29", "2026-03-28"],
    ["UTC", "2026-01-01T00:30:00Z", "2026-01-01", "2025-12-31"],
  ];
  try {
    for (const [timezone, timestamp, expectedDay, expectedYesterday] of cases) {
      process.env.TZ = timezone;
      const context = {
        exports: {},
        Date: class extends Date {
          constructor() {
            super(timestamp);
          }
        },
        require: (name) =>
          name === "react"
            ? { useState: (initial) => [initial(), () => {}], useEffect() {} }
            : { iso },
      };
      vm.runInNewContext(
        ts.transpileModule(source, {
          compilerOptions: { module: ts.ModuleKind.CommonJS },
        }).outputText,
        context,
      );
      const localDay = context.exports.useLocalDay();
      assert.equal(localDay, expectedDay, timezone);
      const f = fixture(checkSource, "DailyCheckIn", {
        ...checkProps,
        date: localDay,
        weight: 71.5,
        day: { sleepHours: 7.5, sleepQuality: 4 },
        yesterdayDay: { steps: 8000 },
      });
      nodes(f.render(), (n) => n.props?.["aria-busy"] != null)[0].props.onClick();
      await new Promise((resolve) => setImmediate(resolve));
      const weightWrite = f.calls.find(([name]) => name === "saveWeight");
      assert.equal(weightWrite[2].logDate, expectedDay);
      const todayWrite = f.calls.find(([name, date]) => name === "saveDay" && date === expectedDay);
      assert.equal(todayWrite[2].sleepHours, 7.5);
      assert.equal(todayWrite[2].sleepQuality, 4);
      assert.equal(
        f.calls.find(([name, date]) => name === "saveDay" && date === expectedYesterday)[2].steps,
        8000,
      );
    }
  } finally {
    if (previousTimezone == null) delete process.env.TZ;
    else process.env.TZ = previousTimezone;
  }
});

test("weight save sends the unchanged local date and device timezone to the RLS-preserving RPC", async () => {
  const source = await read("src/lib/bulk-progress-query.ts");
  const calls = [];
  let fail = false;
  const context = {
    exports: {},
    Intl: { DateTimeFormat: () => ({ resolvedOptions: () => ({ timeZone: "Europe/Stockholm" }) }) },
    require: (name) => {
      if (name === "@/integrations/supabase/client")
        return {
          supabase: {
            rpc: async (rpc, args) => {
              calls.push([rpc, args]);
              return { error: fail ? new Error("Offline") : null };
            },
          },
        };
      if (name === "./bulk-training-sessions")
        return {
          refreshActiveBulkTrainingBodyweight: async (profile) =>
            calls.push(["bodyweight", profile]),
        };
      return { queryOptions: (options) => options };
    },
  };
  vm.runInNewContext(
    ts.transpileModule(source, {
      compilerOptions: { module: ts.ModuleKind.CommonJS },
    }).outputText,
    context,
  );
  await context.exports.saveBulkWeight("owner", {
    logDate: "2026-02-01",
    weightKg: 71.5,
    note: "Keep",
  });
  assert.deepEqual(JSON.parse(JSON.stringify(calls)), [
    [
      "save_bulk_weight_for_local_day",
      {
        _profile: "owner",
        _log_date: "2026-02-01",
        _weight_kg: 71.5,
        _note: "Keep",
        _timezone: "Europe/Stockholm",
      },
    ],
    ["bodyweight", "owner"],
  ]);
  for (const note of [null, ""]) {
    await context.exports.saveBulkWeight("owner", {
      logDate: "2026-02-01",
      weightKg: 71.5,
      note,
    });
    assert.equal(calls.at(-2)[1]._note, note, "no-note values reach SQL without coercion");
  }
  fail = true;
  await assert.rejects(
    context.exports.saveBulkWeight("owner", { logDate: "2026-02-01", weightKg: 72, note: "Keep" }),
    /Offline/,
  );
  assert.equal(calls.filter(([name]) => name === "bodyweight").length, 3);
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
  find(f.render(), "NativeSelect").props.onChange({ target: { value: "preset" } });
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
  assert.equal(
    g.calls.some(([n]) => n === "deleteEntry"),
    false,
  );
  const deletion = find(g.render(), "MealDeleteDialog");
  assert.equal(deletion.props.open, true);
  deletion.props.onOpenChange(false);
  assert.equal(find(g.render(), "MealDeleteDialog").props.open, false);
  assert.equal(
    g.calls.some(([n]) => n === "deleteEntry"),
    false,
  );
  find(g.render(), "NutritionEntryCard").props.onDelete();
  const confirmed = find(g.render(), "MealDeleteDialog").props.onConfirm;
  confirmed();
  confirmed(); // The existing mutation guard still prevents duplicate deletion.
  await new Promise((r) => setImmediate(r));
  assert.equal(g.calls.filter(([n]) => n === "deleteEntry").length, 1);
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
  assert.doesNotMatch(texts(f.render()), /Open daily log/);
  assert.ok(
    nodes(f.render(), (n) => n.type === "Link").every((n) => n.props.to !== "/bulk/daily-log"),
  );
});

test("Quick Add exposes Manage and filters visibility without changing preset order", () => {
  const rows = [
    { ...preset, id: "first", name: "First" },
    { ...preset, id: "hidden", name: "Hidden", showInQuickAdd: false },
    { ...preset, id: "last", name: "Last" },
  ];
  const f = fixture(mealSource, "BulkNutritionLog", mealProps, { presets: rows });
  const tree = f.render();
  const manage = nodes(tree, (n) => n.type === "Link" && texts(n).trim() === "Manage")[0];
  assert.equal(manage.props.to, "/bulk/meals/presets");
  assert.equal(manage.props.preload, "intent");
  assert.match(manage.props.className, /min-h-11/);
  assert.deepEqual(
    nodes(tree, (n) => n.type?.name === "PresetQuickAdd").map((n) => n.props.preset.id),
    ["first", "last"],
  );
  assert.equal(rows[1].id, "hidden"); // Filtering does not remove it from management data.
});

test("empty/hidden Quick Add stays compact and links to the existing preset manager", () => {
  for (const rows of [[], [{ ...preset, showInQuickAdd: false }]]) {
    const f = fixture(mealSource, "BulkNutritionLog", mealProps, { presets: rows });
    const tree = f.render();
    assert.equal(nodes(tree, (n) => n.type?.name === "PresetQuickAdd").length, 0);
    assert.match(texts(tree), rows.length ? /No presets in Quick Add/ : /No meal presets yet/);
    const action = nodes(
      tree,
      (n) => n.type === "Link" && /^(Manage presets|Create meal preset)$/.test(texts(n).trim()),
    )[0];
    assert.equal(action.props.to, "/bulk/meals/presets");
    assert.match(action.props.className, /min-h-11/);
  }
});

test("Quick Add reacts to newly created presets and show/hide query updates without a reload", () => {
  const rows = [];
  const f = fixture(mealSource, "BulkNutritionLog", mealProps, { presets: rows });
  assert.equal(find(f.render(), "PresetQuickAdd"), undefined);
  rows.push({ ...preset });
  assert.equal(find(f.render(), "PresetQuickAdd").props.preset.id, "preset");
  rows[0] = { ...preset, showInQuickAdd: false };
  assert.equal(find(f.render(), "PresetQuickAdd"), undefined);
  rows[0] = { ...preset, showInQuickAdd: true };
  assert.equal(find(f.render(), "PresetQuickAdd").props.preset.id, "preset");
});

test("hidden Quick Add presets remain selectable through the normal Add meal flow", async () => {
  const f = fixture(
    mealSource,
    "BulkNutritionLog",
    { ...mealProps, mode: "add" },
    {
      presets: [{ ...preset, showInQuickAdd: false }],
    },
  );
  find(f.render(), "NativeSelect").props.onChange({ target: { value: "preset" } });
  assert.equal(find(f.render(), "NutritionEntryEditor").props.editor.draft.name, "My breakfast");
  find(f.render(), "NutritionEntryEditor").props.onSave();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(f.calls.find(([name]) => name === "logPreset")[1], "preset");
});

test("Phase 4 routes retain Today habits, inbox discovery, local calendar, Back and unchanged workout entry", async () => {
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
  assert.match(today, /<MainPageHeader title="Today"/);
  assert.doesNotMatch(today, /ChallengeInviteReceiver/);
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

test("Phase 4 Today renders persisted habits and bell, then skeleton/error instead of false empty state", async () => {
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
          useActiveTrainingPlan: () =>
            q({ name: "My actual plan", trainingDaysPerWeek: 3, days: [] }),
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
  assert.match(texts(tree), /7.25 h sleep/);
  assert.match(texts(tree), /200 of 2500 kcal/);
  assert.match(texts(tree), /My actual plan/);
  assert.ok(find(tree, "NotificationBell"));
  assert.equal(find(tree, "ChallengeInviteReceiver"), undefined);
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

function todayFixture({
  publicGoal = true,
  restDay = false,
  active = null,
  sessions = [],
  save,
  invites = [],
  weight = 81.6,
  sleep = 8,
  quality = 4,
  weeklyGoal = 6,
  plan = {
    id: "plan",
    name: "Original Tempo program",
    trainingDaysPerWeek: 3,
    days: [
      { id: "chest", name: "Chest & Back", order: 1 },
      { id: "legs", name: "Legs", order: 2 },
      { id: "arms", name: "Arms", order: 3 },
    ],
  },
} = {}) {
  const today = iso(new Date());
  const q = (data) => ({ data, isLoading: false, error: null });
  const data = {
    days: { [today]: { weight, sleepHours: sleep, sleepQuality: quality, restDay } },
    workouts: {},
    targets: { ...mealProps.currentTargets, weeklyWorkoutGoal: weeklyGoal, trainingDaysPerWeek: 3 },
  };
  const writes = [];
  const f = fixture(
    todaySource,
    "Route",
    {},
    {
      modules: {
        "@/components/AppShell": { AppShell: "AppShell" },
        "@/components/PageSkeleton": { PageSkeleton: "PageSkeleton" },
        "@/components/TodayChallenge": { TodayChallenge: "TodayChallenge" },
        "@/lib/challenge-invitations": { useChallengeInvitations: () => q(invites) },
        "@/lib/use-local-day": { useLocalDay: () => today },
        "@/lib/bulk-access": {
          preferredBulkMembership: () => ({ is_public: publicGoal }),
          useMemberships: () => q([]),
        },
        "@/lib/store": {
          useAppData: () => data,
          useBulkMeta: () => ({ bulkId: "owner" }),
          useActions: () => ({
            saveDay: async (date, patch) => {
              writes.push([date, { ...patch }]);
              await save?.(date, patch);
              Object.assign(data.days[date], patch);
            },
          }),
        },
        "@/lib/bulk-progress-query": {
          useBulkWeights: () => q(weight == null ? [] : [{ logDate: today, weightKg: weight }]),
        },
        "@/lib/bulk-nutrition-query": { useBulkNutritionDay: () => q({ day: null, entries: [] }) },
        "@/lib/bulk-training-sessions": {
          useCompletedSessionDates: () => q(sessions.map((s) => ({ workoutDate: today, ...s }))),
          useActiveBulkTrainingSession: () => q(publicGoal ? active : null),
        },
        "@/lib/training-plans-query": {
          useActiveTrainingPlan: () => q(publicGoal ? plan : null),
        },
        "@/lib/goal-metrics": goalMetrics,
      },
    },
  );
  return { ...f, writes, data, today };
}
const workoutGroup = (tree) =>
  nodes(tree, (n) => n.props?.role === "group" && n.props["aria-label"] === "Workout")[0];
const restButton = (tree) => nodes(workoutGroup(tree), (n) => n.type === "button")[0];
const settle = () => new Promise((r) => setImmediate(r));

test("Phase 4.1 incoming invitations do not displace habits; current Challenge follows with no duplicate discovery", () => {
  for (const invites of [[], [{ id: "pending" }]]) {
    const f = todayFixture({ invites });
    const tree = f.render();
    const summary = find(tree, "TodayChallenge");
    const ordered = nodes(tree, () => true);
    assert.equal(find(tree, "ChallengeInviteReceiver"), undefined);
    assert.ok(find(tree, "NotificationBell"));
    assert.ok(ordered.indexOf(workoutGroup(tree)) < ordered.indexOf(summary));
    assert.equal(summary.props.hideDiscovery, invites.length > 0);
    assert.doesNotMatch(texts(tree), /Daily log & legacy nutrition|Mark rest day/);
  }
});

test("Phase 4.1 weekly goal stays independent of plan frequency and inside Workout", () => {
  const f = todayFixture({
    sessions: [
      { id: "one", status: "completed" },
      { id: "two", status: "completed" },
      { id: "draft", status: "in_progress" },
    ],
  });
  const tree = f.render();
  assert.match(texts(workoutGroup(tree)), /2 of 6 this week/);
  assert.equal((texts(tree).match(/2 of 6 this week/g) ?? []).length, 1);
  assert.equal(nodes(tree, (n) => n.props?.["aria-label"] === "Complete").length, 2);
  assert.match(texts(tree), /2\s+of\s+3\s+done/);
  assert.equal(restButton(tree), undefined); // Actual completed workout takes precedence over rest controls.
  const legacy = todayFixture({ publicGoal: false });
  legacy.data.workouts[legacy.today] = { date: legacy.today, status: "completed" };
  // Reaching the 2,500 kcal target is what completes the Meals habit (logging alone is not enough).
  legacy.data.days[legacy.today].calories = 2500;
  assert.match(texts(workoutGroup(legacy.render())), /Workout completed · 1 of 6 this week/);
  assert.match(texts(legacy.render()), /3\s+of\s+3\s+done/);
});

test("Phase 4.1 rest day and Undo retain existing persisted field and completion semantics", async () => {
  const f = todayFixture();
  assert.match(texts(f.render()), /1\s+of\s+3\s+done/);
  assert.match(texts(workoutGroup(f.render())), /Start/);
  restButton(f.render()).props.onClick();
  await settle();
  assert.deepEqual(f.writes, [[f.today, { restDay: true }]]);
  assert.match(texts(workoutGroup(f.render())), /Workout\s+Rest day\s+Undo/);
  assert.equal(texts(restButton(f.render())), "Undo");
  assert.doesNotMatch(texts(workoutGroup(f.render())), /Start/);
  assert.match(texts(f.render()), /2\s+of\s+3\s+done/);
  restButton(f.render()).props.onClick();
  await settle();
  assert.deepEqual(f.writes[1], [f.today, { restDay: false }]);
  assert.match(texts(f.render()), /1\s+of\s+3\s+done/);
});

test("Phase 4.1 rest writes block duplicate taps, show pending and preserve state after failure", async () => {
  let reject;
  const f = todayFixture({
    save: () =>
      new Promise((_, fail) => {
        reject = fail;
      }),
  });
  const tap = restButton(f.render()).props.onClick;
  tap();
  tap();
  assert.equal(f.writes.length, 1);
  assert.equal(restButton(f.render()).props.disabled, true);
  assert.equal(texts(restButton(f.render())), "Saving…");
  assert.match(texts(f.render()), /1\s+of\s+3\s+done/);
  reject(new Error("offline"));
  await settle();
  assert.equal(f.data.days[f.today].restDay, false);
  assert.equal(restButton(f.render()).props.disabled, false);
  assert.match(texts(workoutGroup(f.render())), /Could not save rest day/);
});

test("Phase 4.1 active workout shows actual name and Resume even with persisted rest state", () => {
  for (const restDay of [false, true]) {
    const f = todayFixture({ restDay, active: { id: "session", workoutDayName: "Chest & Back" } });
    const group = workoutGroup(f.render());
    assert.match(texts(group), /Chest & Back · 0 of 6 this week/);
    assert.match(texts(group), /Resume/);
    assert.equal(nodes(group, (n) => n.type === "Link")[0].props.to, "/bulk/training");
    assert.equal(
      nodes(f.render(), (n) => n.props?.["aria-label"] === "Complete").length,
      restDay ? 2 : 1,
    );
  }
});

test("Today Workout uses the real next day and one compact weekly subtitle with Start and muted Rest day", () => {
  const f = todayFixture({ weeklyGoal: 5 });
  const group = workoutGroup(f.render());
  assert.match(texts(group), /Workout\s+Chest & Back · 0 of 5 this week\s+Start\s+Rest day/);
  assert.doesNotMatch(
    texts(group),
    /Original Tempo program|My Training Plan|Taking a rest day|In progress/,
  );
  const links = nodes(group, (n) => n.type === "Link");
  assert.ok(links.every((link) => link.props.to === "/bulk/training"));
  assert.ok(links.every((link) => link.props.className.includes("min-h-11")));
  assert.match(restButton(f.render()).props.className, /min-h-11.*text-muted-foreground/);
  assert.equal(f.writes.length, 0);
});

test("Today Workout next-day display follows Training's first unfinished day without changing the plan or starting a session", () => {
  const yesterday = iso(require("date-fns").addDays(new Date(), -1));
  const f = todayFixture({
    sessions: [{ id: "earlier", status: "completed", planDayId: "chest", workoutDate: yesterday }],
  });
  assert.match(texts(workoutGroup(f.render())), /Legs · \d of 6 this week/);
  assert.equal(f.writes.length, 0);
  assert.deepEqual(f.destinations, []);
});

test("Today Workout completed state retains the completed plan-day name, green check and no Start", () => {
  const f = todayFixture({
    weeklyGoal: 5,
    sessions: [{ id: "finished", status: "completed", planDayId: "chest" }],
  });
  const group = workoutGroup(f.render());
  assert.match(texts(group), /Chest & Back · 1 of 5 this week\s+Workout completed/);
  assert.doesNotMatch(texts(group), /Start|Resume|Rest day|Legs/);
  const check = nodes(group, (n) => n.props?.["aria-label"] === "Complete")[0];
  assert.match(check.props.className, /bg-primary/);
});

test("Today Workout active state shows the real session day and only Resume, not rest prompts", () => {
  const group = workoutGroup(
    todayFixture({ active: { id: "active", workoutDayName: "Arms" }, weeklyGoal: 5 }).render(),
  );
  assert.match(texts(group), /Arms · 0 of 5 this week\s+Resume/);
  assert.doesNotMatch(texts(group), /Start|Rest day|Taking a rest day|Chest & Back/);
});

test("Today Workout no-plan state links to the existing setup destination without inventing a workout", () => {
  const f = todayFixture({ plan: null });
  const group = workoutGroup(f.render());
  assert.match(texts(group), /Workout\s+Choose a training plan\s+Choose plan/);
  assert.doesNotMatch(texts(group), /Chest & Back|Legs|Arms|My Training Plan|Start/);
  assert.ok(
    nodes(group, (n) => n.type === "Link").every((link) => link.props.to === "/bulk/training"),
  );
  assert.equal(f.writes.length, 0);
});

test("Today Workout only falls back to the actual program name when no day name is available", () => {
  const f = todayFixture({ plan: { name: "My Training Plan", trainingDaysPerWeek: 3, days: [] } });
  assert.match(texts(workoutGroup(f.render())), /My Training Plan · 0 of 6 this week/);
  const legacy = todayFixture({ publicGoal: false });
  legacy.data.workouts[legacy.today] = { date: legacy.today, status: "completed", type: "Legs" };
  assert.match(texts(workoutGroup(legacy.render())), /Legs · 1 of 6 this week\s+Workout completed/);
});

for (const publicGoal of [true, false]) {
  for (const [weight, sleep, subtitle, complete] of [
    [undefined, undefined, "Add weight and sleep", false],
    [63, undefined, "63 kg · add sleep", false],
    [undefined, 8, "8 h sleep · add weight", false],
    [63, 8, "63 kg · 8 h sleep", true],
    [63.5, 7.25, "63.5 kg · 7.25 h sleep", true],
    [63, 0, "63 kg · 0 h sleep", true],
  ]) {
    test(`Today ${publicGoal ? "public" : "legacy"} Morning check-in aggregates real weight=${weight} sleep=${sleep}`, () => {
      const f = todayFixture({ publicGoal, weight: weight ?? null, sleep: sleep ?? null });
      const tree = f.render();
      const morning = nodes(
        tree,
        (node) => node.type === "Link" && node.props.to === "/bulk/morning",
      );
      assert.equal(morning.length, 1, "one Morning check-in replaces Weight and Sleep");
      assert.match(texts(morning[0]), /Morning check-in/);
      assert.ok(texts(morning[0]).includes(subtitle));
      assert.equal(
        nodes(morning[0], (node) => node.props?.["aria-label"] === "Complete").length,
        Number(complete),
      );
      assert.match(texts(tree), complete ? /1\s+of\s+3\s+done/ : /0\s+of\s+3\s+done/);
      assert.doesNotMatch(texts(tree), /Weigh-in|Add sleep and quality|of 4 done/);
      assert.equal(f.writes.length, 0, "Today is presentation only, not a check-in mutation");
    });
  }
}

test("Today combines weight and sleep visually without changing the separate Goal requirements", () => {
  const f = todayFixture({ weight: 63, sleep: 8, quality: null });
  assert.match(texts(f.render()), /63 kg · 8 h sleep/);
  assert.match(texts(f.render()), /1\s+of\s+3\s+done/);
  const requirements = goalMetrics.dayCompletionRequirements({
    bodyweightRecorded: true,
    sleepRecorded: false,
    activityRecorded: false,
    mealLogged: false,
    workoutCompleted: false,
    restDay: false,
  });
  assert.equal(requirements.find((r) => r.key === "bodyweight").done, true);
  assert.equal(requirements.find((r) => r.key === "sleep").done, false);
});

function challengeFixture({
  challenge = { id: "challenge", timezone: "Europe/Stockholm", duration_weeks: 52 },
  hideDiscovery = false,
  target = 15,
  loading = false,
  error = null,
} = {}) {
  const q = (data) => ({ data, isLoading: false, error: null });
  return fixture(
    challengeSource,
    "TodayChallenge",
    { hideDiscovery },
    {
      modules: {
        "@/lib/auth": { useAuth: () => ({ user: { id: "me" } }) },
        "@/lib/challenge-participation": {
          challengeParticipation,
          usePendingChallengeRefresh: () => Date.now(),
        },
        "./ChallengeShareInvite": { ChallengeShareInvite: "ChallengeShareInvite" },
        "@/lib/challenge": {
          useMyChallenge: () => ({ ...q(challenge), isLoading: loading, error }),
          useOutgoingInvitation: () => q(null),
          useChallengeMembers: () =>
            q([
              { userId: "me", name: "Me" },
              { userId: "opponent", name: "Alex" },
            ]),
          useActivitySummary: () => q([{ userId: "me", equivalent: 12.4 }]),
          useWeekTargets: () => q([]),
          useTravelPauses: () => q([]),
          weekNumberOf: () => 1,
          todayIn: () => "2026-10-03",
          weekBounds: () => ({ start: "2026-09-28", end: "2026-10-05" }),
          resolvedTargetForWeek: () => target,
          hoursLeft: () => 70,
          weekPenaltyMessage: () => ({ atRisk: true, line: "At risk: €5" }),
        },
      },
    },
  );
}

test("Today active Challenge uses handoff hierarchy, real progress and routes to Challenge", () => {
  const tree = challengeFixture().render();
  assert.equal(tree.type, "Link");
  assert.equal(tree.props.to, "/challenge");
  assert.match(texts(tree), /Challenge with Alex/);
  assert.match(texts(tree), /3\s+days left/);
  assert.match(texts(tree), /12.4\s+\/\s+15\s+km/);
  const progress = nodes(tree, (n) => n.props?.role === "progressbar")[0];
  assert.equal(progress.props["aria-valuenow"], 12.4);
  assert.equal(progress.props["aria-valuemax"], 15);
  assert.equal(progress.props.children.props.style.width, `${(12.4 / 15) * 100}%`);
  assert.match(challengeSource, /<ChallengeParticipantHeading\s+label="You"/);
  assert.match(texts(tree), /Alex\s+0.0\s+km/);
  const paused = challengeFixture({ target: 0 }).render();
  assert.match(texts(paused), /Week paused · no penalty/);
  assert.equal(
    nodes(paused, (n) => n.props?.role === "progressbar")[0].props.children.props.style.width,
    "0%",
  );
});

test("Phase 4.1 no-Challenge discovery is one persistent row; pending invitations suppress only discovery", () => {
  const tree = challengeFixture({ challenge: null }).render();
  assert.equal(tree.type, "Link");
  assert.equal(tree.props.to, "/challenge");
  assert.equal(texts(tree), "Challenge Start one with a friend ");
  assert.equal(challengeFixture({ challenge: null, hideDiscovery: true }).render(), null);
  assert.equal(challengeFixture({ hideDiscovery: true }).render().type, "Link");
  assert.equal(
    find(challengeFixture({ error: new Error("network") }).render(), "DataError").props.message,
    "Could not load your challenge.",
  );
  assert.equal(challengeFixture({ loading: true }).render().type.name, "SummarySkeleton");
});

test("obsolete Daily Log is absent from Profile/Today and its bookmark redirects to current Today", async () => {
  const profile = await read("src/routes/_authenticated/profile.tsx");
  const route = await read("src/routes/_authenticated/bulk/daily-log.tsx");
  const shell = await read("src/components/AppShell.tsx");
  assert.doesNotMatch(todaySource, /Daily log|\/bulk\/daily-log/);
  assert.doesNotMatch(profile, /Compatibility tools|Daily log|\/bulk\/daily-log/);
  assert.match(route, /createFileRoute\("\/_authenticated\/bulk\/daily-log"\)/);
  assert.match(route, /redirect\(\{ to: "\/bulk", replace: true \}\)/);
  assert.doesNotMatch(route, /component:|useAppData|saveDay|MEAL_PLANS/);
  assert.match(shell, /pathname.startsWith\("\/bulk\/training"\)/);
  assert.match(shell, /widerDailyLayout \? "max-w-2xl" : "max-w-lg"/);
});
