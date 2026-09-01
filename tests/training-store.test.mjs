import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";
import ts from "typescript";
import { DEFAULT_DATA } from "../src/lib/types.ts";
import { createSaveQueue } from "../src/lib/workout-save.ts";
const compiled = ts.transpileModule(
  await readFile(new URL("../src/lib/store.ts", import.meta.url), "utf8"),
  { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } },
).outputText;
async function fixture() {
  let fail = false,
    uid = "user-a",
    gate = null;
  const calls = [];
  const supabase = {
    auth: { getSession: async () => ({ data: { session: { user: { id: uid } } } }) },
    from(table) {
      return {
        select() {
          return this;
        },
        eq() {
          return this;
        },
        order() {
          return this;
        },
        maybeSingle: async () => ({ data: null, error: null }),
        then(resolve) {
          resolve({ data: [], error: null });
        },
        async upsert(row) {
          calls.push(row);
          if (gate) await gate;
          if (fail) return { error: { message: "offline" } };
          return { error: null };
        },
      };
    },
  };
  const context = {
    exports: {},
    require(name) {
      if (name === "react")
        return { useCallback: (fn) => fn, useSyncExternalStore: (_subscribe, get) => get() };
      if (name.includes("supabase/client")) return { supabase };
      if (name === "./workout-save") return { createSaveQueue };
      if (name === "./types") return { DEFAULT_DATA };
      throw new Error(name);
    },
  };
  vm.runInNewContext(compiled, context);
  await context.exports.loadBulk("plan-a", "owner");
  return {
    api: context.exports,
    calls,
    fail: (value = true) => {
      fail = value;
    },
    switchUser: () => {
      uid = "user-b";
    },
    hold: () => {
      let release;
      gate = new Promise((resolve) => {
        release = resolve;
      });
      return release;
    },
  };
}
const w = {
  date: "2026-08-31",
  type: "Chest & Back",
  status: "completed",
  entries: [{ exercise: "Cable Rows", weight: 20, reps: [10] }],
};
test("workout saves update completed data only after backend acknowledgement", async () => {
  const f = await fixture();
  const release = f.hold();
  const save = f.api.useActions().saveWorkout(w, "user-a");
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(f.api.useAppData().workouts[w.date], undefined);
  release();
  await save;
  assert.equal(f.api.useAppData().workouts[w.date].status, "completed");
});
test("failed completion rejects and never counts as a completed saved workout", async () => {
  const f = await fixture();
  f.fail();
  await assert.rejects(f.api.useActions().saveWorkout(w, "user-a"), /offline/);
  assert.equal(f.api.useAppData().workouts[w.date], undefined);
  f.fail(false);
  await f.api.useActions().saveWorkout(w, "user-a");
  assert.equal(f.api.useAppData().workouts[w.date].status, "completed");
});
test("autosave then completion cannot arrive out of order", async () => {
  const f = await fixture();
  const a = f.api.useActions();
  await Promise.all([
    a.saveWorkout({ ...w, status: "draft" }, "user-a"),
    a.saveWorkout(w, "user-a"),
  ]);
  assert.deepEqual(
    f.calls.map((row) => row.payload.status),
    ["draft", "completed"],
  );
  assert.equal(f.api.useAppData().workouts[w.date].status, "completed");
});
test("an account switch during a save cannot publish the old result into current state", async () => {
  const f = await fixture();
  const release = f.hold();
  const save = f.api.useActions().saveWorkout(w, "user-a");
  await new Promise((resolve) => setImmediate(resolve));
  f.switchUser();
  release();
  await save;
  assert.equal(f.api.useAppData().workouts[w.date], undefined);
});
test("a queued old-account save is rejected before its database write", async () => {
  const f = await fixture();
  const release = f.hold();
  const a = f.api.useActions();
  const first = a.saveWorkout({ ...w, status: "draft" }, "user-a");
  await new Promise((resolve) => setImmediate(resolve));
  const second = a.saveWorkout(w, "user-a");
  f.switchUser();
  release();
  await first;
  await assert.rejects(second, /Account or plan changed/);
  assert.equal(f.calls.length, 1);
  assert.equal(f.api.useAppData().workouts[w.date], undefined);
});
