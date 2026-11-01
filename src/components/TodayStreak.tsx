import { Link } from "@tanstack/react-router";
import {
  ChevronRight,
  Dumbbell,
  Flame,
  Footprints,
  Pause,
  Utensils,
  type LucideIcon,
} from "lucide-react";
import type { RingKey, StreakData } from "@/lib/streak-model";

const RING_META: Record<RingKey, { name: string; Icon: LucideIcon }> = {
  run: { name: "Run", Icon: Footprints },
  train: { name: "Train", Icon: Dumbbell },
  eat: { name: "Eat", Icon: Utensils },
};

/**
 * Compact Today streak: the locked-week count plus this week's ACTIVE goals and their state only.
 * Presentation only — the frozen goal set and every result come from the streak RPC. Deep history
 * (rings detail, recent weeks) lives on /streak.
 */
export function TodayStreak({ data }: { data: StreakData }) {
  const rings = data.activeRings;
  const done = rings.filter((ring) => ring.state === "closed").length;
  const paused = rings.length > 0 && rings.every((ring) => ring.state === "skipped");
  const weeks = `${data.current} ${data.current === 1 ? "week" : "weeks"}`;
  const summary =
    rings.length === 0
      ? "No streak goals this week"
      : paused
        ? "Paused this week"
        : `${done} of ${rings.length} this week`;
  const goals = rings.map((ring) => ({
    ...ring,
    ...RING_META[ring.key],
    status: ring.state === "closed" ? "done" : ring.state === "skipped" ? "paused" : "to do",
  }));
  const goalLabel = goals.map((goal) => `${goal.name} ${goal.status}`).join(", ");

  return (
    <Link
      to="/streak"
      aria-label={`Streak, ${weeks}. ${summary}${goalLabel ? `: ${goalLabel}` : ""}`}
      className="card-surface flex min-h-11 items-center gap-2 rounded-[20px] px-4 py-3"
    >
      <Flame className="h-4 w-4 text-orange-400" aria-hidden="true" />
      <span
        className={`num flex-1 text-[15px] font-semibold ${data.current > 0 ? "" : "text-muted-foreground"}`}
      >
        {weeks}
      </span>
      {/* This week's goals as icons only; the full wording is in the link label and on /streak. */}
      <span className="flex flex-none items-center gap-1.5" aria-hidden="true">
        {paused ? (
          <span
            title="Paused this week"
            data-paused="true"
            className="grid h-7 w-7 place-items-center rounded-full border border-border text-muted-foreground"
          >
            <Pause className="h-3.5 w-3.5" strokeWidth={1.8} />
          </span>
        ) : null}
        {(paused ? [] : goals).map(({ key, Icon, name, status, state }) => (
          <span
            key={key}
            title={`${name} ${status}`}
            data-goal={key}
            data-status={status}
            className={`grid h-7 w-7 place-items-center rounded-full ${
              state === "closed"
                ? "bg-primary/15 text-primary"
                : "border border-border text-muted-foreground"
            } ${state === "skipped" ? "opacity-40" : ""}`}
          >
            <Icon className="h-3.5 w-3.5" strokeWidth={1.8} />
          </span>
        ))}
      </span>
      <ChevronRight className="control-chevron text-muted-foreground" aria-hidden="true" />
    </Link>
  );
}
