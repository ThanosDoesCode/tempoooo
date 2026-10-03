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

test("Challenge Rules and Targets have independent route-backed destinations", async () => {
  const challengeIndex = await read("src/routes/_authenticated/challenge/index.tsx");
  // Reached from in-page rows (Challenge tab) now, not from a top dropdown.
  assert.match(challengeIndex, /to: "\/challenge\/rules"/);
  assert.match(challengeIndex, /to: "\/challenge\/history"/);
  for (const path of [
    "/challenge/rules",
    "/challenge/targets",
    "/challenge/history/week/4",
    "/challenge/payments",
  ])
    assert.equal(productAreaForPath(path), "challenge", path);
  const rules = await read("src/routes/_authenticated/challenge/rules.tsx");
  assert.match(rules, /useMyChallenge/);
  assert.match(rules, /RulesCard terms=\{query.data\}/);
  assert.doesNotMatch(await read("src/routes/_authenticated/challenge/payments.tsx"), /<RulesCard/);
});

test("diagnostics belongs to You/Profile and retains both admin boundaries", async () => {
  const [profile, progress, route, server] = await Promise.all([
    read("src/routes/_authenticated/profile.tsx"),
    read("src/routes/_authenticated/bulk/progress.tsx"),
    read("src/routes/_authenticated/bulk/diagnostics.tsx"),
    read("src/lib/privileged-rpcs.server.ts"),
  ]);
  assert.doesNotMatch(progress, /Production diagnostics|\/bulk\/diagnostics/);
  assert.match(profile, /\{isAdmin \? \([\s\S]*to="\/bulk\/diagnostics"/);
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
