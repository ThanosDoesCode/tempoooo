import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  StartupLifecycle,
  STARTUP_DEADLINE_MS,
  withStartupDeadline,
  startupDiagnostic,
  watchStartupRedirects,
} from "../src/lib/startup.ts";
import { accountUI, deferred } from "./account-ui-fixture.mjs";

function clock() {
  let time = 0,
    id = 0;
  const tasks = new Map();
  return {
    now: () => time,
    setTimeout(fn, delay) {
      tasks.set(++id, { fn, at: time + delay });
      return id;
    },
    clearTimeout(id) {
      tasks.delete(id);
    },
    size: () => tasks.size,
    elapse(ms) {
      time += ms;
    },
    advance(ms) {
      time += ms;
      for (const [id, task] of [...tasks])
        if (task.at <= time) {
          tasks.delete(id);
          task.fn();
        }
    },
  };
}

function shellFixture({ offline = false } = {}) {
  const timers = clock(),
    sessions = [],
    events = new Map(),
    observations = [];
  let listener,
    subscriptions = 0,
    unsubscriptions = 0,
    invalidations = 0;
  const state = {
    status: "pending",
    isLoading: true,
    location: {
      pathname: "/challenge",
      get publicHref() {
        return this.pathname;
      },
    },
    matches: [],
  };
  const router = {
    options: { context: { queryClient: {} } },
    state,
    history: {
      get location() {
        return { href: state.location.pathname };
      },
      subscribe() {
        return () => {};
      },
    },
    invalidate() {
      invalidations++;
      state.status = "pending";
      state.isLoading = true;
      state.matches = [];
      return Promise.resolve();
    },
  };
  const api = accountUI(
    "src/routes/__root.tsx",
    "Route",
    {
      "../styles.css?url": {},
      "@tanstack/react-query": { QueryClientProvider: "QueryClientProvider" },
      "@tanstack/react-router": {
        createRootRouteWithContext: () => (options) => ({
          options: { ...options, component: options.shellComponent },
        }),
        useRouter: () => router,
        useRouterState: ({ select }) => select(state),
        HeadContent: "HeadContent",
        Scripts: "Scripts",
      },
      "../lib/lovable-error-reporting": {},
      "../components/ChallengePushSession": { ChallengePushSession: "ChallengePushSession" },
      "../components/ui/sonner": {},
      "@/integrations/supabase/client": {
        supabase: {
          auth: {
            onAuthStateChange(fn) {
              listener = fn;
              subscriptions++;
              return {
                data: {
                  subscription: {
                    unsubscribe() {
                      unsubscriptions++;
                    },
                  },
                },
              };
            },
          },
        },
      },
      "@/lib/auth": {
        observeAuthIdentity(id) {
          observations.push(id);
        },
        readStartupSession() {
          const next = deferred();
          sessions.push(next);
          return next.promise;
        },
      },
      "@/lib/store": { clearBulk() {} },
      "@/lib/network-errors": { isOffline: () => offline },
      "@/lib/browser-data": { clearAccountScopedBrowserData() {} },
      "@/components/AppCrashBoundary": {},
      "@/components/QueryCancellationRecovery": {},
      "@/lib/query-cancellation": {
        isExpectedQueryCancellation: (error) => error?.cancelled === true,
        authenticatedUserChanged: (previous, next) => previous !== undefined && previous !== next,
        resetUserScopedQueries: async () => {},
      },
      "@/lib/startup": {
        watchStartupRedirects,
        StartupLifecycle: class extends StartupLifecycle {
          constructor() {
            super(timers);
          }
        },
      },
    },
    { children: "LOCAL_CONTENT_OR_SKELETON" },
    {
      document: {
        addEventListener(name, fn) {
          events.set(name, fn);
        },
        removeEventListener(name) {
          events.delete(name);
        },
      },
      window: {
        addEventListener(name, fn) {
          events.set(name, fn);
        },
        removeEventListener(name) {
          events.delete(name);
        },
      },
    },
  );
  return {
    api,
    timers,
    sessions,
    events,
    state,
    observations,
    counts: () => ({ subscriptions, unsubscriptions, invalidations }),
    emit(userId) {
      listener("INITIAL_SESSION", userId ? { user: { id: userId } } : null);
    },
    loaded(pathname = "/challenge") {
      state.status = "idle";
      state.isLoading = false;
      state.location.pathname = pathname;
    },
    cover() {
      return api.find("html")[0].props["data-tempo-ready"] !== "true";
    },
  };
}

for (const dependency of [
  "local session",
  "auth validation",
  "profile",
  "product mode",
  "cancelled query",
  "router handoff",
]) {
  test(`shell deadline survives a hung ${dependency}, even without a mounted RootComponent`, async () => {
    const f = shellFixture();
    assert.equal(f.cover(), true);
    if (dependency !== "local session") f.emit("a");
    if (dependency === "cancelled query")
      f.state.matches = [{ status: "error", error: { cancelled: true } }];
    f.api.render();
    f.timers.advance(STARTUP_DEADLINE_MS - 1);
    assert.equal(f.cover(), true);
    f.timers.advance(1);
    assert.equal(f.cover(), false);
    assert.match(f.api.text(), /Tempo couldn't start/);
    assert.equal(f.timers.size(), 0);
    // Neither INITIAL_SESSION nor a late route completion can erase terminal recovery.
    f.sessions[0].resolve({ data: { session: { user: { id: "a" } } } });
    f.emit("a");
    f.loaded();
    await f.api.flush();
    assert.match(f.api.text(), /Tempo couldn't start/);
    f.api.dispose();
  });
}

test("startup route error exposes recovery immediately instead of leaving it under the cover", () => {
  const f = shellFixture();
  f.cover();
  f.emit("a");
  f.state.matches = [{ status: "error", error: new Error("private provider detail") }];
  assert.equal(f.cover(), false);
  assert.match(f.api.text(), /Retry/);
  assert.doesNotMatch(f.api.text(), /private provider detail/);
  f.api.dispose();
});

test("Retry is one fresh bounded generation with one auth listener and ignores the old result", async () => {
  const f = shellFixture();
  f.cover();
  f.sessions[0].reject(new Error("transient network failure"));
  await f.api.flush();
  const retry = f.api.button("Retry").props.onClick;
  retry();
  retry();
  retry();
  assert.equal(f.sessions.length, 2);
  assert.equal(f.timers.size(), 1);
  assert.deepEqual(f.counts(), { subscriptions: 1, unsubscriptions: 0, invalidations: 1 });
  f.emit("a");
  f.loaded("/bulk");
  await f.api.flush();
  assert.equal(f.cover(), false);
  assert.doesNotMatch(f.api.text(), /couldn't start/);
  assert.equal(f.timers.size(), 0);
  f.api.dispose();
  assert.equal(f.counts().unsubscriptions, 1);
  assert.equal(f.events.size, 0);
});

test("repeated failed retries cannot accumulate timers or auth listeners", () => {
  const f = shellFixture();
  f.cover();
  for (let i = 0; i < 4; i++) {
    f.timers.advance(STARTUP_DEADLINE_MS);
    f.api.button("Retry").props.onClick();
    f.api.render();
    assert.equal(f.timers.size(), 1);
    assert.equal(f.counts().subscriptions, 1);
  }
  f.api.dispose();
  assert.equal(f.timers.size(), 0);
});

test("visibility/pageshow enforce elapsed deadline even when WebKit suspended the timer", () => {
  for (const event of ["visibilitychange", "pageshow"]) {
    const f = shellFixture();
    f.cover();
    f.emit("a");
    f.timers.elapse(STARTUP_DEADLINE_MS + 1);
    f.events.get(event)();
    assert.equal(f.cover(), false);
    assert.match(f.api.text(), /Retry/);
    f.api.dispose();
  }
});

for (const [user, path] of [
  ["fitness", "/bulk"],
  ["core", "/challenge"],
  [null, "/auth"],
  [null, "/"],
]) {
  test(`${user ?? "signed-out"} cold startup settles at ${path}; warm resume never restores cover`, async () => {
    const f = shellFixture();
    f.cover();
    f.emit(user);
    f.loaded(path);
    await f.api.flush();
    assert.equal(f.cover(), false);
    assert.match(f.api.text(), /LOCAL_CONTENT_OR_SKELETON/);
    f.state.status = "pending";
    f.state.isLoading = true;
    f.emit(user);
    f.events.get("pageshow")();
    f.events.get("visibilitychange")();
    f.timers.advance(STARTUP_DEADLINE_MS * 2);
    assert.equal(f.cover(), false);
    assert.equal(f.timers.size(), 0);
    f.api.dispose();
  });
}

test("late old generation cannot finish or fail a newer retry", () => {
  const timers = clock(),
    lifecycle = new StartupLifecycle(timers);
  const old = lifecycle.begin();
  lifecycle.fail(old);
  const current = lifecycle.retry();
  lifecycle.session(old, "old-account");
  lifecycle.route(old, false, "/bulk");
  lifecycle.fail(old);
  assert.equal(lifecycle.getSnapshot().phase, "restoring");
  assert.equal(lifecycle.getSnapshot().sessionRestored, false);
  lifecycle.session(current, "new-account");
  lifecycle.route(current, false, "/challenge");
  assert.equal(lifecycle.getSnapshot().phase, "ready");
  lifecycle.fail(old);
  assert.equal(lifecycle.retry(), null);
  lifecycle.stop();
});

test("a throwing timeout cancellation callback still rejects the bounded read", async () => {
  await assert.rejects(
    withStartupDeadline(
      new Promise(() => {}),
      "profile",
      () => {
        throw new Error("cancel failed");
      },
      1,
    ),
    /timed out/,
  );
});

test("launch diagnostics are explicitly opted in, safe, and include attempt/elapsed/state", () => {
  const previousWindow = globalThis.window,
    info = console.info,
    records = [];
  try {
    globalThis.window = { localStorage: { getItem: () => null } };
    console.info = (...args) => records.push(args);
    startupDiagnostic("startup_begin");
    assert.equal(records.length, 0);
    globalThis.window.localStorage.getItem = () => "1";
    const lifecycle = new StartupLifecycle(clock());
    const attempt = lifecycle.begin();
    lifecycle.session(attempt, "PRIVATE_USER_ID");
    lifecycle.route(attempt, false, "/challenge/private");
    assert.ok(records.length >= 3);
    for (const [, record] of records) {
      assert.equal(record.attempt, attempt);
      assert.equal(typeof record.elapsedMs, "number");
    }
    assert.doesNotMatch(JSON.stringify(records), /PRIVATE_USER_ID|\/challenge\/private/);
    lifecycle.stop();
  } finally {
    globalThis.window = previousWindow;
    console.info = info;
  }
});

test("startup does not await push, notifications, or local Today queries; history prefetch is nonblocking", async () => {
  const root = await readFile(new URL("../src/routes/__root.tsx", import.meta.url), "utf8");
  const shell = root.slice(
    root.indexOf("function RootShell"),
    root.indexOf("function RootComponent"),
  );
  assert.doesNotMatch(shell, /ChallengePushSession|prefetchBulk|streak|nutrition|community/i);
  const bulk = await readFile(
    new URL("../src/routes/_authenticated/bulk/route.tsx", import.meta.url),
    "utf8",
  );
  assert.doesNotMatch(bulk, /await prefetchBulk/);
});

test("old shell getSession result cannot publish identity after timeout or a newer retry", async () => {
  const f = shellFixture();
  f.cover();
  f.timers.advance(STARTUP_DEADLINE_MS);
  f.api.button("Retry").props.onClick();
  f.sessions[0].resolve({ data: { session: { user: { id: "old-account" } } } });
  await f.api.flush();
  assert.deepEqual(f.observations, []);
  assert.equal(f.cover(), true);
  f.sessions[1].resolve({ data: { session: { user: { id: "current-account" } } } });
  f.loaded();
  await f.api.flush();
  assert.deepEqual(f.observations, ["current-account"]);
  assert.equal(f.cover(), false);
  f.api.dispose();
});

test("unmounted shell ignores late session completion and cleans its timer/listeners", async () => {
  const f = shellFixture();
  f.cover();
  f.api.dispose();
  f.sessions[0].resolve({ data: { session: { user: { id: "old-account" } } } });
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(f.observations, []);
  assert.equal(f.timers.size(), 0);
  assert.equal(f.events.size, 0);
  assert.equal(f.counts().unsubscriptions, 1);
});

test("root suspension is caught inside the shell rather than hiding its watchdog", async () => {
  const source = await readFile(new URL("../src/routes/__root.tsx", import.meta.url), "utf8");
  assert.match(source, /shellComponent: RootShell,[\s\S]*wrapInSuspense: true/);
  assert.ok(source.indexOf("startup.begin()") > source.indexOf("function RootShell"));
  assert.ok(source.indexOf("startup.begin()") < source.indexOf("function RootComponent"));
});

test("real TanStack cold redirect before its history subscription loads the intended destination", async () => {
  const { createRootRoute, createRoute, createRouter, createMemoryHistory, redirect } =
    await import("@tanstack/react-router");
  const root = createRootRoute();
  const protectedRoute = createRoute({
    getParentRoute: () => root,
    path: "/protected",
    beforeLoad: () => {
      throw redirect({ to: "/auth", replace: true });
    },
  });
  const auth = createRoute({ getParentRoute: () => root, path: "/auth" });
  const router = createRouter({
    routeTree: root.addChildren([protectedRoute, auth]),
    history: createMemoryHistory({ initialEntries: ["/protected"] }),
    isServer: false,
  });
  await router.load();
  // Node resolves the server export condition. Reproduce the browser redirect
  // commit from Router.load, before React Transitioner installs its subscriber.
  router.history.replace(router.state.redirect.headers.get("Location"));
  assert.equal(router.history.location.href, "/auth");
  assert.equal(
    router.state.location.pathname,
    "/protected",
    "the pre-subscription redirect really leaves stale pending matches",
  );
  const lifecycle = new StartupLifecycle(clock());
  lifecycle.begin();
  const stop = watchStartupRedirects(router, lifecycle);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(router.state.location.pathname, "/auth");
  assert.equal(router.state.isLoading, false);
  assert.equal(router.state.matches.at(-1).status, "success");
  stop();
  lifecycle.stop();
});

test("cold handoff reconciliation dedupes, ignores normal handled navigation and cleans up", async () => {
  const lifecycle = new StartupLifecycle(clock());
  const attempt = lifecycle.begin();
  let listener,
    loads = 0,
    unsubscribed = 0;
  const router = {
    history: {
      location: { href: "/auth" },
      subscribe(fn) {
        listener = fn;
        return () => {
          unsubscribed++;
        };
      },
    },
    state: { location: { publicHref: "/old" } },
    load: async () => {
      loads++;
    },
  };
  const stop = watchStartupRedirects(router, lifecycle);
  listener();
  listener();
  await Promise.resolve();
  assert.equal(loads, 1);
  router.history.location.href = "/handled";
  router.state.location.publicHref = "/handled";
  listener();
  await Promise.resolve();
  assert.equal(loads, 1);
  lifecycle.session(attempt, null);
  lifecycle.route(attempt, false, "/auth");
  router.history.location.href = "/nested";
  listener();
  await Promise.resolve();
  assert.equal(loads, 1, "ready/resume/nested navigation is entirely owned by Router");
  stop();
  listener();
  await Promise.resolve();
  assert.equal(loads, 1);
  assert.equal(unsubscribed, 1);
  lifecycle.stop();
});

test("offline startup recovery is truthful and does not suggest clearing the session", () => {
  const f = shellFixture({ offline: true });
  f.cover();
  f.timers.advance(STARTUP_DEADLINE_MS);
  assert.match(f.api.text(), /You're offline. Reconnect and retry/);
  assert.match(f.api.text(), /session and saved data are unchanged/);
  f.api.dispose();
});
