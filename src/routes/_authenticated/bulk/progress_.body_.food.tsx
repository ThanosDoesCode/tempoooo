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
import { ProgressRow } from "@/components/ProgressChrome";
import { chartAxis, chartTooltip } from "@/lib/progress-view";
import { fmt0 } from "@/lib/calc";
import { useFoodModel } from "@/lib/progress-model";

export const Route = createFileRoute("/_authenticated/bulk/progress_/body_/food")({
  head: () => ({ meta: [{ title: "Tempo" }] }),
  component: FoodDetailsPage,
});

function FoodDetailsPage() {
  const food = useFoodModel(7);
  const chart = food.week7.map((d) => ({
    label: format(parseISO(d.date), "EEE"),
    calories: d.calories ?? 0,
    on: d.onTarget,
  }));

  return (
    <AppShell>
      <PageHeader title="Food details" backTo="/bulk/progress/body" backLabel="Body & food" />
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
              Target {fmt0(food.target)}
              {food.loggedDays
                ? ` · on target ${food.onTargetDays} of ${food.loggedDays} day${
                    food.loggedDays === 1 ? "" : "s"
                  }`
                : " · no days logged yet"}
            </p>
            <div className="mt-3.5 h-[110px]">
              {food.loggedDays ? (
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={chart} margin={{ top: 8, right: 6, left: -24, bottom: 0 }}>
                    <CartesianGrid stroke="var(--color-border)" vertical={false} />
                    <XAxis dataKey="label" {...chartAxis} />
                    <YAxis {...chartAxis} />
                    <Tooltip {...chartTooltip} />
                    <Bar dataKey="calories" radius={[6, 6, 0, 0]} name="kcal">
                      {chart.map((d) => (
                        <Cell
                          key={d.label}
                          fill={d.on ? "var(--color-primary)" : "var(--color-muted)"}
                        />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              ) : (
                <div className="grid h-full place-items-center rounded-[14px] bg-elevated text-center text-[13px] text-muted-foreground">
                  Log meals to see your week against the target.
                </div>
              )}
            </div>
          </Card>

          <Card className="num flex justify-between p-[18px] text-sm text-muted-foreground">
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
                  to="/bulk/meals/history"
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
