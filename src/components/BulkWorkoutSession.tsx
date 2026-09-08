import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import { Check, Copy, Plus, Trash2 } from "lucide-react";
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
import { isSessionSetComplete, sessionSetLabel } from "@/lib/bulk-training-session-domain";
import type { BulkProgressionResult } from "@/lib/bulk-progression";
import { buildBulkNextSessionGuidance } from "@/lib/bulk-next-session-guidance";

type SetDraft = EditableSessionSet;

const toDraft = (set: BulkTrainingSet): SetDraft => ({
  id: set.id,
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
  ].some((value) => value != null);

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
  draftsRef.current = drafts;
  saveErrorsRef.current = saveErrors;

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
    try {
      await flushAll();
      await addBulkTrainingSet(session.id, exerciseId);
      await refresh();
    } catch (error) {
      toast.error(userFacingError(error, "add another set", { inputPreserved: true }));
    }
  }

  async function removeSet(setId: string) {
    try {
      await removeBulkTrainingSet(session.id, setId);
      await refresh();
    } catch (error) {
      toast.error(userFacingError(error, "remove this set", { inputPreserved: true }));
    }
  }

  async function finish(confirmIncomplete: boolean) {
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

  if (session.status === "completed") return <CompletedWorkout session={session} />;

  return (
    <div className="space-y-3 pb-24">
      <Card className="sticky top-2 z-10 border-primary/30 bg-card/95 backdrop-blur">
        <p className="text-xs font-semibold uppercase tracking-wider text-primary">
          Workout in progress
        </p>
        <h1 className="mt-1 text-xl font-semibold">{session.workoutDayName}</h1>
        <p className="text-xs text-muted-foreground">{session.planName}</p>
        <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-secondary">
          <div
            className="h-full bg-primary"
            style={{ width: `${totalSets ? (completedSets / totalSets) * 100 : 0}%` }}
          />
        </div>
        <p className="mt-1 text-right text-[11px] text-muted-foreground">
          {completedSets} of {totalSets} sets complete
        </p>
      </Card>

      {session.exercises.map((exercise) => (
        <Card key={exercise.id}>
          <div className="flex items-start justify-between gap-3">
            <div>
              <h2 className="font-semibold">{exercise.name}</h2>
              <p className="mt-0.5 text-xs text-muted-foreground">
                {exercise.targetSets} sets · {exercise.targetRepMin}–{exercise.targetRepMax} reps ·{" "}
                {exercise.executionMode}
                {exercise.isBodyweight ? " · bodyweight" : ""}
              </p>
            </div>
          </div>
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
                className="mt-2 rounded-lg bg-primary/10 p-2 text-xs leading-relaxed"
                aria-label={`Next-session guidance for ${exercise.name}`}
              >
                {guidance.previousPerformanceText ? (
                  <p className="text-muted-foreground">
                    <span className="font-medium text-foreground">Last time:</span>{" "}
                    {guidance.previousPerformanceText}
                  </p>
                ) : null}
                <p
                  className={
                    guidance.previousPerformanceText ? "mt-1 text-primary" : "text-primary"
                  }
                >
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
          <div className="mt-3 space-y-2">
            {exercise.sets.map((set) => (
              <WorkoutSetRow
                key={set.id}
                exercise={exercise}
                set={set}
                draft={drafts[set.id] ?? toDraft(set)}
                saving={saving.has(set.id)}
                {...(saveErrors[set.id] ? { error: saveErrors[set.id] } : {})}
                onChange={(patch) => update(set.id, patch)}
                onRetry={() => void persist(set.id)}
                {...(set.isExtra ? { onRemove: () => void removeSet(set.id) } : {})}
              />
            ))}
          </div>
          <Button
            variant="outline"
            className="mt-3 min-h-11 w-full"
            onClick={() => void addSet(exercise.id)}
          >
            <Plus aria-hidden="true" /> Add Extra Set
          </Button>
        </Card>
      ))}

      <div className="fixed inset-x-0 bottom-[calc(4.75rem+env(safe-area-inset-bottom))] z-20 mx-auto flex max-w-lg gap-2 border-t border-border bg-background/95 px-4 py-3 backdrop-blur">
        <Button
          variant="outline"
          className="min-h-11"
          onClick={() => setDiscardDialog(true)}
          disabled={finishing || discarding}
        >
          Discard
        </Button>
        <Button
          className="min-h-11 flex-1"
          onClick={() => (incomplete ? setFinishDialog(true) : void finish(false))}
          disabled={finishing || discarding}
        >
          {finishing ? <PendingLabel>Finishing workout</PendingLabel> : "Finish Workout"}
        </Button>
      </div>

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
  error,
  onChange,
  onRetry,
  onRemove,
}: {
  exercise: BulkTrainingSessionExercise;
  set: BulkTrainingSet;
  draft: SetDraft;
  saving: boolean;
  error?: string;
  onChange: (patch: Partial<SetDraft>) => void;
  onRetry: () => void;
  onRemove?: () => void;
}) {
  const done = isSessionSetComplete(draft, exercise);
  const inputClass =
    "min-h-11 min-w-0 w-full rounded-xl border border-input bg-background px-2 text-center text-base outline-none focus:border-ring";
  const field = (label: string, value: number | null, key: keyof SetDraft, integer = false) => (
    <label className="min-w-0 text-center text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
      {label}
      <DecimalInput
        value={value ?? undefined}
        min={integer ? 1 : 0}
        max={integer ? 1000 : 1000}
        integer={integer}
        label={`${exercise.name}, set ${set.order}, ${label}`}
        className={cn("mt-1", inputClass)}
        onChange={(next) => onChange({ [key]: next ?? null })}
      />
    </label>
  );
  return (
    <div
      className={cn(
        "rounded-xl border p-2.5",
        done ? "border-good/40 bg-good/5" : "border-border bg-elevated/50",
      )}
    >
      <div className="mb-2 flex items-center justify-between">
        <span className="flex items-center gap-1.5 text-xs font-semibold">
          {done ? <Check className="h-4 w-4 text-good" /> : null}Set {set.order}
          {set.isExtra ? " · extra" : ""}
        </span>
        <span className="text-[10px] text-muted-foreground" aria-live="polite">
          {saving ? "Saving..." : error ? "Save failed" : done ? "Saved" : ""}
        </span>
        {onRemove ? (
          <button
            type="button"
            aria-label={`Remove extra set ${set.order}`}
            onClick={onRemove}
            className="grid min-h-11 min-w-11 place-items-center rounded-lg text-danger"
          >
            <Trash2 className="h-4 w-4" />
          </button>
        ) : null}
      </div>
      {exercise.executionMode === "bilateral" ? (
        <div className="grid grid-cols-2 gap-2">
          {field(
            exercise.isBodyweight ? "Added kg" : "Weight kg",
            draft.bilateralWeight,
            "bilateralWeight",
          )}
          {field("Reps", draft.bilateralReps, "bilateralReps", true)}
        </div>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-2">
            <p className="text-center text-xs font-semibold">Left</p>
            <p className="text-center text-xs font-semibold">Right</p>
          </div>
          <div className="mt-1 grid grid-cols-2 gap-2">
            {field(
              exercise.isBodyweight ? "Added kg" : "Weight kg",
              draft.leftWeight,
              "leftWeight",
            )}
            {field(
              exercise.isBodyweight ? "Added kg" : "Weight kg",
              draft.rightWeight,
              "rightWeight",
            )}
          </div>
          <button
            type="button"
            className="mt-2 flex min-h-11 w-full items-center justify-center gap-2 rounded-xl text-xs font-semibold text-primary"
            onClick={() => onChange({ rightWeight: draft.leftWeight })}
            disabled={draft.leftWeight == null}
          >
            <Copy className="h-4 w-4" />
            Use left weight for both
          </button>
          <div className="mt-1 grid grid-cols-2 gap-2">
            {field("Left reps", draft.leftReps, "leftReps", true)}
            {field("Right reps", draft.rightReps, "rightReps", true)}
          </div>
        </>
      )}
      {error ? (
        <div role="alert" className="mt-2 rounded-lg bg-danger/10 p-2 text-xs text-danger">
          <p>{error}</p>
          <button type="button" className="mt-1 min-h-11 font-semibold underline" onClick={onRetry}>
            Retry save
          </button>
        </div>
      ) : null}
    </div>
  );
}

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
                  {set.isExtra ? " · extra" : ""}
                </span>
                <span className="font-medium tabular-nums">{sessionSetLabel(set, exercise)}</span>
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
