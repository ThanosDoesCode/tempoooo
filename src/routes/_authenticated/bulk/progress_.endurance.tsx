import { useState } from "react";
import { format, parseISO } from "date-fns";
import { Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { chartAxis, useProgressPeriod } from "@/lib/progress-view";
import { createFileRoute, Link } from "@tanstack/react-router";

import { AppShell } from "@/components/AppShell";
import { Card, DataError } from "@/components/ui-kit";
import { ProgressHeader, PeriodPicker, ProgressNav } from "@/components/ProgressChrome";
import { fmt, fmt0 } from "@/lib/calc";
import { useAuth } from "@/lib/auth";
import { formatPace, useEnduranceActivities, useMyChallenge } from "@/lib/challenge";
import {
  runningPeriodStats,
  cyclingPeriodStats,
  rawWeeklyDistance,
} from "@/lib/endurance-progress";
import { progressRange, previousProgressRange } from "@/lib/progress-period";

export const Route = createFileRoute("/_authenticated/bulk/progress_/endurance")({
  head: () => ({ meta: [{ title: "Tempo" }] }),
  component: EndurancePage,
});

function EndurancePage() {
  const [period, setPeriod] = useProgressPeriod();
  const selectedRange = progressRange(period);
  const previousRange = previousProgressRange(period);
  const { user } = useAuth();
  const challenge = useMyChallenge();
  const challengeId = challenge.data?.id;
  // Both types already share this exhaustive, RLS-scoped activity query. Include the
  // previous period for comparisons; All time starts at the actual Challenge start.
  const range = challenge.data
    ? {
        start: previousRange?.start ?? selectedRange.start ?? challenge.data.start_date,
        end: selectedRange.end,
      }
    : null;
  const activities = useEnduranceActivities(challengeId, range);
  return (
    <AppShell>
      <ProgressHeader>
        <PeriodPicker period={period} onChange={setPeriod} />
      </ProgressHeader>
      <ProgressNav active="endurance" />
      {challenge.error || activities.error ? (
        <DataError
          message="Could not load your activities. Please retry."
          onRetry={() => void (challenge.error ? challenge.refetch() : activities.refetch())}
        />
      ) : challenge.isLoading ? (
        <div className="h-48 animate-pulse rounded-[20px] bg-card" aria-label="Loading endurance" />
      ) : !challenge.data ? (
        <Card className="p-[18px]">
          <p className="text-[15px] font-medium">No challenge yet</p>
          <p className="mt-1 text-sm text-muted-foreground">
            Start a challenge to unlock endurance trends.
          </p>
          <Link
            to="/challenge"
            preload="intent"
            className="mt-3 inline-flex min-h-11 items-center rounded-xl bg-primary px-4 text-sm font-semibold text-primary-foreground"
          >
            Start a challenge
          </Link>
        </Card>
      ) : !user || activities.isLoading ? (
        <div className="h-48 animate-pulse rounded-[20px] bg-card" aria-label="Loading endurance" />
      ) : (
        <EnduranceBody
          runs={runningPeriodStats(activities.data ?? [], user.id, selectedRange, previousRange)}
          rides={cyclingPeriodStats(activities.data ?? [], user.id, selectedRange, previousRange)}
          weekly={{
            run: rawWeeklyDistance(activities.data ?? [], user.id, selectedRange, "run"),
            ride: rawWeeklyDistance(activities.data ?? [], user.id, selectedRange, "cycle"),
          }}
        />
      )}
    </AppShell>
  );
}

type ActivityMode = "run" | "ride";
type TrendPoint = {
  id: string;
  date: string;
  distanceKm: number;
  durationSeconds: number;
  pace?: number;
  speed?: number;
};
export function EnduranceBody({
  runs,
  rides,
  weekly,
}: {
  runs: ReturnType<typeof runningPeriodStats>;
  rides: ReturnType<typeof cyclingPeriodStats>;
  weekly: Record<ActivityMode, ReturnType<typeof rawWeeklyDistance>>;
}) {
  const [mode, setMode] = useState<ActivityMode>("run");
  const [selectedIds, setSelectedIds] = useState<Partial<Record<ActivityMode, string>>>({});
  const [selectedWeek, setSelectedWeek] = useState<string | null>(null);
  const [weekOffset, setWeekOffset] = useState<number | null>(null);
  const riding = mode === "ride";
  const points: TrendPoint[] = riding ? rides.points : runs.points;
  const point = points.find((p) => p.id === selectedIds[mode]) ?? points.at(-1);
  const pointIndex = point ? points.indexOf(point) : -1;
  const count = riding ? rides.rides : runs.runs;
  const activityLabel = riding ? "ride" : "run";
  const choosePoint = (id: string) => setSelectedIds((old) => ({ ...old, [mode]: id }));
  const metric = riding ? rides.speed : runs.pace;
  const formatMetric = (value: number) => (riding ? `${fmt(value, 1)} km/h` : formatPace(value));
  const weeks = weekly[mode];
  // Four accessible bars per page fit 320px without a horizontal scroll strip.
  const lastOffset = Math.max(0, weeks.bars.length - 4);
  const offset = Math.min(weekOffset ?? lastOffset, lastOffset);
  const visibleWeeks = weeks.bars.slice(offset, offset + 4);
  const week = visibleWeeks.find((bar) => bar.date === selectedWeek);
  const maxBar = Math.max(...visibleWeeks.map((bar) => bar.distanceKm), 1) * 1.1;
  const change = riding ? rides.speedChange : runs.paceChange;
  const selectMode = (next: ActivityMode) => {
    setMode(next);
    setSelectedWeek(null);
    setWeekOffset(null);
  };

  return (
    <div className="min-w-0 space-y-3">
      <div
        className="grid grid-cols-2 gap-1 rounded-[13px] bg-card p-1"
        role="group"
        aria-label="Activity type"
      >
        {(["run", "ride"] as const).map((value) => (
          <button
            key={value}
            type="button"
            aria-pressed={mode === value}
            onClick={() => selectMode(value)}
            className={`min-h-11 min-w-0 rounded-[10px] px-3 text-sm font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary ${mode === value ? "bg-elevated text-primary" : "text-muted-foreground"}`}
          >
            {value === "run" ? "Run" : "Ride"}
          </button>
        ))}
      </div>
      {!count ? (
        <Card className="p-[18px]">
          <p className="text-[15px] font-medium">{riding ? "No rides yet" : "No runs yet"}</p>
          <p className="mt-1 text-sm text-muted-foreground">
            Log a {activityLabel} from the + button to see your progress.
          </p>
        </Card>
      ) : (
        <>
          <Card className="min-w-0 p-[18px]">
            <h2 className="text-[13px] font-medium text-muted-foreground">
              Weekly {riding ? "cycling" : "running"} distance
            </h2>
            <p className="num mt-1 text-[28px] font-semibold tracking-tight sm:text-[34px]">
              {fmt(weeks.kmPerWeek, 1)} km/week
            </p>
            <div
              className="mt-3 grid grid-cols-4 items-end gap-1.5"
              role="group"
              aria-label={`Weekly ${riding ? "cycling" : "running"} distance in raw kilometres`}
            >
              {visibleWeeks.map((bar) => (
                <button
                  key={bar.date}
                  type="button"
                  className={`min-h-11 min-w-0 rounded-lg text-center focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary ${selectedWeek === bar.date ? "bg-primary/10 ring-1 ring-primary/50" : "hover:bg-elevated"}`}
                  aria-label={`${format(parseISO(bar.date), "d MMM")}: ${fmt(bar.distanceKm, 1)} km, ${bar.count} ${activityLabel}${bar.count === 1 ? "" : "s"}`}
                  aria-pressed={selectedWeek === bar.date}
                  onClick={() => setSelectedWeek(bar.date)}
                  onFocus={() => setSelectedWeek(bar.date)}
                  onMouseEnter={() => setSelectedWeek(bar.date)}
                >
                  <span className="num block text-[11px] font-semibold">
                    {fmt(bar.distanceKm, 1)}
                  </span>
                  <span
                    className="mt-1 flex h-32 items-end rounded-lg bg-elevated/50"
                    aria-hidden="true"
                  >
                    <span
                      className="w-full rounded-t-lg bg-primary/80"
                      style={{ height: `${(bar.distanceKm / maxBar) * 100}%` }}
                    />
                  </span>
                  <span className="mt-1 block whitespace-nowrap text-[10px] text-muted-foreground">
                    {format(parseISO(bar.date), "d MMM")}
                  </span>
                </button>
              ))}
            </div>
            {weeks.bars.length > 4 ? (
              <div className="mt-2 flex items-center justify-between gap-2">
                <button
                  type="button"
                  aria-label="Previous weeks"
                  disabled={offset === 0}
                  onClick={() => {
                    setWeekOffset(Math.max(0, offset - 4));
                    setSelectedWeek(null);
                  }}
                  className="inline-flex min-h-11 items-center gap-1 rounded-lg px-2 text-sm text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary disabled:opacity-40"
                >
                  <ChevronLeft className="h-5 w-5" aria-hidden="true" />
                  Earlier
                </button>
                <button
                  type="button"
                  aria-label="Next weeks"
                  disabled={offset === lastOffset}
                  onClick={() => {
                    setWeekOffset(Math.min(lastOffset, offset + 4));
                    setSelectedWeek(null);
                  }}
                  className="inline-flex min-h-11 items-center gap-1 rounded-lg px-2 text-sm text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary disabled:opacity-40"
                >
                  Later
                  <ChevronRight className="h-5 w-5" aria-hidden="true" />
                </button>
              </div>
            ) : null}
            {week ? (
              <div className="num mt-2 rounded-xl bg-elevated px-3 py-2 text-sm" aria-live="polite">
                <p className="font-medium">Week of {format(parseISO(week.date), "d MMM")}</p>
                <p className="mt-0.5 text-muted-foreground">
                  {fmt(week.distanceKm, 1)} km · {week.count} {activityLabel}
                  {week.count === 1 ? "" : "s"}
                </p>
              </div>
            ) : null}
          </Card>

          <Card className="min-w-0 p-[18px]">
            <h2 className="text-[13px] font-medium text-muted-foreground">
              {riding ? "Average speed" : "Average pace"}
            </h2>
            {metric != null ? (
              <>
                <p className="num mt-1.5 text-[28px] font-semibold">{formatMetric(metric)}</p>
                <p className="mt-1 text-sm text-muted-foreground">
                  Across {points.length} timed {activityLabel}
                  {points.length === 1 ? "" : "s"}
                </p>
                <p className="sr-only">
                  {riding
                    ? "Total timed distance divided by total recorded duration. Each chart point is one timed ride."
                    : "Distance-weighted average. Each chart point is one timed run."}
                </p>
                {change != null ? (
                  <p className="mt-1 text-sm text-muted-foreground">
                    {riding
                      ? Math.abs(change) < 0.05
                        ? "Same speed as previous period"
                        : `${fmt(Math.abs(change), 1)} km/h ${change > 0 ? "faster" : "slower"} than previous period`
                      : Math.abs(change) < 1
                        ? "Same pace as previous period"
                        : `${fmt0(Math.abs(change))} sec/km ${change > 0 ? "faster" : "slower"} than previous period`}
                  </p>
                ) : null}
                {points.length >= 2 ? (
                  <div className="mt-3">
                    <p className="text-[10px] text-muted-foreground" aria-hidden="true">
                      {riding ? "km/h" : "min/km"}
                    </p>
                    <div
                      className="h-40"
                      role="group"
                      aria-label={
                        riding
                          ? "Speed of each timed ride, faster speed higher"
                          : "Pace of each timed run, faster pace higher"
                      }
                    >
                      <ResponsiveContainer width="100%" height="100%">
                        <LineChart
                          key={mode}
                          data={points}
                          margin={{ top: 8, right: 8, left: -12, bottom: 0 }}
                          accessibilityLayer
                          onClick={(state) => {
                            const selected = state?.activePayload?.[0]?.payload;
                            if (selected?.id) choosePoint(selected.id);
                          }}
                        >
                          <XAxis
                            dataKey="date"
                            tickFormatter={(date: string) => format(parseISO(date), "d MMM")}
                            {...chartAxis}
                            minTickGap={30}
                          />
                          <YAxis
                            {...chartAxis}
                            reversed={!riding}
                            tickFormatter={(value: number) =>
                              riding ? fmt(value, 1) : formatPace(value).replace(" min/km", "")
                            }
                            width={55}
                            domain={riding ? ["auto", "auto"] : ["dataMin - 10", "dataMax + 10"]}
                          />
                          <Tooltip content={() => null} cursor={false} isAnimationActive={false} />
                          <Line
                            dataKey={riding ? "speed" : "pace"}
                            activeDot={false}
                            stroke="var(--color-primary)"
                            strokeWidth={2}
                            dot={({
                              cx,
                              cy,
                              payload,
                            }: {
                              cx?: number;
                              cy?: number;
                              payload?: TrendPoint;
                            }) => (
                              <g
                                key={payload?.id}
                                role="button"
                                tabIndex={0}
                                className="group cursor-pointer outline-none"
                                aria-label={
                                  payload
                                    ? `${format(parseISO(payload.date), "d MMM")}, ${formatMetric((riding ? payload.speed : payload.pace)!)}, select ${activityLabel}`
                                    : `Select ${activityLabel}`
                                }
                                aria-pressed={payload?.id === point?.id}
                                onClick={(event) => {
                                  event.stopPropagation();
                                  if (payload) choosePoint(payload.id);
                                }}
                                onKeyDown={(event) => {
                                  if (event.key === "Enter" || event.key === " ") {
                                    event.preventDefault();
                                    if (payload) choosePoint(payload.id);
                                  }
                                }}
                              >
                                <circle cx={cx} cy={cy} r={22} fill="transparent" />
                                <circle
                                  cx={cx}
                                  cy={cy}
                                  r={payload?.id === point?.id ? 6 : 3}
                                  fill="var(--color-primary)"
                                  stroke="var(--color-card)"
                                  strokeWidth={2}
                                  className="group-focus-visible:stroke-foreground"
                                />
                              </g>
                            )}
                            isAnimationActive={false}
                          />
                        </LineChart>
                      </ResponsiveContainer>
                    </div>
                  </div>
                ) : null}
                {point ? (
                  <div className="mt-3 rounded-xl bg-elevated px-3 py-2" aria-live="polite">
                    <div className="flex items-center justify-between gap-2">
                      <p className="text-sm font-medium">{format(parseISO(point.date), "d MMM")}</p>
                      {points.length > 1 ? (
                        <div className="flex shrink-0 gap-1">
                          <button
                            type="button"
                            aria-label={`Previous ${activityLabel}`}
                            disabled={pointIndex === 0}
                            onClick={() => choosePoint(points[pointIndex - 1]!.id)}
                            className="grid h-11 w-11 place-items-center rounded-lg hover:bg-card focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary disabled:opacity-40"
                          >
                            <ChevronLeft className="h-5 w-5" aria-hidden="true" />
                          </button>
                          <button
                            type="button"
                            aria-label={`Next ${activityLabel}`}
                            disabled={pointIndex === points.length - 1}
                            onClick={() => choosePoint(points[pointIndex + 1]!.id)}
                            className="grid h-11 w-11 place-items-center rounded-lg hover:bg-card focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary disabled:opacity-40"
                          >
                            <ChevronRight className="h-5 w-5" aria-hidden="true" />
                          </button>
                        </div>
                      ) : null}
                    </div>
                    <p className="num break-words text-sm text-muted-foreground">
                      {fmt(point.distanceKm, riding ? 2 : 1)} km ·{" "}
                      {formatMetric((riding ? point.speed : point.pace)!)} ·{" "}
                      {formatActivityDuration(point.durationSeconds, mode)}
                    </p>
                  </div>
                ) : null}
              </>
            ) : (
              <p className="mt-2 text-sm text-muted-foreground">No timed {activityLabel}s yet</p>
            )}
          </Card>

          <Card className="grid grid-cols-2 gap-x-3 gap-y-4 p-[18px]">
            <Stat value={String(count)} label={riding ? "Rides" : "Runs"} />
            <Stat
              value={`${fmt(riding ? rides.distanceKm : runs.distanceKm, 1)} km`}
              label={riding ? "Cycling distance" : "Running distance"}
            />
            <Stat
              value={`${fmt(riding ? rides.longestRideKm : runs.longestRunKm, 1)} km`}
              label={riding ? "Longest ride" : "Longest run"}
            />
            {(riding ? rides.ridesPerWeek : runs.runsPerWeek) != null ? (
              <Stat
                value={fmt(riding ? rides.ridesPerWeek : runs.runsPerWeek, 1)}
                label={riding ? "Rides per week" : "Runs per week"}
              />
            ) : null}
            {(riding ? rides.durationSeconds : runs.durationSeconds) != null ? (
              <Stat
                value={formatActivityDuration(
                  (riding ? rides.durationSeconds : runs.durationSeconds)!,
                  mode,
                )}
                label={
                  riding
                    ? rides.untimedRides
                      ? "Cycling time · timed rides"
                      : "Cycling time"
                    : "Running time"
                }
              />
            ) : null}
          </Card>
        </>
      )}
      <Link
        to="/challenge"
        preload="intent"
        className="inline-flex min-h-11 items-center text-sm font-medium text-primary"
      >
        Challenge targets and standings
      </Link>
    </div>
  );
}

function Stat({ value, label }: { value: string; label: string }) {
  return (
    <div className="min-w-0">
      <div className="num break-words text-[19px] font-semibold">{value}</div>
      <div className="mt-0.5 text-[12px] text-muted-foreground">{label}</div>
    </div>
  );
}
function formatActivityDuration(seconds: number, mode: ActivityMode) {
  const rounded = Math.round(seconds);
  const minutes = Math.floor(rounded / 60);
  if (mode === "run")
    return minutes >= 60
      ? `${Math.floor(minutes / 60)} h ${minutes % 60} min`
      : `${minutes}:${String(rounded % 60).padStart(2, "0")}`;
  const parts = [
    minutes >= 60 ? `${Math.floor(minutes / 60)} h` : "",
    minutes > 0 ? `${minutes % 60} min` : "",
    rounded % 60 ? `${rounded % 60} s` : "",
  ].filter(Boolean);
  return parts.join(" ");
}
