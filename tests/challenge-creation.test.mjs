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
});

test("atomic RPC derives its owner, locks search_path and exposes minimum privilege", async () => {
  const sql = await read("supabase/migrations/20260903120000_create_challenge_atomic.sql");
  assert.match(sql, /caller uuid := auth\.uid\(\)/);
  assert.match(sql, /SECURITY DEFINER[\s\S]*SET search_path = ''/);
  assert.match(sql, /pg_advisory_xact_lock/);
  assert.match(sql, /REVOKE ALL[\s\S]*FROM PUBLIC, anon, service_role/);
  assert.match(sql, /GRANT EXECUTE[\s\S]*TO authenticated/);
  assert.doesNotMatch(
    sql.match(/CREATE FUNCTION[\s\S]*?RETURNS uuid/)?.[0] ?? "",
    /_caller|_owner|_user/,
  );
});
