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
const goals = (ui) =>
  ui
    .find("span")
    .filter((node) => node.props["data-goal"])
    .map((node) => `${node.props["data-goal"]}:${node.props["data-status"]}`);

test("Today streak is compact: count, this-week done/active, links to /streak", () => {
  const ui = todayStreak({
    current: 6,
    activeRings: [ring("run", "closed"), ring("train", "open"), ring("eat", "open")],
  });
  assert.match(ui.text(), /6/);
  // Minimal visible text: just the count; the week's wording lives in the link label.
  assert.equal(ui.text().trim(), "6 weeks");
  const link = ui.find("Link")[0];
  assert.equal(link.props.to, "/streak");
  assert.equal(
    link.props["aria-label"],
    "Streak, 6 weeks. 1 of 3 this week: Run done, Train to do, Eat to do",
  );
  // Goal icons mirror /streak: Run is done, the rest are still to do.
  assert.deepEqual(goals(ui), ["run:done", "train:to do", "eat:to do"]);
});

test("Today streak shows only the frozen active goals, never inactive ones", () => {
  const ui = todayStreak({ current: 2, activeRings: [ring("run", "open")] });
  assert.deepEqual(goals(ui), ["run:to do"]);
  assert.doesNotMatch(ui.find("Link")[0].props["aria-label"], /Train|Eat/);
});

test("Today streak handles paused and no-goal weeks without failure wording", () => {
  const label = (data) => todayStreak(data).find("Link")[0].props["aria-label"];
  assert.match(label({ current: 4, activeRings: [ring("run", "skipped")] }), /Paused this week/);
  assert.match(label({ current: 0, activeRings: [] }), /No streak goals this week/);
});

test("a paused week shows one muted Pause icon instead of the goal icons, with no extra text", () => {
  const ui = todayStreak({
    current: 4,
    activeRings: [ring("run", "skipped"), ring("train", "skipped"), ring("eat", "skipped")],
  });
  assert.deepEqual(goals(ui), []);
  const pause = ui.find("span").filter((node) => node.props["data-paused"]);
  assert.equal(pause.length, 1);
  assert.equal(ui.find("Pause").length, 1);
  assert.match(pause[0].props.className, /border-border text-muted-foreground/);
  assert.equal(ui.text().trim(), "4 weeks");
  assert.equal(ui.find("Flame").length, 1);
  assert.equal(ui.find("ChevronRight").length, 1);
  assert.equal(
    ui.find("Link")[0].props["aria-label"],
    "Streak, 4 weeks. Paused this week: Run paused, Train paused, Eat paused",
  );
  // A week with only some goals skipped is still active: all goal icons, no Pause.
  const partial = todayStreak({
    current: 4,
    activeRings: [ring("run", "skipped"), ring("eat", "closed")],
  });
  assert.deepEqual(goals(partial), ["run:paused", "eat:done"]);
  assert.equal(partial.find("Pause").length, 0);
});

test("Today no longer renders the large rings list or ring-progress queries", async () => {
  const today = await read("src/routes/_authenticated/bulk/index.tsx");
  assert.match(today, /<TodayStreak data=\{streak\.data\} \/>/);
  assert.doesNotMatch(today, /StreakRings|useThisWeekRingProgress/);
});

// ---------------------------------------------------------------- navigation model
const nav = presentationComponent("src/lib/main-navigation.ts");

test("bottom nav is Today · Challenge · Community · Progress (the + is an action); Profile is not a tab", () => {
  assert.equal(nav.MAIN_TABS.map((tab) => tab.tab).join(","), "today,challenge,community,progress");
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

test("AppShell: 5-slot fitness bar, 3-slot core bar, Profile excluded from tab transitions", async () => {
  const shell = await read("src/components/AppShell.tsx");
  assert.match(shell, /coreNav \? "grid-cols-3" : "grid-cols-5"/);
  assert.match(shell, /new Set\(\["\/bulk", "\/challenge", "\/community", "\/bulk\/progress"\]\)/);
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
