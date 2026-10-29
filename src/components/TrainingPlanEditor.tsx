import { useEffect, useMemo, useState } from "react";
import { ArrowDown, ArrowUp, ChevronRight, Plus, Trash2 } from "lucide-react";
import { BackButton } from "./BackControl";
import { toast } from "sonner";
import { WorkoutExerciseListEditor } from "@/components/WorkoutExerciseListEditor";
import { Button } from "@/components/ui/button";
import { Card, PendingLabel, SectionTitle } from "@/components/ui-kit";
import {
  moveOrderedItem,
  validateTrainingPlanDraft,
  type TrainingPlanDay,
  type UserTrainingPlan,
} from "@/lib/training-plans";
import { saveTrainingPlan } from "@/lib/training-plans-query";
import { userFacingError } from "@/lib/network-errors";

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
  const [selectedDayId, setSelectedDayId] = useState<string | null>(null);
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
    if (selectedDayId === day.id) setSelectedDayId(null);
  }

  function moveDay(from: number, to: number) {
    updateDays(moveOrderedItem(days, from, to));
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
      setSelectedDayId(null);
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

      {selectedDayId === null ? (
        <div className="space-y-3" aria-label="Workout days">
          {days.map((day, dayIndex) => (
            <Card key={day.id} className="space-y-3">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                    Day {dayIndex + 1}
                  </p>
                  <h2 className="mt-1 text-lg font-semibold">{day.name}</h2>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {day.exercises.length} exercise{day.exercises.length === 1 ? "" : "s"}
                  </p>
                  <p className="mt-2 line-clamp-2 text-sm text-muted-foreground">
                    {day.exercises.length
                      ? day.exercises
                          .slice(0, 3)
                          .map((exercise) => exercise.name)
                          .join(", ") + (day.exercises.length > 3 ? "…" : "")
                      : "No exercises yet"}
                  </p>
                </div>
                <div className="flex shrink-0">
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
                </div>
              </div>
              <Button
                variant="outline"
                className="min-h-11 w-full justify-between gap-3 px-4"
                onClick={() => setSelectedDayId(day.id)}
              >
                Edit Day <ChevronRight className="control-chevron" aria-hidden="true" />
              </Button>
            </Card>
          ))}
        </div>
      ) : null}

      {days
        .filter((day) => day.id === selectedDayId)
        .map((day) => {
          const dayIndex = days.findIndex((item) => item.id === day.id);
          return (
            <Card key={day.id} className="space-y-3">
              <BackButton onClick={() => setSelectedDayId(null)}>Training plan</BackButton>
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

              <WorkoutExerciseListEditor
                exercises={day.exercises}
                title={day.name}
                onChange={(exercises) =>
                  updateDay(dayIndex, (current) => ({ ...current, exercises }))
                }
              />
            </Card>
          );
        })}

      {selectedDayId === null ? (
        <Button
          variant="outline"
          className="min-h-11 w-full"
          disabled={days.length >= 6}
          onClick={addDay}
        >
          <Plus aria-hidden="true" /> Add Workout Day
        </Button>
      ) : null}
      {error ? (
        <p role="alert" className="rounded-xl bg-danger/10 p-3 text-sm text-danger">
          {error}
        </p>
      ) : null}
      <div className="sticky bottom-[calc(5rem+env(safe-area-inset-bottom))] z-10 mt-6 grid grid-cols-[1fr_1.6fr] gap-2 rounded-[20px] border border-border bg-background/90 p-2 shadow-lg backdrop-blur">
        <Button
          variant="outline"
          className="h-12 rounded-[14px]"
          disabled={saving}
          onClick={() => {
            if (!dirty || window.confirm("Discard unsaved plan changes?")) onCancel();
          }}
        >
          Cancel
        </Button>
        <Button
          className="h-12 rounded-[14px] font-semibold"
          disabled={saving || !dirty}
          onClick={() => void save()}
        >
          {saving ? (
            <PendingLabel>Saving plan</PendingLabel>
          ) : selectedDayId ? (
            "Save and return"
          ) : (
            "Save Changes"
          )}
        </Button>
      </div>
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
