import { createFileRoute } from "@tanstack/react-router";
import { AppShell, PageHeader } from "@/components/AppShell";
import { BulkMealPresets } from "@/components/BulkMealPresets";
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
      ) : (
        <BulkMealPresets bulkProfileId={bulkId} />
      )}
    </AppShell>
  );
}
