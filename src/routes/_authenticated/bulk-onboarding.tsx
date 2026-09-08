import { useEffect, useMemo, useState, type ReactNode } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { createFileRoute, redirect, useNavigate } from "@tanstack/react-router";
import { ArrowLeft, Check, Dumbbell } from "lucide-react";
import { AppShell, PageHeader } from "@/components/AppShell";
import { Card, PendingLabel } from "@/components/ui-kit";
import { activeBulkMemberships, bulkOwnerQueryOptions } from "@/lib/bulk-access";
import {
  DEFAULT_NUTRITION_TARGETS,
  EQUIPMENT_OPTIONS,
  EXPERIENCE_LEVELS,
  LEAN_BULK_WEEKLY_GAIN_RANGE,
  PHYSIQUE_GOALS,
  TRAINING_DAY_OPTIONS,
  TRAINING_SETUP_OPTIONS,
  WEEKLY_GAIN_OPTIONS,
  type BulkOnboardingField,
  type BulkOnboardingValues,
  type Equipment,
  type ExperienceLevel,
  type PhysiqueGoal,
  type TrainingSetupPreference,
  recommendInitialNutritionTargets,
  validateBulkOnboarding,
} from "@/lib/bulk-onboarding";
import { userFacingError } from "@/lib/network-errors";
import { useAcknowledgeGoal } from "@/lib/goal-discovery";
import { supabase } from "@/integrations/supabase/client";

export const Route = createFileRoute("/_authenticated/bulk-onboarding")({
  beforeLoad: async ({ context }) => {
    const plans = activeBulkMemberships(
      await context.queryClient.ensureQueryData(bulkOwnerQueryOptions()),
    );
    if (plans.length) throw redirect({ to: "/bulk", replace: true });
  },
  head: () => ({ meta: [{ title: "Tempo" }] }),
  component: BulkOnboarding,
});

type Step = 1 | 2 | 3 | 4 | 5;
type FormState = {
  goal: PhysiqueGoal | "";
  currentWeightKg: string;
  targetWeightKg: string;
  targetWeeklyGainKg: string;
  weeklyGainChoice: string;
  experienceLevel: ExperienceLevel | "";
  trainingDaysPerWeek: number | null;
  availableEquipment: Equipment[];
  trainingSetupPreference: TrainingSetupPreference | "";
  calories: string;
  protein: string;
  carbs: string;
  fat: string;
};

const initialForm: FormState = {
  goal: "",
  currentWeightKg: "",
  targetWeightKg: "",
  targetWeeklyGainKg: "0.25",
  weeklyGainChoice: "0.25",
  experienceLevel: "",
  trainingDaysPerWeek: null,
  availableEquipment: [],
  trainingSetupPreference: "",
  calories: String(DEFAULT_NUTRITION_TARGETS.calories),
  protein: String(DEFAULT_NUTRITION_TARGETS.protein),
  carbs: String(DEFAULT_NUTRITION_TARGETS.carbs),
  fat: String(DEFAULT_NUTRITION_TARGETS.fat),
};

const numeric = (value: string) => Number(value.trim().replaceAll(",", "."));

function valuesOf(form: FormState): BulkOnboardingValues {
  return {
    goal: form.goal as PhysiqueGoal,
    currentWeightKg: numeric(form.currentWeightKg),
    targetWeightKg: numeric(form.targetWeightKg),
    targetWeeklyGainKg: numeric(form.targetWeeklyGainKg),
    experienceLevel: form.experienceLevel as ExperienceLevel,
    trainingDaysPerWeek: form.trainingDaysPerWeek ?? 0,
    availableEquipment: form.availableEquipment,
    trainingSetupPreference: form.trainingSetupPreference as TrainingSetupPreference,
    calories: numeric(form.calories),
    protein: numeric(form.protein),
    carbs: numeric(form.carbs),
    fat: numeric(form.fat),
  };
}

const stepFields: Record<Step, BulkOnboardingField[]> = {
  1: ["goal", "currentWeightKg", "targetWeightKg", "targetWeeklyGainKg"],
  2: ["experienceLevel", "trainingDaysPerWeek", "availableEquipment"],
  3: ["trainingSetupPreference"],
  4: ["calories", "protein", "carbs", "fat"],
  5: [],
};

function BulkOnboarding() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const acknowledgeGoal = useAcknowledgeGoal();
  const [step, setStep] = useState<Step>(1);
  const [form, setForm] = useState<FormState>(initialForm);
  const [visibleErrors, setVisibleErrors] = useState<Partial<Record<BulkOnboardingField, string>>>(
    {},
  );
  const [busy, setBusy] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [nutritionManuallyAdjusted, setNutritionManuallyAdjusted] = useState(false);
  const values = useMemo(() => valuesOf(form), [form]);
  const allErrors = useMemo(() => validateBulkOnboarding(values), [values]);
  const nutritionRecommendation = useMemo(
    () =>
      recommendInitialNutritionTargets({
        goal: form.goal as PhysiqueGoal,
        currentWeightKg: numeric(form.currentWeightKg),
        targetWeightKg: numeric(form.targetWeightKg),
        targetWeeklyGainKg: numeric(form.targetWeeklyGainKg),
        trainingDaysPerWeek: form.trainingDaysPerWeek ?? 0,
      }),
    [
      form.goal,
      form.currentWeightKg,
      form.targetWeightKg,
      form.targetWeeklyGainKg,
      form.trainingDaysPerWeek,
    ],
  );

  useEffect(() => {
    if (!nutritionRecommendation || nutritionManuallyAdjusted) return;
    setForm((current) => ({
      ...current,
      calories: String(nutritionRecommendation.calories),
      protein: String(nutritionRecommendation.protein),
      carbs: String(nutritionRecommendation.carbs),
      fat: String(nutritionRecommendation.fat),
    }));
  }, [nutritionRecommendation, nutritionManuallyAdjusted]);

  const update = <K extends keyof FormState>(key: K, value: FormState[K]) => {
    if (key === "experienceLevel") setNutritionManuallyAdjusted(false);
    setForm((current) => {
      if (key !== "goal") return { ...current, [key]: value };
      const goal = value as PhysiqueGoal;
      return {
        ...current,
        goal,
        targetWeightKg: goal === "maintain" ? current.currentWeightKg : current.targetWeightKg,
        targetWeeklyGainKg: goal === "maintain" ? "0" : "0.25",
        weeklyGainChoice: goal === "maintain" ? "0" : "0.25",
      };
    });
    setVisibleErrors((current) => ({ ...current, [key]: undefined }));
    setSubmitError(null);
  };

  const updateNutrition = (key: "calories" | "protein" | "carbs" | "fat", value: string) => {
    setNutritionManuallyAdjusted(true);
    update(key, value);
  };

  const useRecommendation = () => {
    if (!nutritionRecommendation) return;
    setNutritionManuallyAdjusted(false);
    setForm((current) => ({
      ...current,
      calories: String(nutritionRecommendation.calories),
      protein: String(nutritionRecommendation.protein),
      carbs: String(nutritionRecommendation.carbs),
      fat: String(nutritionRecommendation.fat),
    }));
    setVisibleErrors((current) => {
      const next = { ...current };
      delete next.calories;
      delete next.protein;
      delete next.carbs;
      delete next.fat;
      return next;
    });
  };

  const next = () => {
    const errors = Object.fromEntries(
      stepFields[step].flatMap((field) => (allErrors[field] ? [[field, allErrors[field]]] : [])),
    );
    if (Object.keys(errors).length) {
      setVisibleErrors(errors);
      return;
    }
    setVisibleErrors({});
    setStep((current) => Math.min(5, current + 1) as Step);
  };

  const submit = async () => {
    if (busy) return;
    const errors = validateBulkOnboarding(values);
    if (Object.keys(errors).length) {
      setVisibleErrors(errors);
      const firstInvalidStep = ([1, 2, 3, 4] as const).find((candidate) =>
        stepFields[candidate].some((field) => errors[field]),
      );
      if (firstInvalidStep) setStep(firstInvalidStep);
      return;
    }
    setBusy(true);
    setSubmitError(null);
    try {
      const { data: planId, error } = await supabase.rpc("complete_goal_onboarding", {
        _goal: values.goal,
        _current_weight_kg: values.currentWeightKg,
        _target_weight_kg: values.targetWeightKg,
        _target_weekly_gain_kg: values.targetWeeklyGainKg,
        _experience_level: values.experienceLevel,
        _training_days_per_week: values.trainingDaysPerWeek,
        _available_equipment: values.availableEquipment,
        _training_setup_preference: values.trainingSetupPreference,
        _calories: values.calories,
        _protein: values.protein,
        _carbs: values.carbs,
        _fat: values.fat,
      });
      if (error || !planId) throw error ?? new Error("Goal onboarding failed");
      await queryClient.invalidateQueries({ queryKey: ["bulk-memberships"], refetchType: "none" });
      const plans = activeBulkMemberships(
        await queryClient.fetchQuery({ ...bulkOwnerQueryOptions(), staleTime: 0 }),
      );
      if (!plans.some((plan) => plan.bulk_profile_id === planId))
        throw new Error("Your Goal plan is still being prepared. Please retry.");
      await acknowledgeGoal().catch(() => undefined);
      await navigate({ to: "/bulk", replace: true });
    } catch (cause) {
      setSubmitError(userFacingError(cause, "create your Goal plan"));
    } finally {
      setBusy(false);
    }
  };

  return (
    <AppShell>
      <PageHeader
        title="Create My Goal Plan"
        subtitle={`Step ${step} of 5`}
        {...(step === 1 ? { backTo: "/profile", backLabel: "Profile" } : {})}
      />
      <div className="mb-4 h-1.5 overflow-hidden rounded-full bg-secondary" aria-hidden="true">
        <div
          className="h-full rounded-full bg-primary transition-all"
          style={{ width: `${step * 20}%` }}
        />
      </div>
      <Card>
        {step === 1 ? <GoalStep form={form} update={update} errors={visibleErrors} /> : null}
        {step === 2 ? <TrainingStep form={form} update={update} errors={visibleErrors} /> : null}
        {step === 3 ? (
          <PreferenceStep
            form={form}
            update={update}
            error={visibleErrors.trainingSetupPreference}
          />
        ) : null}
        {step === 4 ? (
          <NutritionStep
            form={form}
            recommendation={nutritionRecommendation}
            manuallyAdjusted={nutritionManuallyAdjusted}
            update={updateNutrition}
            useRecommendation={useRecommendation}
            onAdjustManually={() => setNutritionManuallyAdjusted(true)}
            errors={visibleErrors}
          />
        ) : null}
        {step === 5 ? <ReviewStep values={values} /> : null}
        {submitError ? (
          <p role="alert" className="mt-4 text-sm text-danger">
            {submitError}
          </p>
        ) : null}
        <div className="mt-6 grid grid-cols-2 gap-2">
          {step > 1 ? (
            <button
              type="button"
              disabled={busy}
              onClick={() => setStep((step - 1) as Step)}
              className="flex min-h-11 items-center justify-center gap-2 rounded-xl border border-border px-4 py-3 text-sm font-medium disabled:opacity-60"
            >
              <ArrowLeft className="h-4 w-4" aria-hidden="true" /> Back
            </button>
          ) : (
            <button
              type="button"
              onClick={() => void navigate({ to: "/profile" })}
              className="min-h-11 rounded-xl border border-border px-4 py-3 text-sm font-medium"
            >
              Cancel
            </button>
          )}
          {step < 5 ? (
            <button
              type="button"
              onClick={next}
              className="min-h-11 rounded-xl bg-primary px-4 py-3 text-sm font-semibold text-primary-foreground active:scale-[0.98]"
            >
              {step === 4 && form.experienceLevel === "beginner" && !nutritionManuallyAdjusted
                ? "Use these targets"
                : "Continue"}
            </button>
          ) : (
            <button
              type="button"
              disabled={busy}
              onClick={() => void submit()}
              className="flex min-h-11 items-center justify-center rounded-xl bg-primary px-3 py-3 text-sm font-semibold text-primary-foreground active:scale-[0.98] disabled:opacity-60"
            >
              {busy ? <PendingLabel>Creating My Goal Plan...</PendingLabel> : "Create My Goal Plan"}
            </button>
          )}
        </div>
      </Card>
    </AppShell>
  );
}

type Update = <K extends keyof FormState>(key: K, value: FormState[K]) => void;

function Heading({ icon = false, title, copy }: { icon?: boolean; title: string; copy: string }) {
  return (
    <div className="mb-5">
      {icon ? (
        <span className="mb-3 grid h-11 w-11 place-items-center rounded-xl bg-primary/10 text-primary">
          <Dumbbell className="h-5 w-5" aria-hidden="true" />
        </span>
      ) : null}
      <h1 className="text-xl font-semibold">{title}</h1>
      <p className="mt-1 text-sm leading-6 text-muted-foreground">{copy}</p>
    </div>
  );
}

function TextNumber({
  label,
  value,
  onChange,
  suffix,
  error,
  integer = false,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  suffix: string;
  error?: string | undefined;
  integer?: boolean;
}) {
  return (
    <label className="block">
      <span className="text-xs font-medium text-muted-foreground">{label}</span>
      <div className="mt-1 flex items-center rounded-xl border border-input bg-elevated focus-within:border-ring">
        <input
          value={value}
          onChange={(event) => onChange(event.target.value)}
          inputMode={integer ? "numeric" : "decimal"}
          aria-invalid={!!error}
          className="num min-h-11 min-w-0 flex-1 bg-transparent px-3 py-2.5 text-lg font-semibold outline-none"
        />
        <span className="pr-3 text-xs text-muted-foreground">{suffix}</span>
      </div>
      {error ? (
        <span role="alert" className="mt-1 block text-xs text-danger">
          {error}
        </span>
      ) : null}
    </label>
  );
}

function Choice({
  selected,
  onClick,
  children,
}: {
  selected: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      aria-pressed={selected}
      onClick={onClick}
      className={`flex min-h-11 items-center justify-between rounded-xl border px-3 py-2.5 text-left text-sm font-medium transition-colors ${selected ? "border-primary bg-primary/10 text-primary" : "border-border bg-elevated text-foreground"}`}
    >
      <span>{children}</span>
      {selected ? <Check className="h-4 w-4" aria-hidden="true" /> : null}
    </button>
  );
}

function GoalStep({
  form,
  update,
  errors,
}: {
  form: FormState;
  update: Update;
  errors: Partial<Record<BulkOnboardingField, string>>;
}) {
  return (
    <>
      <Heading
        icon
        title="Your goal"
        copy="Choose the physique outcome you want Tempo to support."
      />
      <div className="space-y-4">
        <div>
          <p className="text-xs font-medium text-muted-foreground">Physique goal</p>
          <div className="mt-2 grid gap-2">
            {PHYSIQUE_GOALS.map((option) => (
              <Choice
                key={option.value}
                selected={form.goal === option.value}
                onClick={() => update("goal", option.value)}
              >
                {option.label}
              </Choice>
            ))}
          </div>
          {errors.goal ? (
            <p role="alert" className="mt-1 text-xs text-danger">
              {errors.goal}
            </p>
          ) : null}
        </div>
        <TextNumber
          label="Current weight"
          value={form.currentWeightKg}
          onChange={(value) => update("currentWeightKg", value)}
          suffix="kg"
          error={errors.currentWeightKg}
        />
        <TextNumber
          label="Target weight"
          value={form.targetWeightKg}
          onChange={(value) => update("targetWeightKg", value)}
          suffix="kg"
          error={errors.targetWeightKg}
        />
        <div>
          <p className="text-xs font-medium text-muted-foreground">
            {form.goal === "cut"
              ? "Target weekly weight loss"
              : form.goal === "maintain"
                ? "Weekly weight direction"
                : "Target weekly weight gain"}
          </p>
          <p className="mt-1 text-[11px] text-muted-foreground">
            {form.goal === "cut"
              ? "Tempo uses a moderate rate of loss and avoids extreme deficits."
              : form.goal === "maintain"
                ? "Tempo will aim to keep your weight trend approximately stable."
                : `Recommended muscle-gain range: ${LEAN_BULK_WEEKLY_GAIN_RANGE[0].toFixed(2)} to ${LEAN_BULK_WEEKLY_GAIN_RANGE[1].toFixed(2)} kg/week.`}
          </p>
          {form.goal === "maintain" ? (
            <p className="mt-2 rounded-xl bg-elevated p-3 text-sm font-medium">
              Maintain around 0 kg/week
            </p>
          ) : (
            <div className="mt-2 grid grid-cols-3 gap-2">
              {WEEKLY_GAIN_OPTIONS.map((gain) => (
                <Choice
                  key={gain}
                  selected={form.weeklyGainChoice === String(gain)}
                  onClick={() => {
                    update("weeklyGainChoice", String(gain));
                    update("targetWeeklyGainKg", String(gain));
                  }}
                >
                  {gain.toFixed(2)}
                </Choice>
              ))}
              <Choice
                selected={form.weeklyGainChoice === "custom"}
                onClick={() => update("weeklyGainChoice", "custom")}
              >
                Custom
              </Choice>
            </div>
          )}
          {form.weeklyGainChoice === "custom" ? (
            <div className="mt-3">
              <TextNumber
                label={form.goal === "cut" ? "Custom weekly loss" : "Custom weekly gain"}
                value={form.targetWeeklyGainKg}
                onChange={(value) => update("targetWeeklyGainKg", value)}
                suffix="kg/week"
                error={errors.targetWeeklyGainKg}
              />
            </div>
          ) : errors.targetWeeklyGainKg ? (
            <p role="alert" className="mt-1 text-xs text-danger">
              {errors.targetWeeklyGainKg}
            </p>
          ) : null}
        </div>
      </div>
    </>
  );
}

function TrainingStep({
  form,
  update,
  errors,
}: {
  form: FormState;
  update: Update;
  errors: Partial<Record<BulkOnboardingField, string>>;
}) {
  const toggle = (equipment: Equipment) => {
    if (equipment === "bodyweight_only") {
      update("availableEquipment", form.availableEquipment.includes(equipment) ? [] : [equipment]);
      return;
    }
    const current = form.availableEquipment.filter((value) => value !== "bodyweight_only");
    update(
      "availableEquipment",
      current.includes(equipment)
        ? current.filter((value) => value !== equipment)
        : [...current, equipment],
    );
  };
  return (
    <>
      <Heading
        title="Your training"
        copy="Tell Tempo what experience and equipment your future plan can use."
      />
      <div className="space-y-5">
        <div>
          <p className="text-xs font-medium text-muted-foreground">Experience level</p>
          <div className="mt-2 grid gap-2">
            {EXPERIENCE_LEVELS.map((option) => (
              <Choice
                key={option.value}
                selected={form.experienceLevel === option.value}
                onClick={() => update("experienceLevel", option.value)}
              >
                {option.label}
              </Choice>
            ))}
          </div>
          {errors.experienceLevel ? (
            <p role="alert" className="mt-1 text-xs text-danger">
              {errors.experienceLevel}
            </p>
          ) : null}
        </div>
        <div>
          <p className="text-xs font-medium text-muted-foreground">Training days per week</p>
          <div className="mt-2 grid grid-cols-5 gap-2">
            {TRAINING_DAY_OPTIONS.map((days) => (
              <Choice
                key={days}
                selected={form.trainingDaysPerWeek === days}
                onClick={() => update("trainingDaysPerWeek", days)}
              >
                {days}
              </Choice>
            ))}
          </div>
          {errors.trainingDaysPerWeek ? (
            <p role="alert" className="mt-1 text-xs text-danger">
              {errors.trainingDaysPerWeek}
            </p>
          ) : null}
        </div>
        <div>
          <p className="text-xs font-medium text-muted-foreground">Available equipment</p>
          <p className="mt-1 text-[11px] text-muted-foreground">
            Choose every option you can reliably use.
          </p>
          <div className="mt-2 grid gap-2 sm:grid-cols-2">
            {EQUIPMENT_OPTIONS.map((option) => (
              <Choice
                key={option.value}
                selected={form.availableEquipment.includes(option.value)}
                onClick={() => toggle(option.value)}
              >
                {option.label}
              </Choice>
            ))}
          </div>
          {errors.availableEquipment ? (
            <p role="alert" className="mt-1 text-xs text-danger">
              {errors.availableEquipment}
            </p>
          ) : null}
        </div>
      </div>
    </>
  );
}

function PreferenceStep({
  form,
  update,
  error,
}: {
  form: FormState;
  update: Update;
  error?: string | undefined;
}) {
  return (
    <>
      <Heading
        title="How do you want to train?"
        copy="Choose the setup path you want to use when training plans arrive."
      />
      <div className="grid gap-3">
        {TRAINING_SETUP_OPTIONS.map((option) => (
          <Choice
            key={option.value}
            selected={form.trainingSetupPreference === option.value}
            onClick={() => update("trainingSetupPreference", option.value)}
          >
            {option.label}
          </Choice>
        ))}
      </div>
      {error ? (
        <p role="alert" className="mt-2 text-xs text-danger">
          {error}
        </p>
      ) : null}
      <p className="mt-4 rounded-xl bg-elevated/70 p-3 text-xs leading-5 text-muted-foreground">
        This choice is saved now. Plan generation, Tempo plans and the custom builder will be added
        in later rollout segments.
      </p>
    </>
  );
}

function NutritionStep({
  form,
  recommendation,
  manuallyAdjusted,
  update,
  useRecommendation,
  onAdjustManually,
  errors,
}: {
  form: FormState;
  recommendation: ReturnType<typeof recommendInitialNutritionTargets>;
  manuallyAdjusted: boolean;
  update: (key: "calories" | "protein" | "carbs" | "fat", value: string) => void;
  useRecommendation: () => void;
  onAdjustManually: () => void;
  errors: Partial<Record<BulkOnboardingField, string>>;
}) {
  const beginnerSummary = form.experienceLevel === "beginner" && !manuallyAdjusted;
  const recommendationRows = recommendation
    ? [
        ["Calories", `${recommendation.calories.toLocaleString()} kcal`],
        ["Protein", `${recommendation.protein} g`],
        ["Carbs", `${recommendation.carbs} g`],
        ["Fat", `${recommendation.fat} g`],
      ]
    : [];
  return (
    <>
      <Heading
        title="Nutrition targets"
        copy={
          form.experienceLevel === "beginner"
            ? "Tempo calculated a practical starting point from your goal and training schedule."
            : form.experienceLevel === "intermediate"
              ? "Tempo's recommendation is prefilled. Adjust any target you already track."
              : "Enter the daily targets you want Tempo to track."
        }
      />
      {beginnerSummary ? (
        <div>
          <dl className="grid grid-cols-2 gap-2">
            {recommendationRows.map(([label, value]) => (
              <div key={label} className="rounded-xl bg-elevated p-3">
                <dt className="text-[10px] uppercase tracking-wider text-muted-foreground">
                  {label}
                </dt>
                <dd className="num mt-1 text-lg font-semibold">{value}</dd>
              </div>
            ))}
          </dl>
          <p className="mt-4 text-xs leading-5 text-muted-foreground">
            These are starting targets. Tempo can adjust calories later using your weekly progress.
          </p>
          <button
            type="button"
            onClick={onAdjustManually}
            className="mt-3 min-h-11 w-full rounded-xl border border-border px-4 text-sm font-medium text-foreground active:bg-elevated"
          >
            Adjust manually
          </button>
        </div>
      ) : (
        <div>
          <div className="grid grid-cols-2 gap-4">
            <TextNumber
              label="Calories"
              value={form.calories}
              onChange={(value) => update("calories", value)}
              suffix="kcal"
              error={errors.calories}
              integer
            />
            <TextNumber
              label="Protein"
              value={form.protein}
              onChange={(value) => update("protein", value)}
              suffix="g"
              error={errors.protein}
              integer
            />
            <TextNumber
              label="Carbs"
              value={form.carbs}
              onChange={(value) => update("carbs", value)}
              suffix="g"
              error={errors.carbs}
              integer
            />
            <TextNumber
              label="Fat"
              value={form.fat}
              onChange={(value) => update("fat", value)}
              suffix="g"
              error={errors.fat}
              integer
            />
          </div>
          {form.experienceLevel === "advanced" && recommendation ? (
            <button
              type="button"
              onClick={useRecommendation}
              className="mt-4 min-h-11 w-full rounded-xl border border-border px-4 text-sm font-medium text-foreground active:bg-elevated"
            >
              Use Tempo recommendation
            </button>
          ) : null}
        </div>
      )}
    </>
  );
}

function ReviewStep({ values }: { values: BulkOnboardingValues }) {
  const goal = PHYSIQUE_GOALS.find(({ value }) => value === values.goal)?.label;
  const experience = EXPERIENCE_LEVELS.find(({ value }) => value === values.experienceLevel)?.label;
  const preference = TRAINING_SETUP_OPTIONS.find(
    ({ value }) => value === values.trainingSetupPreference,
  )?.label;
  const equipment = values.availableEquipment
    .map((value) => EQUIPMENT_OPTIONS.find((option) => option.value === value)?.label)
    .filter(Boolean)
    .join(", ");
  const rows = [
    ["Goal", goal],
    ["Current weight", `${values.currentWeightKg} kg`],
    ["Target weight", `${values.targetWeightKg} kg`],
    [
      values.goal === "cut" ? "Weekly loss" : "Weekly change",
      `${values.targetWeeklyGainKg} kg/week`,
    ],
    ["Experience", experience],
    ["Training days", `${values.trainingDaysPerWeek} per week`],
    ["Equipment", equipment],
    ["Training setup", preference],
    [
      "Nutrition",
      `${values.calories} kcal · ${values.protein} g protein · ${values.carbs} g carbs · ${values.fat} g fat`,
    ],
  ];
  return (
    <>
      <Heading
        title="Review your Goal plan"
        copy="Check your setup before creating your private Goal space."
      />
      <dl className="divide-y divide-border rounded-xl bg-elevated/60 px-3">
        {rows.map(([label, value]) => (
          <div key={label} className="py-3">
            <dt className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</dt>
            <dd className="mt-0.5 text-sm font-medium">{value}</dd>
          </div>
        ))}
      </dl>
    </>
  );
}
