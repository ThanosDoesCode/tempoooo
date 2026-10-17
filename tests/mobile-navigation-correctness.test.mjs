import { test } from "node:test";
import assert from "node:assert/strict";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import vm from "node:vm";
import ts from "typescript";
import { createMemoryHistory } from "@tanstack/history";
import { trackInAppHistory, backWithinApp, inAppBackLocation } from "../src/lib/in-app-back.ts";
import { presentationComponent } from "./presentation-component-fixture.mjs";
import { accountUI, walk } from "./account-ui-fixture.mjs";
import { iso } from "../src/lib/calc.ts";
import * as nutrition from "../src/lib/bulk-nutrition.ts";
const require = createRequire(import.meta.url);
const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

for (const mode of ["public", "legacy"]) {
  test(`Nutrition history ${mode} dates replace: three selections, one Back to Food details`, () => {
    const history = createMemoryHistory({ initialEntries: ["/bulk/progress/body/food?period=3"] });
    trackInAppHistory(history);
    history.push("/bulk/meals/history?date=2026-10-14");
    const index = history.location.state.__TSR_index;
    const ui = accountUI("src/routes/_authenticated/bulk/meals_.history.tsx", "Route", {
      "@tanstack/react-router": {
        createFileRoute: () => (options) => ({
          options,
          useSearch: () => ({ date: new URLSearchParams(history.location.search).get("date") }),
        }),
        useNavigate: () => (d) =>
          history[d.replace ? "replace" : "push"](`${d.to}?date=${d.search.date}`),
        Link: "Link",
      },
      "@/components/TempoDateTimePicker": { TempoDatePicker: "TempoDatePicker" },
      "@/lib/store": { useBulkMeta: () => ({ bulkId: "owner" }), useAppData: () => ({ days: {} }) },
      "@/lib/bulk-access": { useMemberships: () => ({ data: [] }), bulkPlanModeFor: () => mode },
      "@/lib/bulk-nutrition": nutrition,
      "@/lib/bulk-nutrition-query": { useBulkNutritionDay: () => ({ data: null }) },
      "@/lib/calc": { iso },
      "@/lib/network-errors": {},
    });
    try {
      for (const date of ["2026-10-13", "2026-10-12", "2026-10-11"])
        ui.find("TempoDatePicker")[0].props.onChange(date);
      assert.equal(history.location.state.__TSR_index, index);
      assert.equal(ui.find("TempoDatePicker")[0].props.value, "2026-10-11");
      assert.equal(inAppBackLocation(history).pathname, "/bulk/progress/body/food");
      assert.equal(ui.find("PageHeader")[0].props.backTo, "/bulk/meals");
      const screenLink = ui.find("Link")[0];
      if (mode === "public") {
        assert.equal(screenLink.props.to, "/bulk/meals");
        assert.equal(screenLink.props.replace, undefined);
      }
      assert.equal(backWithinApp(history), true);
      assert.equal(history.location.href, "/bulk/progress/body/food?period=3");
      history.forward();
      assert.equal(history.location.search, "?date=2026-10-11");
    } finally {
      ui.dispose();
      history.destroy();
    }
  });
}

test("You groups Settings beside the unchanged bell, without the responsive secondary control row", () => {
  const { MainPageHeader } = presentationComponent("src/components/MainPageHeader.tsx", {
    "./NotificationBell": {
      NotificationBell: () =>
        React.createElement(
          "a",
          {
            href: "/notifications",
            "aria-label": "Notifications, 2 unread",
            className: "h-11 w-11",
          },
          "Bell",
        ),
    },
  });
  const html = renderToStaticMarkup(
    React.createElement(MainPageHeader, {
      title: "You",
      actions: React.createElement(
        "a",
        { href: "/profile/settings", className: "h-11 w-11" },
        "Settings",
      ),
    }),
  );
  assert.match(html, /row-start-1 flex items-center gap-1/);
  assert.match(html, /\/notifications/);
  assert.match(html, /Notifications, 2 unread/);
  assert.match(html, /\/profile\/settings/);
  assert.doesNotMatch(html, /row-start-2|col-span-full/);
  assert.match(
    read("src/routes/_authenticated/profile.tsx"),
    /<MainPageHeader\s+title="You"\s+actions=/,
  );
});

const domain = presentationComponent("src/lib/challenge.ts", {
  "@/integrations/supabase/client": { supabase: {} },
  "./challenge-activity-data": {},
  "./privileged-rpcs.functions": {},
});
function moneyFixture() {
  const payments = [
    {
      id: "pay",
      payer_id: "them",
      recipient_id: "me",
      amount_eur: 15,
      status: "unpaid",
      week_id: "week",
    },
  ];
  const members = [
    { userId: "me", name: "You" },
    { userId: "them", name: "Θέμης Ματαραγκας" },
  ];
  const weeks = [{ id: "week", week_number: 6, user_id: "them", equivalent_km: 0 }];
  const context = {
    exports: {},
    require(name) {
      const modules = {
        "@tanstack/react-router": { createFileRoute: () => (o) => o },
        "@tanstack/react-query": { useQueryClient: () => ({ invalidateQueries: async () => {} }) },
        "@/components/AppShell": { AppShell: ({ children }) => children, PageHeader: () => null },
        "@/components/ui-kit": {
          Card: ({ children, ...props }) => React.createElement("section", props, children),
          Note: ({ children }) => React.createElement("p", {}, children),
          PendingLabel: "span",
          DataError: "div",
        },
        "@/integrations/supabase/client": { supabase: {} },
        "@/lib/auth": { useAuth: () => ({ user: { id: "me" } }) },
        "@/lib/network-errors": {},
        "@/lib/challenge": {
          ...domain,
          useChallengeMembers: () => ({ data: members }),
          usePayments: () => ({ data: payments }),
          useWeeks: () => ({ data: weeks }),
        },
      };
      return modules[name] ?? require(name);
    },
  };
  vm.runInNewContext(
    ts.transpileModule(
      read("src/routes/_authenticated/challenge/money.tsx") +
        "\nexport {MoneyContent, PaymentItem};",
      {
        compilerOptions: {
          module: ts.ModuleKind.CommonJS,
          target: ts.ScriptTarget.ES2022,
          jsx: ts.JsxEmit.ReactJSX,
        },
      },
    ).outputText,
    context,
  );
  return { ...context.exports, payment: payments[0], week: weeks[0] };
}

test("Money keeps exact obligations and week results while using compact responsive summary and status rows", () => {
  const { MoneyContent } = moneyFixture();
  const html = renderToStaticMarkup(
    React.createElement(MoneyContent, { challenge: { id: "challenge", legacy_photo_owed: true } }),
  );
  assert.match(html, /You owe/);
  assert.match(html, /Θέμης Ματαραγκας owes you/);
  assert.match(html, /€0/);
  assert.match(html, /€15/);
  assert.match(html, /\+ 3 photos/);
  assert.match(html, /Week 6 · 0.0 km/);
  assert.match(html, /Waiting for Θέμης Ματαραγκας/);
  assert.match(html, /grid-cols-1.*min-\[360px\]:grid-cols-2/);
  assert.match(html, /whitespace-nowrap text-\[13px\]/);
  assert.doesNotMatch(html, /text-3xl/);
});

for (const [mine, status, actions] of [
  [true, "unpaid", ["I paid"]],
  [true, "marked_paid", ["Undo"]],
  // Only the recipient can settle; they get both a reject and a confirm action.
  [false, "marked_paid", ["Not received", "Got it"]],
  [false, "unpaid", []],
]) {
  test(`Money ${mine ? "payer" : "recipient"} ${status} keeps the recipient-confirmed settlement branch`, () => {
    const { PaymentItem, payment, week } = moneyFixture();
    const calls = [];
    const tree = PaymentItem({
      payment: { ...payment, status },
      week,
      mine,
      name: (id) => (id === "me" ? "You" : "Θέμης Ματαραγκας"),
      legacyPhotoOwed: true,
      pending: false,
      busy: false,
      onMarkPaid: () => calls.push("I paid"),
      onUndo: () => calls.push("Undo"),
      onConfirm: () => calls.push("Got it"),
      onReject: () => calls.push("Not received"),
    });
    const buttons = [...walk(tree)].filter((n) => n.type === "button");
    assert.equal(buttons.length, actions.length);
    actions.forEach((label, i) => {
      assert.equal(buttons[i].props.children, label);
      buttons[i].props.onClick();
      assert.match(buttons[i].props.className, /min-h-11/);
    });
    assert.deepEqual(calls, actions);
  });
}

test("compact workout grid reserves six 44px controls within 320px gutters without shrinking header text", () => {
  const utility = read("src/styles.css").split("@utility workout-set-grid {")[1].split("@theme")[0];
  assert.match(
    utility,
    /grid-template-columns: 44px minmax\(0, 1fr\) minmax\(44px, 1fr\) minmax\(44px, 1fr\) 44px 44px/,
  );
  assert.match(utility, /gap: 3px/);
  for (const width of [320, 375, 390, 430, 768, 1280]) {
    const contentWidth = Math.min(width, 672) - 40;
    const gap = width >= 375 ? 8 : 3;
    assert.ok(6 * 44 + 5 * gap <= contentWidth, `six usable columns fit ${width}px`);
  }
  assert.doesNotMatch(read("src/components/BulkWorkoutSession.tsx"), /text-\[9px\]/);
});
