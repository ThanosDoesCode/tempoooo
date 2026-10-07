import { createFileRoute, Link } from "@tanstack/react-router";
import { format, parseISO } from "date-fns";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import { AppShell, PageHeader } from "@/components/AppShell";
import { Card } from "@/components/ui-kit";
import { ProgressChartTooltip } from "@/components/ProgressChartTooltip";
import { PeriodPicker, ProgressRow } from "@/components/ProgressChrome";
import { chartAxis, chartTooltip, useProgressPeriod } from "@/lib/progress-view";
import { progressRange, progressPeriodLabel } from "@/lib/progress-period";
import { fmt0 } from "@/lib/calc";
import { nutritionCalendarSlots } from "@/lib/progress-model-core";
import { useFoodModel } from "@/lib/progress-model";

export const Route = createFileRoute("/_authenticated/bulk/progress_/body_/food")({
  head: () => ({ meta: [{ title: "Tempo" }] }),
  component: FoodDetailsPage,
});

function FoodDetailsPage() {
  const [period, setPeriod] = useProgressPeriod();
  const food = useFoodModel(progressRange(period));
  const chart = nutritionCalendarSlots(food.series, progressRange(period)).map((day) => ({
    ...day,
    plotCalories: day.calories ?? 0,
    on: day.onTarget,
  }));

  return (
    <AppShell>
      <PageHeader title="Food details" backTo="/bulk/progress/body" backLabel="Body & food" />
      <div className="mb-3 flex justify-end">
        <PeriodPicker period={period} onChange={setPeriod} />
      </div>
      {food.loading ? (
        <div className="h-48 animate-pulse rounded-[20px] bg-card" aria-label="Loading food" />
      ) : (
        <div className="space-y-3">
          <Card className="p-[18px]">
            <p className="num">
              <span className="text-[34px] font-semibold tracking-tight">
                {food.avgKcal != null ? fmt0(food.avgKcal) : "—"}
              </span>
              <span className="text-base text-muted-foreground"> kcal a day on average</span>
            </p>
            <p className="mt-1 text-sm text-muted-foreground">
              {progressPeriodLabel(period)} · Current target {fmt0(food.target)}
              {(food.knownTargetDays ?? food.loggedDays)
                ? ` · on target ${food.onTargetDays} of ${food.knownTargetDays ?? food.loggedDays} day${
                    (food.knownTargetDays ?? food.loggedDays) === 1 ? "" : "s"
                  }`
                : food.loggedDays
                  ? " · historical targets unavailable"
                  : " · no days logged yet"}
            </p>
            <div className="mt-3.5 h-[170px]">
              {food.loggedDays ? (
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={chart} margin={{ top: 8, right: 6, left: -24, bottom: 0 }}>
                    <CartesianGrid stroke="var(--color-border)" vertical={false} />
                    <XAxis
                      dataKey="date"
                      tickFormatter={(date: string) => format(parseISO(date), "d MMM")}
                      {...chartAxis}
                      minTickGap={30}
                    />
                    <YAxis {...chartAxis} />
                    <Tooltip
                      {...chartTooltip}
                      filterNull={false}
                      content={<ProgressChartTooltip kind="food" />}
                    />
                    <Bar
                      dataKey="plotCalories"
                      radius={[6, 6, 0, 0]}
                      name="Calories"
                      isAnimationActive={false}
                    >
                      {chart.map((d) => (
                        <Cell
                          key={d.date}
                          fill={d.on ? "var(--color-primary)" : "var(--color-muted)"}
                        />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              ) : (
                <div className="grid h-full place-items-center rounded-[14px] bg-elevated text-center text-[13px] text-muted-foreground">
                  Log meals to see this period against your daily targets.
                </div>
              )}
            </div>
          </Card>

          <Card className="num grid grid-cols-1 gap-2 p-[18px] text-sm text-muted-foreground min-[360px]:grid-cols-3">
            <span>
              Protein <b className="text-foreground">{food.protein ?? "—"}</b> g
            </span>
            <span>
              Carbs <b className="text-foreground">{food.carbs ?? "—"}</b> g
            </span>
            <span>
              Fat <b className="text-foreground">{food.fat ?? "—"}</b> g
            </span>
          </Card>

          <p className="mx-1 text-[13px] font-medium text-muted-foreground">Past days</p>
          <div className="rounded-[20px] bg-card px-4">
            {food.past.length ? (
              food.past.map((d) => (
                <Link
                  key={d.date}
                  to="/bulk/meals"
                  search={{ date: d.date }}
                  preload="intent"
                  className="flex min-h-[50px] items-center gap-3 border-t border-border text-[15px] first:border-t-0 active:opacity-80"
                >
                  <span className="flex-1">{format(parseISO(d.date), "EEEE d MMM")}</span>
                  <span className="num text-muted-foreground">{fmt0(d.calories)} kcal</span>
                </Link>
              ))
            ) : (
              <p className="py-4 text-sm text-muted-foreground">No logged days yet.</p>
            )}
            <ProgressRow to="/bulk/meals/history" label="Nutrition history" />
          </div>
        </div>
      )}
    </AppShell>
  );
}
