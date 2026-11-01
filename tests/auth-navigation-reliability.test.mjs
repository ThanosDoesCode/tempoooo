import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";
import ts from "typescript";
import { CancelledError, QueryClient, queryOptions } from "@tanstack/react-query";
import * as network from "../src/lib/network-errors.ts";
import { withStartupDeadline, resolveStartupPhase } from "../src/lib/startup.ts";
import { authenticatedUserChanged } from "../src/lib/query-cancellation.ts";
import { renderToStaticMarkup } from "react-dom/server";
import * as jsxRuntime from "react/jsx-runtime";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");
const auth = await read("src/lib/auth.ts");
const compiled = ts.transpileModule(auth, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
function fixture({ responses = [], offline = false } = {}) {
  let calls = 0,
    signouts = 0,
    effect,
    callback,
    stateIndex = 0;
  const states = [];
  let resolveSession;
  const sessionPromise = new Promise((resolve) => {
    resolveSession = resolve;
  });
  const context = {
    exports: {},
    require(name) {
      if (name === "react")
        return {
          useState(initial) {
            const index = stateIndex++;
            if (!(index in states)) states[index] = initial;
            return [
              states[index],
              (value) => {
                states[index] = value;
              },
            ];
          },
          useEffect(fn) {
            effect = fn;
          },
        };
      if (name === "@tanstack/react-query") return { queryOptions, CancelledError };
      if (name.includes("network-errors"))
        return { ...network, shouldRetryRead: (n, e) => !offline && network.shouldRetryRead(n, e) };
      if (name.includes("startup"))
        return {
          startupDiagnostic() {},
          withStartupDeadline: (promise, phase, onTimeout, timeout) =>
            withStartupDeadline(promise, phase, onTimeout, Math.min(timeout ?? 10000, 15)),
        };
      if (name.includes("supabase/client"))
        return {
          supabase: {
            auth: {
              async getUser() {
                const value = responses[calls++];
                if (value === "pending") return new Promise(() => {});
                return value ?? { data: { user: { id: "a" } }, error: null };
              },
              async signOut() {
                signouts++;
                return { error: null };
              },
              getSession() {
                return sessionPromise;
              },
              onAuthStateChange(fn) {
                callback = fn;
                return { data: { subscription: { unsubscribe() {} } } };
              },
            },
          },
        };
      return {};
    },
  };
  vm.runInNewContext(compiled, context);
  return {
    api: context.exports,
    calls: () => calls,
    signouts: () => signouts,
    hook() {
      stateIndex = 0;
      return context.exports.useAuth();
    },
    mount() {
      effect();
    },
    emit(session) {
      callback("SIGNED_IN", session);
    },
    resolveSession,
  };
}

function client() {
  return new QueryClient({ defaultOptions: { queries: { gcTime: Infinity } } });
}
function options(f) {
  return { ...f.api.authenticatedUserQueryOptions(), retryDelay: 1 };
}

test("validated auth is reused across tab navigation and same-user PWA resume, but revalidated when stale", async () => {
  const f = fixture();
  const qc = client();
  for (const tab of ["Challenge", "Training", "Meals", "Goal", "Profile"]) {
    assert.equal((await qc.fetchQuery(options(f))).id, "a", tab);
  }
  assert.equal(f.calls(), 1);
  assert.equal(authenticatedUserChanged("a", "a"), false);
  qc.setQueryData(["authenticated-user"], { id: "a" }, { updatedAt: Date.now() - 300001 });
  await qc.fetchQuery(options(f));
  assert.equal(f.calls(), 2, "stale identity does not bypass validation indefinitely");
  qc.clear();
});

test("transient getUser failure retries to success without clearing a valid session", async () => {
  const f = fixture({
    responses: [
      { data: { user: null }, error: { status: 503, message: "temporarily unavailable" } },
      { data: { user: { id: "a" } }, error: null },
    ],
  });
  const qc = client();
  const pending = qc.fetchQuery(options(f));
  assert.equal(qc.getQueryState(["authenticated-user"]).fetchStatus, "fetching");
  assert.equal((await pending).id, "a");
  assert.equal(f.calls(), 2);
  assert.equal(f.signouts(), 0);
  qc.clear();
});

test("offline errors never masquerade as invalid sessions; hung validation exhausts bounded retries", async () => {
  const offline = fixture({
    offline: true,
    responses: [{ data: { user: null }, error: { status: 0, message: "Failed to fetch" } }],
  });
  const qc = client();
  await assert.rejects(qc.fetchQuery(options(offline)));
  assert.equal(offline.signouts(), 0);
  qc.clear();
  const delayed = fixture({ responses: ["pending", "pending", "pending"] });
  const bounded = client();
  await assert.rejects(bounded.fetchQuery(options(delayed)), /timed out/);
  assert.equal(delayed.calls(), 3);
  assert.equal(delayed.signouts(), 0);
  assert.equal(bounded.getQueryState(["authenticated-user"]).fetchStatus, "idle");
  bounded.clear();
});

test("confirmed invalid or missing sessions still sign out; unknown server errors do not", async () => {
  for (const error of [
    { status: 401, message: "expired JWT" },
    { name: "AuthSessionMissingError", status: 400 },
    { status: 400, code: "session_not_found" },
  ]) {
    const f = fixture({ responses: [{ data: { user: null }, error }] });
    assert.equal(
      await f.api.authenticatedUserQueryOptions().queryFn({ signal: new AbortController().signal }),
      null,
    );
    assert.equal(f.signouts(), 1);
  }
  const unknown = fixture({
    responses: [{ data: { user: null }, error: { status: 500, message: "provider failure" } }],
  });
  await assert.rejects(
    unknown.api.authenticatedUserQueryOptions().queryFn({ signal: new AbortController().signal }),
  );
  assert.equal(unknown.signouts(), 0);
});

test("delayed getSession cannot overwrite a newer account-switch or logout event", async () => {
  const f = fixture();
  f.hook();
  f.mount();
  f.emit({ user: { id: "b" } });
  f.resolveSession({ data: { session: { user: { id: "a" } } }, error: null });
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(f.hook().user.id, "b");
  f.emit(null);
  assert.equal(f.hook().user, null);
  assert.equal(authenticatedUserChanged("a", "b"), true);
  assert.equal(authenticatedUserChanged("b", null), true);
});

test("shared skeletons keep chrome separate, are reduced-motion safe and activity rows are compact", async () => {
  const source = await read("src/components/PageSkeleton.tsx");
  const context = { exports: {}, require: () => jsxRuntime };
  vm.runInNewContext(
    ts.transpileModule(source, {
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2022,
        jsx: ts.JsxEmit.ReactJSX,
      },
    }).outputText,
    context,
  );
  const html = renderToStaticMarkup(context.exports.ActivityFeedSkeleton());
  assert.equal((html.match(/aria-hidden="true"/g) ?? []).length, 5);
  assert.match(html, /motion-safe:animate-pulse/);
  assert.match(html, /role="status"/);
  const route = await read("src/routes/_authenticated/route.tsx");
  const router = await read("src/router.tsx");
  const root = await read("src/routes/__root.tsx");
  assert.match(route, /fetchQuery\(authenticatedUserQueryOptions\(\)\)/);
  assert.match(route, /pendingComponent: AuthenticatedPending/);
  assert.match(route, /load your account/);
  assert.doesNotMatch(route, /restore your Tempo session/);
  assert.match(router, /defaultPendingComponent: PageSkeleton/);
  assert.match(router, /defaultPreload: "intent"/);
  assert.match(root, /revision !== authEventRevision.current/);
  assert.equal(
    resolveStartupPhase({
      startupComplete: true,
      sessionRestored: true,
      sessionUserId: "a",
      pathname: "/bulk/meals",
      routePending: true,
    }),
    "ready",
  );
});

for (const nextUser of ["b", null]) {
  for (const outcome of ["valid-old-user", "invalid-old-session"]) {
    test(`late getUser (${outcome}) cannot publish or sign out after switch to ${nextUser}`, async () => {
      let resolve;
      const response = new Promise((yes) => {
        resolve = yes;
      });
      const f = fixture({ responses: [response] });
      f.api.observeAuthIdentity("a");
      const qc = client();
      const pending = qc.fetchQuery(options(f));
      f.api.observeAuthIdentity(nextUser);
      resolve(
        outcome === "valid-old-user"
          ? { data: { user: { id: "a" } }, error: null }
          : { data: { user: null }, error: { status: 401 } },
      );
      await assert.rejects(pending, (error) => error instanceof CancelledError);
      assert.equal(f.signouts(), 0);
      assert.equal(qc.getQueryData(["authenticated-user"]), undefined);
      qc.clear();
    });
  }
}

test("first observed auth identity also fences an earlier invalid getUser response", async () => {
  let resolve;
  const f = fixture({
    responses: [
      new Promise((yes) => {
        resolve = yes;
      }),
    ],
  });
  const qc = client();
  const pending = qc.fetchQuery(options(f));
  f.api.observeAuthIdentity("new-account");
  resolve({ data: { user: null }, error: { status: 401 } });
  await assert.rejects(pending, (error) => error instanceof CancelledError);
  assert.equal(f.signouts(), 0);
  qc.clear();
});

test("same-account TOKEN_REFRESHED identity does not invalidate validation", async () => {
  const f = fixture();
  f.api.observeAuthIdentity("a");
  const revision = f.api.captureAuthIdentity();
  f.api.observeAuthIdentity("a");
  assert.equal(f.api.captureAuthIdentity(), revision);
  assert.equal(
    (await f.api.authenticatedUserQueryOptions().queryFn({ signal: new AbortController().signal }))
      .id,
    "a",
  );
});

test("bounded entry-session read cannot overwrite logout and an aborted auth read cannot publish", async () => {
  const f = fixture();
  f.api.observeAuthIdentity("a");
  const pending = f.api.readStartupSession();
  f.api.observeAuthIdentity(null);
  f.resolveSession({ data: { session: { user: { id: "a" } } }, error: null });
  await assert.rejects(pending, (error) => error instanceof CancelledError);
  const g = fixture();
  const abort = new AbortController();
  abort.abort();
  await assert.rejects(
    g.api.authenticatedUserQueryOptions().queryFn({ signal: abort.signal }),
    (error) => error instanceof CancelledError,
  );
  assert.equal(g.signouts(), 0);
});

async function protectedEntry({
  profile,
  memberships = [],
  sync = async () => {},
  refresh,
  invalidate = async () => {},
} = {}) {
  const f = fixture();
  f.api.observeAuthIdentity("a");
  const source = await read("src/routes/_authenticated/route.tsx");
  const context = {
    exports: {},
    require(name) {
      if (name === "@tanstack/react-router")
        return {
          createFileRoute: () => (options) => options,
          redirect: (options) => ({ redirect: options }),
        };
      if (name === "@/lib/auth") return { ...f.api, syncProfile: sync };
      if (name === "@/lib/account-profile")
        return { accountProfileQueryOptions: () => ({ queryKey: ["account-profile"] }) };
      if (name === "@/lib/bulk-access")
        return {
          bulkOwnerQueryOptions: () => ({ queryKey: ["bulk-memberships"] }),
          accountProductMode: () => "fitness",
        };
      if (name === "@/lib/launch-intent")
        return { isGenericLaunch: () => false, recordLaunch() {} };
      if (name === "@/lib/startup")
        return {
          startupDiagnostic() {},
          withStartupDeadline: (promise, phase, onTimeout) =>
            withStartupDeadline(promise, phase, onTimeout, 15),
        };
      if (name === "react/jsx-runtime") return jsxRuntime;
      return {};
    },
  };
  vm.runInNewContext(
    ts.transpileModule(source, {
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2022,
        jsx: ts.JsxEmit.ReactJSX,
      },
    }).outputText,
    context,
  );
  const controller = new AbortController();
  let fetches = 0;
  const queryClient = {
    fetchQuery: async () => (++fetches === 1 ? { id: "a" } : refresh),
    ensureQueryData: ({ queryKey }) =>
      Promise.resolve(queryKey[0] === "account-profile" ? profile : memberships),
    invalidateQueries: invalidate,
    cancelQueries: async () => {},
  };
  return {
    f,
    controller,
    run: () =>
      context.exports.Route.beforeLoad({
        context: { queryClient },
        location: { pathname: "/bulk", href: "/bulk" },
        cause: "enter",
        abortController: controller,
      }),
  };
}

for (const dependency of ["profile", "memberships"]) {
  test(`actual authenticated route bounds a never-settling ${dependency} read`, async () => {
    const pending = new Promise(() => {});
    const g = await protectedEntry({
      profile:
        dependency === "profile" ? pending : { username: "athlete", account_onboarded_at: "yes" },
      memberships: dependency === "memberships" ? pending : [],
    });
    await assert.rejects(g.run(), /timed out/);
    assert.equal(g.f.signouts(), 0);
  });
}

test("actual profile bootstrap invalidation cannot start an unbounded implicit refetch", async () => {
  const invalidations = [];
  const g = await protectedEntry({
    profile: null,
    refresh: { username: "athlete", account_onboarded_at: "yes" },
    invalidate: (options) => {
      invalidations.push(options);
      return options.refetchType === "none" ? Promise.resolve() : new Promise(() => {});
    },
  });
  assert.equal((await g.run()).user.id, "a");
  assert.equal(invalidations.length, 1);
  assert.equal(invalidations[0].refetchType, "none");
});

test("old profile/product-mode results cannot publish route context after account switch or abort", async () => {
  for (const change of ["account", "abort"]) {
    let resolve;
    const g = await protectedEntry({
      profile: new Promise((yes) => {
        resolve = yes;
      }),
    });
    const pending = g.run();
    await Promise.resolve();
    if (change === "account") g.f.api.observeAuthIdentity("b");
    else g.controller.abort();
    resolve({ username: "athlete", account_onboarded_at: "yes" });
    await assert.rejects(pending, (error) => error instanceof CancelledError);
  }
});

test("public entry getSession is bounded even if the SDK auth lock never settles", async () => {
  const f = fixture();
  await assert.rejects(f.api.readStartupSession(), /timed out/);
  assert.equal(f.signouts(), 0);
});

test("an observed valid account still gets network retries and confirmed-invalid sign-out", async () => {
  const f = fixture({
    responses: [
      { data: { user: null }, error: { status: 503 } },
      { data: { user: { id: "a" } }, error: null },
    ],
  });
  f.api.observeAuthIdentity("a");
  const qc = client();
  assert.equal((await qc.fetchQuery(options(f))).id, "a");
  assert.equal(f.calls(), 2);
  assert.equal(f.signouts(), 0);
  qc.clear();
  const invalid = fixture({ responses: [{ data: { user: null }, error: { status: 401 } }] });
  invalid.api.observeAuthIdentity("a");
  assert.equal(
    await invalid.api
      .authenticatedUserQueryOptions()
      .queryFn({ signal: new AbortController().signal }),
    null,
  );
  assert.equal(invalid.signouts(), 1);
});
