import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";
import ts from "typescript";
import * as plans from "../src/lib/training-plans.ts";
import { TRAINING_SETUP_OPTIONS } from "../src/lib/bulk-onboarding.ts";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");
const source = await read("src/components/TrainingPlanSetup.tsx");
const jsx = (type, props) => ({ type, props });
function nodes(tree, predicate) {
  if (tree == null || typeof tree !== "object") return [];
  if (Array.isArray(tree)) return tree.flatMap((item) => nodes(item, predicate));
  if (typeof tree.type === "function") return nodes(tree.type(tree.props), predicate);
  return [...(predicate(tree) ? [tree] : []), ...nodes(tree.props?.children, predicate)];
}
function text(tree) {
  if (tree == null || typeof tree === "boolean") return "";
  if (Array.isArray(tree)) return tree.map(text).join(" ");
  if (typeof tree !== "object") return String(tree);
  if (typeof tree.type === "function") return text(tree.type(tree.props));
  return text(tree.props?.children);
}
const template = {
  id: "template",
  name: "Tempo full body",
  description: "A real template",
  experienceLevel: "beginner",
  trainingDaysPerWeek: 3,
  requiredEquipment: ["dumbbells"],
  splitSummary: "Full body",
  days: [],
};
function fixture(preference, replacingPlan = false, templateError = null) {
  const slots = [],
    calls = [],
    invalidated = [];
  let index = 0;
  const write = async (name, ...args) => {
    calls.push([name, ...args]);
    return "plan";
  };
  const modules = {
    react: {
      useState(initial) {
        const slot = index++;
        slots[slot] ??= { value: typeof initial === "function" ? initial() : initial };
        return [
          slots[slot].value,
          (next) => {
            slots[slot].value = next;
          },
        ];
      },
      useRef(initial) {
        return (slots[index++] ??= { current: initial });
      },
      useMemo: (fn) => fn(),
    },
    "react/jsx-runtime": { jsx, jsxs: jsx },
    "@tanstack/react-query": {
      useQueryClient: () => ({
        invalidateQueries: async ({ queryKey }) => invalidated.push(queryKey),
      }),
    },
    "@/lib/training-plans": plans,
    "@/lib/bulk-onboarding": { TRAINING_SETUP_OPTIONS },
    "@/lib/training-plans-query": {
      useTrainingPlanTemplates: () => ({
        data: [template],
        isLoading: false,
        error: templateError,
      }),
      instantiateTrainingPlan: (...args) => write("instantiate", ...args),
      switchTrainingPlan: (...args) => write("switch", ...args),
      createEmptyTrainingPlan: (...args) => write("createCustom", ...args),
      switchToEmptyTrainingPlan: (...args) => write("switchCustom", ...args),
    },
    sonner: { toast: { success() {}, error() {} } },
    "@/lib/network-errors": { userFacingError: () => "Could not load plans" },
  };
  const context = {
    exports: {},
    require: (name) => modules[name] ?? new Proxy({}, { get: (_, key) => String(key) }),
  };
  vm.runInNewContext(
    ts.transpileModule(source, {
      compilerOptions: {
        target: ts.ScriptTarget.ES2022,
        module: ts.ModuleKind.CommonJS,
        jsx: ts.JsxEmit.ReactJSX,
      },
    }).outputText,
    context,
  );
  return {
    calls,
    invalidated,
    render() {
      index = 0;
      return context.exports.TrainingPlanSetup({
        targets: {
          trainingSetupPreference: preference,
          experienceLevel: "beginner",
          trainingDaysPerWeek: 3,
          availableEquipment: ["dumbbells"],
        },
        replacingPlan,
      });
    },
  };
}
const button = (tree, label) =>
  nodes(
    tree,
    (node) => (node.type === "button" || node.type === "Button") && text(node).trim() === label,
  )[0];

test("AI setup is explicitly coming soon and never renders or creates a template, including old generated preferences", () => {
  for (const preference of ["generated", "tempo_preset", "custom"]) {
    const f = fixture(preference, true, new Error("Templates offline"));
    const tree = f.render();
    const ai = nodes(
      tree,
      (node) => node.props?.role === "radio" && text(node).includes("Generate with AI"),
    )[0];
    assert.equal(ai.props.disabled, true);
    assert.match(text(ai), /Coming soon/);
    if (preference === "generated") {
      assert.match(text(tree), /Coming soon\. Choose a Tempo program or create your own/);
      assert.doesNotMatch(text(tree), /Use this plan|Tempo full body|No training plans/);
    }
    assert.equal(f.calls.length, 0);
  }
});

test("Tempo selection keeps the template path while custom selection keeps empty-plan creation and refresh", async () => {
  for (const replacing of [false, true]) {
    const f = fixture("generated", replacing);
    nodes(
      f.render(),
      (node) => node.props?.role === "radio" && text(node).trim() === "Choose a Tempo program",
    )[0].props.onClick();
    assert.match(text(f.render()), /Tempo full body/);
    button(f.render(), "Use this plan").props.onClick();
    await new Promise((resolve) => setImmediate(resolve));
    assert.deepEqual(JSON.parse(JSON.stringify(f.calls)), [
      [replacing ? "switch" : "instantiate", "template", "tempo_preset"],
    ]);
    assert.ok(f.invalidated.some((key) => key[0] === "bulk-training-plan"));

    const custom = fixture("tempo_preset", replacing);
    nodes(
      custom.render(),
      (node) => node.props?.role === "radio" && text(node).trim() === "Create my own program",
    )[0].props.onClick();
    assert.match(text(custom.render()), /Start with an empty plan/);
    assert.equal(button(custom.render(), "Use this plan"), undefined);
    button(custom.render(), "Create My Training Plan").props.onClick();
    await new Promise((resolve) => setImmediate(resolve));
    assert.deepEqual(JSON.parse(JSON.stringify(custom.calls)), [
      [replacing ? "switchCustom" : "createCustom", "My Training Plan"],
    ]);
  }
});

test("onboarding shows the same three compact setup choices with AI disabled and slimmer 44px actions", async () => {
  const onboarding = await read("src/routes/_authenticated/bulk-onboarding.tsx");
  assert.match(onboarding, /disabled=\{option\.comingSoon\}/);
  assert.match(onboarding, /Coming soon/);
  assert.match(onboarding, /mt-4 grid grid-cols-2 gap-2/);
  assert.match(onboarding, /<BackButton/);
  assert.match(onboarding, /className="justify-center"/);
  assert.doesNotMatch(onboarding, /training plans arrive|later rollout segments/);
  assert.match(source, /disclosure-summary min-h-11/);
  assert.doesNotMatch(source, /Templates, generated or custom/);
});
