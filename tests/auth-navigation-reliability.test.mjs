import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";
import ts from "typescript";
import { QueryClient, queryOptions } from "@tanstack/react-query";
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
      if (name === "@tanstack/react-query") return { queryOptions };
      if (name.includes("network-errors"))
        return { ...network, shouldRetryRead: (n, e) => !offline && network.shouldRetryRead(n, e) };
      if (name.includes("startup"))
        return {
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
    assert.equal(await f.api.authenticatedUserQueryOptions().queryFn(), null);
    assert.equal(f.signouts(), 1);
  }
  const unknown = fixture({
    responses: [{ data: { user: null }, error: { status: 500, message: "provider failure" } }],
  });
  await assert.rejects(unknown.api.authenticatedUserQueryOptions().queryFn());
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
