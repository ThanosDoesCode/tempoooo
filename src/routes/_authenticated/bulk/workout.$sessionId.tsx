import { createFileRoute, Link } from "@tanstack/react-router";
import { AppShell, PageHeader } from "@/components/AppShell";
import { BulkWorkoutSessionView } from "@/components/BulkWorkoutSession";
import { Button } from "@/components/ui/button";
import { DataError } from "@/components/ui-kit";
import { useBulkTrainingSession } from "@/lib/bulk-training-sessions";
import { userFacingError } from "@/lib/network-errors";

export const Route = createFileRoute("/_authenticated/bulk/workout/$sessionId")({
  head: () => ({ meta: [{ title: "Tempo" }] }),
  component: BulkWorkoutPage,
});

function BulkWorkoutPage() {
  const { sessionId } = Route.useParams();
  const session = useBulkTrainingSession(sessionId);
  return (
    <AppShell>
      <PageHeader title="Workout" />
      {session.isLoading ? (
        <div className="space-y-3">
          <div className="h-28 animate-pulse rounded-2xl bg-card" />
          <div className="h-64 animate-pulse rounded-2xl bg-card" />
        </div>
      ) : session.error ? (
        <DataError
          message={userFacingError(session.error, "load this workout")}
          onRetry={() => void session.refetch()}
        />
      ) : session.data ? (
        <BulkWorkoutSessionView session={session.data} />
      ) : (
        <div className="rounded-2xl bg-card p-4 text-center">
          <p className="font-semibold">Workout unavailable</p>
          <p className="mt-1 text-sm text-muted-foreground">
            This workout does not exist or does not belong to your Bulk profile.
          </p>
          <Button asChild variant="outline" className="mt-4 min-h-11">
            <Link to="/bulk/training">Back to Training</Link>
          </Button>
        </div>
      )}
    </AppShell>
  );
}
