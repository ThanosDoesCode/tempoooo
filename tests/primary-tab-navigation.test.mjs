import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import * as routerApi from "@tanstack/react-router";
import { createMemoryHistory } from "@tanstack/history";
import { MAIN_TABS, mainTabForPath, isFocusScreen } from "../src/lib/main-navigation.ts";
import { backWithinApp, trackInAppHistory } from "../src/lib/in-app-back.ts";
import { presentationComponent } from "./presentation-component-fixture.mjs";

const read = (file) => readFileSync(new URL(`../${file}`, import.meta.url), "utf8");
const nodes = (tree) =>
  Array.isArray(tree)
    ? tree.flatMap(nodes)
    : tree && typeof tree === "object"
      ? [tree, ...nodes(tree.props?.children)]
      : [];
const jsx = (type, props, key) => ({ type, props, key });

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
    "./ProfileButton": { ProfileButton: () => null },
    "./NotificationBell": {},
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
  // Profile is account-level: navigating there lights no bottom tab (no false Progress/Today).
  f.navigate("/profile", true);
  assert.deepEqual(active(), []);
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

test("tab switches render the one live outlet directly: no transition layer, snapshot or motion", () => {
  const f = shellFixture();
  for (const path of ["/bulk", "/challenge", "/bulk/progress", "/bulk"]) {
    f.navigate(path);
    const main = nodes(f.render()).find((node) => node.type === "main");
    assert.equal(main.props.children, "outlet", path); // the router outlet itself, unwrapped
    assert.equal(main.props["data-primary-page"], true, path);
  }
  f.navigate("/bulk/progress/strength");
  const nested = nodes(f.render()).find((node) => node.type === "main");
  assert.equal(nested.props.children, "outlet");
  assert.equal(nested.props["data-primary-page"], undefined); // nested screens keep their motion
  // Tab links navigate synchronously through the router: no delayed or intercepted clicks.
  for (const tab of f.tabs()) {
    assert.equal(tab.type, "Link");
    assert.equal(tab.props.onClick, undefined);
  }

  for (const file of ["src/components/PrimaryTabTransition.tsx", "src/lib/primary-tab-motion.ts"])
    assert.equal(existsSync(new URL(`../${file}`, import.meta.url)), false, file);
  const shell = read("src/components/AppShell.tsx");
  const css = read("src/styles.css");
  assert.doesNotMatch(shell, /PrimaryTabTransition|primary-tab-motion|\.animate\(|setTimeout/);
  assert.doesNotMatch(css, /tempo-tab-snapshot|tempo-tab-live|tempo-route-content/);
  // Primary pages appear instantly; only the nav icon keeps its own pressed/active feedback.
  assert.match(css, /main\[data-primary-page="true"\] \.fade-up\s*\{\s*animation: none;/);
  assert.match(css, /\.tempo-tab-link\[aria-current="page"\] \.tempo-tab-icon::before/);
});

test("Challenge-only bar is Challenge / + / Community; Log is an action outside the page content", () => {
  const f = shellFixture(true);
  assert.deepEqual(
    f.tabs().map((node) => node.props.to),
    ["/challenge", "/community"],
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
  const main = nodes(next).find((node) => node.type === "main");
  assert.equal(
    nodes(main).some((node) => node.type === "LogSheet" || node.type === "nav"),
    false,
  );
  assert.equal(nodes(next).filter((node) => node.type === "nav").length, 1);
});

test("nested navigation, contextual history and scroll restoration are unchanged", () => {
  const history = createMemoryHistory({ initialEntries: ["/bulk/training/more"] });
  trackInAppHistory(history);
  history.push("/bulk/exercises");
  assert.equal(backWithinApp(history), true);
  assert.equal(history.location.pathname, "/bulk/training/more");
  const router = read("src/router.tsx");
  assert.match(router, /scrollRestoration: true/);
  const shell = read("src/components/AppShell.tsx");
  assert.doesNotMatch(shell, /key=\{pathname\}/);
  assert.equal((shell.match(/<nav/g) ?? []).length, 1);
  const css = read("src/styles.css");
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
    "./ProfileButton": { ProfileButton: () => null },
    "./NotificationBell": {},
  });
  // null = an account-level screen: no bottom tab may claim it.
  for (const [pathname, label] of [
    ["/bulk/progress", "Progress"],
    ["/bulk/training", "Today"],
    ["/profile/settings", null],
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
    assert.equal(active.length, label ? 1 : 0, pathname);
    if (label) assert.ok(active[0].includes(`aria-label="${label}"`), active[0]);
  }
});
