import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { safeStravaUrl } from "../src/lib/safe-url.ts";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("Challenge external links allow only bounded HTTPS Strava destinations", () => {
  assert.equal(
    safeStravaUrl("https://www.strava.com/activities/123"),
    "https://www.strava.com/activities/123",
  );
  assert.equal(safeStravaUrl("https://strava.app.link/example"), "https://strava.app.link/example");
  for (const unsafe of [
    "javascript:alert(1)",
    "data:text/html,unsafe",
    "http://www.strava.com/activities/123",
    "https://strava.com.example.test/activities/123",
    "https://example.test/strava",
    "not a url",
    `https://www.strava.com/${"x".repeat(2048)}`,
  ])
    assert.equal(safeStravaUrl(unsafe), null, unsafe);
});

test("auth destinations, peer profiles and rendered activity links minimize sensitive data", async () => {
  const [auth, challenge, activity, serverRpc] = await Promise.all([
    read("src/routes/auth.tsx"),
    read("src/lib/challenge.ts"),
    read("src/routes/_authenticated/challenge/index.tsx"),
    read("src/lib/privileged-rpcs.server.ts"),
  ]);
  assert.doesNotMatch(auth, /post-auth-path/);
  assert.match(auth, /navigate\(\{ to: "\/challenge", replace: true \}\)/);
  assert.doesNotMatch(challenge, /p\.email/);
  assert.match(activity, /safeStravaUrl/);
  assert.match(serverRpc, /return profiles\.map\(\(\{ id, display_name \}\)/);
});

test("security migration narrows grants and forces upload buckets private", async () => {
  const migration = await read("supabase/migrations/20260906190000_security_audit_hardening.sql");
  assert.match(migration, /ci update own/);
  assert.match(migration, /created_by = \(SELECT auth\.uid\(\)\)/);
  assert.match(migration, /SET search_path = ''/);
  assert.match(migration, /REVOKE ALL ON FUNCTION public\.challenge_today/);
  assert.match(migration, /NULL::text/);
  assert.match(migration, /challenge_activities_external_url_security_ck/);
  assert.match(migration, /UPDATE storage\.buckets\s+SET public = false/);
});
