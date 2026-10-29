import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { accountUI, event, textOf } from "./account-ui-fixture.mjs";
import { presentationComponent } from "./presentation-component-fixture.mjs";
import * as training from "../src/lib/training-plans.ts";
import { mainTabForPath } from "../src/lib/main-navigation.ts";
import { inAppBackLabel } from "../src/lib/in-app-back.ts";

const clean = (value) => JSON.parse(JSON.stringify(value));
const read = (file) => readFile(new URL(`../${file}`, import.meta.url), "utf8");
const queryMocks = { queryOptions: (options) => options, useQuery: () => ({}) };
const errors = {
  userFacingError: (_error, action) => `Could not ${action}.`,
  developmentErrorDiagnostic() {},
  shouldRetryRead: () => false,
  readRetryDelay: () => 0,
};
const exercise = (id = "system:press", extra = {}) => ({
  id: `row:${id}`,
  exerciseId: id,
  sourceSystemExerciseId: id,
  name: "Press",
  order: 1,
  sets: 3,
  repMin: 8,
  repMax: 12,
  intendedUnilateralMode: "bilateral",
  supportsUnilateral: true,
  isBodyweight: false,
  notes: null,
  ...extra,
});
const workout = {
  id: "workout-a",
  title: "Upper session",
  updatedAt: "2026-10-29T12:00:00.123456Z",
  exercises: [
    exercise(),
    exercise("custom:a", {
      sourceSystemExerciseId: null,
      name: "My cable row",
      order: 2,
      notes: "Bench 3",
    }),
  ],
};
const summaries = [
  { id: workout.id, title: workout.title, exerciseCount: 2, createdAt: "2026-10-29" },
];
function apiFixture({ count = 1, cap = 200, fail = null } = {}) {
  const calls = [];
  const tables = {
    workout_templates: Array.from({ length: count }, (_, i) => ({
      id: `workout-${String(i).padStart(4, "0")}`,
      title: `Workout ${i}`,
      bulk_profile_id: "profile-a",
      visibility: "private",
      is_system: false,
      created_at: `2026-10-${String((i % 28) + 1).padStart(2, "0")}`,
      updated_at: workout.updatedAt,
      workout_template_exercises: [{ count: 2 }],
    })),
    workout_template_exercises: workout.exercises.map((ex) => ({
      id: ex.id,
      workout_template_id: "workout-0000",
      exercise_id: ex.exerciseId,
      source_system_exercise_id: ex.sourceSystemExerciseId,
      exercise_name: ex.name,
      exercise_order: ex.order,
      sets: ex.sets,
      rep_min: ex.repMin,
      rep_max: ex.repMax,
      intended_unilateral_mode: ex.intendedUnilateralMode,
      notes: ex.notes,
      bulk_exercises: {
        supports_unilateral: ex.supportsUnilateral,
        is_bodyweight: ex.isBodyweight,
      },
    })),
  };
  const supabase = {
    from(table) {
      let rows = [...tables[table]],
        limit = cap;
      const q = {
        select(fields) {
          calls.push(["select", table, fields]);
          return q;
        },
        eq(key, value) {
          calls.push(["eq", table, key, value]);
          rows = rows.filter((row) => row[key] === value);
          return q;
        },
        gt(key, value) {
          rows = rows.filter((row) => row[key] > value);
          return q;
        },
        order(key) {
          rows.sort((a, b) => (a[key] < b[key] ? -1 : a[key] > b[key] ? 1 : 0));
          return q;
        },
        limit(n) {
          limit = Math.min(n, cap);
          calls.push(["limit", n]);
          return q;
        },
        maybeSingle() {
          return Promise.resolve({ data: rows[0] ?? null, error: fail });
        },
        then(resolve, reject) {
          return Promise.resolve({ data: rows.slice(0, limit), error: fail }).then(resolve, reject);
        },
      };
      return q;
    },
    async rpc(name, args) {
      calls.push(["rpc", name, clean(args)]);
      return {
        data:
          name === "save_workout_template_exercises"
            ? "2026-10-29T12:01:00.987654Z"
            : name === "delete_workout_template"
              ? true
              : "new-workout",
        error: fail,
      };
    },
  };
  const api = presentationComponent("src/lib/workout-templates-query.ts", {
    "@tanstack/react-query": queryMocks,
    "@/integrations/supabase/client": { supabase },
    "@/lib/network-errors": errors,
  });
  return { api, calls, tables };
}
const alertModules = Object.fromEntries(
  [
    "AlertDialog",
    "AlertDialogAction",
    "AlertDialogCancel",
    "AlertDialogContent",
    "AlertDialogDescription",
    "AlertDialogFooter",
    "AlertDialogHeader",
    "AlertDialogTitle",
  ].map((key) => [key, key]),
);
function uiFixture(
  exportName,
  props = {},
  overrides = {},
  { mode = "public", state = {}, file = "src/components/MyWorkouts.tsx" } = {},
) {
  const calls = [];
  const api = {
    useMyWorkouts: (...args) => {
      calls.push(["list", ...args]);
      return {
        data: summaries,
        isLoading: false,
        error: null,
        refetch: async () => calls.push(["retry"]),
        ...state,
      };
    },
    usePrivateWorkout: () => ({
      data: workout,
      isLoading: false,
      error: null,
      refetch: async () => calls.push(["retry"]),
      ...state,
    }),
    createWorkout: async (...args) => {
      calls.push(["create", ...args]);
      return "created";
    },
    duplicateWorkout: async (...args) => {
      calls.push(["duplicate", ...args]);
      return "copied";
    },
    deleteWorkout: async (...args) => {
      calls.push(["delete", ...args]);
      return true;
    },
    saveWorkout: async (input) => {
      calls.push(["save", clean(input)]);
      return "2026-10-29T12:01:00.987654Z";
    },
    workoutListKey: (user, profile) => ["workout-templates", user, profile],
    workoutDetailKey: (user, profile, id) => ["workout-template", user, profile, id],
    ...overrides,
  };
  const ui = accountUI(
    file,
    exportName,
    {
      "@tanstack/react-router": {
        Link: "Link",
        useNavigate: () => async (destination) => calls.push(["navigate", clean(destination)]),
      },
      "@tanstack/react-query": {
        useQueryClient: () => ({
          invalidateQueries: async (key) => calls.push(["invalidate", clean(key)]),
          removeQueries: (key) => calls.push(["remove", clean(key)]),
          setQueryData: (...args) => calls.push(["cache", ...clean(args)]),
        }),
      },
      "@/lib/workout-templates-query": api,
      "@/lib/training-plans": training,
      "@/lib/network-errors": errors,
      "@/lib/auth": { useAuth: () => ({ user: { id: "user-a" } }) },
      "@/lib/store": { useBulkMeta: () => ({ bulkId: "profile-a" }) },
      "@/lib/bulk-access": { bulkPlanModeFor: () => mode, useMemberships: () => ({ data: [] }) },
      "@/components/WorkoutTemplateEditor": { WorkoutTemplateEditor: "WorkoutTemplateEditor" },
      "@/components/WorkoutExerciseListEditor": {
        WorkoutExerciseListEditor: "WorkoutExerciseListEditor",
      },
      "@/components/ui/button": { Button: "Button" },
      "@/components/ui-kit": { Card: "Card", DataError: "DataError", PendingLabel: "PendingLabel" },
      "@/components/ui/dialog": Object.fromEntries(
        ["Dialog", "DialogContent", "DialogDescription", "DialogHeader", "DialogTitle"].map(
          (key) => [key, key],
        ),
      ),
      "@/components/ui/alert-dialog": alertModules,
      sonner: {
        toast: {
          success: (message) => calls.push(["success", message]),
          error: (message) => calls.push(["error", message]),
        },
      },
    },
    props,
    { structuredClone },
  );
  return { ui, calls };
}
const button = (ui, label) => ui.find("Button").find((node) => textOf(node).trim() === label);

test("private workout reads are RLS SELECTs with owner filters, isolated keys and exhaustive cursor pages", async () => {
  const { api, calls } = apiFixture({ count: 231, cap: 37 });
  const options = api.myWorkoutsQueryOptions("user-a", "profile-a");
  const rows = await options.queryFn();
  assert.equal(rows.length, 231);
  assert.equal(new Set(rows.map((row) => row.id)).size, 231);
  assert.equal(rows[0].exerciseCount, 2);
  assert.ok(calls.filter(([kind]) => kind === "select").length > 6);
  assert.ok(
    calls.some(
      (call) => call[0] === "eq" && call[2] === "bulk_profile_id" && call[3] === "profile-a",
    ),
  );
  assert.notDeepEqual(
    clean(options.queryKey),
    clean(api.myWorkoutsQueryOptions("user-b", "profile-a").queryKey),
  );
  assert.equal(api.myWorkoutsQueryOptions(null, "profile-a").enabled, false);
  assert.equal((await api.myWorkoutsQueryOptions(null, "profile-a").queryFn()).length, 0);
  assert.equal(
    calls.some(([kind]) => kind === "rpc"),
    false,
  );
});
test("load one workout maps real system/custom snapshots and uses the explicit canonical exercise FK", async () => {
  const { api, calls } = apiFixture();
  const loaded = await api.workoutByIdQueryOptions("user-a", "profile-a", "workout-0000").queryFn();
  assert.equal(loaded.updatedAt, workout.updatedAt);
  assert.equal(loaded.exercises[0].sourceSystemExerciseId, "system:press");
  assert.equal(loaded.exercises[1].sourceSystemExerciseId, null);
  assert.equal(loaded.exercises[1].name, "My cable row");
  assert.equal(loaded.exercises[1].supportsUnilateral, true);
  assert.ok(
    calls.some(
      (call) =>
        call[0] === "select" && call[2].includes("!workout_template_exercises_exercise_id_fkey"),
    ),
  );
  assert.equal(
    await api.workoutByIdQueryOptions("user-b", "profile-b", "workout-0000").queryFn(),
    null,
  );
  assert.equal(
    await api.workoutByIdQueryOptions(null, "profile-a", "workout-0000").queryFn(),
    null,
  );
});
test("create/save/duplicate/delete use only the existing RPCs and exact concurrency token", async () => {
  const { api, calls } = apiFixture();
  await api.createWorkout("  Upper session  ", "create-id");
  assert.equal(await api.saveWorkout(workout), "2026-10-29T12:01:00.987654Z");
  await api.duplicateWorkout("source", "dup-id");
  assert.equal(await api.deleteWorkout("source"), true);
  assert.deepEqual(calls[0], [
    "rpc",
    "create_workout_template",
    { _title: "Upper session", _request_id: "create-id" },
  ]);
  const save = calls[1][2];
  assert.equal(save._expected_updated_at, workout.updatedAt);
  assert.deepEqual(save._exercises[1], {
    exerciseId: "custom:a",
    sets: 3,
    repMin: 8,
    repMax: 12,
    executionMode: "bilateral",
    notes: "Bench 3",
  });
  assert.deepEqual(calls[2][2], { _template_id: "source", _request_id: "dup-id" });
  assert.deepEqual(calls[3][2], { _template_id: "source" });
});
test("query/mutation errors propagate without optimistic success", async () => {
  const error = new Error("Database unavailable");
  const { api } = apiFixture({ fail: error });
  for (const action of [
    () => api.myWorkoutsQueryOptions("u", "profile-a").queryFn(),
    () => api.workoutByIdQueryOptions("u", "profile-a", "workout-0000").queryFn(),
    () => api.createWorkout("Upper", "id"),
    () => api.saveWorkout(workout),
    () => api.duplicateWorkout("w", "id"),
    () => api.deleteWorkout("w"),
  ])
    await assert.rejects(action, /Database unavailable/);
});
test("fitness users can enter My workouts; legacy/core gates never mount or query the library", () => {
  const fitness = uiFixture("MyWorkoutsPage");
  assert.equal(fitness.ui.find("PageHeader")[0].props.title, "My workouts");
  assert.match(fitness.ui.text(), /Upper session/);
  for (const mode of ["none", "legacy"]) {
    const { ui, calls } = uiFixture("MyWorkoutsPage", {}, {}, { mode });
    assert.doesNotMatch(ui.text(), /Upper session/);
    assert.equal(
      calls.some(([kind]) => kind === "list"),
      false,
    );
  }
});
test("list cards show real title/count and Open/Edit/Duplicate/Delete, without active or fake stats", () => {
  const { ui } = uiFixture("WorkoutLibrary", { userId: "user-a", profileId: "profile-a" });
  const text = ui.text();
  assert.match(text, /Upper session/);
  assert.match(text, /2 exercises/);
  assert.doesNotMatch(
    text,
    /Active|Inactive|calories|difficulty|rating|minutes|Community|Tempo program/i,
  );
  assert.ok(button(ui, "Duplicate"));
  assert.ok(button(ui, "Delete"));
  const links = ui.find("Link");
  assert.equal(links.length, 2);
  assert.deepEqual(clean(links.map((link) => link.props.search)), [
    { edit: false },
    { edit: true },
  ]);
  assert.ok(links.every((link) => link.props.to === "/bulk/training/workouts/$workoutId"));
});
test("empty library explains future reuse, with Create workout and no automatic conversion", () => {
  const { ui, calls } = uiFixture(
    "WorkoutLibrary",
    { userId: "u", profileId: "p" },
    {},
    { state: { data: [] } },
  );
  assert.match(ui.text(), /No workouts yet/);
  assert.match(ui.text(), /reuse in your training plans later/);
  assert.ok(button(ui, "Create workout"));
  assert.equal(
    calls.some(([kind]) => kind === "create"),
    false,
  );
});
test("failed list/open and missing workout keep explicit errors and retries", () => {
  const list = uiFixture(
    "WorkoutLibrary",
    { userId: "u", profileId: "p" },
    {},
    { state: { error: Error("failed") } },
  );
  assert.match(list.ui.find("DataError")[0].props.message, /load your workouts/);
  list.ui.find("DataError")[0].props.onRetry();
  assert.ok(list.calls.some(([kind]) => kind === "retry"));
  const detail = uiFixture(
    "WorkoutDetail",
    { userId: "u", profileId: "p", workoutId: "w", edit: false },
    {},
    { state: { data: null, error: Error("failed") } },
  );
  assert.match(detail.ui.find("DataError")[0].props.message, /load this workout/);
  const missing = uiFixture(
    "WorkoutDetail",
    { userId: "u", profileId: "p", workoutId: "w", edit: false },
    {},
    { state: { data: null } },
  );
  assert.match(missing.ui.text(), /Workout unavailable/);
});
test("create holds one action request id across failures and clears only on success", async () => {
  let fail = true;
  const seen = [],
    opened = [];
  const { ui } = uiFixture(
    "CreateWorkoutDialog",
    { open: true, onOpenChange() {}, onCreated: async (id) => opened.push(id) },
    {
      createWorkout: async (title, id) => {
        seen.push([title, id]);
        if (fail) throw Error("network");
        return "created";
      },
    },
  );
  ui.find("input")[0].props.onChange(event("Private upper"));
  const submit = async () => {
    ui.find("form")[0].props.onSubmit(event());
    await ui.flush();
  };
  await submit();
  await submit();
  assert.equal(seen[0][1], seen[1][1]);
  assert.equal(opened.length, 0);
  assert.match(ui.text(), /Could not create/);
  fail = false;
  await submit();
  assert.equal(seen[2][1], seen[0][1]);
  assert.deepEqual(opened, ["created"]);
  ui.find("input")[0].props.onChange(event("Private upper"));
  await submit();
  assert.notEqual(seen[3][1], seen[0][1]);
});
test("duplicate retries reuse id then refresh only the private library after success", async () => {
  let fail = true;
  const seen = [];
  const { ui, calls } = uiFixture(
    "WorkoutLibrary",
    { userId: "u", profileId: "p" },
    {
      duplicateWorkout: async (_id, request) => {
        seen.push(request);
        if (fail) throw Error("network");
        return "copy";
      },
    },
  );
  const click = async () => {
    button(ui, "Duplicate").props.onClick();
    await ui.flush();
  };
  await click();
  await click();
  assert.equal(seen[0], seen[1]);
  assert.equal(
    calls.some(([kind]) => kind === "success"),
    false,
  );
  fail = false;
  await click();
  assert.equal(seen[2], seen[0]);
  await click();
  assert.notEqual(seen[3], seen[0]);
  assert.ok(
    calls
      .filter(([kind]) => kind === "invalidate")
      .every(([, input]) => input.queryKey[0] === "workout-templates"),
  );
});
test("delete requires confirmation, preserves failure state and navigates safely after deleting open workout", async () => {
  const library = uiFixture("WorkoutLibrary", { userId: "u", profileId: "p" });
  assert.equal(library.ui.find("AlertDialogAction").length, 0);
  button(library.ui, "Delete").props.onClick();
  await library.ui.flush();
  assert.match(library.ui.text(), /plans, exercises and workout history stay unchanged/);
  assert.equal(
    library.calls.some(([kind]) => kind === "delete"),
    false,
  );
  library.ui.find("AlertDialogAction")[0].props.onClick(event());
  await library.ui.flush();
  assert.ok(library.calls.some(([kind]) => kind === "delete"));
  let closed = false;
  const failing = uiFixture(
    "WorkoutDeleteDialog",
    {
      id: "w",
      title: "Upper",
      onClose() {},
      onDeleted: async () => {
        closed = true;
      },
    },
    {
      deleteWorkout: async () => {
        throw Error("network");
      },
    },
  );
  failing.ui.find("AlertDialogAction")[0].props.onClick(event());
  await failing.ui.flush();
  assert.equal(closed, false);
  assert.match(failing.ui.text(), /Could not delete/);
  const detail = uiFixture("WorkoutDetail", {
    userId: "u",
    profileId: "p",
    workoutId: "w",
    edit: false,
  });
  button(detail.ui, "Delete").props.onClick();
  await detail.ui.flush();
  detail.ui.find("AlertDialogAction")[0].props.onClick(event());
  await detail.ui.flush();
  assert.ok(
    detail.calls.some(
      ([kind, input]) =>
        kind === "navigate" && input.to === "/bulk/training/workouts" && input.replace,
    ),
  );
});
test("editor saves supported prescriptions and retains the authoritative returned timestamp for subsequent saves", async () => {
  const received = [];
  const { ui, calls } = uiFixture(
    "WorkoutTemplateEditor",
    { workout, onCancel() {}, onSaved: async (saved) => received.push(clean(saved)) },
    {},
    { file: "src/components/WorkoutTemplateEditor.tsx" },
  );
  ui.find("input")[0].props.onChange(event("Renamed session"));
  button(ui, "Save workout").props.onClick();
  await ui.flush();
  const save = calls.find(([kind]) => kind === "save")[1];
  assert.equal(save.updatedAt, workout.updatedAt);
  assert.equal(save.exercises[1].exerciseId, "custom:a");
  assert.equal(received[0].updatedAt, "2026-10-29T12:01:00.987654Z");
  ui.find("input")[0].props.onChange(event("Renamed again"));
  button(ui, "Save workout").props.onClick();
  await ui.flush();
  assert.equal(calls.filter(([kind]) => kind === "save")[1][1].updatedAt, received[0].updatedAt);
});
test("stale saves retain edits, display the exact conflict and never report success", async () => {
  let saved = false;
  const { ui, calls } = uiFixture(
    "WorkoutTemplateEditor",
    {
      workout,
      onCancel() {},
      onSaved: async () => {
        saved = true;
      },
    },
    {
      saveWorkout: async () => {
        throw { code: "P0001", message: "Workout changed on another device" };
      },
    },
    { file: "src/components/WorkoutTemplateEditor.tsx" },
  );
  ui.find("input")[0].props.onChange(event("My unsaved edit"));
  button(ui, "Save workout").props.onClick();
  await ui.flush();
  assert.match(ui.text(), /Workout changed on another device/);
  assert.equal(saved, false);
  assert.equal(ui.find("input")[0].props.value, "My unsaved edit");
  assert.equal(
    calls.some(([kind]) => kind === "success"),
    false,
  );
});
test("overview shows each exercise/prescription once and preserves custom names, notes and unilateral context", () => {
  const { ui } = uiFixture("WorkoutOverview", {
    exercises: [
      exercise("system:press", { intendedUnilateralMode: "unilateral" }),
      workout.exercises[1],
    ],
  });
  assert.match(ui.text(), /Each side/);
  assert.match(ui.text(), /My cable row/);
  assert.match(ui.text(), /Bench 3/);
  assert.equal(ui.find("h2").length, 2);
  assert.doesNotMatch(ui.text(), /plan|duration|difficulty|active/i);
});
test("private routes preserve contextual Back, safe fallback, primary ownership and replace-only editor modes", async () => {
  const routes = await read("src/routeTree.gen.ts");
  assert.match(routes, /\/bulk\/training\/workouts/);
  for (const path of ["/bulk/training/workouts", "/bulk/training/workouts/workout-a"])
    assert.equal(mainTabForPath(path), "today");
  assert.equal(inAppBackLabel("/bulk/training/workouts"), "My workouts");
  const { ui, calls } = uiFixture("WorkoutDetail", {
    userId: "u",
    profileId: "p",
    workoutId: "w",
    edit: false,
  });
  assert.equal(ui.find("PageHeader")[0].props.backTo, "/bulk/training/workouts");
  assert.equal(ui.find("PageHeader")[0].props.historyBack, true);
  button(ui, "Edit workout").props.onClick();
  await ui.flush();
  assert.equal(calls.find(([kind]) => kind === "navigate")[1].replace, true);
  const trainingSource = await read("src/routes/_authenticated/bulk/training.tsx");
  assert.match(trainingSource, /usesPlanSetup \? \([\s\S]*My plans[\s\S]*My workouts/);
  assert.doesNotMatch(
    await read("src/routes/_authenticated/challenge/new.tsx"),
    /My workouts|workout_templates/,
  );
});

function exerciseEditorFixture(initial = workout.exercises) {
  const props = {
    title: "Upper session",
    exercises: structuredClone(initial),
    onChange(next) {
      props.exercises = next;
    },
  };
  const ui = accountUI(
    "src/components/WorkoutExerciseListEditor.tsx",
    "WorkoutExerciseListEditor",
    {
      "@/lib/training-plans": training,
      "@/components/ui/button": { Button: "Button" },
      "@/components/ui/native-select": { NativeSelect: "NativeSelect" },
      "@/components/PlanExercisePicker": { PlanExercisePicker: "PlanExercisePicker" },
    },
    props,
  );
  return { ui, props };
}
test("shared exercise editor preserves sets/ranges/mode/notes, ordered rows and direct removal", () => {
  const { ui, props } = exerciseEditorFixture();
  const inputs = ui.find("input");
  assert.equal(inputs[0].props.min, 1);
  assert.equal(inputs[0].props.max, 10);
  inputs[0].props.onChange(event("4"));
  ui.find("input")[1].props.onChange(event("6"));
  ui.find("input")[2].props.onChange(event("10"));
  ui.find("input")[3].props.onChange(event("Seat 2"));
  ui.find("NativeSelect")[0].props.onChange(event("unilateral"));
  assert.deepEqual(clean(props.exercises[0]), {
    ...workout.exercises[0],
    sets: 4,
    repMin: 6,
    repMax: 10,
    notes: "Seat 2",
    intendedUnilateralMode: "unilateral",
  });
  ui.find("button")
    .find((node) => node.props["aria-label"] === "Move Press down")
    .props.onClick();
  assert.deepEqual(
    Array.from(props.exercises, (ex) => ex.exerciseId),
    ["custom:a", "system:press"],
  );
  assert.deepEqual(
    Array.from(props.exercises, (ex) => ex.order),
    [1, 2],
  );
  button(ui, "Remove").props.onClick();
  assert.equal(props.exercises[0].exerciseId, "system:press");
  assert.equal(props.exercises[0].sets, 4);
  assert.equal(props.exercises[0].order, 1);
});
test("shared picker adds system/custom exercises, reuses replacement logic and prevents more than 20", () => {
  const { ui, props } = exerciseEditorFixture([]);
  button(ui, "Add Exercise").props.onClick();
  ui.find("PlanExercisePicker")[0].props.onSelect({
    id: "system:pull",
    name: "Pull-Up",
    is_system: true,
    supports_unilateral: false,
    is_bodyweight: true,
  });
  assert.equal(props.exercises[0].sourceSystemExerciseId, "system:pull");
  assert.equal(props.exercises[0].sets, 3);
  assert.equal(props.exercises[0].isBodyweight, true);
  button(ui, "Add Exercise").props.onClick();
  ui.find("PlanExercisePicker")[0].props.onSelect({
    id: "custom:new",
    name: "My custom press",
    is_system: false,
    supports_unilateral: true,
    is_bodyweight: false,
  });
  assert.equal(props.exercises[1].sourceSystemExerciseId, null);
  button(ui, "Replace").props.onClick();
  ui.find("PlanExercisePicker")[0].props.onSelect({
    id: "custom:replace",
    name: "Custom replacement",
    is_system: false,
    supports_unilateral: true,
    is_bodyweight: false,
  });
  assert.equal(props.exercises[0].sets, 3);
  assert.equal(props.exercises[0].exerciseId, "custom:replace");
  assert.equal(ui.find("PlanExercisePicker").length, 0);
  props.exercises = Array.from({ length: 20 }, (_, i) => exercise(`system:${i}`));
  assert.equal(button(ui, "Add Exercise").props.disabled, true);
});
test("TrainingPlanEditor still edits the selected day through shared controls and saves the same plan RPC payload", async () => {
  const seen = [];
  let saved = false;
  const plan = {
    id: "plan-a",
    name: "Original plan",
    updatedAt: "old-token",
    days: [{ id: "day-a", name: "Chest & Back", order: 1, exercises: workout.exercises }],
    trainingDaysPerWeek: 1,
  };
  const ui = accountUI(
    "src/components/TrainingPlanEditor.tsx",
    "TrainingPlanEditor",
    {
      "./BackControl": { BackButton: "BackButton" },
      "@/components/WorkoutExerciseListEditor": {
        WorkoutExerciseListEditor: "WorkoutExerciseListEditor",
      },
      "@/components/ui/button": { Button: "Button" },
      "@/components/ui-kit": {
        Card: "Card",
        PendingLabel: "PendingLabel",
        SectionTitle: "SectionTitle",
      },
      "@/lib/training-plans": training,
      "@/lib/training-plans-query": { saveTrainingPlan: async (input) => seen.push(clean(input)) },
      "@/lib/network-errors": errors,
      sonner: { toast: { success() {} } },
    },
    {
      plan,
      onCancel() {},
      onSaved: async () => {
        saved = true;
      },
    },
    { structuredClone },
  );
  const edit = ui.find("Button").find((node) => textOf(node).includes("Edit Day"));
  edit.props.onClick();
  await ui.flush();
  assert.equal(ui.find("WorkoutExerciseListEditor")[0].props.title, "Chest & Back");
  ui.find("WorkoutExerciseListEditor")[0].props.onChange([
    { ...workout.exercises[0], sets: 5, intendedUnilateralMode: "unilateral", notes: "Bench 2" },
  ]);
  button(ui, "Save and return").props.onClick();
  await ui.flush();
  assert.equal(saved, true);
  assert.equal(seen[0].expectedUpdatedAt, "old-token");
  assert.deepEqual(seen[0].days[0], {
    name: "Chest & Back",
    exercises: [
      {
        exerciseId: "system:press",
        sets: 5,
        repMin: 8,
        repMax: 12,
        executionMode: "unilateral",
        notes: "Bench 2",
      },
    ],
  });
});
test("workout editor validates supported ranges, keeps drafts on failure and confirms cancel without mutation", async () => {
  let cancelled = false;
  const { ui, calls } = uiFixture(
    "WorkoutTemplateEditor",
    {
      workout,
      onCancel: () => {
        cancelled = true;
      },
      onSaved: async () => {},
    },
    {},
    { file: "src/components/WorkoutTemplateEditor.tsx" },
  );
  ui.find("WorkoutExerciseListEditor")[0].props.onChange([
    { ...workout.exercises[0], repMin: 20, repMax: 10 },
  ]);
  button(ui, "Save workout").props.onClick();
  await ui.flush();
  assert.match(ui.text(), /valid rep range/);
  assert.equal(
    calls.some(([kind]) => kind === "save"),
    false,
  );
  button(ui, "Cancel").props.onClick();
  await ui.flush();
  assert.equal(ui.find("AlertDialog")[0].props.open, true);
  assert.equal(cancelled, false);
  ui.find("AlertDialog")[0].props.onOpenChange(false);
  assert.equal(cancelled, false);
  assert.equal(ui.find("WorkoutExerciseListEditor")[0].props.exercises[0].repMin, 20);
  button(ui, "Cancel").props.onClick();
  await ui.flush();
  ui.find("AlertDialogAction")[0].props.onClick();
  assert.equal(cancelled, true);
});
test("mobile controls use bounded two/three-column grids, wrapping labels and 44px targets at narrow widths", async () => {
  const [shared, editor, library] = await Promise.all([
    read("src/components/WorkoutExerciseListEditor.tsx"),
    read("src/components/WorkoutTemplateEditor.tsx"),
    read("src/components/MyWorkouts.tsx"),
  ]);
  for (const source of [shared, editor, library]) {
    assert.match(source, /min-h-11/);
    assert.match(source, /min-w-0/);
    assert.doesNotMatch(source, /w-\[(?:[4-9]\d\d)px\]/);
  }
  assert.match(shared, /grid grid-cols-3 gap-2/);
  assert.match(library, /grid grid-cols-2 gap-2/);
  assert.match(shared, /break-words/);
  assert.match(editor, /safe-area-inset-bottom/);
});
