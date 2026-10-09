import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { accountProductMode, preferredBulkMembership } from "../src/lib/bulk-mode.ts";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");
const membership = (over = {}) => ({
  bulk_profile_id: "p",
  role: "owner",
  is_public: false,
  is_active: true,
  ...over,
});

test("Challenge-only is the canonical 'core' mode; a fitness plan makes it public/legacy (no new field needed)", () => {
  // No fitness membership → Challenge-only. This is canonical (the bulk plan row), not fragile.
  assert.equal(accountProductMode(undefined), "core");
  assert.equal(accountProductMode([]), "core");
  assert.equal(accountProductMode([membership({ is_active: false })]), "core");
  assert.equal(preferredBulkMembership([]), null);
  // A fitness plan (created atomically by onboarding) flips the mode.
  assert.equal(accountProductMode([membership({ is_public: true })]), "public");
  assert.equal(accountProductMode([membership()]), "legacy");
});

test("the first fitness onboarding step shows no Back and no misleading Challenge destination", async () => {
  const onboarding = await read("src/routes/_authenticated/bulk-onboarding.tsx");
  // No contextual Back on the first step; a plain brand label instead.
  assert.doesNotMatch(onboarding, /HistoryBackLink/);
  assert.match(
    onboarding,
    /step === 1 \? \(\s*(?:\/\/[^\n]*\n\s*)*<span className="text-sm font-semibold text-primary">Tempo<\/span>/,
  );
  // Later steps can still go Back within the wizard.
  assert.match(onboarding, /<BackButton disabled=\{busy\} onClick=\{\(\) => setStep\(\(step - 1\)/);
});

test("Challenge-only users hitting a fitness surface get the gated screen, never auto-launched onboarding", async () => {
  const guard = await read("src/routes/_authenticated/bulk/route.tsx");
  // /bulk itself stays reachable (Welcome/empty Today); deeper fitness surfaces are gated.
  assert.match(guard, /if \(!preferred && location\.pathname === "\/bulk"\) return/);
  assert.match(guard, /redirect\(\{ to: "\/bulk-access-denied", replace: true \}\)/);
  assert.match(guard, /navigate\(\{ to: "\/bulk-access-denied", replace: true \}\)/);
  // The guard no longer force-launches the onboarding wizard.
  assert.doesNotMatch(guard, /"\/bulk-onboarding"/);
});

test("the gated fitness screen is an explicit opt-in that preserves Challenge access", async () => {
  const [denied, profile, onboarding] = await Promise.all([
    read("src/routes/_authenticated/bulk-access-denied.tsx"),
    read("src/routes/_authenticated/profile.tsx"),
    read("src/routes/_authenticated/bulk-onboarding.tsx"),
  ]);
  assert.match(denied, /Challenge access is unchanged/); // challenge data/flows preserved
  assert.match(denied, /to="\/bulk-onboarding"/); // explicit action to start fitness setup
  assert.match(profile, /Set up fitness tools/); // upgrade entry from You
  // Completing onboarding creates the plan atomically (so there is no fragile partial state).
  assert.match(onboarding, /complete_goal_onboarding/);
});

test("home resolves by product mode: Challenge-only → Challenge, fitness → Today daily screen", async () => {
  const today = await read("src/routes/_authenticated/today.tsx");
  assert.match(today, /accountProductMode\(memberships\) === "core"[\s\S]*to: "\/challenge"/);
  assert.match(today, /throw redirect\(\{ to: "\/bulk", replace: true \}\)/);
});

// ------------------------------------------- adaptive bottom navigation

import { mainTabForPath, MAIN_TABS, LOG_ACTIONS } from "../src/lib/main-navigation.ts";

test("core bottom nav is Challenge · + · You only; fitness keeps the 5-item bar", async () => {
  const shell = await read("src/components/AppShell.tsx");
  // Mode split: Challenge-only drops Today and Progress and renders a 3-column bar.
  assert.match(shell, /const coreNav = !hasFitnessTools/);
  assert.match(
    shell,
    /leftTabs = coreNav\s*\?\s*MAIN_TABS\.filter\(\(item\) => item\.tab === "challenge"\)\s*:\s*MAIN_TABS\.slice\(0, 2\)/s,
  );
  assert.match(
    shell,
    /rightTabs = coreNav \? MAIN_TABS\.filter\(\(item\) => item\.tab === "you"\) : MAIN_TABS\.slice\(2\)/,
  );
  assert.match(shell, /\$\{coreNav \? "grid-cols-3" : "grid-cols-5"\}/);
  assert.match(shell, /\{leftTabs\.map/);
  assert.match(shell, /\{rightTabs\.map/);
  // The center + stays prominent for both modes.
  assert.match(shell, /h-\[52px\] w-\[52px\] place-items-center rounded-full bg-primary/);
  // Fitness bar still includes Today and Progress.
  assert.deepEqual(
    MAIN_TABS.map((t) => t.tab),
    ["today", "challenge", "progress", "you"],
  );
});

test("core + menu hides fitness-only actions and keeps challenge run/ride", async () => {
  const [shell, sheet] = await Promise.all([
    read("src/components/AppShell.tsx"),
    read("src/components/LogSheet.tsx"),
  ]);
  assert.match(shell, /showFitnessActions=\{hasFitnessTools\}/); // off for core
  assert.match(sheet, /showFitnessActions \? \(/); // gates the "Your day" fitness group
  assert.match(sheet, /Your day/);
  // The run/ride (challenge) group is always available; fitness actions are the hidden "day" group.
  assert.deepEqual(
    LOG_ACTIONS.filter((a) => a.group === "challenge")
      .map((a) => a.key)
      .sort(),
    ["ride", "run"],
  );
  for (const action of LOG_ACTIONS.filter((a) => a.group === "day"))
    assert.match(action.to, /^\/bulk\//); // fitness-only destinations
});

test("active tab: Challenge routes (incl. deep routes) highlight Challenge; profile highlights You", () => {
  assert.equal(mainTabForPath("/challenge"), "challenge");
  assert.equal(mainTabForPath("/challenge/activity/abc"), "challenge");
  assert.equal(mainTabForPath("/challenge/money"), "challenge");
  assert.equal(mainTabForPath("/profile"), "you");
  assert.equal(mainTabForPath("/profile/notifications"), "you");
});

test("fresh Challenge-only user is never prompted into fitness setup anywhere in the core flow", async () => {
  const [onboarding, today, shell, sheet, guard, denied, profile] = await Promise.all([
    read("src/routes/_authenticated/onboarding.tsx"),
    read("src/routes/_authenticated/today.tsx"),
    read("src/components/AppShell.tsx"),
    read("src/components/LogSheet.tsx"),
    read("src/routes/_authenticated/bulk/route.tsx"),
    read("src/routes/_authenticated/bulk-access-denied.tsx"),
    read("src/routes/_authenticated/profile.tsx"),
  ]);

  // (2) Account onboarding finishes to /today and only saves the username — it never navigates
  // into fitness onboarding (the feature list is descriptive copy, not a setup prompt).
  assert.match(onboarding, /completeOnboarding: true/);
  assert.match(onboarding, /navigate\(\{ to: "\/today", replace: true \}\)/);
  assert.doesNotMatch(onboarding, /bulk-onboarding/);
  assert.doesNotMatch(onboarding, /navigate\(\{ to: "\/bulk/);

  // (4) Challenge-only lands on Challenge, not any fitness screen.
  assert.match(today, /accountProductMode\(memberships\) === "core"[\s\S]*to: "\/challenge"/);

  // (5) Every visible core bottom-nav destination is Challenge or You — no Today/Progress/fitness.
  assert.match(shell, /const coreNav = !hasFitnessTools/);
  for (const tab of ["today", "progress"]) {
    const item = MAIN_TABS.find((t) => t.tab === tab);
    assert.match(item.to, /^\/bulk/); // these are the fitness surfaces the core bar omits
  }
  assert.equal(MAIN_TABS.find((t) => t.tab === "challenge").to, "/challenge");
  assert.equal(MAIN_TABS.find((t) => t.tab === "you").to, "/profile");

  // (6) The + menu for core hides meal/weight/workout actions.
  assert.match(sheet, /showFitnessActions \? \(/);

  // No automatic onboarding: the guard gates fitness surfaces, never auto-launches the wizard.
  assert.doesNotMatch(guard, /"\/bulk-onboarding"/);
  assert.match(guard, /redirect\(\{ to: "\/bulk-access-denied", replace: true \}\)/);

  // (7) Fitness setup is only reachable behind an explicit CTA.
  assert.match(profile, /Set up fitness tools/);
  assert.match(denied, /to="\/bulk-onboarding"/);
  assert.match(denied, /Challenge access is unchanged/);
});
