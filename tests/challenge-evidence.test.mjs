import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { CancelledError } from "@tanstack/react-query";
import {
  EVIDENCE_MAX_WIDTH,
  EVIDENCE_TARGET_BYTES,
  EVIDENCE_WEBP_QUALITY,
  BULK_PHOTO_MAX_WIDTH,
  BULK_PHOTO_TARGET_BYTES,
  BULK_PHOTO_WEBP_QUALITY,
  evidenceDimensions,
  evidenceWeekFinalized,
  optimizeBulkPhoto,
  optimizeEvidenceImage,
} from "../src/lib/challenge-evidence.ts";
import { runEvidenceCleanupBatch } from "../supabase/functions/_shared/evidence-cleanup.ts";
import {
  isEvidenceRequestCancellation,
  resolveEvidenceUrls,
} from "../src/lib/challenge-evidence-viewer.ts";
import {
  inspectPrivateImage,
  PRIVATE_IMAGE_MAX_BYTES,
  PRIVATE_IMAGE_MAX_DIMENSION,
  PRIVATE_IMAGE_MAX_PIXELS,
  PrivateImageValidationError,
  STANDARD_PRIVATE_IMAGE_MIME_TYPES,
} from "../src/lib/private-image-upload.ts";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");
const onePixelPng = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9Zl9sAAAAASUVORK5CYII=",
  "base64",
);
const decodedAs = (width, height) => async () => ({ width, height });

function pngHeader(width, height) {
  const bytes = new Uint8Array(24);
  bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 0);
  bytes.set(new TextEncoder().encode("IHDR"), 12);
  new DataView(bytes.buffer).setUint32(16, width);
  new DataView(bytes.buffer).setUint32(20, height);
  return bytes;
}

function isoBmffFile(majorBrand, compatibleBrand = "mif1") {
  const bytes = new Uint8Array(65);
  const view = new DataView(bytes.buffer);
  view.setUint32(0, 24);
  bytes.set(new TextEncoder().encode("ftyp"), 4);
  bytes.set(new TextEncoder().encode(majorBrand), 8);
  bytes.set(new TextEncoder().encode(compatibleBrand), 16);
  view.setUint32(24, 32);
  bytes.set(new TextEncoder().encode("meta"), 28);
  view.setUint32(36, 20);
  bytes.set(new TextEncoder().encode("ispe"), 40);
  view.setUint32(48, 1);
  view.setUint32(52, 1);
  view.setUint32(56, 9);
  bytes.set(new TextEncoder().encode("mdat"), 60);
  bytes[64] = 1;
  return bytes;
}

test("private image validation uses content signatures rather than trusting MIME metadata", async () => {
  const image = new File([onePixelPng], "evidence.bin", { type: "" });
  assert.deepEqual(await inspectPrivateImage(image, undefined, decodedAs(1, 1)), {
    mimeType: "image/png",
    extension: "png",
  });

  await assert.rejects(
    inspectPrivateImage(
      new File(["<svg><script>alert(1)</script></svg>"], "evidence.png", {
        type: "image/png",
      }),
    ),
    (error) =>
      error instanceof PrivateImageValidationError &&
      error.code === "invalid_private_image_content",
  );
  await assert.rejects(
    inspectPrivateImage(
      new File([onePixelPng], "evidence.jpg", { type: "image/jpeg" }),
      undefined,
      decodedAs(1, 1),
    ),
    (error) =>
      error instanceof PrivateImageValidationError && error.code === "private_image_type_mismatch",
  );
});

test("empty, markup, executable and arbitrary binary files never reach image decoding", async () => {
  const disguised = [
    ["empty.png", new Uint8Array()],
    ["page.png", new TextEncoder().encode("<!doctype html><html></html>")],
    ["vector.png", new TextEncoder().encode("<?xml version='1.0'?><svg></svg>")],
    ["program.png", new Uint8Array([0x4d, 0x5a, 0x90, 0x00])],
    ["binary.png", new Uint8Array([0x00, 0x01, 0x02, 0x03, 0x04])],
  ];
  let decodes = 0;
  for (const [name, bytes] of disguised)
    await assert.rejects(
      inspectPrivateImage(new File([bytes], name, { type: "image/png" }), undefined, async () => {
        decodes += 1;
        return { width: 1, height: 1 };
      }),
      (error) => error instanceof PrivateImageValidationError,
    );
  assert.equal(decodes, 0);
});

test("standard image files must decode and truncated headers are rejected", async () => {
  await assert.rejects(
    inspectPrivateImage(
      new File([onePixelPng], "broken.png", { type: "image/png" }),
      undefined,
      async () => {
        throw new Error("decode failed");
      },
    ),
    (error) =>
      error instanceof PrivateImageValidationError && error.code === "private_image_decode_failed",
  );
  for (const [name, bytes, type] of [
    ["truncated.jpg", new Uint8Array([0xff, 0xd8, 0xff]), "image/jpeg"],
    ["truncated.png", pngHeader(1, 1).slice(0, 8), "image/png"],
    ["truncated.webp", new TextEncoder().encode("RIFF0000WEBP"), "image/webp"],
    ["truncated.gif", new TextEncoder().encode("GIF89a"), "image/gif"],
  ])
    await assert.rejects(
      inspectPrivateImage(new File([bytes], name, { type }), undefined, decodedAs(1, 1)),
      (error) =>
        error instanceof PrivateImageValidationError &&
        error.code === "private_image_decode_failed",
    );
});

test("private image validation rejects dangerous dimensions before browser decode", async () => {
  let decoded = false;
  await assert.rejects(
    inspectPrivateImage(
      new File([pngHeader(PRIVATE_IMAGE_MAX_DIMENSION + 1, 1)], "wide.png", {
        type: "image/png",
      }),
      undefined,
      async () => {
        decoded = true;
        return { width: 1, height: 1 };
      },
    ),
    (error) =>
      error instanceof PrivateImageValidationError &&
      error.code === "private_image_dimensions_exceeded",
  );
  await assert.rejects(
    inspectPrivateImage(
      new File([pngHeader(9_000, 9_000)], "too-many-pixels.png", { type: "image/png" }),
      undefined,
      decodedAs(9_000, 9_000),
    ),
    (error) =>
      error instanceof PrivateImageValidationError &&
      error.code === "private_image_dimensions_exceeded",
  );
  assert.equal(PRIVATE_IMAGE_MAX_PIXELS, 80_000_000);
  assert.equal(decoded, false);
});

test("HEIC/HEIF brands stay narrow while legitimate iPhone files tolerate missing codecs", async () => {
  assert.deepEqual(
    await inspectPrivateImage(
      new File([isoBmffFile("heic")], "iphone.heic", { type: "image/heic" }),
      undefined,
      async () => {
        throw new Error("codec unavailable");
      },
    ),
    { mimeType: "image/heic", extension: "heic" },
  );
  await assert.rejects(
    inspectPrivateImage(
      new File([isoBmffFile("avif")], "different-codec.heif", { type: "image/heif" }),
      undefined,
      decodedAs(1, 1),
    ),
    (error) =>
      error instanceof PrivateImageValidationError &&
      error.code === "invalid_private_image_content",
  );
  await assert.rejects(
    inspectPrivateImage(
      new File([isoBmffFile("heic").slice(0, 56)], "truncated.heic", { type: "image/heic" }),
      undefined,
      decodedAs(1, 1),
    ),
    (error) =>
      error instanceof PrivateImageValidationError &&
      error.code === "invalid_private_image_content",
  );
});

test("private image validation enforces byte limits and path-specific formats", async () => {
  await assert.rejects(
    inspectPrivateImage(
      new File([new TextEncoder().encode("GIF89a\u0001\u0000\u0001\u0000")], "progress.gif", {
        type: "image/gif",
      }),
      STANDARD_PRIVATE_IMAGE_MIME_TYPES,
      decodedAs(1, 1),
    ),
    (error) =>
      error instanceof PrivateImageValidationError &&
      error.code === "invalid_private_image_content",
  );
  await assert.rejects(
    inspectPrivateImage(
      new File([new Uint8Array(PRIVATE_IMAGE_MAX_BYTES + 1)], "oversized.jpg", {
        type: "image/jpeg",
      }),
      undefined,
      decodedAs(1, 1),
    ),
    (error) =>
      error instanceof PrivateImageValidationError && error.code === "invalid_private_image_size",
  );
});

test("private upload paths validate content and clean partial Challenge evidence", async () => {
  const [challengeLog, publicProgress, progressQuery, legacyStore, migration] = await Promise.all([
    read("src/routes/_authenticated/challenge/log.tsx"),
    read("src/components/PublicBulkProgress.tsx"),
    read("src/lib/bulk-progress-query.ts"),
    read("src/lib/store.ts"),
    read("supabase/migrations/20261001120000_harden_private_image_uploads.sql"),
  ]);
  for (const source of [challengeLog, publicProgress, progressQuery, legacyStore])
    assert.match(source, /inspectPrivateImage/);
  assert.match(challengeLog, /from\("challenge-evidence"\)\.remove\(paths\)/);
  assert.match(migration, /file_size_limit = 15728640/);
  assert.match(migration, /allowed_mime_types/);
  assert.match(migration, /public = false/);
  assert.match(migration, /challenge-evidence/);
  assert.match(migration, /bulk-progress-photos/);
  assert.match(migration, /payment-evidence/);
});

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

test("Bulk photos use a permanent comparison-quality WebP profile without upscaling", async () => {
  const rendered = [];
  const qualities = [];
  const file = new File([new Uint8Array(1_800_000)], "transformation.jpg", {
    type: "image/jpeg",
    lastModified: 321,
  });
  const optimized = await optimizeBulkPhoto(file, {
    decode: async () => ({
      width: 3200,
      height: 1800,
      draw: (_canvas, width, height) => rendered.push([width, height]),
      close: () => {},
    }),
    createCanvas: (width, height) => ({ width, height }),
    encodeWebp: async (_canvas, quality) => {
      qualities.push(quality);
      const sizes = new Map([
        [0.72, 720_000],
        [0.66, 510_000],
        [0.6, 350_000],
      ]);
      return new Blob([new Uint8Array(sizes.get(quality) ?? 300_000)], { type: "image/webp" });
    },
  });
  assert.equal(BULK_PHOTO_MAX_WIDTH, 1600);
  assert.equal(BULK_PHOTO_TARGET_BYTES, 400 * 1024);
  assert.equal(BULK_PHOTO_WEBP_QUALITY, 0.72);
  assert.deepEqual(rendered[0], [1600, 900]);
  assert.deepEqual(qualities.slice(0, 3), [0.72, 0.66, 0.6]);
  assert.equal(optimized.type, "image/webp");
  assert.equal(optimized.name, "transformation.webp");
  assert.equal(optimized.size, 350_000);
});

test("Bulk photo dimensions preserve smaller originals and aspect ratio", async () => {
  const rendered = [];
  await optimizeBulkPhoto(new File(["photo"], "small.png", { type: "image/png" }), {
    decode: async () => ({
      width: 800,
      height: 1200,
      draw: (_canvas, width, height) => rendered.push([width, height]),
      close: () => {},
    }),
    createCanvas: (width, height) => ({ width, height }),
    encodeWebp: async () => new Blob([new Uint8Array(250_000)], { type: "image/webp" }),
  });
  assert.deepEqual(rendered[0], [800, 1200]);
});

test("failed Bulk optimization returns the exact selected file for upload retry", async () => {
  const selected = new File(["original transformation"], "original.heic", {
    type: "image/heic",
  });
  const result = await optimizeBulkPhoto(selected, {
    decode: async () => {
      throw new Error("unsupported image");
    },
    createCanvas: () => ({}),
    encodeWebp: async () => null,
  });
  assert.equal(result, selected);
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

test("valid evidence resolves every signed URL for the in-app viewer", async () => {
  const result = await resolveEvidenceUrls({
    paths: ["challenge/member/one.webp", "challenge/member/two.webp"],
    expired: false,
    sign: async () => ({
      data: [{ signedUrl: "https://storage.test/one" }, { signedUrl: "https://storage.test/two" }],
      error: null,
    }),
  });
  assert.deepEqual(result, {
    status: "ready",
    urls: ["https://storage.test/one", "https://storage.test/two"],
  });
});

test("expired evidence never requests a signed URL", async () => {
  let requests = 0;
  const result = await resolveEvidenceUrls({
    paths: ["challenge/member/expired.webp"],
    expired: true,
    sign: async () => {
      requests += 1;
      return { data: [], error: null };
    },
  });
  assert.deepEqual(result, { status: "expired" });
  assert.equal(requests, 0);
});

test("missing and storage-404 evidence become local unavailable states", async () => {
  const missing = await resolveEvidenceUrls({
    paths: ["challenge/member/missing.webp"],
    expired: false,
    sign: async () => ({ data: [], error: null }),
  });
  const notFound = await resolveEvidenceUrls({
    paths: ["challenge/member/deleted.webp"],
    expired: false,
    sign: async () => ({ data: null, error: { statusCode: "404" } }),
  });
  assert.deepEqual(missing, { status: "unavailable", reason: "storage" });
  assert.deepEqual(notFound, { status: "unavailable", reason: "storage" });
});

test("aborted evidence requests are recognized without suppressing unexpected failures", async () => {
  const aborted = new DOMException("request stopped", "AbortError");
  assert.equal(isEvidenceRequestCancellation(aborted), true);
  const queryCancellation = new CancelledError();
  assert.equal(isEvidenceRequestCancellation(queryCancellation), true);
  const cancellation = await resolveEvidenceUrls({
    paths: ["challenge/member/evidence.webp"],
    expired: false,
    sign: async () => {
      throw aborted;
    },
  });
  assert.deepEqual(cancellation, { status: "unavailable", reason: "cancelled" });

  const cancelledQuery = await resolveEvidenceUrls({
    paths: ["challenge/member/evidence.webp"],
    expired: false,
    sign: async () => {
      throw queryCancellation;
    },
  });
  assert.deepEqual(cancelledQuery, { status: "unavailable", reason: "cancelled" });

  const unexpectedError = new Error("programming fault");
  const unexpected = await resolveEvidenceUrls({
    paths: ["challenge/member/evidence.webp"],
    expired: false,
    sign: async () => {
      throw unexpectedError;
    },
  });
  assert.equal(unexpected.status, "unavailable");
  assert.equal(unexpected.reason, "unexpected");
  assert.equal(unexpected.cause, unexpectedError);
});

test("Challenge evidence uses a local lightbox with safe close and browser Back behavior", async () => {
  const [week, viewer] = await Promise.all([
    read("src/routes/_authenticated/challenge/index.tsx"),
    read("src/components/ChallengeEvidenceViewer.tsx"),
  ]);
  assert.match(week, /ChallengeEvidenceViewer/);
  assert.doesNotMatch(week, /function EvidenceViewer/);
  assert.match(viewer, /createPortal/);
  assert.match(viewer, /role="dialog"/);
  assert.match(viewer, /aria-modal="true"/);
  assert.match(viewer, /object-contain/);
  assert.match(viewer, /Evidence available/);
  assert.match(viewer, /Evidence expired after finalization/);
  assert.match(viewer, /Evidence unavailable/);
  assert.match(viewer, /window\.history\.pushState/);
  assert.match(viewer, /\.\.\.preservedState/);
  assert.match(viewer, /window\.history\.back/);
  assert.match(viewer, /addEventListener\("popstate"/);
  assert.match(viewer, /onClick=\{close\}/);
  assert.match(viewer, /document\.body\.style\.overflow = previousOverflow/);
  assert.match(viewer, /onError=/);
  assert.match(viewer, /reportLovableError/);
  assert.doesNotMatch(viewer, /window\.location/);
  assert.doesNotMatch(viewer, /target="_blank"/);
  assert.doesNotMatch(viewer, /resetUserScopedQueries|signOut|invalidateQueries/);

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

test("Challenge cleanup is structurally unable to delete permanent Bulk photos", async () => {
  const [worker, queue, store, progress] = await Promise.all([
    read("supabase/functions/challenge-evidence-cleanup/index.ts"),
    read("supabase/migrations/20260903170000_challenge_evidence_lifecycle.sql"),
    read("src/lib/store.ts"),
    read("src/routes/_authenticated/bulk/progress.tsx"),
  ]);
  assert.match(worker, /storage\.from\("challenge-evidence"\)/);
  assert.doesNotMatch(worker, /bulk-progress-photos/);
  assert.match(queue, /FROM public\.challenge_activities activity/);
  assert.doesNotMatch(queue, /bulk_photos|bulk-progress-photos/);
  assert.match(store, /from\("bulk-progress-photos"\)[\s\S]*\.upload\(path, file/);
  assert.match(store, /if \(up\.error\) throw up\.error/);
  assert.match(store, /createSignedUrls\(paths/);
  assert.match(progress, /Optimizing photo…/);
  assert.match(progress, /Uploading photo…/);
  assert.match(progress, /selected photo is still here/);
});
