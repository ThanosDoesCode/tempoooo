import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { accountUI } from "./account-ui-fixture.mjs";
import { presentationComponent } from "./presentation-component-fixture.mjs";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

// ---------------------------------------------------------------- activity grid (pure)
const grid = presentationComponent("src/lib/activity-grid.ts");

test("activity grid: 14 Monday-start week columns of 7 days ending this week; today/future flagged", () => {
  // 2026-11-04 is a Wednesday.
  const { columns } = grid.activityGrid([], "2026-11-04");
  assert.equal(columns.length, 14);
  assert.ok(columns.every((column) => column.length === 7));
  assert.equal(columns[0][0].date, "2026-08-03", "first cell is the Monday 13 weeks back");
  const last = columns[13];
  assert.equal(last[0].date, "2026-11-02", "last column starts this Monday");
  assert.equal(last[2].today, true);
  assert.equal(last[2].future, false);
  assert.equal(last[3].future, true, "Thursday after today is future");
  assert.equal(grid.activityGridStart("2026-11-04"), "2026-08-03");
});

test("activity grid: counts repeat visits per day and averages active days per week", () => {
  const today = "2026-11-04";
  const { columns, activeDays, perWeek } = grid.activityGrid(
    ["2026-11-02", "2026-11-02", "2026-11-03", "2026-07-01" /* before the window */],
    today,
  );
  const thisWeek = columns[13];
  assert.equal(thisWeek[0].count, 2, "two activities on Monday raise intensity");
  assert.equal(thisWeek[1].count, 1);
  assert.equal(activeDays, 2, "out-of-window dates are not counted");
  // 2 active days over (13 weeks + 3 days) = 94 days.
  assert.equal(perWeek, Math.round((2 / (94 / 7)) * 10) / 10);
});

// ---------------------------------------------------------------- compact Today streak
function todayStreak(data) {
  return accountUI("src/components/TodayStreak.tsx", "TodayStreak", {}, { data });
}
const ring = (key, state, active = true) => ({ key, active, state });

test("Today streak is compact: count, this-week done/active, links to /streak", () => {
  const ui = todayStreak({
    current: 6,
    activeRings: [ring("run", "closed"), ring("train", "open"), ring("eat", "open")],
  });
  assert.match(ui.text(), /6/);
  assert.match(ui.text(), /This week 1\/3/);
  const link = ui.find("Link")[0];
  assert.equal(link.props.to, "/streak");
  assert.match(link.props["aria-label"], /Streak, 6 weeks/);
  // Run is done (✓), the rest are still to do.
  assert.match(ui.text(), /✓ Run/);
});

test("Today streak shows only the frozen active goals, never inactive ones", () => {
  const ui = todayStreak({ current: 2, activeRings: [ring("run", "open")] });
  assert.match(ui.text(), /Run/);
  assert.doesNotMatch(ui.text(), /Train|Eat/);
});

test("Today streak handles paused and no-goal weeks without failure wording", () => {
  assert.match(
    todayStreak({ current: 4, activeRings: [ring("run", "skipped")] }).text(),
    /Paused this week/,
  );
  assert.match(todayStreak({ current: 0, activeRings: [] }).text(), /No streak goals this week/);
});

test("Today no longer renders the large rings list or ring-progress queries", async () => {
  const today = await read("src/routes/_authenticated/bulk/index.tsx");
  assert.match(today, /<TodayStreak data=\{streak\.data\} \/>/);
  assert.doesNotMatch(today, /StreakRings|useThisWeekRingProgress/);
});

// ---------------------------------------------------------------- navigation model
const nav = presentationComponent("src/lib/main-navigation.ts");

test("bottom nav is Today · Challenge · Progress (the + is an action); Profile is not a tab", () => {
  assert.equal(nav.MAIN_TABS.map((tab) => tab.tab).join(","), "today,challenge,progress");
  assert.equal(
    nav.MAIN_TABS.some((tab) => tab.to === "/profile"),
    false,
  );
});

test("account-level routes never falsely activate a bottom tab", () => {
  for (const path of ["/profile", "/profile/settings", "/you", "/bulk/more", "/bulk-onboarding"])
    assert.equal(nav.mainTabForPath(path), null, path);
  assert.equal(nav.mainTabForPath("/bulk"), "today");
  assert.equal(nav.mainTabForPath("/challenge"), "challenge");
  assert.equal(nav.mainTabForPath("/bulk/progress"), "progress");
});

test("AppShell: 4-slot fitness bar, 2-slot core bar, Profile excluded from tab transitions", async () => {
  const shell = await read("src/components/AppShell.tsx");
  assert.match(shell, /coreNav \? "grid-cols-2" : "grid-cols-4"/);
  assert.match(shell, /new Set\(\["\/bulk", "\/challenge", "\/bulk\/progress"\]\)/);
  assert.doesNotMatch(shell, /"you"|\/profile/);
});

// ---------------------------------------------------------------- header account actions
test("MainPageHeader groups Notifications then Profile as the account actions", () => {
  const ui = accountUI(
    "src/components/MainPageHeader.tsx",
    "MainPageHeader",
    {
      "./NotificationBell": { NotificationBell: "NotificationBell" },
      "./ProfileButton": { ProfileButton: "ProfileButton" },
    },
    { title: "Today" },
  );
  const types = ui.nodes().map((node) => node.type);
  const bell = types.indexOf("NotificationBell");
  const profile = types.indexOf("ProfileButton");
  assert.ok(bell >= 0 && profile > bell, "Profile sits immediately after Notifications");
});

function profileButton({ avatar = null, username = "alice", memberships = [], seen = "x" } = {}) {
  return accountUI("src/components/ProfileButton.tsx", "ProfileButton", {
    "@/lib/auth": { useAuth: () => ({ user: { id: "u", email: "u@tempo.test" } }) },
    "@/lib/account-profile": {
      useAccountProfile: () => ({ data: { username, avatar_url: avatar } }),
    },
    "@/lib/bulk-access": {
      useMemberships: () => ({ data: memberships }),
      preferredBulkMembership: (rows) => rows[0] ?? null,
    },
    "@/lib/goal-discovery": {
      useGoalDiscovery: () => ({ isSuccess: true, data: { goal_seen_at: seen } }),
    },
  });
}

test("Profile control opens /profile and shows initials when there is no real avatar", () => {
  const ui = profileButton();
  const link = ui.find("Link")[0];
  assert.equal(link.props.to, "/profile");
  assert.equal(link.props["aria-label"], "Profile");
  assert.match(link.props.className, /h-11 w-11/, "keeps the 44px touch target");
  assert.match(ui.text(), /AL/);
  assert.equal(ui.find("img").length, 0, "no fake avatar");
});

test("Profile control uses the real OAuth avatar when one exists", () => {
  const ui = profileButton({ avatar: "https://example.test/a.png" });
  assert.equal(ui.find("img")[0].props.src, "https://example.test/a.png");
});

test("core accounts keep the New Fitness tools dot on the Profile control until seen", () => {
  const ui = profileButton({ memberships: [], seen: null });
  assert.ok(ui.nodes().some((node) => node.props?.["aria-label"] === "New Fitness tools"));
  const fitness = profileButton({ memberships: [{ id: "m" }], seen: null });
  assert.equal(
    fitness.nodes().some((node) => node.props?.["aria-label"] === "New Fitness tools"),
    false,
  );
});

// ---------------------------------------------------------------- Profile hierarchy (source)
test("Profile is an account screen: contextual back, settings gear, hero, stats, activity, rows", async () => {
  const profile = await read("src/routes/_authenticated/profile.tsx");
  assert.match(profile, /<HistoryBackLink fallback="\/today" iconOnly \/>/);
  assert.match(profile, /to="\/profile\/settings"/);
  assert.match(profile, /aria-label="Settings"/);
  assert.doesNotMatch(profile, /MainPageHeader/, "not a bottom-tab page anymore");
  assert.match(profile, /km run & ridden/);
  assert.match(profile, /"workouts"/);
  assert.match(profile, /best streak/);
  assert.match(profile, /13 weeks ago/);
  assert.match(profile, /Each square is a day you trained, ran or rode\./);
  for (const to of ["/challenge/history", "/bulk/prs", "/bulk/progress/photos"])
    assert.ok(profile.includes(`to="${to}"`), to);
  // No invented social features or fake metrics.
  assert.doesNotMatch(profile, /friend|follower|lifted|kg lifted|won|lost/i);
});
