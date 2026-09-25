import { useMemo } from "react";
import { addDays, format } from "date-fns";
import { Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { Card, SectionTitle } from "@/components/ui-kit";
import { localDay } from "@/lib/bulk-progress";
import { useBulkWeights } from "@/lib/bulk-progress-query";
import { useGoalSettingsDashboard } from "@/lib/goal-settings-dashboard";
import { buildCheckInConsistency } from "@/lib/goal-check-in-consistency";

/** 30-day daily weight chart, moved from Goal Settings. */
export function ThirtyDayWeightCard({ profileId }: { profileId: string }) {
  const weights = useBulkWeights(profileId, localDay(addDays(new Date(), -30)));
  const points = useMemo(
    () => [...(weights.data ?? [])].sort((a, b) => a.logDate.localeCompare(b.logDate)),
    [weights.data],
  );
  const first = points[0];
  const last = points.at(-1);
  return (
    <Card>
      <SectionTitle>30-day weight</SectionTitle>
      {weights.isLoading ? (
        <div className="h-28 animate-pulse rounded-xl bg-elevated" />
      ) : weights.error ? (
        <button
          className="min-h-11 text-sm font-semibold text-danger"
          onClick={() => void weights.refetch()}
        >
          Weight could not load. Retry
        </button>
      ) : !first || !last ? (
        <p className="text-sm text-muted-foreground">
          Log weight in Goal Today to start your 30-day trend.
        </p>
      ) : (
        <div>
          <div className="flex items-end justify-between gap-3">
            <p className="num text-2xl font-semibold">{last.weightKg.toFixed(1)} kg</p>
            <p className="text-xs text-muted-foreground">
              {points.length > 1
                ? `${last.weightKg - first.weightKg >= 0 ? "+" : ""}${(last.weightKg - first.weightKg).toFixed(1)} kg in 30 days`
                : "One measurement"}
            </p>
          </div>
          {points.length > 1 ? (
            <div className="mt-3 h-28" aria-label="30-day weight trend chart">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={points} margin={{ top: 8, right: 4, bottom: 0, left: -24 }}>
                  <XAxis
                    dataKey="logDate"
                    tickFormatter={(value) => format(new Date(`${value}T12:00:00`), "d MMM")}
                    tick={{ fontSize: 10 }}
                  />
                  <YAxis domain={["dataMin - 1", "dataMax + 1"]} tick={{ fontSize: 10 }} />
                  <Tooltip
                    labelFormatter={(value) => format(new Date(`${value}T12:00:00`), "d MMM yyyy")}
                    formatter={(value) => [`${Number(value).toFixed(1)} kg`, "Weight"]}
                  />
                  <Line
                    type="monotone"
                    dataKey="weightKg"
                    stroke="var(--primary)"
                    strokeWidth={2}
                    dot={false}
                    isAnimationActive={false}
                  />
                </LineChart>
              </ResponsiveContainer>
            </div>
          ) : null}
        </div>
      )}
    </Card>
  );
}

/** Eight-week check-in consistency, moved from Goal Settings. */
export function CheckInConsistencyCard({ profileId }: { profileId: string }) {
  const dashboard = useGoalSettingsDashboard(profileId);
  const today = localDay(new Date());
  const weeks = useMemo(
    () =>
      dashboard.data
        ? buildCheckInConsistency(
            dashboard.data.goalStartedAt,
            dashboard.data.completedWeekStarts,
            today,
          )
        : [],
    [dashboard.data, today],
  );
  return (
    <Card>
      <SectionTitle>Weekly check-ins</SectionTitle>
      {dashboard.isLoading ? (
        <div className="h-14 animate-pulse rounded-xl bg-elevated" />
      ) : dashboard.error ? (
        <button
          className="min-h-11 text-sm font-semibold text-danger"
          onClick={() => void dashboard.refetch()}
        >
          Check-ins could not load. Retry
        </button>
      ) : (
        <div className="grid grid-cols-8 gap-1" aria-label="Previous eight weekly check-ins">
          {weeks.map((week) => (
            <div key={week.weekStart} className="text-center">
              <span
                role="img"
                aria-label={`${week.label}: ${week.status.replace("-", " ")}`}
                className={`mx-auto block h-4 w-4 rounded-full ${week.status === "completed" ? "bg-primary" : week.status === "missed" ? "bg-danger/80" : week.status === "current-incomplete" ? "border-2 border-primary" : "bg-muted"}`}
              />
              <span className="mt-1 block text-[9px] text-muted-foreground">{week.label}</span>
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}
