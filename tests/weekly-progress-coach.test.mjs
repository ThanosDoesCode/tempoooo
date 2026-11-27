import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { QueryClient } from "@tanstack/react-query";
import { accountUI, textOf } from "./account-ui-fixture.mjs";
import { presentationComponent } from "./presentation-component-fixture.mjs";
import * as progress from "../src/lib/bulk-progress.ts";
import * as metrics from "../src/lib/goal-metrics.ts";
import * as engine from "../src/lib/bulk-weekly-recommendation.ts";
import * as coach from "../src/lib/weekly-progress-coach.ts";
import * as calc from "../src/lib/calc.ts";
import { DEFAULT_DATA } from "../src/lib/types.ts";

const targets = {
  goal: "gain",
  targetWeeklyGainKg: 0.25,
  calories: 3000,
  startWeight: 65,
  targetWeight: 75,
  weeklyWorkoutGoal: 4,
};
const summary = (changes = {}) => ({
  weekStart: "2026-11-16",
  weekEnd: "2026-11-22",
  weightAverageKg: 70.25,
  previousWeightAverageKg: 70,
  weightChangeKg: 0.25,
  weightEntryCount: 3,
  previousWeightEntryCount: 3,
  targetWeeklyGainKg: 0.25,
  averageCalories: 2400,
  averageProtein: 140,
  nutritionLoggedDays: 4,
  nutritionTargetedDays: 4,
  calorieAdherentDays: 4,
  targetCalories: 2400,
  completedWorkouts: 4,
  plannedWorkouts: 4,
  ...changes,
});
const recommendation = (s, goal = "gain") =>
  engine.recommendBulkCalories({
    goal,
    summary: s,
    currentTargetCalories: 3000,
    previousTrendChangeKg: s.weightChangeKg,
    previousTrendComparable: true,
    targetWeightReached: false,
  });
const model = (changes = {}, configured = targets) => {
  const s = summary(changes);
  return coach.weeklyProgressCoach(s, configured, recommendation(s, configured.goal), "eligible");
};

for (const [goal, rate, delta, text] of [
  ["gain", 0.25, 0.25, "on pace"],
  ["gain", 0.25, 0.41, "faster than intended"],
  ["gain", 0.25, 0.09, "slower than intended"],
  ["cut", 0.25, -0.25, "on pace"],
  ["cut", 0.25, -0.41, "faster than intended"],
  ["cut", 0.25, -0.09, "slower than intended"],
  ["maintain", 0, 0.1, "on pace"],
  ["maintain", 0, -0.3, "maintenance range"],
]) {
  test(`${goal}: ${delta} uses the engine's completed-week pace classification`, () => {
    const result = model(
      { targetWeeklyGainKg: rate, weightChangeKg: delta },
      { ...targets, goal, targetWeeklyGainKg: rate },
    );
    assert.match(result.weight.value, new RegExp(text));
    assert.equal(engine.classifyWeeklyWeightChange(goal, rate, delta) === "on", text === "on pace");
  });
}

test("sparse weight evidence never shows a pace verdict or a calorie adjustment", () => {
  for (const changes of [
    { weightEntryCount: 2 },
    { previousWeightEntryCount: 2 },
    { weightChangeKg: null },
  ]) {
    const result = model({ ...changes, completedWorkouts: 2 });
    assert.match(result.weight.value, /Not enough weight data/);
    assert.equal(result.action.kind, "weigh");
    assert.match(result.training.value, /2 of 4 workouts · below goal/);
    assert.doesNotMatch(JSON.stringify(result), /Review 3150/);
  }
});

test("missing goals never inherit a gain rate or a developer target", () => {
  for (const configured of [{}, { goal: "gain" }, { goal: "maintain" }]) {
    const result = model({ targetWeeklyGainKg: null, plannedWorkouts: null }, configured);
    assert.equal(result.action.kind, "setup");
    assert.match(result.weight.value, /details incomplete/);
    assert.match(result.training.detail, /not configured/);
  }
});

for (const [field, expected] of [
  ["targetWeeklyGainKg", "Weekly pace not set"],
  ["goal", "Goal type not set"],
  ["targetWeight", "Target weight not set"],
]) {
  test(`missing explicit ${field} is classified independently and cannot authorize calories`, () => {
    const configured = { ...targets };
    delete configured[field];
    const f = fixture({ configured });
    const progressUI = f.progress();
    const props = f.ui.render().props;
    const reviewUI = f.checkIn(props);
    try {
      assert.equal(props.coach.weight.value, expected);
      assert.equal(
        props.summary.targetWeeklyGainKg,
        null,
        "incomplete configuration blocks the legacy gain fallback",
      );
      assert.equal(props.recommendation.decision, "insufficient_data");
      assert.equal(props.coach.action.kind, "setup");
      assert.equal(props.coach.action.to, "/bulk/more");
      assert.doesNotMatch(reviewUI.text(), /Apply Recommendation|on pace|faster than intended/);
      if (field !== "targetWeight") assert.match(props.coach.weight.detail, /Target: 75 kg/);
      else
        assert.doesNotMatch(
          props.coach.weight.detail,
          /75 kg/,
          "merged compatibility targets cannot replace a missing saved target",
        );
      const summaryText = textOf(progressRecommendation(progressUI));
      assert.ok(summaryText.includes(props.coach.action.value));
      assert.match(props.coach.training.value, /4 of 4 workouts/);
      assert.match(props.coach.nutrition.value, /4 of 7 days/);
      assert.ok(reviewUI.find("Link").some((node) => node.props.to === "/bulk/more"));
    } finally {
      reviewUI.dispose();
      progressUI.dispose();
      f.dispose();
    }
  });
}

test("a migrated goal with no pace keeps its target and independent workout/food figures", () => {
  const configured = { goal: "gain", targetWeight: 75, calories: 3000, trainingDaysPerWeek: 3 };
  const f = fixture({ configured, sessionCount: 1 });
  f.reads.nutrition.data = f.reads.nutrition.data.slice(0, 2);
  try {
    const props = f.ui.render().props;
    assert.equal(props.coach.weight.value, "Weekly pace not set");
    assert.match(props.coach.weight.detail, /Target: 75 kg/);
    assert.equal(props.coach.action.value, "Set your weekly pace");
    assert.equal(props.coach.training.value, "1 of 3 workouts · below goal");
    assert.equal(props.coach.nutrition.value, "2 of 7 days logged");
  } finally {
    f.dispose();
  }
});

test("complete maintenance requires explicit zero pace; zero is never filled for an absent pace", () => {
  for (const [pace, complete] of [
    [0, true],
    [undefined, false],
    [0.25, false],
  ]) {
    const configured = { ...targets, goal: "maintain", targetWeight: 70, targetWeeklyGainKg: pace };
    const result = coach.weightGoalConfiguration(configured);
    assert.equal(result.complete, complete);
    assert.equal(result.pace, complete ? 0 : null);
  }
});

test("invalid saved goal types and nonnumeric fields are never coerced or inferred", () => {
  for (const configured of [
    { ...targets, goal: "bulk" },
    { ...targets, targetWeight: "75" },
    { ...targets, targetWeeklyGainKg: "0.25" },
    { ...targets, targetWeight: NaN },
  ])
    assert.equal(coach.weightGoalConfiguration(configured).complete, false);
});

test("half the workout target is still a shortfall, not an achieved goal", () => {
  const s = summary({ completedWorkouts: 2, weightChangeKg: 0 });
  const rec = recommendation(s);
  assert.equal(rec.trainingContext, "adequate");
  assert.equal(rec.decision, "increase_calories");
  const result = coach.weeklyProgressCoach(s, targets, rec, "eligible");
  assert.match(result.training.value, /below goal/);
  assert.equal(result.action.kind, "train");
  assert.doesNotMatch(result.action.detail, /3150/);
});

test("an unconfigured workout goal remains unknown; completing or exceeding a goal is truthful", () => {
  assert.match(model({ plannedWorkouts: null }).training.detail, /not configured/);
  assert.match(model({ completedWorkouts: 5 }).training.value, /5 of 4 workouts · goal met/);
  assert.equal(model({ plannedWorkouts: null }).action.value, "Set your weekly workout target");
});

test("partial nutrition coverage is neither zero-filled nor claimed to be complete", () => {
  for (const days of [0, 1, 3]) {
    const result = model({ nutritionLoggedDays: days, nutritionTargetedDays: days });
    assert.equal(result.nutrition.value, `${days} of 7 days logged`);
    assert.match(result.nutrition.detail, /full-day intake isn’t verified/);
    assert.equal(result.action.kind, "log");
  }
  const s = progress.weeklyProgressSummary({
    selectedDay: "2026-11-22",
    weights: [],
    completedWorkoutDates: [],
    plannedWorkouts: null,
    targetWeeklyGainKg: null,
    nutritionDays: [
      { logDate: "2026-11-16", calories: 2400, protein: 140, targetCalories: 2400 },
      { logDate: "2026-11-17", calories: null, protein: null, targetCalories: 3000 },
    ],
  });
  assert.equal(s.averageCalories, 2400);
  assert.equal(s.nutritionLoggedDays, 1);
});

test("unknown historical targets prevent calorie advice even with enough logged days", () => {
  const result = model({ nutritionTargetedDays: 3, weightChangeKg: 0 });
  assert.match(result.nutrition.detail, /1 logged day has no recorded calorie target/);
  assert.equal(result.action.kind, "log");
});

test("exactly one next action reuses the eligible calorie recommendation", () => {
  const result = model({ weightChangeKg: 0 });
  assert.equal(result.action.kind, "review_calories");
  assert.match(result.action.detail, /3150 kcal\/day/);
  assert.match(result.action.detail, /until you confirm/);
  assert.equal(model().action.kind, "continue");
});

class FixedDate extends Date {
  constructor(...args) {
    super(...(args.length ? args : ["2026-11-25T12:00:00Z"]));
  }
}

function fixture({
  configured = targets,
  legacyDays = {},
  legacyWorkouts = {},
  sessionCount = 4,
  history = { baselineCalories: 3000, changedSinceReview: false },
} = {}) {
  const client = new QueryClient();
  const calls = [];
  const writes = [];
  const q = (data) => {
    const read = {
      data,
      isLoading: false,
      error: null,
      refetch: async () => {
        calls.push("refetch");
        if (read.error) throw read.error;
        return { data: read.data };
      },
    };
    return read;
  };
  const reads = {
    current: q({ savedTargets: configured }),
    weights: q(
      [9, 10, 11, 16, 17, 18].map((day) => ({
        logDate: `2026-11-${day.toString().padStart(2, "0")}`,
        weightKg: 70,
      })),
    ),
    nutrition: q(
      [16, 17, 18, 19].map((day) => ({
        logDate: `2026-11-${day}`,
        calories: 2400,
        protein: 140,
        targetCalories: 2400,
      })),
    ),
    sessions: q(
      Array.from({ length: sessionCount }, (_, i) => ({
        id: `s${i}`,
        status: "completed",
        workoutDate: "2026-11-20",
      })),
    ),
    plan: q(null),
    history: q(history),
  };
  const modules = {
    "@tanstack/react-query": { useQueryClient: () => client },
    "@/components/TempoDateTimePicker": {},
    "@/components/ui/native-select": {},
    "@/components/ui/button": { Button: "button" },
    "@/lib/challenge-evidence": {},
    "@/lib/private-image-upload": {},
    "@/components/GoalTrendCards": {
      ThirtyDayWeightCard: "ThirtyDayWeightCard",
      CheckInConsistencyCard: "CheckInConsistencyCard",
    },
    "@/components/ui-kit": {
      Card: "Card",
      SectionTitle: "SectionTitle",
      PendingLabel: "PendingLabel",
      DataError: function DataError({ message }) {
        return message;
      },
    },
    "@/components/WeeklyProgressCoach": presentationComponent(
      "src/components/WeeklyProgressCoach.tsx",
      { "@tanstack/react-router": { Link: "Link" } },
    ),
    "@/lib/weekly-progress-coach": coach,
    "@/lib/bulk-weekly-recommendation": engine,
    "@/lib/bulk-progress": progress,
    "@/lib/goal-metrics": metrics,
    "@/lib/auth": { useAuth: () => ({ user: { id: "owner" } }) },
    "@/lib/store": {
      useAppData: () => ({ days: legacyDays, workouts: legacyWorkouts }),
      refreshBulk: async () => {},
    },
    "@/lib/bulk-today-query": { useBulkToday: () => reads.current },
    "@/lib/bulk-progress-query": {
      useBulkWeights: () => reads.weights,
      useBulkProgressNutrition: () => reads.nutrition,
      useBulkCalorieReviewHistory: () => reads.history,
      useBulkProgressPhotos: () => q([]),
      applyBulkCalorieRecommendation: async (...args) => {
        writes.push(args);
        return "2026-11-25";
      },
    },
    "@/lib/bulk-training-sessions": { useCompletedSessionDates: () => reads.sessions },
    "@/lib/training-plans-query": { useActiveTrainingPlan: () => reads.plan },
    "@/lib/bulk-nutrition-query": { refreshBulkNutritionTargets: async () => {} },
    "@/lib/network-errors": { userFacingError: (error) => error.message },
    sonner: { toast: { success() {} } },
  };
  const ui = accountUI(
    "src/components/PublicBulkProgress.tsx",
    "PublicWeeklyReview",
    modules,
    { bulkProfileId: "profile", targets },
    { Date: FixedDate },
  );
  const checkIn = (props = ui.render().props, confirm = true) =>
    accountUI("src/components/PublicBulkProgress.tsx", "WeeklyCheckIn", modules, props, {
      window: { confirm: () => confirm },
      Date: FixedDate,
    });
  return {
    ui,
    checkIn,
    progress: () =>
      accountUI(
        "src/components/PublicBulkProgress.tsx",
        "PublicBulkProgress",
        modules,
        { bulkProfileId: "profile", targets },
        { Date: FixedDate },
      ),
    reads,
    calls,
    writes,
    dispose() {
      ui.dispose();
      client.clear();
    },
  };
}

test("the real analysis and save flow send current saved calories, never the historical average", async () => {
  const f = fixture();
  const props = { ...f.ui.render().props };
  assert.equal(props.summary.targetCalories, 2400);
  assert.equal(props.recommendation.currentTargetCalories, 3000);
  assert.equal(props.recommendation.recommendedCalories, 3150);
  const ui = f.checkIn(props);
  try {
    assert.match(ui.text(), /Weekly progress coach/);
    assert.equal((ui.text().match(/Next week/g) ?? []).length, 1);
    ui.button("Apply Recommendation").props.onClick();
    await ui.flush();
    assert.deepEqual(f.writes, [[3000, 3150]]);
    assert.match(ui.text(), /Daily calorie target saved: 3150/);
    // New authoritative target arrives after the mutation: the same evidence must not offer a second save.
    Object.assign(props, {
      recommendation: {
        ...props.recommendation,
        currentTargetCalories: 3150,
        recommendedCalories: 3300,
      },
    });
    assert.equal(ui.button("Recommendation applied").props.disabled, true);
  } finally {
    ui.dispose();
    f.dispose();
  }
});

test("declining confirmation in the coach performs no mutation", async () => {
  const f = fixture();
  const ui = f.checkIn(undefined, false);
  try {
    ui.button("Apply Recommendation").props.onClick();
    await ui.flush();
    assert.deepEqual(f.writes, []);
  } finally {
    ui.dispose();
    f.dispose();
  }
});

test("reopening on this or another device cannot offer a second adjustment from the same evidence", async () => {
  const first = fixture();
  const firstUI = first.checkIn();
  try {
    firstUI.button("Apply Recommendation").props.onClick();
    await firstUI.flush();
    assert.deepEqual(first.writes, [[3000, 3150]]);
  } finally {
    firstUI.dispose();
    first.dispose();
  }
  const reopened = fixture({
    configured: { ...targets, calories: 3150 },
    history: { baselineCalories: 3000, changedSinceReview: true },
  });
  const ui = reopened.checkIn();
  try {
    assert.match(ui.text(), /Keep calories steady/);
    assert.match(ui.text(), /changed after this review week/);
    assert.doesNotMatch(ui.text(), /Apply Recommendation|Recommendation applied/);
    assert.deepEqual(reopened.writes, []);
  } finally {
    ui.dispose();
    reopened.dispose();
  }
});

test("a fresh preflight blocks another device's adjustment even when the rendered guard was cached", async () => {
  const f = fixture();
  const ui = f.checkIn();
  f.reads.history.data = { baselineCalories: 3000, changedSinceReview: true };
  try {
    ui.button("Apply Recommendation").props.onClick();
    await ui.flush();
    assert.deepEqual(f.writes, []);
    assert.match(ui.text(), /Wait for new completed-week evidence/);
    assert.doesNotMatch(ui.text(), /Daily calorie target saved/);
  } finally {
    ui.dispose();
    f.dispose();
  }
});

test("history verification failure aborts before the calorie mutation", async () => {
  const f = fixture();
  const ui = f.checkIn();
  f.reads.history.error = new Error("offline");
  try {
    ui.button("Apply Recommendation").props.onClick();
    await ui.flush();
    assert.deepEqual(f.writes, []);
    assert.match(ui.text(), /No calorie change was sent/);
  } finally {
    ui.dispose();
    f.dispose();
  }
});

test("missing authoritative baseline fails closed and target resets do not erase the guard", () => {
  assert.equal(coach.calorieReviewState(undefined, 3000), "unknown");
  assert.equal(
    coach.calorieReviewState({ baselineCalories: null, changedSinceReview: false }, 3000),
    "unknown",
  );
  assert.equal(
    coach.calorieReviewState({ baselineCalories: 3000, changedSinceReview: true }, 3000),
    "changed",
  );
  const f = fixture({ history: { baselineCalories: null, changedSinceReview: false } });
  const ui = f.checkIn();
  try {
    assert.doesNotMatch(ui.text(), /Apply Recommendation/);
    assert.match(ui.text(), /history is unavailable/);
  } finally {
    ui.dispose();
    f.dispose();
  }
});

test("a calorie boundary never offers Apply or claims the target changed", () => {
  const f = fixture({
    configured: { ...targets, calories: 10_000 },
    history: { baselineCalories: 10_000, changedSinceReview: false },
  });
  const ui = f.checkIn();
  try {
    assert.doesNotMatch(ui.text(), /Apply Recommendation|Daily calorie target saved/);
    assert.match(ui.text(), /target is unchanged/);
  } finally {
    ui.dispose();
    f.dispose();
  }
});

function* rawProgressNodes(tree) {
  if (Array.isArray(tree)) {
    for (const child of tree) yield* rawProgressNodes(child);
  } else if (tree && typeof tree === "object") {
    yield tree;
    yield* rawProgressNodes(tree.props?.children);
  }
}

function progressRecommendation(ui) {
  const card = [...rawProgressNodes(ui.render())].find(
    (node) => node.type === "Card" && textOf(node.props.children?.[0]) === "Weekly recommendation",
  );
  assert.ok(card, "The existing Progress recommendation card remains present");
  return card;
}

for (const scenario of [
  {
    name: "eligible adjustment",
    options: {},
    expected: "Increase calories slightly",
    canApply: true,
  },
  {
    name: "already applied adjustment",
    options: {
      configured: { ...targets, calories: 3150 },
      history: { baselineCalories: 3000, changedSinceReview: true },
    },
    expected: "Keep calories steady",
  },
  {
    name: "manual calorie change",
    options: {
      configured: { ...targets, calories: 2800 },
      history: { baselineCalories: 3000, changedSinceReview: true },
    },
    expected: "Keep calories steady",
  },
  {
    name: "missing calorie history",
    options: { history: { baselineCalories: null, changedSinceReview: false } },
    expected: "Keep calories steady",
  },
  {
    name: "unknown historical nutrition targets",
    options: {},
    unknownNutrition: true,
    expected: "Improve nutrition coverage",
  },
]) {
  test(`Progress and Weekly Review share one completed-week action for ${scenario.name}`, () => {
    const f = fixture(scenario.options);
    if (scenario.unknownNutrition) {
      for (const day of f.reads.nutrition.data) day.targetCalories = null;
    }
    const progressUI = f.progress();
    const props = f.ui.render().props;
    const reviewUI = f.checkIn(props);
    try {
      const card = progressRecommendation(progressUI);
      const text = textOf(card);
      assert.equal(props.summary.weekStart, "2026-11-16");
      assert.equal(props.summary.weekEnd, "2026-11-22");
      assert.equal(props.coach.action.value, scenario.expected);
      assert.ok(text.includes(props.coach.action.value));
      assert.ok(text.includes(props.coach.action.detail));
      assert.ok(reviewUI.text().includes(props.coach.action.value));
      assert.ok(reviewUI.text().includes(props.coach.action.detail));
      if (!scenario.canApply)
        assert.doesNotMatch(
          text,
          /Increase calories slightly|Decrease calories slightly|Review \d+ kcal/,
        );
      assert.doesNotMatch(text, /Apply Recommendation/);
      assert.equal(reviewUI.text().includes("Apply Recommendation"), !!scenario.canApply);
      const nodes = [...rawProgressNodes(card)];
      assert.equal(nodes.find((node) => node.type === "Link").props.to, "/bulk/check-in");
      assert.equal(
        nodes.some((node) => node.type?.name === "WeeklyProgressCoach"),
        false,
      );
      // The fix is confined to the recommendation, not the other Progress cards/metrics.
      const titles = [...rawProgressNodes(progressUI.render())]
        .filter((node) => node.type === "SectionTitle")
        .map(textOf);
      for (const title of ["Goal progress", "This week", "Nutrition this week", "Recent weight"])
        assert.ok(titles.includes(title));
    } finally {
      reviewUI.dispose();
      progressUI.dispose();
      f.dispose();
    }
  });
}

for (const name of ["current", "weights", "nutrition", "sessions", "plan", "history"]) {
  test(`Progress and Weekly Review withhold advice while ${name} is loading or failed`, async () => {
    const f = fixture();
    const progressUI = f.progress();
    const cached = f.reads[name].data;
    try {
      f.reads[name].data = undefined;
      assert.equal(f.ui.render().props.availability, "loading");
      let card = progressRecommendation(progressUI);
      assert.match(textOf(card), /Loading your weekly recommendation/);
      assert.doesNotMatch(
        textOf(card),
        /Increase calories|Keep calories steady|0 of 7|Apply Recommendation/,
      );
      assert.equal(f.ui.render().props.coach, undefined);
      for (const data of [cached, undefined]) {
        f.reads[name].data = data;
        f.reads[name].error = new Error("offline");
        assert.equal(f.ui.render().props.availability, "error");
        assert.equal(f.ui.render().props.coach, undefined);
        card = progressRecommendation(progressUI);
        assert.match(textOf(card), /No assessment is available/);
        assert.doesNotMatch(
          textOf(card),
          /Increase calories|Keep calories steady|0 of 7|Apply Recommendation/,
        );
      }
      const error = [...rawProgressNodes(card)].find((node) => node.type?.name === "DataError");
      error.props.onRetry();
      await progressUI.flush();
      assert.equal(f.calls.length, 6);
    } finally {
      progressUI.dispose();
      f.dispose();
    }
  });
}

for (const name of ["current", "weights", "nutrition", "sessions", "plan", "history"]) {
  test(`${name} pending/error states cannot become empty-data coaching`, async () => {
    const f = fixture();
    try {
      f.reads[name].data = undefined;
      let props = f.ui.render().props;
      assert.equal(props.availability, "loading");
      assert.equal(props.coach, undefined);
      let ui = f.checkIn(props);
      assert.match(ui.text(), /Loading your weekly progress/);
      assert.doesNotMatch(ui.text(), /0 of 7|Apply Recommendation/);
      ui.dispose();
      f.reads[name].error = new Error("offline");
      props = f.ui.render().props;
      assert.equal(props.availability, "error");
      ui = f.checkIn(props);
      assert.match(ui.text(), /No assessment is available/);
      assert.doesNotMatch(ui.text(), /0 of 7|Apply Recommendation/);
      ui.button("Retry weekly progress").props.onClick();
      await ui.flush();
      assert.equal(f.calls.length, 6);
      ui.dispose();
    } finally {
      f.dispose();
    }
  });
}

test("successful empty queries are honestly distinct from pending and failed reads", () => {
  const f = fixture({ configured: null, sessionCount: 0 });
  f.reads.weights.data = [];
  f.reads.nutrition.data = [];
  try {
    const props = f.ui.render().props;
    assert.equal(props.availability, "ready");
    assert.match(props.coach.weight.value, /details incomplete/);
    assert.equal(props.coach.nutrition.value, "0 of 7 days logged");
    assert.match(props.coach.training.value, /0 workouts completed/);
    assert.equal(props.coach.action.kind, "setup");
  } finally {
    f.dispose();
  }
});

test("normalized review retains supported Legacy workouts without counting drafts or rest days", () => {
  const f = fixture({
    sessionCount: 1,
    legacyDays: {
      "2026-11-17": { gym: true },
      "2026-11-18": { gym: true },
      "2026-11-19": { restDay: true },
    },
    legacyWorkouts: {
      "2026-11-17": { date: "2026-11-17", status: "completed" },
      "2026-11-18": { date: "2026-11-18", status: "draft" },
    },
  });
  try {
    assert.equal(f.ui.render().props.summary.completedWorkouts, 2);
  } finally {
    f.dispose();
  }
});

test("the compact presentation has four semantic sections and wrapping values", () => {
  const component = presentationComponent("src/components/WeeklyProgressCoach.tsx", {
    "@tanstack/react-router": { Link: "Link" },
  });
  const tree = component.WeeklyProgressCoach({ model: model() });
  const sections = tree.props.children;
  assert.deepEqual(
    Array.from(sections, (section) => section.props["aria-label"]),
    ["Weight", "Training", "Nutrition", "Next week"],
  );
  assert.match(tree.props.className, /min-w-0/);
  for (const section of sections)
    assert.match(section.props.children[1].props.className, /break-words/);
  assert.doesNotMatch(textOf(tree), /Weekly Check-in|Average intake differed/);
});

test("the route replaces current normalized advice while keeping Legacy, historical and monthly views", () => {
  const source = readFileSync("src/routes/_authenticated/bulk/check-in.tsx", "utf8");
  assert.match(source, /const showCoach = !!publicId && weekOffset === 0/);
  assert.match(source, /showCoach && publicId \?/);
  assert.match(source, /!showCoach \?/);
  assert.match(source, /mode === "monthly"/);
  assert.match(source, /setWeekNote/);
  assert.match(source, /weeklySummaryText/);
});

test("cached data with a refresh error cannot produce an assessment or enable Apply", () => {
  const f = fixture();
  f.reads.current.error = new Error("current target unavailable");
  const ui = f.checkIn();
  try {
    assert.match(ui.text(), /No assessment is available/);
    assert.doesNotMatch(ui.text(), /Apply Recommendation|Next week/);
  } finally {
    ui.dispose();
    f.dispose();
  }
});

test("an absent saved calorie target cannot inherit the historical average", () => {
  const f = fixture({ configured: { ...targets, calories: undefined } });
  try {
    const props = f.ui.render().props;
    assert.equal(props.recommendation.currentTargetCalories, null);
    assert.equal(props.recommendation.reasonCode, "missing_target");
    assert.equal(props.coach.action.value, "Review your nutrition target");
  } finally {
    f.dispose();
  }
});

for (const mode of ["public", "legacy"]) {
  test(`${mode} route aligns dates, activity/sleep, notes and copied summaries while preserving navigation`, async () => {
    const copied = [];
    const savedNotes = [];
    const data = {
      ...DEFAULT_DATA,
      targets: { ...DEFAULT_DATA.targets, ...targets },
      days: {
        "2026-11-10": { date: "2026-11-10", runningKm: 2, sleepHours: 7 },
        "2026-11-16": { date: "2026-11-16", runningKm: 7, cyclingKm: 3, sleepHours: 8 },
        "2026-11-24": { date: "2026-11-24", runningKm: 99, cyclingKm: 33, sleepHours: 2 },
      },
      workouts: {},
      weekNotes: {
        "2026-11-09": "Earlier note",
        "2026-11-16": "Completed note",
        "2026-11-23": "Ongoing note",
      },
    };
    const q = (data) => ({ data });
    const ui = accountUI(
      "src/routes/_authenticated/bulk/check-in.tsx",
      "Route",
      {
        "@/lib/calc": calc,
        "@/lib/types": { ALL_EXERCISES: [] },
        "@/lib/goal-metrics": metrics,
        "@/lib/store": {
          useAppData: () => data,
          useActions: () => ({
            setWeekNote: async (...args) => {
              savedNotes.push(args);
            },
          }),
          useBulkMeta: () => ({ bulkId: "profile" }),
        },
        "@/lib/bulk-access": { useMemberships: () => q([]), bulkPlanModeFor: () => mode },
        "@/lib/bulk-training-sessions": { useCompletedSessionDates: () => q([]) },
        "@/lib/training-plans-query": { useActiveTrainingPlan: () => q(null) },
        "@/lib/bulk-progress-query": { useBulkWeights: () => q([]) },
        "@/components/PublicBulkProgress": { PublicWeeklyReview: "PublicWeeklyReview" },
        "@/components/NavigationOverlay": { useOverlayBack() {} },
        "@/components/ui-kit": { Card: "Card", Chip: "button", SectionTitle: "SectionTitle" },
      },
      {},
      {
        Date: FixedDate,
        navigator: {
          clipboard: {
            writeText: async (value) => {
              copied.push(value);
            },
          },
        },
      },
    );
    const rawNodes = function* (tree) {
      if (Array.isArray(tree)) {
        for (const child of tree) yield* rawNodes(child);
      } else if (tree && typeof tree === "object") {
        yield tree;
        yield* rawNodes(tree.props?.children);
      }
    };
    const note = () =>
      [...rawNodes(ui.render())].find((node) => node.type?.name === "WeekNoteInput");
    try {
      assert.equal(ui.find("PublicWeeklyReview").length, mode === "public" ? 1 : 0);
      assert.match(ui.text(), /Notes|Copy summary for ChatGPT/);
      if (mode === "public") assert.doesNotMatch(ui.text(), /What to do next week|more weigh-in/);
      const initialWeek = mode === "public" ? "2026-11-16" : "2026-11-23";
      const initialLabel =
        mode === "public" ? "November 16 to November 22" : "November 23 to November 29";
      assert.equal(ui.find("PageHeader")[0].props.subtitle, initialLabel);
      assert.equal(note().props.initial, mode === "public" ? "Completed note" : "Ongoing note");
      assert.match(
        ui.text(),
        mode === "public" ? /7 kmRun · 3 km ride8\.0 h/ : /99 kmRun · 33 km ride2\.0 h/,
      );
      await note().props.onSave("Saved for selected week");
      assert.deepEqual(savedNotes[0], [initialWeek, "Saved for selected week"]);
      ui.button("Copy summary for ChatGPT").props.onClick();
      await ui.flush();
      assert.match(copied[0], new RegExp(initialLabel));
      assert.match(
        copied[0],
        mode === "public" ? /run 7 km.*sleep 8\.0 h/ : /run 99 km.*sleep 2\.0 h/,
      );
      assert.match(copied[0], mode === "public" ? /Completed note/ : /Ongoing note/);
      ui.nodes()
        .find((node) => node.props?.["aria-label"] === "Previous week")
        .props.onClick();
      assert.equal(ui.find("PublicWeeklyReview").length, 0);
      assert.match(ui.text(), /more weigh-in/);
      assert.equal(
        ui.find("PageHeader")[0].props.subtitle,
        mode === "public" ? "November 9 to November 15" : "November 16 to November 22",
      );
      assert.equal(note().props.initial, mode === "public" ? "Earlier note" : "Completed note");
      ui.nodes()
        .find((node) => node.props?.["aria-label"] === "Next week")
        .props.onClick();
      assert.equal(ui.find("PublicWeeklyReview").length, mode === "public" ? 1 : 0);
      assert.equal(ui.find("PageHeader")[0].props.subtitle, initialLabel);
      assert.equal(
        ui.nodes().find((node) => node.props?.["aria-label"] === "Next week").props.disabled,
        true,
      );
      ui.button("Monthly").props.onClick();
      assert.equal(ui.find("PublicWeeklyReview").length, 0);
      assert.match(ui.text(), /Generate ChatGPT Monthly Summary/);
    } finally {
      ui.dispose();
    }
  });
}
