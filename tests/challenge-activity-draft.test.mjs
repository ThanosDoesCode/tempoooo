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
  let blockerOptions;
  let blocker = { status: "idle" };
  let proceeded = 0,
    cancelled = 0;
  const navigate = (to) => {
    if (
      !blockerOptions.disabled &&
      blockerOptions.shouldBlockFn({
        current: { pathname: "/challenge/add" },
        next: { pathname: to.to },
      })
    ) {
      blocker = {
        status: "blocked",
        proceed: () => {
          proceeded++;
          destinations.push(to);
          blocker = { status: "idle" };
        },
        reset: () => {
          cancelled++;
          blocker = { status: "idle" };
        },
      };
    } else destinations.push(to);
  };
  const context = {
    exports: {},
    crypto: { randomUUID: () => "evidence-id" },
    URL: { createObjectURL: () => "blob:evidence", revokeObjectURL() {} },
    window: {
      confirm: () => {
        throw new Error("Native confirmation must not be used");
      },
    },
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
          useNavigate: () => navigate,
          useBlocker: (options) => {
            blockerOptions = options;
            return blocker;
          },
        };
      if (name === "@/components/ui/alert-dialog")
        return Object.fromEntries(
          [
            "AlertDialog",
            "AlertDialogAction",
            "AlertDialogCancel",
            "AlertDialogContent",
            "AlertDialogDescription",
            "AlertDialogFooter",
            "AlertDialogHeader",
            "AlertDialogTitle",
          ].map((value) => [value, value]),
        );
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
    render,
    get proceeded() {
      return proceeded;
    },
    get cancelled() {
      return cancelled;
    },
    get blockerOptions() {
      return blockerOptions;
    },
    leave(destination = { to: "/challenge" }) {
      navigate(destination);
      render();
    },
    keepEditing() {
      nodes()
        .find((n) => n.type === "AlertDialogCancel")
        .props.onClick();
      render();
    },
    closeDialog() {
      nodes()
        .find((n) => n.type === "AlertDialog")
        .props.onOpenChange(false);
      render();
    },
    confirmDiscard() {
      nodes()
        .find((n) => n.type === "AlertDialogAction")
        .props.onClick();
      render();
    },
    openDiscard() {
      nodes()
        .find((n) => n.type === "button" && /Discard draft|Cancel edit/.test(n.props.children))
        .props.onClick();
      render();
    },
    discard() {
      this.openDiscard();
      this.confirmDiscard();
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

test("custom discard confirmation keeps all draft values and evidence on Keep editing or Escape", () => {
  const f = fixture();
  f.fill();
  const before = f.storage.get(newKey);
  for (const cancel of [() => f.keepEditing(), () => f.closeDialog()]) {
    f.openDiscard();
    assert.equal(f.nodes().find((n) => n.type === "AlertDialog").props.open, true);
    assert.equal(
      f.nodes().find((n) => n.type === "AlertDialogTitle").props.children,
      "Discard unsaved changes?",
    );
    assert.equal(
      f.nodes().find((n) => n.type === "AlertDialogDescription").props.children,
      "Your run details haven’t been saved.",
    );
    cancel();
    assert.equal(f.storage.get(newKey), before);
    assert.equal(f.input("0.0").props.value, "7,25");
    assert.equal(f.input("e.g. 22:20").props.value, "40:00");
    assert.ok(f.nodes().some((n) => n.type === "img"));
    assert.equal(f.destinations.length, 0);
    assert.equal(f.nodes().find((n) => n.type === "AlertDialog").props.open, false);
  }
});

test("Discard draft and Cancel edit retain their original destinations and run only once", () => {
  for (const editing of [false, true]) {
    const f = fixture({ search: editing ? { edit: "a" } : {}, activities: { a: activity("a") } });
    f.fill();
    f.openDiscard();
    const action = f.nodes().find((n) => n.type === "AlertDialogAction").props.onClick;
    action();
    action();
    f.closeDialog();
    assert.equal(f.storage.size, 0);
    assert.deepEqual(
      JSON.parse(JSON.stringify(f.destinations)),
      editing
        ? [{ to: "/challenge/activity/$activityId", params: { activityId: "a" } }]
        : [{ to: "/challenge" }],
    );
    assert.equal(f.proceeded, 0);
  }
});

test("unsaved Back keeps its contextual destination, cancels safely, and proceeds only once", () => {
  const f = fixture();
  f.fill();
  const back = { to: "/challenge/activity/$activityId", params: { activityId: "previous" } };
  f.leave(back);
  assert.equal(f.destinations.length, 0);
  f.closeDialog();
  assert.equal(f.cancelled, 1);
  assert.ok(f.storage.has(newKey));
  f.leave(back);
  const action = f.nodes().find((n) => n.type === "AlertDialogAction").props.onClick;
  action();
  action();
  f.closeDialog();
  assert.equal(f.proceeded, 1);
  assert.equal(f.cancelled, 1);
  assert.deepEqual(JSON.parse(JSON.stringify(f.destinations)), [back]);
  assert.equal(f.storage.has(newKey), false);
});

test("blank form, unchanged edit and same-form type navigation do not prompt; saves still bypass guard", async () => {
  const blank = fixture();
  blank.leave();
  assert.equal(blank.destinations.length, 1);
  const edit = fixture({ search: { edit: "a" }, activities: { a: activity("a") } });
  edit.leave();
  assert.equal(edit.destinations.length, 1);
  const f = fixture({ search: { type: "cycle" } });
  f.fill();
  assert.equal(f.blockerOptions.enableBeforeUnload, false);
  f.leave({ to: "/challenge/add", search: { type: "run" } });
  assert.equal(f.destinations.length, 1);
  await f.save();
  assert.equal(f.rows[0].activity_type, "cycle");
  assert.equal(f.destinations.length, 2);
  assert.equal(f.nodes().find((n) => n.type === "AlertDialog").props.open, false);
  assert.equal(f.storage.has(newKey), false);
});

test("Tempo discard dialog uses existing accessible primitives and compact two-column touch targets", () => {
  const f = fixture();
  f.openDiscard();
  assert.doesNotMatch(source, /window\.confirm|\bconfirm\(/);
  assert.match(source, /@\/components\/ui\/alert-dialog/);
  const content = f.nodes().find((n) => n.type === "AlertDialogContent");
  assert.match(content.props.className, /w-\[calc\(100%-2\.5rem\)\] max-w-sm/);
  assert.match(content.props.className, /rounded-\[20px\].*border-border bg-card/);
  assert.match(content.props.className, /motion-reduce:animate-none/);
  const footer = f.nodes().find((n) => n.type === "AlertDialogFooter");
  assert.match(footer.props.className, /grid grid-cols-2 gap-2/);
  const cancel = f.nodes().find((n) => n.type === "AlertDialogCancel");
  const action = f.nodes().find((n) => n.type === "AlertDialogAction");
  assert.equal(cancel.props.children, "Keep editing");
  assert.equal(action.props.children, "Discard");
  for (const button of [cancel, action]) assert.match(button.props.className, /h-12 min-w-0/);
  assert.match(action.props.className, /bg-danger.*text-white/);
  assert.equal(typeof content.props.onOpenAutoFocus, "function");
  assert.equal(typeof content.props.onCloseAutoFocus, "function");
});
