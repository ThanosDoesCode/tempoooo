import { createFileRoute, Link } from "@tanstack/react-router";
import { useMemo } from "react";

import { AppShell } from "@/components/AppShell";
import {
  ProgressHeader,
  PeriodPicker,
  ProgressNav,
  ProgressRow,
  Sparkline,
} from "@/components/ProgressChrome";
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
        <ProgressHeader />
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
  const insight = buildInsight({
    strengthTile,
    toGoal: weight.latestKg != null ? toGoal : null,
    endurance,
    food,
    hasChallenge,
  });

  return (
    <AppShell>
      <ProgressHeader>
        <PeriodPicker weeks={weeks} onChange={setWeeks} />
      </ProgressHeader>
      <ProgressNav active="overview" />

      {insight ? (
        <p className="rounded-[20px] bg-primary/10 px-[18px] py-4 text-[15px] leading-[1.45]">
          {insight}
        </p>
      ) : null}

      <div className="mt-3 grid grid-cols-2 gap-3">
        <Tile
          to="/bulk/progress/endurance"
          label="Endurance"
          up={
            endurance?.avgKmPerActiveWeek != null &&
            endurance.targetKm != null &&
            endurance.avgKmPerActiveWeek >= endurance.targetKm * 0.9
          }
          big={
            endurance?.avgKmPerActiveWeek != null
              ? `${fmt(endurance.avgKmPerActiveWeek, 1)} km`
              : challenge.isLoading
                ? "Loading progress…"
                : "No data yet"
          }
          sub={
            endurance?.avgKmPerActiveWeek != null
              ? endurance.targetKm != null
                ? `a week · target ${fmt0(endurance.targetKm)}`
                : "a week"
              : "Log a run or ride"
          }
          empty={endurance?.avgKmPerActiveWeek == null}
          spark={
            endurance?.avgKmPerActiveWeek != null ? endurance.bars.map((b) => b.equivalentKm) : []
          }
        />

        {sections.includes("strength") ? (
          <Tile
            to="/bulk/progress/strength"
            label="Strength"
            up={strengthTile.up > 0}
            big={
              strengthTile.total > 0
                ? `${strengthTile.up} of ${strengthTile.total}`
                : strength.loading
                  ? "Loading progress…"
                  : "No data yet"
            }
            sub={strengthTile.total > 0 ? "main lifts up" : "Complete a workout"}
            empty={strengthTile.total === 0}
            spark={[]}
          />
        ) : null}

        {sections.includes("body") ? (
          <>
            <Tile
              to="/bulk/progress/body"
              label="Body"
              up={weight.latestKg != null && toGoal != null && Math.abs(toGoal) > 0}
              big={
                weight.latestKg != null
                  ? `${fmt(weight.latestKg, 1)} kg`
                  : weight.loading
                    ? "Loading progress…"
                    : "Log your first weight"
              }
              sub={
                weight.latestKg != null && toGoal != null
                  ? `${fmt(Math.abs(toGoal), 1)} kg ${toGoal >= 0 ? "to goal" : "over goal"}`
                  : "See your weight progress over time"
              }
              empty={weight.latestKg == null}
              spark={
                weight.latestKg != null
                  ? weight.series.map((p) => p.avg).filter((v): v is number => v != null)
                  : []
              }
            />
            <Tile
              to="/bulk/progress/body/food"
              label="Food"
              big={
                food.loggedDays > 0
                  ? `${food.onTargetDays} of ${food.loggedDays}`
                  : food.loading
                    ? "Loading progress…"
                    : "Start logging meals"
              }
              sub={
                food.loggedDays > 0 ? "days on calorie target" : "See how meals match your targets"
              }
              empty={food.loggedDays === 0}
              spark={[]}
            />
          </>
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
  empty = false,
}: {
  to: string;
  label: string;
  big: string;
  sub: string;
  up?: boolean;
  spark: number[];
  empty?: boolean;
}) {
  return (
    <Link
      to={to}
      preload="intent"
      className="flex min-h-[150px] min-w-0 flex-col gap-1.5 rounded-[20px] bg-card p-4 active:opacity-80"
    >
      <span className="flex items-center justify-between text-[13px] text-muted-foreground">
        {label}
        {up ? <span className="text-[13px] font-semibold text-primary">↑</span> : null}
      </span>
      <span
        className={
          empty
            ? "text-[17px] font-medium leading-snug"
            : "num text-[26px] font-semibold tracking-tight"
        }
      >
        {big}
      </span>
      <span
        className={`text-muted-foreground ${empty ? "text-[11px] tracking-tight min-[360px]:text-[13px] min-[360px]:tracking-normal" : "text-[13px]"}`}
      >
        {sub}
      </span>
      <span className="mt-auto [&>svg]:max-w-full">
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
