import { useQueryClient } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import { BookOpen, ChevronRight } from "lucide-react";
import { useState } from "react";
import { AppShell, PageHeader } from "@/components/AppShell";
import { BulkMuscleCoverage } from "@/components/BulkMuscleCoverage";
import { TrainingPlanEditor } from "@/components/TrainingPlanEditor";
import { TrainingPlanSetup } from "@/components/TrainingPlanSetup";
import { Button } from "@/components/ui/button";
import { Card, DataError, SectionTitle } from "@/components/ui-kit";
import { useBulkMuscleCoverage } from "@/lib/bulk-muscle-coverage-query";
import { useActiveBulkTrainingSession } from "@/lib/bulk-training-sessions";
import { userFacingError } from "@/lib/network-errors";
import { useAppData, useBulkMeta } from "@/lib/store";
import { useActiveTrainingPlan } from "@/lib/training-plans-query";
import { bulkPlanModeFor, useMemberships } from "@/lib/bulk-access";

export const Route = createFileRoute("/_authenticated/bulk/training_/more")({
  head: () => ({ meta: [{ title: "Tempo" }] }),
  component: TrainingMorePage,
});

function TrainingMorePage() {
  const data = useAppData();
  const { bulkId } = useBulkMeta();
  const memberships = useMemberships();
  const queryClient = useQueryClient();
  const planMode = bulkPlanModeFor(memberships.data, bulkId);
  const usesPlanSetup = planMode === "public";
  const activePlan = useActiveTrainingPlan(usesPlanSetup ? bulkId : null);
  const activeSession = useActiveBulkTrainingSession(usesPlanSetup ? bulkId : null);
  const coverage = useBulkMuscleCoverage(usesPlanSetup ? (activePlan.data ?? null) : null);
  const [editing, setEditing] = useState(false);
  const [coverageOpen, setCoverageOpen] = useState(false);

  if (planMode === "none") {
    return (
      <AppShell>
        <div className="h-40 animate-pulse rounded-2xl bg-card" />
      </AppShell>
    );
  }

  return (
    <AppShell>
      <PageHeader title="Your plan" historyBack backTo="/bulk/training" backLabel="Training" />

      {usesPlanSetup && activePlan.isLoading ? (
        <div className="h-48 animate-pulse rounded-2xl bg-card" />
      ) : usesPlanSetup && activePlan.error ? (
        <DataError
          message={userFacingError(activePlan.error, "load your training plan")}
          onRetry={() => void activePlan.refetch()}
        />
      ) : usesPlanSetup && activePlan.data ? (
        editing ? (
          <TrainingPlanEditor
            plan={activePlan.data}
            onCancel={() => setEditing(false)}
            onSaved={async () => {
              await activePlan.refetch();
              await Promise.all([
                queryClient.invalidateQueries({ queryKey: ["bulk-progression"] }),
                queryClient.invalidateQueries({ queryKey: ["bulk-muscle-coverage"] }),
              ]);
            }}
          />
        ) : (
          <div className="space-y-[14px]">
            <Card>
              <div className="mb-3 flex items-center justify-between gap-2">
                <SectionTitle>Current plan</SectionTitle>
                <span className="rounded-full bg-primary/10 px-2.5 py-1 text-xs text-primary">
                  Active
                </span>
              </div>
              <h2 className="text-xl font-semibold">{activePlan.data.name}</h2>
              <p className="mt-1 text-sm text-muted-foreground">
                {activePlan.data.days.length} workout day
                {activePlan.data.days.length === 1 ? "" : "s"}
              </p>
              <Button
                variant="outline"
                className="mt-4 min-h-11 w-full"
                onClick={() => setEditing(true)}
              >
                Edit training plan
              </Button>
              <details className="mt-3 border-t border-border pt-2">
                <summary className="flex min-h-11 cursor-pointer items-center justify-between font-medium">
                  Workout days <ChevronRight className="h-5 w-5" aria-hidden="true" />
                </summary>
                {activePlan.data.days.map((day) => (
                  <div key={day.id} className="py-3 first:pt-0 last:pb-0">
                    <h3 className="font-medium">
                      Day {day.order} · {day.name}
                    </h3>
                    <ol className="mt-2 space-y-2 text-sm text-muted-foreground">
                      {day.exercises.map((exercise) => (
                        <li key={exercise.id} className="flex justify-between gap-3">
                          <span className="min-w-0">{exercise.name}</span>
                          <span className="num shrink-0">
                            {exercise.sets} × {exercise.repMin}–{exercise.repMax}
                          </span>
                        </li>
                      ))}
                    </ol>
                  </div>
                ))}
              </details>
              <details
                className="mt-3 border-t border-border pt-2"
                onToggle={(event) => setCoverageOpen(event.currentTarget.open)}
              >
                <summary
                  aria-expanded={coverageOpen}
                  className="flex min-h-11 cursor-pointer items-center justify-between font-medium [&::-webkit-details-marker]:hidden"
                >
                  Muscle coverage
                  <ChevronRight
                    className={`h-5 w-5 transition-transform ${coverageOpen ? "rotate-90" : ""}`}
                    aria-hidden="true"
                  />
                </summary>
                <BulkMuscleCoverage
                  result={coverage.data}
                  loading={coverage.isLoading}
                  error={coverage.error}
                  onRetry={() => void coverage.refetch()}
                />
              </details>
            </Card>
            {activeSession.error ? (
              <DataError
                message={userFacingError(activeSession.error, "check your active workout")}
                onRetry={() => void activeSession.refetch()}
              />
            ) : null}
            <TrainingPlanSetup
              targets={data!.targets}
              replacingPlan
              currentPlan={activePlan.data}
              showCurrentPlan={false}
              selectionDisabled={
                activeSession.isLoading || !!activeSession.error || !!activeSession.data
              }
              onCreated={async () => {
                await activePlan.refetch();
              }}
            />
            {activeSession.data ? (
              <p className="text-sm text-muted-foreground">
                Finish or discard your current workout before changing plans.
              </p>
            ) : null}
          </div>
        )
      ) : usesPlanSetup && data ? (
        <TrainingPlanSetup targets={data.targets} />
      ) : (
        <Card>
          <SectionTitle>Legacy training</SectionTitle>
          <p className="text-sm text-muted-foreground">
            Your existing workout setup and history remain unchanged. Manage exercise order from the
            Training screen.
          </p>
        </Card>
      )}

      {!editing ? (
        <Link
          to="/bulk/exercises"
          preload="intent"
          className="card-surface mt-3 flex min-h-16 items-center gap-3 p-4 active:scale-[0.99]"
        >
          <span className="grid h-11 w-11 place-items-center rounded-xl bg-primary/10 text-primary">
            <BookOpen className="h-5 w-5" aria-hidden="true" />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block font-semibold">Exercise library</span>
            <span className="block text-xs text-muted-foreground">
              Browse exercises and create your own.
            </span>
          </span>
          <ChevronRight className="h-5 w-5 text-muted-foreground" aria-hidden="true" />
        </Link>
      ) : null}
    </AppShell>
  );
}
