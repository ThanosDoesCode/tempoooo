import { Link } from "@tanstack/react-router";
import { ChevronRight } from "lucide-react";
import { StreakHeadline } from "./StreakHeadline";
import type { RingKey, StreakData } from "@/lib/streak-model";

const RING_LABEL: Record<RingKey, string> = { run: "Run", train: "Train", eat: "Eat" };

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
        : `This week ${done}/${rings.length}`;

  return (
    <Link
      to="/streak"
      aria-label={`Streak, ${weeks}. ${summary}`}
      className="card-surface flex min-h-11 items-center gap-3 rounded-[20px] px-4 py-3"
    >
      <StreakHeadline current={data.current} />
      <span className="min-w-0 flex-1">
        <span className="num block text-[13px] text-muted-foreground">{summary}</span>
        {rings.length && !paused ? (
          <span className="mt-1 flex flex-wrap gap-1">
            {rings.map((ring) => {
              const state =
                ring.state === "closed" ? "done" : ring.state === "skipped" ? "paused" : "to do";
              return (
                <span
                  key={ring.key}
                  aria-label={`${RING_LABEL[ring.key]} ${state}`}
                  className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${
                    ring.state === "closed"
                      ? "bg-primary/15 text-primary"
                      : "bg-elevated text-muted-foreground"
                  } ${ring.state === "skipped" ? "opacity-60" : ""}`}
                >
                  {ring.state === "closed" ? "✓ " : ""}
                  {RING_LABEL[ring.key]}
                </span>
              );
            })}
          </span>
        ) : null}
      </span>
      <ChevronRight className="control-chevron text-muted-foreground" aria-hidden="true" />
    </Link>
  );
}
