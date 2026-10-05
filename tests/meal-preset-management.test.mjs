import { test } from "node:test";
import assert from "node:assert/strict";
import { presentationComponent } from "./presentation-component-fixture.mjs";
import * as meals from "../src/lib/bulk-meal-presets.ts";

const jsx = (type, props) => ({ type, props });
const preset = (changes = {}) => ({
  id: "meal",
  bulkProfileId: "profile-a",
  name: "Beef day",
  description: "My saved meal",
  sortOrder: 1,
  calories: 600,
  protein: 40,
  carbs: 60,
  fat: 20,
  sourceKey: null,
  showInQuickAdd: true,
  ingredients: [],
  createdAt: "created",
  updatedAt: "version",
  ...changes,
});

function texts(tree) {
  if (tree == null || typeof tree === "boolean") return "";
  if (Array.isArray(tree)) return tree.map(texts).join(" ");
  if (["MealCard", "ActionButton", "IconButton"].includes(tree?.type?.name))
    return texts(tree.type(tree.props));
  return typeof tree === "object" ? texts(tree.props?.children) : String(tree);
}

function nodes(tree, predicate) {
  if (!tree || typeof tree !== "object") return [];
  if (Array.isArray(tree)) return tree.flatMap((child) => nodes(child, predicate));
  // Exercise the actual internal card/actions, not copies of their markup.
  if (["MealCard", "ActionButton", "IconButton"].includes(tree.type?.name))
    return nodes(tree.type(tree.props), predicate);
  return [...(predicate(tree) ? [tree] : []), ...nodes(tree.props?.children, predicate)];
}

const settle = () => new Promise((resolve) => setImmediate(resolve));

function manager(rows = [preset()]) {
  const slots = [];
  const calls = [];
  const invalidations = [];
  const confirmations = [];
  const query = { data: rows, isLoading: false, error: null };
  let index = 0;
  let confirm = true;
  let failure = false;
  const record = async (name, ...args) => {
    calls.push([name, ...args]);
    if (failure) throw new Error("Network unavailable");
    return "saved";
  };
  const { BulkMealPresets } = presentationComponent(
    "src/components/BulkMealPresets.tsx",
    {
      react: {
        useRef(initial) {
          return (slots[index++] ??= { current: initial });
        },
        useState(initial) {
          const i = index++;
          slots[i] ??= { value: typeof initial === "function" ? initial() : initial };
          return [
            slots[i].value,
            (value) => {
              slots[i].value = typeof value === "function" ? value(slots[i].value) : value;
            },
          ];
        },
        useMemo: (fn) => fn(),
      },
      "react/jsx-runtime": { jsx, jsxs: jsx },
      "@tanstack/react-query": {
        useQueryClient: () => ({
          invalidateQueries: async ({ queryKey }) => invalidations.push(queryKey),
        }),
      },
      "@/lib/bulk-meal-presets": meals,
      "@/lib/bulk-meal-presets-query": {
        useBulkMealPresets: () => query,
        bulkMealPresetsQueryKey: (profile) => ["bulk-meal-presets", profile],
        createBulkMealPreset: (...args) => record("create", ...args),
        updateBulkMealPreset: (...args) => record("edit", ...args),
        duplicateBulkMealPreset: (...args) => record("duplicate", ...args),
        deleteBulkMealPreset: (...args) => record("delete", ...args),
        moveBulkMealPreset: (...args) => record("move", ...args),
        setBulkMealPresetQuickAddVisibility: (...args) => record("visibility", ...args),
      },
      "@/lib/network-errors": { userFacingError: () => "Could not update your meals. Try again." },
      sonner: { toast: { success: (message) => calls.push(["success", message]) } },
      "@/components/ui/native-select": { NativeSelect: "NativeSelect" },
      "@/components/ui/button": { Button: "Button" },
      "@/components/ui/input": { Input: "Input" },
      "@/components/ui/textarea": { Textarea: "Textarea" },
      "@/components/ui/switch": { Switch: "Switch" },
      "@/components/ui-kit": new Proxy({}, { get: (_, name) => String(name) }),
    },
    {
      window: {
        confirm: (message) => {
          confirmations.push(message);
          return confirm;
        },
      },
    },
  );
  const render = () => {
    index = 0;
    return BulkMealPresets({ bulkProfileId: "profile-a" });
  };
  return {
    render,
    query,
    calls,
    invalidations,
    confirmations,
    click(button) {
      button.props.onClick();
    },
    setConfirm: (value) => {
      confirm = value;
    },
    setFailure: (value) => {
      failure = value;
    },
  };
}

const button = (tree, label) =>
  nodes(tree, (n) => ["button", "Button"].includes(n.type) && texts(n).trim() === label)[0];
const editor = (tree) => nodes(tree, (n) => n.type?.name === "MealEditor")[0];
const switchControl = (tree) => nodes(tree, (n) => n.type === "Switch")[0];

test("management distinguishes imported/custom source keys, never names, and keeps hidden presets", () => {
  const f = manager([
    preset({ showInQuickAdd: false }),
    preset({ id: "imported", sourceKey: "legacy:beef", sortOrder: 2 }),
  ]);
  const tree = f.render();
  assert.match(texts(tree), /Custom preset/);
  assert.match(texts(tree), /Imported preset/);
  const switches = nodes(tree, (n) => n.type === "Switch");
  assert.equal(switches.length, 2);
  assert.equal(switches[0].props.checked, false);
  assert.equal(switches[1].props.checked, true);
  assert.equal(switches[0].props["aria-label"], "Show Beef day in Quick Add");
  assert.ok(button(tree, "Edit"));
  assert.ok(button(tree, "Delete"));
});

test("show/hide uses the existing query key, waits for confirmation and blocks duplicate taps", async () => {
  const f = manager([preset({ showInQuickAdd: false })]);
  const toggle = switchControl(f.render());
  toggle.props.onCheckedChange(true);
  toggle.props.onCheckedChange(true);
  assert.deepEqual(f.calls, [["visibility", "meal", true]]);
  assert.equal(switchControl(f.render()).props.checked, false);
  assert.equal(switchControl(f.render()).props.disabled, true);
  await settle();
  assert.deepEqual(f.invalidations, [["bulk-meal-presets", "profile-a"]]);
  f.query.data = [preset()]; // Refetched server result, not an optimistic flip.
  assert.equal(switchControl(f.render()).props.checked, true);
  switchControl(f.render()).props.onCheckedChange(false);
  await settle();
  assert.deepEqual(
    f.calls.filter(([name]) => name === "visibility"),
    [
      ["visibility", "meal", true],
      ["visibility", "meal", false],
    ],
  );
});

test("failed visibility update stays local, preserves the row and allows retry", async () => {
  const f = manager();
  f.setFailure(true);
  switchControl(f.render()).props.onCheckedChange(false);
  await settle();
  assert.equal(switchControl(f.render()).props.checked, true);
  assert.equal(switchControl(f.render()).props.disabled, false);
  assert.equal(f.invalidations.length, 0);
  assert.match(texts(f.render()), /Try again/);
  assert.equal(
    f.calls.some(([name]) => name === "success"),
    false,
  );
  f.setFailure(false);
  switchControl(f.render()).props.onCheckedChange(false);
  await settle();
  assert.equal(f.invalidations.length, 1);
});

test("existing create/edit editor supports rename and macros, with immediate query updates", async () => {
  const f = manager([]);
  f.click(button(f.render(), "Create meal"));
  editor(f.render()).props.onChange({
    ...meals.emptyBulkMealDraft(),
    name: "Breakfast",
    calories: "400",
    protein: "30",
    carbs: "40",
    fat: "10",
  });
  editor(f.render()).props.onSave();
  await settle();
  const created = f.calls.find(([name]) => name === "create")[1];
  assert.equal(created.name, "Breakfast");
  assert.equal(created.calories, 400);
  assert.equal(editor(f.render()), undefined);
  f.query.data = [preset({ name: "Breakfast" })];
  assert.match(texts(f.render()), /Breakfast/);
  f.click(button(f.render(), "Edit"));
  editor(f.render()).props.onChange({
    ...editor(f.render()).props.state.draft,
    name: "Renamed breakfast",
    calories: "450",
  });
  editor(f.render()).props.onSave();
  await settle();
  const edited = f.calls.find(([name]) => name === "edit");
  assert.equal(edited[1].id, "meal");
  assert.equal(edited[2].name, "Renamed breakfast");
  assert.equal(edited[2].calories, 450);
  assert.equal(f.invalidations.length, 2);
});

test("duplicate and Move up/down retain existing actions; deletion remains confirmed", async () => {
  const f = manager([preset(), preset({ id: "second", name: "Second", sortOrder: 2 })]);
  f.click(button(f.render(), "Duplicate"));
  await settle();
  const down = nodes(f.render(), (n) => n.props?.["aria-label"] === "Move Beef day down")[0];
  f.click(down);
  await settle();
  assert.ok(
    f.calls.some(
      ([name, meal, direction]) => name === "move" && meal === "meal" && direction === 1,
    ),
  );
  assert.ok(f.calls.some(([name, meal]) => name === "duplicate" && meal === "meal"));
  f.setConfirm(false);
  f.click(button(f.render(), "Delete"));
  assert.equal(
    f.calls.some(([name]) => name === "delete"),
    false,
  );
  f.setConfirm(true);
  f.click(button(f.render(), "Delete"));
  await settle();
  assert.ok(f.calls.some(([name, meal]) => name === "delete" && meal === "meal"));
  assert.match(f.confirmations[0], /This cannot be undone/);
});

test("query maps visibility/source metadata while retaining all owned presets for management", async () => {
  const calls = [];
  const row = {
    id: "meal",
    bulk_profile_id: "profile-a",
    name: "Salmon day",
    sort_order: 1,
    calories: 2850,
    protein_g: 120,
    carbs_g: 369,
    fat_g: 96,
    source_key: "legacy:salmon",
    show_in_quick_add: false,
  };
  const query = presentationComponent("src/lib/bulk-meal-presets-query.ts", {
    "@tanstack/react-query": { queryOptions: (options) => options },
    "./network-errors": {},
    "@/integrations/supabase/client": {
      supabase: {
        from(table) {
          const request = {
            select: () => request,
            eq: (column, value) => {
              calls.push([column, value]);
              return request;
            },
            order: () =>
              Promise.resolve({ data: table === "bulk_meal_presets" ? [row] : [], error: null }),
          };
          return request;
        },
        rpc: async (...args) => {
          calls.push(args);
          return { data: true, error: null };
        },
      },
    },
  });
  const presets = await query.bulkMealPresetsQueryOptions("profile-a").queryFn();
  assert.equal(presets.length, 1);
  assert.equal(presets[0].sourceKey, "legacy:salmon");
  assert.equal(presets[0].showInQuickAdd, false);
  assert.deepEqual(calls[0], ["bulk_profile_id", "profile-a"]);
  await query.setBulkMealPresetQuickAddVisibility("meal", true);
  assert.deepEqual(JSON.parse(JSON.stringify(calls[1])), [
    "set_bulk_meal_preset_quick_add_visibility",
    { _meal: "meal", _visible: true },
  ]);
});
