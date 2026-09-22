import { createFileRoute } from "@tanstack/react-router";
import { AppShell, PageHeader } from "@/components/AppShell";

export const Route = createFileRoute("/_authenticated/bulk/meals_/more")({
  head: () => ({ meta: [{ title: "Tempo" }] }),
  component: MealsMorePage,
});

function MealsMorePage() {
  return (
    <AppShell>
      <PageHeader title="Meal tools" subtitle="Manage reusable meals and nutrition records." />
    </AppShell>
  );
}
