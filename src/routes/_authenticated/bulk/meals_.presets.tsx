import { createFileRoute } from "@tanstack/react-router";
import { AppShell, PageHeader } from "@/components/AppShell";
import { BulkMealPresets } from "@/components/BulkMealPresets";
import { Card } from "@/components/ui-kit";
import { MEAL_PLANS } from "@/lib/meals";
import { useBulkMeta } from "@/lib/store";
import { bulkPlanModeFor, useMemberships } from "@/lib/bulk-access";

export const Route = createFileRoute("/_authenticated/bulk/meals_/presets")({
  head: () => ({ meta: [{ title: "Tempo" }] }),
  component: MealPresetsPage,
});

function MealPresetsPage() {
  const { bulkId } = useBulkMeta();
  const memberships = useMemberships();
  const planMode = bulkPlanModeFor(memberships.data, bulkId);
  return (
    <AppShell>
      <PageHeader title="Meal presets" subtitle="Reusable saved meals for faster logging." />
      {!bulkId || planMode === "none" ? (
        <div className="h-40 animate-pulse rounded-2xl bg-card" aria-label="Loading meal presets" />
      ) : planMode === "public" ? (
        <BulkMealPresets bulkProfileId={bulkId} />
      ) : (
        <LegacyMealPresets />
      )}
    </AppShell>
  );
}

function LegacyMealPresets() {
  return (
    <div className="space-y-3">
      <p className="text-sm text-muted-foreground">
        Your fixed My Bulk meal plans. Choose the plan for the day from My Bulk.
      </p>
      {MEAL_PLANS.map((plan) => (
        <Card key={plan.id} className="p-3">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <h2 className="font-semibold">{plan.name}</h2>
              <p className="mt-1 text-xs leading-5 text-muted-foreground">
                {plan.meals.join(" · ")}
              </p>
            </div>
            {plan.macros ? (
              <span className="shrink-0 text-right text-xs tabular-nums text-muted-foreground">
                {plan.macros.calories} kcal
                <span className="block">{plan.macros.protein} g protein</span>
              </span>
            ) : null}
          </div>
        </Card>
      ))}
    </div>
  );
}
