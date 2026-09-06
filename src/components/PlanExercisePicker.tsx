import { useDeferredValue, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Plus } from "lucide-react";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { DataError, PendingLabel } from "@/components/ui-kit";
import {
  EXERCISE_EQUIPMENT,
  MUSCLE_GROUPS,
  type ExerciseEquipment,
  type LibraryExercise,
  type MuscleGroup,
} from "@/lib/exercise-library";
import { createCustomExercise, useExerciseLibrary } from "@/lib/exercise-library-query";
import { userFacingError } from "@/lib/network-errors";

const label = (value: string) =>
  value
    .split("_")
    .map((part) => part[0]?.toUpperCase() + part.slice(1))
    .join(" ");

export function PlanExercisePicker({
  open,
  onOpenChange,
  onSelect,
  title,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSelect: (exercise: LibraryExercise) => void;
  title: string;
}) {
  const queryClient = useQueryClient();
  const [search, setSearch] = useState("");
  const deferredSearch = useDeferredValue(search);
  const [muscle, setMuscle] = useState<MuscleGroup | "">("");
  const [equipment, setEquipment] = useState<ExerciseEquipment | "">("");
  const [unilateralOnly, setUnilateralOnly] = useState(false);
  const [origin, setOrigin] = useState<"all" | "system" | "custom">("all");
  const [page, setPage] = useState(0);
  const library = useExerciseLibrary(
    {
      search: deferredSearch,
      primaryMuscle: muscle || undefined,
      equipment: equipment || undefined,
      unilateralOnly,
      origin,
    },
    page,
  );
  const [showCustom, setShowCustom] = useState(false);
  const [customName, setCustomName] = useState("");
  const [customMuscle, setCustomMuscle] = useState<MuscleGroup>("chest");
  const [customEquipment, setCustomEquipment] = useState<ExerciseEquipment>("dumbbell");
  const [customUnilateral, setCustomUnilateral] = useState(false);
  const [savingCustom, setSavingCustom] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const resetPage = () => setPage(0);
  const select = (exercise: LibraryExercise) => {
    onSelect(exercise);
    onOpenChange(false);
  };

  async function createAndSelect() {
    if (customName.trim().length < 2) {
      setError("Enter a custom exercise name.");
      return;
    }
    setSavingCustom(true);
    setError(null);
    try {
      const exercise = await createCustomExercise({
        name: customName,
        primaryMuscle: customMuscle,
        equipment: [customEquipment],
        supportsUnilateral: customUnilateral,
      });
      await queryClient.invalidateQueries({ queryKey: ["bulk-exercise-library"] });
      select(exercise);
      setCustomName("");
    } catch (cause) {
      setError(userFacingError(cause, "save this custom exercise", { inputPreserved: true }));
    } finally {
      setSavingCustom(false);
    }
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="bottom" className="h-[100dvh] overflow-y-auto px-4 pb-safe">
        <SheetHeader className="pr-8 text-left">
          <SheetTitle>{title}</SheetTitle>
          <SheetDescription>Choose a Tempo exercise or one of your own.</SheetDescription>
        </SheetHeader>
        <div className="mt-4 space-y-3">
          <input
            type="search"
            value={search}
            onChange={(event) => {
              setSearch(event.target.value);
              resetPage();
            }}
            placeholder="Search exercises"
            aria-label="Search plan exercises"
            className="min-h-11 w-full rounded-xl border border-input bg-elevated px-3 text-base outline-none focus:border-ring"
          />
          <div className="grid grid-cols-2 gap-2">
            <select
              value={muscle}
              onChange={(event) => {
                setMuscle(event.target.value as MuscleGroup | "");
                resetPage();
              }}
              aria-label="Filter plan exercises by muscle"
              className="min-h-11 min-w-0 rounded-xl border border-input bg-elevated px-2 text-sm"
            >
              <option value="">All muscles</option>
              {MUSCLE_GROUPS.map((item) => (
                <option key={item} value={item}>
                  {label(item)}
                </option>
              ))}
            </select>
            <select
              value={equipment}
              onChange={(event) => {
                setEquipment(event.target.value as ExerciseEquipment | "");
                resetPage();
              }}
              aria-label="Filter plan exercises by equipment"
              className="min-h-11 min-w-0 rounded-xl border border-input bg-elevated px-2 text-sm"
            >
              <option value="">All equipment</option>
              {EXERCISE_EQUIPMENT.map((item) => (
                <option key={item} value={item}>
                  {label(item)}
                </option>
              ))}
            </select>
            <select
              value={origin}
              onChange={(event) => {
                setOrigin(event.target.value as typeof origin);
                resetPage();
              }}
              aria-label="Filter plan exercises by source"
              className="min-h-11 min-w-0 rounded-xl border border-input bg-elevated px-2 text-sm"
            >
              <option value="all">Tempo + mine</option>
              <option value="system">Tempo exercises</option>
              <option value="custom">My exercises</option>
            </select>
            <label className="flex min-h-11 items-center gap-2 rounded-xl border border-input px-3 text-sm">
              <input
                type="checkbox"
                checked={unilateralOnly}
                onChange={(event) => {
                  setUnilateralOnly(event.target.checked);
                  resetPage();
                }}
              />
              Unilateral
            </label>
          </div>
          <Button
            variant="outline"
            className="min-h-11 w-full"
            onClick={() => setShowCustom((value) => !value)}
          >
            <Plus aria-hidden="true" /> Create custom exercise
          </Button>
          {showCustom ? (
            <div className="space-y-3 rounded-xl border border-border p-3">
              <input
                value={customName}
                maxLength={80}
                onChange={(event) => setCustomName(event.target.value)}
                placeholder="Custom exercise name"
                aria-label="Custom exercise name"
                className="min-h-11 w-full rounded-xl border border-input bg-elevated px-3 text-base"
              />
              <div className="grid grid-cols-2 gap-2">
                <select
                  value={customMuscle}
                  onChange={(event) => setCustomMuscle(event.target.value as MuscleGroup)}
                  aria-label="Custom exercise primary muscle"
                  className="min-h-11 min-w-0 rounded-xl border border-input bg-elevated px-2 text-sm"
                >
                  {MUSCLE_GROUPS.map((item) => (
                    <option key={item} value={item}>
                      {label(item)}
                    </option>
                  ))}
                </select>
                <select
                  value={customEquipment}
                  onChange={(event) => setCustomEquipment(event.target.value as ExerciseEquipment)}
                  aria-label="Custom exercise equipment"
                  className="min-h-11 min-w-0 rounded-xl border border-input bg-elevated px-2 text-sm"
                >
                  {EXERCISE_EQUIPMENT.map((item) => (
                    <option key={item} value={item}>
                      {label(item)}
                    </option>
                  ))}
                </select>
              </div>
              <label className="flex min-h-11 items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={customUnilateral}
                  onChange={(event) => setCustomUnilateral(event.target.checked)}
                />
                Supports unilateral execution
              </label>
              <Button
                className="min-h-11 w-full"
                disabled={savingCustom}
                onClick={() => void createAndSelect()}
              >
                {savingCustom ? <PendingLabel>Saving exercise</PendingLabel> : "Save and select"}
              </Button>
            </div>
          ) : null}
          {error ? (
            <p role="alert" className="text-sm text-danger">
              {error}
            </p>
          ) : null}
          {library.isLoading ? (
            <div className="space-y-2">
              {Array.from({ length: 5 }, (_, index) => (
                <div key={index} className="h-16 animate-pulse rounded-xl bg-card" />
              ))}
            </div>
          ) : library.error ? (
            <DataError message="Could not load exercises." onRetry={() => void library.refetch()} />
          ) : library.data?.exercises.length ? (
            <div className="space-y-2">
              {library.data.exercises.map((exercise) => (
                <button
                  key={exercise.id}
                  type="button"
                  onClick={() => select(exercise)}
                  className="card-surface flex min-h-14 w-full items-center justify-between gap-3 p-3 text-left active:scale-[0.99]"
                >
                  <span>
                    <span className="block font-medium">{exercise.name}</span>
                    <span className="mt-0.5 block text-xs text-muted-foreground">
                      {label(exercise.primary_muscle)} · {exercise.equipment.map(label).join(", ")}
                    </span>
                  </span>
                  <Plus className="shrink-0 text-primary" aria-hidden="true" />
                </button>
              ))}
            </div>
          ) : (
            <p className="rounded-xl bg-card p-4 text-center text-sm text-muted-foreground">
              No exercises match these filters.
            </p>
          )}
          <div className="grid grid-cols-2 gap-2">
            <Button
              variant="outline"
              className="min-h-11"
              disabled={page === 0}
              onClick={() => setPage((value) => Math.max(0, value - 1))}
            >
              Previous
            </Button>
            <Button
              variant="outline"
              className="min-h-11"
              disabled={!library.data?.hasMore}
              onClick={() => setPage((value) => value + 1)}
            >
              Next
            </Button>
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}
