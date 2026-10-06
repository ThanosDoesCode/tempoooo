import { test } from "node:test";
import assert from "node:assert/strict";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { presentationComponent } from "./presentation-component-fixture.mjs";

const jsx = (type, props) => ({ type, props });
const nodes = (tree) =>
  !tree || typeof tree !== "object"
    ? []
    : Array.isArray(tree)
      ? tree.flatMap(nodes)
      : [tree, ...nodes(tree.props?.children)];

function wheelFixture(value = 14, max = 23, nativeScrollEnd = true) {
  const slots = [];
  let index = 0;
  const effects = [];
  const cleanup = [];
  const frames = new Map();
  let nextFrame = 0;
  const changes = [];
  const focus = [];
  const element = {
    scrollTop: 0,
    ...(nativeScrollEnd ? { onscrollend: null } : {}),
    focus: (options) => focus.push(options),
    contains: () => true,
  };
  const props = {
    value,
    max,
    ariaLabel: max === 23 ? "Hours" : "Minutes",
    onChange(next) {
      changes.push(next);
      props.value = next;
    },
  };
  const component = presentationComponent(
    "src/components/TempoTimeWheel.tsx",
    {
      "react/jsx-runtime": { jsx, jsxs: jsx },
      react: {
        useRef(initial) {
          const at = index++;
          slots[at] ??= { current: initial };
          return slots[at];
        },
        useLayoutEffect(callback, dependencies) {
          const at = index++;
          if (!slots[at] || dependencies.some((value, i) => !Object.is(value, slots[at][i]))) {
            slots[at] = dependencies;
            effects.push(callback);
          }
        },
        useEffect(callback) {
          const at = index++;
          if (!slots[at]) {
            slots[at] = true;
            effects.push(() => cleanup.push(callback()));
          }
        },
      },
    },
    {
      requestAnimationFrame(callback) {
        frames.set(++nextFrame, callback);
        return nextFrame;
      },
      cancelAnimationFrame(id) {
        frames.delete(id);
      },
    },
  );
  const render = () => {
    index = 0;
    const tree = component.TimeWheel(props);
    const control = nodes(tree).find((n) => n.props.role === "spinbutton");
    control.props.ref.current = element;
    effects.splice(0).forEach((effect) => effect());
    return control;
  };
  render();
  return {
    render,
    props,
    element,
    changes,
    focus,
    frames,
    tick(now) {
      const pending = [...frames.values()];
      frames.clear();
      pending.forEach((callback) => callback(now));
    },
    unmount() {
      cleanup.forEach((callback) => callback?.());
    },
    scroll(top) {
      element.scrollTop = top;
      render().props.onScroll({ currentTarget: element });
    },
    click(next) {
      render().props.onClick({
        currentTarget: element,
        target: {
          closest: () => ({ dataset: { timeWheelValue: String(next) } }),
        },
      });
    },
  };
}

test("hour/minute wheels initially center the saved value, including both endpoints", () => {
  for (const [value, max] of [
    [0, 23],
    [23, 23],
    [0, 59],
    [59, 59],
    [21, 59],
  ]) {
    const f = wheelFixture(value, max);
    assert.equal(f.element.scrollTop, value * 44);
    assert.equal(f.render().props["aria-valuenow"], value);
    assert.equal(f.render().props["aria-valuetext"], String(value).padStart(2, "0"));
    assert.equal(f.render().props["aria-valuemax"], max);
    assert.equal(f.render().props.tabIndex, 0);
    const options = nodes(f.render()).filter((n) => n.props["data-time-wheel-value"] != null);
    assert.equal(options.length, max + 1);
    assert.equal(options[0].props["data-time-wheel-value"], 0);
    assert.equal(options.at(-1).props["data-time-wheel-value"], max);
    assert.ok(options.every((n) => n.props["aria-hidden"] === "true"));
  }
});

test("tapping a visible value selects and centers it without scrolling the outer dialog", () => {
  const f = wheelFixture(14);
  f.click(16);
  assert.deepEqual(f.changes, [16]);
  assert.equal(f.element.scrollTop, 16 * 44);
  assert.equal(f.render().props["aria-valuenow"], 16);
  assert.equal(f.focus[0].preventScroll, true);
  f.click(16);
  assert.deepEqual(f.changes, [16], "no duplicate change for the same value");
});

test("native scroll selection snaps fractional offsets and draft rerenders do not jump", () => {
  const f = wheelFixture();
  f.scroll(16 * 44 + 9.5);
  assert.deepEqual(f.changes, [16]);
  f.render();
  assert.equal(f.element.scrollTop, 16 * 44 + 9.5, "rerender must not interrupt momentum");
  assert.equal(f.frames.size, 0, "native scrollend does not use a polling fallback");
  f.render().props.onScrollEnd();
  assert.equal(f.element.scrollTop, 16 * 44);
  assert.equal(f.render().props["aria-valuenow"], 16);
  f.scroll(-10);
  f.render().props.onScrollEnd();
  assert.equal(f.element.scrollTop, 0);
  f.scroll(10000);
  f.render().props.onScrollEnd();
  assert.equal(f.element.scrollTop, 23 * 44);
});

test("older browsers settle from observed stable geometry, never during a touch or inertia", () => {
  const f = wheelFixture(21, 59, false);
  f.render().props.onTouchStart();
  f.scroll(22 * 44 + 11);
  f.tick(0);
  f.tick(200);
  assert.equal(f.element.scrollTop, 22 * 44 + 11);
  f.render().props.onTouchEnd();
  f.tick(216);
  f.scroll(23 * 44 + 8);
  f.tick(232);
  f.tick(332);
  assert.equal(f.element.scrollTop, 23 * 44 + 8, "momentum resets stability observation");
  f.tick(360);
  assert.equal(f.element.scrollTop, 23 * 44);
  assert.equal(f.render().props["aria-valuenow"], 23);
  assert.equal(f.frames.size, 0);
});

test("keyboard Up/Down change one unit; Home/End center endpoints and preserve Escape/Tab", () => {
  for (const max of [23, 59]) {
    const f = wheelFixture(14, max);
    let prevented = 0;
    const key = (key) => f.render().props.onKeyDown({ key, preventDefault: () => prevented++ });
    key("ArrowDown");
    assert.equal(f.props.value, 15);
    key("ArrowUp");
    assert.equal(f.props.value, 14);
    key("End");
    assert.equal(f.element.scrollTop, max * 44);
    key("ArrowDown");
    assert.equal(f.props.value, max);
    key("Home");
    assert.equal(f.element.scrollTop, 0);
    key("ArrowUp");
    assert.equal(f.props.value, 0);
    key("Escape");
    key("Tab");
    assert.equal(prevented, 6, "Escape and Tab remain Radix/browser responsibilities");
    assert.ok(f.focus.every((options) => options.preventScroll));
  }
});

test("external saved-value updates recenter but unchanged prop renders do not", () => {
  const f = wheelFixture(14);
  f.props.value = 2;
  f.render();
  assert.equal(f.element.scrollTop, 88);
  f.element.scrollTop += 10;
  f.render();
  assert.equal(f.element.scrollTop, 98);
  f.props.value = 23;
  f.render();
  assert.equal(f.element.scrollTop, 23 * 44);
});

test("touch cancel and unmount clean up fallback frames", () => {
  const f = wheelFixture(14, 23, false);
  f.render().props.onTouchStart();
  f.scroll(15 * 44 + 5);
  f.render().props.onTouchCancel();
  f.tick(0);
  f.tick(128);
  assert.equal(f.element.scrollTop, 15 * 44);
  f.scroll(16 * 44);
  assert.equal(f.frames.size, 1);
  f.unmount();
  assert.equal(f.frames.size, 0);
});

test("SSR renders semantic wheels with 44px rows, center snapping and a single subtle selection band", () => {
  const component = presentationComponent("src/components/TempoTimeWheel.tsx");
  const html = renderToStaticMarkup(
    React.createElement(component.TimeWheel, {
      value: 21,
      max: 59,
      ariaLabel: "Minutes",
      onChange() {},
    }),
  );
  assert.match(html, /role="spinbutton"/);
  assert.match(html, /aria-label="Minutes"/);
  assert.match(html, /aria-valuenow="21"/);
  assert.match(html, /snap-y snap-mandatory/);
  assert.match(html, /overscroll-y-contain/);
  assert.match(html, /height:220px;padding-block:88px/);
  assert.equal((html.match(/border-primary\/20/g) ?? []).length, 1);
  assert.doesNotMatch(html, /<button|scroll-smooth|setTimeout|window|document/);
});
