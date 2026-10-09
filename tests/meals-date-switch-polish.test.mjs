import { test } from "node:test";
import assert from "node:assert/strict";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { accountUI } from "./account-ui-fixture.mjs";
import { presentationComponent } from "./presentation-component-fixture.mjs";
import { iso } from "../src/lib/calc.ts";

function dates(selectedDate = "2026-10-08", today = "2026-10-08") {
  const changes = [];
  const ui = accountUI(
    "src/components/NutritionDateStrip.tsx",
    "NutritionDateStrip",
    {
      "./TempoDateTimePicker": { TempoDatePicker: "TempoDatePicker" },
      "@/lib/calc": { iso },
    },
    { selectedDate, today, onChange: (date) => changes.push(date) },
  );
  return { ui, changes };
}

test("compact Meals dates keep seven readable days, one selected day and no redundant Today subtitle", () => {
  const { ui } = dates();
  try {
    const days = ui.find("button").filter((node) => "aria-pressed" in node.props);
    assert.equal(days.length, 7);
    assert.equal(days.filter((node) => node.props["aria-pressed"]).length, 1);
    const selected = days.find((node) => node.props["aria-pressed"]);
    assert.equal(selected.props["aria-label"], "Thursday 8 October 2026");
    assert.equal(selected.props["aria-current"], "date");
    assert.match(selected.props.className, /bg-primary\/15/);
    assert.equal(days.filter((node) => node.props.disabled).length, 3);
    assert.doesNotMatch(ui.text(), /Today/);
    assert.ok(ui.find("div").some((node) => node.props.className === "grid grid-cols-7 gap-1"));
    assert.ok(days.every((node) => /min-w-0/.test(node.props.className)));
    const picker = ui.find("TempoDatePicker")[0];
    assert.equal(picker.props.value, "2026-10-08");
    assert.equal(picker.props.max, "2026-10-08");
    assert.match(picker.props.className, /border-0 bg-transparent/);
  } finally {
    ui.dispose();
  }
});

test("historical dates retain their selected day and centered date picker", () => {
  const { ui, changes } = dates("2026-09-30");
  try {
    assert.equal(ui.find("TempoDatePicker")[0].props.value, "2026-09-30");
    assert.equal(
      ui.find("button").find((node) => node.props["aria-pressed"]).props["aria-label"],
      "Wednesday 30 September 2026",
    );
    ui.find("TempoDatePicker")[0].props.onChange("2026-10-08");
    assert.deepEqual(changes, ["2026-10-08"]);
  } finally {
    ui.dispose();
  }
});

test("compact date controls preserve week movement, month/year boundaries and future clamping", () => {
  for (const [selected, today, previous, next] of [
    ["2026-10-01", "2026-10-08", "2026-09-24", "2026-10-08"],
    ["2025-12-30", "2026-01-02", "2025-12-23", "2026-01-02"],
  ]) {
    const { ui, changes } = dates(selected, today);
    try {
      ui.find("button")
        .find((node) => node.props["aria-label"] === "Previous week")
        .props.onClick();
      ui.find("button")
        .find((node) => node.props["aria-label"] === "Next week")
        .props.onClick();
      ui.find("TempoDatePicker")[0].props.onChange(previous);
      assert.deepEqual(changes, [previous, next, previous]);
    } finally {
      ui.dispose();
    }
  }
});

for (const checked of [false, true]) {
  test(`shared Quick Add switch preserves Radix semantics and a separate compact track (${checked ? "on" : "off"})`, () => {
    const { Switch } = presentationComponent("src/components/ui/switch.tsx");
    const markup = renderToStaticMarkup(
      React.createElement(Switch, { checked, "aria-label": "Show in Quick Add" }),
    );
    assert.match(markup, /role="switch"/);
    assert.match(markup, new RegExp(`aria-checked="${checked}"`));
    assert.match(markup, /aria-label="Show in Quick Add"/);
    assert.match(markup, /data-slot="switch-track"/);
    assert.match(markup, /data-slot="switch-thumb"/);
    assert.match(markup, /h-11 min-h-11 w-\[52px\]/);
    assert.match(markup, /h-8 -translate-y-1\/2/);
    assert.match(markup, /size-7 rounded-full bg-white/);
    assert.match(markup, /group-data-\[state=checked\]:bg-primary/);
    assert.match(markup, /translate-x-\[22px\]/);
    assert.match(markup, /translate-x-\[2px\]/);
    assert.match(markup, /motion-reduce:transition-none/);
  });
}
