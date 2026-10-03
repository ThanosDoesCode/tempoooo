import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import vm from "node:vm";
import ts from "typescript";
import { createMemoryHistory } from "@tanstack/history";
import { trackInAppHistory, backWithinApp } from "../src/lib/in-app-back.ts";
import { shouldRetryRead, readRetryDelay } from "../src/lib/network-errors.ts";

const require = createRequire(import.meta.url);
const reactRouter = require("@tanstack/react-router");
const source = await readFile(new URL("../src/router.tsx", import.meta.url), "utf8");

// Execute the authored factory with actual TanStack Router/Query implementations.
// Only the unrelated application route tree and skeleton are replaced to avoid
// initializing Supabase or any production route data during this startup test.
function routerFactory(browserHistory) {
  const routeTree = reactRouter.createRootRoute();
  const context = {
    exports: {},
    require(name) {
      if (name === "@tanstack/react-router") {
        return {
          ...reactRouter,
          createRouter(options) {
            return reactRouter.createRouter(
              browserHistory ? { ...options, isServer: false, history: browserHistory } : options,
            );
          },
        };
      }
      if (name === "@tanstack/react-query") return require(name);
      if (name === "./routeTree.gen") return { routeTree };
      if (name === "./components/PageSkeleton") return { PageSkeleton: () => null };
      if (name === "./lib/network-errors") return { shouldRetryRead, readRetryDelay };
      if (name === "./lib/in-app-back") return { trackInAppHistory };
      throw Error(`Unexpected import ${name}`);
    },
  };
  vm.runInNewContext(
    ts.transpileModule(source, {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    }).outputText,
    context,
    { filename: "src/router.tsx" },
  );
  return context.exports.getRouter;
}

test("SSR router factory succeeds before TanStack Start attaches request history", () => {
  assert.equal(typeof window, "undefined");
  assert.equal(typeof document, "undefined");
  const getRouter = routerFactory();
  const router = getRouter();
  assert.equal(router.isServer, true);
  assert.equal(router.history, undefined);
  const requestHistory = createMemoryHistory({ initialEntries: ["/bulk/prs"] });
  // This is the later lifecycle step used by TanStack Start's server handler.
  assert.doesNotThrow(() => router.update({ history: requestHistory }));
  assert.equal(router.history.location.pathname, "/bulk/prs");
  assert.equal(backWithinApp(requestHistory), false);
  assert.notEqual(getRouter().options.context.queryClient, router.options.context.queryClient);
});

test("Client factory still observes navigation and preserves actual-origin Back", () => {
  const history = createMemoryHistory({ initialEntries: ["/bulk/training"] });
  const router = routerFactory(history)();
  assert.equal(router.isServer, false);
  history.push("/bulk/prs");
  assert.equal(backWithinApp(router.history), true);
  assert.equal(history.location.pathname, "/bulk/training");
});

test("Client direct deep link retains its safe fallback rather than unknown history", () => {
  const history = createMemoryHistory({ initialEntries: ["/bulk/prs"] });
  routerFactory(history)();
  assert.equal(backWithinApp(history), false);
  assert.equal(history.location.pathname, "/bulk/prs");
});
