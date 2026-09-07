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

  for (const path of ["/bulk/training", "/bulk/workout/session-a", "/bulk/prs", "/bulk/exercises"])
    assert.equal(productAreaForPath(path), "training", path);

  for (const path of ["/bulk/meals", "/bulk/history"])
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
