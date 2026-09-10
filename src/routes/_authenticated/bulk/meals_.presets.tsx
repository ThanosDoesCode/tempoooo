import { createFileRoute, Navigate } from "@tanstack/react-router";
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
  if (planMode === "legacy") return <Navigate to="/bulk" replace />;
  return (
    <AppShell>
      <PageHeader title="Meal presets" subtitle="Reusable saved meals for faster logging." />
      {bulkId && planMode === "public" ? <BulkMealPresets bulkProfileId={bulkId} /> : null}
    </AppShell>
  );
}
