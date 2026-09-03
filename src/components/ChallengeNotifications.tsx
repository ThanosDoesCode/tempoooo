import { useEffect, useState } from "react";
import { Bell, ChevronRight, TriangleAlert } from "lucide-react";
import { PendingLabel } from "@/components/ui-kit";
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
  const [serviceState, setServiceState] = useState<
    "checking" | "ready" | "unsupported" | "temporary-failure"
  >("checking");
  const [phase, setPhase] = useState<"checking" | "enabling" | "disabling" | null>("checking");
  const [feedback, setFeedback] = useState<{
    text: string;
    tone: "info" | "success" | "error";
  } | null>(null);
  const [retryKey, setRetryKey] = useState(0);
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
        if (alive) {
          setOn(enabled);
          setServiceState("ready");
        }
      } catch {
        if (alive) {
          setServiceState("temporary-failure");
          setFeedback({
            text: "Notification status is temporarily unavailable. Retry notifications in a moment.",
            tone: "error",
          });
        }
      } finally {
        refreshing = false;
      }
    };
    const onChange = () => {
      void refresh();
    };
    setSdk(null);
    setOn(false);
    setServiceState("checking");
    setPhase("checking");
    const reason = pushUnavailableReason();
    setFeedback(reason ? { text: reason, tone: "info" } : null);
    if (!reason) {
      void (async () => {
        try {
          const value = await prepareChallengePush(userId);
          if (!alive) return;
          current = value;
          setSdk(() => value);
          await refresh();
          if (alive) {
            value.User.PushSubscription.addEventListener("change", onChange);
            window.addEventListener("focus", onChange);
          }
        } catch (error) {
          if (alive) {
            setServiceState("temporary-failure");
            setFeedback({ text: (error as Error).message, tone: "error" });
          }
        } finally {
          if (alive) setPhase(null);
        }
      })();
    } else {
      setServiceState("unsupported");
      setPhase(null);
    }
    return () => {
      alive = false;
      current?.User.PushSubscription.removeEventListener("change", onChange);
      window.removeEventListener("focus", onChange);
    };
  }, [userId, retryKey]);
  const enable = async () => {
    if (!sdk) return;
    setPhase("enabling");
    setFeedback({
      text: "Registering this device. This can take a few seconds.",
      tone: "info",
    });
    try {
      await enableChallengePush(sdk, userId);
      setOn(true);
      setFeedback({ text: "Challenge notifications enabled on this device.", tone: "success" });
    } catch (error) {
      setOn(false);
      setFeedback({ text: (error as Error).message, tone: "error" });
    } finally {
      setPhase(null);
    }
  };
  const disable = async () => {
    setPhase("disabling");
    setFeedback({ text: "Disabling challenge notifications…", tone: "info" });
    try {
      await disableChallengePush(sdk);
      setOn(false);
      setFeedback({
        text: "Challenge notifications disabled on all devices.",
        tone: "success",
      });
    } catch (error) {
      setFeedback({ text: (error as Error).message, tone: "error" });
    } finally {
      setPhase(null);
    }
  };
  const permissionMissing =
    typeof Notification !== "undefined" && Notification.permission === "default";
  const permissionDenied =
    typeof Notification !== "undefined" && Notification.permission === "denied";
  return (
    <div className="card-surface overflow-hidden">
      <details className="group">
        <summary className="flex cursor-pointer list-none items-center gap-3 px-3 py-2.5 [&::-webkit-details-marker]:hidden">
          <span className="grid h-8 w-8 place-items-center rounded-lg bg-elevated text-muted-foreground">
            <Bell className="h-4 w-4" aria-hidden="true" />
          </span>
          <span className="text-sm font-medium">Notifications</span>
          <span
            role="status"
            className={`ml-auto text-xs ${
              feedback?.tone === "error"
                ? "text-danger"
                : on
                  ? "text-good"
                  : "text-muted-foreground"
            }`}
          >
            {phase === "checking"
              ? "Checking…"
              : phase === "enabling"
                ? "Enabling…"
                : phase === "disabling"
                  ? "Disabling…"
                  : feedback?.tone === "error"
                    ? serviceState === "temporary-failure"
                      ? "Temporarily unavailable"
                      : "Needs attention"
                    : serviceState === "unsupported"
                      ? "Unsupported"
                      : permissionDenied
                        ? "Permission denied"
                        : permissionMissing
                          ? "Not requested"
                          : on
                            ? "On"
                            : "Off"}
          </span>
          <ChevronRight
            className="h-4 w-4 text-muted-foreground transition-transform group-open:rotate-90"
            aria-hidden="true"
          />
        </summary>
        <div className="border-t border-border px-3 pb-3 pt-2.5">
          <p className="text-[11px] leading-relaxed text-muted-foreground">
            Get updates when your opponent logs activity, completes the week, or changes a payment.
          </p>
          {!on && phase === null && permissionMissing && feedback?.tone !== "error" ? (
            <p className="mt-2 text-[11px] leading-relaxed text-muted-foreground">
              Notification permission has not been granted on this device. Tempo asks only after you
              tap Enable notifications.
            </p>
          ) : null}
          {!on && phase === null && permissionDenied ? (
            <p className="mt-2 text-[11px] leading-relaxed text-muted-foreground">
              Notification permission is denied on this device. You can allow Tempo in your browser
              or iPhone notification settings.
            </p>
          ) : null}
          <div className="mt-2 flex flex-wrap gap-2 text-xs">
            {!on ? (
              <button
                type="button"
                disabled={!sdk || phase !== null}
                onClick={() => void enable()}
                className="rounded-lg bg-primary px-3 py-2 font-semibold text-primary-foreground disabled:opacity-50"
              >
                {phase === "checking" ? (
                  <PendingLabel>Checking notifications…</PendingLabel>
                ) : phase === "enabling" ? (
                  <PendingLabel>Enabling notifications…</PendingLabel>
                ) : (
                  "Enable notifications"
                )}
              </button>
            ) : null}
            <button
              type="button"
              disabled={phase !== null}
              onClick={() => void disable()}
              className="rounded-lg border border-border px-3 py-2 disabled:opacity-50"
            >
              {phase === "disabling" ? (
                <PendingLabel>Disabling notifications…</PendingLabel>
              ) : (
                "Disable on all devices"
              )}
            </button>
          </div>
          {feedback && feedback.tone !== "error" ? (
            <p
              role="status"
              className={`mt-2 text-xs ${
                feedback.tone === "success" ? "text-good" : "text-muted-foreground"
              }`}
            >
              {feedback.text}
            </p>
          ) : null}
        </div>
      </details>
      {feedback?.tone === "error" ? (
        <div
          role="alert"
          className="flex items-start gap-2 border-t border-danger/20 bg-danger/5 px-3 py-2 text-[11px] leading-relaxed text-danger"
        >
          <TriangleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
          <span className="min-w-0 flex-1">{feedback.text}</span>
          {serviceState === "temporary-failure" ? (
            <button
              type="button"
              disabled={phase !== null}
              onClick={() => setRetryKey((key) => key + 1)}
              className="min-h-11 shrink-0 rounded-lg border border-danger/40 px-3 py-2 font-semibold disabled:opacity-50"
            >
              Retry notifications
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
