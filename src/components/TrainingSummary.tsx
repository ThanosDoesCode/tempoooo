import { format, startOfWeek } from "date-fns";
import { useMemo } from "react";
import { Card, SectionTitle } from "./ui-kit";
import { metricNumber, trainingTotals } from "@/lib/training";
import { useCompletedSessionDates } from "@/lib/bulk-training-sessions";
import {
  collectCompletedWorkouts,
  countWorkoutsInRange,
  formatWorkoutProgress,
  resolveWeeklyWorkoutTarget,
} from "@/lib/goal-metrics";
import { useBulkMeta } from "@/lib/store";
import type { AppData } from "@/lib/types";

export function TrainingSummary({ data, on = new Date() }: { data: AppData; on?: Date }) {
  const totals = trainingTotals(data, on);
  const { bulkId } = useBulkMeta();
  const today = format(on, "yyyy-MM-dd");
  const sessions = useCompletedSessionDates(bulkId ?? null, "2000-01-01", today);
  // Counts come from the shared Goal calculation: completed sessions by stable id plus
  // legacy history. Volume and duration remain legacy-log only (sessions have no totals here).
  const counts = useMemo(() => {
    const records = collectCompletedWorkouts({
      sessions: sessions.data ?? [],
      legacyWorkouts: data.workouts,
      legacyDays: data.days,
    });
    const week = format(startOfWeek(on, { weekStartsOn: 1 }), "yyyy-MM-dd");
    const month = `${today.slice(0, 7)}-01`;
    return {
      week: countWorkoutsInRange(records, week, today),
      month: countWorkoutsInRange(records, month, today),
      allTime: countWorkoutsInRange(records, "0000-01-01", today),
    };
  }, [sessions.data, data.workouts, data.days, on, today]);
  const target = resolveWeeklyWorkoutTarget({
    targetDaysPerWeek: data.targets.trainingDaysPerWeek ?? null,
  });
  return (
    <Card>
      <SectionTitle>Training summary</SectionTitle>
      <div className="grid grid-cols-3 gap-2 text-xs">
        {(
          [
            ["This week", counts.week, totals.week, formatWorkoutProgress(counts.week, target)],
            ["This month", counts.month, totals.month, String(counts.month)],
            ["All time", counts.allTime, totals.allTime, String(counts.allTime)],
          ] as const
        ).map(([label, count, total, shown]) => (
          <div key={label} className="min-w-0">
            <p className="text-muted-foreground">{label}</p>
            <p className="num mt-1 font-semibold">
              {shown} {count === 1 ? "workout" : "workouts"}
            </p>
            <p className="num mt-1 break-words text-muted-foreground">
              {total.volume == null ? "-" : metricNumber(total.volume)} kg
            </p>
          </div>
        ))}
      </div>
      <p className="mt-3 text-xs text-muted-foreground">
        Average duration:{" "}
        <span className="num">
          {totals.allTime.averageDuration == null
            ? "-"
            : `${Math.round(totals.allTime.averageDuration / 60)} min`}
        </span>
        {totals.allTime.timedCount ? ` · ${totals.allTime.timedCount} timed workouts` : ""}
      </p>
      <p className="mt-2 text-[11px] text-muted-foreground">
        Completed workouts only. Volume is secondary to exercise progression. Missing loads leave
        volume unavailable.
      </p>
      {totals.legacyCount ? (
        <p className="mt-1 text-[11px] text-muted-foreground">
          {totals.legacyCount} older logs have no completion status. They remain in history; open
          their training date to confirm completion.
        </p>
      ) : null}
    </Card>
  );
}
