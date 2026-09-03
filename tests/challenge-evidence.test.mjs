import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  EVIDENCE_MAX_WIDTH,
  EVIDENCE_TARGET_BYTES,
  EVIDENCE_WEBP_QUALITY,
  evidenceDimensions,
  evidenceWeekFinalized,
  optimizeEvidenceImage,
} from "../src/lib/challenge-evidence.ts";
import { runEvidenceCleanupBatch } from "../supabase/functions/_shared/evidence-cleanup.ts";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("evidence dimensions preserve aspect ratio without upscaling", () => {
  assert.deepEqual(evidenceDimensions(3200, 1800), { width: 1600, height: 900 });
  assert.deepEqual(evidenceDimensions(800, 1200), { width: 800, height: 1200 });
});

test("evidence optimization starts at WebP quality 0.72 and targets one megabyte", async () => {
  const rendered = [];
  const qualities = [];
  const original = new File([new Uint8Array(2_000_000)], "screenshot.png", {
    type: "image/png",
    lastModified: 123,
  });
  const optimized = await optimizeEvidenceImage(original, {
    decode: async () => ({
      width: 3200,
      height: 1800,
      draw: (_canvas, width, height) => rendered.push([width, height]),
      close: () => {},
    }),
    createCanvas: (width, height) => ({ width, height }),
    encodeWebp: async (_canvas, quality) => {
      qualities.push(quality);
      const size = quality === EVIDENCE_WEBP_QUALITY ? 900_000 : 700_000;
      return new Blob([new Uint8Array(size)], { type: "image/webp" });
    },
  });

  assert.equal(EVIDENCE_MAX_WIDTH, 1600);
  assert.equal(EVIDENCE_TARGET_BYTES, 1024 * 1024);
  assert.deepEqual(rendered[0], [1600, 900]);
  assert.equal(qualities[0], 0.72);
  assert.equal(optimized.type, "image/webp");
  assert.equal(optimized.name, "screenshot.webp");
  assert.ok(optimized.size <= EVIDENCE_TARGET_BYTES);
});

test("failed WebP conversion returns the selected original evidence", async () => {
  const original = new File(["selected evidence"], "evidence.jpg", { type: "image/jpeg" });
  const result = await optimizeEvidenceImage(original, {
    decode: async () => {
      throw new Error("unsupported image");
    },
    createCanvas: () => ({}),
    encodeWebp: async () => null,
  });
  assert.equal(result, original);
});

test("only activities with an immutable finalized-week row are expired", () => {
  const activity = { user_id: "athlete", activity_date: "2026-09-02" };
  assert.equal(evidenceWeekFinalized(activity, []), false);
  assert.equal(
    evidenceWeekFinalized(activity, [
      { user_id: "other", week_start: "2026-08-31", week_end: "2026-09-06" },
    ]),
    false,
  );
  assert.equal(
    evidenceWeekFinalized(activity, [
      { user_id: "athlete", week_start: "2026-08-31", week_end: "2026-09-06" },
    ]),
    true,
  );
});

test("cleanup deletes queued storage once, remains idempotent, and retains activity history", async () => {
  const activity = { id: "activity", distance: 5 };
  const job = {
    activity_id: activity.id,
    challenge_id: "challenge",
    storage_paths: ["challenge/user/evidence.webp"],
    attempts: 1,
    lease_token: "lease",
  };
  let removals = 0;
  let available = true;
  const store = {
    claim: async () => (available ? [job] : []),
    remove: async () => {
      removals += 1;
    },
    finish: async (_completedJob, succeeded) => {
      assert.equal(succeeded, true);
      available = false;
    },
  };
  assert.deepEqual(await runEvidenceCleanupBatch(store), {
    claimed: 1,
    completed: 1,
    failed: 0,
  });
  assert.deepEqual(await runEvidenceCleanupBatch(store), {
    claimed: 0,
    completed: 0,
    failed: 0,
  });
  assert.equal(removals, 1);
  assert.deepEqual(activity, { id: "activity", distance: 5 });
});

test("failed storage deletion records a retry without deleting activity data", async () => {
  const activity = { id: "activity", distance: 10, qualified: true };
  let failureRecorded = false;
  const result = await runEvidenceCleanupBatch({
    claim: async () => [
      {
        activity_id: activity.id,
        challenge_id: "challenge",
        storage_paths: ["challenge/evidence.webp"],
        attempts: 1,
        lease_token: "lease",
      },
    ],
    remove: async () => {
      throw new Error("storage unavailable");
    },
    finish: async (_job, succeeded) => {
      assert.equal(succeeded, false);
      failureRecorded = true;
    },
  });
  assert.deepEqual(result, { claimed: 1, completed: 0, failed: 1 });
  assert.equal(failureRecorded, true);
  assert.deepEqual(activity, { id: "activity", distance: 10, qualified: true });
});

test("expired evidence renders a stable state without requesting a signed URL", async () => {
  const week = await read("src/routes/_authenticated/challenge/index.tsx");
  assert.match(week, /Evidence expired after finalization/);
  assert.match(week, /Evidence available/);
  assert.match(week, /if \(expired\)[\s\S]*Evidence expired after finalization[\s\S]*if \(!open\)/);
  const server = await read("src/lib/challenge-evidence.server.ts");
  assert.match(server, /\.from\("challenge-evidence"\)[\s\S]*\.remove\(paths\)/);
  assert.doesNotMatch(server, /challenge_activities[\s\S]*\.delete\(/);
});

test("scheduled cleanup uses the existing server-only cron dispatch pattern", async () => {
  const [setup, worker, config, migration] = await Promise.all([
    read("supabase/setup-challenge-push.sql"),
    read("supabase/functions/challenge-evidence-cleanup/index.ts"),
    read("supabase/config.toml"),
    read("supabase/migrations/20260903180000_evidence_cleanup_worker.sql"),
  ]);
  assert.match(setup, /challenge-evidence-cleanup-retry[\s\S]*7 \* \* \* \*/);
  assert.match(setup, /challenge_evidence_cleanup_worker_url/);
  assert.match(setup, /challenge_push_dispatch_secret/);
  assert.match(worker, /authorizedDispatcher/);
  assert.match(worker, /CHALLENGE_PUSH_DISPATCH_SECRET/);
  assert.match(worker, /EVIDENCE_CLEANUP_BATCH_SIZE/);
  assert.match(config, /\[functions\.challenge-evidence-cleanup\][\s\S]*verify_jwt = false/);
  assert.match(migration, /FOR UPDATE OF queue SKIP LOCKED/);
  assert.match(migration, /TO service_role/);
  assert.match(migration, /FROM PUBLIC, anon, authenticated/);
});
