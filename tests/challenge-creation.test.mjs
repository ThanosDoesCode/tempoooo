import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("Challenge creation uses one authenticated atomic RPC", async () => {
  const source = await read("src/routes/_authenticated/challenge/new.tsx");
  const createBlock = source.match(/const create = async \(\) => \{[\s\S]*?\n  \};/)?.[0];
  assert.ok(createBlock);
  assert.match(createBlock, /supabase\.rpc\(\s*"create_challenge_atomic"/);
  assert.doesNotMatch(
    createBlock,
    /\.from\("challenges"\)|\.from\("challenge_members"\)|\.from\("challenge_invitations"\)/,
  );
  assert.doesNotMatch(createBlock, /created_by|user_id/);
  assert.match(createBlock, /creation\.current/);
  assert.match(createBlock, /challengeId !== request\.requestId/);
  assert.match(createBlock, /setLink[\s\S]*request\.token/);
  for (const field of [
    "_weekly_target_km",
    "_penalty_mode",
    "_penalty_high_eur",
    "_penalty_medium_eur",
    "_penalty_low_eur",
    "_penalty_high_custom",
    "_penalty_medium_custom",
    "_penalty_low_custom",
  ]) {
    assert.match(createBlock, new RegExp(field));
  }
});

test("atomic RPC derives its owner, locks search_path and exposes minimum privilege", async () => {
  const sql = await read("supabase/migrations/20260904170000_add_custom_challenge_penalties.sql");
  const create = sql.match(/CREATE FUNCTION public\.create_challenge_atomic\([\s\S]*?\n\$\$;/)?.[0];
  assert.ok(create);
  assert.match(create, /caller uuid := auth\.uid\(\)/);
  assert.match(create, /SECURITY DEFINER[\s\S]*SET search_path = ''/);
  assert.match(create, /pg_advisory_xact_lock/);
  assert.match(
    sql,
    /REVOKE ALL ON FUNCTION public\.create_challenge_atomic[\s\S]*FROM PUBLIC, anon, service_role/,
  );
  assert.match(
    sql,
    /GRANT EXECUTE ON FUNCTION public\.create_challenge_atomic[\s\S]*TO authenticated/,
  );
  assert.doesNotMatch(create, /_caller|_owner|_user/);
});

test("creator configures terms and invitee reviews them before explicit acceptance", async () => {
  const [create, invitation, rules] = await Promise.all([
    read("src/routes/_authenticated/challenge/new.tsx"),
    read("src/routes/_authenticated/invite.challenge.$token.tsx"),
    read("src/components/challenge-rules.tsx"),
  ]);
  assert.match(create, /Weekly target \(challenge km\)/);
  assert.match(create, /Penalty mode/);
  assert.match(create, /Weekly money penalties/);
  assert.match(create, /Custom consequences/);
  assert.match(create, /High shortfall/);
  assert.match(create, /Live penalty summary/);
  assert.match(invitation, /previewChallengeInvitation/);
  assert.match(invitation, /Review the Challenge terms before accepting/);
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
