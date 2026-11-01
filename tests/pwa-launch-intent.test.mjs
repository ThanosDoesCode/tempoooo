import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { presentationComponent } from "./presentation-component-fixture.mjs";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

function storage(entries = {}, { throws = false } = {}) {
  const map = new Map(Object.entries(entries));
  const guard = () => {
    if (throws) throw new Error("SecurityError");
  };
  return {
    map,
    getItem: (key) => (guard(), map.has(key) ? map.get(key) : null),
    setItem: (key, value) => (guard(), map.set(key, String(value))),
  };
}

/** A fresh document (module re-evaluated) with the given launch signals. */
function launch({
  initial = "https://tempo.app/challenge",
  type = "navigate",
  standalone = true,
  iosStandalone = false,
  session = storage(),
  local = storage(),
  referrer = "",
  historyState = { __TSR_index: 0, key: "abc" },
  logs = [],
  ssr = false,
} = {}) {
  const globals = ssr
    ? {}
    : {
        URL,
        JSON,
        Date,
        Object,
        String,
        window: {
          location: { origin: "https://tempo.app" },
          history: { state: historyState },
          matchMedia: (query) => ({
            matches: standalone && query === "(display-mode: standalone)",
          }),
        },
        document: { referrer },
        performance: {
          getEntriesByType: (kind) => (kind === "navigation" ? [{ type, name: initial }] : []),
        },
        navigator: { standalone: iosStandalone },
        sessionStorage: session,
        localStorage: local,
        console: { info: (...args) => logs.push(args) },
      };
  return presentationComponent("src/lib/launch-intent.ts", {}, globals);
}

const href = (initial) => initial.replace("https://tempo.app", "");
const first = (initial, options = {}) => {
  const doc = launch({ initial, ...options });
  return { doc, kind: doc.classifyLaunch(href(initial)) };
};

// ---------------------------------------------------------------- generic launches
test("full-fitness standalone generic launch (old /challenge start_url) normalizes to /today", () => {
  assert.equal(launch().isGenericLaunch("/challenge"), true);
  // iOS home-screen apps report standalone via navigator.standalone.
  assert.equal(
    launch({ standalone: false, iosStandalone: true }).isGenericLaunch("/challenge"),
    true,
  );
});

test("a relaunch WebKit reports as a reload is still generic when the app session is fresh", () => {
  assert.equal(launch({ type: "reload" }).isGenericLaunch("/challenge"), true);
  assert.equal(launch({ type: "unknown-type" }).isGenericLaunch("/challenge"), true);
});

test("any unmarked restored start URL is generic; /today needs no redirect (no loop)", () => {
  for (const path of ["/challenge", "/challenge?challenge=abc", "/bulk/progress", "/profile"])
    assert.equal(first(`https://tempo.app${path}`).kind, "generic", path);
  const today = launch({ initial: "https://tempo.app/today" });
  assert.equal(today.isGenericLaunch("/today"), false);
  // The redirected /today load is the second evaluation of the same document: in-app, no redirect.
  const doc = launch();
  assert.equal(doc.isGenericLaunch("/challenge"), true);
  assert.equal(doc.classifyLaunch("/today"), "in-app");
  assert.equal(doc.isGenericLaunch("/challenge"), false); // normal in-app tap to Challenge stays
});

// ---------------------------------------------------------------- explicit intents are preserved
test("marked notifications, marked deep links and invitations keep their destination", () => {
  const cases = {
    "/challenge?from=notification": "notification",
    "/challenge?challenge=abc&from=notification": "notification",
    "/notifications?from=notification": "notification",
    "/challenge?from=link": "deep-link",
    "/challenge/payments?from=email": "deep-link",
    "/invite/challenge/token-123": "deep-link",
  };
  for (const [path, kind] of Object.entries(cases)) {
    const { doc, kind: actual } = first(`https://tempo.app${path}`);
    assert.equal(actual, kind, path);
    assert.equal(launch({ initial: `https://tempo.app${path}` }).isGenericLaunch(path), false);
    assert.ok(doc);
  }
});

test("reload while already using the app and browser Back never redirect", () => {
  const session = storage();
  // The app session started from a notification tap; later the user reloads on bare /challenge.
  assert.equal(
    first("https://tempo.app/challenge?from=notification", { session }).kind,
    "notification",
  );
  assert.equal(first("https://tempo.app/challenge", { session, type: "reload" }).kind, "reload");
  assert.equal(launch({ session }).isGenericLaunch("/challenge"), false);
  assert.equal(first("https://tempo.app/challenge", { type: "back_forward" }).kind, "restore");
});

test("sign-in: a document that opened on /auth keeps its post-sign-in destination", () => {
  for (const destination of ["/challenge", "/bulk/progress", "/challenge?from=notification"]) {
    const initial = `https://tempo.app/auth?redirect=${encodeURIComponent(destination)}`;
    assert.equal(launch({ initial }).isGenericLaunch(destination), false, destination);
  }
  const auth = launch({ initial: "https://tempo.app/auth?redirect=%2Fchallenge" });
  assert.equal(auth.classifyLaunch("/challenge"), "in-app");
  // Document opened on "/" and the index route redirected to /today: in-app, already Today.
  assert.equal(launch({ initial: "https://tempo.app/" }).isGenericLaunch("/today"), false);
});

test("browser tabs, SSR and blocked storage are never normalized", () => {
  assert.equal(first("https://tempo.app/challenge", { standalone: false }).kind, "browser");
  assert.equal(launch({ ssr: true }).classifyLaunch("/challenge"), "unknown");
  assert.equal(
    first("https://tempo.app/challenge", { session: storage({}, { throws: true }) }).kind,
    "unknown",
  );
});

// ---------------------------------------------------------------- diagnostics
test("diagnostics are off unless the explicit debug flag is set", () => {
  const local = storage();
  const logs = [];
  launch({ local, logs }).classifyLaunch("/challenge");
  assert.equal(local.map.has("tempo:last-launch"), false);
  assert.equal(logs.length, 0);
});

test("debug flag records the startup decision without private data", () => {
  const local = storage({ "tempo:debug-launch": "1" });
  const logs = [];
  const doc = launch({
    local,
    logs,
    initial: "https://tempo.app/challenge?challenge=secret-id",
    referrer: "https://accounts.example.com/private/path?code=xyz",
    type: "reload",
    iosStandalone: true,
  });
  doc.classifyLaunch("/challenge?challenge=secret-id");
  doc.recordLaunch(() => ({ mode: "fitness" }));
  const record = JSON.parse(local.map.get("tempo:last-launch"));
  assert.deepEqual(
    { ...record, at: undefined },
    {
      pathname: "/challenge",
      searchKeys: "challenge",
      hash: false,
      referrer: "https://accounts.example.com",
      displayModeStandalone: true,
      navigatorStandalone: "true",
      navigationType: "reload",
      historyStateKeys: "__TSR_index,key",
      classification: "generic",
      decision: "redirect /today",
      mode: "fitness",
      at: undefined,
    },
  );
  assert.doesNotMatch(local.map.get("tempo:last-launch"), /secret-id|xyz|private/);
  assert.equal(logs.length, 2);

  const invite = storage({ "tempo:debug-launch": "1" });
  launch({ local: invite, initial: "https://tempo.app/invite/challenge/tok-9" }).classifyLaunch(
    "/invite/challenge/tok-9",
  );
  const inviteRecord = JSON.parse(invite.map.get("tempo:last-launch"));
  assert.equal(inviteRecord.pathname, "/invite/challenge/:token");
  assert.equal(inviteRecord.classification, "deep-link");
  assert.equal(inviteRecord.decision, "none");
});

// ---------------------------------------------------------------- manifest and routing wiring
test("current manifest: root identity, start_url /today, scope /", async () => {
  const manifest = JSON.parse(await read("public/manifest.webmanifest"));
  assert.equal(manifest.id, "/"); // stable root identity; existing installs must reinstall
  assert.equal(manifest.start_url, "/today");
  assert.equal(manifest.scope, "/");
  assert.equal(manifest.display, "standalone");
});

test("the guard normalizes before sign-in captures a destination, skips preloads, replaces history", async () => {
  const guard = await read("src/routes/_authenticated/route.tsx");
  const check = guard.indexOf("isGenericLaunch(location.href)");
  assert.ok(check > 0);
  assert.ok(check < guard.indexOf("rememberDestination("), "runs before destination capture");
  assert.match(
    guard,
    /cause !== "preload" && isGenericLaunch\(location\.href\)\)\s*throw redirect\(\{ to: "\/today", replace: true \}\)/,
  );
  assert.match(guard, /recordLaunch\(\(\) => \(\{ mode: accountProductMode\(memberships\) \}\)\)/);
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
  assert.equal((worker.match(/\burl:/g) ?? []).length, 1, "one notification URL builder");
});
