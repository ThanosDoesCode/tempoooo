import { createFileRoute, Link } from "@tanstack/react-router";
import { useMemo } from "react";

import { AppShell } from "@/components/AppShell";
import { PeriodPicker, ProgressNav, ProgressRow, Sparkline } from "@/components/ProgressChrome";
import { fmt, fmt0 } from "@/lib/calc";
import { useAppData, useBulkMeta } from "@/lib/store";
import { bulkPlanModeFor, useMemberships } from "@/lib/bulk-access";
import { useAuth } from "@/lib/auth";
import { useMyChallenge, useWeeks } from "@/lib/challenge";
import { enduranceSummary } from "@/lib/endurance-progress";
import { usePeriodWeeks, useProgressSections, useTrackedLifts } from "@/lib/progress-view";
import { useFoodModel, useStrengthModel, useWeightModel } from "@/lib/progress-model";
import { liftEstimate } from "@/lib/strength-estimates";
import type { AppData } from "@/lib/types";

export const Route = createFileRoute("/_authenticated/bulk/progress")({
  head: () => ({
    meta: [
      { title: "Tempo" },
      {
        name: "description",
        content: "How you are changing over time: endurance, strength, body and food.",
      },
      { property: "og:title", content: "Tempo" },
      { property: "og:description", content: "Your progress at a glance." },
    ],
  }),
  component: ProgressPage,
});

function ProgressPage() {
  const data = useAppData();
  const { bulkId } = useBulkMeta();
  const memberships = useMemberships();
  // Public and legacy modes share one Progress experience; only "none" (no bulk plan) is gated out.
  const planMode = bulkPlanModeFor(memberships.data, bulkId);

  if (!data || planMode === "none") {
    return (
      <AppShell>
        <h1 className="fade-up mb-3 text-3xl font-semibold tracking-tight">Progress</h1>
        <div className="h-48 animate-pulse rounded-[20px] bg-card" aria-label="Loading progress" />
      </AppShell>
    );
  }

  return <OwnProgress data={data} />;
}

function OwnProgress({ data }: { data: AppData }) {
  const [weeks, setWeeks] = usePeriodWeeks();
  const { sections, hasChallenge } = useProgressSections();
  const { user } = useAuth();
  const challenge = useMyChallenge();
  const weekRows = useWeeks(challenge.data?.id);

  const weight = useWeightModel(weeks * 7);
  const food = useFoodModel(weeks * 7);
  const strength = useStrengthModel();
  const [trackedNames] = useTrackedLifts(data);

  const strengthTile = useMemo(() => {
    const estimates = trackedNames.flatMap((name) => {
      const record = strength.records.find((r) => r.name === name);
      return record ? [liftEstimate(record)] : [];
    });
    const measured = estimates.filter((e) => e.trend !== "insufficient");
    return { up: measured.filter((e) => e.trend === "up").length, total: measured.length };
  }, [strength.records, trackedNames]);

  const endurance =
    hasChallenge && user && weekRows.data ? enduranceSummary(weekRows.data, user.id, weeks) : null;

  const toGoal = weight.goal.remainingKg;
  const insight = buildInsight({ strengthTile, toGoal, endurance, food, hasChallenge });

  return (
    <AppShell>
      <div className="mb-3 flex items-end justify-between">
        <h1 className="fade-up text-3xl font-semibold tracking-tight">Progress</h1>
        <PeriodPicker weeks={weeks} onChange={setWeeks} />
      </div>
      <ProgressNav active="overview" />

      {insight ? (
        <p className="rounded-[20px] bg-primary/10 px-[18px] py-4 text-[15px] leading-[1.45]">
          {insight}
        </p>
      ) : null}

      <div className="mt-3 grid grid-cols-2 gap-3">
        {endurance && endurance.avgKmPerActiveWeek != null ? (
          <Tile
            to="/bulk/progress/endurance"
            label="Endurance"
            up={
              endurance.targetKm != null && endurance.avgKmPerActiveWeek >= endurance.targetKm * 0.9
            }
            big={`${fmt(endurance.avgKmPerActiveWeek, 1)} km`}
            sub={
              endurance.targetKm != null ? `a week · target ${fmt0(endurance.targetKm)}` : "a week"
            }
            spark={endurance.bars.map((b) => b.equivalentKm)}
          />
        ) : null}

        {sections.includes("strength") && strengthTile.total > 0 ? (
          <Tile
            to="/bulk/progress/strength"
            label="Strength"
            up={strengthTile.up > 0}
            big={`${strengthTile.up} of ${strengthTile.total}`}
            sub="main lifts up"
            spark={[]}
          />
        ) : null}

        {sections.includes("body") ? (
          <Tile
            to="/bulk/progress/body"
            label="Body"
            up={toGoal != null && Math.abs(toGoal) > 0}
            big={weight.latestKg != null ? `${fmt(weight.latestKg, 1)} kg` : "—"}
            sub={
              toGoal != null
                ? `${fmt(Math.abs(toGoal), 1)} kg ${toGoal >= 0 ? "to goal" : "over goal"}`
                : "log a weigh-in"
            }
            spark={weight.series.map((p) => p.avg).filter((v): v is number => v != null)}
          />
        ) : null}

        {food.loggedDays > 0 ? (
          <Tile
            to="/bulk/progress/body/food"
            label="Food"
            big={`${food.onTargetDays} of ${food.loggedDays}`}
            sub="days on calorie target"
            spark={[]}
          />
        ) : null}
      </div>

      <div className="mt-3 rounded-[20px] bg-card px-4">
        <ProgressRow
          to="/bulk/check-in"
          label="Weekly review"
          hint={`${fmt0(data.targets.calories)} kcal`}
        />
      </div>
    </AppShell>
  );
}

function Tile({
  to,
  label,
  big,
  sub,
  up,
  spark,
}: {
  to: string;
  label: string;
  big: string;
  sub: string;
  up?: boolean;
  spark: number[];
}) {
  return (
    <Link
      to={to}
      preload="intent"
      className="flex min-h-[150px] flex-col gap-1.5 rounded-[20px] bg-card p-4 active:opacity-80"
    >
      <span className="flex items-center justify-between text-[13px] text-muted-foreground">
        {label}
        {up ? <span className="text-[13px] font-semibold text-primary">↑</span> : null}
      </span>
      <span className="num text-[26px] font-semibold tracking-tight">{big}</span>
      <span className="text-[13px] text-muted-foreground">{sub}</span>
      <span className="mt-auto">
        <Sparkline points={spark} />
      </span>
    </Link>
  );
}

function buildInsight({
  strengthTile,
  toGoal,
  endurance,
  food,
  hasChallenge,
}: {
  strengthTile: { up: number; total: number };
  toGoal: number | null;
  endurance: ReturnType<typeof enduranceSummary> | null;
  food: { loggedDays: number; onTargetDays: number };
  hasChallenge: boolean;
}): string | null {
  const parts: string[] = [];
  if (hasChallenge && endurance && endurance.activeWeeks > 0) {
    parts.push(
      `You hit your endurance target in ${endurance.weeksHit} of ${endurance.activeWeeks} active week${
        endurance.activeWeeks === 1 ? "" : "s"
      }`,
    );
  }
  if (strengthTile.total > 0 && strengthTile.up > 0) {
    parts.push(`${strengthTile.up} of ${strengthTile.total} main lifts are up`);
  }
  if (!parts.length && toGoal != null && Math.abs(toGoal) > 0) {
    parts.push(`you're ${fmt(Math.abs(toGoal), 1)} kg from your goal weight`);
  }
  if (!parts.length && food.loggedDays > 0) {
    parts.push(
      `you hit your calorie target on ${food.onTargetDays} of ${food.loggedDays} logged days`,
    );
  }
  if (!parts.length) return null;
  const sentence = parts.slice(0, 2).join(", and ");
  return `${sentence.charAt(0).toUpperCase()}${sentence.slice(1)}.`;
}
