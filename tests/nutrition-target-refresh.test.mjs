import { test } from "node:test";
import assert from "node:assert/strict";
import { QueryClient, queryOptions } from "@tanstack/react-query";
import { accountUI, deferred, event } from "./account-ui-fixture.mjs";
import { presentationComponent } from "./presentation-component-fixture.mjs";
import * as nutrition from "../src/lib/bulk-nutrition.ts";
import * as metrics from "../src/lib/goal-metrics.ts";
import { iso } from "../src/lib/calc.ts";

const queries = presentationComponent("src/lib/bulk-nutrition-query.ts", {
  "@tanstack/react-query": { queryOptions },
  "@/integrations/supabase/client": {},
  "./network-errors": {},
  "./calc": { iso },
});
const today = "2026-10-07";
const previous = "2026-10-06";
const oldTargets = { calories: 2400, protein: 140, carbs: 300, fat: 80 };
const updated = { calories: 3000, protein: 160, carbs: 380, fat: 90 };
const day = (date) => ({
  day: { id: date, logDate: date, targets: oldTargets },
  entries: [{ id: "meal", calories: 2400, protein: 100, carbs: 260, fat: 60 }],
});

test("saving targets updates Today immediately without a reload, preserving intake and yesterday's snapshot", async () => {
  const client = new QueryClient();
  const todayKey = queries.bulkNutritionDayQueryKey("owner", today);
  const yesterdayKey = queries.bulkNutritionDayQueryKey("owner", previous);
  client.setQueryData(todayKey, day(today));
  client.setQueryData(yesterdayKey, day(previous));
  const data = { targets: { ...oldTargets, weeklyWorkoutGoal: 5 }, days: {}, workouts: {} };
  const acknowledgement = deferred();
  const saveCalls = [];
  const store = {
    useAppData: () => data,
    useBulkMeta: () => ({ bulkId: "owner", role: "owner" }),
    useActions: () => ({
      async saveTargets(targets) {
        saveCalls.push(targets);
        await acknowledgement.promise;
        data.targets = targets;
        return today;
      },
    }),
  };
  const ready = (value) => ({ data: value, isLoading: false, error: null });
  const view = accountUI("src/routes/_authenticated/bulk/index.tsx", "Route", {
    "@/lib/store": store,
    "@/lib/use-local-day": { useLocalDay: () => today },
    "@/lib/calc": { iso },
    "@/lib/bulk-access": {
      useMemberships: () => ready([{ is_public: true }]),
      preferredBulkMembership: () => ({ is_public: true }),
    },
    "@/lib/challenge-invitations": { useChallengeInvitations: () => ready([]) },
    "@/lib/bulk-progress-query": { useBulkWeights: () => ready([]) },
    "@/lib/bulk-nutrition-query": {
      useBulkNutritionDay: () => ready(client.getQueryData(todayKey)),
    },
    "@/lib/bulk-nutrition": nutrition,
    "@/lib/bulk-training-sessions": {
      useCompletedSessionDates: () => ready([]),
      useActiveBulkTrainingSession: () => ready(null),
    },
    "@/lib/training-plans-query": { useActiveTrainingPlan: () => ready(null) },
    "@/lib/goal-metrics": metrics,
    "@/components/PageSkeleton": { PageSkeleton: "PageSkeleton" },
    "@/components/TodayChallenge": { TodayChallenge: "TodayChallenge" },
    "@/components/NotificationBell": { NotificationBell: "NotificationBell" },
  });
  const editor = accountUI("src/components/NutritionTargetsEditor.tsx", "NutritionTargetsEditor", {
    "@/lib/store": store,
    "@tanstack/react-query": { useQueryClient: () => client },
    "@/lib/calc": { iso },
    "@/lib/bulk-nutrition-query": queries,
  });
  try {
    assert.match(view.text(), /2400 of 2400 kcal/);
    editor
      .find("input")
      .forEach((input, index) =>
        input.props.onChange(event(String(Object.values(updated)[index]))),
      );
    editor.button("Save targets").props.onClick();
    await editor.flush();
    assert.match(view.text(), /2400 of 2400 kcal/, "unconfirmed targets are not published");
    acknowledgement.resolve();
    await editor.flush();
    assert.match(editor.text(), /Targets saved/);
    assert.match(view.text(), /2400 of 3000 kcal/);
    assert.deepEqual(
      JSON.parse(JSON.stringify(client.getQueryData(todayKey).day.targets)),
      updated,
    );
    assert.deepEqual(client.getQueryData(todayKey).entries, day(today).entries);
    assert.deepEqual(client.getQueryData(yesterdayKey), day(previous));
    assert.equal(saveCalls.length, 1);
    assert.equal(saveCalls[0].weeklyWorkoutGoal, 5);
  } finally {
    editor.dispose();
    view.dispose();
    client.clear();
  }
});

test("target invalidation is profile/date scoped and never invents a nutrition day or changes historical targets", async () => {
  const client = new QueryClient();
  const changedKeys = [
    queries.bulkNutritionDayQueryKey("owner", today),
    ["bulk-progress-summary", "nutrition", "owner", previous, today],
    ["bulk-weekly-recommendation", "owner"],
    ["goal-settings-dashboard", "owner"],
  ];
  const untouchedKeys = [
    queries.bulkNutritionDayQueryKey("owner", previous),
    queries.bulkNutritionDayQueryKey("other", today),
    ["bulk-progress-summary", "nutrition", "other", previous, today],
    ["bulk-weekly-recommendation", "other"],
    ["goal-settings-dashboard", "other"],
  ];
  try {
    for (const key of [...changedKeys, ...untouchedKeys]) client.setQueryData(key, day(previous));
    client.setQueryData(changedKeys[0], { day: null, entries: [] });
    await queries.refreshBulkNutritionTargets(client, "owner", today, updated);
    assert.deepEqual(JSON.parse(JSON.stringify(client.getQueryData(changedKeys[0]))), {
      day: null,
      entries: [],
      effectiveTargets: updated,
    });
    for (const key of changedKeys) assert.equal(client.getQueryState(key).isInvalidated, true);
    for (const key of untouchedKeys) {
      assert.equal(client.getQueryState(key).isInvalidated, false);
      assert.deepEqual(client.getQueryData(key), day(previous));
    }
  } finally {
    client.clear();
  }
});
