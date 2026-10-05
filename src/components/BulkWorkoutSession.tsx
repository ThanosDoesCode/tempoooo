import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from "react";
import { Link, useNavigate } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import {
  ChevronDown,
  ArrowLeft,
  Check,
  ChevronLeft,
  ChevronRight,
  Plus,
  TrendingUp,
  Trash2,
} from "lucide-react";
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
  completedSessionVolume,
  completedWorkingSets,
  isSessionSetComplete,
  sessionElapsedSeconds,
  sessionSetLabel,
  sessionSetVolume,
  type BulkSetType,
} from "@/lib/bulk-training-session-domain";
import {
  previousPerformanceForActiveSet,
  type BulkProgressionPreviousSet,
  type BulkProgressionResult,
} from "@/lib/bulk-progression";
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

function previousForActiveSet(
  result: BulkProgressionResult | undefined,
  exercise: BulkTrainingSessionExercise,
  drafts: Record<string, SetDraft>,
  setIndex: number,
) {
  const currentTypes = exercise.sets.map(
    (candidate) => (drafts[candidate.id] ?? toDraft(candidate)).setType,
  );
  return previousPerformanceForActiveSet(result, currentTypes, setIndex);
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
  const [activeExerciseIndex, setActiveExerciseIndex] = useState(0);
  const confirmingSets = useRef(new Set<string>());
  const [restDeadline, setRestDeadline] = useState<number | null>(null);
  const terminalPending = useRef(false);
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
    if (terminalPending.current) return;
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
    if (terminalPending.current || addPending.current.has(exerciseId)) return;
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
    if (terminalPending.current || removePending.current.has(setId)) return;
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
    if (terminalPending.current || addPending.current.size || removePending.current.size) return;
    terminalPending.current = true;
    setOpenSetId(null);
    setFinishing(true);
    try {
      await flushAll();
      await finishBulkTrainingSession(session.id, confirmIncomplete);
      clearLocalDrafts(session);
      await refresh();
      toast.success("Workout completed");
      setRestDeadline(null);
    } catch (error) {
      toast.error(userFacingError(error, "finish your workout", { inputPreserved: true }));
    } finally {
      terminalPending.current = false;
      setFinishing(false);
      setFinishDialog(false);
    }
  }

  async function discard() {
    if (terminalPending.current || addPending.current.size || removePending.current.size) return;
    terminalPending.current = true;
    setOpenSetId(null);
    setDiscarding(true);
    try {
      timers.current.forEach(clearTimeout);
      timers.current.clear();
      await Promise.all([...pending.current.values()]);
      await discardBulkTrainingSession(session.id);
      dirty.current.clear();
      clearLocalDrafts(session);
      await refresh();
      toast.success("Workout draft discarded");
      await navigate({ to: "/bulk/training" });
    } catch (error) {
      toast.error(userFacingError(error, "discard your workout", { inputPreserved: true }));
    } finally {
      terminalPending.current = false;
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

  const activeIndex = Math.min(activeExerciseIndex, Math.max(0, session.exercises.length - 1));
  const restSeconds =
    restDeadline == null ? 0 : Math.max(0, Math.ceil((restDeadline - clock) / 1000));
  async function confirmSet(exercise: BulkTrainingSessionExercise, set: BulkTrainingSet) {
    if (
      terminalPending.current ||
      confirmingSets.current.has(set.id) ||
      !isSessionSetComplete(draftsRef.current[set.id] ?? toDraft(set), exercise)
    )
      return;
    confirmingSets.current.add(set.id);
    try {
      await persist(set.id);
      if (saveErrorsRef.current[set.id] || dirty.current.has(set.id)) return;
      setRestDeadline(Date.now() + 120_000);
      setClock(Date.now());
      if (
        exercise.sets.every((item) =>
          isSessionSetComplete(draftsRef.current[item.id] ?? toDraft(item), exercise),
        )
      ) {
        setActiveExerciseIndex((index) => Math.min(session.exercises.length - 1, index + 1));
      }
    } finally {
      confirmingSets.current.delete(set.id);
    }
  }
  return (
    <div className="space-y-[14px] pb-[calc(160px+env(safe-area-inset-bottom))]">
      <header className="sticky top-0 z-20 -mx-5 border-b border-border bg-background/95 px-5 pb-3 pt-2 backdrop-blur">
        <div className="flex min-h-11 items-center gap-2">
          <button
            type="button"
            aria-label="Minimise workout, keep progress"
            className="grid min-h-11 min-w-11 shrink-0 place-items-center text-muted-foreground"
            onClick={() => void navigate({ to: "/bulk/training" })}
          >
            <ChevronDown className="h-5 w-5" aria-hidden="true" />
            <span className="sr-only">Minimise</span>
          </button>
          <div className="min-w-0 flex-1 text-center">
            <h1 className="truncate text-base font-semibold">{session.workoutDayName}</h1>
            <p className="num text-[13px] text-muted-foreground">
              {formatDuration(elapsedSeconds)} · {completedSets} of {totalSets} sets
            </p>
          </div>
          <Button
            variant="ghost"
            className="min-h-11 shrink-0 px-2 text-primary"
            onClick={() => setFinishDialog(true)}
            disabled={finishing || discarding || adding.size > 0 || removing.size > 0}
          >
            {finishing ? <PendingLabel>Finishing…</PendingLabel> : "Finish"}
          </Button>
        </div>
        <div
          className="mt-3 flex flex-wrap gap-1"
          aria-label={`${completedSets} of ${totalSets} sets entered`}
        >
          {session.exercises.map((exercise, index) => (
            <button
              key={exercise.id}
              type="button"
              aria-label={`Exercise ${index + 1}: ${exercise.name}`}
              aria-current={index === activeIndex ? "step" : undefined}
              onClick={() => setActiveExerciseIndex(index)}
              className="flex min-h-11 min-w-11 flex-1 items-center"
            >
              <span
                className={cn(
                  "h-1 w-full rounded-full",
                  exercise.sets.every((set) =>
                    isSessionSetComplete(drafts[set.id] ?? toDraft(set), exercise),
                  )
                    ? "bg-primary"
                    : index === activeIndex
                      ? "bg-primary/50"
                      : "bg-border",
                )}
              />
            </button>
          ))}
        </div>
      </header>
      <fieldset disabled={finishing || discarding} className="min-w-0">
        {session.exercises.map((exercise, exerciseIndex) => (
          <section
            key={exercise.id}
            hidden={exerciseIndex !== activeIndex}
            aria-label={exercise.name}
          >
            <p className="text-sm text-muted-foreground">
              Exercise {exerciseIndex + 1} of {session.exercises.length}
            </p>
            <h2 className="mt-1 text-[28px] font-semibold leading-tight tracking-tight break-words">
              {exercise.name}
            </h2>
            <p className="mt-2 text-sm text-muted-foreground">
              {exercise.targetSets} × {exercise.targetRepMin}–{exercise.targetRepMax} reps
              {exercise.executionMode === "unilateral" ? " · Left / right" : ""}
            </p>
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
                <p
                  className="mt-3 flex items-center gap-2 rounded-2xl bg-primary/10 px-3 py-3 text-sm font-medium"
                  aria-label="Next-session guidance"
                  title={guidance.reasonText}
                >
                  <TrendingUp className="h-4 w-4 shrink-0 text-primary" aria-hidden="true" />
                  <span>{guidance.targetText}</span>
                  <span className="sr-only">{guidance.reasonText}</span>
                </p>
              );
            })()}
            {exercise.notes ? (
              <p className="mt-2 rounded-[14px] bg-card p-3 text-sm text-muted-foreground">
                {exercise.notes}
              </p>
            ) : null}
            {exercise.isBodyweight ? (
              <p className="mt-2 text-sm text-muted-foreground">
                {session.bodyweightKg == null
                  ? "BW unavailable · Extra weight is still saved · Total unavailable"
                  : `BW ${session.bodyweightKg.toFixed(1)} kg · Log extra weight per set`}
              </p>
            ) : null}
            <div className="mt-[14px] space-y-2">
              <div className="workout-set-grid text-center text-[10px] font-semibold uppercase tracking-wide text-muted-foreground sm:text-xs">
                <span>Set</span>
                <span className="text-left normal-case tracking-normal min-[375px]:uppercase">
                  Previous
                </span>
                <span>{exercise.isBodyweight ? "+kg" : "kg"}</span>
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
                    previousForActiveSet(
                      progression[exercise.sourcePlanExerciseId ?? `session:${exercise.id}`],
                      exercise,
                      drafts,
                      index,
                    ),
                    exercise,
                  )}
                  {...(saveErrors[set.id] ? { error: saveErrors[set.id] } : {})}
                  onChange={(patch) => update(set.id, patch)}
                  onRetry={() => void persist(set.id)}
                  onDone={() => void confirmSet(exercise, set)}
                  onRemove={() => void removeSet(set.id)}
                  onSwipeBegin={() => setOpenSetId(null)}
                  onSwipeOpen={() => setOpenSetId(set.id)}
                  onSwipeClose={() =>
                    setOpenSetId((current) => (current === set.id ? null : current))
                  }
                />
              ))}
            </div>
            <Button
              variant="ghost"
              className="mt-3 min-h-11 px-1 text-primary"
              onClick={() => void addSet(exercise.id)}
              disabled={adding.has(exercise.id)}
            >
              <Plus aria-hidden="true" />
              {adding.has(exercise.id) ? "Adding…" : "Add set"}
            </Button>
            <p className="text-xs text-muted-foreground">
              Tap a set badge to choose: <span className="text-warn">W</span> warmup ·{" "}
              <span className="text-danger">F</span> failure ·{" "}
              <span className="text-chart-2">D</span> dropset
            </p>
          </section>
        ))}
      </fieldset>
      <div
        className="fixed inset-x-0 bottom-0 z-30 my-0! border-t border-border bg-background/95 px-5 pt-3 pb-[calc(12px+env(safe-area-inset-bottom))] backdrop-blur"
        aria-label="Workout controls"
      >
        <div className="mx-auto max-w-2xl">
          {restSeconds > 0 ? (
            <>
              <div
                className="flex min-h-11 items-center gap-3"
                role="timer"
                aria-label="Rest timer"
              >
                <p className="flex-1 text-sm text-muted-foreground">Rest</p>
                <p className="num text-[22px] font-semibold">{formatDuration(restSeconds)}</p>
                <button
                  type="button"
                  className="min-h-11 rounded-xl bg-elevated px-3 text-sm font-semibold active:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  aria-label="Add 15 seconds to rest"
                  onClick={() => {
                    const now = Date.now();
                    setRestDeadline((deadline) => Math.max(deadline ?? now, now) + 15_000);
                    setClock(now);
                  }}
                >
                  +15s
                </button>
                <button
                  type="button"
                  className="min-h-11 px-2 text-sm font-medium text-primary"
                  onClick={() => setRestDeadline(null)}
                >
                  Skip
                </button>
              </div>
              <div className="mt-1 h-1 overflow-hidden rounded-full bg-elevated" aria-hidden="true">
                <div
                  className="h-full rounded-full bg-primary transition-[width] duration-150 motion-reduce:transition-none"
                  style={{ width: `${Math.min(100, (restSeconds / 120) * 100)}%` }}
                />
              </div>
            </>
          ) : (
            <button
              type="button"
              className="min-h-12 text-sm text-muted-foreground"
              onClick={() => {
                setRestDeadline(Date.now() + 120_000);
                setClock(Date.now());
              }}
            >
              Start 2:00 rest
            </button>
          )}
          <div className="mt-3 grid grid-cols-[minmax(44px,0.4fr)_minmax(0,1fr)] gap-2">
            <button
              type="button"
              disabled={activeIndex === 0}
              onClick={() => setActiveExerciseIndex(activeIndex - 1)}
              className="flex min-h-12 items-center justify-center gap-1 rounded-2xl border border-border bg-card text-sm font-medium text-foreground disabled:opacity-30"
            >
              <ChevronLeft className="control-chevron" aria-hidden="true" />
              Previous
            </button>
            <button
              type="button"
              disabled={activeIndex >= session.exercises.length - 1}
              onClick={() => setActiveExerciseIndex(activeIndex + 1)}
              className="flex min-h-12 items-center justify-center gap-1 rounded-2xl border border-primary/30 bg-primary text-sm font-semibold text-primary-foreground disabled:border-border disabled:bg-card disabled:text-muted-foreground disabled:opacity-50"
            >
              Next exercise
              <ChevronRight className="control-chevron" aria-hidden="true" />
            </button>
          </div>
        </div>
      </div>
      <div className="rounded-2xl bg-card p-4">
        <div className="flex items-baseline justify-between text-xs text-muted-foreground">
          <span>
            <span className="num text-sm font-semibold text-foreground">
              {completedSets}/{totalSets}
            </span>{" "}
            sets
          </span>
          <span className="num">
            {volumeUnavailable
              ? "Volume unavailable"
              : `${Math.round(totalVolume).toLocaleString()} kg volume`}
          </span>
        </div>
        <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-elevated">
          <div
            className="h-full rounded-full bg-primary transition-all"
            style={{ width: `${totalSets ? (completedSets / totalSets) * 100 : 0}%` }}
          />
        </div>
      </div>
      <AlertDialog open={finishDialog} onOpenChange={setFinishDialog}>
        <AlertDialogContent className="w-[calc(100%-2rem)] max-w-sm gap-3 rounded-[20px] p-4 sm:rounded-[20px]">
          <AlertDialogHeader className="space-y-1 sm:text-center">
            <AlertDialogTitle className="text-base leading-6">
              {incomplete ? "Finish with incomplete sets?" : "Finish this workout?"}
            </AlertDialogTitle>
            <AlertDialogDescription className="text-[13px] leading-5">
              {incomplete
                ? `You still have ${incomplete} incomplete ${incomplete === 1 ? "set" : "sets"}. Their missing values will remain empty in history.`
                : "Your logged sets will be saved to workout history."}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div className="space-y-1">
            <AlertDialogFooter className="grid grid-cols-2 gap-2 sm:space-x-0">
              <AlertDialogCancel className="mt-0 h-12 w-full rounded-xl px-2 text-sm">
                Keep logging
              </AlertDialogCancel>
              <AlertDialogAction
                className="h-12 w-full rounded-xl px-2 text-sm"
                onClick={() => void finish(incomplete > 0)}
              >
                {incomplete ? "Finish anyway" : "Finish workout"}
              </AlertDialogAction>
            </AlertDialogFooter>
            <button
              type="button"
              className="min-h-11 w-full rounded-lg text-xs font-medium text-danger/80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50"
              onClick={() => {
                setFinishDialog(false);
                setDiscardDialog(true);
              }}
              disabled={finishing || discarding}
            >
              Discard workout
            </button>
          </div>
        </AlertDialogContent>
      </AlertDialog>
      <AlertDialog open={discardDialog} onOpenChange={setDiscardDialog}>
        <AlertDialogContent className="w-[calc(100%-2rem)] max-w-sm rounded-[20px] sm:rounded-[20px]">
          <AlertDialogHeader>
            <AlertDialogTitle>Discard this workout?</AlertDialogTitle>
            <AlertDialogDescription>
              {meaningful
                ? "All logged values in this unfinished workout will be permanently discarded."
                : "This empty workout draft will be removed."}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter className="flex-col gap-2 sm:flex-row sm:gap-2 sm:space-x-0">
            <AlertDialogCancel className="mt-0 min-h-[52px] w-full rounded-[16px] sm:w-auto">
              Keep workout
            </AlertDialogCancel>
            <AlertDialogAction
              className="min-h-[52px] w-full rounded-[16px] bg-danger text-white hover:bg-danger/90 sm:w-auto"
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
  const typeTriggerRef = useRef<HTMLButtonElement>(null);
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
      className={cn(
        "h-12 min-w-0 w-full rounded-[14px] border px-1 text-center text-base outline-none focus:border-ring",
        done ? "border-primary/20 bg-primary/10" : "border-transparent bg-elevated",
      )}
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
  const typeTone = SET_TYPE_TONES[draft.setType];
  const context =
    exercise.executionMode === "bilateral"
      ? `${draft.bilateralWeight != null ? `${draft.bilateralWeight} kg` : exercise.isBodyweight ? "BW" : "—"} · ${draft.bilateralReps ?? "—"} reps`
      : `${draft.leftReps ?? "—"}/${draft.rightReps ?? "—"} reps`;
  return (
    <div className="space-y-1">
      <div ref={rowRef} className="relative overflow-hidden rounded-[14px]" data-set-swipe={set.id}>
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
            "workout-set-grid relative z-10 rounded-[14px] py-1 transition-transform duration-150 ease-out motion-reduce:transition-none",
            done ? "bg-primary/5" : "bg-background",
          )}
        >
          <button
            ref={typeTriggerRef}
            type="button"
            onClick={() => setTypeOpen(true)}
            aria-label={`Set ${set.order}, ${draft.setType} set. Change set type`}
            aria-haspopup="dialog"
            aria-expanded={typeOpen}
            className={cn(
              "grid h-12 min-w-10 place-items-center rounded-[14px] border text-xs font-medium transition-colors hover:brightness-110 active:brightness-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-card motion-reduce:transition-none",
              typeTone,
            )}
          >
            {typeBadge}
          </button>
          <span className="min-w-0 break-words text-xs tabular-nums text-muted-foreground">
            <span className="sr-only">Previous: </span>
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
            className={cn(
              "grid h-12 min-w-11 place-items-center rounded-[14px] border border-input text-base font-semibold transition-colors hover:border-ring/60 active:brightness-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring motion-reduce:transition-none",
              done ? "bg-primary/10" : "bg-elevated",
              draft.rpe == null && "text-xs text-muted-foreground",
            )}
            aria-label={`${exercise.name}, set ${set.order}, RPE ${draft.rpe ?? "not set"}`}
            aria-haspopup="dialog"
            aria-expanded={rpeOpen}
            onClick={() => {
              setRpeDraft(draft.rpe);
              setRpeOpen(true);
            }}
          >
            {draft.rpe ?? "RPE"}
          </button>
          <button
            type="button"
            disabled={!done || saving}
            onClick={onDone}
            aria-label={`${done ? "Save" : "Complete"} ${exercise.name} set ${set.order}`}
            className={cn(
              "grid h-12 min-w-11 place-items-center rounded-[14px] border",
              done
                ? "border-primary bg-primary text-primary-foreground"
                : "border-transparent bg-elevated text-muted-foreground",
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
            className="sr-only focus:not-sr-only focus:min-h-11"
            onClick={onSwipeOpen}
            aria-label={`Reveal delete action for ${exercise.name} set ${set.order}`}
          >
            Reveal delete action
          </button>
        ) : null}
      </div>
      <div
        className={cn(
          "text-[10px] text-muted-foreground",
          error ? "flex items-center justify-end gap-2" : "sr-only",
        )}
        aria-live="polite"
      >
        {saving ? "Saving..." : error ? "Save failed" : done ? "Saved" : ""}
        {error ? (
          <button
            type="button"
            className="min-h-11 px-2 font-semibold text-danger underline"
            onClick={onRetry}
          >
            Retry
          </button>
        ) : null}
      </div>

      <Drawer open={typeOpen} onOpenChange={setTypeOpen} autoFocus>
        <DrawerContent
          className="mx-auto max-w-lg pb-[env(safe-area-inset-bottom)]"
          onCloseAutoFocus={(event) => {
            event.preventDefault();
            typeTriggerRef.current?.focus();
          }}
        >
          <DrawerHeader>
            <DrawerTitle>Set {set.order} type</DrawerTitle>
            <DrawerDescription>Choose how this set should be recorded.</DrawerDescription>
          </DrawerHeader>
          <div className="space-y-1 px-4">
            {SET_TYPES.map((option) => (
              <button
                key={option.value}
                type="button"
                className={cn(
                  "flex min-h-12 w-full items-center justify-between rounded-xl border px-4 text-left text-sm font-medium transition-colors hover:brightness-110 active:brightness-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring motion-reduce:transition-none",
                  SET_TYPE_TONES[option.value],
                  draft.setType === option.value && "ring-1 ring-inset ring-current",
                )}
                aria-pressed={draft.setType === option.value}
                onClick={() => {
                  onChange({ setType: option.value });
                  setTypeOpen(false);
                }}
              >
                {option.label}
                {draft.setType === option.value ? (
                  <Check className="h-4 w-4" aria-hidden="true" />
                ) : null}
              </button>
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
    </div>
  );
}

const SET_TYPES: Array<{ value: BulkSetType; label: string }> = [
  { value: "normal", label: "Normal" },
  { value: "warmup", label: "Warmup" },
  { value: "failure", label: "Failure" },
  { value: "drop", label: "Dropset" },
];

const SET_TYPE_TONES: Record<BulkSetType, string> = {
  warmup: "border-warn/30 bg-warn/10 text-warn",
  normal: "border-border bg-elevated text-foreground",
  failure: "border-danger/30 bg-danger/10 text-danger",
  drop: "border-chart-2/30 bg-chart-2/10 text-chart-2",
};

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
        <p className="text-sm font-medium text-good">Completed workout</p>
        <h2 className="mt-1 text-xl font-semibold">{session.workoutDayName}</h2>
        <p className="text-sm text-muted-foreground">
          {session.planName} · {session.workoutDate}
        </p>
        <dl className="mt-5 grid grid-cols-2 gap-4">
          <div>
            <dt className="text-xs text-muted-foreground">Duration</dt>
            <dd className="num mt-1 text-xl font-semibold">
              {formatDuration(
                sessionElapsedSeconds(session.startedAt, Date.now(), session.completedAt),
              )}
            </dd>
          </div>
          <div>
            <dt className="text-xs text-muted-foreground">Working sets</dt>
            <dd className="num mt-1 text-xl font-semibold">{completedWorkingSets(session)}</dd>
          </div>
          <div>
            <dt className="text-xs text-muted-foreground">Exercises logged</dt>
            <dd className="num mt-1 text-xl font-semibold">
              {
                session.exercises.filter((exercise) => exercise.sets.some((set) => set.isComplete))
                  .length
              }
            </dd>
          </div>
          <div>
            <dt className="text-xs text-muted-foreground">Volume</dt>
            <dd className="num mt-1 text-xl font-semibold">
              {completedSessionVolume(session) == null
                ? "Unavailable"
                : `${Math.round(completedSessionVolume(session)!).toLocaleString()} kg`}
            </dd>
          </div>
        </dl>
        {showBackLink ? (
          <Button asChild className="mt-5 h-[54px] w-full rounded-[16px]">
            <Link to="/bulk">Done</Link>
          </Button>
        ) : null}
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
