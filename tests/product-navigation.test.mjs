import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { PRODUCT_LANDING_ROUTES, productAreaForPath } from "../src/lib/product-navigation.ts";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("top-level products navigate to their real landing routes", () => {
  assert.deepEqual(PRODUCT_LANDING_ROUTES, {
    challenge: "/challenge",
    training: "/bulk/training",
    meals: "/bulk/meals",
    goal: "/bulk",
  });
});

test("top product and contextual navigation derive from the rendered route", async () => {
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
  assert.equal(productAreaForPath("/profile"), "challenge");

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
    "/bulk/history",
  ])
    assert.equal(productAreaForPath(path), "meals", path);

  for (const path of ["/bulk", "/bulk/progress", "/bulk/check-in", "/bulk/more"])
    assert.equal(productAreaForPath(path), "goal", path);
});

test("top links preserve browser history and activation visibility rules", async () => {
  const shell = await read("src/components/AppShell.tsx");
  for (const area of ["challenge", "training", "meals", "goal"])
    assert.match(shell, new RegExp(`PRODUCT_LANDING_ROUTES\\.${area}`));
  assert.match(shell, /item\.area !== "challenge" && !hasBulk \? null/);
  assert.match(shell, /<Link[\s\S]*to=\{item\.to\}/);
  assert.doesNotMatch(shell, /to=\{item\.to\}[\s\S]{0,200}replace/);
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
  for (const nested of ["/bulk/workout/", "/bulk/exercises", "/bulk/history"])
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
  assert.doesNotMatch(shell, /window\.location|location\.reload|replace:\s*true/);
});
