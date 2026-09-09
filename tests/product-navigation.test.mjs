import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { PRODUCT_LANDING_ROUTES, productAreaForPath } from "../src/lib/product-navigation.ts";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("persistent products navigate to their real landing routes", () => {
  assert.deepEqual(PRODUCT_LANDING_ROUTES, {
    challenge: "/challenge",
    training: "/bulk/training",
    meals: "/bulk/meals",
    goal: "/bulk",
    profile: "/profile",
  });
});

test("primary and in-page navigation derive from the rendered route", async () => {
  const shell = await read("src/components/AppShell.tsx");
  assert.match(shell, /const area = productAreaForPath\(pathname\)/);
  assert.match(shell, /area === "challenge"[\s\S]*CHALLENGE_NAV/);
  assert.match(shell, /area === "training"[\s\S]*TRAINING_NAV/);
  assert.match(shell, /area === "meals"[\s\S]*MEALS_NAV/);
  assert.doesNotMatch(shell, /pendingTo|setPendingTo|selectedArea|activeSection|activeProduct/);
  assert.doesNotMatch(shell, /window\.location|location\.reload|replace:\s*true/);
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

test("bottom links preserve browser history and activation visibility rules", async () => {
  const shell = await read("src/components/AppShell.tsx");
  for (const area of ["challenge", "training", "meals", "goal"])
    assert.match(shell, new RegExp(`PRODUCT_LANDING_ROUTES\\.${area}`));
  assert.match(shell, /to: PRODUCT_LANDING_ROUTES\.profile/);
  assert.match(shell, /const PRIMARY_NAV = \[/);
  assert.match(shell, /label: "Challenge"[\s\S]*label: "Profile"/);
  assert.match(shell, /item\.area === "challenge" \|\| item\.area === "profile" \|\| hasBulk/);
  assert.match(shell, /<Link[\s\S]*to=\{item\.to\}/);
  assert.doesNotMatch(shell, /to=\{item\.to\}[\s\S]{0,200}replace/);
  assert.match(shell, /aria-label="Primary"[\s\S]*fixed inset-x-0 bottom-0/);
  assert.doesNotMatch(shell, /sticky top-0/);
});

test("Profile is selected explicitly and has no contextual product navigation", async () => {
  const shell = await read("src/components/AppShell.tsx");
  assert.equal(productAreaForPath("/profile"), "profile");
  assert.equal(productAreaForPath("/profile/preferences"), "profile");
  assert.notEqual(productAreaForPath("/profile"), "challenge");
  assert.match(shell, /const selected = area === item\.area/);
  assert.match(shell, /area === "goal"[\s\S]*\? GOAL_NAV[\s\S]*: null/);
  assert.match(shell, /\{nav \? \([\s\S]*aria-label=\{`\$\{area\} sections`\}/);
  assert.equal(productAreaForPath("/challenge"), "challenge");
});

test("only one persistent bar exists and secondary navigation stays in page flow", async () => {
  const shell = await read("src/components/AppShell.tsx");
  assert.equal((shell.match(/fixed inset-x-0 bottom-0/g) ?? []).length, 1);
  assert.match(shell, /aria-label="Primary"/);
  assert.match(shell, /aria-label=\{`\$\{area\} sections`\}[\s\S]*mb-4 overflow-x-auto/);
  assert.doesNotMatch(shell, /sticky top-0/);
  assert.doesNotMatch(shell, /aria-label=\{`\$\{area\} sections`\}[\s\S]{0,160}fixed/);
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

test("primary and secondary navigation provide bounded immediate press feedback", async () => {
  const shell = await read("src/components/AppShell.tsx");
  assert.equal((shell.match(/duration-150 ease-out/g) ?? []).length, 2);
  assert.match(shell, /active:scale-\[0\.98\][^`]*active:opacity-80/);
  assert.match(shell, /active:scale-95[^`]*active:opacity-80/);
  assert.match(shell, /preload="intent"/);
  assert.match(shell, /onPointerDown=\{\(\) => prefetchDestination/);
  assert.match(shell, /onPointerEnter=\{\(\) => prefetchDestination/);
  assert.match(shell, /onFocus=\{\(\) => prefetchDestination/);
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

  const routes = (constant) => {
    const source = shell.match(new RegExp(`const ${constant} = \\[([\\s\\S]*?)\\] as const;`))?.[1];
    assert.ok(source, `${constant} missing`);
    return [...source.matchAll(/to: "([^"]+)"/g)].map((match) => match[1]);
  };
  assert.deepEqual(routes("TRAINING_NAV"), [
    "/bulk/training",
    "/bulk/prs",
    "/bulk/training/history",
    "/bulk/training/more",
  ]);
  assert.deepEqual(routes("MEALS_NAV"), [
    "/bulk/meals",
    "/bulk/meals/presets",
    "/bulk/meals/history",
    "/bulk/meals/more",
  ]);
  assert.equal(new Set(routes("TRAINING_NAV")).size, 4);
  assert.equal(new Set(routes("MEALS_NAV")).size, 4);
  assert.doesNotMatch(shell, /hash: "(?:plan|presets)"/);
  assert.match(shell, /activePrefixes\.some\(\(prefix\) => pathname\.startsWith\(prefix\)\)/);
  for (const nested of ["/bulk/workout/", "/bulk/exercises"])
    assert.match(shell, new RegExp(nested.replaceAll("/", "\\/")));

  assert.match(trainingToday, /TrainingPlanOverview/);
  assert.doesNotMatch(trainingToday, /TrainingPlanEditor|<TrainingPlanSetup/);
  assert.match(trainingMore, /TrainingPlanEditor/);
  assert.match(trainingMore, /TrainingPlanSetup/);
  assert.match(trainingHistory, /CompletedWorkout/);

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
