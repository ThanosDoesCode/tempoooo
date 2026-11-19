import assert from "node:assert/strict";
import { test } from "node:test";
import { QueryClient } from "@tanstack/react-query";
import { accountUI, deferred } from "./account-ui-fixture.mjs";
import { presentationComponent } from "./presentation-component-fixture.mjs";

function fixture({
  preferencesError = false,
  accountEnabled = false,
  pushAdapter,
  requestPermission,
} = {}) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const stored = new Map();
  const writes = [];
  const reads = [];
  let owner = "account-a";
  let waitForWrite;
  const api = presentationComponent("src/lib/notification-settings.ts", {
    "@tanstack/react-query": {
      queryOptions: (options) => options,
      useQuery: (options) => ({
        data: queryClient.getQueryData(options.queryKey),
        isError: queryClient.getQueryState(options.queryKey)?.status === "error",
      }),
    },
    "./network-errors": {},
    "@/integrations/supabase/client": {
      supabase: {
        from(table) {
          let target;
          let columns;
          const response = () => {
            reads.push([table, target, columns]);
            if (preferencesError && table === "account_notification_preferences")
              return { data: null, error: new Error("Preference read failed") };
            const data =
              target !== owner
                ? null
                : table === "account_notification_preferences"
                  ? (stored.get(owner) ?? null)
                  : table === "challenge_push_users"
                    ? { enabled: accountEnabled }
                    : [{ id: "membership" }];
            return { data, error: null };
          };
          return {
            select(value) {
              columns = value;
              return this;
            },
            eq(_column, value) {
              target = value;
              return this;
            },
            abortSignal() {
              return this;
            },
            limit() {
              return this;
            },
            async maybeSingle() {
              return response();
            },
            then(resolve) {
              return Promise.resolve(response()).then(resolve);
            },
          };
        },
        async rpc(name, args) {
          writes.push([name, args]);
          if (waitForWrite) await waitForWrite;
          if (args._expected_user !== owner) return { error: new Error("Wrong owner") };
          stored.set(owner, {
            week_penalties: true,
            payments: true,
            ...stored.get(owner),
            [args._category]: args._enabled,
          });
          return { error: null };
        },
      },
    },
  });
  const loadAccount = () => queryClient.fetchQuery(api.notificationAccountOptions(owner));
  const loadPreferences = () => queryClient.fetchQuery(api.notificationPreferencesOptions(owner));
  const load = () => Promise.all([loadAccount(), loadPreferences()]);
  const open = () =>
    accountUI(
      "src/components/ChallengeNotifications.tsx",
      "ChallengeNotifications",
      {
        "@tanstack/react-query": { useQueryClient: () => queryClient },
        "@/components/ui/switch": { Switch: "Switch" },
        "@/lib/notification-settings": api,
        "@/lib/challenge-push": {
          pushAvailability: () => ({
            kind: "unsupported",
            reason: "This browser does not support push.",
          }),
          ...pushAdapter,
        },
      },
      { userId: owner },
      { Notification: { permission: "default", requestPermission } },
    );
  return {
    open,
    load,
    loadAccount,
    loadPreferences,
    reads,
    writes,
    stored,
    queryClient,
    login: (user) => {
      owner = user;
    },
    pauseWrites: (promise) => {
      waitForWrite = promise;
    },
  };
}
const state = (ui) => ui.find("Switch").map(({ props }) => [props.id, props.checked]);
const click = (ui, id, checked) =>
  ui
    .find("Switch")
    .find(({ props }) => props.id === id)
    .props.onCheckedChange(checked);
const defaults = [
  ["week_penalties", true],
  ["payments", true],
];

test("a category read failure does not hide the account-wide opt-out", async () => {
  const f = fixture({ preferencesError: true, accountEnabled: true });
  await assert.rejects(f.load(), /Preference read failed/);
  const ui = f.open();
  assert.match(ui.text(), /Could not load notification preferences/);
  assert.equal(ui.button("Disable on all devices").props.disabled, false);
  assert.equal(ui.find("Switch").length, 0);
  ui.dispose();
});

test("both supported switches persist one preference each, only after acknowledgement", async () => {
  const f = fixture();
  assert.deepEqual(f.reads, []); // no module-load read
  await f.load();
  const ui = f.open();
  assert.deepEqual(state(ui), defaults);
  const paused = deferred();
  f.pauseWrites(paused.promise);
  click(ui, "week_penalties", false);
  click(ui, "week_penalties", false); // Ref guards a second event before React commits.
  click(ui, "payments", false);
  assert.deepEqual(state(ui), defaults);
  assert.ok(ui.find("Switch").every(({ props }) => props.disabled));
  assert.equal(f.writes.length, 1);
  paused.resolve();
  await ui.flush();
  assert.deepEqual(state(ui), [
    ["week_penalties", false],
    ["payments", true],
  ]);
  click(ui, "payments", false);
  await ui.flush();
  assert.deepEqual(state(ui), [
    ["week_penalties", false],
    ["payments", false],
  ]);
  assert.deepEqual(JSON.parse(JSON.stringify(f.writes)), [
    [
      "set_account_notification_preference",
      { _expected_user: "account-a", _category: "week_penalties", _enabled: false },
    ],
    [
      "set_account_notification_preference",
      { _expected_user: "account-a", _category: "payments", _enabled: false },
    ],
  ]);
  ui.dispose();
});

test("a failed preference write stays local and keeps the confirmed switch value", async () => {
  const f = fixture();
  await f.load();
  const ui = f.open();
  const paused = deferred();
  f.pauseWrites(paused.promise);
  click(ui, "payments", false);
  paused.reject(new Error("Internal database error"));
  await ui.flush();
  assert.deepEqual(state(ui), defaults);
  assert.match(ui.text(), /Could not save this preference/);
  assert.doesNotMatch(ui.text(), /Internal database error/);
  assert.ok(ui.find("Switch").every(({ props }) => !props.disabled));
  ui.dispose();
});

test("sign-out clears the cache, switching isolates writes, and sign-in reloads persisted choices", async () => {
  const f = fixture();
  await f.load();
  const a = f.open();
  click(a, "payments", false);
  await a.flush();
  const pending = deferred();
  f.pauseWrites(pending.promise);
  click(a, "week_penalties", false);
  a.dispose();
  f.queryClient.clear();
  f.login("account-b");
  await f.load();
  const b = f.open();
  pending.resolve();
  await b.flush();
  assert.deepEqual(state(b), defaults);
  assert.equal(f.stored.has("account-b"), false);
  b.dispose();
  f.queryClient.clear();
  f.login("account-a");
  await f.load();
  const returned = f.open();
  assert.deepEqual(state(returned), [
    ["week_penalties", true],
    ["payments", false],
  ]);
  returned.dispose();
});

test("core and fitness use the same settings route with an account-specific key and only supported switches", async () => {
  for (const mode of ["core", "fitness"]) {
    const route = accountUI("src/routes/_authenticated/profile_.notifications.tsx", "Route", {
      "@/lib/auth": { useAuth: () => ({ user: { id: mode } }) },
      "@/components/ChallengeNotifications": { ChallengeNotifications: "ChallengeNotifications" },
    });
    assert.equal(route.find("ChallengeNotifications")[0].key, mode);
    const f = fixture();
    f.login(mode);
    await f.load();
    const ui = f.open();
    assert.deepEqual(state(ui), defaults);
    assert.doesNotMatch(
      ui.text(),
      /Behind on Saturday|Friend activity|Week results|Morning check-in|fitness setup/,
    );
    assert.ok(ui.find("label").every(({ props }) => props.className.includes("min-h-11")));
    assert.ok(
      ui.find("span").some(({ props }) => props.className?.includes("overflow-wrap:anywhere")),
    );
    ui.dispose();
  }
});

const readyDevice = {
  sdk: { User: { PushSubscription: { addEventListener() {}, removeEventListener() {} } } },
  enabled: false,
};
const supportedDevice = {
  pushAvailability: () => ({ kind: "supported", reason: null }),
  pushDeviceIsRegistered: async () => false,
};

for (const fail of [false, true]) {
  test(`device setup resolves during a ${fail ? "failed" : "successful"} preference save`, async () => {
    const f = fixture({
      pushAdapter: { ...supportedDevice, reconcileChallengePush: async () => readyDevice },
      requestPermission: () => assert.fail("A category cannot request permission"),
    });
    await f.loadPreferences();
    const ui = f.open();
    const write = deferred();
    f.pauseWrites(write.promise);
    click(ui, "week_penalties", false);
    await f.loadAccount();
    await ui.flush();
    assert.equal(ui.button("Allow on this device").props.disabled, false);
    assert.ok(ui.find("Switch").every(({ props }) => props.disabled));
    assert.deepEqual(state(ui), defaults);
    if (fail) write.reject(new Error("write failed"));
    else write.resolve();
    await ui.flush();
    assert.deepEqual(state(ui), [
      ["week_penalties", fail],
      ["payments", true],
    ]);
    assert.equal(ui.button("Allow on this device").props.disabled, false);
    assert.equal(ui.text().includes("Could not save this preference"), fail);
    ui.dispose();
  });
}

test("a pending or failed device check cannot block category writes; retry can still recover", async () => {
  const check = deferred();
  let reconciliations = 0;
  const f = fixture({
    pushAdapter: {
      ...supportedDevice,
      reconcileChallengePush: () =>
        ++reconciliations === 1 ? check.promise : Promise.resolve(readyDevice),
    },
    requestPermission: () => assert.fail("A category cannot request permission"),
  });
  await f.load();
  const ui = f.open();
  assert.match(ui.text(), /This deviceChecking…/);
  click(ui, "payments", false);
  await ui.flush();
  assert.deepEqual(state(ui), [
    ["week_penalties", true],
    ["payments", false],
  ]);
  check.reject(new Error("SDK init failed"));
  await ui.flush();
  assert.match(ui.text(), /Temporarily unavailable/);
  click(ui, "week_penalties", false);
  await ui.flush();
  assert.deepEqual(state(ui), [
    ["week_penalties", false],
    ["payments", false],
  ]);
  ui.button("Retry notifications").props.onClick();
  await ui.flush();
  assert.equal(ui.button("Allow on this device").props.disabled, false);
  assert.equal(reconciliations, 2);
  ui.dispose();
});
