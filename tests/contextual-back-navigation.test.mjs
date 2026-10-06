import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createMemoryHistory } from "@tanstack/history";
import {
  createRootRoute,
  createRoute,
  createRouter,
  defaultParseSearch,
} from "@tanstack/react-router";
import ts from "typescript";
import * as contextualBack from "../src/lib/in-app-back.ts";
import { presentationComponent } from "./presentation-component-fixture.mjs";

const { trackInAppHistory, inAppBackPath, inAppBackLocation, backWithinApp } = contextualBack;

// Use the authored shared control and PageHeader, with real TanStack history and URL building.
// Only hooks/application chrome are replaced; no auth, network, or write operations run.
function controls(history) {
  const root = createRootRoute();
  const parameterizedActivity = createRoute({
    getParentRoute: () => root,
    path: "/challenge/activity/$activityId",
  });
  const router = createRouter({ routeTree: root.addChildren([parameterizedActivity]), history });
  const { HistoryBackLink } = presentationComponent("src/components/HistoryBackLink.tsx", {
    "@tanstack/react-router": {
      useRouter: () => router,
      useRouterState: ({ select }) => select({ location: { href: history?.location.href ?? "/" } }),
      defaultParseSearch,
      Link: ({ to, search, hash, params, preload, ...props }) =>
        React.createElement("a", {
          ...props,
          href: router.buildLocation({ to, search, hash, params }).href,
        }),
    },
    "@/lib/in-app-back": contextualBack,
  });
  const { PageHeader } = presentationComponent("src/components/AppShell.tsx", {
    "@tanstack/react-router": { Link: "a" },
    "@/lib/bulk-access": {},
    "@/lib/store": {},
    "@/lib/goal-discovery": {},
    "@/lib/main-navigation": {},
    "@/lib/challenge-invitations": {},
    "./PullToRefresh": {},
    "./LogSheet": {},
    "./HistoryBackLink": { HistoryBackLink },
  });
  const href = (link) =>
    router.buildLocation({
      to: link.props.to,
      search: link.props.search,
      hash: link.props.hash,
      params: link.props.params,
    }).href;
  const headerLink = (props) => {
    const back = PageHeader({ title: "Screen", ...props }).props.children[0];
    assert.equal(back.type, HistoryBackLink, "all PageHeader Back controls use the same component");
    return HistoryBackLink(back.props);
  };
  return { HistoryBackLink, PageHeader, headerLink, href };
}

function click(link, history, href, modifiers = {}) {
  const event = {
    button: 0,
    metaKey: false,
    ctrlKey: false,
    shiftKey: false,
    altKey: false,
    defaultPrevented: false,
    preventDefault() {
      this.defaultPrevented = true;
    },
    ...modifiers,
  };
  link.props.onClick(event);
  if (
    !event.defaultPrevented &&
    event.button === 0 &&
    !event.metaKey &&
    !event.ctrlKey &&
    !event.shiftKey &&
    !event.altKey
  )
    history.push(href(link));
  return event;
}

// Read actual route PageHeader fallbacks rather than duplicating the route mapping in the test.
function routeHeader(file, fallback) {
  const source = readFileSync(new URL(`../${file}`, import.meta.url), "utf8");
  const ast = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  let result;
  const visit = (node) => {
    if (
      (ts.isJsxSelfClosingElement(node) || ts.isJsxOpeningElement(node)) &&
      node.tagName.getText(ast) === "PageHeader"
    ) {
      const props = Object.fromEntries(
        node.attributes.properties
          .filter((p) => ts.isJsxAttribute(p) && p.initializer && ts.isStringLiteral(p.initializer))
          .map((p) => [p.name.getText(ast), p.initializer.text]),
      );
      if (props.backTo === fallback) result = props;
    }
    ts.forEachChild(node, visit);
  };
  visit(ast);
  assert.ok(result, `${file} has its safe fallback on the shared PageHeader`);
  return result;
}

function presetsPageLink(history, mode = "public") {
  const shared = controls(history);
  const { Route } = presentationComponent("src/routes/_authenticated/bulk/meals_.presets.tsx", {
    "@tanstack/react-router": { createFileRoute: () => (options) => options },
    "@/components/AppShell": { AppShell: "main", PageHeader: shared.PageHeader },
    "@/components/BulkMealPresets": { BulkMealPresets: "PresetManager" },
    "@/lib/store": { useBulkMeta: () => ({ bulkId: "current-owner-profile" }) },
    "@/lib/bulk-access": { useMemberships: () => ({ data: [] }), bulkPlanModeFor: () => mode },
  });
  const page = Route.component();
  const header = page.props.children.find((child) => child?.type === shared.PageHeader);
  assert.equal(
    page.props.children[1].props.bulkProfileId,
    "current-owner-profile",
    "preset ownership/data path stays unchanged",
  );
  return { ...shared, link: shared.headerLink(header.props) };
}

for (const mode of ["public", "legacy"]) {
  for (const [origin, label] of [
    ["/bulk/meals?date=2026-10-05#quick-add", "Meals"],
    ["/bulk/meals/add?date=2026-10-04#presets", "Add meal"],
  ]) {
    test(`${mode} ${label} -> Manage presets -> Back restores the actual origin, query and hash`, () => {
      const history = createMemoryHistory({ initialEntries: [origin] });
      trackInAppHistory(history);
      history.push("/bulk/meals/presets#manage");
      const { link, href } = presetsPageLink(history, mode);
      assert.equal(
        href(link),
        origin,
        "the link itself preserves origin context for modified clicks",
      );
      assert.match(renderToStaticMarkup(link), new RegExp(label));
      assert.equal(link.props.preload, "intent");
      assert.equal(click(link, history, href).defaultPrevented, true);
      assert.equal(history.location.href, origin);
      history.forward();
      assert.equal(history.location.href, "/bulk/meals/presets#manage");
    });
  }
}

test("direct Meal Presets entry has a safe Meals fallback, not an unobserved history entry", () => {
  const history = createMemoryHistory({
    initialEntries: ["/unobserved", "/bulk/meals/presets"],
    initialIndex: 1,
  });
  trackInAppHistory(history);
  const { link, href } = presetsPageLink(history);
  assert.equal(inAppBackPath(history), undefined);
  assert.equal(href(link), "/bulk/meals");
  assert.equal(click(link, history, href).defaultPrevented, false);
  assert.equal(history.location.pathname, "/bulk/meals");
});

const flows = [
  [
    "/bulk/training/more?panel=options#days",
    "/bulk/training/more?panel=plan",
    "bulk/training_.more.tsx",
    "/bulk/training",
    "Your plan",
  ],
  [
    "/bulk/training",
    "/bulk/training/more",
    "bulk/training_.more.tsx",
    "/bulk/training",
    "Training",
  ],
  ["/bulk/progress", "/bulk/prs", "bulk/prs.tsx", "/bulk/training", "Progress"],
  ["/bulk/training", "/bulk/prs", "bulk/prs.tsx", "/bulk/training", "Training"],
  [
    "/bulk/progress/body/food?period=8#days",
    "/bulk/meals/history",
    "bulk/meals_.history.tsx",
    "/bulk/meals",
    "Food details",
  ],
  ["/bulk/meals", "/bulk/meals/history", "bulk/meals_.history.tsx", "/bulk/meals", "Meals"],
  [
    "/bulk/progress/body",
    "/bulk/progress/photos",
    "bulk/progress_.photos.tsx",
    "/bulk/progress/body",
    "Body &amp; food",
  ],
  [
    "/bulk/progress/strength",
    "/bulk/progress/strength/Bench",
    "bulk/progress_.strength_.$lift.tsx",
    "/bulk/progress/strength",
    "Strength",
  ],
  [
    "/bulk/progress/body",
    "/bulk/progress/body/food",
    "bulk/progress_.body_.food.tsx",
    "/bulk/progress/body",
    "Body &amp; food",
  ],
  ["/bulk/progress", "/bulk/check-in", "bulk/check-in.tsx", "/bulk/progress", "Progress"],
  ["/challenge/history", "/challenge/terms", "challenge/terms.tsx", "/challenge", "History"],
  ["/challenge", "/challenge/money", "challenge/money.tsx", "/challenge", "Challenge"],
  [
    "/challenge/terms",
    "/challenge/terms/override",
    "challenge/terms_.override.tsx",
    "/challenge/terms",
    "Terms",
  ],
  [
    "/challenge/terms",
    "/challenge/terms/pause",
    "challenge/terms_.pause.tsx",
    "/challenge/terms",
    "Terms",
  ],
  [
    "/challenge/history",
    "/challenge/history/week/2",
    "challenge/history_.week.$weekNumber.tsx",
    "/challenge/history",
    "History",
  ],
  ["/profile", "/bulk/more", "bulk/more.tsx", "/profile", "You"],
  ["/profile", "/bulk/diagnostics", "bulk/diagnostics.tsx", "/profile", "You"],
  ["/profile", "/bulk/daily-log", "bulk/daily-log.tsx", "/bulk", "You"],
  ["/profile", "/bulk/history", "bulk/history.tsx", "/profile", "You"],
  ["/bulk", "/bulk/morning", "bulk/morning.tsx", "/bulk", "Today"],
];

for (const [origin, destination, route, fallback, label] of flows) {
  test(`contextual Back ${destination} -> ${origin} uses actual route wiring and origin label`, () => {
    const history = createMemoryHistory({ initialEntries: [origin] });
    trackInAppHistory(history);
    history.push(destination);
    const { headerLink, href } = controls(history);
    const link = headerLink(routeHeader(`src/routes/_authenticated/${route}`, fallback));
    assert.equal(href(link), origin);
    assert.match(renderToStaticMarkup(link), new RegExp(label));
    assert.equal(click(link, history, href).defaultPrevented, true);
    assert.equal(history.location.href, origin);
    history.forward();
    assert.equal(history.location.href, destination);
  });
}

test("Strength -> Workout history -> Detail -> History preserves list context then Strength", () => {
  const origin = "/bulk/progress/strength";
  const list = "/bulk/training/history#last-week";
  const detail = "/bulk/training/history?session=12345678-1234-4234-9234-123456789012";
  const history = createMemoryHistory({ initialEntries: [origin] });
  trackInAppHistory(history);
  history.push(list);
  history.push(detail);
  const { HistoryBackLink, href } = controls(history);
  const link = HistoryBackLink({
    fallback: "/bulk/training/history",
    fallbackLabel: "History",
    parentPath: "/bulk/training/history",
    fallbackSearch: {},
  });
  assert.equal(href(link), list);
  click(link, history, href);
  assert.equal(history.location.href, list);
  const parent = HistoryBackLink({ fallback: "/bulk/training", fallbackLabel: "Training" });
  assert.match(renderToStaticMarkup(parent), /Strength/);
  click(parent, history, href);
  assert.equal(history.location.pathname, origin);
  history.forward();
  history.forward();
  assert.equal(history.location.href, detail);
});

for (const [path, label] of [
  ["/bulk/training/history", "History"],
  ["/bulk/prs", "Personal records"],
]) {
  test(`${label} query detail uses its list fallback, never skips the list on a direct entry`, () => {
    const history = createMemoryHistory({ initialEntries: ["/bulk/progress/strength"] });
    trackInAppHistory(history);
    history.push(`${path}?record=selected#detail`);
    const { HistoryBackLink, href } = controls(history);
    const link = HistoryBackLink({
      fallback: path,
      fallbackLabel: label,
      parentPath: path,
      fallbackSearch: {},
    });
    assert.equal(href(link), path);
    assert.equal(click(link, history, href).defaultPrevented, false);
    assert.equal(history.location.href, path);
  });
}

test("direct detail routes retain their actual safe parent fallbacks", () => {
  for (const [, destination, route, fallback] of flows) {
    const history = createMemoryHistory({ initialEntries: [destination] });
    trackInAppHistory(history);
    const { headerLink, href } = controls(history);
    const props = routeHeader(`src/routes/_authenticated/${route}`, fallback);
    const link = headerLink(props);
    assert.equal(href(link), fallback);
    assert.match(renderToStaticMarkup(link), new RegExp(props.backLabel.replaceAll("&", "&amp;")));
  }
});

test("parameterized activity fallback and Add meal local-date fallback stay intact", () => {
  const history = createMemoryHistory({ initialEntries: ["/challenge/add?edit=activity"] });
  const { headerLink, href } = controls(history);
  const link = headerLink({
    backTo: "/challenge/activity/$activityId",
    backParams: { activityId: "owned-activity" },
    backLabel: "Activity",
  });
  assert.equal(href(link), "/challenge/activity/owned-activity");
  const meal = headerLink({
    backTo: "/bulk/meals",
    backLabel: "Meals",
    backSearch: { date: "2026-10-05" },
  });
  assert.equal(href(meal), "/bulk/meals?date=2026-10-05");
});

test("modified clicks retain an origin-aware URL and do not consume current-tab history", () => {
  for (const modifiers of [
    { metaKey: true },
    { ctrlKey: true },
    { shiftKey: true },
    { altKey: true },
    { button: 1 },
  ]) {
    const history = createMemoryHistory({
      initialEntries: ["/bulk/meals/add?date=2026-10-05#presets"],
    });
    trackInAppHistory(history);
    history.push("/bulk/meals/presets");
    const { link, href } = presetsPageLink(history);
    assert.equal(href(link), "/bulk/meals/add?date=2026-10-05#presets");
    assert.equal(click(link, history, href, modifiers).defaultPrevented, false);
    assert.equal(history.location.pathname, "/bulk/meals/presets");
  }
});

test("Back location follows replace, branched history and Forward without stale labels or query/hash", () => {
  const history = createMemoryHistory({
    initialEntries: ["/bulk/meals?date=2026-10-05#quick-add"],
  });
  trackInAppHistory(history);
  history.push("/bulk/meals/presets");
  history.replace("/bulk/meals/presets#editing");
  assert.ok(backWithinApp(history));
  history.push("/bulk/meals/add?date=2026-10-04#custom");
  history.push("/bulk/meals/presets");
  assert.deepEqual(inAppBackLocation(history), {
    pathname: "/bulk/meals/add",
    search: "?date=2026-10-04",
    hash: "#custom",
  });
  const { link, href } = presetsPageLink(history);
  assert.match(renderToStaticMarkup(link), /Add meal/);
  click(link, history, href);
  history.forward();
  assert.equal(history.location.href, "/bulk/meals/presets");
});

test("SSR and auth/setup transitions use safe fallbacks without browser APIs or history escape", () => {
  assert.equal(typeof window, "undefined");
  assert.equal(typeof document, "undefined");
  assert.equal(inAppBackPath(undefined), undefined);
  assert.equal(backWithinApp(undefined), false);
  for (const origin of ["/", "/auth", "/onboarding", "/bulk-onboarding", "/setup/goal"]) {
    const history = createMemoryHistory({ initialEntries: [origin] });
    trackInAppHistory(history);
    history.push("/bulk/meals/presets");
    assert.equal(inAppBackPath(history), undefined);
    assert.doesNotThrow(() => renderToStaticMarkup(presetsPageLink(history).link));
  }
});
