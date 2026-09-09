import { useQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { AppShell, PageHeader } from "@/components/AppShell";
import { CompletedWorkout } from "@/components/BulkWorkoutSession";
import { Card, DataError } from "@/components/ui-kit";
import { fetchRecentCompletedBulkTrainingSessions } from "@/lib/bulk-training-sessions";
import { readRetryDelay, shouldRetryRead, userFacingError } from "@/lib/network-errors";
import { useAppData, useBulkMeta } from "@/lib/store";
import { splitLabel } from "@/lib/types";
import { workoutDuration, workoutMetrics } from "@/lib/training";
import { bulkPlanModeFor, useMemberships } from "@/lib/bulk-access";

export const Route = createFileRoute("/_authenticated/bulk/training_/history")({
  head: () => ({ meta: [{ title: "Tempo" }] }),
  component: TrainingHistoryPage,
});

function TrainingHistoryPage() {
  const data = useAppData();
  const { bulkId } = useBulkMeta();
  const memberships = useMemberships();
  const planMode = bulkPlanModeFor(memberships.data, bulkId);
  const isPublic = planMode === "public";
  const sessions = useQuery({
    queryKey: ["bulk-training-sessions", "history", bulkId],
    enabled: isPublic && !!bulkId,
    queryFn: () => fetchRecentCompletedBulkTrainingSessions(bulkId!, 100),
    staleTime: 30_000,
    retry: shouldRetryRead,
    retryDelay: readRetryDelay,
  });
  const legacy = Object.values(data?.workouts ?? {})
    .filter((workout) => workout.status === "completed" || workout.status == null)
    .sort((a, b) => b.date.localeCompare(a.date));

  return (
    <AppShell>
      <PageHeader title="Training history" subtitle="Completed workouts, newest first." />
      {planMode === "none" ? (
        <div className="h-40 animate-pulse rounded-2xl bg-card" />
      ) : isPublic && sessions.isLoading ? (
        <div className="h-40 animate-pulse rounded-2xl bg-card" />
      ) : isPublic && sessions.error ? (
        <DataError
          message={userFacingError(sessions.error, "load your training history")}
          onRetry={() => void sessions.refetch()}
        />
      ) : isPublic && sessions.data?.length ? (
        <div className="space-y-5">
          {sessions.data.map((session) => (
            <section key={session.id}>
              <p className="mb-2 text-xs font-medium text-muted-foreground">
                {new Date(session.completedAt ?? session.startedAt).toLocaleDateString("en-GB")}
              </p>
              <CompletedWorkout session={session} showBackLink={false} />
            </section>
          ))}
        </div>
      ) : planMode === "legacy" && legacy.length ? (
        <div className="space-y-3">
          {legacy.map((workout) => {
            const metrics = workoutMetrics(workout);
            const duration = workoutDuration(workout);
            return (
              <Card key={workout.date}>
                <p className="text-xs text-muted-foreground">
                  {new Date(`${workout.date}T12:00:00`).toLocaleDateString("en-GB")}
                </p>
                <h2 className="mt-1 font-semibold">{splitLabel(workout.type)}</h2>
                <p className="mt-1 text-sm text-muted-foreground">
                  {metrics.workingSets} working sets · {Math.round(metrics.volume ?? 0)} kg volume
                  {duration ? ` · ${Math.round(duration / 60)} min` : ""}
                </p>
              </Card>
            );
          })}
        </div>
      ) : (
        <Card className="py-8 text-center">
          <h2 className="font-semibold">No completed workouts yet</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Finished workouts will appear here without changing your active session.
          </p>
        </Card>
      )}
    </AppShell>
  );
}
