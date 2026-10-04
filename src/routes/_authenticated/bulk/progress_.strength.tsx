import { createFileRoute, Link } from "@tanstack/react-router";
import { format, parseISO, subDays } from "date-fns";
import { useMemo, useState } from "react";

import { AppShell } from "@/components/AppShell";
import { Card } from "@/components/ui-kit";
import { ProgressNav, ProgressRow, Sparkline } from "@/components/ProgressChrome";
import { useTrackedLifts } from "@/lib/progress-view";
import { useStrengthModel } from "@/lib/progress-model";
import { BULK_START, fmt, iso } from "@/lib/calc";
import { useAppData } from "@/lib/store";
import { countWorkoutsInRange } from "@/lib/goal-metrics";
import { liftEstimate } from "@/lib/strength-estimates";
import { ALL_EXERCISES, exerciseLabel, type AppData } from "@/lib/types";

export const Route = createFileRoute("/_authenticated/bulk/progress_/strength")({
  head: () => ({ meta: [{ title: "Tempo" }] }),
  component: StrengthPage,
});

function StrengthPage() {
  const data = useAppData();
  return (
    <AppShell>
      <h1 className="fade-up mb-3 text-3xl font-semibold tracking-tight">Progress</h1>
      <ProgressNav active="strength" />
      {data ? (
        <StrengthBody data={data} />
      ) : (
        <div className="h-48 animate-pulse rounded-[20px] bg-card" aria-label="Loading strength" />
      )}
    </AppShell>
  );
}

function StrengthBody({ data }: { data: AppData }) {
  const today = iso(new Date());
  const { records, workoutRecords } = useStrengthModel();
  const [trackedNames, setTrackedNames] = useTrackedLifts(data);
  const [editing, setEditing] = useState(false);

  const estimates = useMemo(
    () =>
      trackedNames.flatMap((name) => {
        const record = records.find((r) => r.name === name);
        return record ? [liftEstimate(record, BULK_START)] : [];
      }),
    [records, trackedNames],
  );
  const measured = estimates.filter((e) => e.trend !== "insufficient");
  const up = measured.filter((e) => e.trend === "up").length;

  // Planned workouts: a fixed four-week window (plan-start comparisons stay period-independent).
  const monthAgo = iso(subDays(parseISO(today), 27));
  const workoutsDone = countWorkoutsInRange(workoutRecords, monthAgo, today);
  const workoutTarget = (data.targets.weeklyWorkoutGoal ?? 0) * 4;

  const recordsThisMonth = useMemo(
    () =>
      records.filter((record) => (record.bestWeight?.date ?? "") >= monthAgo && record.bestWeight)
        .length,
    [records, monthAgo],
  );
  const latestRecord = useMemo(
    () =>
      [...records]
        .filter((r) => r.bestWeight)
        .sort((a, b) => (b.bestWeight!.date ?? "").localeCompare(a.bestWeight!.date ?? ""))[0],
    [records],
  );

  return (
    <div className="space-y-3">
      <Card className="grid grid-cols-2 gap-3 p-[18px]">
        <div>
          <div className="num text-[26px] font-semibold">
            {up} of {measured.length}
          </div>
          <div className="text-[13px] text-muted-foreground">
            main lifts up since {format(parseISO(BULK_START), "d MMM")}
          </div>
        </div>
        <div>
          <div className="num text-[26px] font-semibold">
            {workoutsDone}
            {workoutTarget ? ` of ${workoutTarget}` : ""}
          </div>
          <div className="text-[13px] text-muted-foreground">planned workouts done</div>
        </div>
      </Card>

      <div className="mx-1 flex items-center justify-between text-[13px] font-medium text-muted-foreground">
        <span>Your main lifts · estimated max</span>
        <button
          type="button"
          onClick={() => setEditing((value) => !value)}
          className="min-h-11 px-1 font-medium text-primary"
          aria-expanded={editing}
        >
          {editing ? "Done" : "Edit"}
        </button>
      </div>

      {editing ? (
        <Card className="p-3">
          <p className="mb-2 px-1 text-[13px] text-muted-foreground">
            Choose the lifts to track (default: first lift of each plan day).
          </p>
          <div className="max-h-72 space-y-0.5 overflow-y-auto">
            {ALL_EXERCISES.map((exercise) => {
              const checked = trackedNames.includes(exercise.name);
              return (
                <label
                  key={exercise.name}
                  className="flex min-h-11 items-center gap-3 rounded-lg px-2 text-[15px] active:bg-elevated"
                >
                  <input
                    type="checkbox"
                    checked={checked}
                    onChange={() =>
                      setTrackedNames(
                        checked
                          ? trackedNames.filter((name) => name !== exercise.name)
                          : [...trackedNames, exercise.name],
                      )
                    }
                    className="h-5 w-5 accent-[var(--color-primary)]"
                  />
                  {exerciseLabel(exercise.name)}
                </label>
              );
            })}
          </div>
        </Card>
      ) : (
        <>
          <div className="rounded-[20px] bg-card px-4">
            {estimates.length ? (
              estimates.map((estimate) => (
                <Link
                  key={estimate.record.name}
                  to="/bulk/progress/strength/$lift"
                  params={{ lift: estimate.record.name }}
                  preload="intent"
                  className="flex min-h-[62px] items-center gap-3 border-t border-border first:border-t-0 active:opacity-80"
                >
                  <div className="min-w-0 flex-1">
                    <p className="text-[15px] font-medium">{exerciseLabel(estimate.record.name)}</p>
                    <p className="num text-[13px] text-muted-foreground">
                      {estimate.current != null
                        ? `${fmt(estimate.current, 1)} kg${
                            estimate.changeKg != null
                              ? ` · was ${fmt(estimate.baseline, 1)} kg`
                              : estimate.series.length === 1
                                ? " · one session"
                                : ""
                          }`
                        : "Not enough data yet"}
                    </p>
                  </div>
                  <Sparkline
                    points={estimate.series.map((p) => p.value)}
                    width={56}
                    height={22}
                    tone={
                      estimate.trend === "up"
                        ? "var(--color-primary)"
                        : "var(--color-muted-foreground)"
                    }
                  />
                  <span
                    className={`num w-11 text-right text-[13px] font-semibold ${
                      estimate.trend === "up" ? "text-primary" : "text-muted-foreground"
                    }`}
                  >
                    {estimate.changePct != null
                      ? `${estimate.changePct >= 0 ? "+" : ""}${estimate.changePct.toFixed(0)}%`
                      : "—"}
                  </span>
                </Link>
              ))
            ) : (
              <p className="py-4 text-sm text-muted-foreground">
                No tracked lifts yet. Finish a workout with weights, or tap Edit to choose lifts.
              </p>
            )}
          </div>
          <p className="mx-1 text-[12px] text-muted-foreground">
            Estimated max is the most you could lift once, worked out from the weight and reps you
            log.
          </p>
        </>
      )}

      <div className="rounded-[20px] bg-card px-4">
        <Link
          to="/bulk/prs"
          preload="intent"
          className="flex min-h-[62px] items-center gap-3 border-t border-border first:border-t-0 active:opacity-80"
        >
          <div className="min-w-0 flex-1">
            <p className="text-[15px] font-medium">Records this month</p>
            {latestRecord?.bestWeight ? (
              <p className="num text-[13px] text-muted-foreground">
                Latest: {exerciseLabel(latestRecord.name)} {fmt(latestRecord.bestWeight.load, 1)} kg
                × {latestRecord.bestWeight.reps}
              </p>
            ) : null}
          </div>
          <span className="num text-[15px] font-semibold">{recordsThisMonth}</span>
        </Link>
        <ProgressRow to="/bulk/training/history" label="Workout history" />
      </div>
    </div>
  );
}
