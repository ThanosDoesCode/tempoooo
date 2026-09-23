import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("account deletion is authenticated, deletes only context.userId and releases profile ownership", async () => {
  const [functions, server, profile, migration] = await Promise.all([
    read("src/lib/privileged-rpcs.functions.ts"),
    read("src/lib/privileged-rpcs.server.ts"),
    read("src/routes/_authenticated/profile.tsx"),
    read("supabase/migrations/20260919120000_account_deletion_and_in_app_challenge_invites.sql"),
  ]);
  const boundary =
    functions.match(
      /export const deleteTempoAccount[\s\S]*?return \{ deleted: true \};\n  \}\);/,
    )?.[0] ?? "";
  assert.match(boundary, /middleware\(\[requireSupabaseAuth\]\)/);
  assert.match(boundary, /deleteTempoAccountFor\(context\.userId\)/);
  assert.doesNotMatch(boundary, /userId.*data|caller.*data/);
  assert.match(server, /auth\.admin\.deleteUser\(caller\)/);
  assert.match(migration, /profiles_auth_user_fkey[\s\S]*ON DELETE CASCADE/);
  assert.match(migration, /bulk_profiles_owner_profile_fkey[\s\S]*ON DELETE CASCADE/);
  assert.match(profile, /Delete account[\s\S]*Delete my account/);
  assert.match(profile, /confirmation: "Delete my account"/);
});

test("in-app Challenge invitations expose no secret or email and stay service-role only", async () => {
  const [migration, functions, component, shell] = await Promise.all([
    read("supabase/migrations/20260919120000_account_deletion_and_in_app_challenge_invites.sql"),
    read("src/lib/privileged-rpcs.functions.ts"),
    read("src/components/ChallengeInvitations.tsx"),
    read("src/components/AppShell.tsx"),
  ]);
  const listing =
    migration.match(
      /CREATE FUNCTION public\.list_my_challenge_invitations[\s\S]*?\$function\$;/,
    )?.[0] ?? "";
  assert.match(listing, /invitation\.invited_user_id = _caller/);
  assert.doesNotMatch(listing, /token_hash|invited_email/);
  for (const name of [
    "search_challenge_invite_users",
    "send_challenge_username_invitation",
    "list_my_challenge_invitations",
    "accept_challenge_invitation_by_id",
    "decline_challenge_invitation",
  ]) {
    assert.match(
      migration,
      new RegExp(
        `REVOKE ALL ON FUNCTION public\\.${name}[\\s\\S]*FROM PUBLIC, anon, authenticated`,
      ),
    );
    assert.match(
      migration,
      new RegExp(`GRANT EXECUTE ON FUNCTION public\\.${name}[\\s\\S]*TO service_role`),
    );
  }
  assert.match(functions, /acceptChallengeInvitationById[\s\S]*context\.userId/);
  assert.match(functions, /declineChallengeInvitation[\s\S]*context\.userId/);
  assert.match(component, /Accept/);
  assert.match(component, /Decline/);
  assert.match(shell, /pendingInvitations\.data\?\.length/);
  assert.match(shell, /pending Challenge invitations/);
});

test("legacy owner Goal conversion preserves source data and seeds owned presets once", async () => {
  const [migration, presetsRoute] = await Promise.all([
    read("supabase/migrations/20260919130000_unify_goal_and_migrate_legacy_meals.sql"),
    read("src/routes/_authenticated/bulk/meals_.presets.tsx"),
  ]);
  assert.match(migration, /SET goal_status = 'active'/);
  assert.match(migration, /JOIN public\.bulk_admins/);
  assert.match(migration, /WHERE profile\.goal_status IS NULL/);
  assert.match(migration, /cohort_size > 1/);
  assert.match(migration, /ADD COLUMN IF NOT EXISTS source_key/);
  assert.match(migration, /CREATE UNIQUE INDEX IF NOT EXISTS/);
  assert.match(migration, /bulk_meal_presets_profile_source_uidx/);
  assert.match(migration, /'legacy:beef'/);
  assert.match(migration, /'legacy:lentil'/);
  assert.match(migration, /'legacy:kebab'/);
  assert.match(migration, /'legacy:salmon'/);
  assert.match(migration, /existing\.source_key = preset\.source_key/);
  assert.match(migration, /legacyExerciseDefinitions/);
  assert.match(migration, /legacyExerciseOrder/);
  assert.doesNotMatch(
    migration,
    /DELETE FROM public\.(bulk_days|bulk_workouts|bulk_photos|bulk_weight_entries|bulk_training_sessions)/,
  );
  assert.doesNotMatch(presetsRoute, /LegacyMealPresets|MEAL_PLANS/);
});

test("active workout exercise cards collapse without removing draft state", async () => {
  const source = await read("src/components/BulkWorkoutSession.tsx");
  assert.match(source, /collapsedExercises/);
  assert.match(source, /aria-expanded=\{!collapsedExercises\.has\(exercise\.id\)\}/);
  assert.match(source, /hidden=\{collapsedExercises\.has\(exercise\.id\)\}/);
  assert.match(source, /sets logged/);
  assert.match(source, /latestDraftLabel\(exercise, drafts\)/);
  assert.match(
    source,
    /onClick=\{\(\) => \{[\s\S]*setOpenSetId\(null\);[\s\S]*setCollapsedExercises/,
  );
  assert.match(source, /motion-reduce:transition-none/);
});
