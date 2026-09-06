import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { clearAccountScopedBrowserData } from "../src/lib/browser-data.ts";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

function storage(entries) {
  const values = new Map(Object.entries(entries));
  return {
    get length() {
      return values.size;
    },
    key(index) {
      return [...values.keys()][index] ?? null;
    },
    removeItem(key) {
      values.delete(key);
    },
    has(key) {
      return values.has(key);
    },
  };
}

test("real account changes clear private drafts without deleting auth or push state", () => {
  const local = storage({
    "tempo:bulk-workout-draft:profile-a:session-a": "private sets",
    "training-draft:user-a:profile-a:2026-09-06": "private workout",
    "challenge-push-device": "provider reconciliation marker",
    "sb-project-auth-token": "managed by Supabase",
    "unrelated-preference": "keep",
  });
  const session = storage({
    "challenge-activity-draft:user-a:challenge-a": "private activity",
    "unrelated-session-state": "keep",
  });

  clearAccountScopedBrowserData(local, session);

  assert.equal(local.has("tempo:bulk-workout-draft:profile-a:session-a"), false);
  assert.equal(local.has("training-draft:user-a:profile-a:2026-09-06"), false);
  assert.equal(session.has("challenge-activity-draft:user-a:challenge-a"), false);
  assert.equal(local.has("challenge-push-device"), true);
  assert.equal(local.has("sb-project-auth-token"), true);
  assert.equal(local.has("unrelated-preference"), true);
  assert.equal(session.has("unrelated-session-state"), true);
});

test("account cleanup runs only after a real identity change", async () => {
  const [root, cancellation, auth] = await Promise.all([
    read("src/routes/__root.tsx"),
    read("src/lib/query-cancellation.ts"),
    read("src/lib/auth.ts"),
  ]);
  assert.match(root, /authenticatedUserChanged[\s\S]*clearAccountScopedBrowserData\(\)/);
  assert.match(cancellation, /previousUserId !== undefined && previousUserId !== nextUserId/);
  assert.match(auth, /supabase\.auth\.signOut\(\)[\s\S]*clearAccountScopedBrowserData\(\)/);
});

test("authentication fields are labelled and use iOS-safe text sizing", async () => {
  const auth = await read("src/routes/auth.tsx");
  assert.match(auth, /htmlFor="auth-email"[\s\S]*id="auth-email"/);
  assert.match(auth, /htmlFor="auth-password"[\s\S]*id="auth-password"/);
  assert.match(auth, /id="auth-email"[\s\S]*text-base/);
  assert.match(auth, /id="auth-password"[\s\S]*text-base/);
});

test("legacy Bulk date, photo and backup actions meet the mobile touch target", async () => {
  const [checkIn, progress] = await Promise.all([
    read("src/routes/_authenticated/bulk/check-in.tsx"),
    read("src/routes/_authenticated/bulk/progress.tsx"),
  ]);
  assert.match(checkIn, /setWeekOffset\(\(w\) => w - 1\)[\s\S]*min-h-11/);
  assert.match(checkIn, /Math\.min\(0, w \+ 1\)[\s\S]*min-h-11/);
  assert.match(progress, /onClick=\{addSet\}[\s\S]*min-h-11/);
  assert.match(progress, /onClick=\{exportBackup\}[\s\S]*min-h-11/);
  assert.match(progress, /Confirm delete[\s\S]*Delete/);
});

test("production headers add conservative hardening without an untested CSP", async () => {
  const headers = await read("public/_headers");
  assert.match(headers, /X-Content-Type-Options: nosniff/);
  assert.match(headers, /Referrer-Policy: strict-origin-when-cross-origin/);
  assert.match(headers, /Permissions-Policy:/);
  assert.doesNotMatch(headers, /Content-Security-Policy|Strict-Transport-Security|X-Frame-Options/);
});

test("release validation bounds modified-client Challenge text and evidence input", async () => {
  const [migration, activity] = await Promise.all([
    read("supabase/migrations/20260906235900_release_validation_hardening.sql"),
    read("src/routes/_authenticated/challenge/log.tsx"),
  ]);
  assert.match(migration, /char_length\(note\) <= 500/);
  assert.match(migration, /cardinality\(extra_evidence_paths\) <= 3/);
  assert.match(migration, /char_length\(evidence_path\) <= 500/);
  assert.match(migration, /challenge_payments_evidence_path_length_ck/);
  assert.match(migration, /NOT VALID/);
  assert.match(activity, /const MAX_EVIDENCE_FILES = 4/);
  assert.match(activity, /const MAX_EVIDENCE_FILE_BYTES = 15 \* 1024 \* 1024/);
  assert.match(activity, /maxLength=\{500\}/);
  assert.match(activity, /aria-label=\{`Remove evidence screenshot \$\{i \+ 1\}`\}/);
});
