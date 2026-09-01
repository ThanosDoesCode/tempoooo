import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";
import ts from "typescript";

// Execute the actual browser adapter with deterministic browser/provider/auth
// boundaries. Vite's import.meta.env is replaced only inside this test sandbox.
const source = await readFile(new URL("../src/lib/challenge-push.ts", import.meta.url), "utf8");
const compiled = ts.transpileModule(source.replaceAll("import.meta.env", "__testEnv"), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
function browserFixture({ permission = "granted", saved = null } = {}) {
  const calls = [];
  const storage = new Map(saved ? [["challenge-push-device", JSON.stringify(saved)]] : []);
  let authListener;
  let failure = false;
  let enabled = false;
  let uid = "user-a";
  const listeners = new Set();
  const sdk = {
    async init(options) {
      calls.push(["init", options]);
    },
    async login(id) {
      calls.push(["login", id]);
    },
    async logout() {
      calls.push(["logout"]);
    },
    User: {
      PushSubscription: {
        id: "11111111-1111-4111-8111-111111111111",
        optedIn: false,
        async optIn() {
          calls.push(["optIn"]);
          this.optedIn = true;
        },
        async optOut() {
          calls.push(["optOut"]);
          this.optedIn = false;
        },
        addEventListener(_event, listener) {
          listeners.add(listener);
        },
        removeEventListener(_event, listener) {
          listeners.delete(listener);
        },
      },
    },
  };
  const supabase = {
    auth: {
      async getSession() {
        calls.push(["session"]);
        return { data: { session: { user: { id: uid } } } };
      },
      onAuthStateChange(listener) {
        authListener = listener;
        return { data: { subscription: { unsubscribe() {} } } };
      },
    },
    functions: {
      async invoke(_name, { body }) {
        calls.push(["endpoint", body]);
        if (failure) return { error: new Error("secret internal failure") };
        if (body.action === "identity")
          return { data: { external_id: "private-capability", enabled } };
        if (body.action === "register") enabled = body.activate || enabled;
        return { data: { enabled } };
      },
    },
    async rpc() {
      calls.push(["disable"]);
      if (failure) return { error: new Error("failure") };
      enabled = false;
      return { error: null };
    },
  };
  const context = {
    exports: {},
    require: () => ({ supabase }),
    __testEnv: { VITE_ONESIGNAL_APP_ID: "app-id", DEV: true },
    console,
    setTimeout,
    clearTimeout,
    localStorage: {
      getItem: (key) => storage.get(key) ?? null,
      setItem: (key, value) => storage.set(key, value),
      removeItem: (key) => storage.delete(key),
    },
    navigator: { userAgent: "desktop", platform: "test", maxTouchPoints: 0, serviceWorker: {} },
    Notification: {
      permission,
      async requestPermission() {
        calls.push(["permission"]);
        return permission;
      },
    },
    window: {
      isSecureContext: true,
      Notification: {},
      PushManager: {},
      setTimeout,
      clearTimeout,
      matchMedia: () => ({ matches: false }),
    },
    document: {
      createElement: () => ({}),
      head: {
        appendChild() {
          queueMicrotask(() => {
            for (const callback of context.window.OneSignalDeferred) void callback(sdk);
          });
        },
      },
    },
  };
  vm.runInNewContext(compiled, context);
  return {
    api: context.exports,
    calls,
    sdk,
    context,
    storage,
    fail: () => {
      failure = true;
    },
    switchUser: (id) => {
      uid = id;
      authListener?.("SIGNED_IN", { user: { id } });
    },
  };
}
test("opening Challenge initializes without permission prompts or opt-in", async () => {
  const f = browserFixture();
  await f.api.prepareChallengePush("user-a");
  assert.equal(
    f.calls.some(([name]) => name === "permission" || name === "optIn"),
    false,
  );
  assert.equal(
    f.calls.find(([name]) => name === "init")[1].promptOptions.slidedown.prompts[0].autoPrompt,
    false,
  );
  assert.equal(await f.api.pushIsEnabled(f.sdk), false);
});
test("enable requests permission before any network work and registers only its device", async () => {
  const f = browserFixture();
  await f.api.prepareChallengePush("user-a");
  f.calls.length = 0;
  const enabling = f.api.enableChallengePush(f.sdk, "user-a");
  assert.equal(f.calls[0][0], "permission");
  await enabling;
  const body = f.calls.find(([name, data]) => name === "endpoint" && data.action === "register")[1];
  assert.equal(body.subscription_id, f.sdk.User.PushSubscription.id);
  assert.equal(body.user_id, undefined);
  assert.equal(body.recipient_id, undefined);
  assert.equal(await f.api.pushIsEnabled(f.sdk), true);
});
test("permission denial never enables or registers a subscription", async () => {
  const f = browserFixture({ permission: "denied" });
  await f.api.prepareChallengePush("user-a");
  f.calls.length = 0;
  await assert.rejects(f.api.enableChallengePush(f.sdk, "user-a"), /Notifications are off/);
  assert.deepEqual(
    f.calls.map(([name]) => name),
    ["permission"],
  );
});
test("registration failure never reports success, and retains a marker for safe sign-out", async () => {
  const f = browserFixture();
  await f.api.prepareChallengePush("user-a");
  f.fail();
  await assert.rejects(f.api.enableChallengePush(f.sdk, "user-a"), /Could not update/);
  assert.ok(f.storage.has("challenge-push-device"));
  await assert.rejects(f.api.detachChallengePush(), /Could not update/);
  assert.ok(f.storage.has("challenge-push-device"));
});
test("account opt-out writes to the database before opting out the browser", async () => {
  const f = browserFixture();
  await f.api.prepareChallengePush("user-a");
  await f.api.enableChallengePush(f.sdk, "user-a");
  f.calls.length = 0;
  await f.api.disableChallengePush(f.sdk);
  assert.deepEqual(
    f.calls.map(([name]) => name),
    ["disable", "optOut"],
  );
  assert.equal(await f.api.pushIsEnabled(f.sdk), false);
});
test("iPhone outside Home Screen receives installation guidance", () => {
  const f = browserFixture();
  f.context.navigator.userAgent = "iPhone";
  assert.match(f.api.pushUnavailableReason(), /Add to Home Screen/);
});
test("switching accounts while enabling rejects the previous user's registration", async () => {
  const f = browserFixture();
  await f.api.prepareChallengePush("user-a");
  f.switchUser("user-b");
  await assert.rejects(f.api.enableChallengePush(f.sdk, "user-a"), /account changed/);
  assert.equal(
    f.calls.some(([name, body]) => name === "endpoint" && body.action === "register"),
    false,
  );
});
