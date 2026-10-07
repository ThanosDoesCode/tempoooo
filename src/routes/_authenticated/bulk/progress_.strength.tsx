import { createFileRoute, Link } from "@tanstack/react-router";
import { useMemo, useState } from "react";

import { AppShell } from "@/components/AppShell";
import { Card, DataError } from "@/components/ui-kit";
import {
  ProgressHeader,
  ProgressNav,
  ProgressRow,
  PeriodPicker,
} from "@/components/ProgressChrome";
import { useProgressPeriod, useTrackedLifts } from "@/lib/progress-view";
import { useActiveTrainingPlan } from "@/lib/training-plans-query";
import { useProgressMode, useStrengthModel } from "@/lib/progress-model";
import { fmt, signed } from "@/lib/calc";
import { useAppData } from "@/lib/store";
import {
  progressRange,
  progressPeriodLabel,
  recordsPeriodTitle,
  type ProgressPeriod,
} from "@/lib/progress-period";
import {
  strengthProgress,
  workingPerformanceLabel,
  progressRecordEvents,
  trainingAdherence,
} from "@/lib/strength-progress";
import { exerciseLabel, type AppData } from "@/lib/types";

export const Route = createFileRoute("/_authenticated/bulk/progress_/strength")({
  head: () => ({ meta: [{ title: "Tempo" }] }),
  component: StrengthPage,
});

function StrengthPage() {
  const data = useAppData();
  const [period, setPeriod] = useProgressPeriod();
  return (
    <AppShell>
      <ProgressHeader>
        <PeriodPicker period={period} onChange={setPeriod} />
      </ProgressHeader>
      <ProgressNav active="strength" />
      {data ? (
        <StrengthBody data={data} period={period} />
      ) : (
        <div className="h-48 animate-pulse rounded-[20px] bg-card" aria-label="Loading strength" />
      )}
    </AppShell>
  );
}

function StrengthBody({ data, period }: { data: AppData; period: ProgressPeriod }) {
  const range = progressRange(period);
  const { mode, publicId } = useProgressMode();
  const plan = useActiveTrainingPlan(publicId);
  const { records, workoutRecords, loading, error, refetch } = useStrengthModel();
  const [trackedNames, setTrackedNames, resetTrackedNames, candidates, planLoading] =
    useTrackedLifts(data);
  const [search, setSearch] = useState("");
  const [editing, setEditing] = useState(false);

  const estimates = trackedNames.flatMap<{
    name: string;
    key: string;
    record: import("@/lib/personal-records").PersonalRecord | null;
    progress: ReturnType<typeof strengthProgress> | null;
  }>((name) => {
    const matching = records.filter((r) => r.name === name);
    return matching.length
      ? matching.map((record) => ({
          name,
          key: record.key,
          record,
          progress: strengthProgress(record, range),
        }))
      : [{ name, key: name, record: null, progress: null }];
  });
  const measured = estimates.flatMap(({ progress }) =>
    progress?.changeKg != null ? [progress] : [],
  );
  const up = measured.filter((p) => p.improved).length;
  const adherence = trainingAdherence(
    workoutRecords,
    range,
    mode === "public" && !plan.data ? null : (data.targets.weeklyWorkoutGoal ?? null),
  );
  const events = useMemo(
    () => progressRecordEvents(records, progressRange(period)),
    [records, period],
  );
  const latestRecord = events[0];

  if (error)
    return (
      <DataError
        message="Could not load your training history. Please retry."
        onRetry={() => void refetch()}
      />
    );

  return (
    <div className="space-y-3">
      <Card className="space-y-2 px-[18px] py-4">
        <div className="num text-[30px] font-semibold">
          {adherence.percentage != null ? `${adherence.percentage}%` : adherence.completed}
        </div>
        <div className="text-[13px] text-muted-foreground">
          {adherence.percentage != null ? "training adherence" : "completed workouts"}
        </div>
        <p className="text-sm text-muted-foreground">
          {adherence.completed}
          {adherence.planned != null
            ? ` of ${adherence.planned} planned workouts`
            : " completed workouts"}{" "}
          · {progressPeriodLabel(period)}
        </p>
        <p className="text-xs text-muted-foreground">
          {adherence.planned != null
            ? "Planned count uses your current weekly workout goal across this period."
            : period === "all"
              ? "Historical weekly goals aren't recorded, so no adherence percentage is estimated."
              : "Choose a training plan and weekly workout goal to track adherence."}
        </p>
        {measured.length ? (
          <p className="text-sm text-primary">
            {up} of {measured.length} comparable tracked lifts improved this period.
          </p>
        ) : null}
      </Card>

      <div className="mx-1 flex items-center justify-between text-[13px] font-medium text-muted-foreground">
        <span>Tracked lifts</span>
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
              estimates.map(({ name, key, record, progress }) => (
                <Link
                  key={key}
                  to="/bulk/progress/strength/$lift"
                  params={{ lift: name }}
                  preload="intent"
                  className="block min-h-[88px] border-t border-border py-3 first:border-t-0 active:opacity-80"
                >
                  <p className="break-words text-[15px] font-medium">
                    {exerciseLabel(name)}
                    {record?.side ? ` · ${record.side}` : ""}
                  </p>
                  <p className="num mt-1 text-lg font-semibold">
                    {record
                      ? workingPerformanceLabel(record, progress?.latest ?? null)
                      : "No data yet"}
                  </p>
                  <p className="mt-0.5 text-sm text-muted-foreground">
                    {progress?.changeKg != null
                      ? `${signed(progress.changeKg, 1)} kg vs start of period · same ${progress.latest!.reps} reps`
                      : progress?.sessions === 1
                        ? "One session"
                        : progress?.latest
                          ? "No comparable previous session yet"
                          : "Complete a workout to start tracking"}
                  </p>
                  {progress?.estimate.current != null ? (
                    <p className="num mt-1 text-xs text-muted-foreground">
                      Estimated 1RM {fmt(progress.estimate.current, 1)} kg
                      {progress.estimate.changePct != null
                        ? ` · ${signed(progress.estimate.changePct, 0)}%`
                        : ""}
                    </p>
                  ) : null}
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
            Estimated 1RM uses your logged weight and reps to estimate a one-rep maximum.
          </p>
        </>
      )}

      {records.length || workoutRecords.length ? (
        <div className="rounded-[20px] bg-card px-4">
          {records.length ? (
            <Link
              to="/bulk/prs"
              search={{ period }}
              preload="intent"
              className="flex min-h-[62px] items-center gap-3 border-t border-border first:border-t-0 active:opacity-80"
            >
              <div className="min-w-0 flex-1">
                <p className="text-[15px] font-medium">{recordsPeriodTitle(period)}</p>
                {latestRecord ? (
                  <p className="num text-[13px] text-muted-foreground">
                    Latest: {exerciseLabel(latestRecord.record.name)}{" "}
                    {workingPerformanceLabel(latestRecord.record, latestRecord.performance)}
                  </p>
                ) : (
                  <p className="text-[13px] text-muted-foreground">No records in this period</p>
                )}
              </div>
              <span className="num text-[15px] font-semibold">{events.length}</span>
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
