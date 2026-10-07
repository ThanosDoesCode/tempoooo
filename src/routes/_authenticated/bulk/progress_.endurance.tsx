import { useState } from "react";
import { format, parseISO } from "date-fns";
import { Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { ProgressChartTooltip } from "@/components/ProgressChartTooltip";
import { NativeSelect } from "@/components/ui/native-select";
import { chartAxis, chartTooltip } from "@/lib/progress-view";
import { createFileRoute, Link } from "@tanstack/react-router";

import { AppShell } from "@/components/AppShell";
import { Card } from "@/components/ui-kit";
import { ProgressHeader, PeriodPicker, ProgressNav } from "@/components/ProgressChrome";
import { useProgressPeriod } from "@/lib/progress-view";
import { fmt, fmt0 } from "@/lib/calc";
import { useAuth } from "@/lib/auth";
import {
  eur,
  formatPace,
  useChallengeMembers,
  useEnduranceActivities,
  useMyChallenge,
  usePayments,
  useWeeks,
} from "@/lib/challenge";
import { enduranceSummary, runningPeriodStats, rivalComparison } from "@/lib/endurance-progress";

import { progressRange, previousProgressRange, progressPeriodLabel } from "@/lib/progress-period";

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
  const weekRows = useWeeks(challengeId);
  const members = useChallengeMembers(challengeId);
  const payments = usePayments(challengeId);
  // Pace/longest-run use every qualifying activity in the selected period, not the recent feed.
  // All time begins at the real challenge start; finite ranges also include the previous comparison period.
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

      {challenge.isLoading ? (
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
      ) : !user || !weekRows.data ? (
        <div className="h-48 animate-pulse rounded-[20px] bg-card" aria-label="Loading endurance" />
      ) : (
        <EnduranceBody
          summary={enduranceSummary(weekRows.data, user.id, selectedRange)}
          rival={rivalComparison(weekRows.data, user.id)}
          opponent={(() => {
            const opp = members.data?.find((m) => m.userId !== user.id);
            return opp
              ? {
                  name: opp.name,
                  rival: rivalComparison(weekRows.data!, opp.userId),
                }
              : null;
          })()}
          runs={runningPeriodStats(activities.data ?? [], user.id, selectedRange, previousRange)}
          periodLabel={progressPeriodLabel(period)}
          moneyLine={moneySummary(payments.data ?? [], user.id)}
        />
      )}
    </AppShell>
  );
}

function EnduranceBody({
  summary,
  rival,
  opponent,
  runs,
  periodLabel,
  moneyLine,
}: {
  summary: ReturnType<typeof enduranceSummary>;
  rival: ReturnType<typeof rivalComparison>;
  opponent: { name: string; rival: ReturnType<typeof rivalComparison> } | null;
  runs: ReturnType<typeof runningPeriodStats>;
  periodLabel: string;
  moneyLine: string | null;
}) {
  const [selectedRun, setSelectedRun] = useState<string | null>(null);
  const run = runs.points.find((p) => p.id === selectedRun) ?? runs.points.at(-1);
  if (!summary.bars.length && !runs.runs) {
    return (
      <Card className="p-[18px]">
        <p className="text-[15px] font-medium">No activities yet</p>
        <p className="mt-1 text-sm text-muted-foreground">
          Log a run or ride from the + button and your weekly progress appears here.
        </p>
      </Card>
    );
  }

  const maxBar = Math.max(...summary.bars.flatMap((b) => [b.equivalentKm, b.targetKm]), 1) * 1.1;
  const paceDelta = runs.paceChange;

  return (
    <div className="space-y-3">
      {summary.bars.length ? (
        <Card className="p-[18px]">
          <p className="num">
            <span className="text-[34px] font-semibold tracking-tight">
              {summary.avgKmPerActiveWeek == null ? "—" : fmt(summary.avgKmPerActiveWeek, 1)} km
            </span>
            <span className="text-base text-muted-foreground"> a week, on average</span>
          </p>
          <p className="mt-0.5 text-sm text-muted-foreground">
            {summary.targetKm != null
              ? `Latest target ${fmt0(summary.targetKm)} km`
              : "No target recorded"}
            {summary.pausedWeeks
              ? ` · ${summary.pausedWeeks} paused week${summary.pausedWeeks === 1 ? "" : "s"}`
              : ""}
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            Challenge-equivalent km · {periodLabel}
          </p>
          {summary.activeWeeks > 0 ? (
            <p className="mt-2 text-sm text-primary">
              {summary.weeksHit} of {summary.activeWeeks} weeks hit.
            </p>
          ) : null}
          <div
            className="mt-3 overflow-x-auto pb-2"
            tabIndex={0}
            role="region"
            aria-label="Weekly Challenge distance and historical targets"
          >
            <div className="flex min-w-full items-end gap-2">
              {summary.bars.map((bar, index) => (
                <div key={bar.weekNumber} className="min-w-[48px] flex-1 text-center">
                  {index > 0 && bar.weekNumber > summary.bars[index - 1]!.weekNumber + 1 ? (
                    <span className="text-[10px] text-muted-foreground">Missing week data</span>
                  ) : null}
                  <p className="num text-xs font-semibold">
                    {bar.paused ? "Paused" : `${fmt(bar.equivalentKm, 1)}`}
                  </p>
                  <div
                    className="relative mt-1 flex h-32 items-end rounded-lg bg-elevated/50"
                    title={`${format(parseISO(bar.date), "d MMM")}: ${fmt(bar.equivalentKm, 1)} km, target ${fmt(bar.targetKm, 1)} km, ${bar.paused ? "paused" : bar.hit ? "target hit" : "below target"}`}
                  >
                    {!bar.paused ? (
                      <>
                        <div
                          className={`w-full rounded-t-lg ${bar.hit ? "bg-primary/80" : "bg-muted-foreground/40"}`}
                          style={{ height: `${(bar.equivalentKm / maxBar) * 100}%` }}
                        />
                        <span
                          className="absolute inset-x-0 border-t-2 border-dashed border-foreground/70"
                          style={{ bottom: `${(bar.targetKm / maxBar) * 100}%` }}
                        />
                      </>
                    ) : (
                      <span className="w-full border border-dashed border-muted-foreground text-xs text-muted-foreground">
                        Paused
                      </span>
                    )}
                  </div>
                  <p className="mt-1 text-[10px] text-muted-foreground">
                    {format(parseISO(bar.date), "d MMM")}
                  </p>
                  <p className="text-[10px] text-muted-foreground">
                    {bar.paused
                      ? ""
                      : bar.equivalentKm === 0
                        ? "No activity"
                        : bar.hit
                          ? "Hit"
                          : "Miss"}
                  </p>
                  <p className="text-[10px] text-muted-foreground">
                    {bar.paused ? "" : `Target ${fmt0(bar.targetKm)}`}
                  </p>
                </div>
              ))}
            </div>
          </div>
          <p className="mt-1 text-[11px] text-muted-foreground">
            Dashed markers show each week's target. Only recorded Challenge weeks are shown.
          </p>
        </Card>
      ) : (
        <Card className="p-[18px]">
          <p className="text-sm text-muted-foreground">
            Weekly distance appears once a Challenge week is recorded.
          </p>
        </Card>
      )}

      {runs.pace != null ? (
        <Card className="p-[18px]">
          <h2 className="text-[13px] font-medium text-muted-foreground">Average running pace</h2>
          <p className="num mt-1.5 text-[28px] font-semibold">{formatPace(runs.pace)} /km</p>
          {paceDelta != null ? (
            <p className="mt-1 text-sm text-muted-foreground">
              {Math.abs(paceDelta) < 1
                ? "Same pace as previous period"
                : `${fmt0(Math.abs(paceDelta))} sec/km ${paceDelta > 0 ? "faster" : "slower"} than previous period`}{" "}
              · Previous {formatPace(runs.previousPace)} /km
            </p>
          ) : (
            <p className="mt-1 text-xs text-muted-foreground">
              Distance-weighted pace from timed runs in this period.
            </p>
          )}
          {runs.points.length >= 2 ? (
            <div className="mt-3 h-40">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart
                  data={runs.points}
                  margin={{ top: 8, right: 8, left: -12, bottom: 0 }}
                  onClick={(state) => {
                    const point = state?.activePayload?.[0]?.payload;
                    if (point?.id) setSelectedRun(point.id);
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
                    reversed
                    tickFormatter={(value: number) => formatPace(value)}
                    width={55}
                    domain={["dataMin - 10", "dataMax + 10"]}
                  />
                  <Tooltip {...chartTooltip} content={<ProgressChartTooltip kind="pace" />} />
                  <Line
                    dataKey="pace"
                    stroke="var(--color-primary)"
                    strokeWidth={2}
                    dot={{ r: 3 }}
                    isAnimationActive={false}
                  />
                </LineChart>
              </ResponsiveContainer>
            </div>
          ) : (
            <p className="mt-3 text-sm text-muted-foreground">
              One run. Log another to see your pace trend.
            </p>
          )}
          {run ? (
            <div className="mt-3">
              <NativeSelect
                aria-label="Run details"
                value={run.id}
                onChange={(event) => setSelectedRun(event.target.value)}
                className="text-sm"
              >
                {runs.points.map((point) => (
                  <option key={point.id} value={point.id}>
                    {format(parseISO(point.date), "d MMM")} · {fmt(point.distanceKm, 1)} km
                  </option>
                ))}
              </NativeSelect>
              <p className="num mt-2 text-sm text-muted-foreground" aria-live="polite">
                {format(parseISO(run.date), "d MMM yyyy")} · {fmt(run.distanceKm, 1)} km ·{" "}
                {formatPace(run.pace)} /km · {formatRunDuration(run.durationSeconds)}
              </p>
            </div>
          ) : null}
        </Card>
      ) : null}

      {runs.runs > 0 ? (
        <Card className="grid grid-cols-2 gap-x-3 gap-y-4 p-[18px]">
          <Stat value={String(runs.runs)} label="Runs" />
          <Stat value={`${fmt(runs.distanceKm, 1)} km`} label="Running distance" />
          <Stat value={`${fmt(runs.longestRunKm, 1)} km`} label="Longest run" />
          {runs.runsPerWeek != null ? (
            <Stat value={fmt(runs.runsPerWeek, 1)} label="Runs per week" />
          ) : null}
          {runs.durationSeconds != null ? (
            <Stat value={formatRunDuration(runs.durationSeconds)} label="Running time" />
          ) : null}
        </Card>
      ) : null}
      {summary.activeWeeks > 0 ? (
        <Card className="grid grid-cols-2 gap-3 p-[18px]">
          <Stat value={`${summary.currentStreak} wk`} label="Latest target streak" />
          <Stat value={`${summary.bestStreak} wk`} label="Best target streak" />
        </Card>
      ) : null}

      {opponent ? (
        <Card className="space-y-3 p-[18px]">
          <h2 className="text-[13px] font-medium text-muted-foreground">
            You vs {opponent.name}, whole challenge
          </h2>
          <RivalBar
            label="You"
            km={rival.km}
            hit={rival.weeksHit}
            active={rival.activeWeeks}
            fill="bg-primary"
            max={Math.max(rival.km, opponent.rival.km, 1)}
          />
          <RivalBar
            label={opponent.name}
            km={opponent.rival.km}
            hit={opponent.rival.weeksHit}
            active={opponent.rival.activeWeeks}
            fill="bg-[var(--color-chart-2)]"
            max={Math.max(rival.km, opponent.rival.km, 1)}
          />
          {moneyLine ? <p className="text-[13px] text-muted-foreground">{moneyLine}</p> : null}
        </Card>
      ) : null}
    </div>
  );
}

function Stat({ value, label }: { value: string; label: string }) {
  return (
    <div>
      <div className="num break-words text-[19px] font-semibold">{value}</div>
      <div className="mt-0.5 text-[12px] text-muted-foreground">{label}</div>
    </div>
  );
}

function RivalBar({
  label,
  km,
  hit,
  active,
  fill,
  max,
}: {
  label: string;
  km: number;
  hit: number;
  active: number;
  fill: string;
  max: number;
}) {
  return (
    <div>
      <div className="num mb-1.5 flex justify-between text-sm">
        <span>{label}</span>
        <span>
          {fmt(km, 1)} km · {hit} of {active} week{active === 1 ? "" : "s"}
        </span>
      </div>
      <div className="h-2 overflow-hidden rounded-full bg-elevated">
        <div
          className={`h-full rounded-full ${fill}`}
          style={{ width: `${Math.round((km / max) * 100)}%` }}
        />
      </div>
    </div>
  );
}

/** Settlement so far from the payment rows (reuses the stored amounts/status, no re-derivation). */
function moneySummary(
  payments: { payer_id: string; recipient_id: string; amount_eur: number; status: string }[],
  userId: string,
): string | null {
  let iPaid = 0;
  let theyOweMe = 0;
  let iOwe = 0;
  for (const payment of payments) {
    const amount = Number(payment.amount_eur) || 0;
    if (payment.payer_id === userId) {
      if (payment.status === "confirmed_paid") iPaid += amount;
      else iOwe += amount;
    } else if (payment.recipient_id === userId && payment.status !== "confirmed_paid") {
      theyOweMe += amount;
    }
  }
  if (!iPaid && !theyOweMe && !iOwe) return null;
  const parts: string[] = [];
  if (iPaid) parts.push(`you paid ${eur(iPaid)}`);
  if (iOwe) parts.push(`you owe ${eur(iOwe)}`);
  if (theyOweMe) parts.push(`they owe you ${eur(theyOweMe)}`);
  return `Money so far: ${parts.join(", ")}.`;
}

function formatRunDuration(seconds: number) {
  const rounded = Math.round(seconds);
  const minutes = Math.floor(rounded / 60);
  return minutes >= 60
    ? `${Math.floor(minutes / 60)} h ${minutes % 60} min`
    : `${minutes}:${String(rounded % 60).padStart(2, "0")}`;
}
