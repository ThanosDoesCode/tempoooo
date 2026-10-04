import { createFileRoute, Link } from "@tanstack/react-router";
import { parseISO, subDays } from "date-fns";
import { useMemo } from "react";

import { AppShell, PageHeader } from "@/components/AppShell";
import { NavRows } from "@/components/NavRows";
import { PeriodPicker, ProgressNav, ProgressRow, Sparkline } from "@/components/ProgressChrome";
import { usePeriodWeeks, useProgressSections, useTrackedLifts } from "@/lib/progress-view";
import { avg7, calorieAdvice, fmt, fmt0, iso, latestWeight } from "@/lib/calc";
import { useAppData, useBulkMeta } from "@/lib/store";
import { bulkPlanModeFor, useMemberships } from "@/lib/bulk-access";
import { useAuth } from "@/lib/auth";
import { useMyChallenge, useWeeks } from "@/lib/challenge";
import { enduranceSummary } from "@/lib/endurance-progress";
import { deriveLegacyPersonalRecords } from "@/lib/personal-records";
import { liftEstimate } from "@/lib/strength-estimates";
import { PublicBulkProgress } from "@/components/PublicBulkProgress";
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
  const planMode = bulkPlanModeFor(memberships.data, bulkId);

  if (!data || planMode === "none") {
    return (
      <AppShell>
        <h1 className="fade-up mb-3 text-3xl font-semibold tracking-tight">Progress</h1>
        <div className="h-48 animate-pulse rounded-[20px] bg-card" aria-label="Loading progress" />
      </AppShell>
    );
  }

  if (planMode === "public" && bulkId) {
    return (
      <AppShell>
        <PageHeader
          title="Progress"
          subtitle="Weekly trends across weight, training and nutrition."
        />
        <PublicBulkProgress bulkProfileId={bulkId} targets={data.targets} />
        <div className="mt-5">
          <NavRows
            title="More in Progress"
            rows={[
              { to: "/bulk/check-in", label: "Weekly review", hint: "Recommendation and numbers" },
              { to: "/bulk/prs", label: "Personal records", hint: "Your strongest performances" },
              { to: "/bulk/training/history", label: "Training history" },
              { to: "/bulk/meals/history", label: "Nutrition history" },
            ]}
          />
        </div>
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

  // ---- Body ----
  const latest = latestWeight(data);
  const rolling = latest ? avg7(data, latest.date) : null;
  const toGoal = latest ? data.targets.targetWeight - latest.weight : null;
  const bodySpark = useMemo(() => {
    const today = iso(new Date());
    return Array.from({ length: 6 }, (_, i) =>
      avg7(data, iso(subDays(parseISO(today), (5 - i) * 7))),
    ).filter((v): v is number => v != null);
  }, [data]);

  // ---- Food ----
  const foodDays = useMemo(() => {
    const today = parseISO(iso(new Date()));
    const target = data.targets.calories;
    let logged = 0;
    let onTarget = 0;
    for (let i = 0; i < weeks * 7; i++) {
      const cals = data.days[iso(subDays(today, i))]?.calories;
      if (cals == null) continue;
      logged += 1;
      if (Math.abs(cals - target) <= target * 0.1) onTarget += 1;
    }
    return { logged, onTarget };
  }, [data, weeks]);

  // ---- Strength ----
  const [trackedNames] = useTrackedLifts(data);
  const strength = useMemo(() => {
    const records = deriveLegacyPersonalRecords(data);
    const estimates = trackedNames.flatMap((name) => {
      const record = records.find((r) => r.name === name);
      return record ? [liftEstimate(record)] : [];
    });
    const measured = estimates.filter((e) => e.trend !== "insufficient");
    return { up: measured.filter((e) => e.trend === "up").length, total: measured.length };
  }, [data, trackedNames]);
  const hasWorkouts = useMemo(
    () => Object.values(data.workouts).some((w) => w.status === "completed"),
    [data.workouts],
  );

  // ---- Endurance ----
  const endurance =
    hasChallenge && user && weekRows.data ? enduranceSummary(weekRows.data, user.id, weeks) : null;

  const insight = buildInsight({ strength, toGoal, endurance, foodDays, hasChallenge });

  return (
    <AppShell>
      <div className="mb-3 flex items-end justify-between">
        <h1 className="fade-up text-3xl font-semibold tracking-tight">Progress</h1>
        <PeriodPicker weeks={weeks} onChange={setWeeks} />
      </div>
      <ProgressNav active="overview" />

      {insight ? (
        <p className="rounded-[20px] bg-primary/10 px-[18px] py-4 text-[15px] leading-relaxed">
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

        {hasWorkouts && strength.total > 0 ? (
          <Tile
            to="/bulk/progress/strength"
            label="Strength"
            up={strength.up > 0}
            big={`${strength.up} of ${strength.total}`}
            sub="main lifts up"
            spark={[]}
          />
        ) : null}

        {sections.includes("body") ? (
          <Tile
            to="/bulk/progress/body"
            label="Body"
            up={toGoal != null && Math.abs(toGoal) > 0}
            big={latest ? `${fmt(latest.weight, 1)} kg` : "—"}
            sub={
              toGoal != null
                ? `${fmt(Math.abs(toGoal), 1)} kg ${toGoal >= 0 ? "to goal" : "over goal"}`
                : "log a weigh-in"
            }
            spark={bodySpark}
          />
        ) : null}

        {foodDays.logged > 0 ? (
          <Tile
            to="/bulk/progress/body/food"
            label="Food"
            big={`${foodDays.onTarget} of ${foodDays.logged}`}
            sub="days on calorie target"
            spark={[]}
          />
        ) : null}
      </div>

      <div className="mt-3 rounded-[20px] bg-card px-4">
        <ProgressRow
          to="/bulk/check-in"
          label="Weekly review"
          hint={calorieAdvice(data).decision.startsWith("Keep") ? "On track" : "Review suggested"}
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
  strength,
  toGoal,
  endurance,
  foodDays,
  hasChallenge,
}: {
  strength: { up: number; total: number };
  toGoal: number | null;
  endurance: ReturnType<typeof enduranceSummary> | null;
  foodDays: { logged: number; onTarget: number };
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
  if (strength.total > 0 && strength.up > 0) {
    parts.push(`${strength.up} of ${strength.total} main lifts are up`);
  }
  if (!parts.length && toGoal != null && Math.abs(toGoal) > 0) {
    parts.push(`you're ${fmt(Math.abs(toGoal), 1)} kg from your goal weight`);
  }
  if (!parts.length && foodDays.logged > 0) {
    parts.push(
      `you hit your calorie target on ${foodDays.onTarget} of ${foodDays.logged} logged days`,
    );
  }
  if (!parts.length) return null;
  const sentence = parts.slice(0, 2).join(", and ");
  return `${sentence.charAt(0).toUpperCase()}${sentence.slice(1)}.`;
}
