import { supabase } from "@/integrations/supabase/client";

type Subscription = {
  id?: string;
  optedIn?: boolean;
  optIn(): Promise<void>;
  optOut(): Promise<void>;
  addEventListener(event: "change", listener: () => void): void;
  removeEventListener(event: "change", listener: () => void): void;
};
export type PushSdk = {
  init(options: Record<string, unknown>): Promise<void>;
  login(id: string): Promise<void>;
  logout(): Promise<void>;
  User: { externalId?: string; PushSubscription: Subscription };
};
declare global {
  interface Window {
    OneSignalDeferred?: Array<(sdk: PushSdk) => void>;
  }
}
const markerKey = "challenge-push-device";
type DeviceMarker = { userId: string; id: string };
let sdkPromise: Promise<PushSdk> | undefined;
let loadedSdk: PushSdk | undefined;
let identifiedUserId: string | undefined;
const accountPreference = new Map<string, boolean>();
let activeReconciliation:
  { userId: string; promise: Promise<{ sdk: PushSdk; enabled: boolean }> } | undefined;
let lastReconciliation:
  { userId: string; at: number; value: { sdk: PushSdk; enabled: boolean } } | undefined;
const SDK_RETRY_DELAYS_MS = [250, 1000] as const;
const SDK_LOAD_TIMEOUT_MS = 20_000;
const RECONCILIATION_CACHE_MS = 5_000;

function marker(): DeviceMarker | null {
  try {
    return JSON.parse(localStorage.getItem(markerKey) ?? "null") as DeviceMarker | null;
  } catch {
    return null;
  }
}

export function pushUnavailableReason(): string | null {
  if (!import.meta.env["VITE_ONESIGNAL_APP_ID"])
    return "Challenge notifications have not been configured yet.";
  const ios =
    /iPad|iPhone|iPod/.test(navigator.userAgent) ||
    (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
  if (
    ios &&
    !window.matchMedia("(display-mode: standalone)").matches &&
    !(navigator as Navigator & { standalone?: boolean }).standalone
  ) {
    return "On iPhone or iPad (iOS 16.4+), use Share → Add to Home Screen, then open the app from that icon to enable notifications.";
  }
  if (
    !window.isSecureContext ||
    !("Notification" in window) ||
    !("serviceWorker" in navigator) ||
    !("PushManager" in window)
  ) {
    return "Push notifications are not supported in this browser. Try a supported browser over HTTPS.";
  }
  return null;
}

function safeInitDiagnostic(value: unknown, fallback: string, maxLength: number) {
  const text = typeof value === "string" && value.trim() ? value.trim() : fallback;
  return text
    .replace(
      /\b((?:authorization|bearer|token|secret|password|api[_ -]?key|user[_ -]?id|subscription[_ -]?id|push[_ -]?token)\s*(?:[:=]\s*|\s+))(?:"[^"]*"|'[^']*'|[^\s,;]+)/gi,
      "$1[redacted]",
    )
    .slice(0, maxLength);
}

function logOneSignalInitError(error: unknown) {
  const record =
    typeof error === "object" && error !== null
      ? (error as { name?: unknown; message?: unknown })
      : undefined;
  console.error(
    JSON.stringify({
      phase: "onesignal_init",
      error_name: safeInitDiagnostic(record?.name, "UnknownError", 80),
      error_message: safeInitDiagnostic(
        record?.message ?? (typeof error === "string" ? error : undefined),
        "OneSignal initialization failed",
        500,
      ),
    }),
  );
}

function logPushDiagnostic(
  phase:
    | "auth_event"
    | "permission"
    | "identity_sync"
    | "backend_sync"
    | "subscription_recovery_needed"
    | "subscription_optin_start"
    | "subscription_optin_complete"
    | "subscription_optin_failed",
  details: Record<string, string | boolean>,
) {
  console.info(JSON.stringify({ phase, ...details }));
}

async function initSdk(sdk: PushSdk) {
  try {
    await sdk.init({
      appId: import.meta.env["VITE_ONESIGNAL_APP_ID"],
      serviceWorkerPath: "OneSignalSDKWorker.js",
      serviceWorkerParam: { scope: "/" },
      allowLocalhostAsSecureOrigin: import.meta.env.DEV,
      autoResubscribe: false,
      promptOptions: { slidedown: { prompts: [{ type: "push", autoPrompt: false }] } },
      notifyButton: { enable: false },
      welcomeNotification: { disable: true },
    });
  } catch (error) {
    logOneSignalInitError(error);
    throw error;
  }
}

function loadSdkAttempt(): Promise<PushSdk> {
  if (loadedSdk) return initSdk(loadedSdk).then(() => loadedSdk!);
  return new Promise<PushSdk>((resolve, reject) => {
    let settled = false;
    let script: HTMLScriptElement | null = null;
    const onSdk = async (sdk: PushSdk) => {
      loadedSdk = sdk;
      try {
        await initSdk(sdk);
        finish(() => resolve(sdk));
      } catch (error) {
        finish(() => reject(error));
      }
    };
    const cleanup = () => {
      window.clearTimeout(timeout);
      const deferred = window.OneSignalDeferred;
      const index = deferred?.indexOf(onSdk) ?? -1;
      if (index >= 0) deferred?.splice(index, 1);
    };
    const finish = (settle: () => void) => {
      if (settled) return;
      settled = true;
      cleanup();
      settle();
    };
    const timeout = window.setTimeout(() => {
      script?.remove();
      finish(() => reject(new Error("notification_sdk_load_timeout")));
    }, SDK_LOAD_TIMEOUT_MS);
    window.OneSignalDeferred ??= [];
    window.OneSignalDeferred.push(onSdk);
    script = document.createElement("script");
    script.src = "https://cdn.onesignal.com/sdks/web/v16/OneSignalSDK.page.js";
    script.defer = true;
    script.dataset["tempoOneSignal"] = "true";
    script.onerror = () => {
      script?.remove();
      finish(() => reject(new Error("notification_sdk_script_failed")));
    };
    document.head.appendChild(script);
  });
}

async function loadSdkWithRetry() {
  for (let attempt = 0; attempt <= SDK_RETRY_DELAYS_MS.length; attempt += 1) {
    try {
      return await loadSdkAttempt();
    } catch {
      if (attempt === SDK_RETRY_DELAYS_MS.length) break;
      await new Promise((resolve) =>
        window.setTimeout(resolve, SDK_RETRY_DELAYS_MS[attempt] ?? 1000),
      );
    }
  }
  throw new Error(
    "Notification service is temporarily unavailable. Check your connection and retry notifications.",
  );
}

function loadSdk(): Promise<PushSdk> {
  if (sdkPromise) return sdkPromise;
  const pending = loadSdkWithRetry();
  sdkPromise = pending;
  void pending.catch(() => {
    if (sdkPromise === pending) sdkPromise = undefined;
  });
  return pending;
}

async function endpoint<T>(body: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.functions.invoke("challenge-push-subscription", {
    body,
    timeout: 15_000,
  });
  if (error) throw new Error("Could not update notifications. Please retry in a moment.");
  return data as T;
}

async function assertCurrentUser(userId: string) {
  const { data } = await supabase.auth.getSession();
  if (data.session?.user.id !== userId)
    throw new Error("Your account changed. Reload before enabling notifications.");
}

export async function prepareChallengePush(userId: string) {
  const sdk = await loadSdk();
  await assertCurrentUser(userId);
  const saved = marker();
  if (saved && saved.userId !== userId) {
    await sdk.logout();
    identifiedUserId = undefined;
    localStorage.removeItem(markerKey);
  }
  const identity = await endpoint<{ external_id: string; enabled: boolean }>({
    action: "identity",
  });
  await assertCurrentUser(userId);
  accountPreference.set(userId, identity.enabled);
  if (identifiedUserId !== userId) {
    await sdk.login(identity.external_id);
    identifiedUserId = userId;
  }
  logPushDiagnostic("identity_sync", {
    outcome: "complete",
    account_enabled: identity.enabled,
  });
  return sdk;
}

async function subscriptionId(sdk: PushSdk): Promise<string> {
  if (sdk.User.PushSubscription.id && sdk.User.PushSubscription.optedIn)
    return sdk.User.PushSubscription.id;
  return new Promise((resolve, reject) => {
    const listener = () => {
      if (!sdk.User.PushSubscription.id || !sdk.User.PushSubscription.optedIn) return;
      cleanup();
      resolve(sdk.User.PushSubscription.id);
    };
    const timeout = window.setTimeout(() => {
      cleanup();
      reject(new Error("Device registration is still pending. Please try enabling again."));
    }, 20_000);
    const cleanup = () => {
      window.clearTimeout(timeout);
      sdk.User.PushSubscription.removeEventListener("change", listener);
    };
    sdk.User.PushSubscription.addEventListener("change", listener);
    listener();
  });
}

export async function pushIsEnabled(sdk: PushSdk) {
  const id = sdk.User.PushSubscription.id;
  if (Notification.permission !== "granted" || !id || !sdk.User.PushSubscription.optedIn)
    return false;
  return (await endpoint<{ enabled: boolean }>({ action: "status", subscription_id: id })).enabled;
}

export async function enableChallengePush(sdk: PushSdk, userId: string) {
  // Request synchronously from the click handler, before network awaits (Safari).
  const permission = await Notification.requestPermission();
  if (permission !== "granted")
    throw new Error("Notifications are off. You can allow them later in your browser settings.");
  await assertCurrentUser(userId);
  await sdk.User.PushSubscription.optIn();
  const id = await subscriptionId(sdk);
  await assertCurrentUser(userId);
  localStorage.setItem(markerKey, JSON.stringify({ userId, id }));
  const result = await registerWithSynchronizationRetry(id, true);

  if (!result?.enabled) {
    throw new Error("Could not enable notifications. Please retry notifications.");
  }
  accountPreference.set(userId, true);
  lastReconciliation = { userId, at: Date.now(), value: { sdk, enabled: true } };
}

async function registerWithSynchronizationRetry(subscriptionId: string, activate: boolean) {
  let result: { enabled: boolean } | null = null;
  for (let attempt = 0; attempt < 8; attempt += 1) {
    try {
      result = await endpoint<{ enabled: boolean }>({
        action: "register",
        subscription_id: subscriptionId,
        activate,
      });
      break;
    } catch {
      if (attempt === 7)
        throw new Error("Could not update notifications. Please retry in a moment.");
      await new Promise((resolve) => window.setTimeout(resolve, 1500));
    }
  }
  return result;
}

export async function refreshChallengePush(sdk: PushSdk, userId: string) {
  if (accountPreference.get(userId) === false) {
    logPushDiagnostic("backend_sync", { outcome: "account_disabled" });
    return false;
  }
  const permission = Notification.permission;
  logPushDiagnostic("permission", { value: permission });
  if (permission !== "granted") return false;

  let id = sdk.User.PushSubscription.id;
  const optedIn = Boolean(sdk.User.PushSubscription.optedIn);
  if (!id) {
    logPushDiagnostic("backend_sync", {
      outcome: "subscription_unavailable",
      subscription_present: false,
      opted_in: optedIn,
    });
    throw new Error(
      "Notification status is temporarily unavailable. Retry notifications in a moment.",
    );
  }

  await assertCurrentUser(userId);
  if (!optedIn) {
    logPushDiagnostic("subscription_recovery_needed", {
      subscription_present: true,
      account_enabled: true,
    });
    logPushDiagnostic("subscription_optin_start", { outcome: "started" });
    try {
      await sdk.User.PushSubscription.optIn();
      id = await subscriptionId(sdk);
      logPushDiagnostic("subscription_optin_complete", { outcome: "complete" });
    } catch {
      logPushDiagnostic("subscription_optin_failed", { outcome: "failed" });
      throw new Error(
        "Notification status is temporarily unavailable. Retry notifications in a moment.",
      );
    }
    await assertCurrentUser(userId);
  }

  const result = await registerWithSynchronizationRetry(id, false);
  if (result?.enabled) {
    localStorage.setItem(markerKey, JSON.stringify({ userId, id }));
  }
  logPushDiagnostic("backend_sync", {
    outcome: result?.enabled ? "enabled" : "disabled",
    subscription_present: true,
    opted_in: true,
  });
  return Boolean(result?.enabled);
}

export function reconcileChallengePush(userId: string, options?: { force?: boolean }) {
  const now = Date.now();
  if (activeReconciliation?.userId === userId) return activeReconciliation.promise;
  if (
    !options?.force &&
    lastReconciliation?.userId === userId &&
    now - lastReconciliation.at < RECONCILIATION_CACHE_MS
  )
    return Promise.resolve(lastReconciliation.value);

  const promise = (async () => {
    const sdk = await prepareChallengePush(userId);
    const enabled = await refreshChallengePush(sdk, userId);
    const value = { sdk, enabled };
    lastReconciliation = { userId, at: Date.now(), value };
    return value;
  })();
  activeReconciliation = { userId, promise };
  const clearActive = () => {
    if (activeReconciliation?.promise === promise) activeReconciliation = undefined;
  };
  void promise.then(clearActive, clearActive);
  return promise;
}

export async function disableChallengePush(sdk: PushSdk | null) {
  // Atomic account-wide opt-out takes effect even if OneSignal is unavailable.
  const { error } = await supabase.rpc("disable_challenge_push");
  if (error) throw new Error("Could not disable notifications. Please try again.");
  localStorage.removeItem(markerKey);
  const userId = identifiedUserId;
  if (userId) accountPreference.set(userId, false);
  lastReconciliation = undefined;
  try {
    await sdk?.User.PushSubscription.optOut();
  } catch {
    /* DB opt-out is authoritative. */
  }
}

export async function detachChallengePush() {
  const saved = marker();
  if (saved) {
    // Do not complete normal sign-out until this device is detached server-side.
    await endpoint({ action: "detach", subscription_id: saved.id });
    localStorage.removeItem(markerKey);
  }
  try {
    const sdk = await loadSdk();
    await sdk.logout();
    identifiedUserId = undefined;
    lastReconciliation = undefined;
  } catch {
    /* The database already detached this device. */
  }
}

/** Handles cross-tab sign-out, session loss and switching accounts on any route. */
export function watchChallengePushSession() {
  let observedUserId: string | undefined;
  const { data } = supabase.auth.onAuthStateChange((event, session) => {
    const nextUserId = session?.user.id;
    logPushDiagnostic("auth_event", {
      event,
      same_user: Boolean(nextUserId && nextUserId === observedUserId),
      authenticated: Boolean(nextUserId),
    });
    if (nextUserId === observedUserId) return;
    observedUserId = nextUserId;
    // Auth callbacks must not await Supabase calls (auth-lock deadlock).
    window.setTimeout(() => {
      void (async () => {
        if (!nextUserId) {
          localStorage.removeItem(markerKey);
          const sdk = await loadSdk();
          await sdk.logout();
          identifiedUserId = undefined;
          lastReconciliation = undefined;
          return;
        }
        await reconcileChallengePush(nextUserId);
      })().catch(() => {
        /* No credentials or provider details in logs. */
      });
    }, 0);
  });
  return () => data.subscription.unsubscribe();
}
