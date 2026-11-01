import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { accountUI } from "./account-ui-fixture.mjs";
import { presentationComponent } from "./presentation-component-fixture.mjs";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");
const activityGrid = presentationComponent("src/lib/activity-grid.ts");

function profileFixture({
  mode = "public",
  owned = { bulk_profile_id: "b", is_public: true },
  username = "alice",
  avatar = null,
  ring = {},
  summary = [{ userId: "u", stats: { totalKm: 212.4 } }],
  workouts = 31,
  photos = 2,
} = {}) {
  return accountUI("src/routes/_authenticated/profile.tsx", "Route", {
    "@/lib/auth": { useAuth: () => ({ user: { id: "u", email: "u@tempo.test" } }) },
    "@/lib/bulk-access": {
      useMemberships: () => ({ data: owned ? [owned] : [], isLoading: false }),
      preferredBulkMembership: () => owned,
      accountProductMode: () => mode,
    },
    "@/lib/account-profile": {
      useAccountProfile: () => ({ data: { username, avatar_url: avatar } }),
    },
    "@/lib/goal-discovery": {
      useGoalDiscovery: () => ({ data: { goal_seen_at: "2026-01-01" } }),
      useAcknowledgeGoal: () => async () => {},
    },
    "@/lib/streak": {
      useStreak: () => ({
        data: {
          current: 6,
          best: 8,
          thisWeek: null,
          activeRings: [
            { key: "run", active: true, state: "closed" },
            { key: "train", active: true, state: "open" },
          ],
        },
      }),
      useThisWeekRingProgress: () => ring,
    },
    "@/lib/store": {
      useAppData: () => (mode === "core" ? null : { workouts: {}, days: {} }),
      useBulkMeta: () => ({ bulkId: "b" }),
    },
    "@/lib/use-local-day": { useLocalDay: () => "2026-11-04" },
    "@/lib/bulk-training-sessions": {
      useCompletedSessionDates: () => ({ data: [] }),
      useCompletedWorkoutCount: () => ({ data: mode === "public" ? workouts : undefined }),
    },
    "@/lib/goal-metrics": { collectCompletedWorkouts: () => [] },
    "@/lib/challenge": {
      useMyChallenge: () => ({ data: { id: "c" } }),
      useActivitySummary: () => ({ data: summary }),
      useEnduranceActivities: () => ({ data: [] }),
    },
    "@/lib/progress-model": { usePhotoCount: () => photos },
    "@/lib/activity-grid": activityGrid,
    "@/components/PageSkeleton": { PageSkeleton: "PageSkeleton" },
  });
}

const links = (ui) => ui.find("Link").map((node) => node.props.to);

// ----------------------------------------------------------------- core mode
test("core profile shows identity, streak, Challenges and the optional setup CTA — no fitness rows", () => {
  const ui = profileFixture({ mode: "core", owned: null });
  const to = links(ui);
  for (const dest of ["/streak", "/profile/settings", "/challenge/history", "/bulk-onboarding"])
    assert.ok(to.includes(dest), `core should link ${dest}`);
  for (const fitness of ["/bulk/prs", "/bulk/progress/photos", "/bulk/more"])
    assert.ok(!to.includes(fitness), `core must not link ${fitness}`);
  assert.doesNotMatch(ui.text(), /workouts|kcal/);
  assert.match(ui.text(), /Each square is a day you ran or rode\./);
});

// ----------------------------------------------------------------- fitness mode
test("fitness profile: real stats row, activity card and Challenges/PRs/Photos rows; no setup CTA", () => {
  const ui = profileFixture({ mode: "public" });
  const to = links(ui);
  for (const dest of ["/challenge/history", "/bulk/prs", "/bulk/progress/photos"])
    assert.ok(to.includes(dest), `fitness should link ${dest}`);
  assert.ok(!to.includes("/bulk-onboarding"));
  const text = ui.text();
  assert.match(text, /212/); // km from the Challenge activity summary (rounded)
  assert.match(text, /31/); // completed workouts (head count)
  assert.match(text, /8/); // best streak
  assert.match(text, /Each square is a day you trained, ran or rode\./);
  assert.match(text, /13 weeks ago/);
});

test("stats only show what exists: no Challenge summary and no workouts hides those columns", () => {
  const ui = profileFixture({ mode: "legacy", summary: [], owned: { bulk_profile_id: "b" } });
  assert.doesNotMatch(ui.text(), /km run & ridden|workouts/);
  assert.match(ui.text(), /best streak/);
});

test("streak: hero flame badge links /streak with the locked-week count; best is a stat", () => {
  const ui = profileFixture();
  const flame = ui.find("Link").find((node) => node.props.to === "/streak");
  assert.ok(flame);
  assert.match(flame.props["aria-label"], /Streak, 6 weeks/);
  assert.match(ui.text(), /best streak/);
});

test("the weekly line uses real ring progress and is omitted without a target", () => {
  const withRun = profileFixture({
    ring: { run: { kind: "count", current: 6.5, target: 15, unit: "km" } },
  });
  assert.match(withRun.text(), /This week/);
  assert.match(withRun.text(), /6\.5 of 15 km/);
  assert.doesNotMatch(profileFixture({ ring: {} }).text(), /This week/);
});

test("hero uses the real avatar when present, otherwise initials; long usernames wrap safely", async () => {
  const withAvatar = profileFixture({ avatar: "https://example.test/a.png" });
  assert.equal(withAvatar.find("img")[0].props.src, "https://example.test/a.png");
  assert.match(profileFixture().text(), /AL/);
  const profile = await read("src/routes/_authenticated/profile.tsx");
  assert.match(profile, /break-all text-2xl/);
});

test("a single settings affordance, no fake social metrics, no bottom-tab duplication", async () => {
  const ui = profileFixture();
  assert.equal(links(ui).filter((to) => to === "/profile/settings").length, 1);
  const profile = await read("src/routes/_authenticated/profile.tsx");
  assert.doesNotMatch(profile, /friends|followers|connections|member since|percentile|rank/i);
  assert.doesNotMatch(profile, /to="\/challenge"|to: "\/challenge"/);
  assert.doesNotMatch(profile, /to="\/bulk\/progress"|to: "\/bulk\/progress"/);
});

// ----------------------------------------------------------------- settings route (source)
test("settings route is account-level with contextual Back to Profile and the moved controls", async () => {
  const settings = await read("src/routes/_authenticated/profile_.settings.tsx");
  assert.match(settings, /createFileRoute\("\/_authenticated\/profile_\/settings"\)/);
  assert.match(settings, /backTo="\/profile"/);
  assert.match(settings, /backLabel="Profile"/);
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

test("the Settings title stays Tempo and the gear entry on Profile points to it", async () => {
  const [settings, profile] = await Promise.all([
    read("src/routes/_authenticated/profile_.settings.tsx"),
    read("src/routes/_authenticated/profile.tsx"),
  ]);
  assert.match(settings, /\{ title: "Tempo" \}/);
  assert.match(profile, /to="\/profile\/settings"/);
  assert.match(profile, /aria-label="Settings"/);
});

// ----------------------------------------------------------------- mode-awareness is derived, not guessed
test("Profile derives mode from accountProductMode and gates fitness on it", async () => {
  const profile = await read("src/routes/_authenticated/profile.tsx");
  assert.match(profile, /accountProductMode\(memberships\)/);
  assert.match(profile, /const core = mode === "core"/);
  assert.match(profile, /const publicFitness = mode === "public"/);
});
