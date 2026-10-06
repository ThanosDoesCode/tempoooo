import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { format } from "date-fns";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import * as values from "../src/lib/tempo-picker.ts";
import { presentationComponent } from "./presentation-component-fixture.mjs";

const read = (file) => readFileSync(new URL(`../${file}`, import.meta.url), "utf8");
const jsx = (type, props) => ({ type, props });
const nodes = (tree, type) =>
  !tree || typeof tree !== "object"
    ? []
    : Array.isArray(tree)
      ? tree.flatMap((n) => nodes(n, type))
      : [...(tree.type === type ? [tree] : []), ...nodes(tree.props?.children, type)];
const text = (tree) =>
  tree == null
    ? ""
    : Array.isArray(tree)
      ? tree.map(text).join("")
      : typeof tree === "object"
        ? text(tree.props?.children)
        : String(tree);

function fixture(name, props) {
  const slots = [];
  let index = 0;
  const parts = presentationComponent("src/components/TempoDateTimePicker.tsx", {
    react: {
      useId: () => "picker-id",
      useState(initial) {
        const at = index++;
        slots[at] ??= { value: typeof initial === "function" ? initial() : initial };
        return [
          slots[at].value,
          (next) => {
            slots[at].value = typeof next === "function" ? next(slots[at].value) : next;
          },
        ];
      },
    },
    "react/jsx-runtime": { jsx, jsxs: jsx },
    "@/lib/tempo-picker": values,
    "./ui/calendar": { Calendar: "Calendar" },
    "./ui/dialog": Object.fromEntries(
      [
        "Dialog",
        "DialogTrigger",
        "DialogContent",
        "DialogTitle",
        "DialogHeader",
        "DialogDescription",
      ].map((n) => [n, n]),
    ),
  });
  const render = () => {
    index = 0;
    return parts[name](props);
  };
  const button = (label) => nodes(render(), "button").find((n) => text(n.props.children) === label);
  return { render, button };
}

test("date values preserve local calendar days, leap days and reject impossible dates", () => {
  for (const value of ["2026-01-01", "2026-12-31", "2024-02-29", "2026-10-05"]) {
    assert.equal(values.pickerDateValue(values.pickerDate(value)), value);
  }
  for (const value of [
    "2026-02-29",
    "2026-02-30",
    "2026-13-01",
    "2026-00-01",
    "2026-1-5",
    "",
    "2026-10-05T14:21",
    "not a date",
  ])
    assert.equal(values.pickerDate(value), undefined);
  assert.equal(values.pickerDateLabel("2026-10-05"), "5 October 2026");
  assert.equal(values.pickerDateLabel(""), "Choose date");
});

test("month/year boundaries remain local in Stockholm and extreme UTC offsets", () => {
  for (const zone of ["Europe/Stockholm", "Pacific/Kiritimati", "America/Los_Angeles"]) {
    const child = spawnSync(
      process.execPath,
      [
        "--input-type=module",
        "-e",
        'import {pickerDate,pickerDateValue} from "./src/lib/tempo-picker.ts"; for(const d of ["2026-12-31","2027-01-01","2024-02-29"]) { if(pickerDateValue(pickerDate(d))!==d) throw Error(d) }',
      ],
      { cwd: new URL("..", import.meta.url), env: { ...process.env, TZ: zone }, encoding: "utf8" },
    );
    assert.equal(child.status, 0, `${zone}: ${child.stderr}`);
  }
});

test("date picker opens one Monday-first calendar, reflects selection and updates month", () => {
  let saved;
  const f = fixture("TempoDatePicker", {
    value: "2026-10-05",
    label: "Workout date",
    onChange: (v) => (saved = v),
  });
  const trigger = nodes(f.render(), "DialogTrigger")[0].props.children;
  assert.equal(trigger.type, "button");
  assert.equal(trigger.props.type, "button");
  assert.match(trigger.props["aria-label"], /Workout date: 5 October 2026/);
  nodes(f.render(), "Dialog")[0].props.onOpenChange(true);
  assert.equal(nodes(f.render(), "Dialog")[0].props.open, true);
  const calendar = nodes(f.render(), "Calendar")[0];
  assert.equal(calendar.props.weekStartsOn, 1);
  assert.equal(calendar.props.mode, "single");
  assert.equal(calendar.props.autoFocus, true);
  assert.equal(values.pickerDateValue(calendar.props.selected), "2026-10-05");
  assert.equal(nodes(f.render(), "Calendar").length, 1);
  for (const next of ["2026-09-01", "2026-11-01", "2027-01-01", "2024-02-01"]) {
    nodes(f.render(), "Calendar")[0].props.onMonthChange(values.pickerDate(next));
    assert.equal(values.pickerDateValue(nodes(f.render(), "Calendar")[0].props.month), next);
  }
  nodes(f.render(), "Calendar")[0].props.onSelect(values.pickerDate("2024-02-29"));
  assert.equal(saved, "2024-02-29");
  assert.equal(nodes(f.render(), "Dialog")[0].props.open, false);
});

test("date constraints block disabled selections and Today outside the permitted interval", () => {
  const saved = [];
  const f = fixture("TempoDatePicker", {
    value: "2026-10-05",
    min: "2026-10-01",
    max: "2026-10-05",
    onChange: (v) => saved.push(v),
  });
  const calendar = nodes(f.render(), "Calendar")[0];
  for (const value of ["2026-09-30", "2026-10-06"]) {
    assert.equal(calendar.props.disabled(values.pickerDate(value)), true);
    calendar.props.onSelect(values.pickerDate(value));
  }
  calendar.props.onSelect(values.pickerDate("2026-10-05"));
  assert.deepEqual(saved, ["2026-10-05"]);
  assert.equal(f.button("Clear"), undefined);
  const today = format(new Date(), "yyyy-MM-dd");
  assert.equal(
    f.button("Today").props.disabled,
    !values.pickerDateAllowed(today, "2026-10-01", "2026-10-05"),
  );
});

test("Today and opt-in Clear actions return the same string contracts", () => {
  const saved = [];
  const f = fixture("TempoDatePicker", {
    value: "2026-10-05",
    clearable: true,
    onChange: (v) => saved.push(v),
  });
  f.button("Today").props.onClick();
  f.button("Clear").props.onClick();
  assert.deepEqual(saved, [format(new Date(), "yyyy-MM-dd"), ""]);
  assert.equal(nodes(f.render(), "Dialog")[0].props.open, false);
});

test("24-hour time choices keep every minute and exclude invalid values", () => {
  for (const [hour, minute, expected] of [
    [0, 0, "00:00"],
    [23, 59, "23:59"],
    [14, 21, "14:21"],
  ]) {
    assert.equal(values.pickerTimeValue(hour, minute), expected);
    assert.deepEqual(values.pickerTime(expected), { hour, minute });
  }
  for (const invalid of ["24:00", "23:60", "9:05", "14:05:30", "", "noon"])
    assert.equal(values.pickerTime(invalid), undefined);
  for (const [hour, minute] of [
    [24, 0],
    [-1, 0],
    [2, 60],
    [1.5, 3],
    [1, NaN],
  ])
    assert.throws(() => values.pickerTimeValue(hour, minute), RangeError);
  let saved;
  const f = fixture("TempoTimePicker", {
    value: "14:21",
    label: "Start time",
    onChange: (v) => (saved = v),
  });
  nodes(f.render(), "Dialog")[0].props.onOpenChange(true);
  const options = nodes(f.render(), "button").filter((n) => n.props["aria-pressed"] != null);
  assert.equal(options.length, 84);
  assert.equal(options.filter((n) => n.props["aria-pressed"]).length, 2);
  for (const [hour, minute] of [
    [23, 59],
    [0, 0],
  ]) {
    for (const [part, n] of [
      ["Hour", hour],
      ["Minute", minute],
    ])
      nodes(f.render(), "button")
        .find((button) => button.props["aria-label"] === `${part} ${String(n).padStart(2, "0")}`)
        .props.onClick();
    f.button("Use time").props.onClick();
    assert.equal(saved, values.pickerTimeValue(hour, minute));
    assert.equal(nodes(f.render(), "Dialog")[0].props.open, false);
  }
});

test("time keyboard navigation uses two tab stops, arrow keys and Home/End without invalid values", () => {
  const f = fixture("TempoTimePicker", { value: "14:21", onChange() {} });
  const choice = (label) =>
    nodes(f.render(), "button").find((n) => n.props["aria-label"] === label);
  let focused,
    prevented = 0;
  const event = (key) => ({
    key,
    preventDefault: () => prevented++,
    currentTarget: {
      parentElement: {
        querySelectorAll: () =>
          Array.from({ length: 60 }, (_, i) => ({ focus: () => (focused = i) })),
      },
    },
  });
  assert.equal(nodes(f.render(), "button").filter((n) => n.props.tabIndex === 0).length, 2);
  choice("Hour 14").props.onKeyDown(event("ArrowDown"));
  assert.equal(focused, 16);
  assert.equal(choice("Hour 16").props["aria-pressed"], true);
  choice("Hour 16").props.onKeyDown(event("End"));
  assert.equal(focused, 23);
  choice("Hour 23").props.onKeyDown(event("ArrowRight"));
  assert.equal(focused, 23);
  choice("Minute 21").props.onKeyDown(event("Home"));
  assert.equal(focused, 0);
  choice("Minute 00").props.onKeyDown(event("ArrowLeft"));
  assert.equal(focused, 0);
  assert.equal(prevented, 5);
});

test("datetime composition preserves independent start/end calendar dates and minute precision", () => {
  let saved;
  const f = fixture("TempoDateTimePicker", {
    value: "2026-10-06T00:15",
    dateFallback: "2026-10-05",
    label: "End time",
    onChange: (v) => (saved = v),
  });
  const children = f.render().props.children;
  children[1].props.onChange("23:59");
  assert.equal(saved, "2026-10-06T23:59");
  children[2].props.onChange("2026-10-07");
  assert.equal(saved, "2026-10-07T00:15");
  assert.equal(children[1].props.value, "00:15");
  assert.equal(children[2].props.value, "2026-10-06");
});

test("shared picker delegates focus trap, dismissal and trigger restoration to Radix", () => {
  const source = read("src/components/TempoDateTimePicker.tsx");
  const dialog = read("src/components/ui/dialog.tsx");
  assert.match(source, /<DialogTrigger asChild>/);
  assert.match(source, /onOpenChange=/);
  assert.match(dialog, /@radix-ui\/react-dialog/);
  assert.doesNotMatch(source, /onEscapeKeyDown|onCloseAutoFocus/);
  assert.match(source, /motion-reduce:animate-none/);
  assert.match(source, /safe-area-inset-bottom/);
  assert.match(source, /min-h-11/);
});

test("every authored date/time input was migrated; calendar paging arrows remain navigation controls", () => {
  const walk = (dir) =>
    readdirSync(new URL(`../${dir}`, import.meta.url), { withFileTypes: true }).flatMap((f) =>
      f.isDirectory()
        ? f.name === "design-handoff"
          ? []
          : walk(`${dir}/${f.name}`)
        : [`${dir}/${f.name}`],
    );
  for (const file of walk("src").filter((f) => f.endsWith(".tsx")))
    assert.doesNotMatch(read(file), /type=["'](?:date|time|datetime-local)["']/, file);
  for (const file of [
    "src/components/WorkoutHistory.tsx",
    "src/components/PublicBulkProgress.tsx",
    "src/components/BulkNutritionLog.tsx",
    "src/routes/_authenticated/challenge/add.tsx",
    "src/routes/_authenticated/bulk/history.tsx",
    "src/routes/_authenticated/bulk/training.tsx",
    "src/routes/_authenticated/bulk/meals_.history.tsx",
  ])
    assert.match(read(file), /TempoDatePicker/, file);
  const header = read("src/components/HistoryBackLink.tsx");
  assert.match(header, /backControlClassName/);
  assert.match(header, /backWithinApp\(router.history, parentPath\)/);
  assert.doesNotMatch(header, /ArrowLeft|ChevronLeft/);
  for (const file of [
    "src/components/TrainingPlanEditor.tsx",
    "src/routes/_authenticated/bulk-onboarding.tsx",
    "src/routes/_authenticated/challenge/new.tsx",
  ]) {
    assert.match(read(file), /BackButton/);
    assert.doesNotMatch(read(file), /ArrowLeft|ChevronLeft|‹|←/);
  }
});

test("shared Back uses the Today arrow, muted type, aligned gap and visible keyboard focus", () => {
  const back = presentationComponent("src/components/BackControl.tsx");
  const html = renderToStaticMarkup(
    React.createElement(back.BackButton, { onClick() {} }, "Today"),
  );
  for (const token of [
    "min-h-11",
    "items-center",
    "gap-2",
    "text-sm",
    "font-semibold",
    "text-muted-foreground",
    "focus-visible:ring-2",
    "hover:bg-elevated",
  ])
    assert.ok(html.includes(token), token);
  assert.match(html, /h-4 w-4 shrink-0/);
  assert.match(html, /stroke-width="2"/);
  assert.match(html, /aria-hidden="true"/);
  assert.match(html, />Today<\/button>/);
});
