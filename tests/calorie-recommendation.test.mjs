import { test } from "node:test";
import assert from "node:assert/strict";
import { QueryClient, QueryObserver, queryOptions } from "@tanstack/react-query";
import { accountUI, deferred } from "./account-ui-fixture.mjs";
import { presentationComponent } from "./presentation-component-fixture.mjs";
import * as calc from "../src/lib/calc.ts";

const nutritionQueries = presentationComponent("src/lib/bulk-nutrition-query.ts", {
  "@tanstack/react-query": { queryOptions },
  "@/integrations/supabase/client": {},
  "./network-errors": {},
  "./calc": calc,
});
const savedDay = "2026-11-22";
const macros = { calories: 2400, protein: 140, carbs: 300, fat: 80 };
const recommendation = {
  decision: "increase_calories",
  currentTargetCalories: 2400,
  recommendedCalories: 2550,
  headline: "Increase calories slightly",
  reasonText: "A small adjustment is reasonable.",
  dataQuality: "strong",
};
function uiFixture({
  confirm = true,
  apply = async () => savedDay,
  refresh = async () => {},
} = {}) {
  const client = new QueryClient();
  const calls = [];
  const successes = [];
  const confirmations = [];
  const ui = accountUI(
    "src/components/PublicBulkProgress.tsx",
    "WeeklyCheckIn",
    {
      "@tanstack/react-query": { useQueryClient: () => client },
      "@/components/TempoDateTimePicker": {},
      "@/components/ui/native-select": {},
      "@/components/ui/button": { Button: "button" },
      "@/lib/challenge-evidence": {},
      "@/lib/private-image-upload": {},
      "@/lib/bulk-progress": {},
      "@/lib/bulk-weekly-recommendation": {},
      "@/components/GoalTrendCards": {},
      "@/lib/training-plans-query": {},
      "@/lib/goal-metrics": {},
      "@/lib/bulk-training-sessions": {},
      "@/lib/auth": { useAuth: () => ({ user: { id: "user" } }) },
      "@/lib/network-errors": { userFacingError: (error) => error.message },
      "@/lib/bulk-progress-query": {
        applyBulkCalorieRecommendation: async (...args) => {
          calls.push(args);
          return apply(...args);
        },
      },
      "@/lib/bulk-nutrition-query": nutritionQueries,
      "@/lib/bulk-today-query": {},
      "@/components/WeeklyProgressCoach": {},
      "@/lib/weekly-progress-coach": {},
      "@/lib/store": {
        refreshBulk: async () => {
          calls.push("refreshBulk");
          return refresh();
        },
      },
      sonner: { toast: { success: (message) => successes.push(message) } },
    },
    {
      profileId: "owner",
      goal: "gain",
      recommendation,
      summary: {
        weekStart: "2026-11-09",
        weekEnd: "2026-11-15",
        weightEntryCount: 4,
        previousWeightEntryCount: 4,
        nutritionLoggedDays: 5,
      },
    },
    {
      window: {
        confirm: () => {
          confirmations.push(true);
          return confirm;
        },
      },
    },
  );
  return {
    ui,
    client,
    calls,
    successes,
    confirmations,
    dispose() {
      ui.dispose();
      client.clear();
    },
  };
}

test("calorie RPC sends the real device timezone, returns the server day and propagates failure", async () => {
  const calls = [];
  let response = { data: savedDay, error: null };
  const api = presentationComponent("src/lib/bulk-progress-query.ts", {
    "@tanstack/react-query": {},
    "@/integrations/supabase/client": {
      supabase: {
        rpc: async (...args) => {
          calls.push(args);
          return response;
        },
      },
    },
    "./network-errors": {},
    "./private-image-upload": {},
    "./bulk-training-sessions": {},
  });
  assert.equal(await api.applyBulkCalorieRecommendation(2400, 2550), savedDay);
  assert.deepEqual(JSON.parse(JSON.stringify(calls)), [
    [
      "apply_bulk_calorie_recommendation",
      {
        _expected_current_calories: 2400,
        _new_calories: 2550,
        _timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      },
    ],
  ]);
  response = { data: null, error: new Error("stale target") };
  await assert.rejects(api.applyBulkCalorieRecommendation(2400, 2550), /stale target/);
  response = { data: null, error: null };
  await assert.rejects(api.applyBulkCalorieRecommendation(2400, 2550), /could not be applied/);
  response = { data: true, error: null };
  await assert.rejects(api.applyBulkCalorieRecommendation(2400, 2550), /could not be applied/);
});

test("recommendation still requires explicit confirmation", async () => {
  const f = uiFixture({ confirm: false });
  try {
    f.ui.button("Apply Recommendation").props.onClick();
    await f.ui.flush();
    assert.deepEqual(f.calls, []);
    assert.deepEqual(f.successes, []);
  } finally {
    f.dispose();
  }
});

test("successful acceptance refreshes live nutrition, Today, Goal and the owning account's streak without touching historical caches", async () => {
  const acknowledgement = deferred();
  const f = uiFixture({ apply: () => acknowledgement.promise });
  const todayKey = nutritionQueries.bulkNutritionDayQueryKey("owner", savedDay);
  const oldDayKey = nutritionQueries.bulkNutritionDayQueryKey("owner", "2026-11-21");
  const meal = { id: "meal", calories: 2000 };
  const cachedDay = { day: { id: "day", logDate: savedDay, targets: macros }, entries: [meal] };
  const updatedDay = {
    ...cachedDay,
    day: { ...cachedDay.day, targets: { ...macros, calories: 2550 } },
  };
  const changed = [
    ["bulk-today", "owner", savedDay],
    ["bulk-progress-summary", "nutrition", "owner", null, savedDay],
    ["bulk-weekly-recommendation", "owner"],
    ["goal-settings-dashboard", "owner"],
    ...["streak", "streak-frozen", "streak-run-legs"].map((root) => [root, "user", "week"]),
  ];
  const untouched = [
    oldDayKey,
    ["bulk-today", "other", savedDay],
    ["streak", "other", "week"],
    ["bulk-nutrition-day", "other", savedDay],
  ];
  for (const key of [todayKey, ...changed, ...untouched]) f.client.setQueryData(key, cachedDay);
  const observer = new QueryObserver(f.client, {
    queryKey: todayKey,
    queryFn: async () => updatedDay,
    staleTime: Infinity,
  });
  const unsubscribe = observer.subscribe(() => {});
  try {
    f.ui.button("Apply Recommendation").props.onClick();
    await f.ui.flush();
    assert.equal(f.ui.button("Applying recommendation…").props.disabled, true);
    assert.equal(f.successes.length, 0);
    assert.deepEqual(f.client.getQueryData(todayKey), cachedDay);
    acknowledgement.resolve(savedDay);
    await f.ui.flush();
    await f.ui.flush();
    assert.equal(f.successes.length, 1);
    assert.match(f.ui.text(), /Daily calorie target saved: 2550 kcal/);
    assert.deepEqual(f.calls, [[2400, 2550], "refreshBulk"]);
    assert.deepEqual(f.client.getQueryData(todayKey), updatedDay);
    assert.equal(f.client.getQueryData(todayKey).entries[0].calories, 2000);
    for (const key of changed)
      assert.equal(f.client.getQueryState(key).isInvalidated, true, JSON.stringify(key));
    for (const key of untouched) {
      assert.equal(f.client.getQueryState(key).isInvalidated, false, JSON.stringify(key));
      assert.deepEqual(f.client.getQueryData(key), cachedDay);
    }
  } finally {
    unsubscribe();
    f.dispose();
  }
});

test("failed transaction reports no success, changes no cached targets and remains retryable", async () => {
  let fails = true;
  const f = uiFixture({
    apply: async () => {
      if (fails) throw new Error("Calorie target changed on another device");
      return savedDay;
    },
  });
  const key = nutritionQueries.bulkNutritionDayQueryKey("owner", savedDay);
  const cached = { day: { targets: macros }, entries: [] };
  f.client.setQueryData(key, cached);
  try {
    f.ui.button("Apply Recommendation").props.onClick();
    await f.ui.flush();
    assert.match(f.ui.text(), /changed on another device/);
    assert.doesNotMatch(f.ui.text(), /Daily calorie target saved/);
    assert.equal(f.successes.length, 0);
    assert.deepEqual(f.calls, [[2400, 2550]], "No refresh follows a failed transaction");
    assert.deepEqual(f.client.getQueryData(key), cached);
    assert.equal(f.client.getQueryState(key).isInvalidated, false);
    fails = false;
    f.ui.button("Apply Recommendation").props.onClick();
    await f.ui.flush();
    await f.ui.flush();
    assert.equal(f.successes.length, 1);
  } finally {
    f.dispose();
  }
});

test("a confirmed save is acknowledged while refresh is still pending", async () => {
  const refreshed = deferred();
  const f = uiFixture({ refresh: () => refreshed.promise });
  try {
    f.ui.button("Apply Recommendation").props.onClick();
    await f.ui.flush();
    assert.equal(f.successes.length, 1);
    assert.match(f.ui.text(), /Daily calorie target saved: 2550 kcal/);
    assert.equal(f.ui.button("Applying recommendation…").props.disabled, true);
    refreshed.resolve();
    await f.ui.flush();
    assert.equal(f.ui.button("Recommendation applied").props.disabled, true);
    assert.equal(f.calls.filter(Array.isArray).length, 1);
  } finally {
    refreshed.resolve();
    f.dispose();
  }
});

for (const failure of ["store refresh", "query invalidation", "active query refetch"]) {
  test(`saved target survives ${failure} failure; retry only synchronizes without another mutation`, async () => {
    let fails = true;
    const retry = deferred();
    const f = uiFixture({
      refresh: async () => {
        if (failure !== "store refresh") return;
        if (fails) throw new Error("Refresh connection failed");
        await retry.promise;
      },
    });
    const key = nutritionQueries.bulkNutritionDayQueryKey("owner", savedDay);
    const cached = {
      day: { id: "day", logDate: savedDay, targets: macros },
      entries: [{ id: "meal", calories: 2000 }],
    };
    const updated = { ...cached, day: { ...cached.day, targets: { ...macros, calories: 2550 } } };
    f.client.setQueryData(key, cached);
    const invalidate = f.client.invalidateQueries.bind(f.client);
    if (failure === "query invalidation")
      f.client.invalidateQueries = async (filters, options) => {
        if (JSON.stringify(filters.queryKey) === JSON.stringify(key)) {
          if (fails) throw new Error("Invalidation failed");
          await retry.promise;
        }
        return invalidate(filters, options);
      };
    let unsubscribe = () => {};
    if (failure === "active query refetch") {
      const observer = new QueryObserver(f.client, {
        queryKey: key,
        staleTime: Infinity,
        retry: false,
        queryFn: async () => {
          if (fails) throw new Error("Refetch connection failed");
          await retry.promise;
          return updated;
        },
      });
      unsubscribe = observer.subscribe(() => {});
    }
    try {
      f.ui.button("Apply Recommendation").props.onClick();
      await f.ui.flush();
      await f.ui.flush();
      assert.equal(f.successes.length, 1);
      assert.match(f.ui.text(), /Daily calorie target saved: 2550 kcal/);
      assert.match(f.ui.text(), /Your target was saved, but the screen couldn’t refresh/);
      assert.equal(f.ui.find("p").filter((node) => node.props.role === "alert").length, 0);
      assert.deepEqual(
        f.client.getQueryData(key),
        cached,
        "Stale component values never overwrite server/cache snapshots",
      );
      assert.equal(f.ui.button("Recommendation applied").props.disabled, true);
      f.ui.button("Recommendation applied").props.onClick();
      await f.ui.flush();
      assert.equal(f.calls.filter(Array.isArray).length, 1);
      assert.equal(f.confirmations.length, 1);

      fails = false;
      f.ui.button("Retry refresh").props.onClick();
      await f.ui.flush();
      assert.equal(f.ui.button("Refreshing…").props.disabled, true);
      assert.equal(f.calls.filter(Array.isArray).length, 1);
      retry.resolve();
      await f.ui.flush();
      await f.ui.flush();
      assert.doesNotMatch(f.ui.text(), /couldn’t refresh|Retry refresh/);
      assert.match(f.ui.text(), /Daily calorie target saved: 2550 kcal/);
      assert.equal(f.successes.length, 1);
      assert.equal(f.confirmations.length, 1);
      assert.deepEqual(f.calls, [[2400, 2550], "refreshBulk", "refreshBulk"]);
      if (failure === "active query refetch") assert.deepEqual(f.client.getQueryData(key), updated);
    } finally {
      retry.resolve();
      unsubscribe();
      f.dispose();
    }
  });
}
