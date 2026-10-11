import { Check, Dumbbell, Footprints, Pause, Utensils, type LucideIcon } from "lucide-react";
import type { RingKey, RingSummary, StreakThisWeek } from "@/lib/streak-model";
import type { RingProgress, ThisWeekRingProgress } from "@/lib/streak";

const RING_META: Record<RingKey, { name: string; Icon: LucideIcon }> = {
  run: { name: "Run", Icon: Footprints },
  train: { name: "Train", Icon: Dumbbell },
  eat: { name: "Eat", Icon: Utensils },
};

const remainingText = (key: RingKey, left: number) => {
  if (key === "run") return `${left} km to go`;
  if (key === "train") return `${left} ${left === 1 ? "workout" : "workouts"} left`;
  return `${left} more on-target ${left === 1 ? "day" : "days"}`;
};

function ringLines(ring: RingSummary, progress?: RingProgress) {
  const { name } = RING_META[ring.key];
  if (progress?.kind === "multiLeg") {
    // Independent Challenges counting toward Run this week — never a combined km target.
    return {
      name,
      value: null,
      status: `${progress.completed} of ${progress.legCount} challenges complete`,
    };
  }
  const value =
    progress?.kind === "count"
      ? progress.target != null
        ? `${progress.current} / ${progress.target}${progress.unit ? ` ${progress.unit}` : ""}`
        : `${progress.current}${progress.unit ? ` ${progress.unit}` : ""}`
      : null;
  if (ring.state === "closed") return { name, value, status: "Done" };
  if (ring.state === "skipped") return { name, value, status: "Paused" };
  if (progress?.kind === "count" && progress.target != null) {
    return {
      name,
      value,
      status: remainingText(ring.key, Math.max(0, progress.target - progress.current)),
    };
  }
  return { name, value, status: "In progress" };
}

/**
 * This week's ACTIVE rings only. Inactive rings never appear (never shown as failed), and when
 * nothing is active a single neutral line is shown instead of empty rings.
 */
export function StreakRings({
  thisWeek,
  progress,
}: {
  thisWeek: StreakThisWeek | null;
  progress: ThisWeekRingProgress;
}) {
  const rings = thisWeek?.rings.filter((r) => r.active) ?? [];
  if (rings.length === 0) {
    return <p className="text-[13px] text-muted-foreground">No streak requirements this week</p>;
  }
  return (
    <ul className="space-y-2.5">
      {rings.map((ring) => {
        const { Icon } = RING_META[ring.key];
        const lines = ringLines(ring, progress[ring.key]);
        const done = ring.state === "closed";
        const paused = ring.state === "skipped";
        return (
          <li key={ring.key} className="flex items-center gap-3">
            <span
              className={`grid h-9 w-9 flex-none place-items-center rounded-full ${
                done
                  ? "bg-primary/15 text-primary"
                  : paused
                    ? "bg-muted text-muted-foreground"
                    : "bg-orange-500/15 text-orange-400"
              }`}
            >
              {done ? (
                <Check className="h-4 w-4" aria-hidden="true" />
              ) : paused ? (
                <Pause className="h-4 w-4" aria-hidden="true" />
              ) : (
                <Icon className="h-4 w-4" strokeWidth={1.8} aria-hidden="true" />
              )}
            </span>
            <span className="min-w-0 flex-1">
              <span className="flex items-baseline justify-between gap-2">
                <span className="text-[15px] font-medium">{lines.name}</span>
                {lines.value ? (
                  <span className="num text-[15px] font-semibold">{lines.value}</span>
                ) : null}
              </span>
              <span className="num block text-[13px] text-muted-foreground">{lines.status}</span>
            </span>
          </li>
        );
      })}
    </ul>
  );
}
