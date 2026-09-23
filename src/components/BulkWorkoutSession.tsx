import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from "react";
import { Link, useNavigate } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, Check, ChevronDown, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "./ui/button";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "./ui/alert-dialog";
import { DecimalInput } from "./DecimalInput";
import { Card, PendingLabel } from "./ui-kit";
import {
  Drawer,
  DrawerClose,
  DrawerContent,
  DrawerDescription,
  DrawerFooter,
  DrawerHeader,
  DrawerTitle,
} from "./ui/drawer";
import { cn } from "@/lib/utils";
import { userFacingError } from "@/lib/network-errors";
import {
  addBulkTrainingSet,
  discardBulkTrainingSession,
  finishBulkTrainingSession,
  removeBulkTrainingSet,
  saveBulkTrainingSet,
  type BulkTrainingSession,
  type BulkTrainingSessionExercise,
  type BulkTrainingSet,
  type EditableSessionSet,
} from "@/lib/bulk-training-sessions";
import {
  isSessionSetComplete,
  sessionElapsedSeconds,
  sessionSetLabel,
  sessionSetVolume,
  type BulkSetType,
} from "@/lib/bulk-training-session-domain";
import type { BulkProgressionPreviousSet, BulkProgressionResult } from "@/lib/bulk-progression";
import { buildBulkNextSessionGuidance } from "@/lib/bulk-next-session-guidance";

type SetDraft = EditableSessionSet;

const toDraft = (set: BulkTrainingSet): SetDraft => ({
  id: set.id,
  setType: set.setType,
  rpe: set.rpe,
  bilateralWeight: set.bilateralWeight,
  bilateralReps: set.bilateralReps,
  leftWeight: set.leftWeight,
  leftReps: set.leftReps,
  rightWeight: set.rightWeight,
  rightReps: set.rightReps,
});

const hasValues = (set: SetDraft) =>
  [
    set.bilateralWeight,
    set.bilateralReps,
    set.leftWeight,
    set.leftReps,
    set.rightWeight,
    set.rightReps,
  ].some((value) => value != null) ||
  set.rpe != null ||
  set.setType !== "normal";

const formatDuration = (seconds: number) => {
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const rest = seconds % 60;
  return hours
    ? `${hours}:${String(minutes).padStart(2, "0")}:${String(rest).padStart(2, "0")}`
    : `${minutes}:${String(rest).padStart(2, "0")}`;
};

function previousSetLabel(
  previous: BulkProgressionPreviousSet | undefined,
  exercise: BulkTrainingSessionExercise,
) {
  if (!previous) return "—";
  if (exercise.executionMode === "unilateral") {
    if (previous.leftReps == null && previous.rightReps == null) return "—";
    return `L ${previous.leftLoad ?? "BW"}×${previous.leftReps ?? "—"} · R ${previous.rightLoad ?? "BW"}×${previous.rightReps ?? "—"}`;
  }
  if (previous.bilateralReps == null) return "—";
  if (exercise.isBodyweight && !previous.bilateralLoad) return `BW × ${previous.bilateralReps}`;
  return `${previous.bilateralLoad ?? 0}×${previous.bilateralReps}`;
}

function latestDraftLabel(exercise: BulkTrainingSessionExercise, drafts: Record<string, SetDraft>) {
  const latest = [...exercise.sets]
    .reverse()
    .map((set) => drafts[set.id] ?? toDraft(set))
    .find((set) => set.bilateralReps != null || set.leftReps != null || set.rightReps != null);
  if (!latest) return null;
  if (exercise.executionMode === "unilateral") {
    return `L ${latest.leftWeight ?? "BW"}×${latest.leftReps ?? "—"} · R ${latest.rightWeight ?? "BW"}×${latest.rightReps ?? "—"}`;
  }
  if (exercise.isBodyweight && latest.bilateralWeight == null)
    return `BW × ${latest.bilateralReps ?? "—"}`;
  return `${latest.bilateralWeight ?? 0} kg × ${latest.bilateralReps ?? "—"}`;
}

function draftStorageKey(session: BulkTrainingSession) {
  return `tempo:bulk-workout-draft:${session.bulkProfileId}:${session.id}`;
}

function readLocalDrafts(session: BulkTrainingSession, serverDrafts: Record<string, SetDraft>) {
  if (typeof window === "undefined") return serverDrafts;
  try {
    const raw = window.localStorage.getItem(draftStorageKey(session));
    if (!raw) return serverDrafts;
    const saved = JSON.parse(raw) as Record<string, SetDraft>;
    return Object.fromEntries(
      Object.entries(serverDrafts).map(([id, value]) => [
        id,
        saved[id]?.id === id ? saved[id] : value,
      ]),
    );
  } catch {
    return serverDrafts;
  }
}

function writeLocalDrafts(session: BulkTrainingSession, drafts: Record<string, SetDraft>) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(draftStorageKey(session), JSON.stringify(drafts));
  } catch {
    // The server remains authoritative when private browsing blocks local storage.
  }
}

function clearLocalDrafts(session: BulkTrainingSession) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(draftStorageKey(session));
  } catch {
    // A blocked cleanup must not prevent a confirmed server mutation.
  }
}

export function BulkWorkoutSessionView({
  session,
  progression,
}: {
  session: BulkTrainingSession;
  progression: Record<string, BulkProgressionResult>;
}) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [drafts, setDrafts] = useState<Record<string, SetDraft>>(() =>
    readLocalDrafts(
      session,
      Object.fromEntries(
        session.exercises.flatMap((exercise) => exercise.sets.map((set) => [set.id, toDraft(set)])),
      ),
    ),
  );
  const draftsRef = useRef(drafts);
  const dirty = useRef(new Set<string>());
  const timers = useRef(new Map<string, ReturnType<typeof setTimeout>>());
  const pending = useRef(new Map<string, Promise<void>>());
  const [saving, setSaving] = useState(new Set<string>());
  const [saveErrors, setSaveErrors] = useState<Record<string, string>>({});
  const saveErrorsRef = useRef(saveErrors);
  const [finishing, setFinishing] = useState(false);
  const [discarding, setDiscarding] = useState(false);
  const [finishDialog, setFinishDialog] = useState(false);
  const [discardDialog, setDiscardDialog] = useState(false);
  const [clock, setClock] = useState(() => Date.now());
  const [adding, setAdding] = useState(new Set<string>());
  const [removing, setRemoving] = useState(new Set<string>());
  const [openSetId, setOpenSetId] = useState<string | null>(null);
  const [collapsedExercises, setCollapsedExercises] = useState(new Set<string>());
  const addPending = useRef(new Set<string>());
  const removePending = useRef(new Set<string>());
  draftsRef.current = drafts;
  saveErrorsRef.current = saveErrors;

  useEffect(() => {
    const timer = window.setInterval(() => setClock(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    const restoredIds = session.exercises.flatMap((exercise) =>
      exercise.sets
        .filter((set) => JSON.stringify(draftsRef.current[set.id]) !== JSON.stringify(toDraft(set)))
        .map((set) => set.id),
    );
    if (!restoredIds.length) return;
    restoredIds.forEach((setId) => {
      dirty.current.add(setId);
      timers.current.set(
        setId,
        setTimeout(() => void persist(setId), 0),
      );
    });
    setSaving((value) => new Set([...value, ...restoredIds]));
    // Only the authorized session's initial server snapshot is compared.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session.id]);

  useEffect(() => {
    setDrafts((current) => {
      const next = { ...current };
      session.exercises.forEach((exercise) =>
        exercise.sets.forEach((set) => {
          if (!dirty.current.has(set.id)) next[set.id] = toDraft(set);
        }),
      );
      return next;
    });
  }, [session]);

  useEffect(() => {
    const currentTimers = timers.current;
    const currentDirty = dirty.current;
    const flushOnHide = () => {
      if (document.visibilityState === "hidden") void flushAll();
    };
    document.addEventListener("visibilitychange", flushOnHide);
    return () => {
      document.removeEventListener("visibilitychange", flushOnHide);
      currentTimers.forEach(clearTimeout);
      currentDirty.forEach((id) => void persist(id));
    };
    // The refs hold the latest drafts and pending writes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session.id]);

  async function persist(setId: string) {
    timers.current.delete(setId);
    const draft = draftsRef.current[setId];
    if (!draft || !dirty.current.has(setId)) return;
    const existing = pending.current.get(setId);
    if (existing) await existing;
    const write = (async () => {
      setSaving((value) => new Set(value).add(setId));
      try {
        await saveBulkTrainingSet(session.id, draft);
        if (draftsRef.current[setId] === draft) dirty.current.delete(setId);
        if (dirty.current.size === 0) clearLocalDrafts(session);
        else writeLocalDrafts(session, draftsRef.current);
        delete saveErrorsRef.current[setId];
        setSaveErrors((value) => {
          const next = { ...value };
          delete next[setId];
          return next;
        });
      } catch (error) {
        const message = userFacingError(error, "save this set", { inputPreserved: true });
        saveErrorsRef.current[setId] = message;
        setSaveErrors((value) => ({ ...value, [setId]: message }));
      } finally {
        pending.current.delete(setId);
        setSaving((value) => {
          const next = new Set(value);
          if (!dirty.current.has(setId)) next.delete(setId);
          return next;
        });
      }
    })();
    pending.current.set(setId, write);
    await write;
  }

  function update(setId: string, patch: Partial<SetDraft>) {
    const next = {
      ...draftsRef.current,
      [setId]: { ...draftsRef.current[setId]!, ...patch },
    };
    draftsRef.current = next;
    setDrafts(next);
    writeLocalDrafts(session, next);
    dirty.current.add(setId);
    setSaving((value) => new Set(value).add(setId));
    const old = timers.current.get(setId);
    if (old) clearTimeout(old);
    timers.current.set(
      setId,
      setTimeout(() => void persist(setId), 400),
    );
  }

  async function flushAll() {
    timers.current.forEach(clearTimeout);
    timers.current.clear();
    await Promise.all([...dirty.current].map(persist));
    await Promise.all([...pending.current.values()]);
    if (Object.keys(saveErrorsRef.current).length)
      throw new Error("Some sets still need to be saved.");
  }

  async function refresh() {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ["bulk-training-session", session.id] }),
      queryClient.invalidateQueries({ queryKey: ["bulk-training-session", "active"] }),
      queryClient.invalidateQueries({ queryKey: ["bulk-training-sessions"] }),
      queryClient.invalidateQueries({ queryKey: ["bulk-progression"] }),
      queryClient.invalidateQueries({ queryKey: ["bulk-progress-summary"] }),
    ]);
  }

  async function addSet(exerciseId: string) {
    if (addPending.current.has(exerciseId)) return;
    addPending.current.add(exerciseId);
    setAdding((current) => new Set(current).add(exerciseId));
    try {
      await flushAll();
      await addBulkTrainingSet(session.id, exerciseId);
      await refresh();
    } catch (error) {
      toast.error(userFacingError(error, "add another set", { inputPreserved: true }));
    } finally {
      addPending.current.delete(exerciseId);
      setAdding((current) => {
        const next = new Set(current);
        next.delete(exerciseId);
        return next;
      });
    }
  }

  async function removeSet(setId: string) {
    if (removePending.current.has(setId)) return;
    removePending.current.add(setId);
    setRemoving((current) => new Set(current).add(setId));
    const wasDirty = dirty.current.has(setId);
    try {
      const timer = timers.current.get(setId);
      if (timer) clearTimeout(timer);
      timers.current.delete(setId);
      await removeBulkTrainingSet(session.id, setId);
      setOpenSetId(null);
      dirty.current.delete(setId);
      const nextDrafts = { ...draftsRef.current };
      delete nextDrafts[setId];
      draftsRef.current = nextDrafts;
      setDrafts(nextDrafts);
      writeLocalDrafts(session, nextDrafts);
      await refresh();
    } catch (error) {
      if (wasDirty) {
        dirty.current.add(setId);
        timers.current.set(
          setId,
          setTimeout(() => void persist(setId), 400),
        );
      }
      toast.error(userFacingError(error, "remove this set", { inputPreserved: true }));
    } finally {
      removePending.current.delete(setId);
      setRemoving((current) => {
        const next = new Set(current);
        next.delete(setId);
        return next;
      });
    }
  }

  async function finish(confirmIncomplete: boolean) {
    setOpenSetId(null);
    setFinishing(true);
    try {
      await flushAll();
      await finishBulkTrainingSession(session.id, confirmIncomplete);
      clearLocalDrafts(session);
      await refresh();
      toast.success("Workout completed");
      await navigate({ to: "/bulk/training/history" });
    } catch (error) {
      toast.error(userFacingError(error, "finish your workout", { inputPreserved: true }));
    } finally {
      setFinishing(false);
      setFinishDialog(false);
    }
  }

  async function discard() {
    setOpenSetId(null);
    setDiscarding(true);
    try {
      await discardBulkTrainingSession(session.id);
      clearLocalDrafts(session);
      await refresh();
      toast.success("Workout draft discarded");
      await navigate({ to: "/bulk/training" });
    } catch (error) {
      toast.error(userFacingError(error, "discard your workout", { inputPreserved: true }));
    } finally {
      setDiscarding(false);
      setDiscardDialog(false);
    }
  }

  const incomplete = useMemo(
    () =>
      session.exercises.reduce(
        (total, exercise) =>
          total +
          exercise.sets.filter(
            (set) => !isSessionSetComplete(drafts[set.id] ?? toDraft(set), exercise),
          ).length,
        0,
      ),
    [drafts, session.exercises],
  );
  const meaningful = Object.values(drafts).some(hasValues);
  const completedSets = session.exercises.reduce(
    (total, exercise) =>
      total +
      exercise.sets.filter((set) => isSessionSetComplete(drafts[set.id] ?? toDraft(set), exercise))
        .length,
    0,
  );
  const totalSets = session.exercises.reduce((total, exercise) => total + exercise.sets.length, 0);
  const elapsedSeconds = sessionElapsedSeconds(session.startedAt, clock);
  let volumeUnavailable = false;
  const totalVolume = session.exercises.reduce((total, exercise) => {
    const exerciseVolume = exercise.sets.reduce((sum, set) => {
      const volume = sessionSetVolume(
        drafts[set.id] ?? toDraft(set),
        exercise,
        session.bodyweightKg,
      );
      if (volume == null) volumeUnavailable = true;
      return sum + (volume ?? 0);
    }, 0);
    return total + exerciseVolume;
  }, 0);

  if (session.status === "completed") return <CompletedWorkout session={session} />;

  return (
    <div className="space-y-3 pb-8">
      <header className="sticky top-0 z-20 -mx-4 border-b border-border bg-background/95 px-4 pb-3 pt-2 backdrop-blur">
        <div className="flex min-h-11 items-center gap-2">
          <button
            type="button"
            aria-label="Back to Training"
            className="grid min-h-11 min-w-11 place-items-center rounded-xl text-muted-foreground active:bg-elevated"
            onClick={() => void navigate({ to: "/bulk/training" })}
          >
            <ArrowLeft className="h-5 w-5" aria-hidden="true" />
          </button>
          <div className="min-w-0 flex-1">
            <h1 className="truncate text-base font-semibold">{session.workoutDayName}</h1>
            <p className="truncate text-[11px] text-muted-foreground">{session.planName}</p>
          </div>
          <Button
            size="sm"
            className="min-h-11 px-4"
            onClick={() => (incomplete ? setFinishDialog(true) : void finish(false))}
            disabled={finishing || discarding}
          >
            {finishing ? <PendingLabel>Finishing</PendingLabel> : "Finish"}
          </Button>
        </div>
        <dl className="mt-2 grid grid-cols-3 divide-x divide-border rounded-xl bg-card px-2 py-2 text-center">
          <div>
            <dt className="text-[10px] uppercase tracking-wider text-muted-foreground">Duration</dt>
            <dd className="num mt-0.5 text-sm font-semibold">{formatDuration(elapsedSeconds)}</dd>
          </div>
          <div>
            <dt className="text-[10px] uppercase tracking-wider text-muted-foreground">Volume</dt>
            <dd className="num mt-0.5 text-sm font-semibold">
              {volumeUnavailable ? "Unavailable" : `${Math.round(totalVolume).toLocaleString()} kg`}
            </dd>
          </div>
          <div>
            <dt className="text-[10px] uppercase tracking-wider text-muted-foreground">Sets</dt>
            <dd className="num mt-0.5 text-sm font-semibold">
              {completedSets}/{totalSets}
            </dd>
          </div>
        </dl>
      </header>

      {session.exercises.map((exercise) => (
        <Card key={exercise.id} className="p-3">
          <button
            type="button"
            aria-expanded={!collapsedExercises.has(exercise.id)}
            aria-controls={`exercise-${exercise.id}`}
            onClick={() => {
              setOpenSetId(null);
              setCollapsedExercises((current) => {
                const next = new Set(current);
                if (next.has(exercise.id)) next.delete(exercise.id);
                else next.add(exercise.id);
                return next;
              });
            }}
            className="flex min-h-11 w-full items-start justify-between gap-3 rounded-lg text-left active:bg-elevated"
          >
            <div className="min-w-0">
              <h2 className="text-sm font-semibold">{exercise.name}</h2>
              {collapsedExercises.has(exercise.id) ? (
                <p className="mt-1 truncate text-xs text-muted-foreground">
                  {
                    exercise.sets.filter((set) =>
                      isSessionSetComplete(drafts[set.id] ?? toDraft(set), exercise),
                    ).length
                  }
                  /{exercise.sets.length} sets logged
                  {latestDraftLabel(exercise, drafts)
                    ? ` · ${latestDraftLabel(exercise, drafts)}`
                    : ""}
                </p>
              ) : (
                <p className="mt-0.5 text-xs text-muted-foreground">
                  {exercise.targetSets} sets · {exercise.targetRepMin}–{exercise.targetRepMax} reps
                  · {exercise.executionMode}
                  {exercise.isBodyweight ? " · bodyweight" : ""}
                </p>
              )}
            </div>
            <ChevronDown
              className={`mt-0.5 h-5 w-5 shrink-0 text-muted-foreground transition-transform duration-150 motion-reduce:transition-none ${collapsedExercises.has(exercise.id) ? "" : "rotate-180"}`}
              aria-hidden="true"
            />
          </button>
          <div id={`exercise-${exercise.id}`} hidden={collapsedExercises.has(exercise.id)}>
            {(() => {
              const target = progression[exercise.sourcePlanExerciseId ?? `session:${exercise.id}`];
              const guidance = buildBulkNextSessionGuidance(target, {
                planExerciseId: exercise.sourcePlanExerciseId ?? `session:${exercise.id}`,
                exerciseId: exercise.sourceExerciseId,
                executionMode: exercise.executionMode,
                isBodyweight: exercise.isBodyweight,
                targetSets: exercise.targetSets,
                repMin: exercise.targetRepMin,
                repMax: exercise.targetRepMax,
              });
              return (
                <div
                  className="mt-2 rounded-lg bg-primary/10 px-2.5 py-2 text-[11px] leading-relaxed"
                  aria-label={`Next-session guidance for ${exercise.name}`}
                >
                  <p className="text-primary">
                    <span className="font-semibold">Target today:</span> {guidance.targetText}
                  </p>
                  <p className="mt-0.5 text-muted-foreground">{guidance.reasonText}</p>
                </div>
              );
            })()}
            {exercise.notes ? (
              <p className="mt-2 rounded-lg bg-elevated p-2 text-xs text-muted-foreground">
                {exercise.notes}
              </p>
            ) : null}
            {exercise.isBodyweight ? (
              <p className="mt-2 rounded-lg bg-elevated px-2.5 py-2 text-xs text-muted-foreground">
                {session.bodyweightKg == null
                  ? "BW unavailable · Extra weight is still saved · Total unavailable"
                  : `BW ${session.bodyweightKg.toFixed(1)} kg · Extra weight is logged per set`}
              </p>
            ) : null}
            <div className="mt-3 overflow-x-auto pb-1">
              <div className="min-w-[330px]">
                <div className="grid grid-cols-[2.5rem_minmax(3.75rem,1fr)_3.25rem_3.25rem_2.75rem_2.75rem] gap-1 px-1 text-center text-[9px] font-medium uppercase tracking-wider text-muted-foreground">
                  <span>Set</span>
                  <span>Previous</span>
                  <span>{exercise.isBodyweight ? "+KG" : "KG"}</span>
                  <span>Reps</span>
                  <span>RPE</span>
                  <span>Done</span>
                </div>
                {exercise.sets.map((set, index) => (
                  <WorkoutSetRow
                    key={set.id}
                    exercise={exercise}
                    set={set}
                    draft={drafts[set.id] ?? toDraft(set)}
                    saving={saving.has(set.id)}
                    removing={removing.has(set.id)}
                    canRemove={exercise.sets.length > 1}
                    swipeOpen={openSetId === set.id}
                    previous={previousSetLabel(
                      progression[exercise.sourcePlanExerciseId ?? `session:${exercise.id}`]
                        ?.previousPerformance?.[index],
                      exercise,
                    )}
                    {...(saveErrors[set.id] ? { error: saveErrors[set.id] } : {})}
                    onChange={(patch) => update(set.id, patch)}
                    onRetry={() => void persist(set.id)}
                    onDone={() => void persist(set.id)}
                    onRemove={() => void removeSet(set.id)}
                    onSwipeBegin={() => setOpenSetId(null)}
                    onSwipeOpen={() => setOpenSetId(set.id)}
                    onSwipeClose={() =>
                      setOpenSetId((current) => (current === set.id ? null : current))
                    }
                  />
                ))}
              </div>
            </div>
            <Button
              variant="outline"
              className="mt-3 min-h-11 w-full"
              onClick={() => void addSet(exercise.id)}
              disabled={adding.has(exercise.id)}
            >
              <Plus aria-hidden="true" /> {adding.has(exercise.id) ? "Adding..." : "Add Set"}
            </Button>
          </div>
        </Card>
      ))}

      <Button
        variant="ghost"
        className="min-h-11 w-full text-danger"
        onClick={() => setDiscardDialog(true)}
        disabled={finishing || discarding}
      >
        Discard workout
      </Button>

      <AlertDialog open={finishDialog} onOpenChange={setFinishDialog}>
        <AlertDialogContent className="max-w-[calc(100%-2rem)] rounded-2xl">
          <AlertDialogHeader>
            <AlertDialogTitle>Finish with incomplete sets?</AlertDialogTitle>
            <AlertDialogDescription>
              You still have {incomplete} incomplete {incomplete === 1 ? "set" : "sets"}. Their
              missing values will remain empty in history.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="min-h-11">Keep logging</AlertDialogCancel>
            <AlertDialogAction className="min-h-11" onClick={() => void finish(true)}>
              Finish anyway
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      <AlertDialog open={discardDialog} onOpenChange={setDiscardDialog}>
        <AlertDialogContent className="max-w-[calc(100%-2rem)] rounded-2xl">
          <AlertDialogHeader>
            <AlertDialogTitle>Discard this workout?</AlertDialogTitle>
            <AlertDialogDescription>
              {meaningful
                ? "All logged values in this unfinished workout will be permanently discarded."
                : "This empty workout draft will be removed."}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="min-h-11">Keep workout</AlertDialogCancel>
            <AlertDialogAction
              className="min-h-11 bg-destructive text-destructive-foreground"
              onClick={() => void discard()}
            >
              {discarding ? "Discarding..." : "Discard workout"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function WorkoutSetRow({
  exercise,
  set,
  draft,
  saving,
  removing,
  canRemove,
  swipeOpen,
  previous,
  error,
  onChange,
  onRetry,
  onDone,
  onRemove,
  onSwipeBegin,
  onSwipeOpen,
  onSwipeClose,
}: {
  exercise: BulkTrainingSessionExercise;
  set: BulkTrainingSet;
  draft: SetDraft;
  saving: boolean;
  removing: boolean;
  canRemove: boolean;
  swipeOpen: boolean;
  previous: string;
  error?: string;
  onChange: (patch: Partial<SetDraft>) => void;
  onRetry: () => void;
  onDone: () => void;
  onRemove: () => void;
  onSwipeBegin: () => void;
  onSwipeOpen: () => void;
  onSwipeClose: () => void;
}) {
  const done = isSessionSetComplete(draft, exercise);
  const [typeOpen, setTypeOpen] = useState(false);
  const [rpeOpen, setRpeOpen] = useState(false);
  const [rpeDraft, setRpeDraft] = useState<number | null>(draft.rpe);
  const rowRef = useRef<HTMLDivElement>(null);
  const gesture = useRef<{ x: number; y: number; pointer: number; horizontal: boolean } | null>(
    null,
  );
  const [dragOffset, setDragOffset] = useState(swipeOpen ? 64 : 0);
  useEffect(() => setDragOffset(swipeOpen ? 64 : 0), [swipeOpen]);
  useEffect(() => {
    if (!swipeOpen) return;
    const close = (event: PointerEvent) => {
      if (!rowRef.current?.contains(event.target as Node)) onSwipeClose();
    };
    document.addEventListener("pointerdown", close);
    return () => document.removeEventListener("pointerdown", close);
  }, [onSwipeClose, swipeOpen]);

  const beginSwipe = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (
      !canRemove ||
      removing ||
      (event.target as HTMLElement).closest("button,input,select,textarea")
    )
      return;
    gesture.current = {
      x: event.clientX,
      y: event.clientY,
      pointer: event.pointerId,
      horizontal: false,
    };
    onSwipeBegin();
  };
  const moveSwipe = (event: ReactPointerEvent<HTMLDivElement>) => {
    const start = gesture.current;
    if (!start || start.pointer !== event.pointerId) return;
    const dx = event.clientX - start.x;
    const dy = event.clientY - start.y;
    if (!start.horizontal && Math.abs(dy) > Math.abs(dx) + 6) {
      gesture.current = null;
      return;
    }
    if (Math.abs(dx) > Math.abs(dy) + 6) start.horizontal = true;
    if (!start.horizontal) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    setDragOffset(Math.max(0, Math.min(64, (swipeOpen ? 64 : 0) + dx)));
  };
  const endSwipe = () => {
    if (!gesture.current) return;
    gesture.current = null;
    if (dragOffset >= 34) onSwipeOpen();
    else onSwipeClose();
  };
  const field = (label: string, value: number | null, key: keyof SetDraft, integer = false) => (
    <DecimalInput
      value={value ?? undefined}
      min={integer ? 1 : 0}
      max={1000}
      integer={integer}
      label={`${exercise.name}, set ${set.order}, ${label}`}
      className="h-11 min-w-0 w-full rounded-lg border border-input bg-background px-1 text-center text-base outline-none focus:border-ring"
      onChange={(next) => onChange({ [key]: next ?? null })}
    />
  );
  const typeBadge =
    draft.setType === "warmup"
      ? "W"
      : draft.setType === "failure"
        ? "F"
        : draft.setType === "drop"
          ? "D"
          : String(set.order);
  const typeTone =
    draft.setType === "warmup"
      ? "border-warn/40 bg-warn/10 text-warn"
      : draft.setType === "failure"
        ? "border-danger/40 bg-danger/10 text-danger"
        : draft.setType === "drop"
          ? "border-chart-2/40 bg-chart-2/10 text-chart-2"
          : "border-border bg-elevated text-foreground";
  const context =
    exercise.executionMode === "bilateral"
      ? `${draft.bilateralWeight != null ? `${draft.bilateralWeight} kg` : exercise.isBodyweight ? "BW" : "—"} · ${draft.bilateralReps ?? "—"} reps`
      : `${draft.leftReps ?? "—"}/${draft.rightReps ?? "—"} reps`;
  return (
    <>
      <div
        ref={rowRef}
        className="relative mt-1 overflow-hidden rounded-xl"
        data-set-swipe={set.id}
      >
        {canRemove && dragOffset > 0 ? (
          <button
            type="button"
            aria-label={`${removing ? "Removing" : "Remove"} ${exercise.name} set ${set.order}`}
            disabled={removing}
            onClick={onRemove}
            tabIndex={swipeOpen ? 0 : -1}
            className="absolute inset-y-0 left-0 z-0 grid w-16 place-items-center bg-danger text-white disabled:opacity-60"
          >
            <Trash2 className="h-5 w-5" aria-hidden="true" />
          </button>
        ) : null}
        <div
          onPointerDown={beginSwipe}
          onPointerMove={moveSwipe}
          onPointerUp={endSwipe}
          onPointerCancel={endSwipe}
          style={{ transform: `translateX(${dragOffset}px)`, touchAction: "pan-y" }}
          className={cn(
            "grid grid-cols-[2.5rem_minmax(3.75rem,1fr)_3.25rem_3.25rem_2.75rem_2.75rem] items-center gap-1 rounded-xl px-1 py-1 transition-transform duration-150 ease-out motion-reduce:transition-none",
            "relative z-10 bg-card",
            done && "ring-1 ring-inset ring-good/20",
          )}
        >
          <button
            type="button"
            onClick={() => setTypeOpen(true)}
            aria-label={`Set ${set.order}, ${draft.setType} set. Change set type`}
            className={cn(
              "grid h-11 min-w-10 place-items-center rounded-lg border text-xs font-bold",
              typeTone,
            )}
          >
            {typeBadge}
          </button>
          <span className="line-clamp-2 px-1 text-center text-[10px] leading-tight text-muted-foreground">
            {previous}
          </span>
          {exercise.executionMode === "bilateral" ? (
            <>
              {field(
                exercise.isBodyweight ? "added kg" : "kg",
                exercise.isBodyweight ? (draft.bilateralWeight ?? 0) : draft.bilateralWeight,
                "bilateralWeight",
              )}
              {field("reps", draft.bilateralReps, "bilateralReps", true)}
            </>
          ) : (
            <>
              <div className="space-y-1">
                {field("left kg", draft.leftWeight, "leftWeight")}
                {field("right kg", draft.rightWeight, "rightWeight")}
              </div>
              <div className="space-y-1">
                {field("left reps", draft.leftReps, "leftReps", true)}
                {field("right reps", draft.rightReps, "rightReps", true)}
              </div>
            </>
          )}
          <button
            type="button"
            className="grid h-11 min-w-11 place-items-center rounded-lg border border-input bg-background text-xs font-semibold"
            aria-label={`${exercise.name}, set ${set.order}, RPE ${draft.rpe ?? "not set"}`}
            onClick={() => {
              setRpeDraft(draft.rpe);
              setRpeOpen(true);
            }}
          >
            {draft.rpe ?? "—"}
          </button>
          <button
            type="button"
            disabled={!done || saving}
            onClick={onDone}
            aria-label={`${done ? "Save" : "Complete"} ${exercise.name} set ${set.order}`}
            className={cn(
              "grid h-11 min-w-11 place-items-center rounded-lg border",
              done ? "border-good/40 bg-good/10 text-good" : "border-border text-muted-foreground",
            )}
          >
            {saving ? (
              <span className="h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent motion-reduce:animate-none" />
            ) : (
              <Check className="h-4 w-4" aria-hidden="true" />
            )}
          </button>
        </div>
        {canRemove && !swipeOpen ? (
          <button
            type="button"
            className="sr-only"
            onClick={onSwipeOpen}
            aria-label={`Reveal delete action for ${exercise.name} set ${set.order}`}
          >
            Reveal delete action
          </button>
        ) : null}
      </div>
      <div
        className="flex min-h-5 items-center justify-end gap-2 px-1 text-[10px] text-muted-foreground"
        aria-live="polite"
      >
        {saving ? "Saving..." : error ? "Save failed" : done ? "Saved" : ""}
        {error ? (
          <button type="button" className="font-semibold text-danger underline" onClick={onRetry}>
            Retry
          </button>
        ) : null}
      </div>

      <Drawer open={typeOpen} onOpenChange={setTypeOpen}>
        <DrawerContent className="mx-auto max-w-lg pb-[env(safe-area-inset-bottom)]">
          <DrawerHeader>
            <DrawerTitle>Set {set.order} type</DrawerTitle>
            <DrawerDescription>Choose how this set should be recorded.</DrawerDescription>
          </DrawerHeader>
          <div className="space-y-1 px-4">
            {SET_TYPES.map((option) => (
              <DrawerClose asChild key={option.value}>
                <button
                  type="button"
                  className={cn(
                    "flex min-h-12 w-full items-center justify-between rounded-xl px-4 text-left text-sm font-medium",
                    draft.setType === option.value ? "bg-primary/10 text-primary" : "bg-elevated",
                  )}
                  onClick={() => onChange({ setType: option.value })}
                >
                  {option.label}
                  {draft.setType === option.value ? (
                    <Check className="h-4 w-4" aria-hidden="true" />
                  ) : null}
                </button>
              </DrawerClose>
            ))}
          </div>
          <DrawerFooter>
            <DrawerClose asChild>
              <Button variant="outline" className="min-h-11">
                Cancel
              </Button>
            </DrawerClose>
          </DrawerFooter>
        </DrawerContent>
      </Drawer>

      <Drawer open={rpeOpen} onOpenChange={setRpeOpen}>
        <DrawerContent className="mx-auto max-w-lg pb-[env(safe-area-inset-bottom)]">
          <DrawerHeader>
            <DrawerTitle>Set {set.order} RPE</DrawerTitle>
            <DrawerDescription>
              {exercise.name} · {context}
            </DrawerDescription>
          </DrawerHeader>
          <div className="px-4 text-center">
            <p className="num text-5xl font-semibold text-primary">{rpeDraft ?? "—"}</p>
            <p className="mt-2 min-h-5 text-sm text-muted-foreground">{rpeDescription(rpeDraft)}</p>
            <div className="mt-4 grid grid-cols-4 gap-2">
              {RPE_VALUES.map((value) => (
                <button
                  key={value}
                  type="button"
                  aria-pressed={rpeDraft === value}
                  onClick={() => setRpeDraft(value)}
                  className={cn(
                    "min-h-11 rounded-xl border text-sm font-semibold",
                    rpeDraft === value
                      ? "border-primary bg-primary/10 text-primary"
                      : "border-border bg-elevated",
                  )}
                >
                  {value}
                </button>
              ))}
            </div>
          </div>
          <DrawerFooter>
            <DrawerClose asChild>
              <Button className="min-h-11" onClick={() => onChange({ rpe: rpeDraft })}>
                Done
              </Button>
            </DrawerClose>
            <DrawerClose asChild>
              <Button variant="ghost" className="min-h-11" onClick={() => onChange({ rpe: null })}>
                Clear RPE
              </Button>
            </DrawerClose>
          </DrawerFooter>
        </DrawerContent>
      </Drawer>
    </>
  );
}

const SET_TYPES: Array<{ value: BulkSetType; label: string }> = [
  { value: "warmup", label: "Warm Up Set" },
  { value: "normal", label: "Normal Set" },
  { value: "failure", label: "Failure Set" },
  { value: "drop", label: "Drop Set" },
];

const RPE_VALUES = [6, 7, 7.5, 8, 8.5, 9, 9.5, 10] as const;
const rpeDescription = (value: number | null) =>
  value == null
    ? "Choose how hard the set felt."
    : value >= 10
      ? "Maximum effort · no reps left"
      : value >= 9
        ? "Very hard · about 1 rep left"
        : value >= 8
          ? "Hard · about 2 reps left"
          : value >= 7
            ? "Moderate · about 3 reps left"
            : "Controlled · about 4 reps left";

export function CompletedWorkout({
  session,
  showBackLink = true,
}: {
  session: BulkTrainingSession;
  showBackLink?: boolean;
}) {
  return (
    <div className="space-y-3">
      <Card>
        <p className="text-xs font-semibold uppercase tracking-wider text-good">
          Completed workout
        </p>
        <h2 className="mt-1 text-xl font-semibold">{session.workoutDayName}</h2>
        <p className="text-xs text-muted-foreground">{session.planName}</p>
      </Card>
      {session.exercises.map((exercise) => (
        <Card key={exercise.id}>
          <h3 className="font-semibold">{exercise.name}</h3>
          <p className="text-xs text-muted-foreground">
            {exercise.executionMode}
            {exercise.isBodyweight ? " · bodyweight" : ""}
          </p>
          <ol className="mt-3 space-y-2">
            {exercise.sets.map((set) => (
              <li
                key={set.id}
                className="flex items-center justify-between rounded-xl bg-elevated p-3 text-sm"
              >
                <span>
                  Set {set.order}
                  {set.setType !== "normal" ? ` · ${set.setType}` : set.isExtra ? " · extra" : ""}
                </span>
                <span className="text-right font-medium tabular-nums">
                  {sessionSetLabel(set, exercise)}
                  {set.rpe != null ? (
                    <span className="block text-xs text-muted-foreground">RPE {set.rpe}</span>
                  ) : null}
                </span>
              </li>
            ))}
          </ol>
          {exercise.notes ? (
            <p className="mt-2 text-xs text-muted-foreground">{exercise.notes}</p>
          ) : null}
        </Card>
      ))}
      {showBackLink ? (
        <Button asChild variant="outline" className="min-h-11 w-full">
          <Link to="/bulk/training">Back to Training</Link>
        </Button>
      ) : null}
    </div>
  );
}
