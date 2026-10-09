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
