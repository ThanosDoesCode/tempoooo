import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("Challenge creation uses the authenticated server function and no browser RPC", async () => {
  const source = await read("src/routes/_authenticated/challenge/new.tsx");
  const createBlock = source.match(/const create = async \(\) => \{[\s\S]*?\n  \};/)?.[0];
  assert.ok(createBlock);
  assert.match(source, /import \{ createChallenge \} from "@\/lib\/privileged-rpcs\.functions"/);
  assert.match(createBlock, /await createChallenge\(\{\s*data:/);
  assert.doesNotMatch(createBlock, /supabase\.rpc\(\s*"create_challenge_atomic"/);
  assert.doesNotMatch(
    createBlock,
    /\.from\("challenges"\)|\.from\("challenge_members"\)|\.from\("challenge_invitations"\)/,
  );
  assert.doesNotMatch(createBlock, /created_by|user_id/);
  assert.match(createBlock, /creation\.current/);
  assert.match(createBlock, /challengeId !== request\.requestId/);
  assert.match(createBlock, /setLink[\s\S]*request\.token/);
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
  assert.match(create, /Weekly target \(challenge km\)/);
  assert.match(create, /Penalty mode/);
  assert.match(create, /Travel pause/);
  assert.match(create, /home countr/i);
  assert.match(create, /<select/);
  assert.match(create, /Weekly money penalties/);
  assert.match(create, /Custom consequences/);
  assert.match(create, /High shortfall/);
  assert.match(create, /Live penalty summary/);
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

test("mobile date inputs shrink inside the Challenge creation card without replacing the native picker", async () => {
  const create = await read("src/routes/_authenticated/challenge/new.tsx");
  assert.match(create, /block min-w-0 w-full max-w-full/);
  assert.match(create, /type="date"[\s\S]*?className=\{inputCls\}/);
  assert.doesNotMatch(create, /appearance-none|overflow-hidden/);
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
