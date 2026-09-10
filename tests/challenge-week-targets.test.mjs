import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("future weekly targets cross the authenticated server boundary without a browser RPC", async () => {
  const [route, functions, server, migration] = await Promise.all([
    read("src/routes/_authenticated/challenge/targets.tsx"),
    read("src/lib/privileged-rpcs.functions.ts"),
    read("src/lib/privileged-rpcs.server.ts"),
    read("supabase/migrations/20260907120000_secure_future_challenge_targets.sql"),
  ]);

  assert.match(route, /setChallengeWeekTarget\(\{ data:/);
  assert.doesNotMatch(route, /supabase\.rpc\(/);
  assert.match(route, /firstFuture = Math\.max\(1, currentWeek \+ 1\)/);
  assert.match(route, /Only the Challenge creator can change them/);
  assert.match(functions, /setChallengeWeekTarget = createServerFn/);
  assert.match(functions, /middleware\(\[requireSupabaseAuth\]\)/);
  assert.match(functions, /setChallengeWeekTargetFor\(context\.userId, data\)/);
  assert.match(server, /setChallengeWeekTargetFor/);
  assert.match(server, /_caller: caller/);
  assert.match(migration, /SECURITY DEFINER[\s\S]*SET search_path = ''/);
  assert.match(migration, /created_by <> _caller/);
  assert.match(migration, /Only future week targets can be changed/);
  assert.match(migration, /target_km BETWEEN 1 AND 500/);
  assert.match(migration, /round\(target_km, 2\) = target_km/);
  assert.match(
    migration,
    /REVOKE ALL ON FUNCTION public\.set_challenge_week_target[\s\S]*FROM PUBLIC, anon, authenticated/,
  );
  assert.match(
    migration,
    /GRANT EXECUTE ON FUNCTION public\.set_challenge_week_target[\s\S]*TO service_role/,
  );
});

test("resolved targets consistently prioritize pause, override and base terms", async () => {
  const [migration, challenge, week, money, exporter] = await Promise.all([
    read("supabase/migrations/20260907120000_secure_future_challenge_targets.sql"),
    read("src/lib/challenge.ts"),
    read("src/routes/_authenticated/challenge/index.tsx"),
    read("src/routes/_authenticated/challenge/payments.tsx"),
    read("src/lib/challenge-export.ts"),
  ]);

  assert.match(
    migration,
    /WHEN private\.challenge_week_paused\(_c, _u, _w\) THEN 0[\s\S]*ELSE private\.target_for_week\(_c, _w\)/,
  );
  assert.match(migration, /coalesce\(target\.target_km, challenge\.weekly_target_km\)/);
  assert.match(challenge, /resolvedTargetForWeek/);
  assert.match(week, /resolvedTargetForWeek/);
  assert.match(money, /useWeekTargets/);
  assert.match(exporter, /week_target_override/);
  assert.match(exporter, /finalized\?\.target_km/);
});

test("finalized History links to a read-only member-scoped week view", async () => {
  const [history, detail, router] = await Promise.all([
    read("src/routes/_authenticated/challenge/history.tsx"),
    read("src/routes/_authenticated/challenge/history_.week.$weekNumber.tsx"),
    read("src/router.tsx"),
  ]);

  assert.match(history, /to="\/challenge\/history\/week\/\$weekNumber"/);
  assert.match(history, /resetScroll=\{false\}/);
  assert.match(detail, /Finalized and read-only/);
  assert.match(detail, /weekRows\.map/);
  assert.match(detail, /Qualified/);
  assert.match(detail, /Evidence expired after finalization/);
  assert.match(detail, /activity\.evidence_expired_at \?/);
  assert.match(detail, /ChallengeEvidenceViewer paths=\{evidencePaths\}/);
  assert.match(detail, /router\.history\.back\(\)/);
  assert.doesNotMatch(detail, /\.insert\(|\.update\(|\.delete\(|window\.location/);
  assert.match(router, /scrollRestoration: true/);
});

test("public Goal migration defaults existing public plans while leaving legacy My Bulk records alone", async () => {
  const [migration, shell, profile, onboarding] = await Promise.all([
    read("supabase/migrations/20260907130000_public_goal_modes.sql"),
    read("src/components/AppShell.tsx"),
    read("src/routes/_authenticated/profile.tsx"),
    read("src/routes/_authenticated/bulk-onboarding.tsx"),
  ]);

  assert.match(migration, /WHERE payload \? 'trainingSetupPreference' AND NOT payload \? 'goal'/);
  assert.match(migration, /'goal', _goal/);
  assert.match(migration, /_goal text/);
  assert.match(migration, /auth\.uid\(\)/);
  assert.match(migration, /payload->>'goal' IN \('gain', 'cut', 'maintain'\)/);
  assert.match(shell, /to: PRODUCT_LANDING_ROUTES\.goal/);
  assert.doesNotMatch(shell, /label: "Bulk"/);
  assert.match(profile, /productMode === "public"/);
  assert.match(profile, /productMode === "legacy"/);
  assert.match(profile, /Fitness Goal/);
  assert.match(profile, /My Bulk Plan/);
  assert.match(onboarding, /Review your Goal plan/);
  assert.doesNotMatch(onboarding, /Review your Bulk plan/);
});
