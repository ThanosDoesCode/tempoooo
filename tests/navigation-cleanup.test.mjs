import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { productAreaForPath } from "../src/lib/product-navigation.ts";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("Meals destinations stay route-backed and old More bookmarks recover to Presets", async () => {
  // Meals is no longer a bottom tab, but its routes still resolve and belong to the meals area.
  for (const to of ["/bulk/meals", "/bulk/meals/presets", "/bulk/meals/history"])
    assert.equal(productAreaForPath(to), "meals");
  assert.match(
    await read("src/routes/_authenticated/bulk/meals_.more.tsx"),
    /redirect\(\{ to: "\/bulk\/meals\/presets", replace: true \}\)/,
  );
});

test("Challenge rules and targets consolidate into one Terms screen", async () => {
  const challengeIndex = await read("src/routes/_authenticated/challenge/index.tsx");
  // The week screen links to the single Terms screen and History (in-page rows, no dropdown).
  assert.match(challengeIndex, /to="\/challenge\/terms"/);
  assert.match(challengeIndex, /to="\/challenge\/history"/);
  for (const path of [
    "/challenge/terms",
    "/challenge/terms/override",
    "/challenge/history/week/4",
    "/challenge/money",
  ])
    assert.equal(productAreaForPath(path), "challenge", path);
  // Legacy rules/targets routes redirect into Terms and its override, not duplicate screens.
  assert.match(
    await read("src/routes/_authenticated/challenge/rules.tsx"),
    /redirect\(\{ to: "\/challenge\/terms", replace: true \}\)/,
  );
  assert.match(
    await read("src/routes/_authenticated/challenge/targets.tsx"),
    /redirect\(\{ to: "\/challenge\/terms\/override", replace: true \}\)/,
  );
  const terms = await read("src/routes/_authenticated/challenge/terms.tsx");
  assert.match(terms, /useMyChallenge/);
  assert.match(terms, /TermsCards/);
  assert.match(await read("src/components/challenge-terms-view.tsx"), /If you fall short/);
});

test("diagnostics belongs to You/Profile and retains both admin boundaries", async () => {
  const [profile, progress, route, server] = await Promise.all([
    read("src/routes/_authenticated/profile.tsx"),
    read("src/routes/_authenticated/bulk/progress.tsx"),
    read("src/routes/_authenticated/bulk/diagnostics.tsx"),
    read("src/lib/privileged-rpcs.server.ts"),
  ]);
  assert.doesNotMatch(progress, /Production diagnostics|\/bulk\/diagnostics/);
  assert.match(profile, /\{isAdmin \? \([\s\S]*to: "\/bulk\/diagnostics"/);
  assert.equal(productAreaForPath("/bulk/diagnostics"), "profile");
  assert.match(route, /if \(!isAdmin\) throw redirect/);
  assert.match(server, /\.from\("bulk_admins"\)[\s\S]*\.eq\("user_id", caller\)/);
});

test("Change goal is canonical and preserves reset semantics and legacy recovery routes", async () => {
  const [profile, settings, migration, history, denied] = await Promise.all([
    read("src/routes/_authenticated/profile.tsx"),
    read("src/routes/_authenticated/bulk/more.tsx"),
    read("supabase/migrations/20260908120000_public_goal_mobile_flow_hardening.sql"),
    read("src/routes/_authenticated/bulk/history.tsx"),
    read("src/routes/_authenticated/bulk-access-denied.tsx"),
  ]);
  assert.doesNotMatch(profile, /Reset Goal|deactivatePublicGoal/);
  assert.match(settings, /Change goal/);
  assert.match(settings, /await deactivatePublicGoal\(\)/);
  assert.match(settings, /planMode !== "public"/);
  assert.match(settings, /completed history, account and Challenge data stay safe/);
  const reset = migration.match(
    /CREATE FUNCTION public.deactivate_public_goal\(\)[\s\S]*?\$function\$;/,
  )?.[0];
  assert.match(reset, /DELETE FROM public.bulk_targets/);
  assert.doesNotMatch(
    reset,
    /DELETE FROM public\.(?:bulk_workouts|bulk_days|bulk_training_sessions|challenges|bulk_meal_presets)/,
  );
  assert.match(history, /createFileRoute\("\/_authenticated\/bulk\/history"\)/);
  assert.match(denied, /to="\/bulk-onboarding"/);
});
