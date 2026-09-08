import { createFileRoute } from "@tanstack/react-router";
import { AppShell, PageHeader } from "@/components/AppShell";
import { BulkMealPresets } from "@/components/BulkMealPresets";
import { useBulkMeta } from "@/lib/store";

export const Route = createFileRoute("/_authenticated/bulk/meals_/presets")({
  head: () => ({ meta: [{ title: "Tempo" }] }),
  component: MealPresetsPage,
});

function MealPresetsPage() {
  const { bulkId } = useBulkMeta();
  return (
    <AppShell>
      <PageHeader title="Meal presets" subtitle="Reusable saved meals for faster logging." />
      {bulkId ? <BulkMealPresets bulkProfileId={bulkId} /> : null}
    </AppShell>
  );
}
