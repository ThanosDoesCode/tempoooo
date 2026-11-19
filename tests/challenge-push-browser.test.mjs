import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";
import ts from "typescript";
import { renderToStaticMarkup } from "react-dom/server";
import * as jsxRuntime from "react/jsx-runtime";

// Execute the actual browser adapter with deterministic browser/provider/auth
// boundaries. Vite's import.meta.env is replaced only inside this test sandbox.
const source = await readFile(new URL("../src/lib/challenge-push.ts", import.meta.url), "utf8");
const notificationComponent = await readFile(
  new URL("../src/components/ChallengeNotifications.tsx", import.meta.url),
  "utf8",
);
const privilegedFunctions = await readFile(
  new URL("../src/lib/privileged-rpcs.functions.ts", import.meta.url),
  "utf8",
);
const privilegedServer = await readFile(
  new URL("../src/lib/privileged-rpcs.server.ts", import.meta.url),
  "utf8",
);
const compiled = ts.transpileModule(source.replaceAll("import.meta.env", "__testEnv"), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
function browserFixture({
  permission = "granted",
  appId = "app-id",
  requestedPermission = permission,
  registerPendingResponses = 0,
  saved = null,
  scriptFailures = 0,
  initFailures = 0,
  initFailureMessage = "temporary init failure",
  accountEnabled: initialAccountEnabled = false,
  optedIn = false,
  optInDelay = false,
  optInFailures: initialOptInFailures = 0,
  registerFailures: initialRegisterFailures = 0,
  beforeRegistration,
  registrationResponse,
} = {}) {
  const calls = [];
  const diagnostics = [];
  const storage = new Map(saved ? [["challenge-push-device", JSON.stringify(saved)]] : []);
  let authListener;
  let failure = false;
  let accountEnabled = initialAccountEnabled;
  let deviceActive = initialAccountEnabled && optedIn;
  let generation = 0;
  let registerFailures = initialRegisterFailures;
  let optInFailures = initialOptInFailures;
  let uid = "user-a";
  const listeners = new Set();
  const focusListeners = new Set();
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
          const complete = () => {
            this.optedIn = true;
            for (const listener of listeners) listener();
          };
          if (optInDelay) setTimeout(complete, 1);
          else complete();
        },
        async optOut() {
          calls.push(["optOut"]);
          this.optedIn = false;
          for (const listener of listeners) listener();
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
          return {
            data: {
              external_id: `private-capability-${uid}`,
              enabled: accountEnabled,
              registration_generation: String(generation),
            },
          };
        if (body.action === "register" || body.action === "register_device") {
          if (registrationResponse) return { data: registrationResponse };
          if (body.action === "register_device" && body.expected_user !== uid)
            return { error: new Error("account changed") };
          const captured = generation;
          if (
            body.expected_generation !== undefined &&
            body.expected_generation !== String(captured)
          )
            return { data: { stale: true } };
          await beforeRegistration?.(body);
          if (registerPendingResponses > 0) {
            registerPendingResponses -= 1;
            return { data: { enabled: false } };
          }
          if (registerFailures > 0) {
            registerFailures -= 1;
            return { error: new Error("provider synchronization pending") };
          }
          if (captured !== generation) return { data: { stale: true } };
          if (body.action === "register" && body.activate) accountEnabled = true;
          deviceActive = body.action === "register_device" || accountEnabled;
          return { data: { enabled: accountEnabled && deviceActive, registered: deviceActive } };
        }
        if (body.action === "status")
          return { data: { enabled: accountEnabled && deviceActive, registered: deviceActive } };
        if (body.action === "detach") {
          generation++;
          deviceActive = false;
        }
        return { data: { enabled: accountEnabled && deviceActive } };
      },
    },
    async rpc(name, args) {
      if (name === "set_challenge_push_account_enabled") {
        calls.push(["account-write", args]);
        if (args._expected_user !== uid) return { error: new Error("account changed") };
        if (args._enabled && args._expected_generation !== String(generation))
          return { error: new Error("activation cancelled") };
        accountEnabled = args._enabled;
        if (!accountEnabled) {
          generation++;
          deviceActive = false;
        }
        return { error: null };
      }
      calls.push(["direct-rpc"]);
      throw new Error("privileged RPC must not be called by the browser");
    },
  };
  const disableChallengePushAccount = async () => {
    calls.push(["server-disable"]);
    if (failure) throw new Error("failure");
    accountEnabled = false;
    deviceActive = false;
    generation++;
    return { ok: true };
  };
  const context = {
    exports: {},
    require: (specifier) =>
      specifier.includes("privileged-rpcs.functions")
        ? { disableChallengePushAccount }
        : { supabase },
    __testEnv: { VITE_ONESIGNAL_APP_ID: appId, DEV: true },
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
        context.Notification.permission = requestedPermission;
        return requestedPermission;
      },
    },
    window: {
      addEventListener(event, listener) {
        if (event === "focus") focusListeners.add(listener);
      },
      removeEventListener(event, listener) {
        if (event === "focus") focusListeners.delete(listener);
      },
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
    failRegistration: () => {
      registerFailures = 99;
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
    focus: () => focusListeners.forEach((listener) => listener()),
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
  const f = browserFixture({ permission: "default", requestedPermission: "granted" });
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
  const f = browserFixture({ registerFailures: 8 });
  await f.api.prepareChallengePush("user-a");
  await assert.rejects(f.api.enableChallengePush(f.sdk, "user-a"), /Could not update/);
  assert.ok(f.storage.has("challenge-push-device"));
  f.fail();
  await assert.rejects(f.api.detachChallengePush(), /Could not update/);
  assert.ok(f.storage.has("challenge-push-device"));
});
test("account opt-out writes to the database before opting out the browser", async () => {
  const handler = privilegedFunctions.match(
    /export const disableChallengePushAccount =[\s\S]*?return \{ ok: true \};\n  \}\);/,
  )?.[0];
  assert.ok(handler);
  assert.match(handler, /middleware\(\[requireSupabaseAuth\]\)/);
  assert.match(handler, /disableChallengePushFor\(context\.userId\)/);
  assert.doesNotMatch(handler, /data\.(?:caller|userId|owner)/);
  assert.match(privilegedServer, /disable_challenge_push", \{ _caller: caller \}/);
  const f = browserFixture();
  await f.api.prepareChallengePush("user-a");
  await f.api.enableChallengePush(f.sdk, "user-a");
  f.calls.length = 0;
  await f.api.disableChallengePush(f.sdk);
  assert.deepEqual(
    f.calls.map(([name]) => name),
    ["server-disable", "optOut"],
  );
  assert.equal(
    f.calls.some(([name]) => name === "direct-rpc"),
    false,
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
  assert.match(notificationComponent, /refresh\(retryKey > 0\)/);
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

// Render the actual card with deterministic hook/effect scheduling, using the
// real browser adapter above. This checks the header, explanatory copy and CTA together.
const compiledCard = ts.transpileModule(notificationComponent, {
  compilerOptions: {
    module: ts.ModuleKind.CommonJS,
    target: ts.ScriptTarget.ES2022,
    jsx: ts.JsxEmit.ReactJSX,
  },
}).outputText;
async function notificationCard(fixture, interactive = false) {
  const states = [];
  let hookIndex = 0;
  let effect;
  let settings = {
    accountEnabled: fixture.accountEnabled(),
    hasChallenge: true,
    week_penalties: true,
    payments: true,
  };
  const context = {
    exports: {},
    Notification: fixture.context.Notification,
    window: fixture.context.window,
    require(name) {
      if (name === "react")
        return {
          useRef(initial) {
            const index = hookIndex++;
            if (!(index in states)) states[index] = { current: initial };
            return states[index];
          },
          useState(initial) {
            const index = hookIndex++;
            if (!(index in states)) states[index] = initial;
            return [
              states[index],
              (value) => {
                states[index] = typeof value === "function" ? value(states[index]) : value;
              },
            ];
          },
          useEffect(callback) {
            effect ??= callback;
          },
        };
      if (name === "react/jsx-runtime") return jsxRuntime;
      if (name === "@/lib/challenge-push") return fixture.api;
      if (name === "@tanstack/react-query")
        return {
          useQueryClient: () => ({
            async cancelQueries() {},
            setQueryData(_key, update) {
              settings = update(settings);
            },
          }),
        };
      if (name === "@/lib/notification-settings")
        return {
          useNotificationSettings: () => ({
            account: { data: settings },
            preferences: { data: settings },
          }),
          notificationAccountKey: (userId) => ["notification-settings", userId, "account"],
          notificationPreferencesKey: (userId) => ["notification-settings", userId, "categories"],
          async saveNotificationPreference(userId, category, enabled) {
            fixture.calls.push(["category-write", { userId, category, enabled }]);
          },
        };
      if (name === "@/components/ui/switch") return { Switch: () => null };
      if (name === "@/components/ui-kit")
        return { PendingLabel: ({ children }) => jsxRuntime.jsx("span", { children }) };
      return { Bell: () => null, ChevronDown: () => null, TriangleAlert: () => null };
    },
  };
  vm.runInNewContext(compiledCard, context);
  function render() {
    hookIndex = 0;
    const tree = context.exports.ChallengeNotifications({ userId: "user-a" });
    return interactive ? tree : renderToStaticMarkup(tree);
  }
  render();
  const cleanup = effect();
  // Wait for the actual card state instead of assuming loaded CI timers finish in 30ms.
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const tree = render();
    const html = interactive ? renderToStaticMarkup(tree) : tree;
    if (!html.includes("Checking…")) break;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  if (interactive) return { render, cleanup };
  const html = render();
  cleanup();
  return html;
}

test("iPhone Home Screen default permission is ready/off, with Enable and no automatic permission request", async () => {
  for (const standaloneMethod of ["media", "navigator"]) {
    const f = browserFixture({ permission: "default" });
    f.context.navigator.userAgent = "iPhone";
    if (standaloneMethod === "media") f.context.window.matchMedia = () => ({ matches: true });
    else f.context.navigator.standalone = true;
    assert.equal(f.api.pushAvailability().kind, "supported");
    const html = await notificationCard(f);
    assert.match(html, />Not requested</);
    assert.match(html, /Allow on this device/);
    assert.doesNotMatch(html, /Unsupported|Not configured|Temporarily unavailable/);
    assert.equal(
      f.calls.some(([action]) => action === "permission"),
      false,
    );
    assert.ok(f.calls.some(([action]) => action === "init"));
  }
});

test("configuration, install guidance, genuine unsupported and permission denied have consistent card states", async () => {
  const unconfigured = browserFixture({ appId: "", permission: "default" });
  assert.equal(unconfigured.api.pushAvailability().kind, "configuration-unavailable");
  const missingHtml = await notificationCard(unconfigured);
  assert.match(missingHtml, />Not configured</);
  assert.doesNotMatch(missingHtml, /Unsupported|Allow on this device|Connect this device/);
  assert.equal(unconfigured.calls.length, 0);

  const safari = browserFixture({ permission: "default" });
  safari.context.navigator.userAgent = "iPhone";
  const installHtml = await notificationCard(safari);
  assert.match(installHtml, />Open from Home Screen</);
  assert.match(installHtml, /Add to Home Screen/);
  assert.doesNotMatch(installHtml, /Unsupported|Allow on this device|Connect this device/);

  const unsupported = browserFixture({ permission: "default" });
  delete unsupported.context.window.PushManager;
  const unsupportedHtml = await notificationCard(unsupported);
  assert.match(unsupportedHtml, />Unsupported</);
  assert.doesNotMatch(unsupportedHtml, /Allow on this device|Connect this device/);

  const denied = browserFixture({ permission: "denied" });
  const deniedHtml = await notificationCard(denied);
  assert.match(deniedHtml, />Permission denied</);
  assert.doesNotMatch(deniedHtml, /Unsupported/);
  assert.doesNotMatch(deniedHtml, /Allow on this device|Connect this device/);
  assert.equal(
    denied.calls.some(([action]) => action === "permission"),
    false,
  );
});

test("standard registration Push API works without a global constructor, but secure/worker/notification requirements remain", () => {
  const f = browserFixture({ permission: "default" });
  f.context.navigator.userAgent = "iPhone";
  f.context.navigator.standalone = true;
  delete f.context.window.PushManager;
  f.context.window.ServiceWorkerRegistration = function () {};
  Object.defineProperty(f.context.window.ServiceWorkerRegistration.prototype, "pushManager", {
    get() {
      throw new Error("Do not invoke the getter on the prototype");
    },
  });
  assert.equal(f.api.pushAvailability().kind, "supported");
  f.context.window.isSecureContext = false;
  assert.equal(f.api.pushAvailability().kind, "unsupported");
  f.context.window.isSecureContext = true;
  delete f.context.navigator.serviceWorker;
  assert.equal(f.api.pushAvailability().kind, "unsupported");
  f.context.navigator.serviceWorker = {};
  delete f.context.window.Notification;
  assert.equal(f.api.pushAvailability().kind, "unsupported");
});

test("temporary SDK failure offers initialization Retry rather than Unsupported or permission guidance", async () => {
  const f = browserFixture({ permission: "default", initFailures: 99 });
  const html = await notificationCard(f);
  assert.match(html, />Temporarily unavailable</);
  assert.match(html, /Retry notifications/);
  assert.doesNotMatch(html, /Unsupported|permission has not been granted/);
  assert.equal(f.calls.filter(([action]) => action === "init").length, 3);
});

test("OneSignal app ID uses an explicit Vite build-time read for capability detection and init", async () => {
  assert.match(source, /const oneSignalAppId = import.meta.env.VITE_ONESIGNAL_APP_ID;/);
  assert.doesNotMatch(source, /import.meta.env\["VITE_ONESIGNAL_APP_ID"\]/);
  const f = browserFixture({ appId: "public-test-app-id" });
  await f.api.prepareChallengePush("user-a");
  assert.equal(f.calls.find(([action]) => action === "init")[1].appId, "public-test-app-id");
});

test("On -> account-wide Disable -> Enable once retries propagation internally and preserves the session", async () => {
  const f = browserFixture({ accountEnabled: true, optedIn: true, registerPendingResponses: 2 });
  await f.api.prepareChallengePush("user-a");
  assert.equal(await f.api.pushIsEnabled(f.sdk), true);
  await f.api.disableChallengePush(f.sdk);
  assert.equal(f.accountEnabled(), false);
  assert.equal(f.sdk.User.PushSubscription.optedIn, false);
  await f.api.enableChallengePush(f.sdk, "user-a");
  assert.equal(f.accountEnabled(), true);
  assert.equal(await f.api.pushIsEnabled(f.sdk), true);
  assert.equal(
    f.calls.filter(([action, body]) => action === "endpoint" && body.action === "register").length,
    3,
  );
  assert.equal(
    f.calls.some(([action]) => action === "permission" || action === "logout"),
    false,
  );
  assert.doesNotMatch(
    source,
    /router\.invalidate|resetUserScopedQueries|auth\.signOut|auth\.getUser/,
  );
});

test("unsuccessful explicit activation is bounded, remains Off and returns a notification-only error", async () => {
  const f = browserFixture({ registerPendingResponses: 99 });
  await f.api.prepareChallengePush("user-a");
  await assert.rejects(
    f.api.enableChallengePush(f.sdk, "user-a"),
    /Could not update notifications/,
  );
  assert.equal(
    f.calls.filter(([action, body]) => action === "endpoint" && body.action === "register").length,
    8,
  );
  assert.equal(f.accountEnabled(), false);
  assert.equal(f.storage.size, 1); // Preserve the detach marker for safe logout.
});

test("account switching during activation retry never registers the next account from the old operation", async () => {
  const f = browserFixture({ registerPendingResponses: 99 });
  await f.api.prepareChallengePush("user-a");
  const enabling = f.api.enableChallengePush(f.sdk, "user-a");
  await new Promise((resolve) => setTimeout(resolve, 1));
  const before = f.calls.filter(
    ([action, body]) => action === "endpoint" && body.action === "register",
  ).length;
  f.switchUser("user-b");
  await assert.rejects(enabling, /account changed/);
  assert.equal(
    f.calls.filter(([action, body]) => action === "endpoint" && body.action === "register").length,
    before,
  );
  assert.equal(f.accountEnabled(), false);
});

function findButton(tree, label) {
  if (!tree || typeof tree !== "object") return null;
  if (Array.isArray(tree)) return tree.map((child) => findButton(child, label)).find(Boolean);
  if (tree.type === "button" && renderToStaticMarkup(tree).includes(label)) return tree;
  return findButton(tree.props?.children, label);
}

async function until(assertion) {
  for (let attempt = 0; attempt < 60; attempt++) {
    if (assertion()) return;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  assert.fail("Notification operation did not finish");
}

test("Allow on this device prompts once, connects the device and leaves account and categories alone", async () => {
  const f = browserFixture({ permission: "default", requestedPermission: "granted" });
  const card = await notificationCard(f, true);
  try {
    const button = findButton(card.render(), "Allow on this device");
    button.props.onClick();
    button.props.onClick();
    await until(() => renderToStaticMarkup(card.render()).includes(">Connected<"));
    assert.equal(f.calls.filter(([name]) => name === "permission").length, 1);
    assert.equal(f.accountEnabled(), false);
    assert.equal(f.deviceActive(), true);
    assert.deepEqual(
      f.calls.filter(([name]) => /-write$/.test(name)),
      [],
    );
    assert.equal(
      f.calls.filter(([name, body]) => name === "endpoint" && body.action === "register_device")
        .length,
      1,
    );

    f.context.Notification.permission = "denied";
    f.focus();
    await until(() => renderToStaticMarkup(card.render()).includes(">Permission denied<"));
    assert.match(renderToStaticMarkup(card.render()), />Not connected</);
    assert.deepEqual(
      f.calls.filter(([name]) => /-write$/.test(name)),
      [],
    );
  } finally {
    card.cleanup();
  }
});

test("explicit account enable does not prompt or register a device with default permission", async () => {
  const f = browserFixture({ permission: "default", requestedPermission: "granted" });
  const card = await notificationCard(f, true);
  try {
    findButton(card.render(), "Enable Challenge push").props.onClick();
    await until(() => renderToStaticMarkup(card.render()).includes(">On<"));
    assert.match(renderToStaticMarkup(card.render()), />Not requested</);
    assert.equal(f.deviceActive(), false);
    assert.deepEqual(
      f.calls.filter(([name]) => name === "permission" || name === "category-write"),
      [],
    );
  } finally {
    card.cleanup();
  }
});

test("account switch during device opt-in does not register for the replacement account", async () => {
  const f = browserFixture();
  const sdk = await f.api.prepareChallengePush("user-a");
  sdk.User.PushSubscription.optIn = async () => {
    f.switchUser("user-b");
    sdk.User.PushSubscription.optedIn = true;
  };
  await assert.rejects(f.api.connectChallengePushDevice(sdk, "user-a"), /account changed/);
  assert.equal(
    f.calls.some(([name, body]) => name === "endpoint" && body.action === "register_device"),
    false,
  );
});
for (const fails of [false, true]) {
  test(`notification card keeps SDK events local during Disable -> Enable (${fails ? "exhausted" : "recovered"})`, async () => {
    const f = browserFixture({ accountEnabled: true, optedIn: true });
    const card = await notificationCard(f, true);
    try {
      assert.match(renderToStaticMarkup(card.render()), />On</);
      findButton(card.render(), "Disable on all devices").props.onClick();
      await new Promise((resolve) => setTimeout(resolve, 10));
      assert.match(renderToStaticMarkup(card.render()), />Off</);
      // Force provider propagation or terminal registration failure, not auth failure.
      if (fails) f.failRegistration();
      findButton(card.render(), "Enable Challenge push").props.onClick();
      const pending = renderToStaticMarkup(card.render());
      assert.match(pending, /Updating…/);
      await new Promise((resolve) => setTimeout(resolve, 40));
      const html = renderToStaticMarkup(card.render());
      assert.match(html, fails ? /Temporarily unavailable/ : />Connected</);
      assert.match(html, />On</); // Account consent is independent of device registration.
      assert.doesNotMatch(html, /restore your Tempo session|Tempo couldn't start/);
      assert.equal(
        f.calls.some(([name]) => name === "permission" || name === "logout"),
        false,
      );
    } finally {
      card.cleanup();
    }
  });
}

test("explicit Enable waits for OneSignal optedIn propagation before registration", async () => {
  const f = browserFixture({ optInDelay: true });
  await f.api.prepareChallengePush("user-a");
  await f.api.enableChallengePush(f.sdk, "user-a");
  assert.equal(f.sdk.User.PushSubscription.optedIn, true);
  assert.equal(await f.api.pushIsEnabled(f.sdk), true);
  assert.equal(f.calls.filter(([action]) => action === "optIn").length, 1);
  assert.equal(
    f.calls.some(([action]) => action === "permission"),
    false,
  );
});
test("a stalled notification optIn times out inside the card without touching auth", async () => {
  const f = browserFixture();
  f.sdk.User.PushSubscription.optIn = () => new Promise(() => {});
  const card = await notificationCard(f, true);
  try {
    findButton(card.render(), "Connect this device").props.onClick();
    await new Promise((resolve) => setTimeout(resolve, 20));
    assert.match(renderToStaticMarkup(card.render()), /Temporarily unavailable/);
    assert.doesNotMatch(renderToStaticMarkup(card.render()), /restore your Tempo session/);
    assert.equal(
      f.calls.some(([action]) => action === "logout"),
      false,
    );
  } finally {
    card.cleanup();
  }
});

for (const transient of [false, true]) {
  test(`an interrupted connection cannot acquire a fresh generation${transient ? " on transport retry" : ""}`, async () => {
    let unblock;
    let started;
    const paused = new Promise((resolve) => {
      unblock = resolve;
    });
    const ready = new Promise((resolve) => {
      started = resolve;
    });
    const f = browserFixture({
      accountEnabled: true,
      registerFailures: transient ? 1 : 0,
      beforeRegistration: () => {
        started();
        return paused;
      },
    });
    const sdk = await f.api.prepareChallengePush("user-a");
    const connecting = f.api.connectChallengePushDevice(sdk, "user-a");
    await ready;
    if (transient) await f.api.setChallengePushAccountEnabled("user-a", false, sdk);
    else await f.api.detachChallengePush();
    unblock();
    await assert.rejects(connecting, /registration was cancelled/);
    const attempts = f.calls.filter(
      ([name, body]) => name === "endpoint" && body.action === "register_device",
    );
    assert.equal(attempts.length, transient ? 2 : 1);
    assert.ok(attempts.every(([, body]) => body.expected_generation === "0"));
    assert.equal(f.deviceActive(), false);

    const reconnectSdk = await f.api.prepareChallengePush("user-a");
    assert.equal(await f.api.connectChallengePushDevice(reconnectSdk, "user-a"), true);
    assert.equal(f.deviceActive(), true);
    assert.equal(f.accountEnabled(), !transient);
    assert.equal(
      f.calls
        .filter(([name, body]) => name === "endpoint" && body.action === "register_device")
        .at(-1)[1].expected_generation,
      "1",
    );
  });
}

test("an upgrade-required response is terminal to a V2 operation and stays out of auth", async () => {
  const f = browserFixture({
    registrationResponse: {
      enabled: false,
      registered: false,
      code: "notification_upgrade_required",
    },
  });
  const sdk = await f.api.prepareChallengePush("user-a");
  await assert.rejects(f.api.connectChallengePushDevice(sdk, "user-a"), /Update Tempo/);
  assert.equal(
    f.calls.filter(([name, body]) => name === "endpoint" && body.action === "register_device")
      .length,
    1,
  );
  assert.equal(
    f.calls.some(([name]) => name === "logout"),
    false,
  );
  assert.equal(f.accountEnabled(), false);
});

test("an account Enable and its device repair share the same original activation precondition", async () => {
  const f = browserFixture({ accountEnabled: true, optedIn: true });
  const sdk = await f.api.prepareChallengePush("user-a");
  await f.api.setChallengePushAccountEnabled("user-a", false, sdk);
  const generation = await f.api.setChallengePushAccountEnabled("user-a", true, sdk);
  const before = f.calls.filter(
    ([name, body]) => name === "endpoint" && body.action === "identity",
  ).length;
  await f.api.setChallengePushAccountEnabled("user-a", false, sdk);
  await assert.rejects(
    f.api.connectChallengePushDevice(sdk, "user-a", false, generation),
    /registration was cancelled/,
  );
  assert.equal(
    f.calls.filter(([name, body]) => name === "endpoint" && body.action === "identity").length,
    before,
  );
  assert.equal(f.accountEnabled(), false);
  assert.equal(f.deviceActive(), false);
});

test("upgrade-required registration is explained inside the card without changing the session", async () => {
  const f = browserFixture({
    registrationResponse: {
      enabled: false,
      registered: false,
      code: "notification_upgrade_required",
    },
  });
  const card = await notificationCard(f, true);
  try {
    findButton(card.render(), "Connect this device").props.onClick();
    await until(() => renderToStaticMarkup(card.render()).includes("Update Tempo"));
    assert.match(renderToStaticMarkup(card.render()), /Retry notifications/);
    assert.doesNotMatch(renderToStaticMarkup(card.render()), /restore your Tempo session/);
    assert.equal(
      f.calls.some(([name]) => name === "logout"),
      false,
    );
    assert.equal(f.accountEnabled(), false);
  } finally {
    card.cleanup();
  }
});
