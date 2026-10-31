import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { QueryClient } from "@tanstack/react-query";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import * as routerApi from "@tanstack/react-router";
import { createMemoryHistory } from "@tanstack/history";
import { animatePrimaryTabChange, isPrimaryTabChange } from "../src/lib/primary-tab-motion.ts";
import { MAIN_TABS, mainTabForPath, isFocusScreen } from "../src/lib/main-navigation.ts";
import { backWithinApp, trackInAppHistory } from "../src/lib/in-app-back.ts";
import { presentationComponent } from "./presentation-component-fixture.mjs";

const paths = new Set(MAIN_TABS.map((item) => item.to));
const read = (file) => readFileSync(new URL(`../${file}`, import.meta.url), "utf8");
const nodes = (tree) =>
  Array.isArray(tree)
    ? tree.flatMap(nodes)
    : tree && typeof tree === "object"
      ? [tree, ...nodes(tree.props?.children)]
      : [];
const jsx = (type, props, key) => ({ type, props, key });

function animationFixture() {
  const calls = [],
    listeners = new Set();
  const media = {
    matches: false,
    addEventListener: (_event, fn) => listeners.add(fn),
    removeEventListener: (_event, fn) => listeners.delete(fn),
  };
  const element = {
    animate(frames, options) {
      const animation = {
        cancelled: false,
        cancel() {
          animation.cancelled = true;
        },
      };
      calls.push({ frames, options, animation });
      return animation;
    },
  };
  return {
    calls,
    listeners,
    media,
    element,
    browser: {
      matchMedia: (query) => {
        assert.equal(query, "(prefers-reduced-motion: reduce)");
        return media;
      },
    },
  };
}

test("only distinct primary tab pages animate, never deep routes, direct entry, same-tab search or +", () => {
  for (const from of paths)
    for (const to of paths) assert.equal(isPrimaryTabChange(from, to, paths), from !== to);
  assert.equal(isPrimaryTabChange("/bulk/", "/profile/", paths), true);
  for (const path of [
    "/bulk/training/more",
    "/bulk/prs/press",
    "/challenge/history/6",
    "/profile/settings",
    "/bulk/workout/id",
    "/challenge/add",
    "/bulk/meals?date=2026-10-08",
  ]) {
    assert.equal(isPrimaryTabChange("/bulk", path, paths), false);
    assert.equal(isPrimaryTabChange(path, "/bulk", paths), false);
  }
  assert.equal(isPrimaryTabChange("/profile", "/profile", paths), false);
});

test("fade uses one existing element for 160ms, with opacity only and no navigation/cache side effects", () => {
  const f = animationFixture();
  const previous = globalThis.window;
  globalThis.window = f.browser;
  const client = new QueryClient();
  client.setQueryData(["cached-workout"], { id: "stable", rpe: 8 });
  try {
    const cleanup = animatePrimaryTabChange(f.element, "/bulk", "/challenge", paths);
    assert.equal(f.calls.length, 1);
    assert.deepEqual(f.calls[0].frames, [{ opacity: 0 }, { opacity: 1 }]);
    assert.deepEqual(f.calls[0].options, { duration: 160, easing: "ease-out" });
    assert.equal(client.getQueryState(["cached-workout"]).isInvalidated, false);
    assert.deepEqual(client.getQueryData(["cached-workout"]), { id: "stable", rpe: 8 });
    cleanup();
    assert.equal(f.calls[0].animation.cancelled, true);
    assert.equal(f.listeners.size, 0);
  } finally {
    globalThis.window = previous;
    client.clear();
  }
});

test("reduced motion is instant and enabling it during a fade cancels the current animation", () => {
  const f = animationFixture(),
    previous = globalThis.window;
  globalThis.window = f.browser;
  try {
    f.media.matches = true;
    assert.equal(animatePrimaryTabChange(f.element, "/bulk", "/challenge", paths), undefined);
    assert.equal(f.calls.length, 0);
    f.media.matches = false;
    const cleanup = animatePrimaryTabChange(f.element, "/bulk", "/challenge", paths);
    f.media.matches = true;
    for (const listener of f.listeners) listener();
    assert.equal(f.calls[0].animation.cancelled, true);
    cleanup();
  } finally {
    globalThis.window = previous;
  }
});

test("server rendering and browsers without Web Animations safely use an instant transition", () => {
  const previous = globalThis.window;
  try {
    delete globalThis.window;
    assert.doesNotThrow(() =>
      animatePrimaryTabChange(
        {
          animate() {
            throw new Error("SSR must not animate");
          },
        },
        "/bulk",
        "/profile",
        paths,
      ),
    );
    globalThis.window = {};
    assert.equal(animatePrimaryTabChange({}, "/bulk", "/profile", paths), undefined);
    assert.equal(animatePrimaryTabChange(null, "/bulk", "/profile", paths), undefined);
  } finally {
    globalThis.window = previous;
  }
});

function transitionFixture() {
  const f = animationFixture();
  const slots = [];
  let index = 0,
    effects = [],
    committed = "/bulk",
    location = "/bulk";
  const react = {
    useRef(value) {
      return (slots[index++] ??= { current: value });
    },
    useLayoutEffect(fn, deps) {
      const n = index++;
      const old = slots[n];
      if (!old || deps.some((dep, i) => dep !== old.deps[i])) {
        slots[n] = { deps };
        effects.push(() => {
          old?.cleanup?.();
          slots[n].cleanup = fn();
        });
      }
    },
  };
  const api = presentationComponent("src/components/PrimaryTabTransition.tsx", {
    react,
    "react/jsx-runtime": { jsx, jsxs: jsx },
    "@tanstack/react-router": {
      useRouterState: ({ select }) =>
        select({ matches: [{ pathname: committed }], location: { pathname: location } }),
    },
    "@/lib/primary-tab-motion": { animatePrimaryTabChange, isPrimaryTabChange },
  });
  const previous = globalThis.window;
  globalThis.window = f.browser;
  return {
    ...f,
    render(next = committed, pending = next) {
      committed = next;
      location = pending;
      index = 0;
      effects = [];
      const tree = api.PrimaryTabTransition({ primaryPaths: paths, children: "same outlet" });
      tree.props.ref.current = f.element;
      for (const run of effects) run();
      return tree;
    },
    close() {
      for (const slot of slots) slot?.cleanup?.();
      globalThis.window = previous;
    },
  };
}

test("transition follows rendered matches, not an outgoing page during a delayed load, and never keys the outlet", () => {
  const f = transitionFixture();
  try {
    const initial = f.render();
    assert.equal(initial.key, undefined);
    assert.equal(initial.props["data-primary-page"], true);
    f.render("/bulk", "/challenge");
    assert.equal(f.calls.length, 0, "a pending URL must not fade the outgoing Today content");
    const committed = f.render("/challenge");
    assert.equal(f.calls.length, 1);
    assert.equal(committed.props.ref, initial.props.ref);
    assert.equal(committed.key, undefined);
    const nested = f.render("/challenge/history");
    assert.equal(f.calls.length, 1);
    assert.equal(nested.props["data-primary-page"], undefined);
    f.render("/challenge");
    assert.equal(
      f.calls.length,
      1,
      "Back from a nested route does not trigger primary-tab animation",
    );
  } finally {
    f.close();
  }
});

test("rapid primary switches cancel prior animations without retained pages; search/refetch/sheet renders do not restart motion", () => {
  const f = transitionFixture();
  try {
    f.render();
    f.render("/challenge");
    f.render("/profile");
    f.render("/bulk/progress");
    assert.equal(f.calls.length, 3);
    assert.equal(f.calls[0].animation.cancelled, true);
    assert.equal(f.calls[1].animation.cancelled, true);
    assert.equal(f.calls[2].animation.cancelled, false);
    f.render("/bulk/progress");
    f.render("/bulk/progress");
    assert.equal(f.calls.length, 3);
  } finally {
    f.close();
  }
});

function shellFixture(core = false) {
  let pathname = core ? "/challenge" : "/bulk",
    pending = false,
    logOpen = false;
  const api = presentationComponent("src/components/AppShell.tsx", {
    react: {
      createContext: () => ({ Provider: "Provider" }),
      useContext: () => false,
      useState: () => [
        logOpen,
        (value) => {
          logOpen = value;
        },
      ],
    },
    "react/jsx-runtime": { jsx, jsxs: jsx, Fragment: "Fragment" },
    "lucide-react": {},
    "@tanstack/react-router": {
      Link: "Link",
      useLocation: () => ({ pathname }),
      useRouterState: ({ select }) => select({ status: pending ? "pending" : "idle" }),
    },
    "@/lib/bulk-access": {
      useMemberships: () => ({ data: [] }),
      preferredBulkMembership: () => (core ? null : { bulk_profile_id: "owner" }),
    },
    "@/lib/store": { prefetchBulk() {} },
    "@/lib/goal-discovery": { useGoalDiscovery: () => ({}) },
    "@/lib/main-navigation": { MAIN_TABS, mainTabForPath, isFocusScreen },
    "./PullToRefresh": { PullToRefresh: "PullToRefresh" },
    "./LogSheet": { LogSheet: "LogSheet" },
    "./HistoryBackLink": {},
    "./NotificationBell": {},
    "./PrimaryTabTransition": { PrimaryTabTransition: "PrimaryTabTransition" },
  });
  const render = () => {
    const shell = api.AppShell({ children: "outlet" });
    const chrome = shell.props.children;
    return chrome.type(chrome.props);
  };
  const tabs = () =>
    nodes(render())
      .filter((node) => node.props?.item)
      .map((node) => node.type(node.props));
  return {
    render,
    tabs,
    navigate(path, isPending = false) {
      pathname = path;
      pending = isPending;
    },
  };
}

test("tab selection responds to the router's pending destination immediately, including rapid taps and nested ownership", () => {
  const f = shellFixture();
  const active = () =>
    f
      .tabs()
      .filter((node) => node.props["aria-current"] === "page")
      .map((node) => node.props.to);
  assert.deepEqual(active(), ["/bulk"]);
  f.navigate("/profile", true);
  assert.deepEqual(active(), ["/profile"]);
  f.navigate("/challenge", true);
  assert.deepEqual(active(), ["/challenge"]);
  f.navigate("/bulk/progress/strength");
  assert.deepEqual(active(), ["/bulk/progress"]);
  f.navigate("/bulk");
  assert.deepEqual(active(), ["/bulk"]);
  assert.ok(
    f
      .tabs()
      .every(
        (node) =>
          node.props.preload === "intent" && node.props.className.includes("duration-150 ease-out"),
      ),
  );
});

test("Challenge-only bar remains Challenge / + / You; Log is an action outside the transition content", () => {
  const f = shellFixture(true);
  assert.deepEqual(
    f.tabs().map((node) => node.props.to),
    ["/challenge", "/profile"],
  );
  const tree = f.render();
  const nav = nodes(tree).find((node) => node.type === "nav");
  assert.match(nav.props.children[1].props.className, /grid-cols-3/);
  const plus = nodes(nav).find(
    (node) => node.type === "button" && node.props["aria-label"] === "Log",
  );
  assert.ok(plus);
  plus.props.onClick();
  const next = f.render();
  assert.equal(nodes(next).find((node) => node.type === "LogSheet").props.open, true);
  const transition = nodes(next).find((node) => node.type === "PrimaryTabTransition");
  assert.equal(
    nodes(transition).some((node) => node.type === "LogSheet" || node.type === "nav"),
    false,
  );
  assert.equal(nodes(next).filter((node) => node.type === "nav").length, 1);
});

test("motion does not change contextual history, scroll restoration or route/query semantics", () => {
  const history = createMemoryHistory({ initialEntries: ["/bulk/training/more"] });
  trackInAppHistory(history);
  history.push("/bulk/exercises");
  assert.equal(backWithinApp(history), true);
  assert.equal(history.location.pathname, "/bulk/training/more");
  const router = read("src/router.tsx");
  assert.match(router, /scrollRestoration: true/);
  const motion =
    read("src/lib/primary-tab-motion.ts") + read("src/components/PrimaryTabTransition.tsx");
  assert.doesNotMatch(
    motion,
    /invalidateQueries|setQueryData|navigate\(|scrollTo\(|setTimeout|key=|<Outlet/,
  );
  const shell = read("src/components/AppShell.tsx");
  assert.doesNotMatch(shell, /key=\{pathname\}/);
  assert.equal((shell.match(/<nav/g) ?? []).length, 1);
  const css = read("src/styles.css");
  assert.match(css, /\.tempo-route-content\s*\{\s*min-width: 0;/);
  assert.match(css, /\.tempo-tab-icon::before\s*\{[^}]*inset: -4px -8px/);
  assert.match(
    css,
    /@media \(prefers-reduced-motion: reduce\)[\s\S]*\.tempo-tab-icon::before\s*\{\s*transition: none;/,
  );
  assert.match(shell, /pb-\[max\(1rem,env\(safe-area-inset-bottom\)\)\]/);
});

test("real TanStack links never mark both Today and Progress active; nested ownership remains canonical", async () => {
  const { AppShell } = presentationComponent("src/components/AppShell.tsx", {
    react: React,
    "@tanstack/react-router": routerApi,
    "@/lib/bulk-access": {
      useMemberships: () => ({ data: [{ bulk_profile_id: "owner" }] }),
      preferredBulkMembership: () => ({ bulk_profile_id: "owner" }),
    },
    "@/lib/store": { prefetchBulk() {} },
    "@/lib/goal-discovery": { useGoalDiscovery: () => ({}) },
    "@/lib/main-navigation": { MAIN_TABS, mainTabForPath, isFocusScreen },
    "./PullToRefresh": { PullToRefresh: ({ children }) => children },
    "./LogSheet": { LogSheet: () => null },
    "./HistoryBackLink": {},
    "./NotificationBell": {},
    "./PrimaryTabTransition": {
      PrimaryTabTransition: ({ children }) => React.createElement("div", {}, children),
    },
  });
  for (const [pathname, label] of [
    ["/bulk/progress", "Progress"],
    ["/bulk/training", "Today"],
    ["/profile/settings", "You"],
  ]) {
    const root = routerApi.createRootRoute({
      component: () => React.createElement(AppShell, {}, React.createElement(routerApi.Outlet)),
    });
    const leaves = [
      "bulk",
      "bulk/progress",
      "bulk/training",
      "profile",
      "profile/settings",
      "challenge",
    ].map((path) =>
      routerApi.createRoute({
        getParentRoute: () => root,
        path,
        component: () => React.createElement("h1", {}, path),
      }),
    );
    const router = routerApi.createRouter({
      routeTree: root.addChildren(leaves),
      history: createMemoryHistory({ initialEntries: [pathname] }),
    });
    await router.load();
    const markup = renderToStaticMarkup(React.createElement(routerApi.RouterProvider, { router }));
    const active = markup.match(/<a\b[^>]*aria-current="page"[^>]*>/g) ?? [];
    assert.equal(active.length, 1, pathname);
    assert.ok(active[0].includes(`aria-label="${label}"`), active[0]);
  }
});
