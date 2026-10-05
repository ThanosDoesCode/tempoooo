import { createFileRoute, Link } from "@tanstack/react-router";
import { format, parseISO, subDays } from "date-fns";
import { useMemo, useState } from "react";

import { AppShell } from "@/components/AppShell";
import { Card } from "@/components/ui-kit";
import { ProgressHeader, ProgressNav, ProgressRow, Sparkline } from "@/components/ProgressChrome";
import { useTrackedLifts } from "@/lib/progress-view";
import { useStrengthModel } from "@/lib/progress-model";
import { BULK_START, fmt, iso } from "@/lib/calc";
import { useAppData } from "@/lib/store";
import { countWorkoutsInRange } from "@/lib/goal-metrics";
import { liftEstimate } from "@/lib/strength-estimates";
import { exerciseLabel, type AppData } from "@/lib/types";

export const Route = createFileRoute("/_authenticated/bulk/progress_/strength")({
  head: () => ({ meta: [{ title: "Tempo" }] }),
  component: StrengthPage,
});

function StrengthPage() {
  const data = useAppData();
  return (
    <AppShell>
      <ProgressHeader />
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
  const { records, workoutRecords, loading } = useStrengthModel();
  const [trackedNames, setTrackedNames, resetTrackedNames, candidates, planLoading] =
    useTrackedLifts(data);
  const [search, setSearch] = useState("");
  const [editing, setEditing] = useState(false);

  const estimates = useMemo(
    () =>
      trackedNames.flatMap((name) => {
        const record = records.find((r) => r.name === name);
        return [{ name, estimate: record ? liftEstimate(record, BULK_START) : null }];
      }),
    [records, trackedNames],
  );
  const measured = estimates.flatMap(({ estimate }) =>
    estimate && estimate.trend !== "insufficient" ? [estimate] : [],
  );
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
      <Card className="grid grid-cols-2 gap-3 px-[18px] py-4">
        <div>
          <div className="num text-[26px] font-semibold">
            {measured.length ? `${up} of ${measured.length}` : "—"}
          </div>
          <div className="text-[13px] text-muted-foreground">
            {measured.length
              ? `tracked lifts up since ${format(parseISO(BULK_START), "d MMM")}`
              : loading
                ? "Loading strength…"
                : "No data yet"}
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
        <span>Tracked lifts · estimated max</span>
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
            Choose the exercises you want to follow over time
          </p>
          <input
            aria-label="Search tracked exercises"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search your exercises"
            className="mb-2 h-11 w-full rounded-xl bg-elevated px-3 text-sm"
          />
          <div className="max-h-80 space-y-2 overflow-y-auto">
            {[
              { label: "Tracked", names: trackedNames },
              {
                label: "From your plan",
                names: candidates.fromPlan.filter((name) => !trackedNames.includes(name)),
              },
              {
                label: "From completed workouts",
                names: candidates.history.filter((name) => !trackedNames.includes(name)),
              },
            ].map((group) => {
              const names = group.names.filter((name) =>
                name.toLowerCase().includes(search.toLowerCase()),
              );
              return names.length ? (
                <section key={group.label}>
                  <h3 className="px-1 text-xs text-muted-foreground">{group.label}</h3>
                  {names.map((name) => (
                    <label
                      key={name}
                      className="flex min-h-11 items-center gap-3 rounded-lg px-2 text-sm active:bg-elevated"
                    >
                      <input
                        type="checkbox"
                        checked={trackedNames.includes(name)}
                        className="h-5 w-5 accent-[var(--color-primary)]"
                        onChange={() =>
                          setTrackedNames(
                            trackedNames.includes(name)
                              ? trackedNames.filter((n) => n !== name)
                              : [...trackedNames, name],
                          )
                        }
                      />
                      {exerciseLabel(name)}
                    </label>
                  ))}
                </section>
              ) : null;
            })}
            {planLoading ? (
              <p className="text-sm text-muted-foreground">Loading your plan…</p>
            ) : null}
          </div>
          <button
            type="button"
            className="mt-2 min-h-11 px-1 text-sm font-medium text-primary"
            onClick={resetTrackedNames}
          >
            Reset to plan defaults
          </button>
        </Card>
      ) : (
        <>
          <div className="rounded-[20px] bg-card px-4">
            {estimates.length ? (
              estimates.map(({ name, estimate }) => (
                <Link
                  key={name}
                  to="/bulk/progress/strength/$lift"
                  params={{ lift: name }}
                  preload="intent"
                  className="flex min-h-[62px] items-center gap-3 border-t border-border first:border-t-0 active:opacity-80"
                >
                  <div className="min-w-0 flex-1">
                    <p className="text-[15px] font-medium">{exerciseLabel(name)}</p>
                    <p className="num text-[13px] text-muted-foreground">
                      {estimate?.current != null
                        ? `${fmt(estimate.current, 1)} kg${
                            estimate?.changeKg != null
                              ? ` · was ${fmt(estimate.baseline, 1)} kg`
                              : estimate?.series.length === 1
                                ? " · one session"
                                : ""
                          }`
                        : "No data yet"}
                    </p>
                  </div>
                  <Sparkline
                    points={
                      estimate?.series.length && estimate.series.length >= 2
                        ? estimate.series.map((p) => p.value)
                        : []
                    }
                    width={56}
                    height={22}
                    tone={
                      estimate?.trend === "up"
                        ? "var(--color-primary)"
                        : "var(--color-muted-foreground)"
                    }
                  />
                  <span
                    className={`num w-11 text-right text-[13px] font-semibold ${
                      estimate?.trend === "up" ? "text-primary" : "text-muted-foreground"
                    }`}
                  >
                    {estimate?.changePct != null
                      ? `${estimate.changePct >= 0 ? "+" : ""}${estimate.changePct.toFixed(0)}%`
                      : "—"}
                  </span>
                </Link>
              ))
            ) : (
              <p className="py-4 text-sm text-muted-foreground">
                No tracked lifts yet. Complete a workout with weights to start tracking, or tap Edit
                to choose lifts.
              </p>
            )}
          </div>
          <p className="mx-1 text-[12px] text-muted-foreground">
            Estimated max is the most you could lift once, worked out from the weight and reps you
            log.
          </p>
        </>
      )}

      {records.length || workoutRecords.length ? (
        <div className="rounded-[20px] bg-card px-4">
          {records.length ? (
            <Link
              to="/bulk/prs"
              preload="intent"
              className="flex min-h-[62px] items-center gap-3 border-t border-border first:border-t-0 active:opacity-80"
            >
              <div className="min-w-0 flex-1">
                <p className="text-[15px] font-medium">Records this month</p>
                {latestRecord?.bestWeight ? (
                  <p className="num text-[13px] text-muted-foreground">
                    Latest: {exerciseLabel(latestRecord.name)}{" "}
                    {fmt(latestRecord.bestWeight.load, 1)} kg × {latestRecord.bestWeight.reps}
                  </p>
                ) : null}
              </div>
              <span className="num text-[15px] font-semibold">{recordsThisMonth}</span>
            </Link>
          ) : null}
          {workoutRecords.length ? (
            <ProgressRow to="/bulk/training/history" label="Workout history" />
          ) : null}
        </div>
      ) : (
        <Link
          to="/bulk/training"
          preload="intent"
          className="inline-flex min-h-11 items-center rounded-xl bg-primary px-4 text-sm font-semibold text-primary-foreground"
        >
          Open Training
        </Link>
      )}
    </div>
  );
}
