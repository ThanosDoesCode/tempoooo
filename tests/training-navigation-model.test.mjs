import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { accountUI, textOf } from "./account-ui-fixture.mjs";
import { presentationComponent } from "./presentation-component-fixture.mjs";
import { mainTabForPath } from "../src/lib/main-navigation.ts";
import { inAppBackLabel } from "../src/lib/in-app-back.ts";

const read = (file) => readFile(new URL(`../${file}`, import.meta.url), "utf8");
const plan = {
  id: "plan-a",
  name: "Original Tempo program",
  updatedAt: "preserved-token",
  trainingDaysPerWeek: 3,
  days: [
    { id: "day-a", order: 1, name: "Chest & Back", exercises: [] },
    { id: "day-b", order: 2, name: "Legs", exercises: [] },
    { id: "day-c", order: 3, name: "Arms", exercises: [] },
  ],
};
function fixture({ more = false, mode = "public", active = plan, session = null } = {}) {
  const calls = [];
  const navigation = {
    Link: "Link",
    useNavigate: () => async (value) => calls.push(["navigate", value]),
    createFileRoute: () => (options) => ({ options }),
  };
  const { NavRows } = presentationComponent("src/components/NavRows.tsx", {
    "@tanstack/react-router": navigation,
    "lucide-react": { ChevronRight: "ChevronRight" },
  });
  const ui = accountUI(
    `src/routes/_authenticated/bulk/${more ? "training_.more" : "training"}.tsx`,
    "Route",
    {
      "@tanstack/react-router": navigation,
      "@tanstack/react-query": {
        useQueryClient: () => ({
          invalidateQueries: async (input) => calls.push(["invalidate", input]),
        }),
      },
      "@/components/PageSkeleton": { PageSkeleton: "PageSkeleton" },
      "@/components/NavRows": { NavRows },
      "@/components/TempoDateTimePicker": { TempoDatePicker: "TempoDatePicker" },
      "@/components/TrainingSession": { TrainingSession: "TrainingSession" },
      "@/components/TrainingPlanSetup": {
        TrainingPlanOverview: "TrainingPlanOverview",
        TrainingPlanSetup: "TrainingPlanSetup",
      },
      "@/components/TrainingPlanEditor": { TrainingPlanEditor: "TrainingPlanEditor" },
      "@/components/BulkMuscleCoverage": { BulkMuscleCoverage: "BulkMuscleCoverage" },
      "@/components/ui/button": { Button: "Button" },
      "@/components/ui-kit": {
        Card: "Card",
        SectionTitle: "SectionTitle",
        DataError: "DataError",
        PendingLabel: "PendingLabel",
      },
      "@/lib/auth": { useAuth: () => ({ user: { id: "user-a" } }) },
      "@/lib/store": {
        useAppData: () => ({ targets: { weeklyWorkoutGoal: 3 }, days: {} }),
        useBulkMeta: () => ({ bulkId: "owner-a", role: "owner" }),
        useActions: () => ({}),
      },
      "@/lib/training-plans-query": {
        useActiveTrainingPlan: (id) => {
          calls.push(["active", id]);
          return {
            data: active,
            isLoading: false,
            error: null,
            refetch: async () => calls.push(["refetch"]),
          };
        },
      },
      "@/lib/bulk-access": { bulkPlanModeFor: () => mode, useMemberships: () => ({ data: [] }) },
      "@/lib/bulk-training-sessions": {
        useActiveBulkTrainingSession: () => ({ data: session, isLoading: false, error: null }),
        useCompletedSessionDates: () => ({ data: undefined }),
        startBulkTrainingSession: async (id) => {
          calls.push(["start", id]);
          return "new-session";
        },
      },
      "@/lib/bulk-progression-query": { useBulkProgressionTargets: () => ({ data: {} }) },
      "@/lib/bulk-muscle-coverage-query": { useBulkMuscleCoverage: () => ({ data: null }) },
      "@/lib/goal-metrics": { mondayOf: (day) => day },
      "@/lib/calc": { iso: (date) => date.toISOString().slice(0, 10) },
      "@/lib/network-errors": { userFacingError: (_error, action) => `Could not ${action}.` },
    },
  );
  return { ui, calls };
}

test("Training landing has exactly the four canonical destinations and no My plans entry", () => {
  const { ui } = fixture();
  assert.deepEqual(
    ui
      .find("Link")
      .map((link) =>
        textOf(link).replace(
          /Your reusable workouts|Your training schedule|Completed sessions|Your best performances/g,
          "",
        ),
      ),
    ["My workouts", "Plan and setup", "Past workouts", "Personal records"],
  );
  assert.deepEqual(
    ui.find("Link").map((link) => link.props.to),
    ["/bulk/training/workouts", "/bulk/training/more", "/bulk/training/history", "/bulk/prs"],
  );
  assert.doesNotMatch(ui.text(), /My plans/);
});
test("Training with no active plan leads to schedule setup, not the compatibility library", () => {
  const { ui } = fixture({ active: null });
  assert.match(ui.text(), /Set up your training schedule/);
  assert.equal(ui.find("Link")[0].props.to, "/bulk/training/more");
  assert.ok(ui.find("Link").every((link) => link.props.to !== "/bulk/training/plans"));
});
test("active plan overview and session generation keep original plan identity and workout days", async () => {
  const { ui, calls } = fixture();
  const overview = ui.find("TrainingPlanOverview")[0];
  assert.equal(overview.props.plan, plan);
  assert.deepEqual(
    plan.days.map((day) => day.name),
    ["Chest & Back", "Legs", "Arms"],
  );
  overview.props.onStart("day-b");
  await ui.flush();
  assert.ok(calls.some(([name, id]) => name === "start" && id === "day-b"));
  assert.ok(
    calls.some(
      ([name, input]) =>
        name === "navigate" &&
        input.to === "/bulk/workout/$sessionId" &&
        input.params.sessionId === "new-session",
    ),
  );
});
test("Plan and setup retains active editor, switch safety and secondary plan-management access", async () => {
  const { ui, calls } = fixture({ more: true, session: { id: "in-progress" } });
  assert.equal(ui.find("PageHeader")[0].props.title, "Plan and setup");
  const manage = ui.find("Link").find((link) => link.props.to === "/bulk/training/plans");
  assert.equal(textOf(manage), "Manage training plans");
  const setup = ui.find("TrainingPlanSetup")[0];
  assert.equal(setup.props.currentPlan, plan);
  assert.equal(setup.props.replacingPlan, true);
  assert.equal(setup.props.selectionDisabled, true);
  await setup.props.onCreated();
  assert.ok(calls.some(([name]) => name === "refetch"));
  ui.find("Button")
    .find((node) => textOf(node) === "Edit training plan")
    .props.onClick();
  await ui.flush();
  assert.equal(ui.find("TrainingPlanEditor")[0].props.plan, plan);
});
test("empty Plan and setup offers schedule guidance without auto-creating or activating anything", () => {
  const { ui, calls } = fixture({ more: true, active: null });
  assert.match(ui.text(), /Configure your training schedule/);
  assert.equal(ui.find("TrainingPlanSetup").length, 1);
  assert.equal(
    calls.some(([kind]) => ["start", "navigate", "invalidate"].includes(kind)),
    false,
  );
});
test("legacy/core Training remains unchanged and never advertises My workouts", () => {
  for (const mode of ["none", "legacy"]) {
    const { ui } = fixture({ mode });
    assert.ok(ui.find("Link").every((link) => link.props.to !== "/bulk/training/workouts"));
    assert.doesNotMatch(ui.text(), /My workouts|My plans/);
    assert.equal(ui.find("TrainingSession").length, mode === "legacy" ? 1 : 0);
  }
});
test("compatibility My Plans route, direct links and CRUD backend remain registered and unchanged", async () => {
  const [route, tree, query] = await Promise.all([
    read("src/routes/_authenticated/bulk/training_.plans.tsx"),
    read("src/routeTree.gen.ts"),
    read("src/lib/training-plans-query.ts"),
  ]);
  assert.match(route, /createFileRoute\("\/_authenticated\/bulk\/training_\/plans"\)/);
  assert.match(tree, /'\/bulk\/training\/plans'/);
  for (const action of [
    "activateTrainingPlan",
    "duplicateTrainingPlan",
    "deleteTrainingPlan",
    "TrainingPlanEditor",
    "TrainingPlanSetup",
  ])
    assert.ok(route.includes(action), action);
  assert.match(query, /save_bulk_training_plan/);
  assert.match(query, /_expected_updated_at: input.expectedUpdatedAt/);
});
test("canonical navigation retains intent links, contextual Back, existing route order and narrow row sizing", () => {
  const { ui } = fixture();
  for (const link of ui.find("Link")) {
    assert.equal(link.props.preload, "intent");
    assert.equal(link.props.replace, undefined);
    assert.match(link.props.className, /min-h-\[56px\]/);
    assert.match(link.props.className, /items-center.*justify-between.*gap-3/);
  }
  assert.equal(ui.find("HistoryBackLink")[0].props.fallback, "/bulk");
  assert.equal(inAppBackLabel("/bulk/training/more"), "Plan and setup");
  assert.equal(mainTabForPath("/bulk/training/workouts"), "today");
  assert.equal(mainTabForPath("/bulk/training/plans"), "today");
});
