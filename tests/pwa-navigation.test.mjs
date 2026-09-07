import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { PULL_REFRESH_THRESHOLD, pullGesture } from "../src/lib/pull-to-refresh.ts";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("pull-to-refresh ignores tiny, horizontal and mid-scroll gestures", () => {
  assert.equal(pullGesture({ x: 0, y: 0 }, { x: 0, y: 10 }, 0).distance, 0);
  assert.equal(pullGesture({ x: 0, y: 0 }, { x: 40, y: 20 }, 0).cancelled, true);
  assert.equal(pullGesture({ x: 0, y: 0 }, { x: 0, y: 200 }, 10).distance, 0);
  const ready = pullGesture({ x: 0, y: 0 }, { x: 4, y: 150 }, 0);
  assert.equal(ready.ready, true);
  assert.ok(ready.distance >= PULL_REFRESH_THRESHOLD);
});

test("refresh revalidates data without a destructive browser reload", async () => {
  const source = await read("src/components/PullToRefresh.tsx");
  assert.match(source, /refetchQueries\(\{ type: "active" \}\)/);
  assert.match(source, /refreshBulk\(\)/);
  assert.doesNotMatch(source, /router\.invalidate\(\)/);
  assert.match(source, /a, button, input, textarea, select/);
  assert.doesNotMatch(source, /location\.reload/);
  assert.doesNotMatch(await read("src/routes/index.tsx"), /location\.reload/);
});

test("Tempo navigation exposes optional Bulk only after persisted activation", async () => {
  const manifest = JSON.parse(await read("public/manifest.webmanifest"));
  assert.equal(manifest.name, "Tempo");
  assert.equal(manifest.short_name, "Tempo");
  assert.equal(manifest.start_url, "/challenge");
  assert.equal(manifest.display, "standalone");
  assert.deepEqual(
    manifest.icons.map(({ src, sizes }) => ({ src, sizes })),
    [
      { src: "/icons/challenge-192.png", sizes: "192x192" },
      { src: "/icons/challenge-512.png", sizes: "512x512" },
    ],
  );
  const root = await read("src/routes/__root.tsx");
  assert.match(root, /apple-mobile-web-app-capable", content: "yes"/);
  assert.match(root, /apple-mobile-web-app-title", content: "Tempo"/);
  assert.match(root, /apple-mobile-web-app-status-bar-style", content: "black-translucent"/);
  assert.match(root, /rel: "apple-touch-icon"[\s\S]*sizes: "180x180"[\s\S]*apple-touch-icon\.png/);
  const index = await read("src/routes/index.tsx");
  assert.match(index, /data\.session \? "\/challenge" : "\/auth"/);
  assert.doesNotMatch(index, /window\.location/);
  const shell = await read("src/components/AppShell.tsx");
  assert.match(shell, /"\/bulk\/history", label: "History"/);
  assert.match(
    shell,
    /isBulk && hasBulk \? \(publicPlan \? PUBLIC_BULK_NAV : LEGACY_BULK_NAV\) : CHALLENGE_NAV/,
  );
  assert.match(shell, /\{publicPlan \? "Goal" : "Bulk"\}/);
  assert.match(shell, />\s*Challenge\s*<\/Link>/);
  assert.doesNotMatch(shell, /disabled[\s\S]{0,120}>\s*Bulk\s*</);
  assert.match(shell, /onPointerDown=\{\(\) => acknowledge/);
  assert.match(shell, /router\.status === "pending"/);
  assert.doesNotMatch(shell, /Sharing|Shared Bulk|\/bulk\/access/);
  const guard = await read("src/routes/_authenticated/bulk/route.tsx");
  assert.match(guard, /bulkOwnerQueryOptions/);
  assert.match(guard, /ensureQueryData/);
  assert.match(guard, /prefetchBulk/);
  assert.match(guard, /memberships\.length === 0/);
  assert.match(guard, /clearBulk\(\)/);
  assert.match(guard, /redirect\(\{ to: "\/bulk-onboarding", replace: true \}\)/);
  const onboarding = await read("src/routes/_authenticated/bulk-onboarding.tsx");
  assert.match(onboarding, /supabase\.rpc\("complete_bulk_onboarding"/);
  assert.match(onboarding, /Create My Goal Plan/);
  assert.match(onboarding, /bulkOwnerQueryOptions/);
  const denied = await read("src/routes/_authenticated/bulk-access-denied.tsx");
  assert.match(denied, /Bulk access required/);
  assert.match(denied, /Bulk is optional/);
});

test("public Bulk uses four primary tabs and More keeps secondary routes reachable", async () => {
  const [shell, more, today] = await Promise.all([
    read("src/components/AppShell.tsx"),
    read("src/routes/_authenticated/bulk/more.tsx"),
    read("src/routes/_authenticated/bulk/index.tsx"),
  ]);
  const publicNav = shell.match(/const PUBLIC_BULK_NAV = \[[\s\S]*?\] as const;/)?.[0];
  assert.ok(publicNav);
  assert.deepEqual(
    [...publicNav.matchAll(/label: "([^"]+)"/g)].map((match) => match[1]),
    ["Today", "Training", "Meals", "More"],
  );
  assert.doesNotMatch(publicNav, /Progress|Check-In|History/);
  for (const destination of ["/bulk/progress", "/bulk/check-in", "/bulk/history"]) {
    assert.match(more, new RegExp(destination.replace("/", "\\/")));
    assert.match(shell, new RegExp(destination.replace("/", "\\/")));
  }
  assert.match(more, /min-h-16/);
  assert.match(shell, /MORE_DESTINATIONS/);

  assert.match(today, /You haven&apos;t chosen a training plan yet/);
  assert.match(today, /Choose training plan/);
  assert.match(today, /activePlan\.data\.days\.map/);
  assert.match(today, /planDay\.name/);
  assert.match(today, /usesPublicTrainingPlan[\s\S]*WORKOUT_TYPES\.map/);

  const legacyNav = shell.match(/const LEGACY_BULK_NAV = \[[\s\S]*?\] as const;/)?.[0];
  assert.ok(legacyNav);
  assert.deepEqual(
    [...legacyNav.matchAll(/label: "([^"]+)"/g)].map((match) => match[1]),
    ["Today", "Training", "Meals", "Progress", "Check-In", "History"],
  );
});

test("authenticated routes keep the document title fixed to Tempo", async () => {
  const routeRoot = new URL("../src/routes/_authenticated/", import.meta.url);
  const routeFiles = (await readdir(routeRoot, { recursive: true })).filter((file) =>
    file.endsWith(".tsx"),
  );

  for (const file of routeFiles) {
    const source = await read(`src/routes/_authenticated/${file}`);
    const documentTitles = [...source.matchAll(/\{\s*title:\s*"([^"]+)"\s*\}/g)].map(
      (match) => match[1],
    );
    const previewTitles = [
      ...source.matchAll(/property:\s*"og:title",\s*content:\s*"([^"]+)"/g),
    ].map((match) => match[1]);
    assert.ok(
      documentTitles.every((title) => title === "Tempo"),
      `${file} overrides the document title with ${documentTitles.join(", ")}`,
    );
    assert.ok(
      previewTitles.every((title) => title === "Tempo"),
      `${file} overrides the preview title with ${previewTitles.join(", ")}`,
    );
  }

  const root = await read("src/routes/__root.tsx");
  assert.match(root, /\{ title: "Tempo" \}/);
  assert.match(root, /property: "og:title", content: "Tempo"/);
  assert.match(root, /name: "twitter:title", content: "Tempo"/);
  assert.match(
    root,
    /property: "og:image"[\s\S]*content: "https:\/\/trexavlaka\.lovable\.app\/icons\/challenge-512\.png"/,
  );
  assert.doesNotMatch(root, /id-preview-|lean bulk tracker/i);
  const index = await read("src/routes/index.tsx");
  assert.match(index, /\{ title: "Tempo" \}/);
  assert.doesNotMatch(index, /lean bulk tracker/i);
});

test("navigation prefetch removes avoidable sequential reads", async () => {
  const challenge = await read("src/lib/challenge.ts");
  assert.match(challenge, /challenges!inner/);
  assert.match(challenge, /auth\.getSession\(\)/);
  assert.doesNotMatch(
    challenge,
    /auth\.getUser\(\)[\s\S]*challenge_members[\s\S]*\.from\("challenges"\)/,
  );
  const store = await read("src/lib/store.ts");
  assert.match(store, /export function prefetchBulk/);
  assert.match(store, /Promise\.all\(\[/);
  const home = await read("src/routes/_authenticated/challenge/index.tsx");
  assert.match(home, /prefetchQuery\(weeksQueryOptions/);
  assert.match(home, /prefetchQuery\(paymentsQueryOptions/);
  const root = await read("src/routes/__root.tsx");
  assert.match(root, /authenticatedUserChanged\(previousUserId\.current, nextUserId\)/);
  assert.match(root, /resetUserScopedQueries\(queryClient\)/);
  assert.doesNotMatch(root, /removeQueries\(/);
});

test("Bulk History uses stored snapshots and labels legacy meal limitations", async () => {
  const source = await read("src/routes/_authenticated/bulk/history.tsx");
  assert.match(source, /day\?\.mealSnapshot \?\? configuredPlan/);
  assert.match(source, /Legacy day:/);
  assert.match(source, /individual\s+consumption was not stored separately/);
  assert.match(source, /No workout was logged/);
  assert.match(source, /No nutrition was logged/);
});

test("OneSignal worker remains push-only without private application caching", async () => {
  const worker = await read("public/OneSignalSDKWorker.js");
  assert.match(worker, /OneSignalSDK\.sw\.js/);
  assert.doesNotMatch(worker, /addEventListener\s*\(\s*["']fetch/);
  assert.doesNotMatch(worker, /caches\./);
});
