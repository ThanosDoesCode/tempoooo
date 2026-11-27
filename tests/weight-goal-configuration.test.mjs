import { test } from "node:test";
import assert from "node:assert/strict";
import { QueryClient, queryOptions } from "@tanstack/react-query";
import { accountUI, event, deferred } from "./account-ui-fixture.mjs";
import { presentationComponent } from "./presentation-component-fixture.mjs";
import * as types from "../src/lib/types.ts";
import * as calc from "../src/lib/calc.ts";
import * as coach from "../src/lib/weekly-progress-coach.ts";
import { createSaveQueue } from "../src/lib/workout-save.ts";

const plain = (value) => JSON.parse(JSON.stringify(value));
const base = {
  goal: "gain",
  targetWeight: 75,
  calories: 2400,
  protein: 140,
  carbs: 300,
  fat: 80,
  weeklyWorkoutGoal: 4,
  trainingDaysPerWeek: 3,
  exerciseSetupNotes: { Row: "Seat 3" },
  legacyMarker: "preserve",
};
const nutrition = presentationComponent("src/lib/bulk-nutrition-query.ts", {
  "@tanstack/react-query": { queryOptions },
  "@/integrations/supabase/client": {},
  "./network-errors": {},
  "./calc": calc,
});

async function fixture(saved = base, role = "owner") {
  let payload = plain(saved);
  const writes = [];
  const errors = { read: false, save: false };
  const dirty = [];
  const client = new QueryClient();
  const supabase = {
    from(table) {
      let single = false;
      const query = {
        maybeSingle() {
          single = true;
          return this;
        },
        then(resolve, reject) {
          return Promise.resolve({
            data: table === "bulk_targets" ? { payload } : single ? null : [],
            error: null,
          }).then(resolve, reject);
        },
      };
      for (const method of ["select", "eq", "order", "limit", "gt", "gte", "lte"])
        query[method] = () => query;
      return query;
    },
    async rpc(name, args) {
      assert.equal(name, "save_bulk_targets_for_local_day");
      assert.equal(args._profile, "profile");
      assert.equal(args._timezone, Intl.DateTimeFormat().resolvedOptions().timeZone);
      writes.push(plain(args._targets));
      if (errors.save) return { data: null, error: { message: "Save failed" } };
      payload = plain(args._targets);
      return { data: calc.iso(new Date()), error: null };
    },
  };
  const api = presentationComponent("src/lib/store.ts", {
    react: { useCallback: (fn) => fn, useSyncExternalStore: (_subscribe, get) => get() },
    "@/integrations/supabase/client": { supabase },
    "@/lib/private-image-upload": {},
    "./workout-save": { createSaveQueue },
    "./types": types,
  });
  await api.loadBulk("profile", role);
  const query = {
    data: { savedTargets: plain(payload) },
    isLoading: false,
    error: null,
    async refetch() {
      if (errors.read) throw new Error("Read failed");
      query.data = { savedTargets: plain(payload) };
      return { data: query.data };
    },
  };
  const ui = accountUI(
    "src/components/WeightGoalConfigurationEditor.tsx",
    "WeightGoalConfigurationEditor",
    {
      "@tanstack/react-query": { useQueryClient: () => client },
      "@/lib/store": api,
      "@/lib/weekly-progress-coach": coach,
      "@/lib/bulk-nutrition-query": nutrition,
      "@/lib/network-errors": { userFacingError: (cause) => cause.message },
      "@/components/ui/native-select": { NativeSelect: "select" },
      "@/components/ui-kit": {
        Card: "Card",
        SectionTitle: "SectionTitle",
        PendingLabel: "PendingLabel",
        DataError: ({ message }) => message,
      },
    },
    { query, onDirtyChange: (value) => dirty.push(value) },
  );
  return {
    ui,
    api,
    client,
    query,
    writes,
    dirty,
    errors,
    payload: () => payload,
    externalPatch(patch) {
      payload = { ...payload, ...patch };
    },
    dispose() {
      ui.dispose();
      client.clear();
    },
  };
}

test("a missing pace is blank and saves only an explicit pace, preserving raw legacy settings", async () => {
  const f = await fixture();
  const day = calc.iso(new Date());
  const keys = [
    ["bulk-today", "profile", day],
    ["bulk-weekly-recommendation", "profile", "target-history", day],
  ];
  for (const key of [...keys, ["bulk-today", "other", day]]) f.client.setQueryData(key, {});
  try {
    assert.equal(f.ui.find("select")[0].props.value, "gain");
    assert.deepEqual(
      f.ui.find("input").map((node) => node.props.value),
      ["75", ""],
    );
    assert.deepEqual(f.writes, []);
    f.ui.find("input")[1].props.onChange(event("0.25"));
    f.ui.render();
    assert.equal(f.dirty.at(-1), true);
    f.ui.button("Save goal details").props.onClick();
    await f.ui.flush();
    assert.deepEqual(f.payload(), { ...base, targetWeeklyGainKg: 0.25 });
    assert.equal(
      Object.hasOwn(f.payload(), "startWeight"),
      false,
      "never persist the store's personal compatibility baseline",
    );
    assert.equal(Object.hasOwn(f.payload(), "water"), false);
    assert.equal(
      f.api.useAppData().targets.startWeight,
      types.DEFAULT_DATA.targets.startWeight,
      "read compatibility remains in memory",
    );
    assert.equal(f.ui.button("Goal details saved").props.disabled, true);
    assert.equal(f.dirty.at(-1), false);
    for (const key of keys) assert.equal(f.client.getQueryState(key).isInvalidated, true);
    assert.equal(f.client.getQueryState(["bulk-today", "other", day]).isInvalidated, false);
  } finally {
    f.dispose();
  }
});

test("a target with no saved goal type offers no inferred selection", async () => {
  const saved = { ...base, targetWeeklyGainKg: 0.25 };
  delete saved.goal;
  const f = await fixture(saved);
  try {
    assert.equal(f.ui.find("select")[0].props.value, "");
    f.ui.find("select")[0].props.onChange(event("gain"));
    f.ui.button("Save goal details").props.onClick();
    await f.ui.flush();
    assert.deepEqual(f.payload(), { ...saved, goal: "gain" });
  } finally {
    f.dispose();
  }
});

test("missing target weight is not replaced by the store's default and can be explicitly completed", async () => {
  const saved = { ...base, goal: "cut", startWeight: 70, targetWeeklyGainKg: 0.25 };
  delete saved.targetWeight;
  const f = await fixture(saved);
  try {
    assert.equal(f.ui.find("input")[0].props.value, "");
    f.ui.find("input")[0].props.onChange(event("65"));
    f.ui.button("Save goal details").props.onClick();
    await f.ui.flush();
    assert.deepEqual(f.payload(), { ...saved, targetWeight: 65 });
  } finally {
    f.dispose();
  }
});

test("maintenance requires a deliberately entered zero, not an empty field", async () => {
  const f = await fixture({ ...base, goal: "maintain", targetWeight: 70 });
  try {
    f.ui.find("input")[1].props.onChange(event(" "));
    f.ui.button("Save goal details").props.onClick();
    await f.ui.flush();
    assert.deepEqual(f.writes, []);
    assert.match(f.ui.text(), /Check weekly pace/);
    f.ui.find("input")[1].props.onChange(event("0"));
    f.ui.button("Save goal details").props.onClick();
    await f.ui.flush();
    assert.equal(f.payload().targetWeeklyGainKg, 0);
  } finally {
    f.dispose();
  }
});

test("fresh saved settings preserve concurrent nutrition edits and reject changed goal fields", async () => {
  const f = await fixture();
  try {
    f.ui.find("input")[1].props.onChange(event("0.25"));
    f.externalPatch({ calories: 2600, protein: 150 });
    f.ui.button("Save goal details").props.onClick();
    await f.ui.flush();
    assert.deepEqual(f.payload(), {
      ...base,
      calories: 2600,
      protein: 150,
      targetWeeklyGainKg: 0.25,
    });
  } finally {
    f.dispose();
  }
  const stale = await fixture();
  try {
    stale.ui.find("input")[1].props.onChange(event("0.25"));
    stale.externalPatch({ targetWeight: 80 });
    stale.ui.button("Save goal details").props.onClick();
    await stale.ui.flush();
    assert.deepEqual(stale.writes, []);
    assert.match(stale.ui.text(), /another device/);
  } finally {
    stale.dispose();
  }
});

test("failed read or save preserves draft; failed synchronization does not repeat a saved mutation", async () => {
  for (const failure of ["read", "save", "sync"]) {
    const f = await fixture();
    try {
      f.ui.find("input")[1].props.onChange(event("0.25"));
      if (failure === "sync")
        f.client.invalidateQueries = async () => {
          throw new Error("offline");
        };
      else f.errors[failure] = true;
      f.ui.button("Save goal details").props.onClick();
      await f.ui.flush();
      assert.equal(f.ui.find("input")[1].props.value, "0.25");
      if (failure === "sync") {
        assert.equal(f.writes.length, 1);
        assert.match(f.ui.text(), /were saved, but the screen couldn’t refresh/);
        assert.equal(f.ui.button("Goal details saved").props.disabled, true);
      } else assert.match(f.ui.text(), /failed/i);
    } finally {
      f.dispose();
    }
  }
});

test("complete profiles need no repair form, and missing nutrition data cannot produce a write", async () => {
  const complete = await fixture({ ...base, targetWeeklyGainKg: 0.25 });
  try {
    assert.equal(complete.ui.render(), null);
    assert.deepEqual(complete.writes, []);
  } finally {
    complete.dispose();
  }
  const f = await fixture({ goal: "gain", targetWeight: 75 });
  try {
    f.ui.find("input")[1].props.onChange(event("0.25"));
    f.ui.button("Save goal details").props.onClick();
    await f.ui.flush();
    assert.deepEqual(f.writes, []);
    assert.match(f.ui.text(), /nutrition targets are unavailable/);
  } finally {
    f.dispose();
  }
});

test("viewer access and missing/query-error states are honest and cannot save", async () => {
  const f = await fixture(base, "viewer");
  try {
    f.ui.find("input")[1].props.onChange(event("0.25"));
    assert.equal(f.ui.button("Save goal details").props.disabled, true);
    f.ui.button("Save goal details").props.onClick();
    await f.ui.flush();
    assert.deepEqual(f.writes, []);
    f.query.data = { savedTargets: null };
    assert.match(f.ui.text(), /No saved goal settings/);
    f.query.error = new Error("offline");
    assert.match(f.ui.text(), /Couldn’t load saved goal details/);
  } finally {
    f.dispose();
  }
});

test("an account switch during the fresh read cannot save the previous account's draft", async () => {
  const f = await fixture();
  const pending = deferred();
  try {
    f.ui.find("input")[1].props.onChange(event("0.25"));
    f.query.refetch = () => pending.promise;
    f.ui.button("Save goal details").props.onClick();
    await f.api.loadBulk("other", "owner");
    pending.resolve({ data: { savedTargets: plain(base) } });
    await f.ui.flush();
    assert.deepEqual(f.writes, []);
    assert.match(f.ui.text(), /Account changed/);
  } finally {
    pending.resolve({ data: null });
    f.dispose();
  }
});
