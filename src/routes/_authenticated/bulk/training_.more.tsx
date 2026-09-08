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
import { userFacingError } from "@/lib/network-errors";
import { useAppData, useBulkMeta } from "@/lib/store";
import { useActiveTrainingPlan } from "@/lib/training-plans-query";

export const Route = createFileRoute("/_authenticated/bulk/training_/more")({
  head: () => ({ meta: [{ title: "Tempo" }] }),
  component: TrainingMorePage,
});

function TrainingMorePage() {
  const data = useAppData();
  const { bulkId } = useBulkMeta();
  const queryClient = useQueryClient();
  const usesPlanSetup = !!data?.targets.trainingSetupPreference;
  const activePlan = useActiveTrainingPlan(usesPlanSetup ? bulkId : null);
  const coverage = useBulkMuscleCoverage(usesPlanSetup ? (activePlan.data ?? null) : null);
  const [editing, setEditing] = useState(false);

  return (
    <AppShell>
      <PageHeader title="Training tools" subtitle="Manage your plan and exercise library." />

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
              setEditing(false);
            }}
          />
        ) : (
          <div className="space-y-3">
            <Card>
              <SectionTitle>Current plan</SectionTitle>
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
            </Card>
            <BulkMuscleCoverage
              result={coverage.data}
              loading={coverage.isLoading}
              error={coverage.error}
              onRetry={() => void coverage.refetch()}
            />
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
