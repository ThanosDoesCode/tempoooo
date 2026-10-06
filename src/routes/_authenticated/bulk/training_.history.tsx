import { useQueryClient } from "@tanstack/react-query";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useMemo, useRef, useState } from "react";
import { z } from "zod";
import { AppShell, PageHeader } from "@/components/AppShell";
import { HistoryBackLink } from "@/components/HistoryBackLink";
import {
  WorkoutHistoryList,
  WorkoutDetail,
  WorkoutTimeDialog,
  ConfirmWorkoutRemoval,
} from "@/components/WorkoutHistory";
import { TrainingSession } from "@/components/TrainingSession";
import { DataError } from "@/components/ui-kit";
import {
  useCompletedBulkTrainingSessions,
  useActiveBulkTrainingSession,
  deleteCompletedBulkTrainingSession,
  deleteLegacyBulkWorkout,
  discardBulkTrainingSession,
  correctCompletedBulkTrainingSet,
  correctCompletedBulkTrainingTime,
  repeatCompletedBulkTrainingSession,
  workoutHistoryInvalidationKeys,
  correctLegacyBulkWorkoutTime,
  repeatLegacyBulkWorkout,
} from "@/lib/bulk-training-sessions";
import { workoutHistory, previousSameWorkout, type HistoryWorkout } from "@/lib/workout-history";
import { iso } from "@/lib/calc";
import { developmentErrorDiagnostic, userFacingError } from "@/lib/network-errors";
import { refreshBulk, useActions, useAppData, useBulkMeta } from "@/lib/store";
import { useActiveTrainingPlan } from "@/lib/training-plans-query";
import { bulkPlanModeFor, useMemberships } from "@/lib/bulk-access";
import { resolveWeeklyWorkoutTarget } from "@/lib/goal-metrics";
import { useAuth } from "@/lib/auth";

export const Route = createFileRoute("/_authenticated/bulk/training_/history")({
  validateSearch: z.object({
    session: z.string().uuid().optional(),
    legacy: z.string().optional(),
  }),
  head: () => ({ meta: [{ title: "Tempo" }] }),
  component: TrainingHistoryPage,
});

function TrainingHistoryPage() {
  const data = useAppData();
  const { bulkId } = useBulkMeta();
  const memberships = useMemberships();
  const mode = bulkPlanModeFor(memberships.data, bulkId);
  const plan = useActiveTrainingPlan(mode === "public" ? bulkId : null);
  const sessions = useCompletedBulkTrainingSessions(
    mode !== "none" ? bulkId : null,
    "2000-01-01",
    "2999-12-31",
  );
  const active = useActiveBulkTrainingSession(mode !== "none" ? bulkId : null);
  const { user } = useAuth();
  const { saveWorkout } = useActions();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const search = Route.useSearch();
  const [pending, setPending] = useState(false);
  const busy = useRef(false);
  const [error, setError] = useState<string | null>(null);
  const [fixing, setFixing] = useState<HistoryWorkout | null>(null);
  const [discardOpen, setDiscardOpen] = useState(false);
  const rows = useMemo(() => workoutHistory(sessions.data ?? [], data), [sessions.data, data]);
  const selected = rows.find(
    (row) =>
      (!!search.session && row.session?.id === search.session) ||
      (!!search.legacy && row.legacy?.date === search.legacy),
  );
  const hasSelection = !!(search.session || search.legacy);
  const refresh = () =>
    Promise.all(
      workoutHistoryInvalidationKeys.map((queryKey) => queryClient.invalidateQueries({ queryKey })),
    );
  const act = async (action: () => Promise<unknown>): Promise<boolean> => {
    if (busy.current) return false;
    busy.current = true;
    setPending(true);
    setError(null);
    try {
      await action();
      await refresh();
      return true;
    } catch (cause) {
      developmentErrorDiagnostic("workout_history_action", cause);
      const details = cause as { code?: string; details?: string } | null;
      setError(
        details?.code === "55000" && details.details === "active_workout_exists"
          ? "Finish or discard your active workout before repeating this workout."
          : userFacingError(cause, "update this workout", { inputPreserved: true }),
      );
      return false;
    } finally {
      busy.current = false;
      setPending(false);
    }
  };
  const saveTime = async (row: HistoryWorkout, date: string, start: string, end: string) => {
    const ok = await act(async () => {
      if (row.session) await correctCompletedBulkTrainingTime(row.session.id, date, start, end);
      else {
        await correctLegacyBulkWorkoutTime(row.date, date, start, end);
        await refreshBulk();
      }
    });
    if (ok && row.legacy && hasSelection)
      await navigate({ to: "/bulk/training/history", search: { legacy: date }, replace: true });
    return ok;
  };
  return (
    <AppShell>
      {hasSelection ? (
        <HistoryBackLink
          fallback="/bulk/training/history"
          fallbackLabel="History"
          parentPath="/bulk/training/history"
          fallbackSearch={{}}
        />
      ) : (
        <HistoryBackLink
          fallback="/bulk/training"
          fallbackLabel="Training"
          originLabels={{ "/bulk/progress/strength": "Strength", "/bulk/training": "Training" }}
        />
      )}
      {!hasSelection ? <PageHeader title="Workout history" /> : null}
      {mode === "none" || !data || sessions.isLoading ? (
        <div
          className="h-48 motion-safe:animate-pulse rounded-[20px] bg-card"
          aria-label="Loading workout history"
        />
      ) : sessions.error ? (
        <DataError
          message={userFacingError(sessions.error, "load your training history")}
          onRetry={() => void sessions.refetch()}
        />
      ) : hasSelection ? (
        selected ? (
          <WorkoutDetail
            key={selected.key}
            row={selected}
            previous={previousSameWorkout(selected, rows)}
            pending={pending}
            error={error}
            onRepeat={() =>
              void act(async () => {
                const id = selected.session
                  ? await repeatCompletedBulkTrainingSession(selected.session.id, iso(new Date()))
                  : await repeatLegacyBulkWorkout(selected.date, iso(new Date()));
                await navigate({ to: "/bulk/workout/$sessionId", params: { sessionId: id } });
              })
            }
            onDelete={() =>
              void act(async () => {
                if (selected.session) await deleteCompletedBulkTrainingSession(selected.session.id);
                else {
                  await deleteLegacyBulkWorkout(selected.date);
                  await refreshBulk();
                }
                await navigate({ to: "/bulk/training/history", search: {}, replace: true });
              })
            }
            onSaveSet={(set) =>
              act(() => correctCompletedBulkTrainingSet(selected.session!.id, set))
            }
            onSaveTime={(date, start, end) => saveTime(selected, date, start, end)}
            legacyEditor={
              selected.legacy ? (
                <TrainingSession
                  data={data}
                  date={selected.date}
                  cacheKey={`tempo:history-edit:${bulkId}:${selected.date}`}
                  onSave={async (workout) => {
                    await saveWorkout(workout, user?.id);
                    await refresh();
                  }}
                />
              ) : null
            }
          />
        ) : (
          <div className="rounded-xl bg-card p-4">
            <p>Workout unavailable</p>
            <p className="mt-1 text-sm text-muted-foreground">It may have been deleted.</p>
            <Link
              to="/bulk/training/history"
              search={{}}
              className="inline-flex min-h-11 items-center text-primary"
            >
              Open workout history
            </Link>
          </div>
        )
      ) : (
        <>
          <WorkoutHistoryList
            rows={rows}
            today={iso(new Date())}
            expected={resolveWeeklyWorkoutTarget({
              weeklyWorkoutGoal: data.targets.weeklyWorkoutGoal ?? null,
              activePlanDaysPerWeek: plan.data?.trainingDaysPerWeek ?? null,
              targetDaysPerWeek: data.targets.trainingDaysPerWeek ?? null,
            })}
            planName={plan.data?.name}
            planId={plan.data?.id}
            planStartedAt={plan.data?.createdAt}
            active={active.data ?? null}
            pending={pending}
            onDiscard={() => setDiscardOpen(true)}
            onFixTime={setFixing}
          />
          {active.error ? (
            <DataError
              message={userFacingError(active.error, "load your unfinished workout")}
              onRetry={() => void active.refetch()}
            />
          ) : null}
          {error ? (
            <p role="alert" className="mt-3 text-sm text-danger">
              {error}
            </p>
          ) : null}
        </>
      )}
      {fixing ? (
        <WorkoutTimeDialog
          key={fixing.key}
          row={fixing}
          open
          onOpenChange={(open) => {
            if (!open) setFixing(null);
          }}
          pending={pending}
          error={error}
          onSave={(date, start, end) => saveTime(fixing, date, start, end)}
        />
      ) : null}
      <ConfirmWorkoutRemoval
        open={discardOpen}
        onOpenChange={setDiscardOpen}
        pending={pending}
        discard
        onConfirm={() =>
          void act(async () => {
            if (active.data) await discardBulkTrainingSession(active.data.id);
            setDiscardOpen(false);
          })
        }
      />
    </AppShell>
  );
}
