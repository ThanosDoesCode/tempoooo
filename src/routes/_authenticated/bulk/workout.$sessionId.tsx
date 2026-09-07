import { createFileRoute, Link } from "@tanstack/react-router";
import { AppShell, PageHeader } from "@/components/AppShell";
import { BulkWorkoutSessionView } from "@/components/BulkWorkoutSession";
import { Button } from "@/components/ui/button";
import { DataError } from "@/components/ui-kit";
import { useBulkTrainingSession } from "@/lib/bulk-training-sessions";
import { userFacingError } from "@/lib/network-errors";
import { useMemo } from "react";
import { useBulkMeta } from "@/lib/store";
import { useBulkProgressionTargets } from "@/lib/bulk-progression-query";

export const Route = createFileRoute("/_authenticated/bulk/workout/$sessionId")({
  head: () => ({ meta: [{ title: "Tempo" }] }),
  component: BulkWorkoutPage,
});

function BulkWorkoutPage() {
  const { sessionId } = Route.useParams();
  const { bulkId } = useBulkMeta();
  const session = useBulkTrainingSession(sessionId);
  const progressionInputs = useMemo(
    () =>
      session.data?.exercises.map((exercise) => ({
        planExerciseId: exercise.sourcePlanExerciseId ?? `session:${exercise.id}`,
        exerciseId: exercise.sourceExerciseId,
        executionMode: exercise.executionMode,
        isBodyweight: exercise.isBodyweight,
        targetSets: exercise.targetSets,
        repMin: exercise.targetRepMin,
        repMax: exercise.targetRepMax,
      })) ?? [],
    [session.data],
  );
  const progression = useBulkProgressionTargets(
    bulkId,
    progressionInputs,
    session.data?.id ?? "none",
  );
  return (
    <AppShell>
      <PageHeader title="Workout" backTo="/bulk/training" backLabel="Training" />
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
        <BulkWorkoutSessionView session={session.data} progression={progression.data ?? {}} />
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
