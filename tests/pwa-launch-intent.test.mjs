import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { presentationComponent } from "./presentation-component-fixture.mjs";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

/** A fresh document (module re-evaluated) with the given launch signals. */
function launch({
  initial = "https://tempo.app/challenge",
  type = "navigate",
  standalone = true,
  iosStandalone = false,
  ssr = false,
} = {}) {
  const globals = ssr
    ? {}
    : {
        URL,
        window: {
          matchMedia: (query) => ({
            matches: standalone && query === "(display-mode: standalone)",
          }),
        },
        performance: {
          getEntriesByType: (kind) => (kind === "navigation" ? [{ type, name: initial }] : []),
        },
        navigator: { standalone: iosStandalone },
      };
  return presentationComponent("src/lib/launch-intent.ts", {}, globals);
}

// ---------------------------------------------------------------- the root cause
test("root cause: a cold standalone launch of the pre-2026-10-07 start_url (/challenge) is generic", () => {
  assert.equal(launch().isLegacyGenericLaunch("/challenge"), true);
  // iOS home-screen apps report standalone via navigator.standalone.
  assert.equal(
    launch({ standalone: false, iosStandalone: true }).isLegacyGenericLaunch("/challenge"),
    true,
  );
});

test("the manifest history matches: start_url moved off /challenge, the app id kept it", async () => {
  const manifest = JSON.parse(await read("public/manifest.webmanifest"));
  assert.equal(manifest.start_url, "/today");
  assert.equal(manifest.id, "/challenge"); // unchanged identity: installs are the same app
  const intent = await read("src/lib/launch-intent.ts");
  assert.match(intent, /export const LEGACY_START_URL = "\/challenge"/);
});

// ---------------------------------------------------------------- explicit intents are preserved
test("notification taps are explicit (marked) and never normalized", () => {
  const tap = launch({ initial: "https://tempo.app/challenge?from=notification" });
  assert.equal(tap.isLegacyGenericLaunch("/challenge?from=notification"), false);
  const invite = launch({
    initial: "https://tempo.app/challenge?challenge=abc&from=notification",
  });
  assert.equal(invite.isLegacyGenericLaunch("/challenge?challenge=abc&from=notification"), false);
});

test("explicit deep links keep their destination", () => {
  for (const path of ["/invite/challenge/token", "/bulk/progress", "/profile", "/challenge/money"])
    assert.equal(
      launch({ initial: `https://tempo.app${path}` }).isLegacyGenericLaunch(path),
      false,
      path,
    );
});

test("in-app navigation and post-sign-in destinations are never treated as a launch", () => {
  // The document opened elsewhere (e.g. /auth); a later navigation to /challenge is explicit.
  assert.equal(
    launch({ initial: "https://tempo.app/auth?redirect=%2Fchallenge" }).isLegacyGenericLaunch(
      "/challenge",
    ),
    false,
  );
  // Only the document's first route resolution can be a launch: no loop, Challenge tab still works.
  const doc = launch();
  assert.equal(doc.isLegacyGenericLaunch("/challenge"), true);
  assert.equal(doc.isLegacyGenericLaunch("/challenge"), false);
});

test("reloads, back/forward restores and plain browser tabs are not launches", () => {
  assert.equal(launch({ type: "reload" }).isLegacyGenericLaunch("/challenge"), false);
  assert.equal(launch({ type: "back_forward" }).isLegacyGenericLaunch("/challenge"), false);
  assert.equal(launch({ standalone: false }).isLegacyGenericLaunch("/challenge"), false);
  assert.equal(launch({ ssr: true }).isLegacyGenericLaunch("/challenge"), false);
});

// ---------------------------------------------------------------- routing wiring
test("the guard normalizes before sign-in captures a destination, skips preloads, replaces history", async () => {
  const guard = await read("src/routes/_authenticated/route.tsx");
  const check = guard.indexOf("isLegacyGenericLaunch(location.href)");
  assert.ok(check > 0);
  assert.ok(check < guard.indexOf("rememberDestination("), "runs before destination capture");
  assert.match(
    guard,
    /cause !== "preload" && isLegacyGenericLaunch\(location\.href\)\)\s*throw redirect\(\{ to: "\/today", replace: true \}\)/,
  );
});

test("generic entry points resolve to Today for fitness and Challenge for core", async () => {
  const [today, index, auth] = await Promise.all([
    read("src/routes/_authenticated/today.tsx"),
    read("src/routes/index.tsx"),
    read("src/routes/auth.tsx"),
  ]);
  // /today: core -> Challenge, everyone else (full fitness) -> Today (/bulk).
  assert.match(today, /accountProductMode\(memberships\) === "core"[\s\S]*to: "\/challenge"/);
  assert.match(today, /throw redirect\(\{ to: "\/bulk", replace: true \}\)/);
  // "/" and sign-in without an explicit destination go to /today.
  assert.match(index, /if \(data\.session\) throw redirect\(\{ to: "\/today", replace: true \}\)/);
  assert.match(auth, /throw redirect\(\{ to: "\/today", replace: true \}\)/);
  assert.match(auth, /navigate\(\{ to: "\/today", replace: true \}\)/);
});

test("every push destination carries the explicit notification marker", async () => {
  const worker = await read("supabase/functions/_shared/challenge-push.ts");
  assert.match(worker, /url\.searchParams\.set\("from", "notification"\)/);
  assert.match(worker, /url: notificationUrl\(/);
});
