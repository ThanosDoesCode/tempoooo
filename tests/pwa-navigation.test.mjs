import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
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

test("Tempo manifest and navigation expose Challenge by default and owner-only Bulk History", async () => {
  const manifest = JSON.parse(await read("public/manifest.webmanifest"));
  assert.equal(manifest.name, "Tempo");
  assert.equal(manifest.short_name, "Tempo");
  assert.equal(manifest.start_url, "/challenge");
  const index = await read("src/routes/index.tsx");
  assert.match(index, /data\.session \? "\/challenge" : "\/auth"/);
  assert.doesNotMatch(index, /window\.location/);
  const shell = await read("src/components/AppShell.tsx");
  assert.match(shell, /"\/bulk\/history", label: "History"/);
  assert.match(shell, /isBulk && hasBulk \? BULK_NAV : CHALLENGE_NAV/);
  assert.match(shell, /onPointerDown=\{\(\) => acknowledge/);
  assert.match(shell, /router\.status === "pending"/);
  assert.doesNotMatch(shell, /Sharing|Shared Bulk|\/bulk\/access/);
  const guard = await read("src/routes/_authenticated/bulk/route.tsx");
  assert.match(guard, /bulkOwnerQueryOptions/);
  assert.match(guard, /ensureQueryData/);
  assert.match(guard, /prefetchBulk/);
  assert.match(guard, /memberships\.length === 0/);
  assert.match(guard, /clearBulk\(\)/);
  assert.match(guard, /redirect\(\{ to: "\/bulk-access-denied", replace: true \}\)/);
  const denied = await read("src/routes/_authenticated/bulk-access-denied.tsx");
  assert.match(denied, /Bulk access required/);
  assert.match(denied, /only available to authorized administrators/);
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
  assert.match(root, /previousUserId\.current === nextUserId/);
  assert.match(root, /removeQueries\(\{ queryKey: \["bulk-memberships"\] \}\)/);
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
