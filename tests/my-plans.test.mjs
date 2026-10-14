import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { accountUI } from "./account-ui-fixture.mjs";
import { presentationComponent } from "./presentation-component-fixture.mjs";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");
const ROUTE = "src/routes/_authenticated/bulk/training_.plans.tsx";

// Load the real query-layer module (types erased) to exercise the sort comparator directly.
const query = presentationComponent("src/lib/training-plans-query.ts", {
  "@tanstack/react-query": { queryOptions: (x) => x, useQuery: () => ({}) },
  "@/integrations/supabase/client": { supabase: {} },
  "@/lib/network-errors": {
    developmentErrorDiagnostic() {},
    readRetryDelay() {},
    shouldRetryRead() {},
  },
  "@/lib/training-plans": {},
});

const PLANS = [
  {
    id: "old-active",
    name: "Push Pull",
    planType: "custom",
    dayCount: 3,
    active: true,
    createdAt: "2026-01-01T00:00:00Z",
  },
  {
    id: "new-inactive",
    name: "Legs",
    planType: "tempo_preset",
    dayCount: 1,
    active: false,
    createdAt: "2026-05-01T00:00:00Z",
  },
  {
    id: "mid-inactive",
    name: "Upper Lower",
    planType: "custom",
    dayCount: 4,
    active: false,
    createdAt: "2026-03-01T00:00:00Z",
  },
];

function plansFixture({ mode = "public", plans = PLANS, query = {} } = {}) {
  return accountUI(ROUTE, "Route", {
    "@tanstack/react-query": { useQueryClient: () => ({ invalidateQueries: async () => {} }) },
    sonner: { toast: { error() {}, success() {} } },
    "@/components/ui/button": { Button: "Button" },
    "@/components/ui/alert-dialog": Object.fromEntries(
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
    ),
    "@/components/TrainingPlanEditor": { TrainingPlanEditor: "TrainingPlanEditor" },
    "@/components/TrainingPlanSetup": { TrainingPlanSetup: "TrainingPlanSetup" },
    "@/lib/network-errors": { userFacingError: (_e, action) => `Could not ${action}.` },
    "@/lib/store": {
      useAppData: () => ({ targets: {} }),
      useBulkMeta: () => ({ bulkId: "b" }),
    },
    "@/lib/training-plans-query": {
      useTrainingPlans: () => ({ data: plans, isLoading: false, error: null, refetch() {} }),
      useTrainingPlanById: () => ({ data: null, isLoading: true, error: null, refetch() {} }),
      activateTrainingPlan: async () => {},
      deleteTrainingPlan: async () => true,
      duplicateTrainingPlan: async () => "copy",
      ...query,
    },
    "@/lib/bulk-access": {
      bulkPlanModeFor: () => mode,
      useMemberships: () => ({ data: [] }),
    },
  });
}

const buttonLabels = (ui) =>
  ui
    .find("Button")
    .map((node) =>
      (Array.isArray(node.props.children) ? node.props.children : [node.props.children])
        .filter((c) => typeof c === "string")
        .join(""),
    );

// ---------------------------------------------------------------- sort
test("plans sort active first, then newest first", () => {
  const sorted = query.sortTrainingPlanSummaries(PLANS);
  assert.equal(sorted.map((p) => p.id).join(","), "old-active,new-inactive,mid-inactive");
  // Pure: the input array is not mutated.
  assert.equal(PLANS[0].id, "old-active");
});

// ---------------------------------------------------------------- fitness list
test("fitness My plans lists all plans including inactive, active first, with the active badge", () => {
  const ui = plansFixture({ mode: "public" });
  const text = ui.text();
  for (const name of ["Push Pull", "Legs", "Upper Lower"]) assert.match(text, new RegExp(name));
  assert.match(text, /Active/);
  // Plan/workout terminology (top-level is a plan; days are workouts).
  assert.match(text, /· 3 workouts/);
  assert.match(text, /· 1 workout(?!s)/);
});

test("each plan exposes Open, Edit, Duplicate and Delete; inactive also offers Set as active", () => {
  const ui = plansFixture({ mode: "public" });
  const labels = buttonLabels(ui);
  for (const action of ["Open", "Edit", "Duplicate", "Delete", "Create plan"])
    assert.ok(labels.includes(action), `missing ${action}`);
  // Set as active appears for the two inactive plans, not the active one.
  assert.equal(labels.filter((l) => l === "Set as active").length, 2);
});

// ---------------------------------------------------------------- product mode
test("core/challenge-only mode hides My plans and shows the fitness-setup gate", () => {
  const ui = plansFixture({ mode: "legacy" });
  const text = ui.text();
  assert.match(text, /part of the fitness tools/i);
  assert.doesNotMatch(text, /Push Pull/);
  assert.equal(buttonLabels(ui).includes("Create plan"), false);
});

// ---------------------------------------------------------------- source contracts
test("normal create is non-destructive (TrainingPlanSetup without replacingPlan); explicit replace stays in /more", async () => {
  const [route, more] = await Promise.all([
    read(ROUTE),
    read("src/routes/_authenticated/bulk/training_.more.tsx"),
  ]);
  assert.match(route, /<TrainingPlanSetup/);
  assert.doesNotMatch(route, /replacingPlan/);
  assert.match(more, /replacingPlan/);
});

test("delete confirmation copy distinguishes active from inactive and never implies history loss", async () => {
  const route = await read(ROUTE);
  assert.match(route, /Delete active training plan\?/);
  assert.match(route, /Delete this training plan\?/);
  assert.match(route, /no active plan until you choose another/);
  assert.match(route, /workout history stays/);
});

test("duplicate surfaces the RPC domain error instead of a generic message", async () => {
  const route = await read(ROUTE);
  assert.match(route, /P0001/); // our RAISE EXCEPTIONs; message kept verbatim
  assert.match(route, /duplicateTrainingPlan/);
});

test("activate invalidates the active-plan, progression and coverage queries; duplicate stays narrow", async () => {
  const route = await read(ROUTE);
  assert.match(route, /bulk-training-plans/);
  assert.match(route, /bulk-training-plan"/);
  assert.match(route, /bulk-progression/);
  assert.match(route, /bulk-muscle-coverage/);
});

test("plan-count uses the canonical days→plans relationship, not a guessed name", async () => {
  const query = await read("src/lib/training-plans-query.ts");
  // The single FK bulk_training_plan_days_plan_id_fkey makes this embed unambiguous.
  assert.match(query, /bulk_training_plan_days\(count\)/);
});

// --------------------------------------------------------------- request-id idempotency
const findButton = (ui, label) =>
  ui.find("Button").find((node) => {
    const kids = Array.isArray(node.props.children) ? node.props.children : [node.props.children];
    return kids.filter((c) => typeof c === "string").join("") === label;
  });

test("one logical duplicate action reuses the same request id across a retry, then mints a new one", async () => {
  const seen = [];
  let fail = true;
  const ui = plansFixture({
    plans: [PLANS[0]],
    query: {
      duplicateTrainingPlan: async (_planId, requestId) => {
        seen.push(requestId);
        if (fail) throw new Error("network");
        return "copy";
      },
    },
  });
  const click = async () => {
    findButton(ui, "Duplicate").props.onClick();
    await ui.flush();
  };
  await click(); // first attempt fails
  await click(); // retry of the SAME logical action
  assert.equal(seen.length, 2);
  assert.equal(seen[0], seen[1], "retry reuses the request id so the RPC dedupes");

  fail = false;
  await click(); // same id finally succeeds and the id is cleared
  assert.equal(seen[2], seen[0]);

  await click(); // a brand-new deliberate duplicate gets a fresh id
  assert.notEqual(seen[3], seen[0]);
});

// --------------------------------------------------------------- post-create inactive UX
test("creating a plan while one is active shows Plan saved + Set as active (no auto-activation)", async () => {
  const ui = plansFixture({ plans: PLANS }); // PLANS has an active plan
  findButton(ui, "Create plan").props.onClick();
  await ui.flush();
  const setup = ui.find("TrainingPlanSetup")[0];
  await setup.props.onCreated("new-plan-id");
  await ui.flush();
  assert.ok(
    ui.find("PageHeader").some((node) => node.props.title === "Plan saved"),
    "header reads Plan saved",
  );
  assert.match(ui.text(), /current plan is still active/);
  assert.ok(findButton(ui, "Set as active"), "offers an explicit Set as active CTA");
});

test("creating the first plan (none active) returns to the list without the Set as active prompt", async () => {
  const ui = plansFixture({ plans: [] }); // no active plan exists
  findButton(ui, "Create plan").props.onClick();
  await ui.flush();
  const setup = ui.find("TrainingPlanSetup")[0];
  await setup.props.onCreated("first-plan-id");
  await ui.flush();
  assert.doesNotMatch(ui.text(), /Plan saved|current plan is still active/);
});
