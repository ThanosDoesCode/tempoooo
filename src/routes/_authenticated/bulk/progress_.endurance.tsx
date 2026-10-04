import { createFileRoute, Link } from "@tanstack/react-router";

import { AppShell } from "@/components/AppShell";
import { Card } from "@/components/ui-kit";
import { PeriodPicker, ProgressNav, Sparkline } from "@/components/ProgressChrome";
import { usePeriodWeeks } from "@/lib/progress-view";
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
import {
  enduranceSummary,
  paceTrend,
  periodRange,
  rivalComparison,
} from "@/lib/endurance-progress";

export const Route = createFileRoute("/_authenticated/bulk/progress_/endurance")({
  head: () => ({ meta: [{ title: "Tempo" }] }),
  component: EndurancePage,
});

function EndurancePage() {
  const [weeks, setWeeks] = usePeriodWeeks();
  const { user } = useAuth();
  const challenge = useMyChallenge();
  const challengeId = challenge.data?.id;
  const weekRows = useWeeks(challengeId);
  const members = useChallengeMembers(challengeId);
  const payments = usePayments(challengeId);
  // Pace/longest-run use every qualifying activity in the selected period, not the recent feed.
  const range = user && weekRows.data ? periodRange(weekRows.data, user.id, weeks) : null;
  const activities = useEnduranceActivities(challengeId, range);

  return (
    <AppShell>
      <div className="mb-3 flex items-end justify-between">
        <h1 className="fade-up text-3xl font-semibold tracking-tight">Progress</h1>
        <PeriodPicker weeks={weeks} onChange={setWeeks} />
      </div>
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
          summary={enduranceSummary(weekRows.data, user.id, weeks)}
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
          pace={paceTrend(activities.data ?? [], user.id)}
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
  pace,
  moneyLine,
}: {
  summary: ReturnType<typeof enduranceSummary>;
  rival: ReturnType<typeof rivalComparison>;
  opponent: { name: string; rival: ReturnType<typeof rivalComparison> } | null;
  pace: ReturnType<typeof paceTrend>;
  moneyLine: string | null;
}) {
  if (!summary.bars.length) {
    return (
      <Card className="p-[18px]">
        <p className="text-[15px] font-medium">No activities yet</p>
        <p className="mt-1 text-sm text-muted-foreground">
          Log a run or ride from the + button and your weekly progress appears here.
        </p>
      </Card>
    );
  }

  const maxBar = Math.max(summary.targetKm ?? 0, ...summary.bars.map((b) => b.equivalentKm), 1);
  const paceDelta = pace.first != null && pace.latest != null ? pace.first - pace.latest : null;

  return (
    <div className="space-y-3">
      <Card className="p-[18px]">
        <p className="num">
          <span className="text-[34px] font-semibold tracking-tight">
            {fmt(summary.avgKmPerActiveWeek, 1)} km
          </span>
          <span className="text-base text-muted-foreground"> a week, on average</span>
        </p>
        <p className="mt-0.5 text-sm text-muted-foreground">
          {summary.targetKm != null ? `Target ${fmt0(summary.targetKm)} km · ` : ""}
          {summary.weeksHit} of {summary.activeWeeks} week{summary.activeWeeks === 1 ? "" : "s"} hit
          {summary.pausedWeeks ? `, ${summary.pausedWeeks} paused` : ""}
        </p>
        <div className="mt-4 flex items-end gap-2" style={{ height: 150 }}>
          {summary.bars.map((bar) => {
            const pct = bar.paused ? 0 : Math.round((bar.equivalentKm / maxBar) * 100);
            return (
              <div key={bar.weekNumber} className="flex flex-1 flex-col items-center gap-1">
                <span className="num text-[11px] font-semibold">
                  {bar.paused ? "" : fmt(bar.equivalentKm, 1)}
                </span>
                <div className="flex w-full flex-1 items-end">
                  {bar.paused ? (
                    <div className="grid h-5 w-full place-items-center rounded-lg border border-dashed border-muted-foreground/60 text-[10px] text-muted-foreground">
                      Paused
                    </div>
                  ) : (
                    <div
                      className={`w-full rounded-lg ${bar.hit ? "bg-primary" : "bg-warn"}`}
                      style={{ height: `${Math.max(pct, 3)}%` }}
                    />
                  )}
                </div>
                <span className="text-[11px] text-muted-foreground">W{bar.weekNumber}</span>
              </div>
            );
          })}
        </div>
      </Card>

      {pace.series.length >= 2 ? (
        <Card className="p-[18px]">
          <h2 className="text-[13px] font-medium text-muted-foreground">
            {pace.kind === "run" ? "Run pace" : "Ride speed"}
          </h2>
          <p className="num mt-1.5">
            <span className="text-[28px] font-semibold tracking-tight">
              {pace.kind === "run" ? formatPace(pace.latest) : `${fmt(pace.latest, 1)} km/h`}
            </span>
            {paceDelta != null && Math.abs(paceDelta) >= 1 ? (
              <span className="ml-2 text-sm font-semibold text-primary">
                {pace.kind === "run"
                  ? `${fmt0(Math.abs(paceDelta))} s ${paceDelta > 0 ? "faster" : "slower"}`
                  : `${fmt(Math.abs(paceDelta), 1)} km/h ${paceDelta > 0 ? "faster" : "slower"}`}
              </span>
            ) : null}
          </p>
          <div className="mt-3">
            {/* Pace improves as it falls, so invert the run series to read upward. */}
            <Sparkline
              points={pace.kind === "run" ? pace.series.map((s) => -s) : pace.series}
              width={320}
              height={90}
            />
          </div>
          <p className="mt-1 text-[11px] text-muted-foreground">
            Recent {pace.kind === "run" ? "runs" : "rides"}
          </p>
        </Card>
      ) : null}

      <Card className="grid grid-cols-3 gap-2 p-[18px]">
        <Stat
          value={pace.longestRunKm != null ? `${fmt(pace.longestRunKm, 1)} km` : "—"}
          label="Longest run"
        />
        <Stat value={`${fmt(summary.totalKm, 1)} km`} label="Total so far" />
        <Stat
          value={`${summary.bestStreak} wk${summary.bestStreak === 1 ? "" : "s"}`}
          label="Best streak"
        />
      </Card>

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
      <div className="num text-[19px] font-semibold">{value}</div>
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
