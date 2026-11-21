import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import { createMemoryHistory, createBrowserHistory } from "@tanstack/history";
import { createOverlayHistory } from "../src/lib/overlay-history.ts";
import {
  trackInAppHistory,
  inAppBackLocation,
  backWithinApp,
  safeBack,
  observeNavigationIdentity,
} from "../src/lib/in-app-back.ts";

const settle = async () => {
  for (let i = 0; i < 6; i++) await new Promise(setImmediate);
};
const read = (file) => readFileSync(new URL(`../${file}`, import.meta.url), "utf8");
function fixture(history = createMemoryHistory({ initialEntries: ["/challenge"] })) {
  const controller = createOverlayHistory(history);
  const layers = new Map();
  const add = (id, depth = 0, options = {}) => {
    const layer = {
      id,
      depth,
      open: true,
      change(open) {
        layer.open = open;
        controller.update(layer);
      },
      ...options,
    };
    layers.set(id, layer);
    controller.update(layer);
    return layer;
  };
  return { history, controller, add, layers };
}

test("Log sheet Back closes the overlay before navigating, including direct entry", async () => {
  const f = fixture();
  const log = f.add("log");
  await settle();
  assert.equal(f.history.location.state.__TSR_index, 1);
  assert.equal(backWithinApp(f.history), true);
  await settle();
  assert.equal(log.open, false);
  assert.equal(f.history.location.href, "/challenge");
  assert.equal(f.history.location.state.__TSR_index, 0);
  f.controller.destroy();
});

test("nested overlays close one layer per browser Back", async () => {
  const f = fixture();
  const dialog = f.add("dialog");
  await settle();
  const picker = f.add("picker", 1);
  await settle();
  assert.equal(f.history.location.state.__TSR_index, 1, "one shared frame, no parallel route tree");
  f.history.back();
  await settle();
  assert.equal(picker.open, false);
  assert.equal(dialog.open, true);
  f.history.back();
  await settle();
  assert.equal(dialog.open, false);
  assert.equal(f.history.location.state.__TSR_index, 0);
  f.controller.destroy();
});

test("Escape/X closes to the base entry; Forward restores a mounted evidence viewer", async () => {
  const f = fixture();
  const viewer = f.add("evidence");
  await settle();
  viewer.change(false);
  await settle();
  assert.equal(f.history.location.state.__TSR_index, 0);
  f.history.forward();
  await settle();
  assert.equal(viewer.open, true);
  f.history.back();
  await settle();
  assert.equal(viewer.open, false);
  f.controller.remove("evidence");
  f.history.forward();
  await settle();
  assert.equal(
    f.history.location.state.__TSR_index,
    0,
    "an unmounted viewer never becomes a ghost page",
  );
  f.controller.destroy();
});

test("non-dismissible pending operations cannot be dismissed by browser Back", async () => {
  const f = fixture();
  const deletion = f.add("delete", 0, { dismissible: false });
  await settle();
  f.history.back();
  await settle();
  assert.equal(deletion.open, true);
  assert.equal(f.history.location.state.__TSR_index, 1);
  f.controller.destroy();
});

test("a blocked-navigation confirmation owns Back without pushing a competing frame", async () => {
  const f = fixture();
  const step = f.add("editor", 0, { kind: "step" });
  await settle();
  const confirmation = f.add("guard", 0, { kind: "guard", frame: false });
  await settle();
  assert.equal(f.history.location.state.__TSR_index, 1);
  backWithinApp(f.history);
  await settle();
  assert.equal(confirmation.open, false);
  assert.equal(step.open, true);
  assert.equal(f.history.location.state.__TSR_index, 1);
  f.controller.destroy();
});

test("closing during an in-flight overlay navigation cleans the frame after navigation settles", async () => {
  const history = createMemoryHistory({ initialEntries: ["/bulk"] });
  let finish;
  const controller = createOverlayHistory(history, (token) => {
    history.push(history.location.href, { tempoOverlay: token });
    return new Promise((resolve) => {
      finish = resolve;
    });
  });
  const layer = {
    id: "rapid",
    depth: 0,
    open: true,
    change(open) {
      layer.open = open;
      controller.update(layer);
    },
  };
  controller.update(layer);
  await settle();
  layer.change(false);
  await settle();
  finish();
  await settle();
  assert.equal(history.location.state.__TSR_index, 0);
  assert.equal(layer.open, false);
  controller.destroy();
});

test("date replacements inside a picker rebase the underlying page without date-history pollution", async () => {
  const history = createMemoryHistory({ initialEntries: ["/bulk"] });
  trackInAppHistory(history);
  history.push("/bulk/meals?date=2026-11-20");
  const f = fixture(history);
  const picker = f.add("date");
  await settle();
  for (const date of ["2026-11-19", "2026-11-18", "2026-11-17"])
    history.replace(`/bulk/meals?date=${date}`);
  picker.change(false);
  await settle();
  assert.equal(history.location.href, "/bulk/meals?date=2026-11-17");
  assert.equal(history.location.state.__TSR_index, 1);
  assert.equal(inAppBackLocation(history)?.pathname, "/bulk");
  history.back();
  assert.equal(history.location.href, "/bulk");
  f.controller.destroy();
});

for (const entry of [
  "/planner?view=calendar&month=2026-11&item=planned",
  "/planner?item=planned",
]) {
  test(`Planner item deep entry closes before leaving: ${entry}`, async () => {
    const f = fixture(createMemoryHistory({ initialEntries: [entry] }));
    const sheet = f.add("planned", 0, {
      change(open) {
        sheet.open = open;
        f.controller.update(sheet);
        f.history.replace(
          open ? entry : entry.replace(/([?&])item=planned/, "").replace(/\?$/, ""),
        );
      },
    });
    await settle();
    f.history.back();
    await settle();
    assert.equal(sheet.open, false);
    assert.equal(f.history.location.pathname, "/planner");
    assert.doesNotMatch(f.history.location.search, /item=/);
    assert.equal(f.history.location.state.__TSR_index, 0);
    f.history.forward();
    await settle();
    assert.equal(sheet.open, true);
    f.controller.destroy();
  });
}

test("a successful direct-entry form collapses its confirmation before replacing the form", async () => {
  const f = fixture(createMemoryHistory({ initialEntries: ["/challenge/add"] }));
  f.add("discard");
  await settle();
  const router = {
    history: f.history,
    navigate: async ({ href, replace }) => {
      assert.equal(replace, true);
      f.history.replace(href);
    },
  };
  await safeBack(router, "/challenge", { parentPath: "/challenge", completed: true });
  await settle();
  assert.equal(f.history.location.href, "/challenge");
  assert.equal(f.history.location.state.__TSR_index, 0);
  f.history.forward();
  await settle();
  assert.equal(f.history.location.href, "/challenge");
  f.controller.destroy();
});

test("a screen opened from the Log sheet returns to its real origin, not the closed sheet", async () => {
  const f = fixture(createMemoryHistory({ initialEntries: ["/community?q=alice#friends"] }));
  const log = f.add("log");
  await settle();
  log.change(false);
  f.history.push("/bulk/morning");
  await settle();
  assert.deepEqual(inAppBackLocation(f.history), {
    pathname: "/community",
    search: "?q=alice",
    hash: "#friends",
  });
  f.history.back();
  await settle();
  assert.equal(f.history.location.href, "/community?q=alice#friends");
  assert.equal(log.open, false);
  f.controller.destroy();
});

for (const browser of [false, true]) {
  const create = (path) =>
    browser
      ? createBrowserHistory({ window: browserWindow(path) })
      : createMemoryHistory({ initialEntries: [path] });

  test(`${browser ? "browser" : "memory"} Forward skips a retired Log frame and reaches check-in`, async () => {
    const origin = "/community?q=alice#friends";
    const history = create(origin);
    const f = fixture(history);
    const log = f.add("log");
    await settle();
    // The real Log action closes the sheet and immediately navigates in the same event.
    log.change(false);
    history.push("/bulk/morning");
    await settle();
    assert.equal(history.location.pathname, "/bulk/morning");
    const length = history.length;
    for (let pass = 0; pass < 3; pass++) {
      history.back();
      await settle();
      assert.equal(history.location.href, origin);
      history.forward();
      await settle();
      assert.equal(history.location.pathname, "/bulk/morning");
      history.forward();
      await settle();
      assert.equal(history.location.pathname, "/bulk/morning");
      assert.equal(log.open, false);
      assert.equal(history.length, length, "traversal must not synthesize more entries");
    }
    history.back();
    await settle();
    assert.equal(history.location.href, origin);
    f.controller.destroy();
    history.destroy();
  });

  test(`${browser ? "browser" : "memory"} multi-entry Back preserves Training URL and entry identity`, async () => {
    const history = create("/community?section=plans#saved");
    history.push("/bulk/training?day=2#workouts", { screen: "training" });
    await settle();
    const training = structuredClone(history.location);
    history.push("/bulk/workout/session?exercise=2#sets");
    await settle();
    const f = fixture(history);
    f.add("finish");
    await settle();
    history.go(-2);
    await settle();
    assert.deepEqual(history.location, training);
    history.forward();
    await settle();
    assert.equal(history.location.href, "/bulk/workout/session?exercise=2#sets");
    history.forward();
    await settle();
    assert.equal(history.location.href, "/bulk/workout/session?exercise=2#sets");
    history.back();
    await settle();
    assert.deepEqual(history.location, training);
    history.back();
    await settle();
    assert.equal(history.location.href, "/community?section=plans#saved");
    f.controller.destroy();
    history.destroy();
  });
}

test("an overlay cannot rebase a replaced entry that merely occupies its old base index", async () => {
  const f = fixture(createMemoryHistory({ initialEntries: ["/bulk/workout/session"] }));
  const finish = f.add("finish");
  await settle();
  finish.change(false);
  await settle();
  f.history.replace("/bulk/workout/session?exercise=3#actual", { screen: "replacement" });
  const replacement = structuredClone(f.history.location);
  f.history.forward();
  await settle();
  f.history.back();
  await settle();
  assert.deepEqual(f.history.location, replacement, "matching index alone is not ownership");
  f.controller.destroy();
});

test("an embedded editor receives Back before its bridge, including its dirty discard flow", async () => {
  const f = fixture();
  let bridgeCalls = 0;
  let editing = true;
  let discard;
  const bridge = f.add("bridge", 0, {
    change(open) {
      bridgeCalls++;
      if (!editing) {
        bridge.open = open;
        f.controller.update(bridge);
      }
    },
  });
  const editor = f.add("editor", 1, {
    kind: "step",
    parentId: "bridge",
    change(open) {
      if (!open) discard = f.add("discard", 1, { parentId: "bridge", kind: "overlay" });
    },
  });
  await settle();
  f.history.back();
  await settle();
  assert.equal(bridgeCalls, 0);
  assert.equal(editor.open, true, "dirty edits stay until the explicit discard decision");
  assert.equal(discard.open, true);
  backWithinApp(f.history);
  await settle();
  assert.equal(discard.open, false, "Back keeps editing instead of dismissing the bridge");
  assert.equal(editor.open, true);
  backWithinApp(f.history);
  await settle();
  assert.equal(discard.open, true);
  // The existing explicit Discard action exits the editor; no workout data operation is changed.
  editing = false;
  f.controller.remove(editor.id);
  discard.change(false);
  await settle();
  backWithinApp(f.history);
  await settle();
  assert.equal(bridgeCalls, 1);
  assert.equal(bridge.open, false);
  f.controller.destroy();
});

for (const childFirst of [true, false])
  test(`equal-depth plan/day hierarchy ignores ${childFirst ? "child-first" : "parent-first"} registration`, async () => {
    const f = fixture();
    let plan;
    let day;
    const parent = () => (plan = f.add("plan", 0, { kind: "step" }));
    const child = () => (day = f.add("day", 0, { kind: "step", parentId: "plan", open: false }));
    if (childFirst) {
      child();
      parent();
    } else {
      parent();
      child();
    }
    await settle();
    day.change(true);
    await settle();
    f.history.back();
    await settle();
    assert.equal(day.open, false);
    assert.equal(plan.open, true);
    f.history.back();
    await settle();
    assert.equal(plan.open, false);
    f.controller.destroy();
  });

test("local wizard steps replace and browser Back cannot bounce forward", async () => {
  const f = fixture(createMemoryHistory({ initialEntries: ["/challenge/new?step=1"] }));
  let step = 2;
  f.history.replace("/challenge/new?step=2");
  const owner = f.add("wizard", 0, {
    kind: "step",
    change(open) {
      step = open ? 2 : step - 1;
      owner.open = step > 1;
      f.controller.update(owner);
      f.history.replace(`/challenge/new?step=${step}`);
    },
  });
  await settle();
  f.history.replace("/challenge/new?step=1");
  step = 1;
  owner.open = false;
  f.controller.update(owner);
  await settle();
  assert.equal(f.history.location.state.__TSR_index, 0);
  assert.equal(f.history.location.search, "?step=1");
  f.controller.destroy();
});

function browserWindow(path) {
  const listeners = new Map();
  const entries = [{ url: new URL(path, "https://tempo.test"), state: null }];
  let index = 0;
  const win = {
    get location() {
      return entries[index].url;
    },
    addEventListener(type, callback) {
      const set = listeners.get(type) ?? new Set();
      set.add(callback);
      listeners.set(type, set);
    },
    removeEventListener(type, callback) {
      listeners.get(type)?.delete(callback);
    },
    history: {
      get state() {
        return entries[index].state;
      },
      get length() {
        return entries.length;
      },
      pushState(state, _title, href) {
        entries.splice(index + 1);
        entries.push({ state, url: new URL(href ?? entries[index].url, entries[index].url) });
        index++;
      },
      replaceState(state, _title, href) {
        entries[index] = { state, url: new URL(href ?? entries[index].url, entries[index].url) };
      },
      go(delta) {
        const next = index + delta;
        if (next < 0 || next >= entries.length) return;
        setImmediate(() => {
          index = next;
          for (const callback of listeners.get("popstate") ?? []) void callback({});
        });
      },
      back() {
        this.go(-1);
      },
      forward() {
        this.go(1);
      },
    },
  };
  return win;
}

test("real TanStack browser history handles asynchronous pop, Forward and nested overlays", async () => {
  const history = createBrowserHistory({ window: browserWindow("/profile/settings") });
  const f = fixture(history);
  const outer = f.add("username");
  await settle();
  const inner = f.add("picker", 1);
  await settle();
  history.back();
  await settle();
  assert.equal(inner.open, false);
  assert.equal(outer.open, true);
  history.back();
  await settle();
  assert.equal(outer.open, false);
  history.forward();
  await settle();
  assert.equal(outer.open, true);
  outer.change(false);
  await settle();
  assert.equal(history.location.state.__TSR_index, 0);
  f.controller.destroy();
  history.destroy();
});

test("a dirty browser Back can be cancelled, retried and confirmed without duplicate navigation", async (t) => {
  const originalDocument = globalThis.document;
  globalThis.document = {};
  t.after(() => {
    if (originalDocument === undefined) delete globalThis.document;
    else globalThis.document = originalDocument;
  });
  const history = createBrowserHistory({ window: browserWindow("/community?q=alice") });
  trackInAppHistory(history);
  history.push("/planner/new");
  await settle();
  let resolve;
  let attempts = 0;
  const unblock = history.block({
    blockerFn: () => {
      attempts++;
      return new Promise((done) => {
        resolve = done;
      });
    },
    enableBeforeUnload: false,
  });
  backWithinApp(history);
  backWithinApp(history);
  await settle();
  assert.equal(attempts, 1);
  resolve(true);
  await settle();
  assert.equal(history.location.pathname, "/planner/new");
  backWithinApp(history);
  await settle();
  assert.equal(attempts, 2);
  resolve(false);
  await settle();
  assert.equal(history.location.href, "/community?q=alice");
  unblock();
  history.destroy();
});

test("overlay wiring preserves one route tree and retires raw evidence history", () => {
  for (const file of ["dialog-root", "drawer", "alert-dialog"])
    assert.match(read(`src/components/ui/${file}.tsx`), /NavigationOverlay/);
  const viewer = read("src/components/ChallengeEvidenceViewer.tsx");
  assert.match(viewer, /useOverlayBack\(open/);
  assert.doesNotMatch(viewer, /window\.history|popstate|preservedState/);
  assert.match(read("src/components/NavigationOverlay.tsx"), /resetScroll: false/);
  assert.match(read("src/components/NavigationOverlay.tsx"), /parentId/);
  assert.match(
    read("src/routes/_authenticated/bulk/training_.plans.tsx"),
    /<NavigationBackScope ownerId=\{backOwner\}>[\s\S]*<TrainingPlanEditor/,
  );
  assert.doesNotMatch(
    read("src/components/NavigationOverlay.tsx"),
    /<Outlet|QueryClient|invalidateQueries/,
  );
});
