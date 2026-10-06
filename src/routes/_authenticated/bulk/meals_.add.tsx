import { createFileRoute, Link } from "@tanstack/react-router";
import { AppShell, PageHeader } from "@/components/AppShell";
import { BulkNutritionLog } from "@/components/BulkNutritionLog";
import { PageSkeleton } from "@/components/PageSkeleton";
import { useAppData, useBulkMeta } from "@/lib/store";
import { useLocalDay } from "@/lib/use-local-day";
import { isIsoLocalDay } from "@/lib/bulk-nutrition";
import { bulkPlanModeFor, useMemberships } from "@/lib/bulk-access";
export const Route = createFileRoute("/_authenticated/bulk/meals_/add")({
  validateSearch: (search: Record<string, unknown>) => ({
    date:
      typeof search["date"] === "string" && isIsoLocalDay(search["date"])
        ? search["date"]
        : undefined,
  }),
  head: () => ({ meta: [{ title: "Tempo" }] }),
  component: AddMealPage,
});
function AddMealPage() {
  const { date } = Route.useSearch();
  const today = useLocalDay();
  const selectedDate = date ?? today;
  const data = useAppData();
  const { bulkId } = useBulkMeta();
  const memberships = useMemberships();
  const mode = bulkPlanModeFor(memberships.data, bulkId);
  return (
    <AppShell>
      <PageHeader
        title="Add meal"
        backTo="/bulk/meals"
        backLabel="Meals"
        backSearch={{ date: selectedDate }}
      />
      {!data || !bulkId || mode === "none" ? (
        <PageSkeleton />
      ) : mode === "public" ? (
        <BulkNutritionLog
          key={`${bulkId}:${selectedDate}`}
          mode="add"
          bulkProfileId={bulkId}
          selectedDate={selectedDate}
          onDateChange={() => {}}
          currentTargets={data.targets}
        />
      ) : (
        <div className="card-surface p-[18px]">
          <p className="text-sm text-muted-foreground">
            Your legacy daily meal plan uses the existing daily log.
          </p>
          <Link
            to="/bulk/daily-log"
            className="mt-3 inline-flex min-h-11 items-center text-primary"
          >
            Open daily log
          </Link>
        </div>
      )}
    </AppShell>
  );
}
