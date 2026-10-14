import { useQueryClient } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { useRef, useState } from "react";
import { toast } from "sonner";
import { AppShell, PageHeader } from "@/components/AppShell";
import { TrainingPlanEditor } from "@/components/TrainingPlanEditor";
import { TrainingPlanSetup } from "@/components/TrainingPlanSetup";
import { Button } from "@/components/ui/button";
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
import { BackButton } from "@/components/BackControl";
import { Card, DataError, PendingLabel, SectionTitle } from "@/components/ui-kit";
import { userFacingError } from "@/lib/network-errors";
import { useAppData, useBulkMeta } from "@/lib/store";
import {
  activateTrainingPlan,
  deleteTrainingPlan,
  duplicateTrainingPlan,
  useTrainingPlanById,
  useTrainingPlans,
  type TrainingPlanSummary,
} from "@/lib/training-plans-query";
import { bulkPlanModeFor, useMemberships } from "@/lib/bulk-access";

export const Route = createFileRoute("/_authenticated/bulk/training_/plans")({
  head: () => ({ meta: [{ title: "Tempo" }] }),
  component: MyPlansPage,
});

const PLAN_TYPE_LABEL: Record<string, string> = {
  tempo_preset: "Tempo program",
  custom: "Custom plan",
  generated: "Generated plan",
};

/** Domain errors our RPCs raise are already user-facing sentences; keep them verbatim. */
function planActionError(error: unknown, action: string): string {
  const message =
    error instanceof Error ? error.message : (error as { message?: unknown })?.message;
  const code = (error as { code?: unknown })?.code;
  if (code === "P0001" && typeof message === "string" && message) return message;
  return userFacingError(error, action);
}

function MyPlansPage() {
  const data = useAppData();
  const { bulkId } = useBulkMeta();
  const memberships = useMemberships();
  const queryClient = useQueryClient();
  const planMode = bulkPlanModeFor(memberships.data, bulkId);
  const usesPlanSetup = planMode === "public";
  const plans = useTrainingPlans(usesPlanSetup ? bulkId : null);

  const [view, setView] = useState<"list" | "create">("list");
  const [selected, setSelected] = useState<{ id: string; edit: boolean } | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<TrainingPlanSummary | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  // A plan created while another is active: saved but inactive, awaiting an explicit activation.
  const [savedInactive, setSavedInactive] = useState<string | null>(null);
  // One stable request id per logical duplicate action; reused on retry, cleared on success.
  const dupRequestIds = useRef<Map<string, string>>(new Map());

  const invalidateList = () => queryClient.invalidateQueries({ queryKey: ["bulk-training-plans"] });
  const invalidateActivePlan = () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: ["bulk-training-plan"] }),
      queryClient.invalidateQueries({ queryKey: ["bulk-progression"] }),
      queryClient.invalidateQueries({ queryKey: ["bulk-muscle-coverage"] }),
    ]);

  if (planMode === "none") {
    return (
      <AppShell>
        <div className="h-40 motion-safe:animate-pulse rounded-2xl bg-card" />
      </AppShell>
    );
  }

  if (!usesPlanSetup) {
    return (
      <AppShell>
        <PageHeader title="My plans" historyBack backTo="/bulk/training" backLabel="Training" />
        <Card>
          <p className="text-sm text-muted-foreground">
            Training plans are part of the fitness tools. Set up fitness to manage plans.
          </p>
        </Card>
      </AppShell>
    );
  }

  const backToList = () => {
    setSavedInactive(null);
    setView("list");
  };

  // --- Create ------------------------------------------------------------
  if (view === "create" && data) {
    if (savedInactive) {
      return (
        <AppShell>
          <BackButton onClick={backToList}>My plans</BackButton>
          <PageHeader title="Plan saved" />
          <Card className="space-y-3">
            <p className="text-sm text-muted-foreground">Your current plan is still active.</p>
            <Button
              className="min-h-11 w-full"
              disabled={busyId !== null}
              onClick={() =>
                void runPlanAction(
                  savedInactive,
                  "set this plan as active",
                  () => activateTrainingPlan(savedInactive),
                  async () => {
                    await Promise.all([invalidateList(), invalidateActivePlan()]);
                    toast.success("Plan activated");
                    backToList();
                  },
                )
              }
            >
              {busyId === savedInactive ? <PendingLabel>Working</PendingLabel> : "Set as active"}
            </Button>
            <Button variant="outline" className="min-h-11 w-full" onClick={backToList}>
              Done
            </Button>
          </Card>
        </AppShell>
      );
    }
    return (
      <AppShell>
        <BackButton onClick={() => setView("list")}>My plans</BackButton>
        <PageHeader title="Create plan" />
        <TrainingPlanSetup
          targets={data.targets}
          onCreated={async (planId) => {
            // The RPC activates a new plan only when none was active; otherwise it is saved inactive.
            const hadActive = plans.data?.some((plan) => plan.active) ?? false;
            await invalidateList();
            if (hadActive) setSavedInactive(planId);
            else setView("list");
          }}
        />
      </AppShell>
    );
  }

  // --- Open / Edit a selected plan --------------------------------------
  if (selected) {
    return (
      <PlanDetail
        planId={selected.id}
        edit={selected.edit}
        onEdit={() => setSelected({ id: selected.id, edit: true })}
        onBack={() => setSelected(null)}
        onSaved={async () => {
          await Promise.all([
            queryClient.invalidateQueries({ queryKey: ["bulk-training-plan-detail"] }),
            invalidateList(),
            invalidateActivePlan(),
          ]);
          setSelected(null);
        }}
      />
    );
  }

  async function runPlanAction(
    id: string,
    action: string,
    run: () => Promise<unknown>,
    after: () => Promise<unknown>,
  ) {
    if (busyId) return;
    setBusyId(id);
    try {
      await run();
      await after();
    } catch (error) {
      toast.error(planActionError(error, action));
    } finally {
      setBusyId(null);
    }
  }

  // --- List --------------------------------------------------------------
  return (
    <AppShell>
      <PageHeader title="My plans" historyBack backTo="/bulk/training" backLabel="Training" />
      <div className="space-y-[14px]">
        <Button className="min-h-11 w-full" onClick={() => setView("create")}>
          Create plan
        </Button>
        {plans.isLoading ? (
          <div className="h-40 motion-safe:animate-pulse rounded-2xl bg-card" />
        ) : plans.error ? (
          <DataError
            message={userFacingError(plans.error, "load your plans")}
            onRetry={() => void plans.refetch()}
          />
        ) : plans.data?.length ? (
          plans.data.map((plan) => (
            <Card key={plan.id} className="space-y-3">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <h2 className="truncate text-lg font-semibold">{plan.name}</h2>
                  <p className="mt-0.5 text-sm text-muted-foreground">
                    {PLAN_TYPE_LABEL[plan.planType] ?? "Plan"} · {plan.dayCount} workout
                    {plan.dayCount === 1 ? "" : "s"}
                  </p>
                </div>
                {plan.active ? (
                  <span className="shrink-0 rounded-full bg-primary/15 px-2.5 py-1 text-xs text-primary">
                    Active
                  </span>
                ) : null}
              </div>
              <div className="flex flex-wrap gap-2">
                <Button
                  variant="outline"
                  className="min-h-11 flex-1"
                  onClick={() => setSelected({ id: plan.id, edit: false })}
                >
                  Open
                </Button>
                <Button
                  variant="outline"
                  className="min-h-11 flex-1"
                  onClick={() => setSelected({ id: plan.id, edit: true })}
                >
                  Edit
                </Button>
                <Button
                  variant="outline"
                  className="min-h-11 flex-1"
                  disabled={busyId !== null}
                  onClick={() => {
                    const key = `dup:${plan.id}`;
                    let requestId = dupRequestIds.current.get(key);
                    if (!requestId) {
                      requestId = crypto.randomUUID();
                      dupRequestIds.current.set(key, requestId);
                    }
                    void runPlanAction(
                      plan.id,
                      "duplicate this plan",
                      () => duplicateTrainingPlan(plan.id, requestId),
                      async () => {
                        dupRequestIds.current.delete(key);
                        await invalidateList();
                        toast.success("Plan duplicated");
                      },
                    );
                  }}
                >
                  {busyId === plan.id ? <PendingLabel>Working</PendingLabel> : "Duplicate"}
                </Button>
                {!plan.active ? (
                  <Button
                    variant="outline"
                    className="min-h-11 flex-1"
                    disabled={busyId !== null}
                    onClick={() =>
                      void runPlanAction(
                        plan.id,
                        "set this plan as active",
                        () => activateTrainingPlan(plan.id),
                        async () => {
                          await Promise.all([invalidateList(), invalidateActivePlan()]);
                          toast.success("Plan activated");
                        },
                      )
                    }
                  >
                    Set as active
                  </Button>
                ) : null}
                <Button
                  variant="outline"
                  className="min-h-11 flex-1 text-destructive"
                  disabled={busyId !== null}
                  onClick={() => setConfirmDelete(plan)}
                >
                  Delete
                </Button>
              </div>
            </Card>
          ))
        ) : (
          <Card className="py-8 text-center">
            <h2 className="font-semibold">No training plans yet</h2>
            <p className="mx-auto mt-1 max-w-sm text-sm text-muted-foreground">
              Create a plan to start tracking your workouts.
            </p>
          </Card>
        )}
      </div>

      <AlertDialog
        open={confirmDelete !== null}
        onOpenChange={(open) => !open && setConfirmDelete(null)}
      >
        <AlertDialogContent className="w-[calc(100%-2.5rem)] max-w-sm gap-4 rounded-[20px] border-border bg-card p-5">
          <AlertDialogHeader>
            <AlertDialogTitle>
              {confirmDelete?.active
                ? "Delete active training plan?"
                : "Delete this training plan?"}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {confirmDelete?.active
                ? "You will have no active plan until you choose another one. Your completed workout history stays."
                : "Your completed workout history stays."}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep plan</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground"
              onClick={() => {
                const target = confirmDelete;
                setConfirmDelete(null);
                if (target)
                  void runPlanAction(
                    target.id,
                    "delete this plan",
                    () => deleteTrainingPlan(target.id),
                    async () => {
                      await invalidateList();
                      if (target.active) await invalidateActivePlan();
                      toast.success("Plan deleted");
                    },
                  );
              }}
            >
              Delete plan
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </AppShell>
  );
}

function PlanDetail({
  planId,
  edit,
  onEdit,
  onBack,
  onSaved,
}: {
  planId: string;
  edit: boolean;
  onEdit: () => void;
  onBack: () => void;
  onSaved: () => Promise<void>;
}) {
  const plan = useTrainingPlanById(planId);
  return (
    <AppShell>
      <BackButton onClick={onBack}>My plans</BackButton>
      <PageHeader title={edit ? "Edit plan" : "Plan"} />
      {plan.isLoading ? (
        <div className="h-48 motion-safe:animate-pulse rounded-2xl bg-card" />
      ) : plan.error ? (
        <DataError
          message={userFacingError(plan.error, "load this plan")}
          onRetry={() => void plan.refetch()}
        />
      ) : !plan.data ? (
        <Card>
          <p className="text-sm text-muted-foreground">This plan is no longer available.</p>
        </Card>
      ) : edit ? (
        <TrainingPlanEditor plan={plan.data} onCancel={onBack} onSaved={onSaved} />
      ) : (
        <div className="space-y-[14px]">
          <Card>
            <SectionTitle>Plan</SectionTitle>
            <h2 className="text-xl font-semibold">{plan.data.name}</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              {plan.data.days.length} workout{plan.data.days.length === 1 ? "" : "s"}
            </p>
            <Button variant="outline" className="mt-4 min-h-11 w-full" onClick={onEdit}>
              Edit plan
            </Button>
          </Card>
          {plan.data.days.map((day) => (
            <Card key={day.id}>
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
            </Card>
          ))}
        </div>
      )}
    </AppShell>
  );
}
