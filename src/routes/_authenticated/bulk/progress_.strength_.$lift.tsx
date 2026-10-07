import { createFileRoute } from "@tanstack/react-router";
import { format, parseISO } from "date-fns";
import { useMemo } from "react";
import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import { AppShell, PageHeader } from "@/components/AppShell";
import { Card } from "@/components/ui-kit";
import { PeriodPicker } from "@/components/ProgressChrome";
import { ProgressChartTooltip } from "@/components/ProgressChartTooltip";
import { progressRange, inProgressRange, type ProgressPeriod } from "@/lib/progress-period";
import { strengthProgress, workingPerformanceLabel } from "@/lib/strength-progress";
import { useProgressPeriod, chartAxis, chartTooltip } from "@/lib/progress-view";
import { fmt, progressionFor, signed } from "@/lib/calc";
import { useAppData } from "@/lib/store";
import { useStrengthModel } from "@/lib/progress-model";
import { exerciseDef, exerciseLabel, type AppData } from "@/lib/types";

export const Route = createFileRoute("/_authenticated/bulk/progress_/strength_/$lift")({
  head: () => ({ meta: [{ title: "Tempo" }] }),
  component: LiftDetailPage,
});

function LiftDetailPage() {
  const { lift } = Route.useParams();
  const data = useAppData();
  const [period, setPeriod] = useProgressPeriod();
  return (
    <AppShell>
      <PageHeader
        title={exerciseLabel(lift)}
        backTo="/bulk/progress/strength"
        backLabel="Strength"
      />
      <div className="mb-3 flex justify-end">
        <PeriodPicker period={period} onChange={setPeriod} />
      </div>
      {data ? (
        <LiftBody data={data} name={lift} period={period} />
      ) : (
        <div className="h-48 animate-pulse rounded-[20px] bg-card" aria-label="Loading lift" />
      )}
    </AppShell>
  );
}

function LiftBody({ data, name, period }: { data: AppData; name: string; period: ProgressPeriod }) {
  const { records } = useStrengthModel();
  const record = useMemo(() => records.find((r) => r.name === name), [records, name]);
  const progress = record ? strengthProgress(record, progressRange(period)) : null;
  const estimate = progress?.estimate;
  const nextSuggestion = useMemo(() => nextSessionSuggestion(data, name), [data, name]);

  if (!record || !estimate || !progress?.latest) {
    return (
      <Card className="p-[18px]">
        <p className="text-[15px] font-medium">Not enough data yet</p>
        <p className="mt-1 text-sm text-muted-foreground">
          Log this lift with a weight and reps to see your estimated-max trend.
        </p>
        {nextSuggestion ? (
          <p className="mt-3 text-sm text-muted-foreground">Next time: {nextSuggestion}</p>
        ) : null}
      </Card>
    );
  }

  const chart = estimate.series.map((point) => ({ date: point.date, value: point.value }));
  const bestSets = record.performances
    .filter((performance) => inProgressRange(performance.date, progressRange(period)))
    .slice(0, 3);
  const recordDate = record.bestWeight?.date ?? null;

  return (
    <div className="space-y-3">
      <Card className="p-[18px]">
        <p className="num text-[30px] font-semibold tracking-tight">
          {workingPerformanceLabel(record, progress!.latest)}
        </p>
        <p className="mt-1 text-sm text-muted-foreground">
          {progress?.changeKg != null
            ? `${signed(progress.changeKg, 1)} kg vs start of period · same ${progress.latest!.reps} reps`
            : progress?.sessions === 1
              ? "One session"
              : "No comparable previous session yet"}
        </p>
        {estimate.current != null ? (
          <p className="num mt-3 text-sm text-muted-foreground">
            Estimated 1RM {fmt(estimate.current, 1)} kg
            {estimate.changePct != null ? ` · ${signed(estimate.changePct, 0)}%` : ""}
          </p>
        ) : null}
        <p className="mt-1 text-xs text-muted-foreground">
          Estimated 1RM uses your logged weight and reps to estimate a one-rep maximum.
        </p>
        <div className="mt-3 h-[150px]">
          {chart.length >= 2 ? (
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={chart} margin={{ top: 8, right: 6, left: -24, bottom: 0 }}>
                <CartesianGrid stroke="var(--color-border)" vertical={false} />
                <XAxis
                  dataKey="date"
                  tickFormatter={(d: string) => format(parseISO(d), "d MMM")}
                  ticks={[chart[0]!.date, chart[chart.length - 1]!.date]}
                  {...chartAxis}
                />
                <YAxis domain={["auto", "auto"]} {...chartAxis} />
                <Tooltip {...chartTooltip} content={<ProgressChartTooltip kind="strength" />} />
                <Line
                  type="monotone"
                  dataKey="value"
                  stroke="var(--color-primary)"
                  strokeWidth={2.5}
                  dot={{ r: 3 }}
                  isAnimationActive={false}
                />
              </LineChart>
            </ResponsiveContainer>
          ) : (
            <div className="grid h-full place-items-center rounded-[14px] bg-elevated text-center text-[13px] text-muted-foreground">
              One more session and your trend appears here.
            </div>
          )}
        </div>
      </Card>

      <p className="mx-1 text-[13px] font-medium text-muted-foreground">Best sets</p>
      <div className="num rounded-[20px] bg-card px-4">
        {bestSets.map((performance) => (
          <div
            key={performance.date}
            className="flex min-h-[52px] items-center gap-3 border-t border-border text-[15px] first:border-t-0"
          >
            <span className="flex-1">{workingPerformanceLabel(record, performance)}</span>
            <span className="text-[13px] text-muted-foreground">
              {format(parseISO(performance.date), "EEE d MMM")}
            </span>
            <span className="w-14 text-right text-[12px] font-semibold text-primary">
              {performance.date === recordDate ? "Record" : ""}
            </span>
          </div>
        ))}
      </div>
      {nextSuggestion ? (
        <p className="mx-1 text-[13px] text-muted-foreground">Next time: {nextSuggestion}</p>
      ) : null}
    </div>
  );
}

/**
 * Next-session suggestion. Reuses the existing own-mode progression verdict (`progressionFor`) for
 * its hint; otherwise shows the plan's rep range. It never invents a new progression engine.
 */
function nextSessionSuggestion(data: AppData, name: string): string | null {
  const workouts = Object.values(data.workouts)
    .filter(
      (workout) => workout.status !== "draft" && workout.entries.some((e) => e.exercise === name),
    )
    .sort((a, b) => b.date.localeCompare(a.date));
  const latest = workouts[0];
  if (latest) {
    const entry = latest.entries.find((e) => e.exercise === name);
    if (entry) {
      const result = progressionFor(data, entry, latest.date);
      if (result.hint) return result.hint;
    }
  }
  const def = exerciseDef(name);
  return def ? `aim for the top of your ${def.min}–${def.max} rep range, then add load.` : null;
}
