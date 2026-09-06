import { createFileRoute } from "@tanstack/react-router";
import { AppShell, PageHeader } from "@/components/AppShell";
import { BulkMealPresets } from "@/components/BulkMealPresets";
import { useBulkMeta } from "@/lib/store";

export const Route = createFileRoute("/_authenticated/bulk/meals")({
  head: () => ({ meta: [{ title: "Tempo" }] }),
  component: BulkMealsPage,
});

function BulkMealsPage() {
  const { bulkId } = useBulkMeta();
  return (
    <AppShell>
      <PageHeader title="Meals" subtitle="Reusable meals with your own ingredients and macros." />
      {bulkId ? <BulkMealPresets bulkProfileId={bulkId} /> : null}
    </AppShell>
  );
}
