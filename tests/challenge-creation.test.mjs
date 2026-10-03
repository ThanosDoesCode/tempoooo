import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("Challenge creation uses the authenticated server function and no browser RPC", async () => {
  const source = await read("src/routes/_authenticated/challenge/new.tsx");
  const createBlock = source.match(/const create = async \(\) => \{[\s\S]*?\n  \};/)?.[0];
  assert.ok(createBlock);
  assert.match(
    source,
    /import \{[^}]*\bcreateChallenge\b[^}]*\} from "@\/lib\/privileged-rpcs\.functions"/,
  );
  assert.match(createBlock, /await createChallenge\(\{\s*data:/);
  assert.match(createBlock, /invitedUsername: normalized/);
  assert.doesNotMatch(createBlock, /invitedEmail|Opponent email|type="email"/);
  assert.doesNotMatch(createBlock, /supabase\.rpc\(\s*"create_challenge_atomic"/);
  assert.doesNotMatch(
    createBlock,
    /\.from\("challenges"\)|\.from\("challenge_members"\)|\.from\("challenge_invitations"\)/,
  );
  assert.doesNotMatch(createBlock, /created_by|user_id/);
  assert.match(createBlock, /creation\.current/);
  assert.match(createBlock, /challengeId !== request\.requestId/);
  // Only the final "Send invite" creates the challenge, then routes to the Waiting state.
  assert.match(createBlock, /navigate\(\{ to: "\/challenge" \}\)/);
  // Phase 3: the length comes from the 4/12/52 selector, never defaulted or forced to 52.
  assert.match(createBlock, /durationWeeks: length/);
  assert.doesNotMatch(source, /Math\.max\(52/);
  for (const field of [
    "weeklyTargetKm",
    "penaltyMode",
    "penaltyHighEur",
    "penaltyMediumEur",
    "penaltyLowEur",
    "penaltyHighCustom",
    "penaltyMediumCustom",
    "penaltyLowCustom",
    "travelPauseEnabled",
    "travelPauseHomeCountries",
  ]) {
    assert.match(createBlock, new RegExp(field));
  }
});

test("server auth supplies caller and privileged RPCs remain service-role only", async () => {
  const [functions, server, implementation, wrapper] = await Promise.all([
    read("src/lib/privileged-rpcs.functions.ts"),
    read("src/lib/privileged-rpcs.server.ts"),
    read("supabase/migrations/20260906203135_29222c8c-372a-43b8-acaa-6b8731640d9b.sql"),
    read("supabase/migrations/20260906203157_29dffced-45c0-45df-ba84-79daadddd328.sql"),
  ]);
  const handler = functions.match(
    /export const createChallenge =[\s\S]*?return createChallengeFor\(context\.userId, data\);\n  \}\);/,
  )?.[0];
  assert.ok(handler);
  assert.match(handler, /middleware\(\[requireSupabaseAuth\]\)/);
  assert.doesNotMatch(handler, /data\.(?:caller|userId|owner)/);
  assert.match(server, /_caller: caller/);
  assert.match(implementation, /caller uuid := _caller/);
  assert.match(implementation, /SECURITY DEFINER[\s\S]*SET search_path TO ''/);
  assert.match(implementation, /pg_advisory_xact_lock/);
  for (const sql of [implementation, wrapper]) {
    assert.match(
      sql,
      /REVOKE ALL ON FUNCTION (?:private|public)\.create_challenge_atomic[\s\S]*FROM PUBLIC, anon, authenticated/,
    );
    assert.match(
      sql,
      /GRANT EXECUTE ON FUNCTION (?:private|public)\.create_challenge_atomic[\s\S]*TO service_role/,
    );
  }
});

test("creator configures terms and invitee reviews them before explicit acceptance", async () => {
  const [create, invitation, rules] = await Promise.all([
    read("src/routes/_authenticated/challenge/new.tsx"),
    read("src/routes/_authenticated/invite.challenge.$token.tsx"),
    read("src/components/challenge-rules.tsx"),
  ]);
  // Phase 3 three-step create flow: who, stakes, then travel + review.
  assert.match(create, /Who are you taking on\?/);
  assert.match(create, /How long\?/);
  assert.match(create, /LENGTHS = \[4, 12, 52\]/);
  assert.match(create, /\{weeks\} weeks/);
  assert.match(create, /Weekly target/);
  assert.match(create, /What’s at stake\?/);
  assert.match(create, /Something else/);
  assert.match(create, /If you finish the week with/);
  assert.match(create, /home countr/i);
  assert.match(create, /Send invite to/);
  assert.match(create, /These terms lock once/);
  assert.match(invitation, /previewChallengeInvitation/);
  assert.match(invitation, /Review the Challenge terms before accepting/);
  assert.match(invitation, /Travel pause/);
  assert.match(invitation, /countryListLabel/);
  assert.match(invitation, /Accept challenge/);
  assert.doesNotMatch(
    invitation.match(/useEffect\([\s\S]*?\}, \[token/)?.[0] ?? "",
    /acceptChallengeInvitation/,
  );
  assert.match(rules, /Penalty bands are one-third and two-thirds/);
  assert.match(rules, /≥ ⅓ target/);
  assert.match(rules, /≥ ⅔ target/);
  assert.match(rules, /Below ⅓ target/);
  assert.doesNotMatch(create, /penaltyMode.*photo|value="photo"/i);
});

test("Create challenge is a focus-screen 3-step flow with an accessible progress indicator", async () => {
  const create = await read("src/routes/_authenticated/challenge/new.tsx");
  // Step lives in the route search param (back/refresh safe), 1..3, defaulting to 1.
  assert.match(create, /validateSearch/);
  assert.match(create, /Route\.useSearch\(\)/);
  assert.match(create, /Step \{step\} of 3/);
  // The start date is derived (next Monday), not a raw user-entered field.
  assert.doesNotMatch(create, /type="date"/);
  assert.doesNotMatch(create, /type="email"/);
  assert.match(create, /startOfWeek\(new Date\(\), \{ weekStartsOn: 1 \}\)/);
});

test("legacy photo-owed display is preserved without becoming a penalty mode", async () => {
  const [sql, challenge, rules] = await Promise.all([
    read("supabase/migrations/20260904170000_add_custom_challenge_penalties.sql"),
    read("src/lib/challenge.ts"),
    read("src/components/challenge-rules.tsx"),
  ]);
  assert.match(sql, /legacy_photo_owed boolean NOT NULL DEFAULT true/);
  assert.match(sql, /ALTER COLUMN legacy_photo_owed SET DEFAULT false/);
  assert.match(sql, /normalized_low_custom, false/);
  assert.match(challenge, /legacyPhotoOwed \? photoText\(euros\) : ""/);
  assert.match(rules, /one photo for every €5/);
  assert.doesNotMatch(sql, /penalty_mode\s*=\s*'photo'/i);
});

test("custom penalties are a forward migration after the applied money-only schema", async () => {
  const [money, custom] = await Promise.all([
    read("supabase/migrations/20260904120000_configurable_challenge_terms.sql"),
    read("supabase/migrations/20260904170000_add_custom_challenge_penalties.sql"),
  ]);
  assert.match(money, /ADD COLUMN penalty_high_eur/);
  assert.match(money, /challenge_penalty_amounts_ck/);
  assert.doesNotMatch(money, /penalty_mode|legacy_photo_owed|penalty_high_custom/);
  assert.match(custom, /ADD COLUMN penalty_mode text NOT NULL DEFAULT 'money'/);
  assert.match(custom, /ADD COLUMN legacy_photo_owed boolean NOT NULL DEFAULT true/);
  assert.match(custom, /ALTER COLUMN legacy_photo_owed SET DEFAULT false/);
  assert.doesNotMatch(custom, /ADD COLUMN penalty_(?:high|medium|low)_eur/);
  assert.doesNotMatch(custom, /ADD CONSTRAINT challenge_penalty_amounts_ck/);
  assert.doesNotMatch(custom, /DROP CONSTRAINT challenge_target_ck/);
});

test("travel terms are an incremental migration after money and custom penalties", async () => {
  const [travel, countries] = await Promise.all([
    read("supabase/migrations/20260904180000_configurable_travel_pause_terms.sql"),
    read("src/lib/countries.ts"),
  ]);
  assert.match(travel, /ADD COLUMN travel_pause_enabled boolean NOT NULL DEFAULT true/);
  assert.match(
    travel,
    /ADD COLUMN travel_pause_home_countries text\[\] NOT NULL DEFAULT ARRAY\['GR', 'SE'\]/,
  );
  assert.match(travel, /private\.valid_travel_pause_countries/);
  assert.match(travel, /normalized_home_countries/);
  assert.match(travel, /travel_pause_enabled IS DISTINCT FROM/);
  assert.doesNotMatch(travel, /ADD COLUMN weekly_target_km|ADD COLUMN penalty_high_eur/);
  assert.doesNotMatch(travel, /UPDATE public\.challenge_weeks|DELETE FROM public\.challenge_weeks/);
  const countryCodes =
    countries
      .match(/`([\s\S]*?)`/)?.[1]
      .trim()
      .split(/\s+/) ?? [];
  assert.equal(countryCodes.length, 249);
  assert.equal(new Set(countryCodes).size, 249);
  for (const code of countryCodes) assert.match(travel, new RegExp(`'${code}'`));
});
