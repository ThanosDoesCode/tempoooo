import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";
import ts from "typescript";

// Execute the actual browser adapter with deterministic browser/provider/auth
// boundaries. Vite's import.meta.env is replaced only inside this test sandbox.
const source = await readFile(new URL("../src/lib/challenge-push.ts", import.meta.url), "utf8");
const notificationComponent = await readFile(
  new URL("../src/components/ChallengeNotifications.tsx", import.meta.url),
  "utf8",
);
const compiled = ts.transpileModule(source.replaceAll("import.meta.env", "__testEnv"), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
function browserFixture({
  permission = "granted",
  saved = null,
  scriptFailures = 0,
  initFailures = 0,
  initFailureMessage = "temporary init failure",
  accountEnabled: initialAccountEnabled = false,
  optedIn = false,
  optInFailures: initialOptInFailures = 0,
  registerFailures: initialRegisterFailures = 0,
} = {}) {
  const calls = [];
  const diagnostics = [];
  const storage = new Map(saved ? [["challenge-push-device", JSON.stringify(saved)]] : []);
  let authListener;
  let failure = false;
  let accountEnabled = initialAccountEnabled;
  let deviceActive = initialAccountEnabled && optedIn;
  let registerFailures = initialRegisterFailures;
  let optInFailures = initialOptInFailures;
  let uid = "user-a";
  const listeners = new Set();
  const sdk = {
    async init(options) {
      calls.push(["init", options]);
      if (initFailures > 0) {
        initFailures -= 1;
        throw new Error(initFailureMessage);
      }
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
        optedIn,
        async optIn() {
          calls.push(["optIn"]);
          if (optInFailures > 0) {
            optInFailures -= 1;
            throw new Error("temporary opt-in failure");
          }
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
        return { data: { session: uid ? { user: { id: uid } } : null } };
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
          return { data: { external_id: `private-capability-${uid}`, enabled: accountEnabled } };
        if (body.action === "register") {
          if (registerFailures > 0) {
            registerFailures -= 1;
            return { error: new Error("provider synchronization pending") };
          }
          if (body.activate) accountEnabled = true;
          deviceActive = accountEnabled;
          return { data: { enabled: accountEnabled && deviceActive } };
        }
        if (body.action === "status") return { data: { enabled: accountEnabled && deviceActive } };
        if (body.action === "detach") deviceActive = false;
        return { data: { enabled: accountEnabled && deviceActive } };
      },
    },
    async rpc() {
      calls.push(["disable"]);
      if (failure) return { error: new Error("failure") };
      accountEnabled = false;
      deviceActive = false;
      return { error: null };
    },
  };
  const context = {
    exports: {},
    require: () => ({ supabase }),
    __testEnv: { VITE_ONESIGNAL_APP_ID: "app-id", DEV: true },
    console: {
      ...console,
      error(message) {
        diagnostics.push(message);
      },
      info(message) {
        diagnostics.push(message);
      },
    },
    setTimeout: (callback, delay) => setTimeout(callback, Math.min(delay ?? 0, 2)),
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
      setTimeout: (callback, delay) => setTimeout(callback, Math.min(delay ?? 0, 2)),
      clearTimeout,
      matchMedia: () => ({ matches: false }),
    },
    document: {
      createElement: () => ({ dataset: {}, remove() {} }),
      head: {
        appendChild(script) {
          calls.push(["script"]);
          queueMicrotask(() => {
            if (scriptFailures > 0) {
              scriptFailures -= 1;
              script.onerror?.();
              return;
            }
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
    diagnostics,
    sdk,
    context,
    storage,
    fail: () => {
      failure = true;
    },
    recoverSdkScript: () => {
      scriptFailures = 0;
    },
    switchUser: (id) => {
      uid = id;
      authListener?.("SIGNED_IN", { user: { id } });
    },
    emitAuth: (event, id) => {
      uid = id;
      authListener?.(event, id ? { user: { id } } : null);
    },
    accountEnabled: () => accountEnabled,
    deviceActive: () => deviceActive,
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
test("a transient SDK script failure retries without reloading the PWA", async () => {
  const f = browserFixture({ scriptFailures: 1 });
  await f.api.prepareChallengePush("user-a");
  assert.equal(f.calls.filter(([name]) => name === "script").length, 2);
  assert.equal(f.calls.filter(([name]) => name === "init").length, 1);
});
test("a transient SDK init failure reuses the loaded SDK and recovers", async () => {
  const f = browserFixture({ initFailures: 1 });
  await f.api.prepareChallengePush("user-a");
  assert.equal(f.calls.filter(([name]) => name === "script").length, 1);
  assert.equal(f.calls.filter(([name]) => name === "init").length, 2);
  assert.deepEqual(JSON.parse(f.diagnostics[0]), {
    phase: "onesignal_init",
    error_name: "Error",
    error_message: "temporary init failure",
  });
});
test("init diagnostics redact identifiers and credential-like values", async () => {
  const f = browserFixture({
    initFailures: 1,
    initFailureMessage:
      "init rejected token=private-token user_id=11111111-1111-4111-8111-111111111111",
  });
  await f.api.prepareChallengePush("user-a");
  const diagnostic = JSON.parse(f.diagnostics[0]);
  assert.equal(diagnostic.phase, "onesignal_init");
  assert.equal(diagnostic.error_message, "init rejected token=[redacted] user_id=[redacted]");
  assert.doesNotMatch(f.diagnostics[0], /private-token|11111111-1111-4111-8111-111111111111/);
});
test("manual notification retry can recover after the bounded SDK attempts are exhausted", async () => {
  const f = browserFixture({ scriptFailures: 3 });
  await assert.rejects(f.api.prepareChallengePush("user-a"), /temporarily unavailable/);
  f.recoverSdkScript();
  await f.api.prepareChallengePush("user-a");
  assert.equal(f.calls.filter(([name]) => name === "script").length, 4);
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
  assert.equal(body.activate, true);
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
test("logout detaches ownership without revoking browser permission or subscription", async () => {
  const f = browserFixture({
    accountEnabled: true,
    optedIn: true,
    saved: { userId: "user-a", id: "11111111-1111-4111-8111-111111111111" },
  });
  await f.api.detachChallengePush();
  assert.equal(
    f.calls.some(([name]) => name === "permission" || name === "optOut"),
    false,
  );
  assert.equal(f.sdk.User.PushSubscription.optedIn, true);
  assert.equal(f.storage.has("challenge-push-device"), false);
  assert.deepEqual(
    f.calls
      .filter(([name]) => name === "endpoint" || name === "logout")
      .map(([name, body]) => [name, body?.action]),
    [
      ["endpoint", "detach"],
      ["logout", undefined],
    ],
  );
  assert.equal(
    f.calls.some(([name, body]) => name === "endpoint" && body?.activate === true),
    false,
  );
});
test("same-user login restores a detached, already-authorized device", async () => {
  const f = browserFixture({
    accountEnabled: true,
    optedIn: false,
    saved: { userId: "user-a", id: "11111111-1111-4111-8111-111111111111" },
  });
  await f.api.detachChallengePush();
  f.calls.length = 0;
  const result = await f.api.reconcileChallengePush("user-a", { force: true });
  assert.equal(result.enabled, true);
  assert.equal(f.deviceActive(), true);
  assert.ok(f.calls.some(([name]) => name === "optIn"));
  assert.ok(f.storage.has("challenge-push-device"));
  const registration = f.calls.find(
    ([name, body]) => name === "endpoint" && body.action === "register",
  );
  assert.equal(registration[1].activate, false);
  assert.equal(
    f.calls.some(([name]) => name === "permission" || name === "optOut"),
    false,
  );
  const phases = f.diagnostics.map((entry) => JSON.parse(entry).phase);
  assert.ok(phases.includes("subscription_recovery_needed"));
  assert.ok(phases.includes("subscription_optin_start"));
  assert.ok(phases.includes("subscription_optin_complete"));
  assert.equal(phases.includes("subscription_optin_failed"), false);
});
test("account switching repairs a historical opt-out only after changing identity", async () => {
  const f = browserFixture({
    accountEnabled: true,
    optedIn: false,
    saved: { userId: "user-a", id: "11111111-1111-4111-8111-111111111111" },
  });
  f.emitAuth("SIGNED_IN", "user-b");
  const result = await f.api.reconcileChallengePush("user-b", { force: true });
  assert.equal(result.enabled, true);
  assert.equal(
    f.calls.some(([name]) => name === "optOut"),
    false,
  );
  assert.ok(f.calls.some(([name]) => name === "logout"));
  assert.ok(
    f.calls.some(([name, value]) => name === "login" && value === "private-capability-user-b"),
  );
  assert.ok(
    f.calls
      .filter(([name, body]) => name === "endpoint" && body.action === "register")
      .every(([, body]) => body.activate === false),
  );
  const loginIndex = f.calls.findIndex(([name]) => name === "login");
  const optInIndex = f.calls.findIndex(([name]) => name === "optIn");
  const registerIndex = f.calls.findIndex(
    ([name, body]) => name === "endpoint" && body.action === "register",
  );
  assert.ok(loginIndex >= 0 && loginIndex < optInIndex && optInIndex < registerIndex);
});
test("INITIAL_SESSION on PWA reopen reconciles once and later same-user auth events do not duplicate it", async () => {
  const f = browserFixture({ accountEnabled: true, optedIn: true });
  f.api.watchChallengePushSession();
  f.emitAuth("INITIAL_SESSION", "user-a");
  await new Promise((resolve) => setTimeout(resolve, 20));
  const registrations = () =>
    f.calls.filter(([name, body]) => name === "endpoint" && body.action === "register").length;
  const initialRegistrations = registrations();
  assert.equal(initialRegistrations, 1);
  f.emitAuth("TOKEN_REFRESHED", "user-a");
  f.emitAuth("USER_UPDATED", "user-a");
  f.emitAuth("SIGNED_IN", "user-a");
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.equal(registrations(), initialRegistrations);
  assert.ok(
    f.calls
      .filter(([name, body]) => name === "endpoint" && body.action === "register")
      .every(([, body]) => body.activate === false),
  );
});
test("explicit Off remains authoritative during automatic reconciliation", async () => {
  const f = browserFixture({ accountEnabled: false, optedIn: false });
  const result = await f.api.reconcileChallengePush("user-a", { force: true });
  assert.equal(result.enabled, false);
  assert.equal(
    f.calls.some(([name, body]) => name === "endpoint" && body.action === "register"),
    false,
  );
  assert.equal(
    f.calls.some(([name]) => name === "optIn"),
    false,
  );
});
test("manual Retry reruns identity, repairs opt-in, and completes background registration", async () => {
  const f = browserFixture({ accountEnabled: true, optedIn: false, optInFailures: 1 });
  await assert.rejects(
    f.api.reconcileChallengePush("user-a", { force: true }),
    /temporarily unavailable/,
  );
  assert.ok(f.diagnostics.some((entry) => JSON.parse(entry).phase === "subscription_optin_failed"));
  f.calls.length = 0;
  const result = await f.api.reconcileChallengePush("user-a", { force: true });
  assert.equal(result.enabled, true);
  assert.ok(f.calls.some(([name, body]) => name === "endpoint" && body.action === "identity"));
  assert.ok(f.calls.some(([name]) => name === "optIn"));
  assert.ok(
    f.calls.some(
      ([name, body]) =>
        name === "endpoint" && body.action === "register" && body.activate === false,
    ),
  );
  assert.match(notificationComponent, /force: retryKey > 0/);
});
test("explicit Disable remains authoritative across logout and reopen", async () => {
  const f = browserFixture();
  const sdk = await f.api.prepareChallengePush("user-a");
  await f.api.enableChallengePush(sdk, "user-a");
  await f.api.disableChallengePush(sdk);
  await f.api.detachChallengePush();
  f.calls.length = 0;
  const result = await f.api.reconcileChallengePush("user-a", { force: true });
  assert.equal(result.enabled, false);
  assert.equal(f.accountEnabled(), false);
  assert.equal(
    f.calls.some(([name]) => name === "optIn"),
    false,
  );
  assert.equal(
    f.calls.some(([name, body]) => name === "endpoint" && body.action === "register"),
    false,
  );
});
test("default and denied permissions remain distinct and never auto-register", async () => {
  for (const permission of ["default", "denied"]) {
    const f = browserFixture({ permission, accountEnabled: true, optedIn: true });
    const result = await f.api.reconcileChallengePush("user-a", { force: true });
    assert.equal(result.enabled, false);
    assert.equal(
      f.calls.some(([name, body]) => name === "endpoint" && body.action === "register"),
      false,
    );
  }
});
test("background synchronization keeps the existing bounded retry and can recover", async () => {
  const f = browserFixture({ accountEnabled: true, optedIn: true, registerFailures: 8 });
  await assert.rejects(
    f.api.reconcileChallengePush("user-a", { force: true }),
    /Could not update notifications\. Please retry in a moment\./,
  );
  assert.equal(
    f.calls.filter(([name, body]) => name === "endpoint" && body.action === "register").length,
    8,
  );
  const result = await f.api.reconcileChallengePush("user-a", { force: true });
  assert.equal(result.enabled, true);
});
test("push diagnostics contain state only and never user or subscription identifiers", async () => {
  const f = browserFixture({ accountEnabled: true, optedIn: true });
  await f.api.reconcileChallengePush("user-a", { force: true });
  const diagnosticText = f.diagnostics.join("\n");
  assert.match(diagnosticText, /identity_sync|backend_sync|permission/);
  assert.doesNotMatch(
    diagnosticText,
    /user-a|private-capability|11111111-1111-4111-8111-111111111111/,
  );
});
test("iPhone outside Home Screen receives installation guidance", () => {
  const f = browserFixture();
  f.context.navigator.userAgent = "iPhone";
  assert.match(f.api.pushUnavailableReason(), /Add to Home Screen/);
});
test("unsupported browsers stay distinct from permission denial", () => {
  const unsupported = browserFixture({ permission: "denied" });
  unsupported.context.window.isSecureContext = false;
  assert.match(unsupported.api.pushUnavailableReason(), /not supported/);

  const denied = browserFixture({ permission: "denied" });
  assert.equal(denied.api.pushUnavailableReason(), null);
  assert.equal(denied.context.Notification.permission, "denied");
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
