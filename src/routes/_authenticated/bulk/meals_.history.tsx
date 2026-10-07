import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { addDays, format, parseISO } from "date-fns";
import { TempoDatePicker } from "@/components/TempoDateTimePicker";
import { ChevronLeft, ChevronRight } from "lucide-react";

import { AppShell, PageHeader } from "@/components/AppShell";
import { Card, DataError, SectionTitle } from "@/components/ui-kit";
import { nutritionSummary, isIsoLocalDay } from "@/lib/bulk-nutrition";
import { useBulkNutritionDay } from "@/lib/bulk-nutrition-query";
import { iso } from "@/lib/calc";
import { userFacingError } from "@/lib/network-errors";
import { useAppData, useBulkMeta } from "@/lib/store";
import { bulkPlanModeFor, useMemberships } from "@/lib/bulk-access";

export const Route = createFileRoute("/_authenticated/bulk/meals_/history")({
  validateSearch: (search: Record<string, unknown>): { date?: string | undefined } => ({
    date:
      typeof search["date"] === "string" && isIsoLocalDay(search["date"])
        ? search["date"]
        : undefined,
  }),
  head: () => ({ meta: [{ title: "Tempo" }] }),
  component: MealsHistoryPage,
});

const macro = (value: number | undefined, unit: string) =>
  value == null ? "—" : `${Math.round(value)} ${unit}`;

const backOriginLabels = {
  "/bulk/progress/body/food": "Food details",
  "/bulk/meals": "Meals",
} as const;

function MealsHistoryPage() {
  const data = useAppData();
  const { bulkId } = useBulkMeta();
  const memberships = useMemberships();
  const today = iso(new Date());
  const search = Route.useSearch();
  const date = search.date ?? iso(addDays(new Date(), -1));
  const navigate = useNavigate();
  const setDate = (date: string) => void navigate({ to: "/bulk/meals/history", search: { date } });
  const planMode = bulkPlanModeFor(memberships.data, bulkId);
  const isPublic = planMode === "public";
  const nutrition = useBulkNutritionDay(isPublic ? bulkId : null, date);
  const legacyDay = data?.days[date];
  const totals = nutrition.data?.day
    ? nutritionSummary(nutrition.data.entries, nutrition.data.day.targets)
    : null;
  const move = (days: number) => {
    const next = iso(addDays(parseISO(date), days));
    if (next <= today) setDate(next);
  };

  return (
    <AppShell>
      <PageHeader
        title="Nutrition history"
        subtitle={format(parseISO(date), "EEEE, d MMMM yyyy")}
        historyBack
        backTo="/bulk/meals"
        backLabel="Meals"
        backOriginLabels={backOriginLabels}
      />
      <div className="mb-4 grid grid-cols-[44px_1fr_44px] items-center gap-2" data-no-pull>
        <button
          type="button"
          onClick={() => move(-1)}
          aria-label="Previous day"
          className="grid min-h-11 place-items-center rounded-xl border border-border bg-card active:bg-elevated"
        >
          <ChevronLeft className="control-chevron" aria-hidden="true" />
        </button>
        <TempoDatePicker
          value={date}
          max={today}
          onChange={(value) => value && setDate(value)}
          aria-label="Nutrition history date"
          className="min-h-11 min-w-0 rounded-xl border border-input bg-card px-3 text-center text-base outline-none focus:border-ring"
        />
        <button
          type="button"
          onClick={() => move(1)}
          disabled={date >= today}
          aria-label="Next day"
          className="grid min-h-11 place-items-center rounded-xl border border-border bg-card disabled:opacity-40 active:bg-elevated"
        >
          <ChevronRight className="control-chevron" aria-hidden="true" />
        </button>
      </div>

      {isPublic && date <= today ? (
        <Link
          to="/bulk/meals"
          search={{ date }}
          preload="intent"
          className="mb-4 inline-flex min-h-11 items-center rounded-xl px-3 text-sm font-medium text-primary"
        >
          View / log meals for this day
        </Link>
      ) : null}
      {planMode === "none" ? (
        <div className="h-40 animate-pulse rounded-2xl bg-card" aria-label="Loading history" />
      ) : isPublic && nutrition.isLoading ? (
        <div className="h-40 animate-pulse rounded-2xl bg-card" />
      ) : isPublic && nutrition.error && !legacyDay ? (
        <DataError
          message={userFacingError(nutrition.error, "load this nutrition day")}
          onRetry={() => void nutrition.refetch()}
        />
      ) : isPublic && nutrition.data?.day && totals ? (
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-2">
            <HistoryMacro
              label="Calories"
              value={`${Math.round(totals.calories.consumed)} kcal`}
              target={
                totals.calories.target == null
                  ? "Target unavailable"
                  : `${Math.round(totals.calories.target)} target`
              }
            />
            <HistoryMacro
              label="Protein"
              value={`${Math.round(totals.protein.consumed)} g`}
              target={
                totals.protein.target == null
                  ? "Target unavailable"
                  : `${Math.round(totals.protein.target)} g target`
              }
            />
            <HistoryMacro
              label="Carbs"
              value={`${Math.round(totals.carbs.consumed)} g`}
              target={
                totals.carbs.target == null
                  ? "Target unavailable"
                  : `${Math.round(totals.carbs.target)} g target`
              }
            />
            <HistoryMacro
              label="Fat"
              value={`${Math.round(totals.fat.consumed)} g`}
              target={
                totals.fat.target == null
                  ? "Target unavailable"
                  : `${Math.round(totals.fat.target)} g target`
              }
            />
          </div>
          <section>
            <SectionTitle>Logged meals and entries</SectionTitle>
            <div className="mt-2 space-y-2">
              {nutrition.data.entries.map((entry) => (
                <Card key={entry.id}>
                  <div className="flex justify-between gap-3">
                    <h2 className="font-semibold">{entry.name}</h2>
                    <span className="shrink-0 text-sm tabular-nums">
                      {Math.round(entry.calories)} kcal
                    </span>
                  </div>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {Math.round(entry.protein)} g protein · {Math.round(entry.carbs)} g carbs ·{" "}
                    {Math.round(entry.fat)} g fat
                  </p>
                  {entry.note ? (
                    <p className="mt-2 text-sm text-muted-foreground">{entry.note}</p>
                  ) : null}
                </Card>
              ))}
            </div>
          </section>
        </div>
      ) : legacyDay ? (
        <Card>
          <SectionTitle>Saved daily totals</SectionTitle>
          <div className="mt-2 grid grid-cols-2 gap-3 text-sm">
            <p>
              Calories <strong className="block">{macro(legacyDay.calories, "kcal")}</strong>
            </p>
            <p>
              Protein <strong className="block">{macro(legacyDay.protein, "g")}</strong>
            </p>
            <p>
              Carbs <strong className="block">{macro(legacyDay.carbs, "g")}</strong>
            </p>
            <p>
              Fat <strong className="block">{macro(legacyDay.fat, "g")}</strong>
            </p>
          </div>
          <p className="mt-3 text-xs text-muted-foreground">
            Legacy days show only values that were stored. Individual meal consumption was not
            recorded separately.
          </p>
        </Card>
      ) : (
        <Card className="py-8 text-center">
          <h2 className="font-semibold">No nutrition logged</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Choose another date to review saved nutrition entries and targets.
          </p>
        </Card>
      )}
    </AppShell>
  );
}

function HistoryMacro({ label, value, target }: { label: string; value: string; target: string }) {
  return (
    <Card className="p-3">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="mt-1 font-semibold tabular-nums">{value}</p>
      <p className="text-[11px] text-muted-foreground">{target}</p>
    </Card>
  );
}
