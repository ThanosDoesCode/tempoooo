import { Link } from "@tanstack/react-router";
import { StreakHeadline } from "./StreakHeadline";
import { useStreak } from "@/lib/streak";

/**
 * Compact flame entry to the Streak screen. Shows the current streak (locked weeks only, so the
 * open week never bumps it early). Used in the fitness Today header and the core Challenge header.
 */
export function StreakFlame() {
  const { data } = useStreak();
  const current = data?.current ?? null;
  return (
    <Link
      to="/streak"
      aria-label={
        current === null ? "Streak" : `Streak, ${current} ${current === 1 ? "week" : "weeks"}`
      }
      className={`inline-flex min-h-11 items-center rounded-full px-3 active:opacity-80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${current !== null && current > 0 ? "bg-orange-500/15" : ""}`}
    >
      <StreakHeadline current={current} />
    </Link>
  );
}
