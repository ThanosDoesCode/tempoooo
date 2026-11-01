import { Flame } from "lucide-react";

/** Shared locked-week headline; no goal or streak calculation belongs here. */
export function StreakHeadline({ current }: { current: number | null }) {
  return (
    <span className="inline-flex shrink-0 items-center gap-1.5">
      <Flame className="h-4 w-4 text-orange-400" aria-hidden="true" />
      <span
        className={`num text-[13px] font-semibold ${current !== null && current > 0 ? "text-orange-300" : "text-muted-foreground"}`}
      >
        {current === null ? "Streak" : `${current} ${current === 1 ? "week" : "weeks"}`}
      </span>
    </span>
  );
}
