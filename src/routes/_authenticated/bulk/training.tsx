import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import { format, parseISO } from "date-fns";
import { useMemo, useState } from "react";
import { AppShell, PageHeader } from "@/components/AppShell";
import { TrainingSession } from "@/components/TrainingSession";
import { TrainingPlanOverview } from "@/components/TrainingPlanSetup";
import { iso } from "@/lib/calc";
import { useAuth } from "@/lib/auth";
import { useActions, useAppData, useBulkMeta } from "@/lib/store";
import { useActiveTrainingPlan } from "@/lib/training-plans-query";
import { Card, DataError, PendingLabel } from "@/components/ui-kit";
import { userFacingError } from "@/lib/network-errors";
import {
  startBulkTrainingSession,
  useActiveBulkTrainingSession,
} from "@/lib/bulk-training-sessions";
import { Button } from "@/components/ui/button";
import { useBulkProgressionTargets } from "@/lib/bulk-progression-query";

export const Route = createFileRoute("/_authenticated/bulk/training")({
  head: () => ({
    meta: [
      { title: "Tempo" },
      {
        name: "description",
        content: "Log sets, reps and weights with last session's numbers side by side.",
      },
      { property: "og:title", content: "Tempo" },
      {
        property: "og:description",
        content: "Exercise logging with progression status and strength history graphs.",
      },
    ],
  }),
  component: TrainingPage,
});

function TrainingPage() {
  const data = useAppData();
  const { user } = useAuth();
  const { bulkId, role } = useBulkMeta();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const usesPlanSetup = !!data?.targets.trainingSetupPreference;
  const activePlan = useActiveTrainingPlan(usesPlanSetup ? bulkId : null);
  const { saveWorkout, saveTargets } = useActions();
  const today = iso(new Date());
  const [date, setDate] = useState(today);
  const [startingDayId, setStartingDayId] = useState<string | null>(null);
  const activeSession = useActiveBulkTrainingSession(usesPlanSetup ? bulkId : null);
  const progressionInputs = useMemo(
    () =>
      activePlan.data?.days.flatMap((day) =>
        day.exercises.map((exercise) => ({
          planExerciseId: exercise.id,
          exerciseId: exercise.exerciseId,
          executionMode: exercise.intendedUnilateralMode,
          isBodyweight: exercise.isBodyweight,
          targetSets: exercise.sets,
          repMin: exercise.repMin,
          repMax: exercise.repMax,
        })),
      ) ?? [],
    [activePlan.data],
  );
  const progression = useBulkProgressionTargets(
    usesPlanSetup ? bulkId : null,
    progressionInputs,
    activePlan.data?.updatedAt ?? "none",
  );

  async function startWorkout(planDayId: string) {
    setStartingDayId(planDayId);
    try {
      const sessionId = await startBulkTrainingSession(planDayId);
      await queryClient.invalidateQueries({ queryKey: ["bulk-training-session"] });
      await navigate({ to: "/bulk/workout/$sessionId", params: { sessionId } });
    } catch (error) {
      const message = userFacingError(error, "start your workout");
      const { toast } = await import("sonner");
      toast.error(message);
    } finally {
      setStartingDayId(null);
    }
  }
  return (
    <AppShell>
      <PageHeader
        title="Training"
        {...(!usesPlanSetup ? { subtitle: format(parseISO(date), "EEEE, d MMMM") } : {})}
      />
      {usesPlanSetup && activeSession.isLoading ? (
        <div className="mb-3 h-20 animate-pulse rounded-2xl bg-card" />
      ) : activeSession.data ? (
        <Card className="mb-3 border-primary/40 bg-primary/5">
          <p className="text-xs font-semibold uppercase tracking-wider text-primary">
            Workout in progress
          </p>
          <p className="mt-1 font-semibold">{activeSession.data.workoutDayName}</p>
          <p className="text-xs text-muted-foreground">{activeSession.data.planName}</p>
          <Button asChild className="mt-3 min-h-11 w-full">
            <Link to="/bulk/workout/$sessionId" params={{ sessionId: activeSession.data.id }}>
              Resume Workout
            </Link>
          </Button>
        </Card>
      ) : null}
      {!usesPlanSetup ? (
        <label className="mb-3 flex items-center justify-between gap-3 text-xs text-muted-foreground">
          Training date
          <input
            type="date"
            value={date}
            max={today}
            onChange={(event) => {
              if (event.target.value && event.target.value <= today) setDate(event.target.value);
            }}
            className="min-h-11 min-w-0 rounded-xl border border-input bg-elevated px-3 text-base outline-none focus:border-ring"
          />
        </label>
      ) : null}
      <div>
        {usesPlanSetup && activePlan.isLoading ? (
          <div className="h-48 animate-pulse rounded-2xl bg-card" />
        ) : usesPlanSetup && activePlan.error ? (
          <DataError
            message={userFacingError(activePlan.error, "load your training plan")}
            onRetry={() => void activePlan.refetch()}
          />
        ) : usesPlanSetup && activePlan.data ? (
          <TrainingPlanOverview
            plan={activePlan.data}
            onStart={(dayId) => void startWorkout(dayId)}
            startingDayId={startingDayId}
            workoutActive={!!activeSession.data}
            progression={progression.data ?? {}}
          />
        ) : usesPlanSetup && data ? (
          <Card className="py-8 text-center">
            <h2 className="font-semibold">You haven&apos;t chosen a training plan yet</h2>
            <p className="mx-auto mt-1 max-w-sm text-sm text-muted-foreground">
              Pick a plan to start tracking today&apos;s workouts.
            </p>
            <Button asChild className="mt-4 min-h-11">
              <Link to="/bulk/training/more">Choose training plan</Link>
            </Button>
          </Card>
        ) : data && bulkId && user ? (
          <TrainingSession
            key={`${user.id}:${bulkId}:${date}`}
            data={data}
            date={date}
            cacheKey={`training-draft:${user.id}:${bulkId}:${date}`}
            onSave={(workout) => saveWorkout(workout, user.id)}
            onSaveSetupNote={async (exercise, note) => {
              const notes = { ...(data.targets.exerciseSetupNotes ?? {}) };
              if (note) notes[exercise] = note;
              else delete notes[exercise];
              await saveTargets({ ...data.targets, exerciseSetupNotes: notes });
            }}
            onReorderExercises={async (split, exerciseNames) => {
              await saveTargets({
                ...data.targets,
                legacyExerciseOrder: {
                  ...(data.targets.legacyExerciseOrder ?? {}),
                  [split]: exerciseNames,
                },
              });
            }}
            onRemoveExercise={async (split, exerciseName, nextWorkout) => {
              const definitions = data.targets.legacyExerciseDefinitions?.[split] ?? [];
              await saveWorkout(nextWorkout, user.id);
              await saveTargets({
                ...data.targets,
                legacyExerciseDefinitions: {
                  ...(data.targets.legacyExerciseDefinitions ?? {}),
                  [split]: definitions.filter((exercise) => exercise.name !== exerciseName),
                },
                legacyExerciseOrder: {
                  ...(data.targets.legacyExerciseOrder ?? {}),
                  [split]: (data.targets.legacyExerciseOrder?.[split] ?? []).filter(
                    (name) => name !== exerciseName,
                  ),
                },
              });
            }}
            readOnly={role === "viewer"}
          />
        ) : (
          <div className="h-40 animate-pulse rounded-2xl bg-card" />
        )}
      </div>
    </AppShell>
  );
}
