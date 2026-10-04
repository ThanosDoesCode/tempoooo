import { createFileRoute } from "@tanstack/react-router";
import { format, parseISO, subDays } from "date-fns";
import { useMemo } from "react";
import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import { AppShell } from "@/components/AppShell";
import { Card } from "@/components/ui-kit";
import { PeriodPicker, ProgressNav, ProgressRow } from "@/components/ProgressChrome";
import { chartAxis, chartTooltip, usePeriodWeeks } from "@/lib/progress-view";
import { avg7, calorieAdvice, fmt, fmt0, iso, latestWeight, mean, signed } from "@/lib/calc";
import { useAppData } from "@/lib/store";
import type { AppData } from "@/lib/types";

export const Route = createFileRoute("/_authenticated/bulk/progress_/body")({
  head: () => ({ meta: [{ title: "Tempo" }] }),
  component: BodyPage,
});

function BodyPage() {
  const data = useAppData();
  const [weeks, setWeeks] = usePeriodWeeks();
  return (
    <AppShell>
      <div className="mb-3 flex items-end justify-between">
        <h1 className="fade-up text-3xl font-semibold tracking-tight">Progress</h1>
        <PeriodPicker weeks={weeks} onChange={setWeeks} />
      </div>
      <ProgressNav active="body" />
      {data ? (
        <BodyFood data={data} weeks={weeks} />
      ) : (
        <div
          className="h-48 animate-pulse rounded-[20px] bg-card"
          aria-label="Loading body & food"
        />
      )}
    </AppShell>
  );
}

function BodyFood({ data, weeks }: { data: AppData; weeks: number }) {
  const latest = latestWeight(data);
  const rolling = latest ? avg7(data, latest.date) : null;
  const weekAgoAvg = latest ? avg7(data, iso(subDays(parseISO(latest.date), 7))) : null;
  const weekDelta = rolling != null && weekAgoAvg != null ? rolling - weekAgoAvg : null;
  const start = data.targets.startWeight;
  const target = data.targets.targetWeight;
  const gaining = target >= start;
  const remaining = latest ? target - latest.weight : null;
  const pct =
    latest && target !== start
      ? Math.max(0, Math.min(100, ((latest.weight - start) / (target - start)) * 100))
      : 0;

  const today = iso(new Date());
  const span = weeks * 7;
  const series = useMemo(
    () =>
      Array.from({ length: span }, (_, i) => {
        const d = iso(subDays(parseISO(today), span - 1 - i));
        return { date: d, avg: avg7(data, d) };
      }),
    [data, span, today],
  );
  const avgPoints = series.filter((p) => p.avg != null).length;

  // ---- Food, last N weeks ----
  const food = useMemo(() => {
    const cals: number[] = [];
    const macros = { protein: [] as number[], carbs: [] as number[], fat: [] as number[] };
    let onTarget = 0;
    for (let i = 0; i < span; i++) {
      const day = data.days[iso(subDays(parseISO(today), i))];
      if (day?.calories == null) continue;
      cals.push(day.calories);
      if (Math.abs(day.calories - data.targets.calories) <= data.targets.calories * 0.1)
        onTarget += 1;
      if (day.protein != null) macros.protein.push(day.protein);
      if (day.carbs != null) macros.carbs.push(day.carbs);
      if (day.fat != null) macros.fat.push(day.fat);
    }
    const avgMacro = (vals: number[]) => (vals.length ? Math.round(mean(vals) as number) : null);
    return {
      logged: cals.length,
      onTarget,
      avgKcal: cals.length ? Math.round(mean(cals) as number) : null,
      protein: avgMacro(macros.protein),
      carbs: avgMacro(macros.carbs),
      fat: avgMacro(macros.fat),
    };
  }, [data, span, today]);

  const photoCount = data.photos.length;
  const advice = calorieAdvice(data);

  return (
    <div className="space-y-3">
      <Card className="p-[18px]">
        <h2 className="text-[13px] font-medium text-muted-foreground">Weight · 7-day average</h2>
        {latest ? (
          <>
            <p className="num mt-1.5">
              <span className="text-[34px] font-semibold tracking-tight">{fmt(rolling, 1)} kg</span>
              {weekDelta != null ? (
                <span className="ml-2 text-sm font-semibold text-primary">
                  {signed(weekDelta, 1)} this week
                </span>
              ) : (
                <span className="ml-2 text-sm text-muted-foreground">calibrating</span>
              )}
            </p>
            <div className="mt-3 h-[120px]">
              {avgPoints >= 2 ? (
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={series} margin={{ top: 8, right: 6, left: -24, bottom: 0 }}>
                    <CartesianGrid stroke="var(--color-border)" vertical={false} />
                    <XAxis
                      dataKey="date"
                      tickFormatter={(d: string) => format(parseISO(d), "d MMM")}
                      ticks={[series[0]!.date, series[series.length - 1]!.date]}
                      {...chartAxis}
                    />
                    <YAxis domain={["auto", "auto"]} {...chartAxis} />
                    <Tooltip
                      {...chartTooltip}
                      labelFormatter={(d) => format(parseISO(String(d)), "d MMM")}
                      formatter={(value: number) => [`${fmt(value, 1)} kg`, "7-day avg"]}
                    />
                    <Area
                      type="monotone"
                      dataKey="avg"
                      stroke="var(--color-primary)"
                      strokeWidth={2.5}
                      fill="var(--color-primary)"
                      fillOpacity={0.12}
                      connectNulls
                    />
                  </AreaChart>
                </ResponsiveContainer>
              ) : (
                <div className="grid h-full place-items-center rounded-[14px] bg-elevated text-center text-[13px] text-muted-foreground">
                  A few more weigh-ins and your trend appears here.
                </div>
              )}
            </div>
            <div className="mt-2.5 flex justify-between text-sm">
              <span>Goal {fmt(target, 1)} kg</span>
              <span className="num text-muted-foreground">
                {remaining != null
                  ? `${fmt(Math.abs(remaining), 1)} kg ${gaining ? "to go" : "to lose"}`
                  : ""}
              </span>
            </div>
            <div className="mt-2 h-2 overflow-hidden rounded-full bg-elevated">
              <div className="h-full rounded-full bg-primary" style={{ width: `${pct}%` }} />
            </div>
          </>
        ) : (
          <p className="mt-1 text-sm text-muted-foreground">
            No weigh-ins yet. Log your morning weight for a few days to see your 7-day average.
          </p>
        )}
      </Card>

      <Card className="p-[18px]">
        <h2 className="text-[13px] font-medium text-muted-foreground">Food · last {weeks} weeks</h2>
        {food.logged ? (
          <>
            <div className="num mt-2 grid grid-cols-2 gap-3">
              <div>
                <div className="text-2xl font-semibold">
                  {food.onTarget} of {food.logged}
                </div>
                <div className="text-[13px] text-muted-foreground">days on calorie target</div>
              </div>
              <div>
                <div className="text-2xl font-semibold">{fmt0(food.avgKcal)}</div>
                <div className="text-[13px] text-muted-foreground">
                  kcal a day · target {fmt0(data.targets.calories)}
                </div>
              </div>
            </div>
            <p className="num mt-2.5 text-[13px] text-muted-foreground">
              Protein {food.protein ?? "—"} g · carbs {food.carbs ?? "—"} g · fat {food.fat ?? "—"}{" "}
              g a day
            </p>
          </>
        ) : (
          <p className="mt-1 text-sm text-muted-foreground">No days logged yet.</p>
        )}
      </Card>

      <div className="rounded-[20px] bg-card px-4">
        <ProgressRow to="/bulk/progress/body/food" label="Food details" />
        <ProgressRow
          to="/bulk/check-in"
          label="Weekly review"
          hint={advice.decision.startsWith("Keep") ? "On track" : "Review suggested"}
        />
        <ProgressRow
          to="/bulk/progress/photos"
          label="Progress photos"
          hint={`${photoCount} photo${photoCount === 1 ? "" : "s"}`}
        />
      </div>
    </div>
  );
}
