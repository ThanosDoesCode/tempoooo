import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import {
  MAIN_TABS,
  LOG_ACTIONS,
  mainTabForPath,
  isFocusScreen,
} from "../src/lib/main-navigation.ts";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");
const exists = (path) => existsSync(new URL(`../${path}`, import.meta.url));

test("bottom bar is exactly Today, Challenge, +, Progress, You", async () => {
  assert.deepEqual(
    MAIN_TABS.map((t) => t.label),
    ["Today", "Challenge", "Progress", "You"],
  );
  const shell = await read("src/components/AppShell.tsx");
  // The center "+" is an action with an accessible label, between Challenge and Progress.
  assert.match(shell, /aria-label="Log"/);
  assert.match(shell, /MAIN_TABS\.slice\(0, 2\)/); // Today, Challenge
  assert.match(shell, /MAIN_TABS\.slice\(2\)/); // Progress, You
});

test("Training, Meals and Goal are absent from the bottom bar", () => {
  const labels = MAIN_TABS.map((t) => t.label);
  for (const gone of ["Training", "Meals", "Goal"]) assert.ok(!labels.includes(gone), gone);
});

test("the + opens the Log sheet", async () => {
  const shell = await read("src/components/AppShell.tsx");
  assert.match(shell, /const \[logOpen, setLogOpen\] = useState\(false\)/);
  assert.match(shell, /onClick=\{\(\) => setLogOpen\(true\)\}/);
  assert.match(shell, /<LogSheet open=\{logOpen\} onOpenChange=\{setLogOpen\}/);
});

test("the Log sheet shows Run, Ride, Weigh-in & sleep, Meal, Workout", async () => {
  assert.deepEqual(
    LOG_ACTIONS.map((a) => a.label),
    ["Run", "Ride", "Weigh-in & sleep", "Meal", "Workout"],
  );
  const sheet = await read("src/components/LogSheet.tsx");
  assert.match(sheet, /Counts toward your challenge/);
  assert.match(sheet, /Your day/);
});

test("each Log action routes to the correct current functional destination", () => {
  const by = Object.fromEntries(LOG_ACTIONS.map((a) => [a.key, a.to]));
  assert.equal(by.run, "/challenge/log");
  assert.equal(by.ride, "/challenge/log");
  assert.equal(by["weigh-in"], "/bulk"); // existing daily check-in
  assert.equal(by.meal, "/bulk/meals"); // existing Meals flow
  assert.equal(by.workout, "/bulk/training"); // existing Training flow
});

test("the top dropdown navigation is gone from the shared shell", async () => {
  const shell = await read("src/components/AppShell.tsx");
  assert.doesNotMatch(shell, /SecondaryNavigation/);
  assert.equal(exists("src/components/SecondaryNavigation.tsx"), false);
});

test("focus screens do not render the bottom navigation", () => {
  for (const path of [
    "/",
    "/auth",
    "/onboarding",
    "/bulk-onboarding",
    "/challenge/new",
    "/bulk/workout/session-a",
  ])
    assert.equal(isFocusScreen(path), true, path);
  // Main screens are not focus screens.
  for (const path of ["/bulk", "/challenge", "/bulk/progress", "/profile", "/bulk/meals"])
    assert.equal(isFocusScreen(path), false, path);
});

test("active tab is correct for Today, Challenge, Progress and You", () => {
  assert.equal(mainTabForPath("/bulk"), "today");
  assert.equal(mainTabForPath("/today"), "today");
  assert.equal(mainTabForPath("/bulk/training"), "today");
  assert.equal(mainTabForPath("/bulk/meals"), "today");
  assert.equal(mainTabForPath("/challenge"), "challenge");
  assert.equal(mainTabForPath("/challenge/money"), "challenge");
  assert.equal(mainTabForPath("/bulk/progress"), "progress");
  assert.equal(mainTabForPath("/bulk/check-in"), "progress"); // weekly review
  assert.equal(mainTabForPath("/bulk/prs"), "progress");
  assert.equal(mainTabForPath("/bulk/training/history"), "progress");
  assert.equal(mainTabForPath("/bulk/meals/history"), "progress");
  assert.equal(mainTabForPath("/profile"), "you");
  assert.equal(mainTabForPath("/you"), "you");
  assert.equal(mainTabForPath("/bulk/more"), "you"); // goal settings
});

test("legacy and new canonical routes both resolve (aliases redirect, old routes stay)", async () => {
  // New canonical aliases exist and redirect into the existing implementations.
  for (const [file, target] of [
    ["src/routes/_authenticated/today.tsx", "/bulk"],
    ["src/routes/_authenticated/progress.tsx", "/bulk/progress"],
    ["src/routes/_authenticated/you.tsx", "/profile"],
    ["src/routes/_authenticated/challenge/money.tsx", "/challenge/payments"],
  ]) {
    assert.ok(exists(file), file);
    assert.match(await read(file), new RegExp(`redirect\\(\\{ to: "${target}"`));
  }
  // Old routes are untouched and still registered.
  const tree = await read("src/routeTree.gen.ts");
  for (const route of [
    "/_authenticated/bulk/",
    "/_authenticated/profile",
    "/_authenticated/challenge/payments",
  ])
    assert.ok(tree.includes(route), route);
});

test("pre-setup Goal/fitness destinations highlight You, never another tab", () => {
  // The old bug highlighted Profile/Progress incorrectly. Setup is You-owned now.
  assert.equal(mainTabForPath("/bulk-onboarding"), "you");
  assert.equal(mainTabForPath("/bulk-access-denied"), "you");
  assert.notEqual(mainTabForPath("/bulk-onboarding"), "progress");
  // And it is a focus screen, so no bottom bar is shown mid-setup.
  assert.equal(isFocusScreen("/bulk-onboarding"), true);
});

test("Phase 1 renames are reflected in canonical labels and page titles", async () => {
  const [checkIn, payments] = await Promise.all([
    read("src/routes/_authenticated/bulk/check-in.tsx"),
    read("src/routes/_authenticated/challenge/payments.tsx"),
  ]);
  assert.match(checkIn, /title="Weekly review"/);
  assert.match(payments, /title="Money"/);
});
