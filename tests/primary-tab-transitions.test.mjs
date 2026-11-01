import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { QueryClient } from "@tanstack/react-query";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import * as routerApi from "@tanstack/react-router";
import { createMemoryHistory } from "@tanstack/history";
import {
  animatePrimaryTabChange,
  capturePrimaryTabSnapshot,
  isPrimaryTabChange,
  primaryTabDirection,
} from "../src/lib/primary-tab-motion.ts";
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
  const document = { createElement: (tag) => new Node(tag) };
  class Node {
    constructor(tag = "div") {
      this.tagName = tag;
      this.children = [];
      this.attrs = new Map();
      this.style = {};
      this.ownerDocument = document;
      this.textContent = "outgoing Today";
      this.className = "";
      this.classList = {
        add: (name) => {
          this.className += " " + name;
        },
        remove: (name) => {
          this.className = this.className
            .split(" ")
            .filter((value) => value !== name)
            .join(" ");
        },
      };
    }
    get id() {
      return this.attrs.get("id") ?? "";
    }
    set id(value) {
      this.attrs.set("id", value);
    }
    get attributes() {
      return [...this.attrs].map(([name, value]) => ({ name, value }));
    }
    setAttribute(name, value) {
      this.attrs.set(name, String(value));
    }
    removeAttribute(name) {
      this.attrs.delete(name);
    }
    append(child) {
      child.parent = this;
      this.children.push(child);
    }
    remove() {
      if (this.parent)
        this.parent.children = this.parent.children.filter((child) => child !== this);
      this.parent = null;
    }
    querySelectorAll(selector) {
      const all = this.children.flatMap((child) => [child, ...child.querySelectorAll("*")]);
      return all.filter((node) =>
        selector
          .split(",")
          .some(
            (part) =>
              part === "*" ||
              (part.startsWith("[") ? node.attrs.has(part.slice(1, -1)) : node.tagName === part),
          ),
      );
    }
    cloneNode() {
      const clone = new Node(this.tagName);
      clone.attrs = new Map(this.attrs);
      clone.style = { ...this.style };
      clone.textContent = this.textContent;
      for (const child of this.children) clone.append(child.cloneNode(true));
      return clone;
    }
    getBoundingClientRect() {
      return { left: 20, top: 16, bottom: 1200, width: 280, height: 1184 };
    }
    animate(frames, options) {
      const animation = {
        cancelled: false,
        onfinish: null,
        cancel() {
          this.cancelled = true;
        },
        finish() {
          this.onfinish?.();
        },
      };
      calls.push({ node: this, frames, options, animation });
      return animation;
    }
  }
  document.body = new Node("body");
  const element = new Node();
  return {
    calls,
    listeners,
    media,
    element,
    document,
    node: (tag) => new Node(tag),
    browser: {
      innerHeight: 780,
      matchMedia: (query) => {
        assert.equal(query, "(prefers-reduced-motion: reduce)");
        return media;
      },
    },
  };
}

test("only distinct primary tab pages animate; direction follows Today / Challenge / Progress, including core mode", () => {
  for (const from of paths)
    for (const to of paths) assert.equal(isPrimaryTabChange(from, to, paths), from !== to);
  assert.equal(primaryTabDirection("/bulk", "/challenge", paths), 1);
  assert.equal(primaryTabDirection("/bulk/progress", "/challenge", paths), -1);
  assert.equal(primaryTabDirection("/challenge", "/bulk/progress", paths), 1);
  assert.equal(isPrimaryTabChange("/bulk/", "/bulk/progress/", paths), true);
  // Profile is account-level: opening or leaving it never runs a primary-tab transition.
  assert.equal(paths.has("/profile"), false);
  assert.equal(isPrimaryTabChange("/bulk", "/profile", paths), false);
  assert.equal(isPrimaryTabChange("/profile", "/challenge", paths), false);
  for (const path of [
    "/bulk/training/more",
    "/bulk/prs/press",
    "/challenge/history/6",
    "/profile/settings",
    "/bulk/workout/id",
    "/challenge/add",
  ]) {
    assert.equal(isPrimaryTabChange("/bulk", path, paths), false);
    assert.equal(isPrimaryTabChange(path, "/bulk", paths), false);
  }
});

test("outgoing snapshot and incoming content overlap for 180ms without query/cache effects; finishing removes every layer", () => {
  const f = animationFixture(),
    previous = globalThis.window,
    client = new QueryClient();
  globalThis.window = f.browser;
  client.setQueryData(["workout"], { id: "stable", rpe: 8 });
  try {
    f.element.className = "tempo-tab-live";
    const snapshot = capturePrimaryTabSnapshot(f.element);
    assert.equal(snapshot.visual.className.includes("tempo-tab-live"), false);
    assert.equal(snapshot.layer.attrs.has("inert"), true);
    assert.equal(
      snapshot.layer.parent,
      undefined,
      "capture is detached until the incoming DOM commits",
    );
    assert.equal(snapshot.layer.inert, true);
    assert.equal(snapshot.layer.attrs.get("aria-hidden"), "true");
    f.element.textContent = "incoming Challenge";
    const cleanup = animatePrimaryTabChange(f.element, "/bulk", "/challenge", paths, snapshot);
    assert.equal(f.calls.length, 3);
    assert.deepEqual(f.calls[0].frames, [
      { opacity: 0.88, transform: "translateX(6px)" },
      { opacity: 1, transform: "translateX(0)" },
    ]);
    assert.deepEqual(f.calls[1].frames, [
      { opacity: 1, transform: "translateX(0)" },
      { opacity: 0.88, transform: "translateX(-4px)" },
    ]);
    assert.deepEqual(f.calls[2].frames, [{ opacity: 1 }, { opacity: 0 }]);
    assert.ok(f.calls.every((call) => call.options.duration === 180));
    assert.equal(snapshot.visual.textContent, "outgoing Today");
    assert.equal(f.document.body.children.length, 1);
    assert.equal(client.getQueryState(["workout"]).isInvalidated, false);
    assert.deepEqual(client.getQueryData(["workout"]), { id: "stable", rpe: 8 });
    f.calls[2].animation.finish();
    assert.equal(f.document.body.children.length, 0);
    assert.ok(f.calls.every((call) => call.animation.cancelled));
    assert.equal(f.listeners.size, 0);
    cleanup();
  } finally {
    globalThis.window = previous;
    client.clear();
  }
});

test("reverse switches enter from -6px and exit +4px; snapshots preserve the old visible viewport without document-height changes", () => {
  const f = animationFixture(),
    previous = globalThis.window;
  globalThis.window = f.browser;
  try {
    f.element.getBoundingClientRect = () => ({
      left: 20,
      top: -764,
      bottom: 900,
      width: 280,
      height: 1664,
    });
    const snapshot = capturePrimaryTabSnapshot(f.element);
    assert.equal(snapshot.layer.style.top, "0px");
    assert.equal(snapshot.layer.style.height, "780px");
    assert.equal(snapshot.visual.style.top, "-764px");
    const cleanup = animatePrimaryTabChange(f.element, "/bulk/progress", "/bulk", paths, snapshot);
    assert.equal(f.calls[0].frames[0].transform, "translateX(-6px)");
    assert.equal(f.calls[1].frames[1].transform, "translateX(4px)");
    cleanup();
  } finally {
    globalThis.window = previous;
  }
});

test("snapshot is noninteractive, removes embedded execution/media/autofocus and remaps IDs plus SVG references", () => {
  const f = animationFixture(),
    previous = globalThis.window;
  globalThis.window = f.browser;
  try {
    for (const tag of ["script", "iframe", "object", "video", "audio", "link"])
      f.element.append(f.node(tag));
    const gradient = f.node("linearGradient");
    gradient.id = "gradient";
    f.element.append(gradient);
    const shape = f.node("rect");
    shape.setAttribute("fill", "url(#gradient)");
    f.element.append(shape);
    const input = f.node("input");
    input.id = "weight";
    input.setAttribute("autofocus", "");
    input.setAttribute("name", "weight");
    input.setAttribute("onfocus", "bad()");
    f.element.append(input);
    const snapshot = capturePrimaryTabSnapshot(f.element);
    assert.equal(
      snapshot.visual.querySelectorAll("script,iframe,object,video,audio,link").length,
      0,
    );
    const copy = snapshot.visual.querySelectorAll("input")[0];
    assert.notEqual(copy.id, "weight");
    assert.equal(copy.tabIndex, -1);
    assert.equal(copy.attrs.has("autofocus"), false);
    assert.equal(copy.attrs.has("name"), false);
    assert.equal(copy.attrs.has("onfocus"), false);
    assert.equal(
      snapshot.visual.querySelectorAll("rect")[0].attrs.get("fill"),
      `url(#${snapshot.visual.querySelectorAll("linearGradient")[0].id})`,
    );
  } finally {
    globalThis.window = previous;
  }
});

test("reduced motion never clones or translates, and changing the preference removes an in-flight snapshot immediately", () => {
  const f = animationFixture(),
    previous = globalThis.window;
  globalThis.window = f.browser;
  try {
    f.media.matches = true;
    assert.equal(capturePrimaryTabSnapshot(f.element), null);
    assert.equal(animatePrimaryTabChange(f.element, "/bulk", "/challenge", paths, null), undefined);
    assert.equal(f.calls.length, 0);
    f.media.matches = false;
    const snapshot = capturePrimaryTabSnapshot(f.element);
    animatePrimaryTabChange(f.element, "/bulk", "/challenge", paths, snapshot);
    f.media.matches = true;
    for (const listener of f.listeners) listener();
    assert.equal(f.document.body.children.length, 0);
    assert.ok(f.calls.every((call) => call.animation.cancelled));
  } finally {
    globalThis.window = previous;
  }
});

test("SSR, hidden content and browsers without Web Animations safely skip capture", () => {
  const f = animationFixture(),
    previous = globalThis.window;
  try {
    delete globalThis.window;
    assert.equal(capturePrimaryTabSnapshot(f.element), null);
    globalThis.window = f.browser;
    assert.equal(capturePrimaryTabSnapshot({}), null);
    f.element.getBoundingClientRect = () => ({ left: 0, top: 1000, bottom: 1200, width: 320 });
    assert.equal(capturePrimaryTabSnapshot(f.element), null);
  } finally {
    globalThis.window = previous;
  }
});

function transitionFixture() {
  const f = animationFixture();
  let committed = "/bulk",
    pending = "/bulk",
    instance;
  const api = presentationComponent("src/components/PrimaryTabTransition.tsx", {
    react: React,
    "react/jsx-runtime": { jsx, jsxs: jsx },
    "@tanstack/react-router": {
      useRouterState: ({ select }) =>
        select({ matches: [{ pathname: committed }], location: { pathname: pending } }),
    },
    "@/lib/primary-tab-motion": {
      animatePrimaryTabChange,
      capturePrimaryTabSnapshot,
      isPrimaryTabChange,
    },
  });
  const previous = globalThis.window;
  globalThis.window = f.browser;
  return {
    ...f,
    render(next = committed, url = next) {
      committed = next;
      pending = url;
      const node = api.PrimaryTabTransition({ primaryPaths: paths, children: "one outlet" });
      if (!instance) {
        instance = new node.type(node.props);
        const tree = instance.render();
        tree.props.children.props.ref.current = f.element;
        return tree;
      }
      const previousProps = instance.props;
      instance.props = node.props;
      const snapshot = instance.getSnapshotBeforeUpdate(previousProps);
      f.element.textContent = next;
      instance.componentDidUpdate(previousProps, {}, snapshot);
      return instance.render();
    },
    close() {
      instance?.componentWillUnmount();
      globalThis.window = previous;
    },
  };
}

test("snapshot lifecycle captures the outgoing content before DOM replacement, waits for rendered matches, and excludes nested navigation", () => {
  const f = transitionFixture();
  try {
    const initial = f.render();
    assert.equal(initial.key, undefined);
    f.render("/bulk", "/challenge");
    assert.equal(f.calls.length, 0);
    const committed = f.render("/challenge");
    assert.equal(f.calls.length, 3);
    assert.equal(f.document.body.children[0].children[0].textContent, "/bulk");
    assert.equal(committed.props.children.props.ref, initial.props.children.props.ref);
    const nested = f.render("/challenge/history");
    assert.equal(f.calls.length, 3);
    assert.equal(f.document.body.children.length, 0);
    assert.equal(nested.props["data-primary-page"], undefined);
    f.render("/challenge");
    assert.equal(f.calls.length, 3);
  } finally {
    f.close();
  }
});

test("rapid switches keep at most one inert snapshot and cancel prior motion; same-route refetch/sheet renders do not restart it", () => {
  const f = transitionFixture();
  try {
    f.render();
    for (const next of ["/challenge", "/bulk/progress", "/bulk"]) {
      f.render(next);
      assert.equal(f.document.body.children.length, 1);
    }
    assert.equal(f.calls.length, 9);
    assert.ok(f.calls.slice(0, 6).every((call) => call.animation.cancelled));
    assert.ok(f.calls.slice(6).every((call) => !call.animation.cancelled));
    f.render();
    f.render();
    assert.equal(f.calls.length, 9);
    f.close();
    assert.equal(f.document.body.children.length, 0);
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
    "./ProfileButton": { ProfileButton: () => null },
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

test("Challenge-only bar is Challenge / +; Log is an action outside the transition content", () => {
  const f = shellFixture(true);
  assert.deepEqual(
    f.tabs().map((node) => node.props.to),
    ["/challenge"],
  );
  const tree = f.render();
  const nav = nodes(tree).find((node) => node.type === "nav");
  assert.match(nav.props.children[1].props.className, /grid-cols-2/);
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
  assert.match(css, /overflow-x: clip/);
  assert.match(
    css,
    /\.tempo-tab-snapshot\s*\{[^}]*position: fixed;[^}]*overflow: hidden;[^}]*pointer-events: none;/,
  );
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
    "./PrimaryTabTransition": {
      PrimaryTabTransition: ({ children }) => React.createElement("div", {}, children),
    },
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
