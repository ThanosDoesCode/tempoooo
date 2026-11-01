import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { accountUI, textOf } from "./account-ui-fixture.mjs";
import { presentationComponent } from "./presentation-component-fixture.mjs";
import { MAIN_TABS, isFocusScreen, mainTabForPath } from "../src/lib/main-navigation.ts";
import { inAppBackLabel } from "../src/lib/in-app-back.ts";

const planner = await import("../src/lib/planner.ts");
const read = (file) => readFileSync(new URL(`../${file}`, import.meta.url), "utf8");
const TODAY = "2026-10-02";
// Values built inside the component sandbox come from another realm: compare their JSON shape.
const plain = (value) => (value === undefined ? value : JSON.parse(JSON.stringify(value)));
const same = (actual, expected, message) =>
  assert.deepEqual(plain(actual), plain(expected), message);

const item = (overrides = {}) => ({
  id: "11111111-1111-4111-8111-111111111111",
  type: "run",
  date: "2026-10-03",
  time: "09:00",
  source: null,
  planDayId: null,
  templateId: null,
  workoutName: null,
  exerciseCount: null,
  distanceKm: null,
  durationSeconds: null,
  note: null,
  sessionId: null,
  sessionStatus: null,
  challengeActivityId: null,
  loggedDistanceKm: null,
  loggedDurationSeconds: null,
  updatedAt: "2026-10-01T00:00:00.000000+00:00",
  ...overrides,
});
const workout = (overrides = {}) =>
  item({
    type: "workout",
    source: "plan_day",
    planDayId: "day-1",
    workoutName: "Upper B",
    exerciseCount: 6,
    date: TODAY,
    time: "18:00",
    ...overrides,
  });

// ---------------------------------------------------------------- detail sheet
function sheet(planned, { challengeStatus = "active", active = null, startResult = "s-new" } = {}) {
  const calls = [];
  const navigations = [];
  const ui = accountUI(
    "src/components/PlannedItemSheet.tsx",
    "PlannedItemSheet",
    {
      "@tanstack/react-router": {
        Link: "Link",
        useNavigate: () => async (to) => {
          navigations.push(to);
        },
      },
      "@tanstack/react-query": {
        useQueryClient: () => ({ invalidateQueries: async () => {} }),
      },
      "@/components/ui/drawer": {
        Drawer: "Drawer",
        DrawerClose: "DrawerClose",
        DrawerContent: "DrawerContent",
        DrawerTitle: "DrawerTitle",
      },
      "@/components/ui/alert-dialog": new Proxy({}, { get: (_, name) => String(name) }),
      "@/components/TempoDateTimePicker": {
        TempoDatePicker: "TempoDatePicker",
        TempoTimePicker: "TempoTimePicker",
      },
      "@/components/PlannerParts": { ActivityTile: "ActivityTile" },
      "@/lib/challenge": {
        useMyChallenge: () => ({
          data: challengeStatus ? { status: challengeStatus } : null,
          isLoading: false,
        }),
      },
      "@/lib/bulk-training-sessions": {
        startBulkTrainingSession: async (day) => {
          calls.push(["start", day]);
          return startResult;
        },
        useActiveBulkTrainingSession: () => ({ data: active, isLoading: false, error: null }),
      },
      "@/lib/network-errors": {
        developmentErrorDiagnostic() {},
        userFacingError: () => "Could not do that. Try again.",
      },
      "@/lib/planner": planner,
      "@/lib/planner-query": {
        deletePlannedActivity: async (id) => calls.push(["delete", id]),
        invalidatePlanner: async () => calls.push(["invalidate"]),
        linkPlannedSession: async (id, session) => calls.push(["link", id, session]),
        reschedulePlannedActivity: async (...args) => calls.push(["reschedule", ...args]),
      },
    },
    { item: planned, open: true, loading: false, profileId: "profile", today: TODAY, onClose() {} },
  );
  return { ui, calls, navigations };
}

test("planned Run with an active Challenge opens the existing form with raw prefill only", () => {
  const { ui } = sheet(item({ distanceKm: 5, durationSeconds: 1800, note: "Easy pace" }));
  const log = ui.find("Link").find((node) => node.props.to === "/challenge/add");
  same(log.props.search, {
    type: "run",
    planned: "11111111-1111-4111-8111-111111111111",
    distance: "5",
    duration: 1800,
    note: "Easy pace",
  });
  assert.match(ui.text(), /Log run/);
  assert.match(ui.text(), /Opens the run form with these values filled in\./);
  assert.match(ui.text(), /Planned distance5 km/);
  assert.match(ui.text(), /Planned time30 min/);
  assert.ok(ui.button("Reschedule"));
  assert.ok(ui.button("Edit"));
  assert.ok(ui.button("Delete from planner"));
});

test("a planned Ride prefills raw km (never 3:1 converted) and logs as a cycle", () => {
  const { ui } = sheet(item({ type: "ride", distanceKm: 20 }));
  const log = ui.find("Link").find((node) => node.props.to === "/challenge/add");
  assert.equal(log.props.search.type, "cycle");
  assert.equal(log.props.search.distance, "20");
  assert.match(ui.text(), /Log ride/);
});

test("without an active Challenge Run/Ride show concise copy, no dead Log button, and stay editable", () => {
  for (const status of [null, "ended"]) {
    const { ui } = sheet(item({ type: "ride", distanceKm: 20 }), { challengeStatus: status });
    assert.equal(
      ui.find("Link").some((node) => node.props.to === "/challenge/add"),
      false,
    );
    assert.match(ui.text(), /Logging runs and rides currently requires an active Challenge\./);
    assert.doesNotMatch(ui.text(), /Log ride/);
    assert.ok(ui.button("Reschedule"));
    assert.ok(ui.button("Edit"));
  }
});

test("My Workouts items show Open workout (no Start, no plan copy); deleted sources stay readable", () => {
  const { ui, calls } = sheet(
    workout({
      source: "my_workout",
      planDayId: null,
      templateId: "tpl-1",
      workoutName: "Upper Body",
    }),
  );
  const open = ui
    .find("Link")
    .find((node) => node.props.to === "/bulk/training/workouts/$workoutId");
  same(open.props.params, { workoutId: "tpl-1" });
  assert.equal(textOf(open), "Open workout");
  assert.doesNotMatch(ui.text(), /Start workout/);
  same(calls, []);

  const orphan = sheet(workout({ source: "my_workout", planDayId: null, templateId: null })).ui;
  assert.match(orphan.text(), /This workout was deleted from My Workouts/);
  assert.match(orphan.text(), /Upper B/);
});

test("Start uses the existing session start once, links that session, then opens the workout", async () => {
  const { ui, calls, navigations } = sheet(workout());
  ui.button("Start workout").props.onClick();
  await ui.flush();
  await ui.flush();
  same(calls.slice(0, 2), [
    ["start", "day-1"],
    ["link", "11111111-1111-4111-8111-111111111111", "s-new"],
  ]);
  same(navigations.at(-1), {
    to: "/bulk/workout/$sessionId",
    params: { sessionId: "s-new" },
  });
});

test("an active session is resumed, never duplicated; future and orphaned plan days cannot start", async () => {
  const resumed = sheet(workout(), { active: { id: "s-active" } });
  resumed.ui.button("Resume workout").props.onClick();
  await resumed.ui.flush();
  await resumed.ui.flush();
  assert.equal(
    resumed.calls.some(([name]) => name === "start"),
    false,
  );
  same(resumed.navigations.at(-1).params, { sessionId: "s-active" });

  const future = sheet(workout({ date: "2026-10-05" })).ui;
  assert.match(future.text(), /You can start it on the day\./);
  assert.doesNotMatch(future.text(), /Start workout/);

  const orphan = sheet(workout({ planDayId: null })).ui;
  assert.match(orphan.text(), /no longer in your current plan/);
});

test("completed items show completion from real history and keep only Delete", () => {
  const { ui } = sheet(workout({ sessionId: "s", sessionStatus: "completed" }));
  assert.match(ui.text(), /Completed\. Your logged workout is in your history\./);
  assert.throws(() => ui.button("Reschedule"));
  assert.throws(() => ui.button("Edit"));
  assert.ok(ui.button("Delete from planner"));
});

test("Reschedule writes only after Save; Cancel writes nothing", async () => {
  const { ui, calls } = sheet(item());
  ui.button("Reschedule").props.onClick();
  ui.render();
  ui.button("Cancel").props.onClick();
  ui.render();
  same(calls, []);
  ui.button("Reschedule").props.onClick();
  ui.render();
  ui.find("TempoDatePicker")[0].props.onChange("2026-10-09");
  ui.find("TempoTimePicker")[0].props.onChange("07:30");
  ui.button("Save").props.onClick();
  await ui.flush();
  same(calls[0], ["reschedule", item().id, "2026-10-09", "07:30"]);
});

test("Delete asks for an in-app confirmation (no native confirm) before deleting planner data only", async () => {
  const { ui, calls } = sheet(item());
  ui.button("Delete from planner").props.onClick();
  ui.render();
  assert.equal(ui.find("AlertDialog")[0].props.open, true);
  same(calls, []);
  ui.find("AlertDialogAction")[0].props.onClick();
  await ui.flush();
  same(calls[0], ["delete", item().id]);
  const source = read("src/components/PlannedItemSheet.tsx");
  assert.doesNotMatch(source, /window\.confirm|confirm\(/);
});

// ---------------------------------------------------------------- Today Upcoming
function upcoming(data) {
  return accountUI(
    "src/components/TodayUpcoming.tsx",
    "TodayUpcoming",
    {
      "./PlannerParts": {
        ActivityTile: "ActivityTile",
        PlannerCard: ({ children }) => ({ type: "PlannerCard", props: { children } }),
        PlannerRowText: ({ title, detail }) => `${title}|${detail};`,
        plannerRowClass: "row",
      },
      "@/lib/planner": planner,
      "@/lib/planner-query": { usePlannerUpcoming: () => ({ data }) },
    },
    { profileId: "profile", today: TODAY },
  );
}

test("Today Upcoming shows real items with when-labels and View planner; nothing when empty", () => {
  const ui = upcoming([
    item({ distanceKm: 5 }),
    item({ id: "b", type: "ride", date: "2026-10-04", time: null, distanceKm: 20 }),
    workout({ id: "c", date: "2026-10-05", workoutName: "Lower A" }),
  ]);
  assert.match(ui.text(), /Run · 5 km\|Tomorrow · 09:00;/);
  assert.match(ui.text(), /Ride · 20 km\|Sunday · any time;/);
  assert.match(ui.text(), /Lower A\|Monday · 18:00;/);
  assert.match(ui.text(), /View planner/);
  const rows = ui.find("Link").filter((node) => node.props.search?.item);
  assert.equal(rows.length, 3);
  assert.equal(upcoming([]).render(), null);
  assert.equal(upcoming(undefined).render(), null);
});

test("Today makes exactly one bounded, non-blocking Planner read, only for full fitness", async () => {
  const calls = [];
  const builder = new Proxy(
    {},
    {
      get(_, method) {
        if (method === "then")
          return (resolve) =>
            resolve({
              // The server already excluded completed rows; a stray one is still never shown.
              data: [
                {
                  ...row("a", "2026-10-02"),
                  challenge_activity_id: "x",
                  challenge_activities: { distance_km: 5, duration_seconds: 1800 },
                },
                row("b", "2026-10-03"),
                row("c", "2026-10-04"),
                row("d", "2026-10-05"),
              ],
              error: null,
            });
        return (...args) => {
          calls.push([method, ...args]);
          return builder;
        };
      },
    },
  );
  const query = presentationComponent("src/lib/planner-query.ts", {
    "@tanstack/react-query": { queryOptions: (options) => options, useQuery: () => ({}) },
    "@/integrations/supabase/client": {
      supabase: {
        rpc: (name, args) => (calls.push(["rpc", name, args]), builder),
        from: (table) => (calls.push(["from", table]), builder),
      },
    },
    "@/lib/network-errors": {
      developmentErrorDiagnostic() {},
      readRetryDelay() {},
      shouldRetryRead() {},
    },
    "./planner": planner,
  });
  const options = query.plannerUpcomingQueryOptions("profile", TODAY);
  const items = await options.queryFn();
  // One request: the bounded server read (completed rows excluded BEFORE its limit), embedded
  // with link status only. No table scan, range, month or history query.
  same(calls, [
    ["rpc", "planner_upcoming", { _profile: "profile", _from: TODAY, _limit: 3 }],
    ["select", query.PLANNER_COLUMNS],
  ]);
  same(
    items.map((planned) => planned.id),
    ["b", "c", "d"],
  );

  const disabled = query.plannerUpcomingQueryOptions(null, TODAY);
  assert.equal(disabled.enabled, false);
  calls.length = 0;
  same(await disabled.queryFn(), []);
  same(calls, []);

  const today = read("src/routes/_authenticated/bulk/index.tsx");
  assert.match(today, /<TodayUpcoming profileId=\{publicGoal \? id : null\} today=\{today\} \/>/);
  // Rendered outside the habits readiness gate: never a startup dependency.
  assert.ok(today.indexOf("<TodayUpcoming") > today.lastIndexOf("</>\n        )}"));
  assert.doesNotMatch(read("src/lib/planner-query.ts"), /prefetchQuery|ensureQueryData/);
  // The server read filters by the same read-derived completion rule and is hard-capped.
  const sql = read("supabase/migrations/20261101120000_activity_planner.sql");
  const fn = sql.slice(sql.indexOf("CREATE FUNCTION public.planner_upcoming"));
  assert.match(fn, /a\.challenge_activity_id IS NULL/);
  assert.match(fn, /s\.id = a\.workout_session_id AND s\.status = 'completed'/);
  assert.match(fn, /LIMIT least\(greatest\(coalesce\(_limit, 3\), 1\), 10\)/);
  assert.match(fn, /SECURITY INVOKER/);
});

function row(id, date) {
  return {
    id,
    activity_type: "run",
    planned_date: date,
    planned_time: null,
    workout_source_type: null,
    training_plan_day_id: null,
    workout_template_id: null,
    workout_name_snapshot: null,
    exercise_count_snapshot: null,
    planned_distance_km: null,
    planned_duration_seconds: null,
    note: null,
    workout_session_id: null,
    challenge_activity_id: null,
    updated_at: "2026-10-01T00:00:00+00:00",
    bulk_training_sessions: null,
    challenge_activities: null,
  };
}

// ---------------------------------------------------------------- Log or plan sheet
function logSheet({ showPlanner, showFitnessActions = true, active = true }) {
  const navigations = [];
  const ui = accountUI(
    "src/components/LogSheet.tsx",
    "LogSheetContent",
    {
      "@tanstack/react-router": {
        Link: "Link",
        useNavigate: () => async (to) => navigations.push(to),
      },
      "@/components/ui/drawer": {
        Drawer: "Drawer",
        DrawerClose: "DrawerClose",
        DrawerContent: "DrawerContent",
        DrawerTitle: "DrawerTitle",
      },
      "@/lib/challenge": {
        useMyChallenge: () => ({ data: active ? { status: "active" } : null, isLoading: false }),
      },
      "@/lib/main-navigation": presentationComponent("src/lib/main-navigation.ts"),
    },
    { onOpenChange() {}, showFitnessActions, showPlanner },
  );
  return { ui, navigations };
}

test("Log or plan adds Plan ahead → Schedule activity for full fitness only", async () => {
  const fitness = logSheet({ showPlanner: true });
  assert.match(fitness.ui.text(), /Log or plan/);
  assert.match(fitness.ui.text(), /Counts toward your challenge/);
  assert.match(fitness.ui.text(), /Your day/);
  assert.match(
    fitness.ui.text(),
    /Plan aheadSchedule activityA workout, run or ride on a future day/,
  );
  fitness.ui
    .find("button")
    .find((node) => textOf(node).includes("Schedule activity"))
    .props.onClick();
  await fitness.ui.flush();
  same(fitness.navigations, [{ to: "/planner/new" }]);

  const core = logSheet({ showPlanner: false, showFitnessActions: false }).ui;
  assert.doesNotMatch(core.text(), /Schedule activity|Plan ahead|Your day/);
  // Challenge Run/Ride gating is unchanged: no active Challenge, no active Run/Ride links.
  const inactive = logSheet({ showPlanner: true, active: false }).ui;
  assert.equal(
    inactive.find("Link").some((node) => node.props.to === "/challenge/add"),
    false,
  );
  assert.match(read("src/components/AppShell.tsx"), /showPlanner=\{owner\?\.is_public === true\}/);
});

// ---------------------------------------------------------------- navigation
test("Planner is not a tab; it belongs to Today with contextual Back and focus-screen forms", () => {
  same(
    MAIN_TABS.map((tab) => tab.label),
    ["Today", "Challenge", "Community", "Progress"],
  );
  assert.equal(mainTabForPath("/planner"), "today");
  assert.equal(mainTabForPath("/planner/new"), "today");
  assert.equal(isFocusScreen("/planner"), false);
  assert.equal(isFocusScreen("/planner/new"), true);
  assert.equal(isFocusScreen("/planner/11111111-1111-4111-8111-111111111111/edit"), true);
  assert.equal(inAppBackLabel("/planner"), "Planner");

  const page = read("src/routes/_authenticated/planner.tsx");
  assert.match(page, /<HistoryBackLink fallback="\/bulk" fallbackLabel="Today" \/>/);
  // Closing the sheet returns to the exact Agenda/Calendar entry; deep links fall back to /planner.
  assert.match(
    page,
    /if \(!backWithinApp\(router\.history, "\/planner"\)\) setSearch\(\{ item: undefined \}\)/,
  );
  assert.match(
    page,
    /const openItem = \(item: PlannedActivity\) => setSearch\(\{ item: item\.id \}, true\)/,
  );
  // Core accounts go through the existing fitness gate; legacy goes Today. No onboarding is forced.
  for (const file of [
    "src/routes/_authenticated/planner.tsx",
    "src/routes/_authenticated/planner_.new.tsx",
    "src/routes/_authenticated/planner_.$plannedId.edit.tsx",
  ]) {
    const source = read(file);
    assert.match(
      source,
      /if \(!preferred\) throw redirect\(\{ to: "\/bulk-access-denied", replace: true \}\)/,
    );
    assert.match(source, /!== "public"\)\s*throw redirect\(\{ to: "\/bulk", replace: true \}\)/);
    assert.doesNotMatch(source, /bulk-onboarding/);
  }
  const form = read("src/components/PlanActivityForm.tsx");
  // Cancel returns to the prior logical screen; creating replaces the form entry (no Back loop).
  assert.match(
    form,
    /if \(!backWithinApp\(router\.history\)\) void navigate\(\{ to: "\/planner", replace: true \}\)/,
  );
  assert.match(form, /else void navigate\(\{ to: "\/planner", replace: true \}\)/);
});

test("Planner search params are sanitized so deep links cannot inject state", () => {
  const route = presentationComponent(
    "src/routes/_authenticated/planner.tsx",
    new Proxy(
      {
        "@tanstack/react-router": { createFileRoute: () => (options) => ({ options }) },
        "@/lib/planner": planner,
      },
      { get: (target, name) => target[name] ?? new Proxy({}, { get: () => () => null }) },
    ),
  ).Route;
  const parse = route.options.validateSearch;
  same(
    parse({
      view: "calendar",
      month: "2026-10",
      date: "2026-10-02",
      item: "11111111-1111-4111-8111-111111111111",
    }),
    {
      view: "calendar",
      month: "2026-10",
      date: "2026-10-02",
      item: "11111111-1111-4111-8111-111111111111",
    },
  );
  same(parse({ view: "list", month: "2026-13", date: "2026-02-30", item: "<script>" }), {
    view: undefined,
    month: undefined,
    date: undefined,
    item: undefined,
  });
});

// ---------------------------------------------------------------- Challenge form integration
test("Challenge form accepts planner prefill safely and links only after a successful save", () => {
  const route = presentationComponent(
    "src/routes/_authenticated/challenge/add.tsx",
    new Proxy(
      { "@tanstack/react-router": { createFileRoute: () => (options) => ({ options }) } },
      { get: (target, name) => target[name] ?? new Proxy({}, { get: () => () => null }) },
    ),
  ).Route;
  const parse = route.options.validateSearch;
  const planned = "11111111-1111-4111-8111-111111111111";
  same(parse({ type: "cycle", planned, distance: "20", duration: 3600, note: "Easy" }), {
    type: "cycle",
    edit: undefined,
    planned,
    distance: "20",
    duration: 3600,
    note: "Easy",
  });
  // Without a planned id, or with unsafe values, nothing is prefilled.
  same(parse({ type: "run", distance: "5" }).distance, undefined);
  const unsafe = parse({ planned, distance: "-1", duration: 1.5, note: "x".repeat(201) });
  same([unsafe.distance, unsafe.duration, unsafe.note], [undefined, undefined, undefined]);
  assert.equal(parse({ planned: "not-a-uuid", distance: "5" }).planned, undefined);

  const source = read("src/routes/_authenticated/challenge/add.tsx");
  const insert = source.indexOf('from("challenge_activities").insert(');
  const failed = source.indexOf("if (error) throw error;", insert);
  const link = source.indexOf("await linkPlannedChallengeActivity(planned, activityId)");
  assert.ok(insert > 0 && failed > insert && link > failed, "link only after the insert succeeded");
  // Edits never link; evidence and validation rules are unchanged.
  assert.match(source, /const planned = editing \? undefined : search\.planned;/);
  assert.match(source, /Attach at least one screenshot that verifies the activity\./);
  assert.match(source, /\.\.\.\(activityId \? \{ id: activityId \} : \{\}\)/);
  // A planner draft never overwrites (or is overwritten by) the generic new-activity draft.
  assert.match(source, /\$\{planned \? `:planned:\$\{planned\}` : ""\}/);
});

test("planning never touches Challenge, streak, Endurance, PR or workout-history code", () => {
  for (const file of [
    "src/lib/streak.ts",
    "src/lib/endurance-progress.ts",
    "src/lib/challenge.ts",
    "src/lib/goal-metrics.ts",
    "src/lib/personal-records.ts",
    "src/lib/bulk-training-sessions.ts",
  ])
    assert.doesNotMatch(read(file), /planned_activities|planner/i, file);
  const sql = read("supabase/migrations/20261101120000_activity_planner.sql");
  assert.doesNotMatch(sql, /CREATE TRIGGER/i);
  assert.doesNotMatch(
    sql,
    /ALTER TABLE public\.(bulk_training_sessions|challenge_activities|streak)/i,
  );
});
