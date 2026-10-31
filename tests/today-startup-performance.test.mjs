import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { QueryClient, queryOptions } from "@tanstack/react-query";
import { presentationComponent } from "./presentation-component-fixture.mjs";
import { accountUI } from "./account-ui-fixture.mjs";
import { DEFAULT_DATA } from "../src/lib/types.ts";
import { collectCompletedWorkouts, mondayOf } from "../src/lib/goal-metrics.ts";
import { createSaveQueue } from "../src/lib/workout-save.ts";

const read = (file) => readFileSync(new URL(`../${file}`, import.meta.url), "utf8");
const plain = (value) => JSON.parse(JSON.stringify(value));
const day = "2026-11-01";
const profile = "owner-profile";
const network = {
  shouldRetryRead: () => false,
  readRetryDelay: () => 0,
  developmentErrorDiagnostic() {},
};

// Execute authored query functions against a recording, filtering PostgREST transport.
function transport(tables, { fail, gate } = {}) {
  const calls = [];
  const supabase = {
    from(table) {
      const call = { table, filters: [] };
      let singleton = false;
      const query = {
        select(fields) {
          call.fields = fields;
          return query;
        },
        eq(key, value) {
          call.filters.push([key, "eq", value]);
          return query;
        },
        gte(key, value) {
          call.filters.push([key, "gte", value]);
          return query;
        },
        lte(key, value) {
          call.filters.push([key, "lte", value]);
          return query;
        },
        gt(key, value) {
          call.filters.push([key, "gt", value]);
          return query;
        },
        order(key) {
          call.order = key;
          return query;
        },
        limit(n) {
          call.limit = n;
          return query;
        },
        maybeSingle() {
          singleton = true;
          return query;
        },
        async upsert(row) {
          calls.push({ table, write: plain(row) });
          return { error: null };
        },
        then(resolve, reject) {
          calls.push(call);
          return Promise.resolve(gate?.())
            .then(() => {
              if (fail === table) return { data: null, error: new Error("Read failed") };
              let rows = (tables[table] ?? []).filter((row) =>
                call.filters.every(([key, op, value]) =>
                  op === "eq"
                    ? row[key] === value
                    : op === "gte"
                      ? row[key] >= value
                      : op === "lte"
                        ? row[key] <= value
                        : row[key] > value,
                ),
              );
              if (call.order)
                rows = [...rows].sort((a, b) =>
                  String(a[call.order]).localeCompare(String(b[call.order])),
                );
              if (call.limit) rows = rows.slice(0, call.limit);
              if (call.fields === "day,gym:payload->gym")
                rows = rows.map((row) => ({ day: row.day, gym: row.payload.gym }));
              if (call.fields?.startsWith("day,date:"))
                rows = rows.map((row) => ({
                  day: row.day,
                  date: row.payload.date,
                  type: row.payload.type,
                  status: row.payload.status,
                }));
              return { data: singleton ? (rows[0] ?? null) : rows, error: null };
            })
            .then(resolve, reject);
        },
      };
      return query;
    },
    storage: {
      from() {
        throw new Error("Today must never sign photos");
      },
    },
  };
  return { supabase, calls };
}
const queryModule = (file, supabase, extra = {}) =>
  presentationComponent(file, {
    "@tanstack/react-query": { queryOptions, useQuery() {} },
    "@/integrations/supabase/client": { supabase },
    "./network-errors": network,
    "@/lib/network-errors": network,
    "./goal-metrics": { mondayOf },
    "./types": { DEFAULT_DATA },
    "./private-image-upload": {},
    "./bulk-training-sessions": {},
    ...extra,
  });
function legacyRows() {
  const row = (d, payload, bulk_profile_id = profile) => ({ day: d, payload, bulk_profile_id });
  return {
    bulk_targets: [{ bulk_profile_id: profile, payload: { calories: 3100, weeklyWorkoutGoal: 4 } }],
    bulk_days: [
      row("2000-01-01", { gym: true }),
      row("2026-10-26", { gym: true }),
      row("2026-10-27", { gym: true }),
      row(day, { sleepHours: 8, restDay: true, notes: "Keep", weight: 72, calories: 900 }),
      row(day, { weight: 99 }, "other"),
    ],
    bulk_workouts: [
      row("2000-01-01", { status: "completed" }),
      row("2026-10-27", { status: "draft" }),
      row("2026-10-28", { status: "completed", type: "Legs", entries: ["large snapshot"] }),
      row(day, { status: "completed" }, "other"),
    ],
  };
}

test("Today reads only current targets/day and seven-day completion metadata; legacy gym/draft semantics survive", async () => {
  const { supabase, calls } = transport(legacyRows());
  const api = queryModule("src/lib/bulk-today-query.ts", supabase);
  const data = await api.bulkTodayQueryOptions(profile, day).queryFn();
  assert.equal(calls.length, 4);
  assert.equal(data.targets.calories, 3100);
  assert.equal(data.targets.weeklyWorkoutGoal, 4);
  assert.equal(data.days[day].sleepHours, 8);
  assert.equal(data.days[day].weight, 72);
  assert.equal(data.days[day].notes, "Keep");
  assert.equal(data.days["2000-01-01"], undefined);
  assert.equal(data.workouts["2000-01-01"], undefined);
  assert.equal(data.workouts["2026-10-28"].entries, undefined);
  assert.deepEqual(
    collectCompletedWorkouts({ legacyDays: data.days, legacyWorkouts: data.workouts }).map(
      (r) => r.workoutDate,
    ),
    ["2026-10-26", "2026-10-28"],
  );
  assert.ok(
    calls.every((c) =>
      c.filters.some(
        ([key, op, value]) => key === "bulk_profile_id" && op === "eq" && value === profile,
      ),
    ),
  );
  const weekly = calls.filter((c) => c.limit);
  assert.equal(weekly.length, 2);
  for (const call of weekly) {
    assert.equal(call.limit, 7);
    assert.equal(call.order, "day");
    assert.ok(
      call.filters.some(
        ([key, op, value]) => key === "day" && op === "gte" && value === "2026-10-26",
      ),
    );
    assert.ok(
      call.filters.some(([key, op, value]) => key === "day" && op === "lte" && value === day),
    );
  }
  assert.ok(calls.every((c) => !/photos|notes/.test(c.table)));
});

test("Today errors propagate, absent rows retain defaults, disabled owners make no reads and keys isolate day/profile", async () => {
  const { supabase } = transport(legacyRows(), { fail: "bulk_days" });
  await assert.rejects(
    queryModule("src/lib/bulk-today-query.ts", supabase)
      .bulkTodayQueryOptions(profile, day)
      .queryFn(),
    /Read failed/,
  );
  const empty = transport({});
  const api = queryModule("src/lib/bulk-today-query.ts", empty.supabase);
  assert.equal(await api.bulkTodayQueryOptions(null, day).queryFn(), null);
  assert.equal(empty.calls.length, 0);
  const data = await api.bulkTodayQueryOptions(profile, day).queryFn();
  assert.deepEqual(plain(data.targets), DEFAULT_DATA.targets);
  assert.deepEqual(plain(data.days), {});
  assert.notDeepEqual(api.bulkTodayQueryKey(profile, day), api.bulkTodayQueryKey("other", day));
  assert.notDeepEqual(
    api.bulkTodayQueryKey(profile, day),
    api.bulkTodayQueryKey(profile, "2026-11-02"),
  );
});

test("canonical single-day weight reads use one request and concurrent observers share the same cache", async () => {
  const t = transport({
    bulk_weight_entries: [
      { id: "weight", bulk_profile_id: profile, log_date: day, weight_kg: 72 },
      { id: "old", bulk_profile_id: profile, log_date: "2000-01-01", weight_kg: 60 },
    ],
  });
  const api = queryModule("src/lib/bulk-progress-query.ts", t.supabase);
  const client = new QueryClient();
  try {
    const options = api.bulkWeightQueryOptions(profile, day, day);
    const [a, b] = await Promise.all([
      client.fetchQuery(options),
      client.fetchQuery(api.bulkWeightQueryOptions(profile, day, day)),
    ]);
    assert.deepEqual(
      Array.from(a, (r) => r.id),
      ["weight"],
    );
    assert.deepEqual(a, b);
    assert.equal(t.calls.length, 1);
    assert.notDeepEqual(options.queryKey, api.bulkWeightQueryOptions(profile, null, day).queryKey);
  } finally {
    client.clear();
  }
});

function sessionData() {
  const set = (id, order, extra = {}) => ({
    id,
    session_exercise_id: "exercise",
    set_order: order,
    is_extra: false,
    is_complete: false,
    bilateral_weight: null,
    bilateral_reps: null,
    left_weight: 16,
    left_reps: 12,
    right_weight: 15,
    right_reps: 10,
    set_type: "normal",
    rpe: 8,
    ...extra,
  });
  return {
    id: "session",
    bulk_profile_id: profile,
    status: "in_progress",
    started_at: "2026-11-01T10:00:00Z",
    completed_at: null,
    updated_at: "version",
    workout_date: day,
    bodyweight_kg: 72,
    workout_day_name_snapshot: "Push",
    bulk_training_session_exercises: [
      {
        id: "exercise",
        session_id: "session",
        exercise_order: 2,
        exercise_name_snapshot: "Snapshot name",
        execution_mode: "unilateral",
        is_bodyweight: false,
        target_sets: 3,
        target_rep_min: 8,
        target_rep_max: 12,
        notes_snapshot: "Bench 3",
        bulk_training_session_sets: [
          set("set3", 3),
          set("set1", 1, { set_type: "warmup", is_complete: true }),
          set("set2", 2, { set_type: "dropset" }),
        ],
      },
      { id: "first", session_id: "session", exercise_order: 1, bulk_training_session_sets: [] },
    ],
  };
}
test("active session hydrates in one owner/status-scoped request, sorting snapshots without losing identities or unilateral metadata", async () => {
  const t = transport({
    bulk_training_sessions: [sessionData(), { ...sessionData(), bulk_profile_id: "other" }],
  });
  const api = queryModule("src/lib/bulk-training-sessions.ts", t.supabase);
  const result = await api.activeBulkTrainingSessionQueryOptions(profile).queryFn();
  assert.equal(t.calls.length, 1);
  assert.match(
    t.calls[0].fields,
    /bulk_training_session_exercises\(\*,bulk_training_session_sets\(\*\)\)/,
  );
  assert.ok(
    t.calls[0].filters.some(
      ([key, op, value]) => key === "status" && op === "eq" && value === "in_progress",
    ),
  );
  assert.deepEqual(
    result.exercises.map((r) => r.id),
    ["first", "exercise"],
  );
  const exercise = result.exercises[1];
  assert.equal(exercise.name, "Snapshot name");
  assert.equal(exercise.notes, "Bench 3");
  assert.deepEqual(
    exercise.sets.map((r) => r.id),
    ["set1", "set2", "set3"],
  );
  assert.equal(exercise.sets[0].setType, "warmup");
  assert.equal(exercise.sets[1].setType, "dropset");
  assert.equal(exercise.sets[0].isComplete, true);
  assert.equal(exercise.sets[0].rpe, 8);
  assert.equal(exercise.sets[0].leftWeight, 16);
  assert.equal(exercise.sets[0].rightWeight, 15);
  assert.equal(exercise.sets[0].rightReps, 10);
  assert.equal(result.bodyweightKg, 72);
});

test("active plan hydrates in one request, preserving day/exercise order, snapshots, source identities and mode", async () => {
  const exercise = (id, order) => ({
    id,
    exercise_id: "library-id",
    source_system_exercise_id: "system-id",
    exercise_name: "Saved name",
    exercise_order: order,
    sets: 3,
    rep_min: 8,
    rep_max: 12,
    intended_unilateral_mode: "unilateral",
    notes: "Keep",
    bulk_exercises: { supports_unilateral: true, is_bodyweight: false },
  });
  const row = {
    id: "plan",
    bulk_profile_id: profile,
    active: true,
    name: "Original Tempo program",
    plan_type: "custom",
    training_days_per_week: 3,
    bulk_training_plan_days: [
      { id: "day2", day_order: 2, name: "Legs", bulk_training_plan_exercises: [] },
      {
        id: "day1",
        day_order: 1,
        name: "Chest & Back",
        bulk_training_plan_exercises: [exercise("e2", 2), exercise("e1", 1)],
      },
    ],
  };
  const t = transport({ bulk_training_plans: [row] });
  const api = queryModule("src/lib/training-plans-query.ts", t.supabase);
  const result = await api.activeTrainingPlanQueryOptions(profile).queryFn();
  assert.equal(t.calls.length, 1);
  assert.match(t.calls[0].fields, /bulk_training_plan_days\(.*bulk_training_plan_exercises\(/);
  assert.match(t.calls[0].fields, /bulk_exercises!bulk_training_plan_exercises_exercise_id_fkey/);
  assert.ok(
    t.calls[0].filters.some(
      ([key, op, value]) => key === "active" && op === "eq" && value === true,
    ),
  );
  assert.deepEqual(
    Array.from(result.days, (r) => r.id),
    ["day1", "day2"],
  );
  assert.deepEqual(
    Array.from(result.days[0].exercises, (r) => r.id),
    ["e1", "e2"],
  );
  assert.equal(result.days[0].exercises[0].name, "Saved name");
  assert.equal(result.days[0].exercises[0].intendedUnilateralMode, "unilateral");
  assert.equal(result.days[0].exercises[0].sourceSystemExerciseId, "system-id");
  assert.equal(result.days[0].exercises[0].notes, "Keep");
});

test("nested active queries return null when absent and propagate database failures", async () => {
  for (const [file, table, option] of [
    ["bulk-training-sessions", "bulk_training_sessions", "activeBulkTrainingSessionQueryOptions"],
    ["training-plans-query", "bulk_training_plans", "activeTrainingPlanQueryOptions"],
  ]) {
    const empty = queryModule(`src/lib/${file}.ts`, transport({}).supabase);
    assert.equal(await empty[option](profile).queryFn(), null);
    assert.equal(await empty[option](null).queryFn(), null);
    const failing = queryModule(`src/lib/${file}.ts`, transport({}, { fail: table }).supabase);
    await assert.rejects(failing[option](profile).queryFn(), /Read failed/);
  }
});

function routeFixture() {
  const calls = [];
  let path = "/bulk",
    data = null,
    id = profile;
  const store = {
    useAppData: () => data,
    useBulkMeta: () => ({ bulkId: id }),
    selectBulk: (...args) => calls.push(["select", ...args]),
    prefetchBulk: async (...args) => calls.push(["prefetch", ...args]),
    loadBulk: async (...args) => {
      calls.push(["load", ...args]);
      data = { history: true };
    },
    clearBulk: () => {
      id = null;
      data = null;
    },
  };
  const owner = { bulk_profile_id: profile, role: "owner" };
  const access = {
    useMemberships: () => ({ data: [owner], isLoading: false }),
    preferredBulkMembership: () => owner,
    bulkOwnerQueryOptions: () =>
      queryOptions({ queryKey: ["owner"], queryFn: async () => [owner] }),
  };
  const ui = accountUI("src/routes/_authenticated/bulk/route.tsx", "Route", {
    "@/lib/store": store,
    "@/lib/bulk-access": access,
    "@tanstack/react-router": {
      createFileRoute: () => (options) => ({ options }),
      useLocation: () => ({ pathname: path }),
      useNavigate: () => async () => {},
      Outlet: "Outlet",
    },
    "@/components/PageSkeleton": { PageSkeleton: "PageSkeleton" },
    "@/lib/network-errors": network,
    "@/lib/query-cancellation": {},
    "@/components/QueryCancellationRecovery": {},
  });
  const route = presentationComponent("src/routes/_authenticated/bulk/route.tsx", {
    react: {},
    "@tanstack/react-router": { createFileRoute: () => (options) => options },
    "@/lib/store": store,
    "@/lib/bulk-access": access,
    "@/components/PageSkeleton": {},
    "@/components/AppShell": {},
    "@/components/ui-kit": {},
    "@/lib/network-errors": network,
    "@/lib/query-cancellation": {},
    "@/components/QueryCancellationRecovery": {},
  }).Route;
  return {
    ui,
    route,
    calls,
    enter: (next) => {
      path = next;
      data = null;
    },
  };
}

test("Today route/layout never prefetch history or wait for it; deep historical screens still hydrate on entry", async () => {
  const f = routeFixture();
  const client = new QueryClient();
  try {
    await f.route.beforeLoad({ context: { queryClient: client }, location: { pathname: "/bulk" } });
    await f.route.beforeLoad({
      context: { queryClient: client },
      location: { pathname: "/bulk/" },
    });
    assert.equal(f.calls.length, 0);
    assert.equal(f.ui.find("Outlet").length, 1, "Today renders while the legacy snapshot is null");
    assert.deepEqual(
      f.calls.map((r) => r[0]),
      ["select"],
    );
    for (const path of [
      "/bulk/progress",
      "/bulk/progress/photos",
      "/bulk/history",
      "/bulk/meals/history",
      "/bulk/training/history",
      "/bulk/check-in",
      "/bulk/morning",
    ]) {
      f.enter(path);
      await f.route.beforeLoad({ context: { queryClient: client }, location: { pathname: path } });
      f.ui.render();
      assert.equal(f.ui.find("Outlet").length, 1, path);
      assert.ok(f.calls.some((r) => r[0] === "load"));
    }
    assert.equal(f.calls.filter((r) => r[0] === "prefetch").length, 7);
    assert.equal(f.calls.filter((r) => r[0] === "load").length, 7);
  } finally {
    client.clear();
  }
});

function storeFixture(t) {
  return presentationComponent("src/lib/store.ts", {
    react: { useCallback: (fn) => fn, useSyncExternalStore: (_subscribe, get) => get() },
    "@/integrations/supabase/client": { supabase: t.supabase },
    "@/lib/private-image-upload": {},
    "./workout-save": { createSaveQueue },
    "./types": { DEFAULT_DATA },
  });
}
test("cold Today Rest day saves merge all current fields without history hydration, survive later rehydration and preserve profile isolation", async () => {
  const tables = legacyRows();
  const t = transport(tables);
  const api = storeFixture(t);
  api.selectBulk(profile, "owner");
  api.selectBulk(profile, "owner");
  assert.equal(t.calls.length, 0);
  assert.equal(api.useAppData(), null);
  await api.useActions().saveDay(day, { restDay: false }, true);
  assert.equal(t.calls.length, 2);
  const write = t.calls[1].write;
  assert.equal(write.bulk_profile_id, profile);
  assert.equal(write.payload.sleepHours, 8);
  assert.equal(write.payload.notes, "Keep");
  assert.equal(write.payload.calories, 900);
  assert.equal(write.payload.restDay, false);
  tables.bulk_days.find((r) => r.day === day && r.bulk_profile_id === profile).payload =
    write.payload;
  await api.loadBulk(profile, "owner");
  assert.equal(api.useAppData().days[day].restDay, false);
  assert.ok(api.useAppData().days["2000-01-01"], "historical paths are retained for deep screens");
  api.clearBulk();
  await assert.rejects(api.useActions().saveDay(day, { restDay: true }, true), /cannot be edited/);
});

test("a failed or account-switched cold day read cannot overwrite the day", async () => {
  const failing = transport(legacyRows(), { fail: "bulk_days" });
  const api = storeFixture(failing);
  api.selectBulk(profile, "owner");
  await assert.rejects(api.useActions().saveDay(day, { restDay: false }, true), /Read failed/);
  assert.equal(failing.calls.filter((c) => c.write).length, 0);
  let release;
  const pending = new Promise((resolve) => {
    release = resolve;
  });
  const t = transport(legacyRows(), { gate: () => pending });
  const switched = storeFixture(t);
  switched.selectBulk(profile, "owner");
  const save = switched.useActions().saveDay(day, { restDay: false }, true);
  await new Promise((r) => setImmediate(r));
  switched.selectBulk("other", "owner");
  release();
  await assert.rejects(save, /Account or plan changed/);
  assert.equal(t.calls.filter((c) => c.write).length, 0);
});

test("Today tab intent never prefetches the legacy snapshot; historical destination intent still does", () => {
  const calls = [];
  const jsx = (type, props) => ({ type, props });
  const api = presentationComponent("src/components/AppShell.tsx", {
    react: {
      createContext: () => ({ Provider: "Provider" }),
      useContext: () => false,
      useState: (value) => [value, () => {}],
    },
    "react/jsx-runtime": { jsx, jsxs: jsx, Fragment: "Fragment" },
    "lucide-react": {},
    "@tanstack/react-router": {
      useLocation: () => ({ pathname: "/profile" }),
      useRouterState: () => false,
    },
    "@/lib/bulk-access": {
      useMemberships: () => ({ data: [profile] }),
      preferredBulkMembership: () => ({ bulk_profile_id: profile }),
    },
    "@/lib/store": { prefetchBulk: (id) => calls.push(id) },
    "@/lib/goal-discovery": { useGoalDiscovery: () => ({}) },
    "@/lib/main-navigation": {
      isFocusScreen: () => false,
      mainTabForPath: () => "you",
      MAIN_TABS: [
        { tab: "today", to: "/bulk" },
        { tab: "challenge", to: "/challenge" },
        { tab: "progress", to: "/bulk/progress" },
        { tab: "you", to: "/profile" },
      ],
    },
    "./PullToRefresh": {},
    "./LogSheet": {},
    "./HistoryBackLink": {},
    "./NotificationBell": {},
  });
  const shell = api.AppShell({ children: "content" });
  const chrome = shell.props.children;
  const tree = chrome.type(chrome.props);
  const nodes = (value) =>
    Array.isArray(value)
      ? value.flatMap(nodes)
      : value && typeof value === "object"
        ? [value, ...nodes(value.props?.children)]
        : [];
  const tabs = nodes(tree).filter((node) => node.props?.item);
  tabs.find((node) => node.props.item.tab === "today").props.onIntent();
  assert.equal(calls.length, 0);
  tabs.find((node) => node.props.item.tab === "progress").props.onIntent();
  assert.deepEqual(calls, [profile]);
  const refresh = read("src/components/PullToRefresh.tsx");
  assert.match(refresh, /refetchQueries\(\{ type: "active" \}\)/);
  assert.match(refresh, /const isBulkRoute = pathname.startsWith\("\/bulk\/"\)/);
});

test("Today streak nutrition bounds day headers to one seven-row request but still exhausts meal entries", async () => {
  const t = transport({
    bulk_nutrition_days: [
      { id: "nutrition", bulk_profile_id: profile, log_date: day, target_calories: 3000 },
      { id: "old", bulk_profile_id: profile, log_date: "2000-01-01", target_calories: 2400 },
    ],
    bulk_nutrition_entries: Array.from({ length: 205 }, (_, i) => ({
      id: `entry-${String(i).padStart(4, "0")}`,
      nutrition_day_id: "nutrition",
      calories: 10,
      protein_g: 1,
    })),
  });
  // Add the standard IN filter used by the unchanged exhaustive entry reader.
  const from = t.supabase.from;
  t.supabase.from = (table) => {
    const query = from(table);
    query.in = (key, values) => {
      assert.equal(key, "nutrition_day_id");
      assert.deepEqual(Array.from(values), ["nutrition"]);
      return query;
    };
    return query;
  };
  const api = queryModule("src/lib/bulk-progress-query.ts", t.supabase);
  const data = await api.bulkProgressNutritionQueryOptions(profile, "2026-10-26", day).queryFn();
  assert.equal(data.length, 1);
  assert.equal(data[0].calories, 2050);
  assert.equal(data[0].protein, 205);
  assert.equal(data[0].targetCalories, 3000);
  const headers = t.calls.filter((r) => r.table === "bulk_nutrition_days");
  assert.equal(headers.length, 1);
  assert.equal(headers[0].limit, 7);
  assert.equal(t.calls.filter((r) => r.table === "bulk_nutrition_entries").length, 3);
});
