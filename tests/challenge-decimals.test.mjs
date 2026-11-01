import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";
import ts from "typescript";
import * as numeric from "../src/lib/numeric.ts";
import * as durationLib from "../src/lib/duration.ts";
const compiled = ts.transpileModule(
  await readFile(
    new URL("../src/routes/_authenticated/challenge/add.tsx", import.meta.url),
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
function fixture(distance, duration = "", type = "run", storageThrows = false) {
  const values = [
    type,
    distance,
    "2026-08-31",
    duration,
    "",
    "",
    [{ name: "fixture.jpg" }],
    [],
    null,
    null,
    null,
    false,
    false,
  ];
  let index = 0;
  const updates = [];
  const rows = [];
  const toasts = [];
  let uploads = 0;
  const challenge = { id: "test-challenge", timezone: "Europe/Stockholm" };
  const context = {
    exports: {},
    crypto: { randomUUID: () => "test-id" },
    sessionStorage: {
      getItem: () => {
        if (storageThrows) throw new Error("storage unavailable");
        return null;
      },
      setItem: () => {
        if (storageThrows) throw new Error("storage unavailable");
      },
      removeItem: () => {
        if (storageThrows) throw new Error("storage unavailable");
      },
    },
    require(name) {
      if (name === "react")
        return {
          useState: () => {
            const i = index++;
            return [values[i], (value) => updates.push([i, value])];
          },
          useEffect: () => {},
          useRef: (value) => ({ current: value }),
        };
      if (name === "react/jsx-runtime")
        return {
          jsx: (type, props) => ({ type, props }),
          jsxs: (type, props) => ({ type, props }),
        };
      if (name === "@tanstack/react-router")
        return {
          createFileRoute: () => (v) => ({ ...v, useSearch: () => ({}), useParams: () => ({}) }),
          useNavigate: () => () => {},
          useBlocker: () => ({ status: "idle" }),
        };
      if (name === "@tanstack/react-query")
        return { useQueryClient: () => ({ invalidateQueries: async () => {} }) };
      if (name === "@/lib/numeric") return numeric;
      if (name === "@/lib/duration") return durationLib;
      if (name === "@/lib/challenge-evidence")
        return { optimizeEvidenceImage: async (file) => file };
      if (name === "@/lib/private-image-upload")
        return {
          PRIVATE_IMAGE_MAX_BYTES: 15 * 1024 * 1024,
          inspectPrivateImage: async () => ({ mimeType: "image/jpeg", extension: "jpg" }),
          isPrivateImageValidationError: () => false,
        };
      if (name === "sonner") return { toast: { success: (message) => toasts.push(message) } };
      if (name === "@/lib/auth") return { useAuth: () => ({ user: { id: "test-user" } }) };
      if (name === "@/lib/challenge")
        return {
          useMyChallenge: () => ({ data: challenge }),
          useActivity: () => ({ data: null, isLoading: false }),
          isActivityEditable: () => true,
          todayIn: () => "2026-08-31",
          DEFAULT_TARGET_KM: 15,
          activityMetrics: ({ activity_type, distance_km, duration_seconds }) => {
            const speed = (distance_km * 3600) / duration_seconds;
            const pace = duration_seconds / distance_km;
            const qualified = activity_type === "run" ? pace < 420 : speed >= 18;
            return {
              averageSpeed: speed,
              averagePace: pace,
              qualified,
              equivalent: qualified ? (activity_type === "run" ? distance_km : distance_km / 3) : 0,
            };
          },
          formatPace: (seconds) => `${Math.floor(seconds / 60)}:00 min/km`,
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
    toasts,
    get uploads() {
      return uploads;
    },
    async submit() {
      nodes
        .find(
          (n) =>
            n.type === "button" &&
            typeof n.props["aria-label"] === "string" &&
            /^Save (run|ride|activity)$/.test(n.props["aria-label"]),
        )
        .props.onClick();
      await new Promise((resolve) => setImmediate(resolve));
    },
  };
}
for (const type of ["run", "cycle"])
  test(`${type} Challenge form submits comma distance and clock duration as numeric values`, async () => {
    const f = fixture("7,25", "61:30", type); // distance keeps comma-decimal; time is mm:ss
    await f.submit();
    assert.equal(f.rows[0].distance_km, 7.25);
    assert.equal(f.rows[0].duration_seconds, 3690); // 61*60 + 30
    assert.equal(f.rows[0].activity_type, type);
  });
test("Challenge form saves an mm:ss time as the matching duration_seconds", async () => {
  const f = fixture("4.0", "22:20", "run");
  await f.submit();
  assert.equal(f.rows.length, 1);
  assert.equal(f.rows[0].duration_seconds, 1340); // 22*60 + 20
});

test("Challenge form rejects an invalid mm:ss time before uploading evidence", async () => {
  const f = fixture("4.0", "22:75"); // seconds field out of range
  await f.submit();
  assert.equal(f.rows.length, 0);
  assert.equal(f.uploads, 0);
  assert.ok(f.updates.some(([i, value]) => i === 9 && /mm:ss|duration/i.test(value)));
});

test("Challenge form rejects a missing duration before uploading evidence", async () => {
  const f = fixture("7.25");
  await f.submit();
  assert.equal(f.rows.length, 0);
  assert.equal(f.uploads, 0);
  assert.ok(f.updates.some(([i, value]) => i === 9 && /duration/i.test(value)));
});
test("Challenge form exposes upload and save phases before confirmed success", async () => {
  const f = fixture("7.25", "40");
  await f.submit();
  assert.deepEqual(
    f.updates.filter(([i]) => i === 8),
    [
      [8, "uploading"],
      [8, "saving"],
      [8, null],
    ],
  );
  assert.deepEqual(f.toasts, ["Activity saved."]);
  assert.equal(
    f.updates.some(([i, value]) => i === 9 && value),
    false,
  );
});
test("confirmed activity remains successful when browser draft storage is unavailable", async () => {
  const f = fixture("7.25", "40", "run", true);
  await f.submit();
  assert.equal(f.rows.length, 1);
  assert.deepEqual(f.toasts, ["Activity saved."]);
  assert.equal(
    f.updates.some(([i, value]) => i === 10 && value),
    false,
  );
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
test("Challenge decimal inputs preserve raw comma text until validation/submission", () => {
  const f = fixture("61,");
  const input = f.nodes.find((n) => n.type === "input" && n.props.value === "61,");
  assert.equal(input.props.type, "text");
  assert.equal(input.props.inputMode, "decimal");
  input.props.onChange({ target: { value: "61," } });
  assert.deepEqual(f.updates.at(-1), [1, "61,"]);
  assert.equal(input.props.onBlur, undefined, "focus changes do not rewrite partial text");
});
test("Challenge form keeps duration visible and optional details collapsed", () => {
  const f = fixture("7.25", "40");
  const more = f.nodes.find(
    (node) => node.type === "button" && node.props.children?.[0] === "More details",
  );
  assert.ok(more);
  assert.equal(
    f.nodes.some((node) => node.type === "input" && node.props.type === "date"),
    false,
  );
  assert.ok(f.nodes.some((node) => node.type === "input" && node.props.value === "40"));
});

for (const raw of ["7,", "7.", ",5", ".5", "7,25", "7.25"])
  test(`activity distance preserves raw ${raw} while typing/focus changes`, () => {
    const f = fixture(raw, "30:");
    const input = f.nodes.find((n) => n.type === "input" && n.props.value === raw);
    assert.equal(input.props.inputMode, "decimal");
    assert.equal(input.props.onBlur, undefined);
    input.props.onChange({ target: { value: raw } });
    assert.deepEqual(f.updates.at(-1), [1, raw]);
  });
for (const raw of ["7,25", "7.25"])
  test(`${raw} km and 30:45 submit unchanged real values`, async () => {
    const f = fixture(raw, "30:45");
    await f.submit();
    assert.equal(f.rows[0].distance_km, 7.25);
    assert.equal(f.rows[0].duration_seconds, 1845);
  });
test("duration uses the decimal keypad and preserves partial/invalid clock text", () => {
  const f = fixture("7,25", "30:");
  const input = f.nodes.find((n) => n.type === "input" && n.props.value === "30:");
  assert.equal(input.props.type, "text");
  assert.equal(input.props.inputMode, "decimal");
  assert.equal(input.props.autoCapitalize, "none");
  assert.equal(input.props.autoCorrect, "off");
  input.props.onChange({ target: { value: "30:" } });
  assert.deepEqual(f.updates.at(-1), [3, "30:"]);
  input.props.onBlur();
  assert.deepEqual(f.updates.at(-1), [3, "30:"]);
  assert.equal(durationLib.parseDurationToSeconds("30:"), null);
});

for (const type of ["run", "cycle"]) {
  for (const [raw, seconds] of [
    ["15,35", 935],
    ["15.35", 935],
    ["15:35", 935],
    ["5,09", 309],
    ["0,45", 45],
    ["45", 2700],
  ]) {
    test(`${type} saves ${raw} as ${seconds} whole seconds`, async () => {
      const f = fixture("5", raw, type);
      await f.submit();
      assert.equal(f.rows[0].duration_seconds, seconds);
    });
  }
  for (const raw of ["15,60", "15.60", "15:60"]) {
    test(`${type} rejects out-of-range seconds ${raw} before upload`, async () => {
      const f = fixture("5", raw, type);
      await f.submit();
      assert.equal(f.rows.length, 0);
      assert.equal(f.uploads, 0);
    });
  }
}
for (const raw of ["15,", "15.", "15:", ",35", ".35"]) {
  test(`duration preserves ${raw} while typing; canonicalizes only valid text on blur`, () => {
    const f = fixture("5", raw);
    const input = f.nodes.find((node) => node.type === "input" && node.props.value === raw);
    input.props.onChange({ target: { value: raw } });
    assert.deepEqual(f.updates.at(-1), [3, raw]);
    input.props.onBlur();
    assert.deepEqual(f.updates.at(-1), [3, durationLib.canonicalDuration(raw)]);
    assert.equal(durationLib.canonicalDuration(raw), raw.endsWith("35") ? "0:35" : raw);
  });
}
