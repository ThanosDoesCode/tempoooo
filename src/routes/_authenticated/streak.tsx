import { createFileRoute } from "@tanstack/react-router";
import { ChevronDown, Flame, Minus, Pause, X } from "lucide-react";
import { AppShell, PageHeader } from "@/components/AppShell";
import { PageSkeleton } from "@/components/PageSkeleton";
import { DataError } from "@/components/ui-kit";
import { StreakRings } from "@/components/StreakRings";
import { accountProductMode, useMemberships } from "@/lib/bulk-access";
import { useStreak, useThisWeekRingProgress } from "@/lib/streak";
import {
  STREAK_MILESTONES,
  type StreakData,
  type StreakWeekResult,
  type StreakWeekTile,
} from "@/lib/streak-model";

export const Route = createFileRoute("/_authenticated/streak")({
  head: () => ({ meta: [{ title: "Tempo" }] }),
  component: StreakScreen,
});

function StreakScreen() {
  const memberships = useMemberships();
  const core = accountProductMode(memberships.data) === "core";
  const streak = useStreak();
  const progress = useThisWeekRingProgress(streak.data?.thisWeek ?? null);
  return (
    <AppShell>
      <PageHeader
        title="Streak"
        backTo={core ? "/challenge" : "/bulk"}
        backLabel={core ? "Challenge" : "Today"}
      />
      {streak.isLoading ? (
        <PageSkeleton label="Loading your streak" />
      ) : streak.error || !streak.data ? (
        <DataError
          message="Could not load your streak. Your data is unchanged."
          onRetry={() => void streak.refetch()}
        />
      ) : (
        <StreakContent data={streak.data} progress={progress} />
      )}
    </AppShell>
  );
}

function StreakContent({
  data,
  progress,
}: {
  data: StreakData;
  progress: ReturnType<typeof useThisWeekRingProgress>;
}) {
  const weeks = [...data.recentWeeks].reverse(); // oldest to newest, left to right
  return (
    <div className="space-y-5">
      <section className="flex flex-col items-center py-2 text-center">
        <span className="grid h-16 w-16 place-items-center rounded-full bg-orange-500/15">
          <Flame className="h-8 w-8 text-orange-400" aria-hidden="true" />
        </span>
        <p className="num mt-3 text-5xl font-semibold leading-none">{data.current}</p>
        <p className="mt-1 text-sm text-muted-foreground">
          {data.current === 1 ? "week" : "weeks"}
        </p>
        <p className="mt-1 text-[13px] text-muted-foreground">
          {data.isBest ? "Your best streak yet" : `Best ${data.best} weeks`}
        </p>
      </section>

      <section className="card-surface space-y-3 rounded-[20px] p-5">
        <h2 className="text-[13px] text-muted-foreground">This week</h2>
        <StreakRings thisWeek={data.thisWeek} progress={progress} />
      </section>

      {weeks.length > 0 ? (
        <section className="card-surface space-y-3 rounded-[20px] p-5">
          <h2 className="text-[13px] text-muted-foreground">Recent weeks</h2>
          <ul className="flex flex-wrap gap-3">
            {weeks.map((week) => (
              <WeekTile key={week.weekStart} week={week} />
            ))}
          </ul>
        </section>
      ) : null}

      <section className="card-surface flex items-center gap-2 rounded-[20px] px-5 py-4">
        <Flame className="h-4 w-4 text-orange-400" aria-hidden="true" />
        <span className="text-[13px] text-muted-foreground">
          {data.freeMissUsedThisMonth ? "Free miss used this month" : "Free miss available"}
        </span>
      </section>

      <section className="card-surface space-y-3 rounded-[20px] p-5">
        <div className="flex items-center justify-between">
          <h2 className="text-[13px] text-muted-foreground">Milestones</h2>
          {data.nextMilestone ? (
            <span className="text-[13px] text-muted-foreground">Next {data.nextMilestone}</span>
          ) : null}
        </div>
        <ul className="flex flex-wrap gap-2">
          {STREAK_MILESTONES.map((weeks) => {
            const reached = data.current >= weeks;
            return (
              <li
                key={weeks}
                className={`num rounded-full px-3 py-1.5 text-[13px] font-medium ${
                  reached ? "bg-orange-500/15 text-orange-300" : "bg-muted text-muted-foreground"
                }`}
              >
                {weeks} weeks
              </li>
            );
          })}
        </ul>
      </section>

      <details className="card-surface rounded-[20px] px-5">
        <summary className="disclosure-summary min-h-11 py-3 text-[15px] font-medium">
          How it works
          <ChevronDown
            className="disclosure-chevron h-4 w-4 text-muted-foreground"
            aria-hidden="true"
          />
        </summary>
        <ul className="space-y-2 pb-4 text-[13px] leading-5 text-muted-foreground">
          <li>Complete every active ring in the week.</li>
          <li>Paused or requirement-free weeks do not break your streak.</li>
          <li>One free miss is available each month.</li>
        </ul>
      </details>
    </div>
  );
}

const TILE: Record<
  StreakWeekResult,
  { icon: typeof Flame | null; label: string; className: string }
> = {
  kept: { icon: Flame, label: "Kept", className: "bg-orange-500/20 text-orange-400" },
  free: { icon: Flame, label: "Free", className: "bg-orange-500/20 text-orange-400" },
  paused: {
    icon: Pause,
    label: "Paused",
    className: "border border-dashed border-border text-muted-foreground",
  },
  none: {
    icon: Minus,
    label: "No requirement",
    className: "border border-dashed border-border text-muted-foreground",
  },
  missed: { icon: X, label: "Missed", className: "bg-destructive/15 text-destructive" },
  open: {
    icon: null,
    label: "This week",
    className: "border border-dashed border-primary/50 text-primary",
  },
};

function WeekTile({ week }: { week: StreakWeekTile }) {
  const visual = week.locked ? TILE[week.result] : TILE.open;
  const Icon = visual.icon;
  const day = week.weekStart.slice(8); // day-of-month, weekly tile (not a daily grid)
  return (
    <li className="flex w-9 flex-col items-center gap-1">
      <span
        aria-label={visual.label}
        className={`grid h-9 w-9 place-items-center rounded-full ${visual.className}`}
      >
        {Icon ? <Icon className="h-4 w-4" aria-hidden="true" /> : null}
        {week.result === "free" && week.locked ? <span className="sr-only">Free miss</span> : null}
      </span>
      <span className="num text-[11px] text-muted-foreground">{day}</span>
      {week.result === "free" && week.locked ? (
        <span className="text-[10px] font-medium text-orange-300">Free</span>
      ) : null}
    </li>
  );
}
