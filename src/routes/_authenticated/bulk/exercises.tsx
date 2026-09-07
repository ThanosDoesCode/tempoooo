import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useDeferredValue, useState } from "react";
import { z } from "zod";
import { AppShell, PageHeader } from "@/components/AppShell";
import { Card, DataError, PendingLabel, SectionTitle } from "@/components/ui-kit";
import {
  createCustomExercise,
  deleteCustomExercise,
  useExerciseLibrary,
} from "@/lib/exercise-library-query";
import {
  EXERCISE_EQUIPMENT,
  EXERCISE_EXPERIENCE_LEVELS,
  MUSCLE_GROUPS,
  type ExerciseEquipment,
  type ExerciseExperienceLevel,
  type MuscleGroup,
} from "@/lib/exercise-library";
import { useQueryClient } from "@tanstack/react-query";
import { userFacingError } from "@/lib/network-errors";
import { useActions, useAppData } from "@/lib/store";
import { useAuth } from "@/lib/auth";
import { orderedExerciseDefs, type ExerciseDef, type SplitType } from "@/lib/types";
import { updateExercise } from "@/lib/training";

export const Route = createFileRoute("/_authenticated/bulk/exercises")({
  validateSearch: z.object({
    addTo: z.enum(["Chest & Back", "Legs", "Arms & Shoulders"]).optional(),
    date: z.string().optional(),
  }),
  head: () => ({ meta: [{ title: "Tempo" }] }),
  component: ExerciseLibraryPage,
});

const label = (value: string) =>
  value
    .split("_")
    .map((part) => part[0]?.toUpperCase() + part.slice(1))
    .join(" ");

function ExerciseLibraryPage() {
  const { addTo, date } = Route.useSearch();
  const navigate = useNavigate();
  const data = useAppData();
  const { user } = useAuth();
  const { saveTargets, saveWorkout } = useActions();
  const queryClient = useQueryClient();
  const [search, setSearch] = useState("");
  const deferredSearch = useDeferredValue(search);
  const [muscle, setMuscle] = useState<MuscleGroup | "">("");
  const [equipment, setEquipment] = useState<ExerciseEquipment | "">("");
  const [experience, setExperience] = useState<ExerciseExperienceLevel | "">("");
  const [unilateralOnly, setUnilateralOnly] = useState(false);
  const [origin, setOrigin] = useState<"all" | "system" | "custom">("all");
  const [page, setPage] = useState(0);
  const library = useExerciseLibrary(
    {
      search: deferredSearch,
      primaryMuscle: muscle || undefined,
      equipment: equipment || undefined,
      unilateralOnly,
      experienceLevel: experience || undefined,
      origin,
    },
    page,
  );
  const [name, setName] = useState("");
  const [customMuscle, setCustomMuscle] = useState<MuscleGroup>("chest");
  const [secondaryMuscles, setSecondaryMuscles] = useState<MuscleGroup[]>([]);
  const [customEquipment, setCustomEquipment] = useState<ExerciseEquipment[]>([]);
  const [customUnilateral, setCustomUnilateral] = useState(false);
  const [saving, setSaving] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [addingId, setAddingId] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);

  const refreshLibrary = () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: ["bulk-exercise-library"] }),
      queryClient.invalidateQueries({ queryKey: ["bulk-muscle-coverage"] }),
    ]);

  const create = async () => {
    if (saving) return;
    if (name.trim().length < 2 || !customEquipment.length) {
      setFormError("Add a name and at least one equipment option.");
      return;
    }
    setSaving(true);
    setFormError(null);
    setMessage(null);
    try {
      await createCustomExercise({
        name,
        primaryMuscle: customMuscle,
        secondaryMuscles: secondaryMuscles.filter((item) => item !== customMuscle),
        equipment: customEquipment,
        supportsUnilateral: customUnilateral,
      });
      await refreshLibrary();
      setName("");
      setSecondaryMuscles([]);
      setCustomEquipment([]);
      setCustomUnilateral(false);
      setMessage("Custom exercise saved.");
    } catch (error) {
      setFormError(userFacingError(error, "save this custom exercise", { inputPreserved: true }));
    } finally {
      setSaving(false);
    }
  };

  const remove = async (id: string) => {
    if (deletingId) return;
    if (!window.confirm("Delete this custom exercise?")) return;
    setDeletingId(id);
    setFormError(null);
    try {
      await deleteCustomExercise(id);
      await refreshLibrary();
      setMessage("Custom exercise deleted.");
    } catch (error) {
      setFormError(userFacingError(error, "delete this custom exercise"));
    } finally {
      setDeletingId(null);
    }
  };

  const resetPage = () => setPage(0);

  const addToLegacyWorkout = async (
    item: NonNullable<typeof library.data>["exercises"][number],
  ) => {
    if (!addTo || !date || !data || !user || addingId) return;
    const existing = data.workouts[date];
    if (existing?.status === "completed") {
      setFormError("Completed workouts cannot be changed.");
      return;
    }
    const definitionAlreadySaved = orderedExerciseDefs(data.targets, addTo).some(
      (exercise) => exercise.name === item.name,
    );
    const workoutAlreadyUpdated =
      existing?.entries.some((entry) => entry.exercise === item.name) ?? false;
    if (definitionAlreadySaved && (!existing || workoutAlreadyUpdated)) {
      setFormError("That exercise is already in this workout.");
      return;
    }
    setAddingId(item.id);
    setFormError(null);
    const definition: ExerciseDef = {
      name: item.name,
      min: 8,
      max: 12,
      ...(item.is_bodyweight ? { loadKind: "bodyweight" as const } : {}),
    };
    const currentDefinitions = data.targets.legacyExerciseDefinitions?.[addTo] ?? [];
    const currentOrder = orderedExerciseDefs(data.targets, addTo).map((exercise) => exercise.name);
    try {
      if (!definitionAlreadySaved) {
        await saveTargets({
          ...data.targets,
          legacyExerciseDefinitions: {
            ...(data.targets.legacyExerciseDefinitions ?? {}),
            [addTo]: [...currentDefinitions, definition],
          },
          legacyExerciseOrder: {
            ...(data.targets.legacyExerciseOrder ?? {}),
            [addTo]: [...currentOrder, item.name],
          },
        });
      }
      if (existing && existing.type === addTo && !workoutAlreadyUpdated) {
        await saveWorkout(updateExercise(existing, item.name, {}), user.id);
      }
      await navigate({ to: "/bulk/training", replace: true });
    } catch (error) {
      setFormError(userFacingError(error, "add this exercise", { inputPreserved: true }));
    } finally {
      setAddingId(null);
    }
  };

  return (
    <AppShell>
      <PageHeader
        title={addTo ? "Add to workout" : "Exercise library"}
        subtitle={
          addTo
            ? `Choose an exercise for ${addTo}.`
            : "Browse Tempo exercises or save movements that are unique to your setup."
        }
        backTo="/bulk/training"
        backLabel="Training"
      />

      <Card>
        <SectionTitle>Find an exercise</SectionTitle>
        <input
          type="search"
          value={search}
          onChange={(event) => {
            setSearch(event.target.value);
            resetPage();
          }}
          placeholder="Search by exercise name"
          aria-label="Search exercises"
          className="min-h-11 w-full rounded-xl border border-input bg-elevated px-3 text-base outline-none focus:border-ring"
        />
        <div className="mt-3 grid grid-cols-2 gap-2">
          <select
            value={muscle}
            onChange={(event) => {
              setMuscle(event.target.value as MuscleGroup | "");
              resetPage();
            }}
            aria-label="Filter by primary muscle"
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
            aria-label="Filter by equipment"
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
            aria-label="Filter by exercise source"
            className="min-h-11 min-w-0 rounded-xl border border-input bg-elevated px-2 text-sm"
          >
            <option value="all">Tempo + mine</option>
            <option value="system">Tempo exercises</option>
            <option value="custom">My exercises</option>
          </select>
          <select
            value={experience}
            onChange={(event) => {
              setExperience(event.target.value as ExerciseExperienceLevel | "");
              resetPage();
            }}
            aria-label="Filter by experience level"
            className="min-h-11 min-w-0 rounded-xl border border-input bg-elevated px-2 text-sm"
          >
            <option value="">All experience</option>
            {EXERCISE_EXPERIENCE_LEVELS.map((item) => (
              <option key={item} value={item}>
                {label(item)}
              </option>
            ))}
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
      </Card>

      <details className="card-surface mt-4 p-4">
        <summary className="flex min-h-11 cursor-pointer items-center font-semibold">
          Add custom exercise
        </summary>
        <div className="mt-3 space-y-4">
          <label className="block text-xs text-muted-foreground">
            Exercise name
            <input
              value={name}
              maxLength={80}
              onChange={(event) => setName(event.target.value)}
              className="mt-1 min-h-11 w-full rounded-xl border border-input bg-elevated px-3 text-base text-foreground outline-none focus:border-ring"
            />
          </label>
          <label className="block text-xs text-muted-foreground">
            Primary muscle
            <select
              value={customMuscle}
              onChange={(event) => setCustomMuscle(event.target.value as MuscleGroup)}
              className="mt-1 min-h-11 w-full rounded-xl border border-input bg-elevated px-3 text-base text-foreground"
            >
              {MUSCLE_GROUPS.map((item) => (
                <option key={item} value={item}>
                  {label(item)}
                </option>
              ))}
            </select>
          </label>
          <OptionButtons
            title="Secondary muscles (optional)"
            options={MUSCLE_GROUPS.filter((item) => item !== customMuscle)}
            selected={secondaryMuscles}
            onChange={setSecondaryMuscles}
          />
          <OptionButtons
            title="Equipment"
            options={EXERCISE_EQUIPMENT}
            selected={customEquipment}
            onChange={setCustomEquipment}
          />
          <label className="flex min-h-11 items-center gap-2 text-sm text-foreground">
            <input
              type="checkbox"
              checked={customUnilateral}
              onChange={(event) => setCustomUnilateral(event.target.checked)}
            />
            Can be performed one side at a time
          </label>
          <button
            type="button"
            disabled={saving}
            onClick={() => void create()}
            className="min-h-11 w-full rounded-xl bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground disabled:opacity-60"
          >
            {saving ? <PendingLabel>Saving exercise...</PendingLabel> : "Save custom exercise"}
          </button>
        </div>
      </details>

      {formError ? (
        <p role="alert" className="mt-3 text-sm text-danger">
          {formError}
        </p>
      ) : null}
      {message ? (
        <p role="status" className="mt-3 text-sm text-good">
          {message}
        </p>
      ) : null}

      <section className="mt-5" aria-live="polite">
        <div className="mb-2 flex items-center justify-between">
          <SectionTitle>Exercises</SectionTitle>
          <span className="text-xs text-muted-foreground">Page {page + 1}</span>
        </div>
        {library.isLoading ? (
          <div className="space-y-2">
            {Array.from({ length: 5 }, (_, index) => (
              <div key={index} className="h-20 animate-pulse rounded-2xl bg-card" />
            ))}
          </div>
        ) : library.error ? (
          <DataError message="Could not load exercises." onRetry={() => void library.refetch()} />
        ) : library.data?.exercises.length ? (
          <div className="space-y-2">
            {library.data.exercises.map((item) => (
              <div key={item.id} className="card-surface p-3">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="font-medium text-foreground">{item.name}</p>
                    <p className="mt-1 text-xs text-muted-foreground">
                      {label(item.primary_muscle)} · {item.equipment.map(label).join(", ")}
                      {item.supports_unilateral ? " · Unilateral option" : ""}
                    </p>
                  </div>
                  {!item.is_system ? (
                    <button
                      type="button"
                      disabled={deletingId !== null}
                      onClick={() => void remove(item.id)}
                      className="min-h-11 shrink-0 rounded-lg px-2 text-xs font-semibold text-danger disabled:opacity-50"
                    >
                      {deletingId === item.id ? "Deleting..." : "Delete"}
                    </button>
                  ) : null}
                </div>
                {addTo ? (
                  <button
                    type="button"
                    disabled={addingId !== null}
                    onClick={() => void addToLegacyWorkout(item)}
                    className="mt-3 min-h-11 w-full rounded-xl bg-primary px-3 text-sm font-semibold text-primary-foreground active:scale-[0.98] disabled:opacity-60"
                  >
                    {addingId === item.id ? (
                      <PendingLabel>Adding...</PendingLabel>
                    ) : (
                      "Add to workout"
                    )}
                  </button>
                ) : null}
              </div>
            ))}
          </div>
        ) : (
          <div className="card-surface p-5 text-center text-sm text-muted-foreground">
            No exercises match these filters.
          </div>
        )}
        <div className="mt-3 grid grid-cols-2 gap-2">
          <button
            type="button"
            disabled={page === 0}
            onClick={() => setPage((current) => Math.max(0, current - 1))}
            className="min-h-11 rounded-xl border border-border text-sm font-semibold disabled:opacity-40"
          >
            Previous
          </button>
          <button
            type="button"
            disabled={!library.data?.hasMore}
            onClick={() => setPage((current) => current + 1)}
            className="min-h-11 rounded-xl border border-border text-sm font-semibold disabled:opacity-40"
          >
            Next
          </button>
        </div>
      </section>
    </AppShell>
  );
}

function OptionButtons<T extends string>({
  title,
  options,
  selected,
  onChange,
}: {
  title: string;
  options: readonly T[];
  selected: T[];
  onChange: (next: T[]) => void;
}) {
  return (
    <fieldset>
      <legend className="text-xs text-muted-foreground">{title}</legend>
      <div className="mt-1 flex flex-wrap gap-1.5">
        {options.map((item) => {
          const active = selected.includes(item);
          return (
            <button
              key={item}
              type="button"
              aria-pressed={active}
              onClick={() =>
                onChange(active ? selected.filter((value) => value !== item) : [...selected, item])
              }
              className={`min-h-11 rounded-xl border px-3 py-2 text-xs font-medium ${active ? "border-primary bg-primary/10 text-primary" : "border-border text-muted-foreground"}`}
            >
              {label(item)}
            </button>
          );
        })}
      </div>
    </fieldset>
  );
}
