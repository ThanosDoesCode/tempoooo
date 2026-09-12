import { useQueryClient } from "@tanstack/react-query";
import { useLocation } from "@tanstack/react-router";
import { LoaderCircle, RotateCw } from "lucide-react";
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { refreshBulk } from "@/lib/store";
import {
  PULL_REFRESH_HOLD_DISTANCE,
  PULL_REFRESH_THRESHOLD,
  pullGesture,
} from "@/lib/pull-to-refresh";

type PullStatus = "idle" | "pulling" | "refreshing" | "settling";

export function PullToRefresh({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();
  const { pathname } = useLocation();
  const start = useRef<{ x: number; y: number } | null>(null);
  const cancelled = useRef(false);
  const distanceRef = useRef(0);
  const settleTimer = useRef<number | null>(null);
  const statusRef = useRef<PullStatus>("idle");
  const [distance, setDistance] = useState(0);
  const [status, setStatus] = useState<PullStatus>("idle");
  const [announcement, setAnnouncement] = useState("");
  const updateStatus = useCallback((next: typeof statusRef.current) => {
    statusRef.current = next;
    setStatus(next);
  }, []);
  const updateDistance = useCallback((next: number) => {
    distanceRef.current = next;
    setDistance(next);
  }, []);
  const settle = useCallback(
    (message?: string) => {
      if (message) setAnnouncement(message);
      updateStatus("settling");
      updateDistance(0);
      if (settleTimer.current != null) window.clearTimeout(settleTimer.current);
      settleTimer.current = window.setTimeout(() => updateStatus("idle"), 220);
    },
    [updateDistance, updateStatus],
  );

  useEffect(
    () => () => {
      if (settleTimer.current != null) window.clearTimeout(settleTimer.current);
    },
    [],
  );

  useEffect(() => {
    const begin = (event: TouchEvent) => {
      const target = event.target instanceof Element ? event.target : null;
      if (
        statusRef.current === "refreshing" ||
        window.scrollY > 0 ||
        target?.closest("a, button, input, textarea, select, [role=dialog], [data-no-pull]")
      ) {
        start.current = null;
        return;
      }
      const touch = event.touches[0];
      if (!touch) return;
      start.current = { x: touch.clientX, y: touch.clientY };
      cancelled.current = false;
    };
    const move = (event: TouchEvent) => {
      const origin = start.current;
      const touch = event.touches[0];
      if (!origin || !touch || cancelled.current) return;
      const gesture = pullGesture(origin, { x: touch.clientX, y: touch.clientY }, window.scrollY);
      if (gesture.cancelled) {
        cancelled.current = true;
        updateDistance(0);
        return;
      }
      if (gesture.distance === 0) return;
      event.preventDefault();
      updateDistance(gesture.distance);
      updateStatus("pulling");
    };
    const end = () => {
      start.current = null;
      if (statusRef.current !== "pulling") return;
      if (distanceRef.current < PULL_REFRESH_THRESHOLD) {
        settle();
        return;
      }
      updateDistance(PULL_REFRESH_HOLD_DISTANCE);
      updateStatus("refreshing");
      setAnnouncement("Refreshing content");
      const isBulkRoute = pathname === "/bulk" || pathname.startsWith("/bulk/");
      void Promise.all([
        queryClient.refetchQueries({ type: "active" }),
        isBulkRoute ? refreshBulk() : Promise.resolve(),
      ])
        .then(() => settle("Content refreshed"))
        .catch(() => settle("Refresh failed. Pull down to try again."));
    };
    const cancel = () => {
      start.current = null;
      cancelled.current = true;
      if (statusRef.current !== "refreshing") {
        updateDistance(0);
        updateStatus("idle");
      }
    };
    document.addEventListener("touchstart", begin, { passive: true });
    document.addEventListener("touchmove", move, { passive: false });
    document.addEventListener("touchend", end, { passive: true });
    document.addEventListener("touchcancel", cancel, { passive: true });
    return () => {
      document.removeEventListener("touchstart", begin);
      document.removeEventListener("touchmove", move);
      document.removeEventListener("touchend", end);
      document.removeEventListener("touchcancel", cancel);
    };
  }, [pathname, queryClient, settle, updateDistance, updateStatus]);

  const ready = distance >= PULL_REFRESH_THRESHOLD;
  const visible = status !== "idle";
  const progress = Math.min(1, distance / PULL_REFRESH_THRESHOLD);
  return (
    <div className="relative min-h-screen overscroll-y-contain">
      <div
        aria-hidden="true"
        className="pointer-events-none fixed inset-x-0 top-[max(0.5rem,env(safe-area-inset-top))] z-30 flex justify-center transition-[opacity,transform] duration-150 ease-out"
        style={{
          opacity: visible ? Math.max(0.2, progress) : 0,
          transform: `translateY(${visible ? Math.min(14, distance * 0.18) : -12}px) scale(${0.82 + progress * 0.18})`,
        }}
      >
        <span
          className={`grid h-8 w-8 place-items-center rounded-full border bg-card/95 shadow-md backdrop-blur ${ready || status === "refreshing" ? "border-primary/50 text-primary" : "border-border text-muted-foreground"}`}
        >
          {status === "refreshing" ? (
            <LoaderCircle className="h-4 w-4 animate-spin" />
          ) : (
            <RotateCw
              className="h-4 w-4"
              style={{ transform: `rotate(${Math.round(progress * 210)}deg)` }}
            />
          )}
        </span>
      </div>
      <div
        className="tempo-pull-surface"
        style={{
          transform: `translate3d(0, ${distance}px, 0)`,
          transition: status === "pulling" ? "none" : undefined,
        }}
        aria-busy={status === "refreshing"}
      >
        {children}
      </div>
      <span className="sr-only" role="status" aria-live="polite">
        {announcement}
      </span>
    </div>
  );
}
