import { useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Check, ChevronDown, ChevronUp, Dumbbell } from "lucide-react";
import { toast } from "sonner";
import type { Targets } from "@/lib/types";
import {
  formatEquipment,
  planCompatibility,
  rankTrainingPlans,
  recommendTrainingPlan,
  type TrainingPlanTemplate,
  type UserTrainingPlan,
} from "@/lib/training-plans";
import {
  createEmptyTrainingPlan,
  instantiateTrainingPlan,
  useTrainingPlanTemplates,
} from "@/lib/training-plans-query";
import { userFacingError } from "@/lib/network-errors";
import { Button } from "@/components/ui/button";
import { Card, DataError, PendingLabel, SectionTitle } from "@/components/ui-kit";

function PlanDetail({ plan }: { plan: TrainingPlanTemplate }) {
  return (
    <div className="space-y-3">
      {plan.days.map((day) => (
        <div key={day.id} className="rounded-xl border border-border/70 bg-elevated/50 p-3">
          <p className="font-semibold text-foreground">
            Day {day.order} · {day.name}
          </p>
          <ul className="mt-2 space-y-1.5 text-sm text-muted-foreground">
            {day.exercises.map((exercise) => (
              <li key={exercise.id} className="flex items-start justify-between gap-3">
                <span>{exercise.name}</span>
                <span className="shrink-0 tabular-nums text-foreground/80">
                  {exercise.sets} × {exercise.repMin}–{exercise.repMax}
                </span>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </div>
  );
}

function PlanCard({
  plan,
  targets,
  expanded,
  onToggle,
  onUse,
  pending,
}: {
  plan: TrainingPlanTemplate;
  targets: Targets;
  expanded: boolean;
  onToggle: () => void;
  onUse: () => void;
  pending: boolean;
}) {
  const compatibility = planCompatibility(
    plan,
    targets.experienceLevel!,
    targets.trainingDaysPerWeek!,
    targets.availableEquipment!,
  );
  return (
    <Card className="space-y-3">
      <button
        type="button"
        onClick={onToggle}
        className="flex min-h-11 w-full items-start justify-between gap-3 text-left"
        aria-expanded={expanded}
      >
        <span>
          <span className="block font-semibold text-foreground">{plan.name}</span>
          <span className="mt-1 block text-xs capitalize text-muted-foreground">
            {plan.experienceLevel} · {plan.trainingDaysPerWeek} days/week
          </span>
        </span>
        {expanded ? <ChevronUp aria-hidden="true" /> : <ChevronDown aria-hidden="true" />}
      </button>
      <p className="text-sm leading-relaxed text-muted-foreground">{plan.description}</p>
      <p className="text-xs text-muted-foreground">{plan.splitSummary}</p>
      {compatibility.equipmentCompatible ? (
        <p className="flex items-center gap-1.5 text-xs font-medium text-good">
          <Check className="h-4 w-4" aria-hidden="true" /> Works with your equipment
        </p>
      ) : (
        <p className="rounded-lg bg-warn/10 px-2.5 py-2 text-xs text-warn">
          Requires equipment you did not select:{" "}
          {compatibility.missingEquipment.map(formatEquipment).join(", ")}.
        </p>
      )}
      {!compatibility.exactExperience || !compatibility.exactDays ? (
        <p className="rounded-lg bg-secondary px-2.5 py-2 text-xs text-muted-foreground">
          Closest available match: {plan.experienceLevel} level, {plan.trainingDaysPerWeek} days per
          week. Your selection is {targets.experienceLevel}, {targets.trainingDaysPerWeek} days per
          week.
        </p>
      ) : null}
      {expanded ? <PlanDetail plan={plan} /> : null}
      <Button className="min-h-11 w-full" onClick={onUse} disabled={pending}>
        {pending ? <PendingLabel>Creating your plan</PendingLabel> : "Use This Plan"}
      </Button>
    </Card>
  );
}

export function TrainingPlanSetup({ targets }: { targets: Targets }) {
  const queryClient = useQueryClient();
  const templates = useTrainingPlanTemplates();
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [showOthers, setShowOthers] = useState(false);
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [customName, setCustomName] = useState("My Training Plan");
  const preference = targets.trainingSetupPreference!;
  const ranked = useMemo(
    () =>
      rankTrainingPlans(
        templates.data ?? [],
        targets.experienceLevel!,
        targets.trainingDaysPerWeek!,
        targets.availableEquipment!,
      ),
    [
      templates.data,
      targets.availableEquipment,
      targets.experienceLevel,
      targets.trainingDaysPerWeek,
    ],
  );
  const recommendation = recommendTrainingPlan(
    templates.data ?? [],
    targets.experienceLevel!,
    targets.trainingDaysPerWeek!,
    targets.availableEquipment!,
  );

  async function refreshPlan() {
    await queryClient.invalidateQueries({ queryKey: ["bulk-training-plan"] });
  }

  async function choose(plan: TrainingPlanTemplate) {
    setPendingId(plan.id);
    try {
      await instantiateTrainingPlan(
        plan.id,
        preference === "generated" ? "generated" : "tempo_preset",
      );
      await refreshPlan();
      toast.success("Training plan created");
    } catch (error) {
      toast.error(userFacingError(error, "create your training plan"));
    } finally {
      setPendingId(null);
    }
  }

  async function createCustom() {
    const name = customName.trim();
    if (name.length < 2) {
      toast.error("Enter a plan name with at least 2 characters.");
      return;
    }
    setPendingId("custom");
    try {
      await createEmptyTrainingPlan(name);
      await refreshPlan();
      toast.success("Training plan created");
    } catch (error) {
      toast.error(userFacingError(error, "create your training plan", { inputPreserved: true }));
    } finally {
      setPendingId(null);
    }
  }

  if (preference === "custom") {
    return (
      <Card className="space-y-4">
        <div>
          <SectionTitle>Create my training plan</SectionTitle>
          <h2 className="text-xl font-semibold">Start with an empty plan</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Name your plan now. You can add workout days and exercises in the plan editor next.
          </p>
        </div>
        <label className="block text-xs font-medium text-muted-foreground">
          Plan name
          <input
            value={customName}
            maxLength={80}
            onChange={(event) => setCustomName(event.target.value)}
            className="mt-1 min-h-11 w-full rounded-xl border border-input bg-elevated px-3 text-base text-foreground outline-none focus:border-ring"
          />
        </label>
        <Button className="min-h-11 w-full" onClick={createCustom} disabled={pendingId !== null}>
          {pendingId === "custom" ? (
            <PendingLabel>Creating your plan</PendingLabel>
          ) : (
            "Create My Training Plan"
          )}
        </Button>
      </Card>
    );
  }

  if (templates.isLoading) return <div className="h-48 animate-pulse rounded-2xl bg-card" />;
  if (templates.error)
    return (
      <DataError
        message={userFacingError(templates.error, "load training plans")}
        onRetry={() => void templates.refetch()}
      />
    );
  if (!recommendation)
    return (
      <DataError
        message="No training plans are available right now."
        onRetry={() => void templates.refetch()}
      />
    );

  const visible = preference === "generated" && !showOthers ? [recommendation] : ranked;
  return (
    <div className="space-y-3">
      <Card className="flex items-start gap-3">
        <span className="rounded-xl bg-primary/10 p-2 text-primary">
          <Dumbbell aria-hidden="true" />
        </span>
        <div>
          <SectionTitle>
            {preference === "generated" ? "Your recommended plan" : "Tempo plans"}
          </SectionTitle>
          <p className="text-sm text-muted-foreground">
            {preference === "generated"
              ? "Based on your experience, weekly schedule and available equipment."
              : "Browse the closest matches first, then inspect every workout before choosing."}
          </p>
        </div>
      </Card>
      {visible.map((plan) => (
        <PlanCard
          key={plan.id}
          plan={plan}
          targets={targets}
          expanded={
            expandedId === plan.id || (preference === "generated" && plan.id === recommendation.id)
          }
          onToggle={() => setExpandedId(expandedId === plan.id ? null : plan.id)}
          onUse={() => void choose(plan)}
          pending={pendingId === plan.id}
        />
      ))}
      {preference === "generated" ? (
        <Button
          variant="outline"
          className="min-h-11 w-full"
          onClick={() => setShowOthers((value) => !value)}
        >
          {showOthers ? "Show Recommendation Only" : "See Other Plans"}
        </Button>
      ) : null}
    </div>
  );
}

export function TrainingPlanOverview({ plan }: { plan: UserTrainingPlan }) {
  return (
    <div className="space-y-3">
      <Card>
        <SectionTitle>My training plan</SectionTitle>
        <h2 className="text-xl font-semibold">{plan.name}</h2>
        {plan.trainingDaysPerWeek ? (
          <p className="mt-1 text-sm capitalize text-muted-foreground">
            {plan.experienceLevel} · {plan.trainingDaysPerWeek} days/week
          </p>
        ) : null}
        {plan.description ? (
          <p className="mt-3 text-sm text-muted-foreground">{plan.description}</p>
        ) : null}
      </Card>
      {plan.days.length ? (
        plan.days.map((day) => (
          <Card key={day.id}>
            <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
              Day {day.order}
            </p>
            <h3 className="mt-1 font-semibold">{day.name}</h3>
            <ul className="mt-3 space-y-2 text-sm">
              {day.exercises.map((exercise) => (
                <li key={exercise.id} className="flex justify-between gap-3">
                  <span className="text-muted-foreground">{exercise.name}</span>
                  <span className="shrink-0 tabular-nums">
                    {exercise.sets} × {exercise.repMin}–{exercise.repMax}
                  </span>
                </li>
              ))}
            </ul>
          </Card>
        ))
      ) : (
        <Card className="text-center">
          <h3 className="font-semibold">Your plan is ready</h3>
          <p className="mt-1 text-sm text-muted-foreground">
            Add workout days and exercises in the plan editor next.
          </p>
        </Card>
      )}
    </div>
  );
}
