import { useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, Link, useNavigate, useRouter } from "@tanstack/react-router";
import { ArrowLeft, MoreHorizontal } from "lucide-react";
import { useState } from "react";
import { z } from "zod";
import { AppShell, PageHeader } from "@/components/AppShell";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Card, DataError, PendingLabel } from "@/components/ui-kit";
import {
  deleteCompletedBulkTrainingSession,
  deleteLegacyBulkWorkout,
  fetchRecentCompletedBulkTrainingSessions,
  type BulkTrainingSession,
} from "@/lib/bulk-training-sessions";
import {
  completedSessionVolume,
  completedWorkingSets,
  sessionElapsedSeconds,
  sessionSetLabel,
  skippedSessionSets,
} from "@/lib/bulk-training-session-domain";
import { readRetryDelay, shouldRetryRead, userFacingError } from "@/lib/network-errors";
import { refreshBulk, useAppData, useBulkMeta } from "@/lib/store";
import { splitLabel, type Workout } from "@/lib/types";
import { workoutDuration, workoutMetrics } from "@/lib/training";
import { bulkPlanModeFor, useMemberships } from "@/lib/bulk-access";

export const Route = createFileRoute("/_authenticated/bulk/training_/history")({
  validateSearch: z.object({
    session: z.string().uuid().optional(),
    legacy: z.string().optional(),
  }),
  head: () => ({ meta: [{ title: "Tempo" }] }),
  component: TrainingHistoryPage,
});

const durationLabel = (seconds: number | null | undefined) =>
  seconds && seconds > 0 ? `${Math.max(1, Math.round(seconds / 60))} min` : "Unavailable";

function TrainingHistoryPage() {
  const data = useAppData();
  const { bulkId } = useBulkMeta();
  const memberships = useMemberships();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const router = useRouter();
  const search = Route.useSearch();
  const planMode = bulkPlanModeFor(memberships.data, bulkId);
  const [confirming, setConfirming] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const sessions = useQuery({
    queryKey: ["bulk-training-sessions", "history", bulkId],
    enabled: planMode !== "none" && !!bulkId,
    queryFn: () => fetchRecentCompletedBulkTrainingSessions(bulkId!, 100),
    staleTime: 30_000,
    retry: shouldRetryRead,
    retryDelay: readRetryDelay,
  });
  const legacy = Object.values(data?.workouts ?? {})
    .filter((workout) => workout.status === "completed" || workout.status == null)
    .sort((a, b) => b.date.localeCompare(a.date));
  const selectedSession = sessions.data?.find((session) => session.id === search.session) ?? null;
  const selectedLegacy = legacy.find((workout) => workout.date === search.legacy) ?? null;

  const remove = async () => {
    if (deleting || (!selectedSession && !selectedLegacy)) return;
    setDeleting(true);
    setDeleteError(null);
    try {
      if (selectedSession) await deleteCompletedBulkTrainingSession(selectedSession.id);
      else if (selectedLegacy) {
        await deleteLegacyBulkWorkout(selectedLegacy.date);
        await refreshBulk();
      }
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["bulk-training-sessions"] }),
        queryClient.invalidateQueries({ queryKey: ["bulk-personal-records"] }),
        queryClient.invalidateQueries({ queryKey: ["bulk-progression"] }),
        queryClient.invalidateQueries({ queryKey: ["bulk-progress-summary"] }),
      ]);
      await navigate({ to: "/bulk/training/history", search: {}, replace: true });
    } catch (error) {
      setDeleteError(userFacingError(error, "delete this workout"));
    } finally {
      setDeleting(false);
      setConfirming(false);
    }
  };

  if (selectedSession || selectedLegacy) {
    return (
      <AppShell>
        <button
          type="button"
          onClick={() => router.history.back()}
          className="mb-2 inline-flex min-h-11 items-center gap-2 rounded-xl pr-3 text-sm font-semibold text-muted-foreground"
        >
          <ArrowLeft className="h-4 w-4" aria-hidden="true" /> History
        </button>
        <div className="flex items-start justify-between gap-3">
          <PageHeader
            title={selectedSession?.workoutDayName ?? splitLabel(selectedLegacy!.type)}
            subtitle={
              selectedSession
                ? `${new Date(selectedSession.completedAt!).toLocaleString("en-GB")} · ${selectedSession.planName}`
                : new Date(`${selectedLegacy!.date}T12:00:00`).toLocaleDateString("en-GB")
            }
          />
          <button
            type="button"
            aria-label="Workout actions"
            onClick={() => setConfirming(true)}
            className="grid min-h-11 min-w-11 place-items-center rounded-xl border border-border text-muted-foreground"
          >
            <MoreHorizontal className="h-5 w-5" aria-hidden="true" />
          </button>
        </div>
        {selectedSession ? (
          <PublicWorkoutDetail session={selectedSession} />
        ) : (
          <LegacyWorkoutDetail workout={selectedLegacy!} />
        )}
        {deleteError ? <p className="mt-3 text-sm text-danger">{deleteError}</p> : null}
        <AlertDialog open={confirming} onOpenChange={setConfirming}>
          <AlertDialogContent className="max-w-[calc(100%-2rem)] rounded-2xl">
            <AlertDialogHeader>
              <AlertDialogTitle>Delete workout?</AlertDialogTitle>
              <AlertDialogDescription>
                This workout and its logged sets will be permanently removed from your training
                history. This cannot be undone.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel className="min-h-11">Cancel</AlertDialogCancel>
              <AlertDialogAction
                disabled={deleting}
                onClick={(event) => {
                  event.preventDefault();
                  void remove();
                }}
                className="min-h-11 bg-danger text-white"
              >
                {deleting ? <PendingLabel>Deleting</PendingLabel> : "Delete workout"}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </AppShell>
    );
  }

  return (
    <AppShell>
      <PageHeader title="Training history" subtitle="Completed workouts, newest first." />
      {planMode === "none" || sessions.isLoading ? (
        <div className="h-40 animate-pulse rounded-2xl bg-card" />
      ) : sessions.error ? (
        <DataError
          message={userFacingError(sessions.error, "load your training history")}
          onRetry={() => void sessions.refetch()}
        />
      ) : sessions.data?.length || legacy.length ? (
        <div className="space-y-2">
          {sessions.data?.map((session) => (
            <PublicWorkoutCard key={session.id} session={session} />
          ))}
          {legacy.map((workout) => (
            <LegacyWorkoutCard key={workout.date} workout={workout} />
          ))}
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

function PublicWorkoutCard({ session }: { session: BulkTrainingSession }) {
  return (
    <Link
      to="/bulk/training/history"
      search={{ session: session.id }}
      className="card-surface block min-h-20 p-4 active:scale-[0.99]"
    >
      <h2 className="font-semibold">{session.workoutDayName}</h2>
      <p className="mt-0.5 text-xs text-muted-foreground">
        {new Date(session.completedAt!).toLocaleDateString("en-GB")} · {session.planName}
      </p>
      <p className="num mt-3 text-xs text-muted-foreground">
        {durationLabel(sessionElapsedSeconds(session.startedAt, Date.now(), session.completedAt))} ·{" "}
        {completedWorkingSets(session)} sets · {Math.round(completedSessionVolume(session))} kg
      </p>
    </Link>
  );
}

function LegacyWorkoutCard({ workout }: { workout: Workout }) {
  const metrics = workoutMetrics(workout);
  return (
    <Link
      to="/bulk/training/history"
      search={{ legacy: workout.date }}
      className="card-surface block min-h-20 p-4 active:scale-[0.99]"
    >
      <h2 className="font-semibold">{splitLabel(workout.type)}</h2>
      <p className="mt-0.5 text-xs text-muted-foreground">
        {new Date(`${workout.date}T12:00:00`).toLocaleDateString("en-GB")} · Original Tempo program
      </p>
      <p className="num mt-3 text-xs text-muted-foreground">
        {durationLabel(workoutDuration(workout))} · {metrics.workingSets} sets ·{" "}
        {Math.round(metrics.volume ?? 0)} kg
      </p>
    </Link>
  );
}

function PublicWorkoutDetail({ session }: { session: BulkTrainingSession }) {
  const skipped = skippedSessionSets(session);
  return (
    <div className="space-y-3">
      <Card className="grid grid-cols-3 gap-2 text-center">
        <Metric
          label="Duration"
          value={durationLabel(
            sessionElapsedSeconds(session.startedAt, Date.now(), session.completedAt),
          )}
        />
        <Metric label="Sets" value={String(completedWorkingSets(session))} />
        <Metric label="Volume" value={`${Math.round(completedSessionVolume(session))} kg`} />
      </Card>
      {session.exercises.map((exercise) => {
        const completed = exercise.sets.filter((set) => set.isComplete);
        if (!completed.length) return null;
        return (
          <Card key={exercise.id}>
            <h2 className="font-semibold">{exercise.name}</h2>
            <ol className="mt-3 space-y-2">
              {completed.map((set) => (
                <li
                  key={set.id}
                  className="flex justify-between gap-3 rounded-xl bg-elevated p-3 text-sm"
                >
                  <span>
                    Set {set.order}
                    {set.setType !== "normal" ? ` · ${set.setType}` : set.isExtra ? " · extra" : ""}
                  </span>
                  <span className="text-right font-medium tabular-nums">
                    {sessionSetLabel(set, exercise)}
                    {set.rpe != null ? (
                      <span className="block text-xs text-muted-foreground">RPE {set.rpe}</span>
                    ) : null}
                  </span>
                </li>
              ))}
            </ol>
            {exercise.notes ? (
              <p className="mt-2 text-xs text-muted-foreground">{exercise.notes}</p>
            ) : null}
          </Card>
        );
      })}
      {skipped ? (
        <p className="text-xs text-muted-foreground">{skipped} planned sets skipped.</p>
      ) : null}
    </div>
  );
}

function LegacyWorkoutDetail({ workout }: { workout: Workout }) {
  const metrics = workoutMetrics(workout);
  return (
    <div className="space-y-3">
      <Card className="grid grid-cols-3 gap-2 text-center">
        <Metric label="Duration" value={durationLabel(workoutDuration(workout))} />
        <Metric label="Sets" value={String(metrics.workingSets)} />
        <Metric label="Volume" value={`${Math.round(metrics.volume ?? 0)} kg`} />
      </Card>
      {workout.entries.map((entry) => {
        const completed = entry.reps.flatMap((reps, index) =>
          typeof reps === "number" && reps > 0 ? [{ reps, index }] : [],
        );
        if (!completed.length) return null;
        return (
          <Card key={entry.exercise}>
            <h2 className="font-semibold">{entry.exercise}</h2>
            <ol className="mt-3 space-y-2">
              {completed.map(({ reps, index }) => (
                <li key={index} className="flex justify-between rounded-xl bg-elevated p-3 text-sm">
                  <span>Set {index + 1}</span>
                  <span className="font-medium tabular-nums">
                    {entry.weight != null ? `${entry.weight} kg × ` : ""}
                    {reps}
                    {entry.rpe != null ? ` · RPE ${entry.rpe}` : ""}
                  </span>
                </li>
              ))}
            </ol>
            {entry.notes ? (
              <p className="mt-2 text-xs text-muted-foreground">{entry.notes}</p>
            ) : null}
          </Card>
        );
      })}
      {workout.sessionNote ? (
        <Card className="text-sm text-muted-foreground">{workout.sessionNote}</Card>
      ) : null}
    </div>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <p className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</p>
      <p className="num mt-1 truncate text-sm font-semibold">{value}</p>
    </div>
  );
}
