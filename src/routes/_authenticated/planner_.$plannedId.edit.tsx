import { createFileRoute, Link, redirect } from "@tanstack/react-router";
import { AppShell } from "@/components/AppShell";
import { PageSkeleton } from "@/components/PageSkeleton";
import { PlanActivityForm } from "@/components/PlanActivityForm";
import { DataError } from "@/components/ui-kit";
import {
  bulkOwnerQueryOptions,
  bulkPlanModeFor,
  preferredBulkMembership,
  useMemberships,
} from "@/lib/bulk-access";
import { usePlannedItem } from "@/lib/planner-query";
import { useLocalDay } from "@/lib/use-local-day";

export const Route = createFileRoute("/_authenticated/planner_/$plannedId/edit")({
  beforeLoad: async ({ context }) => {
    const memberships = await context.queryClient.ensureQueryData(bulkOwnerQueryOptions());
    const preferred = preferredBulkMembership(memberships);
    if (!preferred) throw redirect({ to: "/bulk-access-denied", replace: true });
    if (bulkPlanModeFor(memberships, preferred.bulk_profile_id) !== "public")
      throw redirect({ to: "/bulk", replace: true });
  },
  head: () => ({ meta: [{ title: "Tempo" }] }),
  component: EditPlannedActivity,
});

function EditPlannedActivity() {
  const { plannedId } = Route.useParams();
  const today = useLocalDay();
  const profileId = preferredBulkMembership(useMemberships().data)?.bulk_profile_id ?? null;
  const item = usePlannedItem(profileId, plannedId);
  return (
    <AppShell>
      {!profileId || item.isLoading ? (
        <PageSkeleton label="Loading planned activity" />
      ) : item.error ? (
        <DataError
          message="Could not load this planned activity. Nothing was changed."
          onRetry={() => void item.refetch()}
        />
      ) : !item.data ? (
        <div className="space-y-3 pt-6">
          <h1 className="text-2xl font-semibold">Planned activity not found</h1>
          <Link
            to="/planner"
            replace
            className="inline-flex min-h-11 items-center font-semibold text-primary"
          >
            Open Planner
          </Link>
        </div>
      ) : (
        // Keyed by version so a refetch after a conflict re-seeds the form from the saved row.
        <PlanActivityForm
          key={item.data.updatedAt}
          profileId={profileId}
          today={today}
          editing={item.data}
        />
      )}
    </AppShell>
  );
}
