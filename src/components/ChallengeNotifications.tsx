import { useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Bell } from "lucide-react";
import { Switch } from "@/components/ui/switch";
import { PendingLabel } from "@/components/ui-kit";
import {
  connectChallengePushDevice,
  pushAvailability,
  pushDeviceIsRegistered,
  reconcileChallengePush,
  setChallengePushAccountEnabled,
  type PushAvailability,
  type PushSdk,
} from "@/lib/challenge-push";
import {
  notificationAccountKey,
  notificationPreferencesKey,
  saveNotificationPreference,
  useNotificationSettings,
  type ChallengePushAccount,
  type NotificationCategory,
  type NotificationPreferences,
} from "@/lib/notification-settings";

type DeviceState = {
  availability: PushAvailability;
  permission: NotificationPermission | null;
  registered: boolean | null;
  sdk: PushSdk | null;
  error?: string;
};

const categories = [
  ["week_penalties", "Week penalties", "When a finalized week creates a cash penalty"],
  ["payments", "Payments", "When a payment is marked as paid"],
] as const satisfies readonly (readonly [NotificationCategory, string, string])[];

const permission = () => (typeof Notification === "undefined" ? null : Notification.permission);
const statusUnavailable = "Notification status is temporarily unavailable. Please retry.";
const recoverablePushError = (error: unknown, fallback: string) => {
  const message = error && typeof error === "object" && "message" in error ? error.message : null;
  return message === "Update Tempo, then try enabling notifications again." ||
    message === "Device registration was cancelled. Reconnect this device."
    ? message
    : fallback;
};

export function ChallengeNotifications({ userId }: { userId: string }) {
  const queryClient = useQueryClient();
  const { account: accountQuery, preferences: preferenceQuery } = useNotificationSettings(userId);
  const account = accountQuery.data;
  const preferences = preferenceQuery.data;
  const hasChallenge = account?.hasChallenge;
  const [device, setDevice] = useState<DeviceState | null>(null);
  const [retryKey, setRetryKey] = useState(0);
  const [pushPending, setPushPending] = useState<"device" | "account" | null>(null);
  const [preferencePending, setPreferencePending] = useState<NotificationCategory | null>(null);
  const [accountError, setAccountError] = useState<string | null>(null);
  const [preferenceError, setPreferenceError] = useState<string | null>(null);
  const pushBusy = useRef(false);
  const preferenceBusy = useRef(false);
  const version = useRef(0);

  useEffect(() => {
    let alive = true;
    let refreshing = false;
    let observedSdk: PushSdk | null = null;
    const availability = pushAvailability();
    const base = { availability, permission: permission(), registered: null, sdk: null };
    setDevice(base);

    const refresh = async (force = false) => {
      if (refreshing || pushBusy.current) return;
      const operation = version.current;
      const current = () => alive && operation === version.current;
      const snapshot = { ...base, permission: permission() };
      if (availability.kind !== "supported" || !hasChallenge) {
        setDevice(snapshot);
        return;
      }
      refreshing = true;
      try {
        const result = await reconcileChallengePush(userId, { force });
        const registered = result.enabled || (await pushDeviceIsRegistered(result.sdk, userId));
        if (!current()) return;
        if (observedSdk !== result.sdk) {
          observedSdk?.User.PushSubscription.removeEventListener("change", onChange);
          observedSdk = result.sdk;
          observedSdk.User.PushSubscription.addEventListener("change", onChange);
        }
        setDevice({ ...snapshot, permission: permission(), registered, sdk: result.sdk });
      } catch {
        if (current()) setDevice({ ...snapshot, error: statusUnavailable });
      } finally {
        refreshing = false;
      }
    };
    const onChange = () => void refresh(true);
    void refresh(retryKey > 0);
    window.addEventListener("focus", onChange);
    return () => {
      alive = false;
      version.current += 1;
      observedSdk?.User.PushSubscription.removeEventListener("change", onChange);
      window.removeEventListener("focus", onChange);
    };
  }, [userId, hasChallenge, retryKey]);

  const patchSettings = async <T extends object>(key: readonly string[], patch: Partial<T>) => {
    await queryClient.cancelQueries({ queryKey: key, exact: true });
    queryClient.setQueryData<T>(key, (old) => (old ? { ...old, ...patch } : old));
  };

  const connect = async (askPermission = true) => {
    if (!device?.sdk || pushBusy.current) return;
    pushBusy.current = true;
    const operation = ++version.current;
    setPushPending("device");
    try {
      const registered = await connectChallengePushDevice(device.sdk, userId, askPermission);
      if (operation === version.current)
        setDevice({
          availability: device.availability,
          sdk: device.sdk,
          permission: permission(),
          registered,
        });
    } catch (error) {
      if (operation === version.current)
        setDevice({
          ...device,
          permission: permission(),
          registered: null,
          error: recoverablePushError(error, statusUnavailable),
        });
    } finally {
      pushBusy.current = false;
      setPushPending(null);
    }
  };

  const setAccount = async (enabled: boolean) => {
    if (pushBusy.current) return;
    pushBusy.current = true;
    const operation = ++version.current;
    setPushPending("account");
    setAccountError(null);
    try {
      const generation = await setChallengePushAccountEnabled(userId, enabled, device?.sdk ?? null);
      await patchSettings<ChallengePushAccount>(notificationAccountKey(userId), {
        accountEnabled: enabled,
      });
      if (operation !== version.current) return;
      if (!device) return;
      if (!enabled) setDevice({ ...device, permission: permission(), registered: false });
      // Repair an already-authorized device in the same action after account-wide Disable.
      // This path never prompts and never changes category preferences.
      else if (device.sdk && !device.registered && permission() === "granted") {
        try {
          const registered = await connectChallengePushDevice(
            device.sdk,
            userId,
            false,
            generation,
          );
          if (operation === version.current)
            setDevice({ ...device, permission: permission(), registered });
        } catch (error) {
          if (operation === version.current)
            setDevice({
              ...device,
              permission: permission(),
              registered: null,
              error: recoverablePushError(error, statusUnavailable),
            });
        }
      }
    } catch (error) {
      setAccountError(
        recoverablePushError(error, "Could not update Challenge notifications. Please try again."),
      );
    } finally {
      pushBusy.current = false;
      setPushPending(null);
      // Restart an in-flight device read that this explicit account action superseded.
      if (
        operation === version.current &&
        !device?.sdk &&
        !device?.error &&
        hasChallenge &&
        !device?.availability.reason
      )
        setRetryKey((key) => key + 1);
    }
  };

  const setPreference = async (category: NotificationCategory, enabled: boolean) => {
    if (preferenceBusy.current) return;
    preferenceBusy.current = true;
    setPreferencePending(category);
    setPreferenceError(null);
    try {
      await saveNotificationPreference(userId, category, enabled);
      await patchSettings<NotificationPreferences>(notificationPreferencesKey(userId), {
        [category]: enabled,
      });
    } catch {
      setPreferenceError("Could not save this preference. Please try again.");
    } finally {
      preferenceBusy.current = false;
      setPreferencePending(null);
    }
  };

  const permissionLabel =
    device?.permission === "granted"
      ? "Allowed"
      : device?.permission === "denied"
        ? "Permission denied"
        : device?.permission === "default"
          ? "Not requested"
          : "Unavailable";
  const availabilityLabel =
    device?.availability.kind === "configuration-unavailable"
      ? "Not configured"
      : device?.availability.kind === "home-screen-required"
        ? "Open from Home Screen"
        : device?.availability.kind === "unsupported"
          ? "Unsupported"
          : null;

  return (
    <div className="min-w-0 space-y-6">
      <section aria-labelledby="device-notifications" className="min-w-0 space-y-2">
        <h2 id="device-notifications" className="text-sm font-semibold">
          Device notifications
        </h2>
        <div className="card-surface min-w-0 space-y-3 p-4">
          <div className="flex items-center gap-3">
            <span className="grid size-9 shrink-0 place-items-center rounded-xl bg-elevated text-muted-foreground">
              <Bell className="size-4" aria-hidden="true" />
            </span>
            <dl className="min-w-0 flex-1 space-y-1 text-sm" aria-live="polite">
              <div className="flex flex-wrap items-baseline justify-between gap-x-2">
                <dt className="text-muted-foreground">Browser permission</dt>
                <dd className="font-medium">
                  {device ? (availabilityLabel ?? permissionLabel) : "Checking…"}
                </dd>
              </div>
              <div className="flex flex-wrap items-baseline justify-between gap-x-2">
                <dt className="text-muted-foreground">This device</dt>
                <dd className="font-medium">
                  {device?.error || (!account && accountQuery.isError)
                    ? "Temporarily unavailable"
                    : !device || (!availabilityLabel && hasChallenge !== false && !device.sdk)
                      ? "Checking…"
                      : device.registered && device.permission === "granted"
                        ? "Connected"
                        : "Not connected"}
                </dd>
              </div>
            </dl>
          </div>
          {device?.availability.reason ? (
            <p className="text-sm text-muted-foreground">{device.availability.reason}</p>
          ) : device?.permission === "denied" ? (
            <p className="rounded-xl bg-warn/10 px-3 py-2 text-sm text-warn">
              Allow Tempo in your browser or iPhone notification settings.
            </p>
          ) : hasChallenge === false ? (
            <p className="text-sm text-muted-foreground">
              Join a Challenge to connect this device.
            </p>
          ) : null}
          {device?.error ? (
            <div className="space-y-2">
              <p role="alert" className="text-sm text-warn">
                {device.error}
              </p>
              <button
                type="button"
                className="account-secondary min-h-11 sm:w-auto"
                disabled={pushPending !== null}
                onClick={() =>
                  device.sdk && device.permission === "granted"
                    ? void connect(false)
                    : setRetryKey((key) => key + 1)
                }
              >
                {pushPending === "device" ? (
                  <PendingLabel>Connecting…</PendingLabel>
                ) : (
                  "Retry notifications"
                )}
              </button>
            </div>
          ) : device?.sdk &&
            (!device.registered || device.permission === "default") &&
            device.permission !== "denied" ? (
            <button
              type="button"
              className="account-primary min-h-11"
              disabled={pushPending !== null}
              onClick={() => void connect()}
            >
              {pushPending === "device" ? (
                <PendingLabel>Connecting…</PendingLabel>
              ) : device.permission === "default" ? (
                "Allow on this device"
              ) : (
                "Connect this device"
              )}
            </button>
          ) : null}
        </div>
      </section>

      <section aria-labelledby="challenge-notifications" className="min-w-0 space-y-2">
        <h2 id="challenge-notifications" className="text-sm font-semibold">
          Challenge notifications
        </h2>
        <div className="card-surface min-w-0 divide-y divide-border overflow-hidden">
          <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2 p-4">
            <div className="min-w-0 text-sm">
              <p className="font-semibold">Account-wide push</p>
              <p className="text-muted-foreground" role="status">
                {account
                  ? account.accountEnabled
                    ? "On"
                    : "Off"
                  : accountQuery.isError
                    ? "Unavailable"
                    : "Loading…"}
              </p>
            </div>
            {account && (account.hasChallenge || account.accountEnabled) ? (
              <button
                type="button"
                className="account-secondary min-h-11"
                disabled={pushPending !== null}
                onClick={() => void setAccount(!account.accountEnabled)}
              >
                {pushPending === "account" ? (
                  <PendingLabel>Updating…</PendingLabel>
                ) : account.accountEnabled ? (
                  "Disable on all devices"
                ) : (
                  "Enable Challenge push"
                )}
              </button>
            ) : !account && accountQuery.isError ? (
              <button
                type="button"
                className="account-secondary min-h-11"
                onClick={() => void accountQuery.refetch()}
              >
                Retry account status
              </button>
            ) : null}
          </div>
          {accountError ? (
            <p role="alert" className="px-4 py-2 text-sm text-warn">
              {accountError}
            </p>
          ) : null}
          {preferences ? (
            categories.map(([key, title, description]) => (
              <label
                key={key}
                htmlFor={key}
                className="flex min-h-11 cursor-pointer items-center justify-between gap-3 px-4 py-2"
              >
                <span className="min-w-0">
                  <span id={`${key}-label`} className="block text-sm font-semibold">
                    {title}
                  </span>
                  <span
                    id={`${key}-description`}
                    className="block text-sm text-muted-foreground [overflow-wrap:anywhere]"
                  >
                    {description}
                  </span>
                </span>
                <Switch
                  id={key}
                  aria-labelledby={`${key}-label`}
                  aria-describedby={`${key}-description`}
                  checked={preferences[key]}
                  disabled={preferencePending !== null}
                  aria-busy={preferencePending === key}
                  onCheckedChange={(checked) => void setPreference(key, checked)}
                />
              </label>
            ))
          ) : preferenceQuery.isError ? (
            <div className="space-y-2 p-4">
              <p role="alert" className="text-sm text-warn">
                Could not load notification preferences.
              </p>
              <button
                type="button"
                className="account-secondary min-h-11"
                onClick={() => void preferenceQuery.refetch()}
              >
                Retry settings
              </button>
            </div>
          ) : (
            <p role="status" className="px-4 py-3 text-sm text-muted-foreground">
              Loading preferences…
            </p>
          )}
          {preferenceError ? (
            <p role="alert" className="px-4 py-2 text-sm text-warn">
              {preferenceError}
            </p>
          ) : null}
        </div>
        {account && !account.accountEnabled ? (
          <p className="text-xs text-muted-foreground">
            You can change these preferences while push is off.
          </p>
        ) : null}
      </section>
    </div>
  );
}
