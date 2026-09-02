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

function loadSdk(): Promise<PushSdk> {
  if (sdkPromise) return sdkPromise;
  sdkPromise = new Promise<PushSdk>((resolve, reject) => {
    const timeout = window.setTimeout(
      () => reject(new Error("Notification service could not load. Reload to retry.")),
      20_000,
    );
    window.OneSignalDeferred ??= [];
    window.OneSignalDeferred.push(async (sdk) => {
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
        resolve(sdk);
      } catch {
        reject(new Error("Notification service could not load. Reload to retry."));
      } finally {
        window.clearTimeout(timeout);
      }
    });
    const script = document.createElement("script");
    script.src = "https://cdn.onesignal.com/sdks/web/v16/OneSignalSDK.page.js";
    script.defer = true;
    script.onerror = () => {
      window.clearTimeout(timeout);
      reject(new Error("Notification service is blocked or unavailable."));
    };
    document.head.appendChild(script);
  });
  return sdkPromise;
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
    await sdk.User.PushSubscription.optOut();
    await sdk.logout();
    localStorage.removeItem(markerKey);
  }
  const identity = await endpoint<{ external_id: string; enabled: boolean }>({
    action: "identity",
  });
  await assertCurrentUser(userId);
  await sdk.login(identity.external_id);
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
  const result = await endpoint<{ enabled: boolean }>({
    action: "register",
    subscription_id: id,
    activate: true,
  });
  if (!result.enabled) throw new Error("Could not enable notifications. Reload and try again.");
}

export async function refreshChallengePush(sdk: PushSdk, userId: string) {
  const saved = marker();
  if (
    !saved ||
    saved.userId !== userId ||
    !sdk.User.PushSubscription.id ||
    !sdk.User.PushSubscription.optedIn
  )
    return;
  await assertCurrentUser(userId);
  const result = await endpoint<{ enabled: boolean }>({
    action: "register",
    subscription_id: sdk.User.PushSubscription.id,
    activate: false,
  });
  if (result.enabled)
    localStorage.setItem(markerKey, JSON.stringify({ userId, id: sdk.User.PushSubscription.id }));
}

export async function disableChallengePush(sdk: PushSdk | null) {
  // Atomic account-wide opt-out takes effect even if OneSignal is unavailable.
  const { error } = await supabase.rpc("disable_challenge_push");
  if (error) throw new Error("Could not disable notifications. Please try again.");
  localStorage.removeItem(markerKey);
  try {
    await sdk?.User.PushSubscription.optOut();
  } catch {
    /* DB opt-out is authoritative. */
  }
}

export async function detachChallengePush() {
  const saved = marker();
  if (!saved) return;
  // Do not complete normal sign-out until this device is deactivated server-side.
  await endpoint({ action: "detach", subscription_id: saved.id });
  localStorage.removeItem(markerKey);
  try {
    const sdk = await loadSdk();
    await sdk.User.PushSubscription.optOut();
    await sdk.logout();
  } catch {
    /* The database already disabled this device. */
  }
}

/** Handles cross-tab sign-out, session loss and switching accounts on any route. */
export function watchChallengePushSession() {
  const { data } = supabase.auth.onAuthStateChange((_event, session) => {
    const saved = marker();
    if (!saved || saved.userId === session?.user.id) return;
    // Auth callbacks must not await Supabase calls (auth-lock deadlock).
    window.setTimeout(() => {
      void (async () => {
        try {
          const sdk = await loadSdk();
          // A delayed auth callback must not detach a newly registered account.
          const latest = marker();
          if (!latest || latest.userId !== saved.userId || latest.id !== saved.id) return;
          await sdk.User.PushSubscription.optOut();
          await sdk.logout();
          localStorage.removeItem(markerKey);
        } catch {
          const worker = await navigator.serviceWorker?.getRegistration("/");
          await (await worker?.pushManager.getSubscription())?.unsubscribe();
        }
      })().catch(() => {
        /* No credentials or provider details in logs. */
      });
    }, 0);
  });
  return () => data.subscription.unsubscribe();
}
