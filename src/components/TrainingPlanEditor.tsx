import { useEffect, useMemo, useState } from "react";
import { ArrowDown, ArrowUp, Plus, Replace, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { PlanExercisePicker } from "@/components/PlanExercisePicker";
import { Button } from "@/components/ui/button";
import { Card, PendingLabel, SectionTitle } from "@/components/ui-kit";
import type { LibraryExercise } from "@/lib/exercise-library";
import {
  moveOrderedItem,
  replaceTrainingPlanExercise,
  validateTrainingPlanDraft,
  type TrainingPlanDay,
  type TrainingPlanExercise,
  type UserTrainingPlan,
} from "@/lib/training-plans";
import { saveTrainingPlan } from "@/lib/training-plans-query";
import { userFacingError } from "@/lib/network-errors";

type PickerTarget = { dayIndex: number; exerciseIndex: number | null };

const localId = (kind: string) =>
  `${kind}:${typeof crypto !== "undefined" && crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`}`;

function renumberDays(days: TrainingPlanDay[]): TrainingPlanDay[] {
  return days.map((day, dayIndex) => ({
    ...day,
    order: dayIndex + 1,
    exercises: day.exercises.map((exercise, exerciseIndex) => ({
      ...exercise,
      order: exerciseIndex + 1,
    })),
  }));
}

function fromLibrary(exercise: LibraryExercise): TrainingPlanExercise {
  return {
    id: localId("exercise"),
    exerciseId: exercise.id,
    sourceSystemExerciseId: exercise.is_system ? exercise.id : null,
    name: exercise.name,
    order: 1,
    sets: 3,
    repMin: 8,
    repMax: 12,
    intendedUnilateralMode: "bilateral",
    notes: null,
    supportsUnilateral: exercise.supports_unilateral,
  };
}

export function TrainingPlanEditor({
  plan,
  onCancel,
  onSaved,
}: {
  plan: UserTrainingPlan;
  onCancel: () => void;
  onSaved: () => Promise<void>;
}) {
  const [name, setName] = useState(plan.name);
  const [days, setDays] = useState<TrainingPlanDay[]>(() => structuredClone(plan.days));
  const [picker, setPicker] = useState<PickerTarget | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const dirty = useMemo(
    () => name !== plan.name || JSON.stringify(days) !== JSON.stringify(plan.days),
    [days, name, plan.days, plan.name],
  );

  useEffect(() => {
    if (!dirty) return;
    const warn = (event: BeforeUnloadEvent) => event.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);

  const updateDays = (next: TrainingPlanDay[]) => setDays(renumberDays(next));
  const updateDay = (dayIndex: number, update: (day: TrainingPlanDay) => TrainingPlanDay) =>
    updateDays(days.map((day, index) => (index === dayIndex ? update(day) : day)));

  function addDay() {
    if (days.length >= 6) {
      setError("A plan can contain up to 6 workout days.");
      return;
    }
    updateDays([
      ...days,
      { id: localId("day"), order: days.length + 1, name: `Day ${days.length + 1}`, exercises: [] },
    ]);
  }

  function removeDay(dayIndex: number) {
    const day = days[dayIndex]!;
    if (
      day.exercises.length &&
      !window.confirm(
        `Delete ${day.name} and its plan exercises? Historical workouts will stay unchanged.`,
      )
    )
      return;
    updateDays(days.filter((_, index) => index !== dayIndex));
  }

  function moveDay(from: number, to: number) {
    updateDays(moveOrderedItem(days, from, to));
  }

  function moveExercise(dayIndex: number, from: number, to: number) {
    updateDay(dayIndex, (day) => ({ ...day, exercises: moveOrderedItem(day.exercises, from, to) }));
  }

  function chooseExercise(exercise: LibraryExercise) {
    if (!picker) return;
    updateDay(picker.dayIndex, (day) => {
      const next = [...day.exercises];
      const selected = fromLibrary(exercise);
      if (picker.exerciseIndex === null) next.push(selected);
      else {
        const current = next[picker.exerciseIndex]!;
        next[picker.exerciseIndex] = replaceTrainingPlanExercise(current, exercise);
      }
      return { ...day, exercises: next };
    });
    setPicker(null);
  }

  function updateExercise(
    dayIndex: number,
    exerciseIndex: number,
    update: Partial<TrainingPlanExercise>,
  ) {
    updateDay(dayIndex, (day) => ({
      ...day,
      exercises: day.exercises.map((exercise, index) =>
        index === exerciseIndex ? { ...exercise, ...update } : exercise,
      ),
    }));
  }

  async function save() {
    if (saving) return;
    const validation = validateTrainingPlanDraft({
      id: plan.id,
      name,
      updatedAt: plan.updatedAt,
      days,
    });
    if (days.some((day) => day.exercises.some((exercise) => !exercise.exerciseId)))
      validation.push("Replace unavailable exercises before saving.");
    if (validation.length) {
      setError(validation[0]!);
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await saveTrainingPlan({
        id: plan.id,
        expectedUpdatedAt: plan.updatedAt,
        name: name.trim(),
        days: days.map((day) => ({
          name: day.name.trim(),
          exercises: day.exercises.map((exercise) => ({
            exerciseId: exercise.exerciseId!,
            sets: exercise.sets,
            repMin: exercise.repMin,
            repMax: exercise.repMax,
            executionMode: exercise.intendedUnilateralMode,
            notes: exercise.notes?.trim() || null,
          })),
        })),
      });
      await onSaved();
      toast.success("Training plan saved");
    } catch (cause) {
      const serverMessage =
        cause && typeof cause === "object" && "message" in cause
          ? String(cause.message)
          : cause instanceof Error
            ? cause.message
            : "";
      const message = /changed on another device/i.test(serverMessage)
        ? "This plan changed on another device. Your edits are still here. Reload the latest plan before trying again."
        : userFacingError(cause, "save your training plan", { inputPreserved: true });
      setError(message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-3">
      <Card className="space-y-3">
        <SectionTitle>Edit plan</SectionTitle>
        <label className="block text-xs font-medium text-muted-foreground">
          Plan name
          <input
            value={name}
            maxLength={80}
            onChange={(event) => setName(event.target.value)}
            className="mt-1 min-h-11 w-full rounded-xl border border-input bg-elevated px-3 text-base text-foreground outline-none focus:border-ring"
          />
        </label>
      </Card>

      {days.map((day, dayIndex) => (
        <Card key={day.id} className="space-y-3">
          <div className="flex items-start gap-2">
            <label className="min-w-0 flex-1 text-xs font-medium text-muted-foreground">
              Day {dayIndex + 1}
              <input
                value={day.name}
                maxLength={60}
                onChange={(event) =>
                  updateDay(dayIndex, (current) => ({ ...current, name: event.target.value }))
                }
                aria-label={`Name for workout day ${dayIndex + 1}`}
                className="mt-1 min-h-11 w-full rounded-xl border border-input bg-elevated px-3 text-base font-semibold text-foreground outline-none focus:border-ring"
              />
            </label>
            <div className="flex pt-5">
              <IconButton
                label={`Move ${day.name} up`}
                disabled={dayIndex === 0}
                onClick={() => moveDay(dayIndex, dayIndex - 1)}
              >
                <ArrowUp />
              </IconButton>
              <IconButton
                label={`Move ${day.name} down`}
                disabled={dayIndex === days.length - 1}
                onClick={() => moveDay(dayIndex, dayIndex + 1)}
              >
                <ArrowDown />
              </IconButton>
              <IconButton
                label={`Delete ${day.name}`}
                tone="danger"
                onClick={() => removeDay(dayIndex)}
              >
                <Trash2 />
              </IconButton>
            </div>
          </div>

          {day.exercises.map((exercise, exerciseIndex) => (
            <div
              key={exercise.id}
              className="rounded-xl border border-border/70 bg-elevated/40 p-3"
            >
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="font-medium">{exercise.name}</p>
                  {exercise.exerciseId ? null : (
                    <p className="text-xs text-danger">Exercise unavailable</p>
                  )}
                </div>
                <div className="flex">
                  <IconButton
                    label={`Move ${exercise.name} up`}
                    disabled={exerciseIndex === 0}
                    onClick={() => moveExercise(dayIndex, exerciseIndex, exerciseIndex - 1)}
                  >
                    <ArrowUp />
                  </IconButton>
                  <IconButton
                    label={`Move ${exercise.name} down`}
                    disabled={exerciseIndex === day.exercises.length - 1}
                    onClick={() => moveExercise(dayIndex, exerciseIndex, exerciseIndex + 1)}
                  >
                    <ArrowDown />
                  </IconButton>
                </div>
              </div>
              <div className="mt-3 grid grid-cols-3 gap-2">
                <NumberField
                  label="Sets"
                  value={exercise.sets}
                  min={1}
                  max={10}
                  onChange={(value) => updateExercise(dayIndex, exerciseIndex, { sets: value })}
                />
                <NumberField
                  label="Min reps"
                  value={exercise.repMin}
                  min={1}
                  max={100}
                  onChange={(value) => updateExercise(dayIndex, exerciseIndex, { repMin: value })}
                />
                <NumberField
                  label="Max reps"
                  value={exercise.repMax}
                  min={1}
                  max={100}
                  onChange={(value) => updateExercise(dayIndex, exerciseIndex, { repMax: value })}
                />
              </div>
              {exercise.supportsUnilateral ? (
                <label className="mt-3 block text-xs font-medium text-muted-foreground">
                  Execution
                  <select
                    value={exercise.intendedUnilateralMode}
                    onChange={(event) =>
                      updateExercise(dayIndex, exerciseIndex, {
                        intendedUnilateralMode: event.target.value as "bilateral" | "unilateral",
                      })
                    }
                    aria-label={`Execution mode for ${exercise.name}`}
                    className="mt-1 min-h-11 w-full rounded-xl border border-input bg-elevated px-3 text-sm text-foreground"
                  >
                    <option value="bilateral">Bilateral / standard</option>
                    <option value="unilateral">Unilateral / single side</option>
                  </select>
                </label>
              ) : null}
              <label className="mt-3 block text-xs font-medium text-muted-foreground">
                Exercise note
                <input
                  value={exercise.notes ?? ""}
                  maxLength={240}
                  onChange={(event) =>
                    updateExercise(dayIndex, exerciseIndex, { notes: event.target.value || null })
                  }
                  className="mt-1 min-h-11 w-full rounded-xl border border-input bg-elevated px-3 text-sm text-foreground"
                />
              </label>
              <div className="mt-2 grid grid-cols-2 gap-2">
                <Button
                  variant="outline"
                  className="min-h-11"
                  onClick={() => setPicker({ dayIndex, exerciseIndex })}
                >
                  <Replace aria-hidden="true" /> Replace
                </Button>
                <Button
                  variant="ghost"
                  className="min-h-11 text-danger"
                  onClick={() =>
                    updateDay(dayIndex, (current) => ({
                      ...current,
                      exercises: current.exercises.filter((_, index) => index !== exerciseIndex),
                    }))
                  }
                >
                  <Trash2 aria-hidden="true" /> Remove
                </Button>
              </div>
            </div>
          ))}
          <Button
            variant="outline"
            className="min-h-11 w-full"
            disabled={day.exercises.length >= 20}
            onClick={() => setPicker({ dayIndex, exerciseIndex: null })}
          >
            <Plus aria-hidden="true" /> Add Exercise
          </Button>
        </Card>
      ))}

      <Button
        variant="outline"
        className="min-h-11 w-full"
        disabled={days.length >= 6}
        onClick={addDay}
      >
        <Plus aria-hidden="true" /> Add Workout Day
      </Button>
      {error ? (
        <p role="alert" className="rounded-xl bg-danger/10 p-3 text-sm text-danger">
          {error}
        </p>
      ) : null}
      <div className="sticky bottom-[calc(5rem+env(safe-area-inset-bottom))] z-10 grid grid-cols-2 gap-2 rounded-2xl border border-border bg-background/95 p-2 backdrop-blur">
        <Button
          variant="outline"
          className="min-h-11"
          disabled={saving}
          onClick={() => {
            if (!dirty || window.confirm("Discard unsaved plan changes?")) onCancel();
          }}
        >
          Cancel
        </Button>
        <Button className="min-h-11" disabled={saving || !dirty} onClick={() => void save()}>
          {saving ? <PendingLabel>Saving plan</PendingLabel> : "Save Changes"}
        </Button>
      </div>
      {picker ? (
        <PlanExercisePicker
          open
          onOpenChange={(open) => {
            if (!open) setPicker(null);
          }}
          onSelect={chooseExercise}
          title={
            picker.exerciseIndex === null
              ? `Add to ${days[picker.dayIndex]?.name}`
              : "Replace exercise"
          }
        />
      ) : null}
    </div>
  );
}

function IconButton({
  label,
  disabled,
  onClick,
  tone,
  children,
}: {
  label: string;
  disabled?: boolean;
  onClick: () => void;
  tone?: "danger";
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      disabled={disabled}
      onClick={onClick}
      className={`flex min-h-11 min-w-11 items-center justify-center rounded-lg disabled:opacity-30 ${tone === "danger" ? "text-danger" : "text-muted-foreground"}`}
    >
      {children}
    </button>
  );
}

function NumberField({
  label,
  value,
  min,
  max,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  onChange: (value: number) => void;
}) {
  return (
    <label className="text-[11px] font-medium text-muted-foreground">
      {label}
      <input
        type="number"
        inputMode="numeric"
        value={value || ""}
        min={min}
        max={max}
        onChange={(event) => onChange(Number(event.target.value))}
        className="mt-1 min-h-11 w-full rounded-lg border border-input bg-background px-2 text-center text-base text-foreground"
      />
    </label>
  );
}
