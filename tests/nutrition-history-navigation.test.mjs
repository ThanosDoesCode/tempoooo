import { test } from "node:test";
import assert from "node:assert/strict";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createMemoryHistory } from "@tanstack/history";
import { defaultParseSearch } from "@tanstack/react-router";
import { presentationComponent } from "./presentation-component-fixture.mjs";
import * as contextualBack from "../src/lib/in-app-back.ts";
const { inAppBackPath, trackInAppHistory } = contextualBack;
import { iso } from "../src/lib/calc.ts";

const historyPath = "/bulk/meals/history";

// Exercise the authored route -> PageHeader -> HistoryBackLink and its real click
// handler. Replace data hooks and app chrome only; no Supabase/auth initialization.
function nutritionHistoryLink(history, mode = "public") {
  const { HistoryBackLink } = presentationComponent("src/components/HistoryBackLink.tsx", {
    "@tanstack/react-router": {
      useRouter: () => ({ history }),
      useRouterState: () => history.location.href,
      defaultParseSearch,
      Link: ({ to, preload, search, hash, params, ...props }) =>
        React.createElement("a", { ...props, href: to }),
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
  const { Route } = presentationComponent("src/routes/_authenticated/bulk/meals_.history.tsx", {
    "@/components/TempoDateTimePicker": { TempoDatePicker: "TempoDatePicker" },
    react: {
      ...React,
      useState: (initial) => [typeof initial === "function" ? initial() : initial, () => {}],
    },
    "@tanstack/react-router": { createFileRoute: () => (options) => options },
    "@/components/AppShell": { AppShell: "main", PageHeader },
    "@/components/ui-kit": { Card: "section", DataError: "div", SectionTitle: "h2" },
    "@/lib/bulk-nutrition": {},
    "@/lib/bulk-nutrition-query": {
      useBulkNutritionDay: () => ({ data: null, isLoading: false, error: null }),
    },
    "@/lib/calc": { iso },
    "@/lib/network-errors": {},
    "@/lib/store": {
      useAppData: () => ({ days: {} }),
      useBulkMeta: () => ({ bulkId: "owned-profile" }),
    },
    "@/lib/bulk-access": {
      useMemberships: () => ({ data: [] }),
      bulkPlanModeFor: () => mode,
    },
  });
  const page = Route.component();
  const header = page.props.children.find((child) => child?.type === PageHeader);
  assert.ok(header, "Nutrition history renders the shared PageHeader");
  const back = PageHeader(header.props).props.children[0];
  assert.equal(back.type, HistoryBackLink, "Nutrition history enables contextual Back");
  return HistoryBackLink(back.props);
}

function click(link, history, modifiers = {}) {
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
  // Unhandled ordinary clicks follow the TanStack Link's declared destination.
  if (!event.defaultPrevented && !event.metaKey && event.button === 0) history.push(link.props.to);
  return event;
}

test("Progress -> Body & food -> Food details -> Nutrition history returns to Food details", () => {
  const history = createMemoryHistory({ initialEntries: ["/bulk/progress"] });
  trackInAppHistory(history);
  history.push("/bulk/progress/body");
  const origin = "/bulk/progress/body/food?period=7#past-days";
  history.push(origin);
  history.push(historyPath);

  const link = nutritionHistoryLink(history);
  assert.equal(link.props.to, "/bulk/progress/body/food");
  assert.match(renderToStaticMarkup(link), /Food details/);
  assert.equal(click(link, history).defaultPrevented, true);
  assert.equal(history.location.href, origin); // Real Back preserves search/hash, too.
  history.forward();
  assert.equal(history.location.pathname, historyPath);
});

for (const mode of ["public", "legacy"]) {
  test(`${mode} Meals -> Nutrition history returns to Meals`, () => {
    const history = createMemoryHistory({ initialEntries: ["/bulk/meals"] });
    trackInAppHistory(history);
    history.push(historyPath);
    const link = nutritionHistoryLink(history, mode);
    assert.equal(link.props.to, "/bulk/meals");
    assert.match(renderToStaticMarkup(link), />Meals<|> Meals</);
    assert.equal(click(link, history).defaultPrevented, true);
    assert.equal(history.location.pathname, "/bulk/meals");
  });
}

test("direct Nutrition history deep link uses Meals, never an unobserved browser entry", () => {
  const history = createMemoryHistory({
    initialEntries: ["/unobserved", historyPath],
    initialIndex: 1,
  });
  trackInAppHistory(history);
  assert.equal(inAppBackPath(history), undefined);
  const link = nutritionHistoryLink(history);
  assert.equal(link.props.to, "/bulk/meals");
  assert.match(renderToStaticMarkup(link), /Meals/);
  assert.equal(click(link, history).defaultPrevented, false);
  assert.equal(history.location.pathname, "/bulk/meals");
});

test("Nutrition history parent label follows Back/Forward and a new Meals origin", () => {
  const history = createMemoryHistory({ initialEntries: ["/bulk/progress/body/food"] });
  trackInAppHistory(history);
  history.push(historyPath);
  history.back();
  history.forward();
  assert.match(renderToStaticMarkup(nutritionHistoryLink(history)), /Food details/);
  click(nutritionHistoryLink(history), history);
  history.push("/bulk/meals");
  history.push(historyPath);
  const link = nutritionHistoryLink(history);
  assert.match(renderToStaticMarkup(link), /Meals/);
  assert.doesNotMatch(renderToStaticMarkup(link), /Food details/);
  click(link, history);
  assert.equal(history.location.pathname, "/bulk/meals");
});

test("unknown in-app origins keep generic Back; auth/onboarding use the safe Meals fallback", () => {
  for (const origin of ["/unknown-shared-route", "/auth", "/onboarding"]) {
    const history = createMemoryHistory({ initialEntries: [origin] });
    trackInAppHistory(history);
    history.push(historyPath);
    const link = nutritionHistoryLink(history);
    if (origin === "/unknown-shared-route") {
      assert.match(renderToStaticMarkup(link), /Back/);
      assert.equal(click(link, history).defaultPrevented, true);
      assert.equal(history.location.pathname, origin);
    } else {
      assert.equal(link.props.to, "/bulk/meals");
      assert.equal(click(link, history).defaultPrevented, false);
      assert.equal(history.location.pathname, "/bulk/meals");
    }
  }
});

test("modified Back clicks keep normal link behavior with the actual parent href", () => {
  const history = createMemoryHistory({ initialEntries: ["/bulk/progress/body/food"] });
  trackInAppHistory(history);
  history.push(historyPath);
  const link = nutritionHistoryLink(history);
  assert.equal(link.props.to, "/bulk/progress/body/food");
  assert.equal(click(link, history, { metaKey: true }).defaultPrevented, false);
  assert.equal(history.location.pathname, historyPath);
});

test("Nutrition history contextual Back renders safely during SSR with memory history", () => {
  assert.equal(typeof window, "undefined");
  assert.equal(typeof document, "undefined");
  const history = createMemoryHistory({ initialEntries: [historyPath] });
  assert.doesNotThrow(() => renderToStaticMarkup(nutritionHistoryLink(history)));
});
