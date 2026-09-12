import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("unauthenticated home is a compact Tempo welcome with signup and sign-in paths", async () => {
  const home = await read("src/routes/index.tsx");
  assert.match(home, /Build consistency\. See progress\./);
  assert.match(home, /Set a shared weekly target/);
  assert.match(home, /Track qualifying runs and rides/);
  assert.match(home, /Add optional fitness tools whenever you want/);
  assert.match(home, /Get started/);
  assert.match(home, /search=\{\{ mode: "signup" \}\}/);
  assert.match(home, /Sign in/);
  assert.doesNotMatch(home, /data\.session \? "\/challenge" : "\/auth"/);
});

test("account onboarding is separate from Goal activation and guarded by persisted profile state", async () => {
  const [route, onboarding] = await Promise.all([
    read("src/routes/_authenticated/route.tsx"),
    read("src/routes/_authenticated/onboarding.tsx"),
  ]);
  assert.match(route, /accountProfileQueryOptions\(user\.id\)/);
  assert.match(route, /!profile\?\.account_onboarded_at \|\| !profile\.username/);
  assert.match(route, /location\.pathname !== "\/onboarding"/);
  assert.match(onboarding, /Welcome to Tempo/);
  assert.match(onboarding, /Choose your username/);
  assert.match(onboarding, /Stay consistent with someone else/);
  assert.match(onboarding, /Start a Challenge now/);
  assert.match(onboarding, /activate Fitness tools anytime from Profile/);
  assert.match(onboarding, /Start Tempo/);
  assert.doesNotMatch(onboarding, /complete_goal_onboarding|bulk_profiles|bulk_members/);
});

test("username availability is debounced and completion uses the authenticated server boundary", async () => {
  const [onboarding, profile, functions] = await Promise.all([
    read("src/routes/_authenticated/onboarding.tsx"),
    read("src/routes/_authenticated/profile.tsx"),
    read("src/lib/privileged-rpcs.functions.ts"),
  ]);
  assert.match(onboarding, /window\.setTimeout\([\s\S]*350/);
  assert.match(onboarding, /@\{normalized\} is available/);
  assert.match(onboarding, /@\{normalized\} is already taken/);
  assert.match(profile, /checkUsernameAvailability/);
  assert.match(profile, /saveAccountUsername/);
  assert.match(functions, /checkUsernameAvailability[\s\S]*requireSupabaseAuth/);
  assert.match(functions, /saveAccountUsername[\s\S]*context\.userId/);
  assert.doesNotMatch(functions, /data\.(?:userId|caller|owner)/);
});

test("migration backfills established users without touching Goal, Bulk or Challenge history", async () => {
  const migration = await read(
    "supabase/migrations/20260909120000_account_onboarding_usernames.sql",
  );
  assert.match(migration, /ADD COLUMN username text/);
  assert.match(migration, /ADD COLUMN account_onboarded_at timestamptz/);
  assert.match(
    migration,
    /INSERT INTO public\.profiles\(id, account_onboarded_at\)[\s\S]*FROM auth\.users/,
  );
  assert.match(migration, /ON CONFLICT \(id\) DO UPDATE[\s\S]*coalesce/);
  assert.match(migration, /CREATE UNIQUE INDEX profiles_username_unique_ci/);
  assert.match(migration, /\^\[a-z0-9_\]\{3,20\}\$/);
  const schemaBackfill = migration.slice(
    0,
    migration.indexOf("ALTER TABLE public.challenge_invitations"),
  );
  assert.doesNotMatch(schemaBackfill, /UPDATE public\.(?:bulk_|challenge_|challenges)/);
  assert.doesNotMatch(schemaBackfill, /DELETE FROM public\./);
});

test("profile bootstrap upsert has the minimum column grants and remains self-only", async () => {
  const [initial, onboarding, repair, auth] = await Promise.all([
    read("supabase/migrations/20260814022015_2e6c5c26-4d84-4ec5-a74b-36c614623b97.sql"),
    read("supabase/migrations/20260909120000_account_onboarding_usernames.sql"),
    read("supabase/migrations/20260912120000_restore_profile_bootstrap_upsert.sql"),
    read("src/lib/auth.ts"),
  ]);

  assert.match(initial, /alter table public\.profiles enable row level security/i);
  assert.match(initial, /profiles self insert[\s\S]*with check \(id = auth\.uid\(\)\)/i);
  assert.match(
    initial,
    /profiles self update[\s\S]*using \(id = auth\.uid\(\)\)[\s\S]*with check \(id = auth\.uid\(\)\)/i,
  );
  assert.match(initial, /profiles self read[\s\S]*using \(id = auth\.uid\(\)\)/i);
  assert.match(onboarding, /REVOKE INSERT, UPDATE ON public\.profiles FROM authenticated/);
  assert.match(
    onboarding,
    /GRANT INSERT\(id, email, display_name, avatar_url\) ON public\.profiles TO authenticated/,
  );
  assert.match(repair, /GRANT UPDATE \(id\) ON public\.profiles TO authenticated/);
  assert.doesNotMatch(repair, /GRANT (?:ALL|UPDATE) ON public\.profiles/i);
  assert.doesNotMatch(repair, /DISABLE ROW LEVEL SECURITY|DROP POLICY/i);
  assert.match(auth, /from\("profiles"\)\.upsert\(\{[\s\S]*id: user\.id/);
});

test("new Challenge invitations use username resolution and immutable UUID relationships", async () => {
  const [create, invite, functions, server, migration] = await Promise.all([
    read("src/routes/_authenticated/challenge/new.tsx"),
    read("src/components/ChallengeInvite.tsx"),
    read("src/lib/privileged-rpcs.functions.ts"),
    read("src/lib/privileged-rpcs.server.ts"),
    read("supabase/migrations/20260909120000_account_onboarding_usernames.sql"),
  ]);
  assert.match(create, /invitedUsername: normalizeUsername\(username\)/);
  assert.match(create, /placeholder="Search username"/);
  assert.doesNotMatch(create, /Opponent email|invitedEmail|type="email"/);
  assert.match(invite, /createChallengeInvitation/);
  assert.doesNotMatch(invite, /\.from\("challenge_invitations"\)\.insert/);
  assert.doesNotMatch(invite, /Opponent email|friend@email/);
  assert.match(functions, /createChallengeInvitation[\s\S]*requireSupabaseAuth/);
  assert.match(server, /_caller: caller[\s\S]*_invited_username: input\.username/);
  assert.match(migration, /invited_user_id uuid REFERENCES public\.profiles\(id\)/);
  assert.match(migration, /invited_username_snapshot/);
  assert.match(migration, /invited_user_id = invited_user/);
  assert.match(migration, /invited_user_id <> _caller/);
  assert.match(
    migration,
    /REVOKE INSERT, UPDATE, DELETE ON public\.challenge_invitations FROM authenticated/,
  );
});

test("username lookup exposes only an exact boolean and privileged RPCs stay service-role-only", async () => {
  const migration = await read(
    "supabase/migrations/20260909120000_account_onboarding_usernames.sql",
  );
  assert.match(migration, /RETURNS boolean[\s\S]*NOT EXISTS/);
  assert.doesNotMatch(
    migration.match(
      /CREATE OR REPLACE FUNCTION public\.username_available[\s\S]*?\$function\$;/,
    )?.[0] ?? "",
    /email|display_name|avatar_url|RETURNS TABLE/,
  );
  for (const name of ["username_available", "set_account_username", "create_challenge_invitation"])
    assert.match(
      migration,
      new RegExp(
        `REVOKE ALL ON FUNCTION public\\.${name}[\\s\\S]*FROM PUBLIC, anon, authenticated`,
      ),
    );
  assert.match(
    migration,
    /GRANT EXECUTE ON FUNCTION public\.username_available[\s\S]*TO service_role/,
  );
});
