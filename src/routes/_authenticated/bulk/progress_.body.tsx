import { createFileRoute } from "@tanstack/react-router";
import { format, parseISO } from "date-fns";
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
import {
  ProgressHeader,
  PeriodPicker,
  ProgressNav,
  ProgressRow,
} from "@/components/ProgressChrome";
import { fmt, fmt0, signed } from "@/lib/calc";
import { chartAxis, chartTooltip, usePeriodWeeks } from "@/lib/progress-view";
import { useFoodModel, usePhotoCount, useWeightModel } from "@/lib/progress-model";

export const Route = createFileRoute("/_authenticated/bulk/progress_/body")({
  head: () => ({ meta: [{ title: "Tempo" }] }),
  component: BodyPage,
});

function BodyPage() {
  const [weeks, setWeeks] = usePeriodWeeks();
  const weight = useWeightModel(weeks * 7);
  const food = useFoodModel(weeks * 7);
  const photoCount = usePhotoCount();

  return (
    <AppShell>
      <ProgressHeader>
        <PeriodPicker weeks={weeks} onChange={setWeeks} />
      </ProgressHeader>
      <ProgressNav active="body" />

      {weight.loading && food.loading ? (
        <div
          className="h-48 animate-pulse rounded-[20px] bg-card"
          aria-label="Loading body & food"
        />
      ) : (
        <div className="space-y-3">
          <Card className="px-[18px] py-4">
            <h2 className="text-[13px] font-medium text-muted-foreground">
              Weight · 7-day average
            </h2>
            {weight.hasData ? (
              <>
                <p className="num mt-1.5">
                  <span className="text-[34px] font-semibold tracking-tight">
                    {fmt(weight.avgKg, 1)} kg
                  </span>
                  {weight.weekDeltaKg != null ? (
                    <span className="ml-2 text-sm font-semibold text-primary">
                      {signed(weight.weekDeltaKg, 1)} this week
                    </span>
                  ) : (
                    <span className="ml-2 text-sm text-muted-foreground">calibrating</span>
                  )}
                </p>
                <div className="mt-3 h-[120px]">
                  {weight.points >= 2 ? (
                    <ResponsiveContainer width="100%" height="100%">
                      <AreaChart
                        data={weight.series}
                        margin={{ top: 8, right: 6, left: -24, bottom: 0 }}
                      >
                        <CartesianGrid stroke="var(--color-border)" vertical={false} />
                        <XAxis
                          dataKey="date"
                          tickFormatter={(d: string) => format(parseISO(d), "d MMM")}
                          ticks={[
                            weight.series[0]!.date,
                            weight.series[weight.series.length - 1]!.date,
                          ]}
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
                  <span>Goal {fmt(weight.goal.target, 1)} kg</span>
                  <span className="num text-muted-foreground">
                    {weight.goal.remainingKg != null
                      ? `${fmt(Math.abs(weight.goal.remainingKg), 1)} kg ${
                          weight.goal.gaining ? "to go" : "to lose"
                        }`
                      : ""}
                  </span>
                </div>
                <div className="mt-2 h-2 overflow-hidden rounded-full bg-elevated">
                  <div
                    className="h-full rounded-full bg-primary"
                    style={{ width: `${weight.goal.pct}%` }}
                  />
                </div>
              </>
            ) : (
              <p className="mt-1 text-sm text-muted-foreground">
                No weigh-ins yet. Log your morning weight for a few days to see your 7-day average.
              </p>
            )}
          </Card>

          <Card className="px-[18px] py-4">
            <h2 className="text-[13px] font-medium text-muted-foreground">
              Food · last {weeks} weeks
            </h2>
            {food.loggedDays ? (
              <>
                <div className="num mt-2 grid grid-cols-2 gap-3">
                  <div>
                    <div className="text-2xl font-semibold">
                      {food.onTargetDays} of {food.loggedDays}
                    </div>
                    <div className="text-[13px] text-muted-foreground">days on calorie target</div>
                  </div>
                  <div>
                    <div className="text-2xl font-semibold">{fmt0(food.avgKcal)}</div>
                    <div className="text-[13px] text-muted-foreground">
                      kcal a day · target {fmt0(food.target)}
                    </div>
                  </div>
                </div>
                <p className="num mt-2.5 text-[13px] text-muted-foreground">
                  Protein {food.protein ?? "—"} g · carbs {food.carbs ?? "—"} g · fat{" "}
                  {food.fat ?? "—"} g a day
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
              hint={`${fmt0(food.target)} kcal`}
            />
            <ProgressRow
              to="/bulk/progress/photos"
              label="Progress photos"
              hint={`${photoCount} photo${photoCount === 1 ? "" : "s"}`}
            />
          </div>
        </div>
      )}
    </AppShell>
  );
}
