import { Link } from "@tanstack/react-router";
import { Flame } from "lucide-react";
import { useStreak } from "@/lib/streak";

/**
 * Compact flame entry to the Streak screen. Shows the current streak (locked weeks only, so the
 * open week never bumps it early). Used in the fitness Today header and the core Challenge header.
 */
export function StreakFlame() {
  const { data } = useStreak();
  const current = data?.current ?? 0;
  return (
    <Link
      to="/streak"
      aria-label={`Streak, ${current} ${current === 1 ? "week" : "weeks"}`}
      className="inline-flex min-h-11 items-center gap-1.5 rounded-full bg-orange-500/15 px-3 text-orange-300 active:opacity-80"
    >
      <Flame className="h-4 w-4 text-orange-400" aria-hidden="true" />
      <span className="num text-[13px] font-semibold">
        {current} {current === 1 ? "week" : "weeks"}
      </span>
    </Link>
  );
}
