import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { trackedLiftSummary, bodyweightTrend } from "../src/lib/progress-presentation.ts";
import { presentationComponent } from "./presentation-component-fixture.mjs";

const range = { start: "2026-09-01", end: "2026-10-09" };
const record = (name, performances, side = null) => ({
  name,
  key: `${name}:${side}`,
  isBodyweight: false,
  side,
  performances,
});
const improved = [
  { date: "2026-09-01", load: 20, reps: 10 },
  { date: "2026-10-01", load: 22, reps: 10 },
];

test("tracked denominator includes configured lifts without logs or comparable period history", () => {
  const records = [
    record("A", improved),
    record(
      "B",
      improved.map((p) => ({ ...p, load: 20 })),
    ),
    record("C", [{ date: "2026-08-01", load: 10, reps: 10 }]),
    record("D", [{ date: "2026-09-01", load: 10, reps: 10 }]),
  ];
  assert.deepEqual(trackedLiftSummary(records, ["A", "B", "C", "D", "E"], range), {
    total: 5,
    comparable: 2,
    up: 1,
  });
  assert.deepEqual(trackedLiftSummary(records, [], range), { total: 0, comparable: 0, up: 0 });
  assert.deepEqual(trackedLiftSummary(records, ["A"], range), { total: 1, comparable: 1, up: 1 });
  assert.deepEqual(trackedLiftSummary(records, ["E"], range), { total: 1, comparable: 0, up: 0 });
});

test("configured lift counts once across unilateral records; changing configuration updates both counts", () => {
  const records = [record("A", improved, "left"), record("A", improved, "right")];
  assert.deepEqual(trackedLiftSummary(records, ["A", "B"], range), {
    total: 2,
    comparable: 1,
    up: 1,
  });
  assert.deepEqual(trackedLiftSummary(records, ["B", "C", "D", "E", "F"], range), {
    total: 5,
    comparable: 0,
    up: 0,
  });
});

test("numerator remains positive same-rep working-load change, not estimated 1RM or PR count", () => {
  const records = [
    record(
      "A",
      improved.map((p, i) => ({ ...p, reps: i ? 12 : 10 })),
    ),
    record(
      "B",
      improved.map((p, i) => ({ ...p, load: i ? 19 : 20 })),
    ),
  ];
  assert.deepEqual(trackedLiftSummary(records, ["A", "B"], range), {
    total: 2,
    comparable: 1,
    up: 0,
  });
});

for (const [goal, delta, expected] of [
  [{ startWeight: 60, targetWeight: 75, goal: "gain" }, 1, "positive"],
  [{ startWeight: 60, targetWeight: 75, goal: "gain" }, -1, "negative"],
  [{ startWeight: 80, targetWeight: 60, goal: "cut" }, -1, "positive"],
  [{ startWeight: 80, targetWeight: 60, goal: "cut" }, 1, "negative"],
])
  test(`body arrow ${goal.goal} ${delta} kg is truthful and ${expected}`, () => {
    const result = bodyweightTrend(delta, 70, goal);
    assert.equal(result.arrow, delta > 0 ? "↑" : "↓");
    assert.equal(result.tone, expected);
    assert.match(
      result.label,
      new RegExp(expected === "positive" ? "toward goal" : "away from goal"),
    );
  });

test("body arrow is neutral without directional goal or with a change rounding to zero", () => {
  for (const goal of [
    {},
    { startWeight: 70, targetWeight: 70 },
    { startWeight: 60, targetWeight: 75, goal: "maintain" },
  ]) {
    assert.equal(bodyweightTrend(1, 70, goal).tone, "neutral");
    assert.equal(bodyweightTrend(-1, 70, goal).arrow, "↓");
  }
  assert.deepEqual(bodyweightTrend(0.01, 70, {}), {
    arrow: "→",
    tone: "neutral",
    label: "Weight effectively unchanged",
  });
  assert.equal(bodyweightTrend(null, 70, {}), undefined);
  assert.equal(bodyweightTrend(NaN, 70, {}), undefined);
  assert.equal(bodyweightTrend(1, 76, { startWeight: 60, targetWeight: 75 }).tone, "negative");
});

test("meal deletion uses the shared accessible Radix confirmation for entries and presets", () => {
  const jsx = (type, props) => ({ type, props });
  const primitives = Object.fromEntries(
    [
      "AlertDialog",
      "AlertDialogAction",
      "AlertDialogCancel",
      "AlertDialogContent",
      "AlertDialogDescription",
      "AlertDialogFooter",
      "AlertDialogHeader",
      "AlertDialogTitle",
    ].map((name) => [name, name]),
  );
  class Focusable {
    isConnected = true;
    focused = false;
    focus() {
      this.focused = true;
    }
  }
  const trigger = new Focusable();
  const { MealDeleteDialog } = presentationComponent(
    "src/components/MealDeleteDialog.tsx",
    {
      "react/jsx-runtime": { jsx, jsxs: jsx },
      react: { useRef: (initial) => ({ current: initial }) },
      "@/components/ui/alert-dialog": primitives,
    },
    { document: { activeElement: trigger }, HTMLElement: Focusable },
  );
  const walk = (node) =>
    !node || typeof node !== "object"
      ? []
      : Array.isArray(node)
        ? node.flatMap(walk)
        : [node, ...walk(node.props?.children)];
  const text = (node) =>
    typeof node === "string"
      ? node
      : Array.isArray(node)
        ? node.map(text).join("")
        : text(node?.props?.children ?? "");
  let confirmed = 0;
  const tree = MealDeleteDialog({
    name: "Beef day",
    open: true,
    onOpenChange() {},
    onConfirm() {
      confirmed++;
    },
  });
  const nodes = walk(tree);
  assert.equal(text(nodes.find((n) => n.type === "AlertDialogTitle")), "Delete meal?");
  assert.equal(
    text(nodes.find((n) => n.type === "AlertDialogDescription")),
    "“Beef day” will be removed from this day.",
  );
  assert.match(nodes.find((n) => n.type === "AlertDialogCancel").props.className, /h-12/);
  const action = nodes.find((n) => n.type === "AlertDialogAction");
  assert.match(action.props.className, /bg-danger/);
  const content = nodes.find((n) => n.type === "AlertDialogContent");
  content.props.onOpenAutoFocus();
  let prevented = false;
  content.props.onCloseAutoFocus({
    preventDefault() {
      prevented = true;
    },
  });
  assert.equal(prevented, true);
  assert.equal(trigger.focused, true);
  trigger.isConnected = false;
  prevented = false;
  content.props.onCloseAutoFocus({
    preventDefault() {
      prevented = true;
    },
  });
  assert.equal(prevented, false); // Deleted buttons are never refocused.
  assert.equal(confirmed, 0);
  action.props.onClick();
  assert.equal(confirmed, 1);
  assert.match(
    text(MealDeleteDialog({ name: "Meal", preset: true })),
    /Already logged meals will stay unchanged/,
  );
  for (const file of ["BulkNutritionLog", "BulkMealPresets"]) {
    const source = readFileSync(`src/components/${file}.tsx`, "utf8");
    assert.match(source, /<MealDeleteDialog/);
    assert.doesNotMatch(source, /window\.confirm\(`Delete/);
  }
  const primitive = readFileSync("src/components/ui/alert-dialog.tsx", "utf8");
  assert.match(primitive, /@radix-ui\/react-alert-dialog/); // Retains Cancel-first focus, Escape and focus trapping.
});

test("shared status-bar cover stays outside transformed scrolling content and below dialogs", () => {
  const shell = readFileSync("src/components/AppShell.tsx", "utf8");
  assert.match(
    shell,
    /pointer-events-none fixed inset-x-0 top-0 z-\[45\] h-\[env\(safe-area-inset-top,0px\)\] bg-background/,
  );
  assert.ok(shell.indexOf("h-[env(safe-area-inset-top,0px)]") < shell.indexOf("<PullToRefresh>"));
  assert.match(shell, /pt-\[max\(1rem,env\(safe-area-inset-top\)\)\]/);
});

test("Meals keep complete numeric values and reserve readable unit controls on narrow screens", () => {
  const meals = readFileSync("src/components/BulkNutritionLog.tsx", "utf8");
  const presets = readFileSync("src/components/BulkMealPresets.tsx", "utf8");
  assert.match(meals, /consumed\.toLocaleString\(\)/);
  assert.match(meals, /text-\[28px\] min-\[360px\]:text-\[34px\]/);
  assert.match(meals, /max-w-\[min\(200px,100%\)\]/);
  assert.match(presets, /min-w-full flex-1.*min-\[360px\]:min-w-\[5rem\]/);
  assert.match(presets, /numberLabel\(meal.calories\)/);
  assert.doesNotMatch(presets, /num[^"\n]*truncate/);
});
