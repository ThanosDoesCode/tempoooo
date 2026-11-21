import { test } from "node:test";
import assert from "node:assert/strict";
import { accountUI, event } from "./account-ui-fixture.mjs";
import { presentationComponent } from "./presentation-component-fixture.mjs";
import * as types from "../src/lib/types.ts";
import * as metrics from "../src/lib/goal-metrics.ts";
import * as calc from "../src/lib/calc.ts";
import * as nutrition from "../src/lib/bulk-nutrition.ts";
import * as streakModel from "../src/lib/streak-model.ts";
import * as bulkProgress from "../src/lib/bulk-progress.ts";
import * as recommendations from "../src/lib/bulk-weekly-recommendation.ts";
import { createSaveQueue } from "../src/lib/workout-save.ts";
import { queryOptions } from "@tanstack/react-query";

const plain = (value) => JSON.parse(JSON.stringify(value));
const q = (data) => ({ data, isLoading: false, error: null });
const plan = {
  id: "plan",
  name: "Three-day plan",
  trainingDaysPerWeek: 3,
  days: [{ id: "day", name: "Chest & Back", exercises: [] }],
};

async function storeFixture(savedTargets) {
  let payload = plain(savedTargets);
  const writes = [];
  const supabase = {
    from(table) {
      let single = false;
      return {
        select() {
          return this;
        },
        eq() {
          return this;
        },
        order() {
          return this;
        },
        limit() {
          return this;
        },
        gt() {
          return this;
        },
        gte() {
          return this;
        },
        lte() {
          return this;
        },
        maybeSingle() {
          single = true;
          return this;
        },
        then(resolve, reject) {
          return Promise.resolve({
            data: table === "bulk_targets" ? { payload } : single ? null : [],
            error: null,
          }).then(resolve, reject);
        },
      };
    },
    async rpc(name, args) {
      assert.equal(name, "save_bulk_targets_for_local_day");
      assert.equal(args._profile, "profile");
      writes.push(plain(args._targets));
      payload = plain(args._targets);
      return { data: calc.iso(new Date()), error: null };
    },
  };
  const api = presentationComponent("src/lib/store.ts", {
    react: { useCallback: (fn) => fn, useSyncExternalStore: (_subscribe, get) => get() },
    "@/integrations/supabase/client": { supabase },
    "@/lib/private-image-upload": {},
    "./workout-save": { createSaveQueue },
    "./types": types,
  });
  await api.loadBulk("profile", "owner");
  return { api, writes, supabase, payload: () => payload };
}

function modules(api, currentPlan = plan, mode = "public") {
  return {
    "@/lib/store": api,
    "@/lib/types": types,
    "@/lib/goal-metrics": metrics,
    "@/lib/calc": calc,
    "@/lib/auth": { useAuth: () => ({ user: { id: "owner" } }) },
    "@/lib/bulk-access": {
      useMemberships: () => q([]),
      preferredBulkMembership: () => ({ bulk_profile_id: "profile", is_public: mode === "public" }),
      bulkPlanModeFor: () => mode,
    },
    "@/lib/bulk-today-query": { useBulkToday: () => q(api.useAppData()) },
    "@/lib/use-local-day": { useLocalDay: () => calc.iso(new Date()) },
    "@/lib/streak": { useStreak: () => q(null) },
    "@/lib/bulk-progress-query": { useBulkWeights: () => q([]) },
    "@/lib/bulk-progression-query": { useBulkProgressionTargets: () => q({}) },
    "@/lib/bulk-training-sessions": {
      useCompletedSessionDates: () => q([]),
      useActiveBulkTrainingSession: () => q(null),
    },
    "@/lib/training-plans-query": { useActiveTrainingPlan: () => q(currentPlan) },
    "@/lib/bulk-nutrition": nutrition,
    "@/lib/bulk-nutrition-query": {
      useBulkNutritionDay: () => q({ day: null, entries: [] }),
      refreshBulkNutritionTargets: async () => {},
    },
    "@/lib/challenge-invitations": { useChallengeInvitations: () => q([]) },
    "@/components/TodayChallenge": { TodayChallenge: "TodayChallenge" },
    "@/components/PageSkeleton": { PageSkeleton: "PageSkeleton" },
    "@/components/NavRows": { NavRows: "NavRows" },
    "@/components/TrainingSession": { TrainingSession: "TrainingSession" },
    "@/components/TrainingPlanSetup": { TrainingPlanOverview: "TrainingPlanOverview" },
    "@/components/TempoDateTimePicker": { TempoDatePicker: "TempoDatePicker" },
    "@/components/ui/button": { Button: "Button" },
    "@/components/PublicBulkProgress": { PublicWeeklyReview: "PublicWeeklyReview" },
    "@/components/NavigationOverlay": { useOverlayBack() {} },
    "@/components/ui-kit": Object.fromEntries(
      ["Card", "Chip", "Note", "SectionTitle", "PendingLabel", "DataError"].map((name) => [
        name,
        name,
      ]),
    ),
    "@tanstack/react-query": { useQueryClient: () => ({ invalidateQueries: async () => {} }) },
    "@/lib/network-errors": {},
  };
}

test("lightweight Today hydration preserves a missing explicit goal and its saved frequency", async () => {
  const f = await storeFixture({ trainingDaysPerWeek: 2 });
  const api = presentationComponent("src/lib/bulk-today-query.ts", {
    "@tanstack/react-query": { queryOptions },
    "@/integrations/supabase/client": { supabase: f.supabase },
    "./goal-metrics": metrics,
    "./network-errors": {},
    "./types": types,
  });
  const result = await api.bulkTodayQueryOptions("profile", "2026-11-21").queryFn();
  assert.equal(Object.hasOwn(result.targets, "weeklyWorkoutGoal"), false);
  assert.equal(
    metrics.resolveWeeklyWorkoutTarget({ targetDaysPerWeek: result.targets.trainingDaysPerWeek }),
    2,
  );
  assert.equal(f.writes.length, 0);
});

for (const [saved, expected, currentPlan] of [
  [{ trainingDaysPerWeek: 2 }, 2, plan],
  [{ trainingDaysPerWeek: 3, weeklyWorkoutGoal: 4 }, 4, plan],
  [{ weeklyWorkoutGoal: 5 }, 5, plan],
  [{}, 3, plan], // Existing backend-compatible plan fallback, never persisted as an explicit goal.
  [{}, null, null],
]) {
  test(`Today, Training, review and goal editor agree for saved ${JSON.stringify(saved)}`, async () => {
    const f = await storeFixture(saved);
    const deps = modules(f.api, currentPlan);
    const today = accountUI("src/routes/_authenticated/bulk/index.tsx", "Route", deps);
    const training = accountUI("src/routes/_authenticated/bulk/training.tsx", "Route", deps);
    const review = accountUI(
      "src/routes/_authenticated/bulk/check-in.tsx",
      "Route",
      modules(f.api, currentPlan, "legacy"),
    );
    const editor = accountUI(
      "src/components/WeeklyWorkoutGoalEditor.tsx",
      "WeeklyWorkoutGoalEditor",
      deps,
    );
    try {
      assert.equal(editor.find("input")[0].props.value, expected == null ? "" : String(expected));
      assert.equal(editor.button("Save goal").props.disabled, true);
      if (currentPlan) {
        assert.match(today.text(), new RegExp(`0 of ${expected} this week`));
        assert.equal(training.find("TrainingPlanOverview")[0].props.weekProgress, `0/${expected}`);
      } else {
        assert.match(today.text(), /Choose a training plan/);
        assert.doesNotMatch(today.text(), /of 5 this week/);
        assert.equal(editor.find("input")[0].props.placeholder, "Not configured");
      }
      assert.match(
        review.text(),
        expected == null ? /0Workouts/ : new RegExp(`0/${expected}Workouts`),
      );
      assert.equal(f.writes.length, 0, "reading or resolving a fallback must never save it");
      assert.equal(
        Object.hasOwn(f.api.useAppData().targets, "weeklyWorkoutGoal"),
        Object.hasOwn(saved, "weeklyWorkoutGoal"),
      );
    } finally {
      for (const ui of [today, training, review, editor]) ui.dispose();
    }
  });
}

for (const weeklyWorkoutGoal of [undefined, 4, 5]) {
  test(`nutrition, setup-note and equipment edits preserve ${weeklyWorkoutGoal ?? "absent"} explicit goal through the real store RPC`, async () => {
    const saved = {
      trainingDaysPerWeek: 2,
      ...(weeklyWorkoutGoal == null ? {} : { weeklyWorkoutGoal }),
    };
    const f = await storeFixture(saved);
    const deps = modules(f.api, plan, "legacy");
    const editor = accountUI(
      "src/components/NutritionTargetsEditor.tsx",
      "NutritionTargetsEditor",
      deps,
    );
    const training = accountUI("src/routes/_authenticated/bulk/training.tsx", "Route", deps);
    try {
      editor.find("input")[0].props.onChange(event("3000"));
      editor.button("Save targets").props.onClick();
      await editor.flush();
      assert.equal(f.writes[0].calories, 3000);
      await training.find("TrainingSession")[0].props.onSaveSetupNote("Cable fly", "Pulley 4");
      assert.equal(f.writes[1].exerciseSetupNotes["Cable fly"], "Pulley 4");
      await f.api
        .useActions()
        .saveTargets({ ...f.api.useAppData().targets, availableEquipment: ["dumbbells"] });
      for (const payload of f.writes) {
        assert.equal(Object.hasOwn(payload, "weeklyWorkoutGoal"), weeklyWorkoutGoal != null);
        assert.equal(payload.weeklyWorkoutGoal, weeklyWorkoutGoal);
        assert.equal(payload.trainingDaysPerWeek, 2);
      }
      await f.api.refreshBulk();
      assert.equal(f.api.useAppData().targets.weeklyWorkoutGoal, weeklyWorkoutGoal);
      assert.equal(
        metrics.resolveWeeklyWorkoutTarget({
          weeklyWorkoutGoal: f.payload().weeklyWorkoutGoal,
          targetDaysPerWeek: f.payload().trainingDaysPerWeek,
        }),
        weeklyWorkoutGoal ?? 2,
      );
    } finally {
      editor.dispose();
      training.dispose();
    }
  });
}

test("an unconfigured user can explicitly save a goal without changing training frequency", async () => {
  const f = await storeFixture({});
  const ui = accountUI(
    "src/components/WeeklyWorkoutGoalEditor.tsx",
    "WeeklyWorkoutGoalEditor",
    modules(f.api, null),
  );
  try {
    ui.find("input")[0].props.onChange(event("4"));
    assert.equal(ui.button("Save goal").props.disabled, false);
    ui.button("Save goal").props.onClick();
    await ui.flush();
    assert.equal(f.payload().weeklyWorkoutGoal, 4);
    assert.equal(Object.hasOwn(f.payload(), "trainingDaysPerWeek"), false);
    assert.match(ui.text(), /Streak targets stay fixed for each week/);
  } finally {
    ui.dispose();
  }
});

test("late plan fallback initializes an untouched goal but cannot overwrite an edited goal", async () => {
  for (const editing of [false, true]) {
    const f = await storeFixture({});
    const planQuery = q(null);
    const ui = accountUI("src/components/WeeklyWorkoutGoalEditor.tsx", "WeeklyWorkoutGoalEditor", {
      ...modules(f.api, null),
      "@/lib/training-plans-query": { useActiveTrainingPlan: () => planQuery },
    });
    try {
      assert.equal(ui.find("input")[0].props.value, "");
      if (editing) ui.find("input")[0].props.onChange(event("4"));
      planQuery.data = plan;
      assert.equal(ui.find("input")[0].props.value, editing ? "4" : "3");
      assert.equal(f.writes.length, 0);
    } finally {
      ui.dispose();
    }
  }
});

test("public weekly review uses the same frequency fallback without materializing an explicit goal", async () => {
  const f = await storeFixture({ trainingDaysPerWeek: 2 });
  const deps = modules(f.api);
  const ui = accountUI(
    "src/components/PublicBulkProgress.tsx",
    "PublicWeeklyReview",
    {
      ...deps,
      "@/components/ui/native-select": { NativeSelect: "NativeSelect" },
      "@/lib/challenge-evidence": {},
      "@/lib/private-image-upload": {},
      "@/lib/bulk-progress": bulkProgress,
      "@/lib/bulk-weekly-recommendation": recommendations,
      "@/components/GoalTrendCards": {},
      "@/lib/bulk-progress-query": {
        useBulkWeights: () => q([]),
        useBulkProgressNutrition: () => q([]),
      },
    },
    { bulkProfileId: "profile", targets: f.api.useAppData().targets },
  );
  try {
    const summary = ui.render().props.summary;
    assert.equal(summary.plannedWorkouts, 2);
    assert.equal(summary.completedWorkouts, 0);
    assert.equal(f.writes.length, 0);
    assert.equal(Object.hasOwn(f.payload(), "weeklyWorkoutGoal"), false);
  } finally {
    ui.dispose();
  }
});

test("a new configured goal is distinguished from this week's frozen streak target", async () => {
  const f = await storeFixture({ weeklyWorkoutGoal: 4, trainingDaysPerWeek: 2 });
  const editor = accountUI(
    "src/components/WeeklyWorkoutGoalEditor.tsx",
    "WeeklyWorkoutGoalEditor",
    modules(f.api),
  );
  const data = streakModel.parseStreakResponse({
    current: 3,
    best: 3,
    this_week: {
      week_start: "2026-11-16",
      week_end: "2026-11-22",
      result: "open",
      train_active: true,
      train_state: "open",
      run_active: false,
      eat_active: false,
    },
    recent_weeks: [],
  });
  const progress = { train: { kind: "count", current: 1, target: 2 } };
  const streak = accountUI("src/routes/_authenticated/streak.tsx", "Route", {
    "@/lib/bulk-access": { useMemberships: () => q([]), accountProductMode: () => "fitness" },
    "@/lib/streak": { useStreak: () => q(data), useThisWeekRingProgress: () => progress },
    "@/lib/streak-model": streakModel,
    "@/components/PageSkeleton": { PageSkeleton: "PageSkeleton" },
    "@/components/ui-kit": { DataError: "DataError" },
    "@/components/StreakRings": presentationComponent("src/components/StreakRings.tsx"),
  });
  try {
    assert.equal(editor.find("input")[0].props.value, "4");
    assert.match(editor.text(), /configured goal updates now/);
    assert.match(streak.text(), /1 \/ 2/);
    assert.match(streak.text(), /goal frozen at the start of this week/);
    assert.equal(f.writes.length, 0);
    assert.equal(progress.train.target, 2);
  } finally {
    editor.dispose();
    streak.dispose();
  }
});
