import { useState } from "react";
import { ArrowDown, ArrowUp, Plus, Replace, Trash2 } from "lucide-react";
import { NativeSelect } from "@/components/ui/native-select";
import { Button } from "@/components/ui/button";
import { PlanExercisePicker } from "@/components/PlanExercisePicker";
import type { LibraryExercise } from "@/lib/exercise-library";
import {
  moveOrderedItem,
  replaceTrainingPlanExercise,
  type TrainingPlanExercise,
} from "@/lib/training-plans";

const localId = (kind: string) =>
  `${kind}:${typeof crypto !== "undefined" && crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`}`;

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
    isBodyweight: exercise.is_bodyweight,
  };
}

/** Controlled exercise prescriptions shared by plan days and private workouts. */
export function WorkoutExerciseListEditor({
  exercises,
  onChange,
  title,
  disabled = false,
}: {
  exercises: TrainingPlanExercise[];
  onChange: (exercises: TrainingPlanExercise[]) => void;
  title: string;
  disabled?: boolean;
}) {
  // undefined = closed, null = add, number = replace that row.
  const [picker, setPicker] = useState<number | null | undefined>(undefined);
  const change = (next: TrainingPlanExercise[]) =>
    onChange(next.map((exercise, index) => ({ ...exercise, order: index + 1 })));
  const moveExercise = (from: number, to: number) => change(moveOrderedItem(exercises, from, to));
  const updateExercise = (index: number, patch: Partial<TrainingPlanExercise>) =>
    change(exercises.map((exercise, i) => (i === index ? { ...exercise, ...patch } : exercise)));
  function chooseExercise(exercise: LibraryExercise) {
    if (picker === undefined) return;
    const next = [...exercises];
    if (picker === null) next.push(fromLibrary(exercise));
    else next[picker] = replaceTrainingPlanExercise(next[picker]!, exercise);
    change(next);
    setPicker(undefined);
  }
  return (
    <fieldset disabled={disabled} className="min-w-0 space-y-3">
      <legend className="sr-only">Exercises for {title}</legend>
      {exercises.map((exercise, exerciseIndex) => (
        <div key={exercise.id} className="rounded-2xl border border-border/70 bg-elevated/40 p-4">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
            <div className="flex min-w-0 items-start gap-3">
              <span className="num mt-0.5 grid h-7 w-7 shrink-0 place-items-center rounded-full bg-primary/15 text-xs font-semibold text-primary">
                {exerciseIndex + 1}
              </span>
              <div className="min-w-0">
                <p className="break-words font-semibold leading-snug">{exercise.name}</p>
                {exercise.exerciseId ? null : (
                  <p className="text-xs text-danger">Exercise unavailable</p>
                )}
              </div>
            </div>
            <div className="flex self-end sm:self-auto">
              <ExerciseIconButton
                label={`Move ${exercise.name} up`}
                disabled={exerciseIndex === 0}
                onClick={() => moveExercise(exerciseIndex, exerciseIndex - 1)}
              >
                <ArrowUp />
              </ExerciseIconButton>
              <ExerciseIconButton
                label={`Move ${exercise.name} down`}
                disabled={exerciseIndex === exercises.length - 1}
                onClick={() => moveExercise(exerciseIndex, exerciseIndex + 1)}
              >
                <ArrowDown />
              </ExerciseIconButton>
            </div>
          </div>
          <div className="mt-3 grid grid-cols-3 gap-2">
            <NumberField
              label="Sets"
              value={exercise.sets}
              min={1}
              max={10}
              onChange={(value) => updateExercise(exerciseIndex, { sets: value })}
            />
            <NumberField
              label="Min reps"
              value={exercise.repMin}
              min={1}
              max={100}
              onChange={(value) => updateExercise(exerciseIndex, { repMin: value })}
            />
            <NumberField
              label="Max reps"
              value={exercise.repMax}
              min={1}
              max={100}
              onChange={(value) => updateExercise(exerciseIndex, { repMax: value })}
            />
          </div>
          {exercise.supportsUnilateral ? (
            <label className="mt-3 block text-xs font-medium text-muted-foreground">
              Execution
              <NativeSelect
                value={exercise.intendedUnilateralMode}
                onChange={(event) =>
                  updateExercise(exerciseIndex, {
                    intendedUnilateralMode: event.target.value as "bilateral" | "unilateral",
                  })
                }
                aria-label={`Execution mode for ${exercise.name}`}
                containerClassName="mt-1 w-full"
                className="min-h-11 rounded-xl border border-input bg-elevated px-3 text-sm text-foreground"
              >
                <option value="bilateral">Bilateral / standard</option>
                <option value="unilateral">Unilateral / single side</option>
              </NativeSelect>
            </label>
          ) : null}
          <label className="mt-3 block text-xs font-medium text-muted-foreground">
            Exercise note
            <input
              value={exercise.notes ?? ""}
              maxLength={240}
              onChange={(event) =>
                updateExercise(exerciseIndex, {
                  notes: event.target.value || null,
                })
              }
              className="mt-1 min-h-11 w-full rounded-xl border border-input bg-elevated px-3 text-sm text-foreground"
            />
          </label>
          <div className="mt-3 grid grid-cols-2 gap-2 border-t border-border/60 pt-3">
            <Button
              variant="ghost"
              className="min-h-11 min-w-0 rounded-xl px-2 bg-elevated"
              onClick={() => setPicker(exerciseIndex)}
            >
              <Replace aria-hidden="true" /> Replace
            </Button>
            <Button
              variant="ghost"
              className="min-h-11 min-w-0 rounded-xl px-2 bg-danger/10 text-danger"
              onClick={() => change(exercises.filter((_, index) => index !== exerciseIndex))}
            >
              <Trash2 aria-hidden="true" /> Remove
            </Button>
          </div>
        </div>
      ))}
      <Button
        variant="outline"
        className="min-h-11 w-full"
        disabled={exercises.length >= 20}
        onClick={() => setPicker(null)}
      >
        <Plus aria-hidden="true" /> Add Exercise
      </Button>
      {picker !== undefined ? (
        <PlanExercisePicker
          open
          onOpenChange={(open) => {
            if (!open) setPicker(undefined);
          }}
          onSelect={chooseExercise}
          title={picker === null ? `Add to ${title}` : "Replace exercise"}
        />
      ) : null}
    </fieldset>
  );
}

function ExerciseIconButton({
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
        className="mt-1 min-h-11 min-w-0 w-full rounded-lg border border-input bg-background px-2 text-center text-base text-foreground"
      />
    </label>
  );
}
