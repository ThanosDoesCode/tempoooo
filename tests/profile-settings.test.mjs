import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { accountUI } from "./account-ui-fixture.mjs";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

function youFixture({ mode = "public", owned = { bulk_profile_id: "b", is_public: true } } = {}) {
  const appData =
    mode === "core"
      ? null
      : {
          targets: {
            goal: "gain",
            targetWeight: 80,
            calories: 2500,
            weeklyWorkoutGoal: 4,
            trainingDaysPerWeek: 4,
          },
          days: { "2026-10-08": { weight: 78.2 } },
          workouts: {},
        };
  return accountUI("src/routes/_authenticated/profile.tsx", "Route", {
    "@/lib/auth": { useAuth: () => ({ user: { id: "u", email: "u@tempo.test" } }) },
    "@/lib/bulk-access": {
      useMemberships: () => ({ data: owned ? [owned] : [], isLoading: false }),
      preferredBulkMembership: () => owned,
      accountProductMode: () => mode,
    },
    "@/lib/account-profile": { useAccountProfile: () => ({ data: { username: "alice" } }) },
    "@/lib/goal-discovery": {
      useGoalDiscovery: () => ({ data: { goal_seen_at: "2026-01-01" } }),
      useAcknowledgeGoal: () => async () => {},
    },
    "@/lib/streak": { useStreak: () => ({ data: { current: 6, best: 8 } }) },
    "@/lib/store": { useAppData: () => appData, useBulkMeta: () => ({ bulkId: "b" }) },
    "@/lib/use-local-day": { useLocalDay: () => "2026-10-10" },
    "@/lib/training-plans-query": {
      useActiveTrainingPlan: () => ({ data: { name: "Push pull", trainingDaysPerWeek: 4 } }),
    },
    "@/lib/bulk-training-sessions": { useCompletedSessionDates: () => ({ data: [] }) },
    "@/lib/goal-metrics": {
      collectCompletedWorkouts: () => [],
      countWorkoutsInRange: () => 2,
      resolveWeeklyWorkoutTarget: () => 4,
    },
    "@/lib/calc": { iso: () => "2026-10-05" },
    "@/components/MainPageHeader": { MainPageHeader: "MainPageHeader" },
    "@/components/PageSkeleton": { PageSkeleton: "PageSkeleton" },
  });
}

const links = (ui) => ui.find("Link").map((node) => node.props.to);

// ----------------------------------------------------------------- core mode
test("core You hides every fitness module and shows only identity, streak and the optional setup CTA", () => {
  const ui = youFixture({ mode: "core", owned: null });
  const to = links(ui);
  assert.ok(to.includes("/streak"));
  assert.ok(to.includes("/profile/settings"));
  assert.ok(to.includes("/bulk-onboarding")); // explicit optional CTA
  // No fitness summary destinations and no fitness metrics.
  for (const fitness of ["/bulk/more", "/bulk/training", "/bulk/meals"]) {
    assert.ok(!to.includes(fitness), `core must not link ${fitness}`);
  }
  assert.doesNotMatch(ui.text(), /kcal|Nutrition|Your fitness|Now \d/);
  assert.match(ui.text(), /Set up fitness tools/);
});

// ----------------------------------------------------------------- fitness mode
test("fitness You shows concise Goal/Training/Nutrition summaries and no setup CTA", () => {
  const ui = youFixture({ mode: "public" });
  const to = links(ui);
  for (const dest of [
    "/streak",
    "/profile/settings",
    "/bulk/more",
    "/bulk/training",
    "/bulk/meals",
  ])
    assert.ok(to.includes(dest), `fitness should link ${dest}`);
  assert.doesNotMatch(ui.text(), /Set up fitness tools/);
  assert.match(ui.text(), /Your fitness/);
  assert.match(ui.text(), /Bulk/); // goal direction label
  assert.match(ui.text(), /kcal/); // calorie target
});

test("streak summary shows current and best and links to /streak; the open week never inflates it", () => {
  const ui = youFixture({ mode: "public" });
  assert.match(ui.text(), /6 weeks/); // current (locked weeks only, from useStreak)
  assert.match(ui.text(), /Best 8/);
  assert.ok(links(ui).includes("/streak"));
});

test("You exposes a single settings affordance and no fake social metrics", async () => {
  const ui = youFixture({ mode: "public" });
  assert.ok(links(ui).includes("/profile/settings"));
  const profile = await read("src/routes/_authenticated/profile.tsx");
  assert.doesNotMatch(profile, /friends|followers|connections|member since|percentile|rank/i);
  // You must not duplicate bottom-nav tab destinations.
  assert.doesNotMatch(profile, /to="\/challenge"|to: "\/challenge"/);
  assert.doesNotMatch(profile, /to="\/bulk\/progress"|to: "\/bulk\/progress"/);
});

// ----------------------------------------------------------------- settings route (source)
test("settings route is account-level with contextual Back to You and the moved controls", async () => {
  const settings = await read("src/routes/_authenticated/profile_.settings.tsx");
  assert.match(settings, /createFileRoute\("\/_authenticated\/profile_\/settings"\)/);
  assert.match(settings, /backTo="\/profile"/);
  assert.match(settings, /backLabel="You"/);
  // Moved operational controls.
  assert.match(settings, /checkUsernameAvailability/);
  assert.match(settings, /saveAccountUsername/);
  assert.match(settings, /to: "\/profile\/notifications"/);
  assert.match(settings, /label: "Notification settings"/);
  assert.match(settings, /label: "Goal settings"/);
  assert.match(settings, /to: "\/bulk\/more"/);
  assert.match(settings, /<ChallengeDataExport \/>/);
  assert.match(settings, /Sign out/);
  // Destructive actions are separated into a danger zone.
  assert.match(settings, /Danger zone/);
  assert.match(settings, /text-destructive/);
  assert.match(settings, /<DeleteAccountDialog/);
});

test("the Settings title stays Tempo and the gear entry on You points to it", async () => {
  const [settings, profile] = await Promise.all([
    read("src/routes/_authenticated/profile_.settings.tsx"),
    read("src/routes/_authenticated/profile.tsx"),
  ]);
  assert.match(settings, /\{ title: "Tempo" \}/);
  assert.match(profile, /to="\/profile\/settings"/);
  assert.match(profile, /aria-label="Settings"/);
});

// ----------------------------------------------------------------- mode-awareness is derived, not guessed
test("You derives mode from accountProductMode and gates fitness on it", async () => {
  const profile = await read("src/routes/_authenticated/profile.tsx");
  assert.match(profile, /accountProductMode\(memberships\)/);
  assert.match(profile, /const core = mode === "core"/);
  assert.match(profile, /<FitnessSummary/);
});
