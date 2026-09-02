import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";
import ts from "typescript";
import * as numeric from "../src/lib/numeric.ts";
const compiled = ts.transpileModule(
  await readFile(
    new URL("../src/routes/_authenticated/challenge/log.tsx", import.meta.url),
    "utf8",
  ),
  {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
      jsx: ts.JsxEmit.ReactJSX,
    },
  },
).outputText;
function fixture(distance, duration = "", type = "run") {
  const values = [
    type,
    distance,
    "2026-08-31",
    duration,
    "",
    "",
    [{ name: "fixture.jpg" }],
    [],
    false,
    null,
  ];
  let index = 0;
  const updates = [];
  const rows = [];
  let uploads = 0;
  const challenge = { id: "test-challenge", timezone: "Europe/Stockholm" };
  const context = {
    exports: {},
    crypto: { randomUUID: () => "test-id" },
    require(name) {
      if (name === "react")
        return {
          useState: () => {
            const i = index++;
            return [values[i], (value) => updates.push([i, value])];
          },
          useEffect: () => {},
        };
      if (name === "react/jsx-runtime")
        return {
          jsx: (type, props) => ({ type, props }),
          jsxs: (type, props) => ({ type, props }),
        };
      if (name === "@tanstack/react-router")
        return { createFileRoute: () => (v) => v, useNavigate: () => () => {} };
      if (name === "@tanstack/react-query")
        return { useQueryClient: () => ({ invalidateQueries: async () => {} }) };
      if (name === "@/lib/numeric") return numeric;
      if (name === "@/lib/auth") return { useAuth: () => ({ user: { id: "test-user" } }) };
      if (name === "@/lib/challenge")
        return {
          useMyChallenge: () => ({ data: challenge }),
          useWeekTargets: () => ({ data: [] }),
          todayIn: () => "2026-08-31",
          targetForWeek: () => 10,
          weekNumberOf: () => 1,
        };
      if (name === "@/integrations/supabase/client")
        return {
          supabase: {
            storage: {
              from: () => ({
                upload: async () => {
                  uploads++;
                  return { error: null };
                },
              }),
            },
            from: () => ({
              insert: async (row) => {
                rows.push(row);
                return { error: null };
              },
            }),
          },
        };
      return {};
    },
  };
  vm.runInNewContext(compiled, context);
  const tree = context.exports.Route.component();
  function flatten(node) {
    return !node || typeof node !== "object"
      ? []
      : [node, ...[node.props?.children].flat(Infinity).flatMap(flatten)];
  }
  const nodes = flatten(tree);
  return {
    nodes,
    updates,
    rows,
    get uploads() {
      return uploads;
    },
    async submit() {
      nodes
        .find((n) => n.type === "button" && n.props.children === "Save activity")
        .props.onClick();
      await new Promise((resolve) => setImmediate(resolve));
    },
  };
}
for (const type of ["run", "cycle"])
  test(`${type} Challenge form submits comma distance and decimal duration as numeric values`, async () => {
    const f = fixture("7,25", " 61,5 ", type);
    await f.submit();
    assert.equal(f.rows[0].distance_km, 7.25);
    assert.equal(f.rows[0].duration_seconds, 3690);
    assert.equal(f.rows[0].activity_type, type);
  });
test("Challenge form accepts decimal points and optional duration", async () => {
  const f = fixture("7.25");
  await f.submit();
  assert.equal(f.rows[0].distance_km, 7.25);
  assert.equal(f.rows[0].duration_seconds, null);
});
for (const [dist, duration] of [
  ["invalid", ""],
  ["", ""],
  ["-1", ""],
  ["1001", ""],
  ["7,25", "abc"],
  ["7,25", "-5"],
  ["7,25", "0,001"],
])
  test(`invalid Challenge numbers ${dist}/${duration} stop before any upload or insert`, async () => {
    const f = fixture(dist, duration);
    await f.submit();
    assert.equal(f.rows.length, 0);
    assert.equal(f.uploads, 0);
    assert.ok(f.updates.some(([i, value]) => i === 9 && typeof value === "string"));
  });
test("Challenge decimal inputs preserve raw comma text until blur", () => {
  const f = fixture("61,");
  const input = f.nodes.find((n) => n.type === "input" && n.props.value === "61,");
  assert.equal(input.props.type, "text");
  assert.equal(input.props.inputMode, "decimal");
  input.props.onChange({ target: { value: "61," } });
  assert.deepEqual(f.updates.at(-1), [1, "61,"]);
  input.props.onBlur();
  assert.deepEqual(f.updates.at(-1), [1, "61"]);
});
