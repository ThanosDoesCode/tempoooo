import { Card, SectionTitle } from "./ui-kit";
import { metricNumber, trainingTotals } from "@/lib/training";
import type { AppData } from "@/lib/types";

export function TrainingSummary({ data, on = new Date() }: { data: AppData; on?: Date }) {
  const totals = trainingTotals(data, on);
  return (
    <Card>
      <SectionTitle>Training summary</SectionTitle>
      <div className="grid grid-cols-3 gap-2 text-xs">
        {(
          [
            ["This week", totals.week],
            ["This month", totals.month],
            ["All time", totals.allTime],
          ] as const
        ).map(([label, total]) => (
          <div key={label} className="min-w-0">
            <p className="text-muted-foreground">{label}</p>
            <p className="num mt-1 font-semibold">
              {total.count} {total.count === 1 ? "workout" : "workouts"}
            </p>
            <p className="num mt-1 break-words text-muted-foreground">
              {total.volume == null ? "—" : metricNumber(total.volume)} kg
            </p>
          </div>
        ))}
      </div>
      <p className="mt-3 text-xs text-muted-foreground">
        Average duration:{" "}
        <span className="num">
          {totals.allTime.averageDuration == null
            ? "—"
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
