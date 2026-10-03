import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";
import ts from "typescript";
import * as numeric from "../src/lib/numeric.ts";
import * as duration from "../src/lib/duration.ts";

const source = await readFile(
  new URL("../src/routes/_authenticated/challenge/add.tsx", import.meta.url),
  "utf8",
);
const compiled = ts.transpileModule(source, {
  compilerOptions: {
    module: ts.ModuleKind.CommonJS,
    target: ts.ScriptTarget.ES2022,
    jsx: ts.JsxEmit.ReactJSX,
  },
}).outputText;
const newKey = "challenge-activity-draft:user:challenge";
const activity = (id, distance = 5) => ({
  id,
  activity_type: "run",
  distance_km: distance,
  duration_seconds: 1500,
  activity_date: "2026-10-03",
  external_activity_url: null,
  note: id,
  evidence_path: "existing.jpg",
  extra_evidence_paths: [],
});

// Execute the real form, including effect hydration/persistence and submit handlers.
// Hook slots survive route-search changes; remount simulates navigation/reload.
function fixture({ storage = new Map(), search = {}, activities = {}, fail = false } = {}) {
  let slots = [],
    index = 0,
    queued = [],
    dirty = false,
    tree;
  const rows = [],
    updates = [],
    destinations = [];
  const context = {
    exports: {},
    crypto: { randomUUID: () => "evidence-id" },
    URL: { createObjectURL: () => "blob:evidence", revokeObjectURL() {} },
    window: { confirm: () => true },
    sessionStorage: {
      getItem: (key) => storage.get(key) ?? null,
      setItem: (key, value) => storage.set(key, value),
      removeItem: (key) => storage.delete(key),
    },
    require(name) {
      if (name === "react")
        return {
          useState(initial) {
            const i = index++;
            slots[i] ??= { value: initial };
            return [
              slots[i].value,
              (next) => {
                const value = typeof next === "function" ? next(slots[i].value) : next;
                if (!Object.is(value, slots[i].value)) {
                  slots[i].value = value;
                  dirty = true;
                }
              },
            ];
          },
          useRef(initial) {
            const i = index++;
            slots[i] ??= { current: initial };
            return slots[i];
          },
          useEffect(fn, deps) {
            const i = index++;
            const old = slots[i];
            if (!old || deps.some((value, j) => !Object.is(value, old.deps[j]))) {
              slots[i] = { deps };
              queued.push(() => {
                old?.cleanup?.();
                slots[i].cleanup = fn();
              });
            }
          },
        };
      if (name === "react/jsx-runtime")
        return {
          jsx: (type, props) => ({ type, props }),
          jsxs: (type, props) => ({ type, props }),
        };
      if (name === "@tanstack/react-router")
        return {
          createFileRoute: () => (route) => ({ ...route, useSearch: () => search }),
          useNavigate: () => (to) => destinations.push(to),
        };
      if (name === "@tanstack/react-query")
        return { useQueryClient: () => ({ invalidateQueries() {} }) };
      if (name === "@/lib/auth") return { useAuth: () => ({ user: { id: "user" } }) };
      if (name === "@/lib/numeric") return numeric;
      if (name === "@/lib/duration") return duration;
      if (name === "@/lib/challenge")
        return {
          useMyChallenge: () => ({ data: { id: "challenge", timezone: "Europe/Stockholm" } }),
          useActivity: () => ({ data: activities[search.edit], isLoading: false }),
          todayIn: () => "2026-10-03",
          isActivityEditable: () => true,
          activityMetrics: () => null,
        };
      if (name === "@/lib/challenge-evidence")
        return { optimizeEvidenceImage: async (file) => file };
      if (name === "@/lib/private-image-upload")
        return {
          PRIVATE_IMAGE_MAX_BYTES: 15e6,
          inspectPrivateImage: async () => ({ mimeType: "image/jpeg", extension: "jpg" }),
          isPrivateImageValidationError: () => false,
        };
      if (name === "@/lib/network-errors") return { userFacingError: () => "Retry" };
      if (name === "@/lib/lovable-error-reporting") return { reportLovableError() {} };
      if (name === "sonner") return { toast: { success() {} } };
      if (name === "@/integrations/supabase/client")
        return {
          supabase: {
            storage: {
              from: () => ({
                upload: async () => ({ error: null }),
                remove: async () => ({ error: null }),
              }),
            },
            from: () => ({
              insert: async (row) => {
                rows.push(row);
                return { error: fail ? new Error("failed") : null };
              },
              update: (row) => ({
                eq: async (_, id) => {
                  updates.push({ row, id });
                  return { error: fail ? new Error("failed") : null };
                },
              }),
            }),
          },
        };
      return {};
    },
  };
  vm.runInNewContext(compiled, context);
  function render() {
    for (let n = 0; n < 30; n++) {
      dirty = false;
      index = 0;
      queued = [];
      tree = context.exports.Route.component();
      queued.forEach((effect) => effect());
      if (!dirty) return;
    }
    throw new Error("Form effects did not settle");
  }
  function nodes(node) {
    if (arguments.length === 0) node = tree;
    if (Array.isArray(node)) return node.flatMap((child) => nodes(child));
    if (!node || typeof node !== "object") return [];
    return [node, ...nodes(node.props?.children)];
  }
  function input(placeholder) {
    return nodes().find((node) => node.type === "input" && node.props.placeholder === placeholder);
  }
  function fill() {
    input("0.0").props.onChange({ target: { value: "7,25" } });
    input("e.g. 22:20").props.onChange({ target: { value: "40:00" } });
    nodes()
      .find((n) => n.type === "input" && n.props.type === "file")
      .props.onChange({
        target: { files: [{ name: "photo.jpg", type: "image/jpeg", size: 500 }], value: "" },
      });
    render();
  }
  async function save() {
    nodes()
      .find((n) => n.type === "button" && /^Save /.test(n.props["aria-label"] ?? ""))
      .props.onClick();
    // Flush persistence while upload/normalization/save are in flight as React would.
    render();
    await new Promise((resolve) => setImmediate(resolve));
    render();
  }
  function remount(nextSearch = search) {
    slots.forEach((slot) => slot?.cleanup?.());
    slots = [];
    search = nextSearch;
    render();
  }
  render();
  return {
    storage,
    rows,
    updates,
    destinations,
    nodes,
    input,
    fill,
    save,
    remount,
    search(next) {
      search = next;
      render();
    },
    discard() {
      nodes()
        .find((n) => n.type === "button" && /Discard draft|Cancel edit/.test(n.props.children))
        .props.onClick();
      render();
    },
  };
}

test("unsaved activity restores fields after navigation/reload", () => {
  const f = fixture();
  f.fill();
  f.remount();
  assert.equal(f.input("0.0").props.value, "7,25");
  assert.equal(f.input("e.g. 22:20").props.value, "40:00");
});
test("confirmed save closes persistence and clears fields/evidence; next activity is blank", async () => {
  const f = fixture();
  f.fill();
  await f.save();
  assert.equal(f.rows.length, 1);
  assert.equal(f.storage.has(newKey), false);
  assert.equal(f.input("0.0").props.value, "");
  assert.equal(
    f.nodes().some((n) => n.type === "img"),
    false,
  );
  f.remount();
  assert.equal(f.input("0.0").props.value, "");
  assert.equal(f.input("e.g. 22:20").props.value, "");
});
test("confirmed edit clears only its scoped edit draft", async () => {
  const storage = new Map([[newKey, JSON.stringify({ distance: "99" })]]);
  const f = fixture({ storage, search: { edit: "a" }, activities: { a: activity("a") } });
  f.fill();
  assert.equal(storage.has(`${newKey}:edit:a`), true);
  await f.save();
  assert.equal(f.updates[0].id, "a");
  assert.equal(storage.has(`${newKey}:edit:a`), false);
  assert.equal(JSON.parse(storage.get(newKey)).distance, "99");
});
test("explicit Ride overrides Run draft on mount and same-route navigation", () => {
  const storage = new Map([[newKey, JSON.stringify({ type: "run", distance: "4" })]]);
  const f = fixture({ storage, search: { type: "cycle" } });
  assert.equal(JSON.parse(storage.get(newKey)).type, "cycle");
  f.fill();
  f.search({ type: "run" });
  f.search({ type: "cycle" });
  assert.equal(
    f.nodes().some((n) => n.type === "img"),
    true,
  );
  assert.equal(JSON.parse(storage.get(newKey)).type, "cycle");
});
test("edit loads requested activity, never unrelated new draft, including changing edit IDs", () => {
  const storage = new Map([
    [newKey, JSON.stringify({ type: "cycle", distance: "99", duration: "99:00" })],
  ]);
  const f = fixture({
    storage,
    search: { edit: "a" },
    activities: { a: activity("a", 3), b: activity("b", 8) },
  });
  assert.equal(f.input("0.0").props.value, "3");
  f.search({ edit: "b" });
  assert.equal(f.input("0.0").props.value, "8");
});
test("discard/cancel clears its draft and cannot recreate it; failed save preserves draft", async () => {
  for (const editing of [false, true]) {
    const f = fixture({ search: editing ? { edit: "a" } : {}, activities: { a: activity("a") } });
    f.fill();
    f.discard();
    assert.equal(f.storage.size, 0);
  }
  const f = fixture({ fail: true });
  f.fill();
  await f.save();
  assert.equal(JSON.parse(f.storage.get(newKey)).distance, "7.25");
  assert.equal(
    f.nodes().some((n) => n.type === "img"),
    true,
  );
});

test("unsaved edit restores only its activity-scoped changes on reload", () => {
  const f = fixture({ search: { edit: "a" }, activities: { a: activity("a") } });
  f.fill();
  f.remount();
  assert.equal(f.input("0.0").props.value, "7,25");
  assert.equal(f.input("e.g. 22:20").props.value, "40:00");
});
