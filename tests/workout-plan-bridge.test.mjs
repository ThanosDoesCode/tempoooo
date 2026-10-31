import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { accountUI, event, textOf, deferred } from "./account-ui-fixture.mjs";
import { presentationComponent } from "./presentation-component-fixture.mjs";
import * as training from "../src/lib/training-plans.ts";
import * as copy from "../src/lib/workout-plan-copy.ts";

const clean = (value) => JSON.parse(JSON.stringify(value));
const exercise = (n, extra = {}) => ({
  id: `source-row-${n}`,
  exerciseId: `system:exercise-${n}`,
  sourceSystemExerciseId: `system:exercise-${n}`,
  name: `Exercise ${n}`,
  order: n,
  sets: n + 1,
  repMin: 6,
  repMax: 10,
  intendedUnilateralMode: "bilateral",
  notes: `Note ${n}`,
  supportsUnilateral: true,
  isBodyweight: false,
  ...extra,
});
const workout = {
  id: "source",
  title: "Push",
  updatedAt: "2026-11-01T12:00:00.123456Z",
  exercises: [
    exercise(3),
    exercise(1, { intendedUnilateralMode: "unilateral", notes: "Left and right" }),
    exercise(2, { exerciseId: "custom:mine", sourceSystemExerciseId: null }),
  ],
};
const day = { id: "day-a", name: "Old day", order: 2, exercises: [exercise(1)] };
const errors = {
  userFacingError: (_error, action) => `Could not ${action}.`,
  developmentErrorDiagnostic() {},
  shouldRetryRead: () => false,
  readRetryDelay: () => 0,
};
const components = Object.fromEntries(
  ["DialogContent", "DialogDescription", "DialogHeader", "DialogTitle"].map((key) => [key, key]),
);
function bridge({
  values = [{ id: "source", title: "Push", exerciseCount: 3 }],
  api = {},
  props = {},
  mode = "public",
  root = false,
} = {}) {
  const calls = [],
    replaced = [];
  const query = {
    data: values,
    isLoading: false,
    error: null,
    refetch: async () => calls.push(["refetch"]),
    ...api.listState,
  };
  const library = {
    useMyWorkouts: (...args) => {
      calls.push(["list", ...args]);
      return query;
    },
    usePrivateWorkout: () => ({
      data: { ...workout, id: "new", exercises: [] },
      isLoading: false,
      error: null,
      ...api.createdState,
    }),
    fetchPrivateWorkout: async (...args) => {
      calls.push(["load", ...args]);
      return structuredClone(workout);
    },
    copyPlanDayToWorkout: async (...args) => {
      calls.push(["copy", ...args]);
      return { ...workout, id: "copy" };
    },
    workoutListKey: (u, p) => ["workout-templates", u, p],
    workoutDetailKey: (u, p, id) => ["workout-template", u, p, id],
    ...api,
  };
  const ui = accountUI(
    "src/components/PlanDayWorkoutBridge.tsx",
    root ? "PlanDayWorkoutBridge" : "PlanDayWorkoutActions",
    {
      "@/components/ui/button": { Button: "Button" },
      "@/components/ui-kit": { DataError: "DataError", PendingLabel: "PendingLabel" },
      "@/components/ui/dialog": {
        Dialog: ({ open, children }) => (open ? children : null),
        ...components,
      },
      "@/components/MyWorkouts": { CreateWorkoutDialog: "CreateWorkoutDialog" },
      "@/components/WorkoutTemplateEditor": { WorkoutTemplateEditor: "WorkoutTemplateEditor" },
      "@/lib/workout-plan-copy": copy,
      "@/lib/workout-templates-query": library,
      "@/lib/network-errors": errors,
      "@/lib/auth": { useAuth: () => ({ user: { id: "owner" } }) },
      "@/lib/store": { useBulkMeta: () => ({ bulkId: "profile" }) },
      "@/lib/bulk-access": { useMemberships: () => ({ data: [] }), bulkPlanModeFor: () => mode },
      "@tanstack/react-query": {
        useQueryClient: () => ({
          invalidateQueries: async (...args) => calls.push(["invalidate", ...args]),
          setQueryData: (...args) => calls.push(["cache", ...args]),
        }),
      },
      sonner: { toast: { success: (message) => calls.push(["toast", message]) } },
    },
    {
      day: structuredClone(day),
      onReplace: (value) => replaced.push(value),
      userId: "owner",
      profileId: "profile",
      ...props,
    },
    { structuredClone },
  );
  return { ui, calls, replaced };
}
const button = (ui, label) => ui.find("Button").find((node) => textOf(node) === label);
const select = (ui) => ui.find("Button").find((node) => node.props["aria-label"] === "Select Push");

// Small server model for the real API orchestration (RLS/filtering SQL is exercised separately).
function apiFixture({ failure = null } = {}) {
  const rows = new Map(),
    calls = [];
  let counter = 0;
  const supabase = {
    from(table) {
      const filters = {};
      const q = {
        select() {
          return q;
        },
        eq(key, value) {
          filters[key] = value;
          return q;
        },
        order() {
          return q;
        },
        maybeSingle() {
          const row = rows.get(filters.id);
          return Promise.resolve({
            data:
              row && row.bulk_profile_id === filters.bulk_profile_id
                ? { id: row.id, title: row.title, updated_at: row.updatedAt }
                : null,
            error: null,
          });
        },
        then(resolve, reject) {
          const row = rows.get(filters.workout_template_id);
          return Promise.resolve({
            data: (row?.exercises ?? []).map((e, i) => ({
              id: `db-${counter}-${i}`,
              exercise_id: e.exerciseId,
              source_system_exercise_id: e.sourceSystemExerciseId,
              exercise_name: e.name,
              exercise_order: i + 1,
              sets: e.sets,
              rep_min: e.repMin,
              rep_max: e.repMax,
              intended_unilateral_mode: e.intendedUnilateralMode,
              notes: e.notes,
              bulk_exercises: {
                supports_unilateral: e.supportsUnilateral,
                is_bodyweight: e.isBodyweight,
              },
            })),
            error: null,
          }).then(resolve, reject);
        },
      };
      calls.push(["read", table, filters]);
      return q;
    },
    async rpc(name, args) {
      calls.push([name, clean(args)]);
      if (name === "create_workout_template") {
        if (!rows.has(args._request_id))
          rows.set(args._request_id, {
            id: args._request_id,
            bulk_profile_id: "profile",
            title: args._title,
            updatedAt: "initial-token",
            exercises: [],
          });
        return { data: args._request_id, error: null };
      }
      const row = rows.get(args._template);
      if (row.updatedAt !== args._expected_updated_at)
        return { error: { message: "Workout changed on another device" } };
      if (failure === "before") {
        failure = null;
        return { error: { message: "network failure" } };
      }
      row.title = args._title;
      row.exercises = args._exercises.map((e, i) =>
        exercise(i + 1, {
          exerciseId: e.exerciseId,
          sets: e.sets,
          repMin: e.repMin,
          repMax: e.repMax,
          intendedUnilateralMode: e.executionMode,
          notes: e.notes,
        }),
      );
      row.updatedAt = `server-token-${++counter}`;
      if (failure === "after") {
        failure = null;
        return { error: { message: "response lost" } };
      }
      return { data: row.updatedAt, error: null };
    },
  };
  const api = presentationComponent("src/lib/workout-templates-query.ts", {
    "@tanstack/react-query": { queryOptions: (v) => v, useQuery: () => ({}) },
    "@/integrations/supabase/client": { supabase },
    "@/lib/network-errors": errors,
  });
  return { api, rows, calls };
}

test("workout insertion copies title/prescriptions in canonical order with independent row identity", () => {
  const before = structuredClone(workout),
    snapshot = copy.workoutToPlanDay(workout, day);
  assert.equal(snapshot.name, "Push");
  assert.equal(snapshot.id, day.id);
  assert.equal(snapshot.order, 2);
  assert.deepEqual(
    snapshot.exercises.map((e) => e.order),
    [1, 2, 3],
  );
  assert.deepEqual(
    snapshot.exercises.map((e) => e.exerciseId),
    ["system:exercise-1", "custom:mine", "system:exercise-3"],
  );
  for (const e of snapshot.exercises) {
    assert.notEqual(e.id, before.exercises.find((old) => old.exerciseId === e.exerciseId).id);
    const { id, ...fields } = e;
    const { id: oldId, ...oldFields } = before.exercises.find(
      (old) => old.exerciseId === e.exerciseId,
    );
    assert.deepEqual(fields, oldFields);
  }
  assert.deepEqual(workout, before);
  assert.equal(snapshot.exercises[0].intendedUnilateralMode, "unilateral");
  assert.equal(snapshot.exercises[0].notes, "Left and right");
});
test("template edit/delete and plan-day edit are independent copies, with no source template relationship", () => {
  const source = structuredClone(workout),
    snapshot = copy.workoutToPlanDay(source, day);
  source.exercises[0].sets = 10;
  source.title = "Edited";
  assert.equal(snapshot.name, "Push");
  assert.equal(snapshot.exercises[2].sets, 4);
  snapshot.exercises[0].notes = "Plan-only note";
  assert.equal(source.exercises[1].notes, "Left and right");
  source.exercises.length = 0;
  assert.equal(snapshot.exercises.length, 3);
  assert.equal("workoutTemplateId" in snapshot, false);
  assert.equal("sourceWorkoutTemplateId" in snapshot, false);
});
test("long workout names require an explicit valid plan-day name, and unavailable exercises cannot be copied", () => {
  assert.throws(
    () => copy.workoutToPlanDay({ ...workout, title: "x".repeat(61) }, day),
    /60 characters/,
  );
  assert.equal(
    copy.workoutToPlanDay({ ...workout, title: "x".repeat(80) }, day, "Push day").name,
    "Push day",
  );
  assert.throws(
    () =>
      copy.workoutToPlanDay({ ...workout, exercises: [exercise(1, { exerciseId: null })] }, day),
    /unavailable/,
  );
});
test("Save to My workouts captures independent ordered prescriptions once and validates before any create", () => {
  const source = structuredClone(day),
    request = copy.planDayCopyRequest(source, "Push");
  source.exercises[0].sets = 9;
  assert.equal(request.exercises[0].sets, 2);
  assert.notEqual(request.exercises[0].id, day.exercises[0].id);
  assert.throws(() => copy.planDayCopyRequest(day, "x"), /between 2 and 80/);
});
test("fitness gate renders bridge actions; core and legacy never mount the private library", () => {
  for (const mode of ["none", "legacy"]) {
    const { ui, calls } = bridge({ mode, root: true });
    assert.equal(ui.text(), "");
    assert.equal(calls.length, 0);
  }
  const { ui } = bridge({ root: true });
  assert.match(ui.text(), /Choose from My workouts|Create new workout|Save to My workouts/);
});
test("picker lists only owner-scoped summaries and selects a fresh snapshot without saving the plan", async () => {
  const { ui, calls, replaced } = bridge();
  button(ui, "Choose from My workouts").props.onClick();
  assert.match(ui.text(), /Choose workout|Push3 exercises/);
  assert.ok(calls.some((c) => c[0] === "list" && c[1] === "owner" && c[2] === "profile"));
  select(ui).props.onClick();
  await ui.flush();
  assert.equal(replaced.length, 1);
  assert.equal(replaced[0].name, "Push");
  assert.equal(replaced[0].exercises.length, 3);
  assert.deepEqual(
    calls.find((c) => c[0] === "load"),
    ["load", "owner", "profile", "source"],
  );
  assert.equal(
    calls.some((c) => c[0] === "copy"),
    false,
  );
  assert.equal(ui.find("DialogContent").length, 0);
});
test("Cancel does not replace a plan day; empty picker offers the existing private create flow", () => {
  const { ui, replaced } = bridge({ values: [] });
  button(ui, "Choose from My workouts").props.onClick();
  assert.match(ui.text(), /No saved workouts yet/);
  button(ui, "Cancel").props.onClick();
  assert.equal(replaced.length, 0);
  button(ui, "Choose from My workouts").props.onClick();
  button(ui, "Create workout").props.onClick();
  assert.equal(ui.find("CreateWorkoutDialog")[0].props.open, true);
  assert.equal(replaced.length, 0);
});
test("picker load failure or deleted source leaves current day unchanged and supports retry", async () => {
  let failed = true;
  const { ui, replaced } = bridge({
    api: {
      fetchPrivateWorkout: async () => {
        if (failed) throw Error("offline");
        return null;
      },
    },
  });
  button(ui, "Choose from My workouts").props.onClick();
  select(ui).props.onClick();
  await ui.flush();
  assert.match(ui.text(), /Could not load this workout/);
  assert.equal(replaced.length, 0);
  failed = false;
  select(ui).props.onClick();
  await ui.flush();
  assert.equal(replaced.length, 0);
});
test("create from setup reuses WorkoutTemplateEditor and offers an optional snapshot after save", async () => {
  const { ui, replaced, calls } = bridge();
  button(ui, "Create new workout").props.onClick();
  await ui.find("CreateWorkoutDialog")[0].props.onCreated("new");
  await ui.flush();
  const editor = ui.find("WorkoutTemplateEditor")[0];
  assert.equal(editor.props.embedded, true);
  assert.equal(editor.props.workout.id, "new");
  assert.equal(replaced.length, 0);
  await editor.props.onSaved({ ...workout, id: "new", updatedAt: "server-token" });
  await ui.flush();
  assert.ok(button(ui, "Add to plan"));
  assert.ok(button(ui, "Not now"));
  assert.equal(replaced.length, 0);
  button(ui, "Add to plan").props.onClick();
  assert.equal(replaced[0].name, "Push");
  assert.equal(replaced[0].exercises.length, 3);
  assert.ok(calls.some((c) => c[0] === "cache" && c[2].updatedAt === "server-token"));
});
test("Not now leaves newly created private workout outside the plan; read retry never creates another", async () => {
  const { ui, replaced } = bridge();
  await ui.find("CreateWorkoutDialog")[0].props.onCreated("new");
  await ui.flush();
  await ui.find("WorkoutTemplateEditor")[0].props.onSaved({ ...workout, id: "new" });
  await ui.flush();
  button(ui, "Not now").props.onClick();
  assert.equal(replaced.length, 0);
  const failed = bridge({
    api: { createdState: { data: null, error: Error("offline"), refetch: async () => {} } },
  });
  await failed.ui.find("CreateWorkoutDialog")[0].props.onCreated("new");
  await failed.ui.flush();
  assert.match(failed.ui.find("DataError")[0].props.message, /Retry to continue editing/);
  button(failed.ui, "Cancel").props.onClick();
  assert.equal(failed.ui.find("DialogContent").length, 0);
  assert.equal(failed.ui.find("WorkoutTemplateEditor").length, 0);
});
test("saving plan day keeps request identity and captured values across retry, then allows a fresh copy", async () => {
  const seen = [];
  let fail = true;
  const { ui, replaced } = bridge({
    api: {
      copyPlanDayToWorkout: async (u, p, request) => {
        seen.push(request);
        if (fail) {
          fail = false;
          throw Error("network");
        }
        return { ...workout, id: request.requestId };
      },
    },
  });
  button(ui, "Save to My workouts").props.onClick();
  button(ui, "Save workout").props.onClick();
  await ui.flush();
  assert.match(ui.text(), /retry finishes the same private workout/i);
  const id = seen[0].requestId;
  button(ui, "Save workout").props.onClick();
  await ui.flush();
  assert.equal(seen[1].requestId, id);
  assert.equal(seen[0], seen[1]);
  assert.equal(replaced.length, 0);
  button(ui, "Save to My workouts").props.onClick();
  button(ui, "Save workout").props.onClick();
  await ui.flush();
  assert.notEqual(seen[2].requestId, id);
});
test("double-tapping Save is one logical copy and cannot submit a second request while pending", async () => {
  const wait = deferred();
  let count = 0;
  const { ui } = bridge({
    api: {
      copyPlanDayToWorkout: () => {
        count++;
        return wait.promise;
      },
    },
  });
  button(ui, "Save to My workouts").props.onClick();
  const save = button(ui, "Save workout");
  save.props.onClick();
  save.props.onClick();
  assert.equal(count, 1);
  wait.resolve(workout);
  await ui.flush();
});
test("existing plan save receives only the copied day payload and retains concurrency/history path", async () => {
  const saved = [];
  const plan = {
    id: "plan",
    name: "Original plan",
    updatedAt: "exact-token",
    days: [structuredClone(day)],
  };
  const ui = accountUI(
    "src/components/TrainingPlanEditor.tsx",
    "TrainingPlanEditor",
    {
      "./BackControl": { BackButton: "BackButton" },
      "@/components/PlanDayWorkoutBridge": { PlanDayWorkoutBridge: "PlanDayWorkoutBridge" },
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
      "@/lib/training-plans-query": { saveTrainingPlan: async (input) => saved.push(clean(input)) },
      "@/lib/network-errors": errors,
      sonner: { toast: { success() {} } },
    },
    { plan, onCancel() {}, onSaved: async () => {} },
    { structuredClone },
  );
  button(ui, "Edit Day ").props.onClick();
  ui.find("PlanDayWorkoutBridge")[0].props.onReplace(copy.workoutToPlanDay(workout, day));
  button(ui, "Save and return").props.onClick();
  await ui.flush();
  assert.equal(saved[0].expectedUpdatedAt, "exact-token");
  assert.equal(saved[0].days[0].name, "Push");
  assert.equal(saved[0].days[0].exercises[0].exerciseId, "system:exercise-1");
  assert.equal(JSON.stringify(saved).includes("source-row"), false);
});
test("copy API uses existing RPCs, stable create ID, exact server token and independent stored rows", async () => {
  const { api, rows, calls } = apiFixture();
  const request = copy.planDayCopyRequest({ ...day, exercises: workout.exercises }, "Push");
  const result = await api.copyPlanDayToWorkout("owner", "profile", request);
  assert.equal(result.id, request.requestId);
  assert.equal(rows.size, 1);
  assert.notEqual(result.exercises[0].id, request.exercises[0].id);
  assert.equal(
    calls.find((c) => c[0] === "save_workout_template_exercises")[1]._expected_updated_at,
    "initial-token",
  );
  assert.deepEqual(
    calls
      .find((c) => c[0] === "save_workout_template_exercises")[1]
      ._exercises.map((e) => e.exerciseId),
    ["system:exercise-1", "custom:mine", "system:exercise-3"],
  );
  await api.copyPlanDayToWorkout("owner", "profile", request);
  assert.equal(rows.size, 1);
  assert.equal(calls.filter((c) => c[0] === "save_workout_template_exercises").length, 1);
});
test("failed save leaves one private row and retry finishes it rather than creating a duplicate", async () => {
  const { api, rows } = apiFixture({ failure: "before" });
  const request = copy.planDayCopyRequest(day, "Push");
  await assert.rejects(api.copyPlanDayToWorkout("owner", "profile", request));
  assert.equal(rows.size, 1);
  assert.equal(rows.get(request.requestId).exercises.length, 0);
  await api.copyPlanDayToWorkout("owner", "profile", request);
  assert.equal(rows.size, 1);
  assert.equal(rows.get(request.requestId).exercises.length, 1);
});
test("lost save response reconciles exact persisted prescriptions without overwriting again", async () => {
  const { api, calls } = apiFixture({ failure: "after" });
  const request = copy.planDayCopyRequest(day, "Push");
  const saved = await api.copyPlanDayToWorkout("owner", "profile", request);
  assert.equal(saved.title, "Push");
  assert.equal(calls.filter((c) => c[0] === "save_workout_template_exercises").length, 1);
});
test("concurrent changes to a partially created workout never silently overwrite that workout", async () => {
  const { api, rows } = apiFixture({ failure: "before" });
  const request = copy.planDayCopyRequest(day, "Push");
  await assert.rejects(api.copyPlanDayToWorkout("owner", "profile", request));
  rows.get(request.requestId).title = "Another device";
  rows.get(request.requestId).updatedAt = "different-token";
  await assert.rejects(api.copyPlanDayToWorkout("owner", "profile", request), /./);
  assert.equal(rows.get(request.requestId).title, "Another device");
});
test("mobile bridge uses compact wrapped actions, bounded dialog and existing routes/gating only", () => {
  const source = readFileSync(
    new URL("../src/components/PlanDayWorkoutBridge.tsx", import.meta.url),
    "utf8",
  );
  assert.match(source, /min-h-11/);
  assert.match(source, /whitespace-normal/);
  assert.match(
    source,
    /max-h-\[calc\(100dvh-2rem-env\(safe-area-inset-top,0px\)-env\(safe-area-inset-bottom,0px\)\)\]/,
  );
  assert.match(source, /overflow-y-auto/);
  assert.match(source, /break-words/);
  assert.match(source, /\[&>button:last-child\]:w-11/);
  assert.doesNotMatch(source, /\[&>button\]:w-11/);
  assert.doesNotMatch(source, /useNavigate|window\.location|source_workout_template_id|\.from\(/);
});
