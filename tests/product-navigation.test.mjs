import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { PRODUCT_LANDING_ROUTES, productAreaForPath } from "../src/lib/product-navigation.ts";
import { mainTabForPath } from "../src/lib/main-navigation.ts";
import { accountProductMode, preferredBulkMembership } from "../src/lib/bulk-mode.ts";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

const membership = (overrides = {}) => ({
  bulk_profile_id: "profile-a",
  role: "owner",
  owner_id: "user-a",
  allow_editor: false,
  is_public: false,
  is_active: true,
  ...overrides,
});

test("account modes produce core, public fitness and legacy navigation states", () => {
  assert.equal(accountProductMode(undefined), "core");
  assert.equal(accountProductMode([]), "core");
  assert.equal(accountProductMode([membership({ is_active: false, is_public: true })]), "core");
  assert.equal(accountProductMode([membership({ is_public: true })]), "public");
  assert.equal(accountProductMode([membership()]), "legacy");
});

test("active public membership wins deterministically over a legacy cache row", () => {
  const legacy = membership({ bulk_profile_id: "legacy" });
  const publicGoal = membership({ bulk_profile_id: "public", is_public: true });
  assert.equal(preferredBulkMembership([legacy, publicGoal])?.bulk_profile_id, "public");
  assert.equal(preferredBulkMembership([publicGoal, legacy])?.bulk_profile_id, "public");
});

test("persistent products navigate to their real landing routes", () => {
  assert.deepEqual(PRODUCT_LANDING_ROUTES, {
    challenge: "/challenge",
    training: "/bulk/training",
    meals: "/bulk/meals",
    goal: "/bulk",
    profile: "/profile",
  });
});

test("primary navigation derives the active tab from the rendered route", async () => {
  const shell = await read("src/components/AppShell.tsx");
  assert.match(shell, /mainTabForPath\(pathname\)/);
  assert.match(shell, /MAIN_TABS/);
  // The old per-area dropdown is gone.
  assert.doesNotMatch(shell, /SecondaryNavigation|CHALLENGE_NAV|TRAINING_NAV|MEALS_NAV|GOAL_NAV/);
  assert.doesNotMatch(shell, /pendingTo|setPendingTo|selectedArea|activeSection|activeProduct/);
  assert.doesNotMatch(shell, /window\.location|location\.reload/);
});

test("deep routes select the correct parent product", () => {
  for (const path of ["/challenge", "/challenge/log", "/challenge/history/week/4"])
    assert.equal(productAreaForPath(path), "challenge", path);
  assert.equal(productAreaForPath("/invite/challenge/token"), "challenge");

  for (const path of ["/profile", "/profile/security", "/bulk-onboarding", "/bulk-access-denied"])
    assert.equal(productAreaForPath(path), "profile", path);

  for (const path of [
    "/bulk/training",
    "/bulk/training/history",
    "/bulk/training/more",
    "/bulk/workout/session-a",
    "/bulk/prs",
    "/bulk/exercises",
  ])
    assert.equal(productAreaForPath(path), "training", path);

  for (const path of [
    "/bulk/meals",
    "/bulk/meals/presets",
    "/bulk/meals/history",
    "/bulk/meals/more",
  ])
    assert.equal(productAreaForPath(path), "meals", path);

  for (const path of ["/bulk", "/bulk/progress", "/bulk/check-in", "/bulk/more", "/bulk/history"])
    assert.equal(productAreaForPath(path), "goal", path);

  for (const path of ["/unknown", "/settings", "/profile-other"])
    assert.equal(productAreaForPath(path), null, path);
});

test("bottom bar is Today, Challenge, +, Progress, You and preserves browser history", async () => {
  const [shell, nav] = await Promise.all([
    read("src/components/AppShell.tsx"),
    read("src/lib/main-navigation.ts"),
  ]);
  assert.deepEqual(
    [...nav.matchAll(/label: "([^"]+)", to:/g)].map((m) => m[1]),
    ["Today", "Challenge", "Progress", "You"],
  );
  // Training, Meals and Goal are no longer bottom tabs.
  assert.doesNotMatch(nav, /label: "(Training|Meals|Goal)"/);
  assert.match(shell, /aria-label="Log"/); // the center "+" action
  assert.match(shell, /<Link[\s\S]*to=\{item\.to\}/);
  assert.doesNotMatch(shell, /to=\{item\.to\}[\s\S]{0,200}replace/);
  assert.match(shell, /aria-label="Primary"[\s\S]*fixed inset-x-0 bottom-0/);
  assert.doesNotMatch(shell, /My Bulk/);
  assert.doesNotMatch(shell, /sticky top-0/);
});

test("You is selected explicitly and there is no contextual product dropdown", async () => {
  const shell = await read("src/components/AppShell.tsx");
  // The You tab owns the profile, goal settings, fitness setup and diagnostics.
  for (const path of ["/profile", "/profile/security", "/bulk/more", "/bulk-onboarding"])
    assert.equal(mainTabForPath(path), "you", path);
  assert.equal(mainTabForPath("/challenge"), "challenge");
  assert.equal(mainTabForPath("/bulk"), "today");
  assert.equal(mainTabForPath("/bulk/progress"), "progress");
  assert.match(shell, /active \? "page" : undefined/);
  assert.doesNotMatch(shell, /SecondaryNavigation/);
});

test("only one persistent bar exists and the top dropdown is gone", async () => {
  const shell = await read("src/components/AppShell.tsx");
  assert.equal((shell.match(/fixed inset-x-0 bottom-0/g) ?? []).length, 1);
  assert.match(shell, /aria-label="Primary"/);
  // The top dropdown / secondary navigation component is removed entirely.
  assert.doesNotMatch(shell, /SecondaryNavigation/);
  assert.doesNotMatch(shell, /sticky top-0/);
  const { existsSync } = await import("node:fs");
  assert.equal(
    existsSync(new URL("../src/components/SecondaryNavigation.tsx", import.meta.url)),
    false,
  );
});

test("the shared Log sheet replaces the dropdown as the add surface", async () => {
  const [shell, sheet, nav] = await Promise.all([
    read("src/components/AppShell.tsx"),
    read("src/components/LogSheet.tsx"),
    read("src/lib/main-navigation.ts"),
  ]);
  assert.match(shell, /<LogSheet open=\{logOpen\} onOpenChange=\{setLogOpen\}/);
  assert.match(shell, /aria-label="Log"/);
  // Two groups in the sheet, and the five actions each routing to an existing functional flow.
  assert.match(sheet, /Counts toward your challenge/);
  assert.match(sheet, /Your day/);
  const labels = [...nav.matchAll(/label: "([^"]+)",\n/g)].map((m) => m[1]);
  assert.deepEqual(labels, ["Run", "Ride", "Weigh-in & sleep", "Meal", "Workout"]);
  assert.match(nav, /to: "\/challenge\/add"/); // Run + Ride -> Add run or ride
  assert.match(nav, /to: "\/bulk\/meals\/add"/); // Meal -> dedicated Add Meal flow
  assert.match(nav, /to: "\/bulk\/training"/); // Workout -> existing Training flow
});

test("authenticated sibling routes share one persistent shell and transition only route content", async () => {
  const [shell, authenticatedLayout, styles] = await Promise.all([
    read("src/components/AppShell.tsx"),
    read("src/routes/_authenticated/route.tsx"),
    read("src/styles.css"),
  ]);

  assert.match(authenticatedLayout, /<AppShell>[\s\S]*<Outlet \/>[\s\S]*<\/AppShell>/);
  assert.match(shell, /const AppShellMountedContext = createContext\(false\)/);
  assert.match(shell, /if \(shellMounted\) return <>\{children\}<\/>/);
  assert.match(shell, /<AppShellMountedContext\.Provider value>/);
  assert.match(shell, /<div key=\{pathname\} className="tempo-route-content">/);
  assert.doesNotMatch(authenticatedLayout, /key=\{(?:pathname|location)/);
  assert.match(styles, /\.tempo-route-content\s*\{[\s\S]*tempo-route-enter 0\.15s/);
  assert.match(styles, /@keyframes tempo-route-enter[\s\S]*translateY\(3px\)/);
  assert.match(
    styles,
    /@media \(prefers-reduced-motion: reduce\)[\s\S]*\.tempo-route-content\s*\{\s*animation: none;/,
  );
});

test("primary navigation provides bounded immediate press feedback", async () => {
  const shell = await read("src/components/AppShell.tsx");
  assert.match(shell, /duration-150 ease-out/);
  assert.match(shell, /active:scale-95/);
  assert.match(shell, /preload="intent"/);
  assert.match(shell, /onPointerDown=\{onIntent\}/);
  assert.match(shell, /onPointerEnter=\{onIntent\}/);
  assert.match(shell, /onFocus=\{onIntent\}/);
});

test("route mapping cannot mutate legacy My Bulk fixtures", () => {
  const legacy = {
    workouts: [{ date: "2026-08-31", name: "Chest & Back", volume: 832 }],
    exercises: [{ id: "incline-press", order: 1 }],
    meals: [{ id: "salmon", calories: 2850 }],
    history: [{ date: "2026-08-31", note: "Stored note" }],
    targets: { calories: 2900, protein: 130 },
    settings: { allowEditor: false },
    weeklyNotes: [{ week: "2026-W36", note: "Keep this" }],
    progressPhotos: [{ path: "owner/date/photo.webp" }],
    snapshots: [{ bodyweight: 61.5, reps: [10, 10, 6] }],
  };
  const before = structuredClone(legacy);
  for (const path of [
    "/bulk",
    "/bulk/training",
    "/bulk/workout/session-a",
    "/bulk/meals",
    "/bulk/meals/history",
    "/bulk/progress",
  ])
    productAreaForPath(path);
  assert.deepEqual(legacy, before);
});

test("persisted membership status explicitly separates public, legacy and no-plan modes", async () => {
  const access = await read("src/lib/bulk-access.ts");
  assert.match(access, /export type BulkPlanMode = "public" \| "legacy" \| "none"/);
  assert.match(access, /if \(!membership \|\| membership\.is_active === false\) return "none"/);
  assert.match(access, /return membership\.is_public \? "public" : "legacy"/);
  assert.match(access, /is_public: profile\?\.goal_status != null/);
  assert.doesNotMatch(access, /trainingSetupPreference/);
});

test("only the pre-public legacy cohort can retain the legacy Goal compatibility mode", async () => {
  const migration = await read(
    "supabase/migrations/20260912130000_distinguish_legacy_goal_profiles.sql",
  );
  assert.match(migration, /profile\.goal_status IS NULL/);
  assert.match(migration, /legacy_owner\.user_id = profile\.owner_id/);
  assert.match(migration, /SET goal_status = 'inactive'/);
  assert.match(migration, /NULL is reserved for owners captured in the pre-public legacy cohort/);
});

test("contextual navigation uses distinct route-backed tasks", async () => {
  const [
    shell,
    trainingToday,
    trainingMore,
    trainingHistory,
    mealsToday,
    mealsPresets,
    mealsHistory,
  ] = await Promise.all([
    read("src/components/AppShell.tsx"),
    read("src/routes/_authenticated/bulk/training.tsx"),
    read("src/routes/_authenticated/bulk/training_.more.tsx"),
    read("src/routes/_authenticated/bulk/training_.history.tsx"),
    read("src/routes/_authenticated/bulk/meals.tsx"),
    read("src/routes/_authenticated/bulk/meals_.presets.tsx"),
    read("src/routes/_authenticated/bulk/meals_.history.tsx"),
  ]);

  // Training and Meals history now live under Progress, reached from in-page rows;
  // Training and Meals open from the Log sheet. The active tab is centralized.
  const navModule = await read("src/lib/main-navigation.ts");
  for (const [path, tab] of [
    ["/bulk/training", "today"],
    ["/bulk/meals", "today"],
    ["/bulk/workout/session-a", "today"],
    ["/bulk/training/history", "progress"],
    ["/bulk/meals/history", "progress"],
    ["/bulk/prs", "progress"],
  ])
    assert.equal(mainTabForPath(path), tab, path);
  assert.doesNotMatch(shell, /hash: "(?:plan|presets)"/);
  for (const nested of ["/bulk/workout", "/bulk/exercises"])
    assert.match(navModule, new RegExp(nested.replaceAll("/", "\\/")));

  assert.match(trainingToday, /TrainingPlanOverview/);
  assert.doesNotMatch(trainingToday, /TrainingPlanEditor|<TrainingPlanSetup/);
  assert.match(trainingMore, /TrainingPlanEditor/);
  assert.match(trainingMore, /TrainingPlanSetup/);
  assert.match(trainingHistory, /PublicWorkoutCard/);
  assert.match(trainingHistory, /PublicWorkoutDetail/);

  assert.match(mealsToday, /BulkNutritionLog/);
  assert.doesNotMatch(mealsToday, /BulkMealPresets/);
  assert.doesNotMatch(mealsToday, /useLocation|hash === "presets"|hidden=\{view/);
  assert.match(mealsPresets, /BulkMealPresets/);
  assert.doesNotMatch(mealsPresets, /BulkNutritionLog/);
  assert.match(mealsHistory, /useBulkNutritionDay/);
  assert.match(mealsHistory, /Logged meals and entries/);
  assert.doesNotMatch(mealsHistory, /CompletedWorkout|useCompletedBulkTrainingSessions/);
  assert.doesNotMatch(shell, /window\.location|location\.reload|replace:\s*true/);
});

test("every Meals tab remains in the unified Goal meal experience", async () => {
  const [shell, presets, today, history, more] = await Promise.all([
    read("src/components/AppShell.tsx"),
    read("src/routes/_authenticated/bulk/meals_.presets.tsx"),
    read("src/routes/_authenticated/bulk/meals.tsx"),
    read("src/routes/_authenticated/bulk/meals_.history.tsx"),
    read("src/routes/_authenticated/bulk/meals_.more.tsx"),
  ]);

  for (const path of [
    "/bulk/meals",
    "/bulk/meals/presets",
    "/bulk/meals/history",
    "/bulk/meals/more",
  ])
    assert.equal(productAreaForPath(path), "meals", path);
  assert.equal(productAreaForPath("/bulk"), "goal");

  // Meals remains one unified experience reached from the Log sheet / Today; presets are
  // still a route-backed destination (reached in-page and via deep links).
  assert.match(shell, /<LogSheet/);
  assert.match(presets, /<BulkMealPresets bulkProfileId=\{bulkId\}/);
  assert.doesNotMatch(presets, /LegacyMealPresets|MEAL_PLANS/);
  assert.doesNotMatch(presets, /Navigate|to="\/bulk"|replace/);
  assert.match(today, /BulkNutritionLog/);
  assert.match(history, /MealsHistoryPage/);
  assert.match(more, /redirect\(\{ to: "\/bulk\/meals\/presets", replace: true \}\)/);
});
