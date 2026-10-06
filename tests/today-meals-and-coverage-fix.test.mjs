import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { nutritionMacroStatus } from "../src/lib/bulk-nutrition.ts";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

// The Today Meals row is "complete" only once the day's calorie target is reached, using the
// authoritative nutritionMacroStatus helper (consumed vs the real target), not "any meal logged".
const mealsComplete = (calories, target) =>
  target > 0 && nutritionMacroStatus(calories, target).status !== "under";

test("Today Meals completion requires reaching the real calorie target", () => {
  const target = 2500; // the real target drives this, never a hardcoded constant
  assert.equal(mealsComplete(0, target), false); // A: nothing logged
  assert.equal(mealsComplete(1000, target), false); // B: partial intake, not complete
  assert.equal(mealsComplete(2500, target), true); // C: target reached
  assert.equal(mealsComplete(3000, target), true); // D: above target stays complete
  // A different real target shifts the boundary (no fabricated 2500).
  assert.equal(mealsComplete(2600, 3000), false);
  assert.equal(mealsComplete(3000, 3000), true);
  // No target yet means no fabricated completion.
  assert.equal(mealsComplete(0, 0), false);
  assert.equal(mealsComplete(1000, 0), false);
});

test("Today uses the target-based meals completion, not meal-logged, for the visual check", async () => {
  const today = await read("src/routes/_authenticated/bulk/index.tsx");
  // The row's completion flag is the calorie-target rule, reusing nutritionMacroStatus.
  assert.match(
    today,
    /mealsComplete =\s*mealTarget > 0 && nutritionMacroStatus\(totals\.calories, mealTarget\)\.status !== "under"/,
  );
  // Meals remains a separate visual habit after Morning check-in combines weight/sleep.
  assert.match(today, /workoutDone \|\| rest,\s*mealsComplete,?\s*\]/);
  assert.doesNotMatch(
    today,
    /\(nutrition\.data\?\.entries\.length \?\? 0\) > 0 \|\| day\?\.calories != null/,
  );
  // Subtitle still shows "X of Y kcal" against the real target.
  assert.match(today, /\$\{totals\.calories\} of \$\{mealTarget\} kcal/);
});

test("the deeper Goal day-completion rule still counts a logged meal (unchanged business rule)", async () => {
  const goalMetrics = await read("src/lib/goal-metrics.ts");
  // dayCompletionRequirements keeps "Meal logged" tied to mealLogged — not rewritten.
  assert.match(goalMetrics, /\{ key: "meal", label: "Meal logged", done: inputs\.mealLogged \}/);
});

test("Muscle coverage row has a clear, accessible expand affordance like Workout days", async () => {
  const more = await read("src/routes/_authenticated/bulk/training_/more.tsx").catch(() =>
    read("src/routes/_authenticated/bulk/training_.more.tsx"),
  );
  // Controlled native disclosure: open state tracked, aria-expanded set, chevron rotates.
  assert.match(more, /const \[coverageOpen, setCoverageOpen\] = useState\(false\)/);
  assert.match(more, /onToggle=\{\(event\) => setCoverageOpen\(event\.currentTarget\.open\)\}/);
  const summary = more.match(/<summary[\s\S]*?Muscle coverage[\s\S]*?<\/summary>/)?.[0] ?? "";
  assert.ok(summary, "muscle coverage summary found");
  assert.match(summary, /aria-expanded=\{coverageOpen\}/);
  assert.match(summary, /disclosure-summary/); // same shared layout as Workout days
  assert.match(summary, /ChevronDown/);
  assert.match(summary, /disclosure-chevron/);
  const css = await read("src/styles.css");
  assert.match(css, /details\[open\] > \.disclosure-summary > \.disclosure-chevron/);
  assert.match(css, /transform: rotate\(180deg\)/);
  // Coverage calculation/content is untouched — same component, same query input.
  assert.match(more, /<BulkMuscleCoverage/);
  assert.match(
    more,
    /useBulkMuscleCoverage\(usesPlanSetup \? \(activePlan\.data \?\? null\) : null\)/,
  );
});
