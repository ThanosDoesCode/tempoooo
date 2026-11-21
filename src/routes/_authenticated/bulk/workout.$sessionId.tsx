import { createFileRoute, useRouter } from "@tanstack/react-router";
import { AppShell, PageHeader } from "@/components/AppShell";
import { BulkWorkoutSessionView } from "@/components/BulkWorkoutSession";
import { HistoryBackLink } from "@/components/HistoryBackLink";
import { DataError } from "@/components/ui-kit";
import { useBulkTrainingSession } from "@/lib/bulk-training-sessions";
import { userFacingError } from "@/lib/network-errors";
import { useMemo, useState } from "react";
import { isRetiredInAppPath } from "@/lib/in-app-back";
import { useBulkMeta } from "@/lib/store";
import { useBulkProgressionTargets } from "@/lib/bulk-progression-query";

export const Route = createFileRoute("/_authenticated/bulk/workout/$sessionId")({
  head: () => ({ meta: [{ title: "Tempo" }] }),
  component: BulkWorkoutPage,
});

function BulkWorkoutPage() {
  const { sessionId } = Route.useParams();
  const router = useRouter();
  const [discardedSessionId, setDiscardedSessionId] = useState<string | null>(null);
  const discarded =
    discardedSessionId === sessionId ||
    isRetiredInAppPath(router.history, `/bulk/workout/${sessionId}`);
  const { bulkId } = useBulkMeta();
  const session = useBulkTrainingSession(discarded ? null : sessionId);
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
      {!session.data ? (
        <PageHeader title="Workout" backTo="/bulk/training" backLabel="Training" />
      ) : null}
      {discarded ? (
        <div className="rounded-2xl bg-card p-4 text-center" role="status">
          <p className="font-semibold">Workout discarded</p>
          <HistoryBackLink fallback="/bulk/training" fallbackLabel="Training" />
        </div>
      ) : session.isLoading ? (
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
        <BulkWorkoutSessionView
          key={session.data.id}
          session={session.data}
          progression={progression.data ?? {}}
          onDiscarded={() => setDiscardedSessionId(sessionId)}
        />
      ) : (
        <div className="rounded-2xl bg-card p-4 text-center">
          <p className="font-semibold">Workout unavailable</p>
          <p className="mt-1 text-sm text-muted-foreground">
            This workout does not exist or does not belong to your Goal.
          </p>
          <HistoryBackLink fallback="/bulk/training" fallbackLabel="Training" />
        </div>
      )}
    </AppShell>
  );
}
