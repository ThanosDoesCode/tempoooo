import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import ts from "typescript";
import { presentationComponent } from "./presentation-component-fixture.mjs";

const read = (file) => readFileSync(new URL(`../${file}`, import.meta.url), "utf8");
const { NativeSelect } = presentationComponent("src/components/ui/native-select.tsx");

test("native select retains values, labels, disabled state and one centered non-interactive arrow", () => {
  const html = renderToStaticMarkup(
    React.createElement(
      "label",
      null,
      "Workout day",
      React.createElement(
        NativeSelect,
        {
          value: "legs",
          onChange() {},
          name: "day",
          disabled: true,
          containerClassName: "mt-1 max-w-full",
          className: "h-9 px-2 bg-elevated",
        },
        React.createElement("option", { value: "chest" }, "Chest & Back"),
        React.createElement("option", { value: "legs" }, "Legs"),
      ),
    ),
  );
  assert.match(html, /name="day" disabled=""/);
  assert.match(html, /value="legs" selected=""/);
  assert.match(html, /relative block min-w-0 mt-1 max-w-full/);
  assert.match(html, /min-h-11.*appearance-none bg-none pl-4 pr-12/);
  assert.equal((html.match(/<svg\b/g) ?? []).length, 1);
  assert.match(html, /aria-hidden="true"/);
  assert.match(html, /pointer-events-none absolute right-4 top-1\/2 -translate-y-1\/2/);
});

test("native select forwards the original change/focus handlers and ref without new state", () => {
  const changed = [],
    focused = [];
  const ref = { current: null };
  const onChange = (event) => changed.push(event.target.value);
  const onFocus = (event) => focused.push(event.target.name);
  const tree = NativeSelect.render({ name: "country", onChange, onFocus, children: null }, ref);
  const select = tree.props.children[0];
  assert.equal(select.type, "select");
  assert.equal(select.props.ref, ref);
  assert.equal(select.props.onChange, onChange);
  select.props.onChange({ target: { value: "SE" } });
  select.props.onFocus({ target: { name: "country" } });
  assert.deepEqual(changed, ["SE"]);
  assert.deepEqual(focused, ["country"]);
});

function sourceFiles(dir) {
  return readdirSync(new URL(`../${dir}`, import.meta.url), { withFileTypes: true }).flatMap(
    (entry) =>
      entry.isDirectory()
        ? sourceFiles(`${dir}/${entry.name}`)
        : entry.name.endsWith(".tsx")
          ? [`${dir}/${entry.name}`]
          : [],
  );
}

test("application native selects and disclosures consistently use the shared pattern", () => {
  let selects = 0,
    disclosures = 0;
  for (const file of [...sourceFiles("src/components"), ...sourceFiles("src/routes")]) {
    if (file === "src/components/ui/native-select.tsx") continue;
    const source = read(file);
    const parsed = ts.createSourceFile(
      file,
      source,
      ts.ScriptTarget.Latest,
      true,
      ts.ScriptKind.TSX,
    );
    function inspect(node) {
      if (ts.isJsxElement(node)) {
        const tag = node.openingElement.tagName.getText(parsed);
        assert.notEqual(
          tag,
          "select",
          `${file}: use NativeSelect to avoid duplicate browser arrows`,
        );
        if (tag === "NativeSelect") selects++;
        if (tag === "summary") {
          disclosures++;
          assert.match(node.openingElement.getText(parsed), /disclosure-summary/, file);
          const arrows = node.children.filter(
            (child) =>
              ts.isJsxSelfClosingElement(child) && child.tagName.getText(parsed) === "ChevronDown",
          );
          assert.equal(arrows.length, 1, `${file}: one rotating icon per disclosure`);
          assert.match(arrows[0].getText(parsed), /disclosure-chevron.*aria-hidden="true"/s);
        }
      }
      ts.forEachChild(node, inspect);
    }
    inspect(parsed);
  }
  assert.ok(selects >= 19, "covers filters, workout days, photos, nutrition and Challenge selects");
  assert.ok(disclosures >= 13, "covers public/legacy training, meals, notifications and settings");
});

test("disclosure rotation is scoped to its own open details and respects reduced motion", () => {
  const css = read("src/styles.css");
  assert.match(css, /@utility control-chevron\s*\{\s*width: 1\.25rem;\s*height: 1\.25rem;/);
  assert.match(
    css,
    /@utility disclosure-summary[\s\S]*?min-height: 2\.75rem;[\s\S]*?align-items: center;[\s\S]*?justify-content: space-between;/,
  );
  assert.match(css, /&::-webkit-details-marker\s*\{\s*display: none;/);
  assert.match(
    css,
    /details\[open\] > \.disclosure-summary > \.disclosure-chevron\s*\{\s*transform: rotate\(180deg\)/,
  );
  assert.match(css, /prefers-reduced-motion: reduce[\s\S]*transition-duration: 0\.01ms !important/);
});

test("shared navigation rows keep route destinations and centered 20px chevrons", () => {
  const { NavRows } = presentationComponent("src/components/NavRows.tsx", {
    "@tanstack/react-router": {
      Link: ({ to, preload, ...props }) => React.createElement("a", { ...props, href: to }),
    },
  });
  const html = renderToStaticMarkup(
    React.createElement(NavRows, {
      rows: [
        { to: "/profile", label: "Profile", hint: "Account settings" },
        { to: "/challenge/terms", label: "Challenge terms" },
      ],
    }),
  );
  assert.match(html, /href="\/profile"/);
  assert.match(html, /href="\/challenge\/terms"/);
  assert.match(html, /min-h-\[56px\] items-center justify-between gap-3/);
  assert.equal((html.match(/control-chevron/g) ?? []).length, 2);
  assert.match(html, /<div class="px-4">/);
});

test("calendar captions do not override the shared chevron size or expose another native arrow", () => {
  const source = read("src/components/ui/calendar.tsx");
  assert.doesNotMatch(source, /\[&>svg\]:size-3\.5|pl-2 pr-1/);
  assert.match(source, /appearance-none bg-none opacity-0/);
  assert.match(source, /justify-between gap-3 rounded-md px-4/);
  assert.match(source, /min-h-11 min-w-11 select-none p-0/);
});
