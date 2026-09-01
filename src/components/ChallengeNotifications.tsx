import { useEffect, useState } from "react";
import { Bell } from "lucide-react";
import { Card } from "@/components/ui-kit";
import {
  disableChallengePush,
  enableChallengePush,
  prepareChallengePush,
  pushIsEnabled,
  pushUnavailableReason,
  refreshChallengePush,
  type PushSdk,
} from "@/lib/challenge-push";

export function ChallengeNotifications({ userId }: { userId: string }) {
  const [sdk, setSdk] = useState<PushSdk | null>(null);
  const [on, setOn] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    let current: PushSdk | null = null;
    let refreshing = false;
    const refresh = async () => {
      if (!current || refreshing) return;
      refreshing = true;
      try {
        await refreshChallengePush(current, userId);
        const enabled = await pushIsEnabled(current);
        if (alive) setOn(enabled);
      } catch {
        if (alive) setMessage("Could not check notification status. Reload to retry.");
      } finally {
        refreshing = false;
      }
    };
    const onChange = () => {
      void refresh();
    };
    setSdk(null);
    setOn(false);
    const reason = pushUnavailableReason();
    setMessage(reason);
    if (!reason) {
      void prepareChallengePush(userId)
        .then(async (value) => {
          if (!alive) return;
          current = value;
          setSdk(value);
          await refresh();
          if (alive) {
            value.User.PushSubscription.addEventListener("change", onChange);
            window.addEventListener("focus", onChange);
          }
        })
        .catch((error: Error) => {
          if (alive) setMessage(error.message);
        });
    }
    return () => {
      alive = false;
      current?.User.PushSubscription.removeEventListener("change", onChange);
      window.removeEventListener("focus", onChange);
    };
  }, [userId]);
  const enable = async () => {
    if (!sdk) return;
    setBusy(true);
    setMessage(null);
    try {
      await enableChallengePush(sdk, userId);
      setOn(true);
    } catch (error) {
      setOn(false);
      setMessage((error as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const disable = async () => {
    setBusy(true);
    try {
      await disableChallengePush(sdk);
      setOn(false);
      setMessage("Challenge notifications disabled on all devices.");
    } catch (error) {
      setMessage((error as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="my-4">
      <Card>
        <div className="flex items-center gap-2 text-sm font-semibold">
          <Bell size={16} aria-hidden="true" />
          <span role="status">Notifications {on ? "On" : "Off"}</span>
        </div>
        <p className="mt-2 text-xs text-muted-foreground">
          Get notified when your opponent logs an activity, completes the week, or updates a
          payment. Notifications may show their first name, distance or payment amount on your lock
          screen.
        </p>
        <div className="mt-3 flex flex-wrap gap-3 text-xs">
          {!on && (
            <button
              type="button"
              disabled={!sdk || busy}
              onClick={() => void enable()}
              className="rounded-lg bg-primary px-3 py-2 font-semibold text-primary-foreground disabled:opacity-50"
            >
              {busy ? "Updating…" : "Enable challenge notifications"}
            </button>
          )}
          <button
            type="button"
            disabled={busy}
            onClick={() => void disable()}
            className="rounded-lg border border-border px-3 py-2 disabled:opacity-50"
          >
            Disable on all devices
          </button>
        </div>
        {message && (
          <p role="status" className="mt-2 text-xs text-muted-foreground">
            {message}
          </p>
        )}
        {on && <p className="mt-2 text-xs text-muted-foreground">Enabled on this device.</p>}
      </Card>
    </div>
  );
}
