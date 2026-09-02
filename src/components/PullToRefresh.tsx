import { useQueryClient } from "@tanstack/react-query";
import { useLocation } from "@tanstack/react-router";
import { LoaderCircle, RotateCw } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { refreshBulk } from "@/lib/store";
import { PULL_REFRESH_THRESHOLD, pullGesture } from "@/lib/pull-to-refresh";

export function PullToRefresh() {
  const queryClient = useQueryClient();
  const { pathname } = useLocation();
  const start = useRef<{ x: number; y: number } | null>(null);
  const cancelled = useRef(false);
  const distanceRef = useRef(0);
  const statusRef = useRef<"idle" | "pulling" | "refreshing" | "done" | "error">("idle");
  const [distance, setDistance] = useState(0);
  const [status, setStatus] = useState<"idle" | "pulling" | "refreshing" | "done" | "error">(
    "idle",
  );
  const updateStatus = useCallback((next: typeof statusRef.current) => {
    statusRef.current = next;
    setStatus(next);
  }, []);
  const updateDistance = useCallback((next: number) => {
    distanceRef.current = next;
    setDistance(next);
  }, []);

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
        updateDistance(0);
        updateStatus("idle");
        return;
      }
      updateDistance(PULL_REFRESH_THRESHOLD);
      updateStatus("refreshing");
      const isBulkRoute = pathname === "/bulk" || pathname.startsWith("/bulk/");
      void Promise.all([
        queryClient.refetchQueries({ type: "active" }),
        isBulkRoute ? refreshBulk() : Promise.resolve(),
      ])
        .then(() => {
          updateStatus("done");
          window.setTimeout(() => {
            updateStatus("idle");
            updateDistance(0);
          }, 800);
        })
        .catch(() => {
          updateStatus("error");
          window.setTimeout(() => {
            updateStatus("idle");
            updateDistance(0);
          }, 1600);
        });
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
  }, [pathname, queryClient, updateDistance, updateStatus]);

  if (status === "idle") return null;
  const ready = distance >= PULL_REFRESH_THRESHOLD;
  const label =
    status === "refreshing"
      ? "Refreshing…"
      : status === "done"
        ? "Updated"
        : status === "error"
          ? "Refresh failed"
          : ready
            ? "Release to refresh"
            : "Pull to refresh";
  return (
    <div
      className="pointer-events-none fixed inset-x-0 top-[max(0.5rem,env(safe-area-inset-top))] z-50 flex justify-center transition-transform"
      style={{ transform: `translateY(${Math.max(0, distance - 50)}px)` }}
      role="status"
      aria-live="polite"
    >
      <div className="flex min-h-11 items-center gap-2 rounded-full border border-border bg-card/95 px-4 text-xs font-medium shadow-lg backdrop-blur">
        {status === "refreshing" ? (
          <LoaderCircle className="h-4 w-4 animate-spin text-primary" />
        ) : (
          <RotateCw className={`h-4 w-4 text-primary ${ready ? "rotate-180" : ""}`} />
        )}
        {label}
      </div>
    </div>
  );
}
