import { createFileRoute, redirect } from "@tanstack/react-router";
import { AppShell } from "@/components/AppShell";
import { PageSkeleton } from "@/components/PageSkeleton";
import { PlanActivityForm } from "@/components/PlanActivityForm";
import {
  bulkOwnerQueryOptions,
  bulkPlanModeFor,
  preferredBulkMembership,
  useMemberships,
} from "@/lib/bulk-access";
import { isPlannerDate, type PlannedActivityType } from "@/lib/planner";
import { useLocalDay } from "@/lib/use-local-day";

type NewSearch = { type?: PlannedActivityType | undefined; date?: string | undefined };

export const Route = createFileRoute("/_authenticated/planner_/new")({
  validateSearch: (search: Record<string, unknown>): NewSearch => ({
    type:
      search["type"] === "run" || search["type"] === "ride" || search["type"] === "workout"
        ? search["type"]
        : undefined,
    date: isPlannerDate(search["date"]) ? search["date"] : undefined,
  }),
  beforeLoad: async ({ context }) => {
    const memberships = await context.queryClient.ensureQueryData(bulkOwnerQueryOptions());
    const preferred = preferredBulkMembership(memberships);
    if (!preferred) throw redirect({ to: "/bulk-access-denied", replace: true });
    if (bulkPlanModeFor(memberships, preferred.bulk_profile_id) !== "public")
      throw redirect({ to: "/bulk", replace: true });
  },
  head: () => ({ meta: [{ title: "Tempo" }] }),
  component: NewPlannedActivity,
});

function NewPlannedActivity() {
  const { type, date } = Route.useSearch();
  const today = useLocalDay();
  const profileId = preferredBulkMembership(useMemberships().data)?.bulk_profile_id ?? null;
  return (
    <AppShell>
      {profileId ? (
        <PlanActivityForm
          profileId={profileId}
          today={today}
          initialType={type}
          initialDate={date && date >= today ? date : undefined}
        />
      ) : (
        <PageSkeleton label="Loading planner" />
      )}
    </AppShell>
  );
}
