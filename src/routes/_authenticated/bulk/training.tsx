import { createFileRoute, Link } from "@tanstack/react-router";
import { format, parseISO } from "date-fns";
import { useState } from "react";
import { AppShell, PageHeader } from "@/components/AppShell";
import { TrainingSession } from "@/components/TrainingSession";
import { TrainingPlanOverview, TrainingPlanSetup } from "@/components/TrainingPlanSetup";
import { TrainingPlanEditor } from "@/components/TrainingPlanEditor";
import { iso } from "@/lib/calc";
import { useAuth } from "@/lib/auth";
import { useActions, useAppData, useBulkMeta } from "@/lib/store";
import { useActiveTrainingPlan } from "@/lib/training-plans-query";
import { DataError } from "@/components/ui-kit";
import { userFacingError } from "@/lib/network-errors";

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
  const usesPlanSetup = !!data?.targets.trainingSetupPreference;
  const activePlan = useActiveTrainingPlan(usesPlanSetup ? bulkId : null);
  const { saveWorkout, saveTargets } = useActions();
  const today = iso(new Date());
  const [date, setDate] = useState(today);
  const [editingPlan, setEditingPlan] = useState(false);
  return (
    <AppShell>
      <PageHeader
        title="Training"
        {...(!usesPlanSetup ? { subtitle: format(parseISO(date), "EEEE, d MMMM") } : {})}
      />
      <Link
        to="/bulk/exercises"
        preload="intent"
        className="mb-3 flex min-h-11 items-center justify-center rounded-xl border border-border px-3 text-sm font-semibold text-foreground active:scale-[0.98]"
      >
        Browse exercise library
      </Link>
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
      {usesPlanSetup && activePlan.isLoading ? (
        <div className="h-48 animate-pulse rounded-2xl bg-card" />
      ) : usesPlanSetup && activePlan.error ? (
        <DataError
          message={userFacingError(activePlan.error, "load your training plan")}
          onRetry={() => void activePlan.refetch()}
        />
      ) : usesPlanSetup && activePlan.data ? (
        editingPlan ? (
          <TrainingPlanEditor
            plan={activePlan.data}
            onCancel={() => setEditingPlan(false)}
            onSaved={async () => {
              await activePlan.refetch();
              setEditingPlan(false);
            }}
          />
        ) : (
          <TrainingPlanOverview plan={activePlan.data} onEdit={() => setEditingPlan(true)} />
        )
      ) : usesPlanSetup && data ? (
        <TrainingPlanSetup targets={data.targets} />
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
          readOnly={role === "viewer"}
        />
      ) : (
        <div className="h-40 animate-pulse rounded-2xl bg-card" />
      )}
    </AppShell>
  );
}
