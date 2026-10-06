import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import vm from "node:vm";
import ts from "typescript";
import * as domain from "../src/lib/bulk-training-session-domain.ts";
import * as plans from "../src/lib/training-plans.ts";
import { TRAINING_SETUP_OPTIONS } from "../src/lib/bulk-onboarding.ts";
import * as progression from "../src/lib/bulk-progression.ts";
import * as guidance from "../src/lib/bulk-next-session-guidance.ts";
import { EXERCISE_MUSCLE_CATEGORIES, MUSCLE_GROUPS } from "../src/lib/exercise-library.ts";
import { isFocusScreen, LOG_ACTIONS } from "../src/lib/main-navigation.ts";
const read = (p) => readFile(new URL(`../${p}`, import.meta.url), "utf8");
const require = createRequire(import.meta.url);
const jsx = (type, props) => ({ type, props });
const nodes = (tree, predicate) =>
  !tree || typeof tree !== "object"
    ? []
    : Array.isArray(tree)
      ? tree.flatMap((child) => nodes(child, predicate))
      : [...(predicate(tree) ? [tree] : []), ...nodes(tree.props?.children, predicate)];
const text = (tree) =>
  tree == null || typeof tree === "boolean"
    ? ""
    : Array.isArray(tree)
      ? tree.map(text).join(" ")
      : typeof tree === "object"
        ? text(tree.props?.children)
        : String(tree);
const find = (tree, label) =>
  nodes(
    tree,
    (n) =>
      text(n).trim().replace(/\s+/g, " ") === label && (n.type === "button" || n.type === "Button"),
  )[0];
const workoutSource = await read("src/components/BulkWorkoutSession.tsx");
const planSource = await read("src/components/TrainingPlanSetup.tsx");
const makeSet = (id, order, overrides = {}) => ({
  id,
  order,
  isExtra: false,
  isComplete: false,
  setType: "normal",
  rpe: null,
  bilateralWeight: null,
  bilateralReps: null,
  leftWeight: null,
  leftReps: null,
  rightWeight: null,
  rightReps: null,
  ...overrides,
});
const exercise = (id = "ex1", overrides = {}) => ({
  id,
  sourceExerciseId: "system:press",
  sourcePlanExerciseId: id,
  name: id === "ex1" ? "Real press" : "Real row",
  order: id === "ex1" ? 1 : 2,
  executionMode: "bilateral",
  isBodyweight: false,
  targetSets: 2,
  targetRepMin: 8,
  targetRepMax: 12,
  notes: "Bench notch 3",
  sets: [makeSet(`${id}-s1`, 1), makeSet(`${id}-s2`, 2)],
  ...overrides,
});
const session = (overrides = {}) => ({
  id: "session1",
  bulkProfileId: "owner1",
  planId: "plan1",
  planName: "Actual program",
  planDayId: "day1",
  workoutDayName: "Actual workout",
  workoutDayOrder: 1,
  status: "in_progress",
  startedAt: "2026-10-03T10:00:00Z",
  completedAt: null,
  updatedAt: "2026-10-03T10:00:00Z",
  workoutDate: "2026-10-03",
  bodyweightKg: 70,
  exercises: [exercise(), exercise("ex2")],
  ...overrides,
});
// Execute authored component handlers, preserving hook slots and refs across renders.
// UI wrappers are inert; no replica of mutation, draft or recommendation logic is used.
function fixture(source, exportName, initialProps, options = {}) {
  let props = initialProps,
    index = 0,
    fail = false,
    blocker = null,
    timerId = 0;
  const slots = [],
    calls = [],
    invalidations = [],
    destinations = [],
    effects = [],
    timers = new Map(),
    intervals = new Map(),
    storage = new Map(options.storage ?? []);
  const record = async (name, ...args) => {
    calls.push([name, ...args]);
    if (blocker) await blocker;
    if (fail) throw Error("Network request failed");
  };
  const modules = {
    react: {
      useState(initial) {
        const i = index++;
        slots[i] ??= { value: typeof initial === "function" ? initial() : initial };
        return [
          slots[i].value,
          (next) => {
            slots[i].value = typeof next === "function" ? next(slots[i].value) : next;
          },
        ];
      },
      useRef(initial) {
        return (slots[index++] ??= { current: initial });
      },
      useMemo(fn) {
        index++;
        return fn();
      },
      useEffect(fn, deps) {
        const i = index++;
        const prev = slots[i];
        if (!prev || deps?.some((d, j) => d !== prev.deps?.[j])) {
          effects.push(fn);
          slots[i] = { deps };
        }
      },
    },
    "react/jsx-runtime": { jsx, jsxs: jsx, Fragment: "fragment" },
    "@tanstack/react-router": {
      Link: "Link",
      useNavigate: () => async (d) => destinations.push(d),
      createFileRoute: () => (config) => config,
    },
    "@tanstack/react-query": {
      useQueryClient: () => ({ invalidateQueries: async (q) => invalidations.push(q.queryKey) }),
    },
    sonner: {
      toast: { success: (m) => calls.push(["success", m]), error: (m) => calls.push(["error", m]) },
    },
    "@/lib/utils": { cn: (...c) => c.filter(Boolean).join(" ") },
    "@/lib/network-errors": { userFacingError: () => "Save failed. Input preserved." },
    "@/lib/bulk-training-session-domain": domain,
    "@/lib/bulk-progression": progression,
    "@/lib/bulk-next-session-guidance": guidance,
    "@/lib/bulk-training-sessions": Object.fromEntries(
      [
        "saveBulkTrainingSet",
        "addBulkTrainingSet",
        "removeBulkTrainingSet",
        "finishBulkTrainingSession",
        "discardBulkTrainingSession",
      ].map((name) => [name, (...args) => record(name, ...args)]),
    ),
    "@/lib/training-plans": plans,
    "@/lib/bulk-onboarding": { TRAINING_SETUP_OPTIONS },
    "@/lib/training-plans-query": {
      useTrainingPlanTemplates: () => ({
        data: options.templates ?? [],
        isLoading: false,
        error: null,
      }),
      ...Object.fromEntries(
        [
          "instantiateTrainingPlan",
          "switchTrainingPlan",
          "switchToEmptyTrainingPlan",
          "createEmptyTrainingPlan",
        ].map((name) => [name, (...a) => record(name, ...a)]),
      ),
    },
  };
  const schedule = (fn) => {
    timers.set(++timerId, fn);
    return timerId;
  };
  const browser = {
    localStorage: {
      getItem: (k) => storage.get(k) ?? null,
      setItem: (k, v) => storage.set(k, v),
      removeItem: (k) => storage.delete(k),
    },
    setInterval: (fn, delay) => {
      intervals.set(++timerId, { fn, delay });
      return timerId;
    },
    clearInterval: (id) => intervals.delete(id),
  };
  const context = {
    exports: {},
    Date: options.now
      ? class extends Date {
          static now() {
            return options.now();
          }
        }
      : Date,
    window: browser,
    document: { addEventListener() {}, removeEventListener() {} },
    setTimeout: schedule,
    clearTimeout: (id) => timers.delete(id),
    console,
    require(name) {
      if (options.modules?.[name]) return options.modules[name];
      if (modules[name]) return modules[name];
      if (name === "date-fns") return require(name);
      if (
        name.includes("ui") ||
        name === "lucide-react" ||
        name.includes("DecimalInput") ||
        name.endsWith("BackControl") ||
        name.endsWith("TempoDateTimePicker")
      )
        return new Proxy({}, { get: (_, key) => String(key) });
      throw Error(name);
    },
  };
  vm.runInNewContext(
    ts.transpileModule(source + (source === workoutSource ? "\nexport { WorkoutSetRow };" : ""), {
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2022,
        jsx: ts.JsxEmit.ReactJSX,
      },
    }).outputText,
    context,
  );
  return {
    render() {
      index = 0;
      return exportName === "Route"
        ? context.exports.Route.component(props)
        : context.exports[exportName](props);
    },
    update(next) {
      props = next;
    },
    calls,
    invalidations,
    destinations,
    storage,
    intervals,
    tick() {
      intervals.forEach(({ fn }) => fn());
    },
    setFail(v) {
      fail = v;
    },
    setBlocker(p) {
      blocker = p;
    },
    runEffects() {
      effects.splice(0).forEach((fn) => fn());
    },
    async flushTimers() {
      const pending = [...timers.values()];
      timers.clear();
      await Promise.all(pending.map((fn) => fn()));
      await new Promise(setImmediate);
    },
    type(name) {
      return context.exports[name];
    },
  };
}
const setRows = (tree) =>
  nodes(tree, (n) => typeof n.type === "function" && n.type.name === "WorkoutSetRow");

test("active workout keeps one header Finish and a pinned rest/navigation dock without duplicate finish controls", () => {
  const f = fixture(workoutSource, "BulkWorkoutSessionView", {
    session: session(),
    progression: {},
  });
  const assertActions = (tree) => {
    assert.equal(nodes(tree, (n) => n.type === "Button" && text(n) === "Finish").length, 1);
    assert.ok(find(nodes(tree, (n) => n.type === "header")[0], "Finish"));
    assert.ok(find(tree, "Minimise"));
    assert.ok(find(tree, "Previous"));
    assert.ok(find(tree, "Next exercise"));
    const dock = nodes(tree, (n) => n.props["aria-label"] === "Workout controls")[0];
    assert.match(dock.props.className, /fixed.*bottom-0/);
    assert.match(
      dock.props.className,
      /my-0!/,
      "page spacing must not lift the dock off the bottom",
    );
    assert.ok(find(dock, "Previous"));
    assert.ok(find(dock, "Next exercise"));
    assert.equal(find(dock, "Finish workout"), undefined);
    assert.doesNotMatch(text(dock), /Done with set|Discard workout/);
    assert.match(tree.props.className, /160px\+env\(safe-area-inset-bottom\)/);
    assert.match(text(tree), /0\s*\/\s*4\s+sets/);
    assert.match(text(tree), /0 kg volume/);
    assert.ok(nodes(tree, (n) => n.props.style?.width === "0%").length);
  };
  assertActions(f.render());
  assert.equal(find(f.render(), "Previous").props.disabled, true);
  find(f.render(), "Next exercise").props.onClick();
  assertActions(f.render());
  assert.equal(find(f.render(), "Next exercise").props.disabled, true);
  assert.equal(
    nodes(f.render(), (n) => n.type === "section" && !n.props.hidden)[0].props["aria-label"],
    "Real row",
  );
  find(f.render(), "Previous").props.onClick();
  assert.equal(find(f.render(), "Next exercise").props.disabled, false);
  find(f.render(), "Finish").props.onClick();
  assert.ok(nodes(f.render(), (n) => n.type === "AlertDialog" && n.props.open).length);
  assert.match(text(f.render()), /Finish with incomplete sets\?/);
  assert.equal(f.calls.length, 0); // Finish still requires confirmation for incomplete sets.
});

test("set checkmark still saves once and starts rest while elapsed, +15s and Skip use the existing deadline", async () => {
  let now = Date.parse("2026-10-03T10:02:03Z");
  const f = fixture(
    workoutSource,
    "BulkWorkoutSessionView",
    { session: session(), progression: {} },
    { now: () => now },
  );
  f.render();
  f.runEffects();
  assert.equal([...f.intervals.values()][0].delay, 1000);
  assert.match(text(nodes(f.render(), (n) => n.type === "header")[0]), /2:03/);
  setRows(f.render())[0].props.onChange({ bilateralWeight: 20, bilateralReps: 10, rpe: 8.5 });
  const row = fixture(workoutSource, "WorkoutSetRow", setRows(f.render())[0].props);
  const check = nodes(
    row.render(),
    (n) => n.type === "button" && n.props["aria-label"] === "Save Real press set 1",
  )[0];
  assert.equal(check.props.disabled, true); // The existing autosave must settle first.
  await f.flushTimers();
  row.update(setRows(f.render())[0].props);
  const savedCheck = nodes(
    row.render(),
    (n) => n.type === "button" && n.props["aria-label"] === "Save Real press set 1",
  )[0];
  assert.equal(savedCheck.props.disabled, false);
  savedCheck.props.onClick();
  savedCheck.props.onClick();
  await new Promise(setImmediate);
  const rest = () => nodes(f.render(), (n) => n.props.role === "timer")[0];
  assert.match(text(rest()), /2:00/);
  assert.equal(f.calls.filter(([name]) => name === "saveBulkTrainingSet").length, 1);
  assert.equal(f.calls.find(([name]) => name === "saveBulkTrainingSet")[2].rpe, 8.5);
  assert.match(text(f.render()), /1\s*\/\s*4\s+sets/);
  assert.match(text(f.render()), /200 kg volume/);
  now += 30_000;
  f.tick();
  assert.match(text(rest()), /1:30/);
  assert.match(text(nodes(f.render(), (n) => n.type === "header")[0]), /2:33/);
  find(f.render(), "+15s").props.onClick();
  assert.match(text(rest()), /1:45/);
  find(f.render(), "+15s").props.onClick();
  assert.match(text(rest()), /2:00/);
  now += 121_000;
  f.tick();
  assert.equal(rest(), undefined);
  find(f.render(), "Start 2:00 rest").props.onClick();
  assert.match(text(rest()), /2:00/);
  find(f.render(), "Skip").props.onClick();
  assert.equal(rest(), undefined);
  assert.ok(find(f.render(), "Start 2:00 rest"));
});

test("Discard workout is inside Finish confirmation and still requires its separate destructive confirmation", async () => {
  const f = fixture(workoutSource, "BulkWorkoutSessionView", {
    session: session(),
    progression: {},
  });
  setRows(f.render())[0].props.onChange({ bilateralWeight: 20 });
  find(f.render(), "Finish").props.onClick();
  const finishDialog = nodes(f.render(), (n) => n.type === "AlertDialog" && n.props.open)[0];
  const trigger = find(finishDialog, "Discard workout");
  assert.match(trigger.props.className, /text-danger/);
  trigger.props.onClick();
  assert.equal(f.calls.length, 0);
  assert.equal(f.storage.has("tempo:bulk-workout-draft:owner1:session1"), true);
  assert.ok(nodes(f.render(), (n) => n.type === "AlertDialog" && n.props.open).length);
  assert.match(text(f.render()), /Discard this workout\?/);
  const confirm = nodes(
    f.render(),
    (n) => n.type === "AlertDialogAction" && text(n) === "Discard workout",
  )[0];
  confirm.props.onClick();
  await new Promise(setImmediate);
  assert.equal(f.calls.filter(([name]) => name === "discardBulkTrainingSession").length, 1);
  assert.equal(f.calls.filter(([name]) => name === "finishBulkTrainingSession").length, 0);
  assert.equal(f.storage.has("tempo:bulk-workout-draft:owner1:session1"), false);
  assert.equal(f.destinations[0].to, "/bulk/training");
});

test("compact Finish confirmation keeps balanced 48px actions and cancellation leaves the workout untouched", () => {
  const value = session({
    exercises: [
      exercise("ex1", {
        sets: [makeSet("set", 1, { bilateralWeight: 20, bilateralReps: 10, rpe: 8 })],
      }),
    ],
  });
  const f = fixture(workoutSource, "BulkWorkoutSessionView", { session: value, progression: {} });
  const before = setRows(f.render())[0].props.draft;
  find(f.render(), "Finish").props.onClick();
  const dialog = nodes(f.render(), (n) => n.type === "AlertDialog" && n.props.open)[0];
  assert.ok(dialog);
  assert.match(text(dialog), /Finish this workout\?/);
  assert.match(text(dialog), /Your logged sets will be saved to workout history\./);
  const content = nodes(dialog, (n) => n.type === "AlertDialogContent")[0];
  assert.match(content.props.className, /gap-3.*p-4/);
  const row = nodes(dialog, (n) => n.type === "AlertDialogFooter")[0];
  assert.match(row.props.className, /grid grid-cols-2 gap-2/);
  for (const kind of ["AlertDialogCancel", "AlertDialogAction"]) {
    assert.match(nodes(row, (n) => n.type === kind)[0].props.className, /h-12 w-full/);
  }
  assert.equal(text(nodes(row, (n) => n.type === "AlertDialogCancel")[0]), "Keep logging");
  assert.equal(text(nodes(row, (n) => n.type === "AlertDialogAction")[0]), "Finish workout");
  const actions = nodes(dialog, (n) => n.type === "div" && n.props.className === "space-y-1")[0];
  assert.ok(find(actions, "Discard workout"));
  assert.match(find(actions, "Discard workout").props.className, /min-h-11.*text-xs.*text-danger/);
  // Radix AlertDialogCancel closes through the existing Root callback; it has no mutation handler.
  assert.equal(nodes(row, (n) => n.type === "AlertDialogCancel")[0].props.onClick, undefined);
  dialog.props.onOpenChange(false);
  assert.equal(nodes(f.render(), (n) => n.type === "AlertDialog" && n.props.open).length, 0);
  assert.deepEqual(setRows(f.render())[0].props.draft, before);
  assert.equal(f.calls.length, 0);
});

test("Phase 5 focus shows real exercises, keeps hidden sets mounted, and preserves per-set RPE drafts", async () => {
  const f = fixture(workoutSource, "BulkWorkoutSessionView", {
    session: session(),
    progression: {},
  });
  let tree = f.render();
  assert.match(text(tree), /Actual workout/);
  assert.equal(setRows(tree).length, 4);
  assert.equal(nodes(tree, (n) => n.type === "section" && n.props.hidden).length, 1);
  assert.match(text(tree), /Bench notch 3/);
  setRows(tree)[0].props.onChange({
    bilateralWeight: 22.5,
    bilateralReps: 10,
    rpe: 8.5,
    setType: "drop",
  });
  find(f.render(), "Next exercise").props.onClick();
  tree = f.render();
  assert.equal(setRows(tree)[0].props.draft.rpe, 8.5);
  await f.flushTimers();
  const saved = f.calls.find(([name]) => name === "saveBulkTrainingSet");
  assert.equal(saved[1], "session1");
  assert.equal(saved[2].rpe, 8.5);
  assert.equal(saved[2].setType, "drop");
  assert.equal(saved[2].bilateralWeight, 22.5);
});

test("Phase 5 resumes server and unsynced RPE without another session or cross-account drafts", async () => {
  const value = session({
    exercises: [
      exercise("ex1", {
        sets: [makeSet("saved", 1, { rpe: 9.5, bilateralWeight: 20, bilateralReps: 10 })],
      }),
    ],
  });
  const key = "tempo:bulk-workout-draft:owner1:session1";
  const recovered = {
    saved: {
      id: "saved",
      rpe: 8,
      setType: "failure",
      bilateralWeight: 22.5,
      bilateralReps: 10,
      leftWeight: null,
      leftReps: null,
      rightWeight: null,
      rightReps: null,
    },
    foreign: { id: "foreign", rpe: 10 },
  };
  const f = fixture(
    workoutSource,
    "BulkWorkoutSessionView",
    { session: value, progression: {} },
    { storage: [[key, JSON.stringify(recovered)]] },
  );
  assert.equal(setRows(f.render())[0].props.draft.rpe, 8);
  assert.equal(setRows(f.render()).length, 1);
  f.runEffects();
  await f.flushTimers();
  assert.equal(f.calls.find(([n]) => n === "saveBulkTrainingSet")[2].rpe, 8);
  const fresh = fixture(workoutSource, "BulkWorkoutSessionView", {
    session: value,
    progression: {},
  });
  assert.equal(setRows(fresh.render())[0].props.draft.rpe, 9.5);
});

test("Phase 5 RPE drawer keeps original optional choices and saves through the row's existing callback", () => {
  const updates = [];
  const props = {
    exercise: exercise(),
    set: makeSet("set", 1),
    draft: { ...makeSet("set", 1), rpe: 8 },
    saving: false,
    removing: false,
    canRemove: true,
    swipeOpen: false,
    previous: "20×10",
    onChange: (patch) => updates.push(patch),
    onDone() {},
    onRemove() {},
    onRetry() {},
    onSwipeBegin() {},
    onSwipeOpen() {},
    onSwipeClose() {},
  };
  const f = fixture(workoutSource, "WorkoutSetRow", props);
  const rpe = nodes(
    f.render(),
    (n) => n.type === "button" && n.props["aria-label"]?.includes("RPE"),
  )[0];
  assert.ok(rpe);
  assert.equal(rpe.props["aria-haspopup"], "dialog");
  assert.equal(rpe.props["aria-expanded"], false);
  assert.match(rpe.props.className, /h-12 min-w-11.*border border-input/);
  rpe.props.onClick();
  assert.equal(
    nodes(f.render(), (n) => n.type === "button" && n.props["aria-label"]?.includes("RPE"))[0]
      .props["aria-expanded"],
    true,
  );
  const choices = nodes(
    f.render(),
    (n) =>
      n.type === "button" &&
      typeof n.props["aria-pressed"] === "boolean" &&
      typeof n.props.children === "number",
  );
  assert.deepEqual(
    choices.map((n) => Number(text(n))),
    [6, 7, 7.5, 8, 8.5, 9, 9.5, 10],
  );
  find(f.render(), "9.5").props.onClick();
  find(f.render(), "Done").props.onClick();
  assert.equal(updates.at(-1).rpe, 9.5);
  find(f.render(), "Clear RPE").props.onClick();
  assert.equal(updates.at(-1).rpe, null);
  assert.match(text(f.render()), /Previous:\s+20×10/);
  f.update({ ...props, draft: { ...props.draft, rpe: null } });
  assert.ok(find(f.render(), "RPE"));
});

test("compact set badge opens all four choices without cycling and direct selection closes the picker", () => {
  for (const [setType, marker, tone] of [
    ["warmup", "W", "warn"],
    ["failure", "F", "danger"],
    ["drop", "D", "chart-2"],
    ["normal", "1", "foreground"],
  ]) {
    const updates = [];
    const f = fixture(workoutSource, "WorkoutSetRow", {
      exercise: exercise(),
      set: makeSet("set", 1),
      draft: { ...makeSet("set", 1), setType },
      saving: false,
      removing: false,
      canRemove: false,
      swipeOpen: false,
      previous: "20×10",
      onChange: (patch) => updates.push(patch),
    });
    const badge = find(f.render(), marker);
    assert.match(badge.props.className, new RegExp(`text-${tone}`));
    assert.equal(badge.props["aria-haspopup"], "dialog");
    assert.equal(badge.props["aria-expanded"], false);
    badge.props.onClick();
    assert.equal(updates.length, 0, "opening the picker must not change or save the type");
    const picker = () => nodes(f.render(), (n) => n.type === "Drawer" && n.props.open)[0];
    assert.equal(picker().props.autoFocus, true);
    assert.match(text(picker()), /Set\s+1\s+type/);
    assert.equal(find(f.render(), marker).props["aria-expanded"], true);
    const choices = nodes(picker(), (n) => n.type === "button" && "aria-pressed" in n.props);
    assert.deepEqual(
      choices.map((choice) => text(choice).trim()),
      ["Normal", "Warmup", "Failure", "Dropset"],
    );
    assert.equal(choices.filter((n) => n.props["aria-pressed"]).length, 1);
    for (const choice of choices) assert.match(choice.props.className, /min-h-12/);
    for (const [label, chosenType] of [
      ["Normal", "normal"],
      ["Warmup", "warmup"],
      ["Failure", "failure"],
      ["Dropset", "drop"],
    ]) {
      find(f.render(), marker).props.onClick();
      find(picker(), label).props.onClick();
      assert.deepEqual({ ...updates.at(-1) }, { setType: chosenType });
      assert.equal(picker(), undefined, "each selection closes the drawer");
      assert.equal(find(f.render(), marker).props["aria-expanded"], false);
    }
    assert.equal(f.calls.length, 0);
  }
});

test("direct set-type selection retains the existing autosave path and all other set values", async () => {
  const value = session({
    exercises: [
      exercise("ex1", {
        sets: [makeSet("set", 1, { bilateralWeight: 20, bilateralReps: 10, rpe: 8.5 })],
      }),
    ],
  });
  const f = fixture(workoutSource, "BulkWorkoutSessionView", { session: value, progression: {} });
  const row = fixture(workoutSource, "WorkoutSetRow", setRows(f.render())[0].props);
  find(row.render(), "1").props.onClick();
  assert.equal(f.calls.length, 0);
  find(
    nodes(row.render(), (n) => n.type === "Drawer" && n.props.open)[0],
    "Failure",
  ).props.onClick();
  await f.flushTimers();
  const saves = f.calls.filter(([name]) => name === "saveBulkTrainingSet");
  assert.equal(saves.length, 1);
  assert.equal(saves[0][2].setType, "failure");
  assert.equal(saves[0][2].bilateralWeight, 20);
  assert.equal(saves[0][2].bilateralReps, 10);
  assert.equal(saves[0][2].rpe, 8.5);
  assert.equal(nodes(f.render(), (n) => n.props.role === "timer").length, 0);
  assert.equal(
    f.calls.some(([name]) => /finish|discard/i.test(name)),
    false,
  );
});

test("compact set row keeps previous, load, reps, RPE and checkmark including bodyweight and both sides", () => {
  for (const ex of [
    exercise(),
    exercise("ex1", { isBodyweight: true }),
    exercise("ex1", { executionMode: "unilateral" }),
  ]) {
    const updates = [];
    const draft = makeSet("set", 1, {
      bilateralWeight: ex.isBodyweight ? null : 20,
      bilateralReps: 10,
      leftWeight: 12,
      leftReps: 10,
      rightWeight: 14,
      rightReps: 8,
      rpe: 8.5,
    });
    const f = fixture(workoutSource, "WorkoutSetRow", {
      exercise: ex,
      set: draft,
      draft,
      saving: false,
      removing: false,
      canRemove: false,
      swipeOpen: false,
      previous: "20×10",
      onChange: (patch) => updates.push(patch),
      onDone() {},
    });
    const grid = nodes(f.render(), (n) => n.props.className?.includes("workout-set-grid"))[0];
    assert.match(grid.props.className, /bg-primary\/5/);
    assert.match(text(grid), /Previous:\s+20×10/);
    assert.equal(
      nodes(grid, (n) => n.type === "button" && n.props["aria-haspopup"] === "dialog").length,
      2,
    );
    assert.ok(find(grid, "8.5"));
    const fields = nodes(grid, (n) => n.type === "DecimalInput");
    assert.equal(fields.length, ex.executionMode === "unilateral" ? 4 : 2);
    assert.ok(fields.every((n) => /bg-primary\/10/.test(n.props.className)));
    assert.ok(nodes(grid, (n) => n.props["aria-label"] === "Save Real press set 1").length);
    const kg = fields[0];
    assert.equal(kg.props.min, 0);
    assert.equal(kg.props.max, 1000);
    assert.equal(kg.props.value, ex.executionMode === "unilateral" ? 12 : ex.isBodyweight ? 0 : 20);
    kg.props.onChange(22.5);
    assert.deepEqual(
      updates.map((patch) => ({ ...patch })),
      [ex.executionMode === "unilateral" ? { leftWeight: 22.5 } : { bilateralWeight: 22.5 }],
    );
    f.update({
      exercise: ex,
      set: draft,
      draft: makeSet("set", 1),
      previous: "20×10",
      onChange() {},
    });
    assert.doesNotMatch(
      nodes(f.render(), (n) => n.props.className?.includes("workout-set-grid"))[0].props.className,
      /bg-primary\/5/,
    );
  }
});

test("Phase 5 add/remove set handlers keep snapshots and use the same session RPCs", async () => {
  const f = fixture(workoutSource, "BulkWorkoutSessionView", {
    session: session(),
    progression: {},
  });
  await find(f.render(), "Add set").props.onClick();
  await new Promise(setImmediate);
  assert.ok(
    f.calls.some(
      ([name, id, ex]) => name === "addBulkTrainingSet" && id === "session1" && ex === "ex1",
    ),
  );
  setRows(f.render())[0].props.onRemove();
  await new Promise(setImmediate);
  assert.ok(
    f.calls.some(
      ([name, id, set]) =>
        name === "removeBulkTrainingSet" && id === "session1" && set === "ex1-s1",
    ),
  );
});

test("Phase 5 finish flushes RPE, prevents duplicate completion and invalidates Today/Progress readers", async () => {
  const value = session({
    exercises: [
      exercise("ex1", {
        sets: [
          makeSet("set", 1, { isComplete: true, bilateralWeight: 20, bilateralReps: 10, rpe: 8 }),
        ],
      }),
    ],
  });
  const f = fixture(workoutSource, "BulkWorkoutSessionView", { session: value, progression: {} });
  setRows(f.render())[0].props.onChange({ rpe: 9.5 });
  let release;
  f.setBlocker(
    new Promise((resolve) => {
      release = resolve;
    }),
  );
  const finish = find(f.render(), "Finish");
  finish.props.onClick();
  assert.equal(f.calls.filter(([n]) => n === "finishBulkTrainingSession").length, 0);
  const confirm = nodes(
    f.render(),
    (n) => n.type === "AlertDialogAction" && text(n) === "Finish workout",
  )[0];
  confirm.props.onClick();
  confirm.props.onClick();
  release();
  await new Promise(setImmediate);
  await new Promise(setImmediate);
  assert.equal(f.calls.filter(([n]) => n === "finishBulkTrainingSession").length, 1);
  const save = f.calls.findIndex(([n]) => n === "saveBulkTrainingSet");
  assert.ok(save >= 0 && save < f.calls.findIndex(([n]) => n === "finishBulkTrainingSession"));
  assert.equal(f.calls[save][2].rpe, 9.5);
  assert.equal(f.storage.has("tempo:bulk-workout-draft:owner1:session1"), false);
  for (const key of [
    "bulk-training-session",
    "bulk-training-sessions",
    "bulk-progression",
    "bulk-progress-summary",
  ])
    assert.ok(f.invalidations.some((k) => k[0] === key));
  assert.equal(f.destinations.length, 0); // confirmed refetch transitions this route to completion
});

test("Phase 5 failed saves preserve RPE draft and prevent finish; completing never fabricates missing values", async () => {
  const f = fixture(workoutSource, "BulkWorkoutSessionView", {
    session: session(),
    progression: {},
  });
  f.setFail(true);
  setRows(f.render())[0].props.onChange({ bilateralWeight: 20, bilateralReps: 10, rpe: 8.5 });
  await f.flushTimers();
  const confirm = nodes(
    f.render(),
    (n) => n.type === "AlertDialogAction" && text(n) === "Finish anyway",
  )[0];
  confirm.props.onClick();
  await new Promise(setImmediate);
  assert.equal(f.calls.filter(([n]) => n === "finishBulkTrainingSession").length, 0);
  assert.equal(setRows(f.render())[0].props.draft.rpe, 8.5);
  assert.ok(f.storage.size);
  assert.match(text(f.render()), /missing values will remain empty in history/);
});

test("Phase 5 completion uses immutable duration, working sets, actual volume and stored RPE", () => {
  const saved = session({
    status: "completed",
    completedAt: "2026-10-03T10:02:03Z",
    exercises: [
      exercise("ex1", {
        sets: [
          makeSet("s1", 1, { isComplete: true, bilateralWeight: 20, bilateralReps: 10, rpe: 9.5 }),
          makeSet("s2", 2, {
            isComplete: true,
            setType: "warmup",
            bilateralWeight: 10,
            bilateralReps: 10,
          }),
        ],
      }),
    ],
  });
  const f = fixture(workoutSource, "CompletedWorkout", { session: saved });
  assert.match(text(f.render()), /2:03/);
  assert.match(text(f.render()), /200 kg/);
  assert.match(text(f.render()), /RPE\s+9.5/);
  assert.ok(nodes(f.render(), (n) => n.type === "Link" && n.props.to === "/bulk").length);
  const missingBW = fixture(workoutSource, "CompletedWorkout", {
    session: {
      ...saved,
      bodyweightKg: null,
      exercises: [{ ...saved.exercises[0], isBodyweight: true }],
    },
  });
  assert.match(text(missingBW.render()), /Unavailable/);
});

test("Phase 5 overview selects actual next incomplete day, preserves day order, and does not guess workouts", () => {
  const plan = {
    name: "Real 3-day plan",
    days: [1, 2, 3].map((order) => ({
      id: `d${order}`,
      name: `Real day ${order}`,
      order,
      exercises: [
        {
          id: `e${order}`,
          name: `Stored exercise ${order}`,
          sets: 3,
          repMin: 8,
          repMax: 12,
          intendedUnilateralMode: "bilateral",
          isBodyweight: false,
          exerciseId: "system:press",
          notes: "Stored setup",
        },
      ],
    })),
  };
  const starts = [];
  const f = fixture(planSource, "TrainingPlanOverview", {
    plan,
    onStart: (id) => starts.push(id),
    startingDayId: null,
    workoutActive: false,
    progression: {},
    completedDayIds: new Set(["d1"]),
    weekProgress: "1/5",
  });
  assert.match(text(f.render()), /Real day 2/);
  assert.match(text(f.render()), /1\/5/);
  find(f.render(), "Start workout").props.onClick();
  assert.deepEqual(starts, ["d2"]);
  nodes(f.render(), (n) => n.type === "NativeSelect")[0].props.onChange({
    target: { value: "d3" },
  });
  assert.match(text(f.render()), /Stored exercise 3/);
  f.update({
    plan: { ...plan, days: [] },
    onStart() {},
    startingDayId: null,
    workoutActive: false,
    progression: {},
  });
  assert.match(text(f.render()), /Add workout days/);
  assert.equal(find(f.render(), "Start workout"), undefined);
});

test("Phase 5 bodyweight, unilateral and RPE do not change previous-performance or progression math", () => {
  const ex = exercise("ex1", { isBodyweight: true });
  const set = makeSet("set", 1, { bilateralWeight: 5, bilateralReps: 10, rpe: 10 });
  assert.equal(domain.sessionSetVolume(set, ex, 70), 750);
  assert.equal(domain.sessionSetVolume({ ...set, rpe: null }, ex, 70), 750);
  assert.equal(domain.sessionSetVolume(set, ex, null), null);
  const target = {
    planExerciseId: "ex1",
    exerciseId: "system:press",
    executionMode: "bilateral",
    isBodyweight: false,
    targetSets: 2,
    repMin: 8,
    repMax: 12,
  };
  const previous = (rpe) =>
    session({
      status: "completed",
      completedAt: "2026-10-03T11:00:00Z",
      exercises: [
        exercise("ex1", {
          sets: [1, 2].map((order) =>
            makeSet(`s${order}`, order, {
              isComplete: true,
              bilateralWeight: 20,
              bilateralReps: 12,
              rpe,
            }),
          ),
        }),
      ],
    });
  const lowRpe = progression.deriveBulkProgressionTargets([target], [previous(6)]);
  const highRpe = progression.deriveBulkProgressionTargets([target], [previous(10)]);
  assert.equal(lowRpe.ex1.dataStatus, "usable");
  assert.deepEqual(highRpe, lowRpe);
  const unilateral = { ...ex, executionMode: "unilateral", isBodyweight: false };
  assert.equal(
    domain.sessionSetVolume(
      { ...set, leftWeight: 10, leftReps: 8, rightWeight: 12, rightReps: 7 },
      unilateral,
    ),
    164,
  );
});

test("Phase 5 library categories cover existing metadata without duplicates or client page filtering", async () => {
  const muscles = Object.values(EXERCISE_MUSCLE_CATEGORIES).flat();
  assert.deepEqual([...muscles].sort(), [...MUSCLE_GROUPS].sort());
  assert.equal(new Set(muscles).size, muscles.length);
  const query = await read("src/lib/exercise-library-query.ts");
  assert.match(query, /query\.in\("primary_muscle", \[\.\.\.filters\.primaryMuscles\]\)/);
});

test("Phase 5 keeps original routes, goal separate from frequency, historical editing/deletion and owner security", async () => {
  assert.ok(isFocusScreen("/bulk/workout/session1"));
  assert.equal(LOG_ACTIONS.find((a) => a.key === "workout").to, "/bulk/training");
  const training = await read("src/routes/_authenticated/bulk/training.tsx");
  const today = await read("src/routes/_authenticated/bulk/index.tsx");
  for (const source of [training, today])
    assert.match(source, /weeklyWorkoutGoal: data\?\.targets\.weeklyWorkoutGoal \?\? 5/);
  assert.match(training, /if \(starting\.current/);
  assert.match(training, /activeSession\.data\.id/);
  const history = await read("src/routes/_authenticated/bulk/training_.history.tsx");
  const historyView = await read("src/components/WorkoutHistory.tsx");
  assert.match(historyView, /Delete workout\?/);
  assert.match(history, /WorkoutDetail/);
  const metadata = await read("supabase/migrations/20260915120000_workout_set_metadata.sql");
  assert.match(metadata, /_rpe < 6 OR _rpe > 10 OR _rpe \* 2 <> trunc\(_rpe \* 2\)/);
  assert.match(metadata, /SECURITY DEFINER SET search_path = ''/);
  const bodyweight = await read(
    "supabase/migrations/20260923120000_snapshot_public_workout_bodyweight.sql",
  );
  assert.match(bodyweight, /IF existing_id IS NOT NULL THEN RETURN result_id/);
  assert.match(bodyweight, /w\.log_date<=_workout_date/);
  assert.doesNotMatch(planSource, /saveTargets|weeklyWorkoutGoal\s*:/);
});

test("Phase 5 plan selection keeps template/custom paths, gates AI and blocks repeated creation", async () => {
  const template = {
    id: "template1",
    slug: "real",
    name: "Stored template",
    description: "Stored description",
    experienceLevel: "beginner",
    trainingDaysPerWeek: 3,
    requiredEquipment: [],
    splitSummary: "Stored split",
    days: [],
  };
  const f = fixture(planSource, "TrainingPlanSetup", { targets: {} }, { templates: [template] });
  let release;
  f.setBlocker(
    new Promise((resolve) => {
      release = resolve;
    }),
  );
  const card = nodes(
    f.render(),
    (n) => typeof n.type === "function" && n.type.name === "PlanCard",
  )[0];
  card.props.onUse();
  card.props.onUse();
  release();
  await new Promise(setImmediate);
  assert.equal(f.calls.filter(([n]) => n === "instantiateTrainingPlan").length, 1);
  assert.equal(f.calls.find(([n]) => n === "instantiateTrainingPlan")[2], "tempo_preset");
  find(f.render(), "Build my own plan").props.onClick();
  assert.match(text(f.render()), /Start with an empty plan/);
  find(f.render(), "Create My Training Plan").props.onClick();
  await new Promise(setImmediate);
  assert.ok(f.calls.some(([n]) => n === "createEmptyTrainingPlan"));
  assert.match(planSource, /mode !== "tempo_preset"\) return/);
  assert.match(planSource, /mode === "generated"/);
  assert.match(planSource, /Coming soon/);
  assert.match(planSource, /rankTrainingPlans/);
  const blocked = fixture(
    planSource,
    "TrainingPlanSetup",
    { targets: {}, selectionDisabled: true },
    { templates: [template] },
  );
  const blockedCard = nodes(
    blocked.render(),
    (n) => typeof n.type === "function" && n.type.name === "PlanCard",
  )[0];
  assert.equal(blockedCard.props.disabled, true);
  blockedCard.props.onUse();
  find(blocked.render(), "Build my own plan").props.onClick();
  find(blocked.render(), "Create My Training Plan").props.onClick();
  await new Promise(setImmediate);
  assert.equal(blocked.calls.length, 0);
});

test("Phase 5 actual Training route starts one session, resumes its exact id and guards query errors", async () => {
  const source = await read("src/routes/_authenticated/bulk/training.tsx");
  const q = (data) => ({ data, isLoading: false, error: null, refetch() {} });
  const active = q(null),
    currentPlan = q({
      id: "real-plan",
      name: "Preserved plan",
      updatedAt: "v1",
      days: [],
      trainingDaysPerWeek: 3,
    });
  let starts = 0,
    resolveStart;
  const modules = {
    "@/components/AppShell": { AppShell: "AppShell", PageHeader: "PageHeader" },
    "@/components/HistoryBackLink": { HistoryBackLink: "HistoryBackLink" },
    "@/components/NavRows": { NavRows: "NavRows" },
    "@/components/PageSkeleton": { PageSkeleton: "PageSkeleton" },
    "@/components/TrainingSession": { TrainingSession: "TrainingSession" },
    "@/components/TrainingPlanSetup": { TrainingPlanOverview: "TrainingPlanOverview" },
    "@/lib/calc": { iso: (d) => require("date-fns").format(d, "yyyy-MM-dd") },
    "@/lib/auth": { useAuth: () => ({ user: { id: "owner" } }) },
    "@/lib/store": {
      useAppData: () => ({ targets: { weeklyWorkoutGoal: 5 }, workouts: {}, days: {} }),
      useBulkMeta: () => ({ bulkId: "owner", role: "owner" }),
      useActions: () => ({}),
    },
    "@/lib/bulk-access": { bulkPlanModeFor: () => "public", useMemberships: () => q([]) },
    "@/lib/training-plans-query": { useActiveTrainingPlan: () => currentPlan },
    "@/lib/bulk-progression-query": { useBulkProgressionTargets: () => q({}) },
    "@/lib/goal-metrics": {
      collectCompletedWorkouts: () => [],
      countWorkoutsInRange: () => 0,
      formatWorkoutProgress: (n, target) => `${n}/${target}`,
      mondayOf: (d) => d,
      resolveWeeklyWorkoutTarget: (a) => a.weeklyWorkoutGoal,
    },
    "@/lib/bulk-training-sessions": {
      useActiveBulkTrainingSession: () => active,
      useCompletedSessionDates: () => q([]),
      startBulkTrainingSession: async () => {
        starts++;
        await new Promise((r) => {
          resolveStart = r;
        });
        return "same-session";
      },
    },
  };
  const f = fixture(source, "Route", {}, { modules });
  let overview = nodes(f.render(), (n) => n.type === "TrainingPlanOverview")[0];
  assert.equal(overview.props.plan.name, "Preserved plan");
  assert.equal(overview.props.weekProgress, "0/5");
  overview.props.onStart("day1");
  overview.props.onStart("day1");
  assert.equal(starts, 1);
  resolveStart();
  await new Promise(setImmediate);
  assert.equal(f.destinations[0].params.sessionId, "same-session");
  active.data = { id: "existing-session", workoutDayName: "Preserved workout" };
  overview = nodes(f.render(), (n) => n.type === "TrainingPlanOverview")[0];
  assert.equal(overview.props.workoutActive, true);
  assert.match(text(f.render()), /Resume workout/);
  overview.props.onStart("different-day");
  await new Promise(setImmediate);
  assert.equal(starts, 1);
  assert.equal(f.destinations.at(-1).params.sessionId, "existing-session");
  active.data = null;
  active.error = Error("Read failed");
  overview = nodes(f.render(), (n) => n.type === "TrainingPlanOverview")[0];
  assert.equal(overview.props.workoutActive, true);
  overview.props.onStart("day1");
  assert.equal(starts, 1);
});
