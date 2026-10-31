import { useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { DataError, PendingLabel } from "@/components/ui-kit";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { CreateWorkoutDialog } from "@/components/MyWorkouts";
import { WorkoutTemplateEditor } from "@/components/WorkoutTemplateEditor";
import { useAuth } from "@/lib/auth";
import { useBulkMeta } from "@/lib/store";
import { bulkPlanModeFor, useMemberships } from "@/lib/bulk-access";
import { userFacingError } from "@/lib/network-errors";
import type { TrainingPlanDay } from "@/lib/training-plans";
import {
  planDayCopyRequest,
  workoutToPlanDay,
  type WorkoutCopyRequest,
} from "@/lib/workout-plan-copy";
import {
  copyPlanDayToWorkout,
  fetchPrivateWorkout,
  useMyWorkouts,
  usePrivateWorkout,
  workoutDetailKey,
  workoutListKey,
  type PrivateWorkout,
} from "@/lib/workout-templates-query";

/** Same canonical fitness gate as My workouts. No new access path for core/legacy accounts. */
export function PlanDayWorkoutBridge(props: {
  day: TrainingPlanDay;
  onReplace: (day: TrainingPlanDay) => void;
  disabled?: boolean;
}) {
  const { user } = useAuth();
  const { bulkId } = useBulkMeta();
  const memberships = useMemberships();
  if (!user || !bulkId || bulkPlanModeFor(memberships.data, bulkId) !== "public") return null;
  return (
    <PlanDayWorkoutActions
      key={`${user.id}:${bulkId}:${props.day.id}`}
      {...props}
      userId={user.id}
      profileId={bulkId}
    />
  );
}

export function PlanDayWorkoutActions({
  day,
  onReplace,
  disabled = false,
  userId,
  profileId,
}: {
  day: TrainingPlanDay;
  onReplace: (day: TrainingPlanDay) => void;
  disabled?: boolean;
  userId: string;
  profileId: string;
}) {
  const cache = useQueryClient();
  const [view, setView] = useState<"choose" | "save" | "edit" | "created" | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [createdId, setCreatedId] = useState<string | null>(null);
  const [picked, setPicked] = useState<PrivateWorkout | null>(null);
  const [title, setTitle] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const pending = useRef(false);
  const request = useRef<WorkoutCopyRequest | null>(null);
  const library = useMyWorkouts(
    view === "choose" ? userId : null,
    view === "choose" ? profileId : null,
  );
  const created = usePrivateWorkout(userId, profileId, createdId);
  const message = (cause: unknown, action: string) => {
    const raw =
      cause && typeof cause === "object" && "message" in cause ? String(cause.message) : "";
    return /changed on another device|Plan-day name|Replace unavailable|Workout name|does not support|must be between|valid rep range/i.test(
      raw,
    )
      ? raw
      : userFacingError(cause, action, { inputPreserved: true });
  };
  function open(next: "choose" | "save") {
    setError(null);
    setPicked(null);
    setTitle(next === "save" ? (request.current?.title ?? day.name) : "");
    setView(next);
  }
  function insert(workout: PrivateWorkout, name = workout.title) {
    try {
      onReplace(workoutToPlanDay(workout, day, name));
      setView(null);
      setPicked(null);
      setError(null);
      toast.success("Workout added to plan");
    } catch (cause) {
      setError(message(cause, "add this workout to your plan"));
    }
  }
  async function choose(id: string) {
    if (pending.current) return;
    pending.current = true;
    setBusy(true);
    setError(null);
    try {
      // Fresh read at selection time, rather than an old library/detail cache snapshot.
      const workout = await fetchPrivateWorkout(userId, profileId, id);
      if (!workout) throw new Error("Workout unavailable");
      if (workout.title.length > 60) {
        setPicked(workout);
        setTitle(workout.title);
      } else insert(workout);
    } catch (cause) {
      setError(message(cause, "load this workout"));
    } finally {
      pending.current = false;
      setBusy(false);
    }
  }
  async function saveDay() {
    if (pending.current) return;
    try {
      request.current ??= planDayCopyRequest(day, title);
    } catch (cause) {
      setError(message(cause, "save this workout"));
      return;
    }
    pending.current = true;
    setBusy(true);
    setError(null);
    try {
      const saved = await copyPlanDayToWorkout(userId, profileId, request.current);
      cache.setQueryData(workoutDetailKey(userId, profileId, saved.id), saved);
      await cache.invalidateQueries({ queryKey: workoutListKey(userId, profileId) });
      request.current = null;
      setView(null);
      toast.success("Saved to My workouts");
    } catch (cause) {
      setError(message(cause, "copy this day to My workouts"));
    } finally {
      pending.current = false;
      setBusy(false);
    }
  }
  const candidate = view === "created" ? (picked ?? created.data) : picked;
  const editingForm = view === "edit" && !!created.data && !created.error && !created.isLoading;
  return (
    <>
      <div className="grid min-w-0 gap-2">
        <Button
          type="button"
          variant="outline"
          disabled={disabled}
          onClick={() => open("choose")}
          className="min-h-11 w-full min-w-0 whitespace-normal"
        >
          Choose from My workouts
        </Button>
        <div className="grid grid-cols-1 gap-2 min-[360px]:grid-cols-2">
          <Button
            type="button"
            variant="ghost"
            disabled={disabled}
            onClick={() => {
              setError(null);
              setCreateOpen(true);
            }}
            className="min-h-11 min-w-0 whitespace-normal"
          >
            Create new workout
          </Button>
          <Button
            type="button"
            variant="ghost"
            disabled={disabled}
            onClick={() => open("save")}
            className="min-h-11 min-w-0 whitespace-normal"
          >
            Save to My workouts
          </Button>
        </div>
      </div>
      <CreateWorkoutDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        onCreated={async (id) => {
          setPicked(null);
          setCreatedId(id);
          setView("edit");
          setError(null);
          // Creation is already successful. A subsequent read has its own retry UI, never another create.
          void cache.invalidateQueries({ queryKey: workoutListKey(userId, profileId) });
        }}
      />
      <Dialog
        open={view !== null}
        onOpenChange={(next) => {
          if (!next && !pending.current && !editingForm) setView(null);
        }}
      >
        <DialogContent
          className={`max-h-[calc(100dvh-2rem-env(safe-area-inset-top,0px)-env(safe-area-inset-bottom,0px))] w-[calc(100%-2rem)] overflow-y-auto rounded-2xl p-4 sm:p-5 [&>button:last-child]:right-2 [&>button:last-child]:top-2 [&>button:last-child]:h-11 [&>button:last-child]:w-11 ${editingForm ? "[&>button:last-child]:hidden" : ""}`}
          onEscapeKeyDown={(event) => {
            if (editingForm || pending.current) event.preventDefault();
          }}
          onInteractOutside={(event) => {
            if (editingForm || pending.current) event.preventDefault();
          }}
        >
          <DialogHeader className="pr-10 text-left">
            <DialogTitle>
              {view === "choose"
                ? "Choose workout"
                : view === "save"
                  ? "Save to My workouts"
                  : view === "edit"
                    ? "Create workout"
                    : "Workout saved"}
            </DialogTitle>
            <DialogDescription>
              {view === "save"
                ? "Creates an independent private workout. Your plan stays unchanged."
                : view === "edit"
                  ? "Saved in My workouts. Add it to this day after editing, if you like."
                  : "Adds a copy to this day. Save your plan to keep the change."}
            </DialogDescription>
          </DialogHeader>
          {view === "choose" && !picked ? (
            <div className="min-w-0 space-y-3">
              {day.exercises.length ? (
                <p className="text-sm text-muted-foreground">
                  Selecting a workout replaces this day’s exercises. Logged sessions stay unchanged.
                </p>
              ) : null}
              {library.isLoading ? (
                <p role="status" className="text-sm text-muted-foreground">
                  Loading workouts…
                </p>
              ) : library.error ? (
                <DataError
                  message="Could not load your workouts."
                  onRetry={() => void library.refetch()}
                />
              ) : library.data?.length ? (
                <ul className="min-w-0 divide-y divide-border">
                  {library.data.map((workout) => (
                    <li
                      key={workout.id}
                      className="flex min-w-0 items-center justify-between gap-3 py-3"
                    >
                      <div className="min-w-0">
                        <p className="break-words font-medium">{workout.title}</p>
                        <p className="text-sm text-muted-foreground">
                          {workout.exerciseCount} exercise{workout.exerciseCount === 1 ? "" : "s"}
                        </p>
                      </div>
                      <Button
                        type="button"
                        variant="outline"
                        disabled={busy}
                        aria-label={`Select ${workout.title}`}
                        onClick={() => void choose(workout.id)}
                        className="min-h-11 shrink-0"
                      >
                        Select
                      </Button>
                    </li>
                  ))}
                </ul>
              ) : (
                <div>
                  <p className="font-medium">No saved workouts yet</p>
                  <Button
                    type="button"
                    className="mt-3 min-h-11"
                    onClick={() => {
                      setView(null);
                      setCreateOpen(true);
                    }}
                  >
                    Create workout
                  </Button>
                </div>
              )}
              {busy ? <PendingLabel>Loading workout</PendingLabel> : null}
            </div>
          ) : null}
          {view === "save" || ((view === "choose" || view === "created") && candidate) ? (
            <div className="min-w-0 space-y-3">
              {candidate ? <p className="break-words font-medium">{candidate.title}</p> : null}
              <label className="block text-sm">
                {view === "save" ? "Workout name" : "Plan-day name"}
                <input
                  value={title}
                  maxLength={view === "save" ? 80 : 60}
                  disabled={busy || (view === "save" && !!request.current)}
                  onChange={(event) => setTitle(event.target.value)}
                  className="mt-2 min-h-11 w-full min-w-0 rounded-xl border border-input bg-elevated px-3 text-base"
                />
              </label>
              {view !== "save" && candidate && candidate.title.length > 60 ? (
                <p className="text-sm text-muted-foreground">
                  Use a shorter day name (up to 60 characters). The saved workout keeps its title.
                </p>
              ) : null}
              {view === "save" && request.current ? (
                <p className="text-sm text-muted-foreground">
                  Retry finishes the same private workout using the day captured when you first
                  tapped Save.
                </p>
              ) : null}
              <Button
                type="button"
                disabled={busy}
                className="min-h-11 w-full"
                onClick={() => {
                  if (view === "save") void saveDay();
                  else if (candidate) insert(candidate, title);
                }}
              >
                {busy ? (
                  <PendingLabel>Saving workout</PendingLabel>
                ) : view === "save" ? (
                  "Save workout"
                ) : (
                  "Add to plan"
                )}
              </Button>
            </div>
          ) : null}
          {view === "edit" ? (
            created.isLoading ? (
              <p role="status">Loading workout…</p>
            ) : created.error ? (
              <DataError
                message="Could not load the new workout. Retry to continue editing it."
                onRetry={() => void created.refetch()}
              />
            ) : created.data ? (
              <WorkoutTemplateEditor
                key={created.data.id}
                embedded
                workout={created.data}
                onCancel={() => setView(null)}
                onSaved={async (saved) => {
                  cache.setQueryData(workoutDetailKey(userId, profileId, saved.id), saved);
                  await cache.invalidateQueries({ queryKey: workoutListKey(userId, profileId) });
                  setTitle(saved.title);
                  setPicked(saved);
                  setView("created");
                }}
              />
            ) : (
              <p role="alert" className="text-sm text-danger">
                Workout unavailable. It may have been deleted.
              </p>
            )
          ) : null}
          {error ? (
            <p role="alert" className="rounded-xl bg-danger/10 p-3 text-sm text-danger">
              {error}
              {view === "save" ? (
                <span className="mt-1 block">
                  Your plan is unchanged. If creation succeeded, retry finishes the same private
                  workout rather than creating another.
                </span>
              ) : null}
            </p>
          ) : null}
          {!editingForm ? (
            <Button
              type="button"
              variant="outline"
              disabled={busy}
              className="min-h-11 w-full"
              onClick={() => setView(null)}
            >
              {view === "created" ? "Not now" : "Cancel"}
            </Button>
          ) : null}
        </DialogContent>
      </Dialog>
    </>
  );
}
