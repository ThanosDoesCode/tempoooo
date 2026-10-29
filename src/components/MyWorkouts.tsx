import { useRef, useState } from "react";
import { Link, useNavigate } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { AppShell, PageHeader } from "@/components/AppShell";
import { Card, DataError, PendingLabel } from "@/components/ui-kit";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { WorkoutTemplateEditor } from "@/components/WorkoutTemplateEditor";
import { useAuth } from "@/lib/auth";
import { useBulkMeta } from "@/lib/store";
import { bulkPlanModeFor, useMemberships } from "@/lib/bulk-access";
import { userFacingError } from "@/lib/network-errors";
import {
  createWorkout,
  duplicateWorkout,
  deleteWorkout,
  useMyWorkouts,
  usePrivateWorkout,
  workoutListKey,
  workoutDetailKey,
  type WorkoutSummary,
} from "@/lib/workout-templates-query";

function useWorkoutAccess() {
  const { user } = useAuth();
  const { bulkId } = useBulkMeta();
  const memberships = useMemberships();
  return {
    userId: user?.id ?? null,
    profileId: bulkId,
    mode: bulkPlanModeFor(memberships.data, bulkId),
    loading: memberships.isLoading,
  };
}
function Gate({ loading }: { loading: boolean }) {
  return (
    <AppShell>
      <PageHeader title="My workouts" historyBack backTo="/bulk/training" backLabel="Training" />
      {loading ? (
        <div
          role="status"
          aria-label="Loading workouts"
          className="h-40 motion-safe:animate-pulse rounded-2xl bg-card"
        />
      ) : (
        <Card>
          <p className="text-sm text-muted-foreground">
            My workouts is part of the fitness tools. Set up fitness to manage workouts.
          </p>
        </Card>
      )}
    </AppShell>
  );
}
export function MyWorkoutsPage() {
  const { userId, profileId, mode, loading } = useWorkoutAccess();
  if (mode !== "public" || !userId || !profileId) return <Gate loading={!!loading} />;
  return <WorkoutLibrary key={`${userId}:${profileId}`} userId={userId} profileId={profileId} />;
}
export function PrivateWorkoutPage({ workoutId, edit }: { workoutId: string; edit: boolean }) {
  const { userId, profileId, mode, loading } = useWorkoutAccess();
  if (mode !== "public" || !userId || !profileId) return <Gate loading={!!loading} />;
  return (
    <WorkoutDetail
      key={`${userId}:${profileId}:${workoutId}`}
      userId={userId}
      profileId={profileId}
      workoutId={workoutId}
      edit={edit}
    />
  );
}

function workoutActionError(error: unknown, action: string): string {
  if (
    error &&
    typeof error === "object" &&
    "code" in error &&
    error.code === "P0001" &&
    "message" in error &&
    typeof error.message === "string"
  )
    return error.message;
  return userFacingError(error, action);
}

export function WorkoutLibrary({ userId, profileId }: { userId: string; profileId: string }) {
  const workouts = useMyWorkouts(userId, profileId);
  const cache = useQueryClient();
  const navigate = useNavigate();
  const [createOpen, setCreateOpen] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState<WorkoutSummary | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const pending = useRef(false);
  const duplicateIds = useRef(new Map<string, string>());
  async function duplicate(id: string) {
    if (pending.current) return;
    pending.current = true;
    setBusyId(id);
    setError(null);
    const requestId = duplicateIds.current.get(id) ?? crypto.randomUUID();
    duplicateIds.current.set(id, requestId);
    try {
      await duplicateWorkout(id, requestId);
      duplicateIds.current.delete(id);
      await cache.invalidateQueries({ queryKey: workoutListKey(userId, profileId) });
      toast.success("Workout duplicated");
    } catch (cause) {
      setError(workoutActionError(cause, "duplicate this workout"));
    } finally {
      pending.current = false;
      setBusyId(null);
    }
  }
  return (
    <AppShell>
      <PageHeader title="My workouts" historyBack backTo="/bulk/training" backLabel="Training" />
      <div className="min-w-0 space-y-[14px]">
        <Button className="min-h-11 w-full" onClick={() => setCreateOpen(true)}>
          Create workout
        </Button>
        {error ? (
          <p role="alert" className="text-sm text-danger">
            {error}
          </p>
        ) : null}
        {workouts.isLoading ? (
          <div
            role="status"
            aria-label="Loading workouts"
            className="h-40 motion-safe:animate-pulse rounded-2xl bg-card"
          />
        ) : workouts.error ? (
          <DataError
            message={userFacingError(workouts.error, "load your workouts")}
            onRetry={() => void workouts.refetch()}
          />
        ) : workouts.data?.length ? (
          workouts.data.map((workout) => (
            <Card key={workout.id} className="min-w-0 space-y-3">
              <div>
                <h2 className="break-words text-lg font-semibold">{workout.title}</h2>
                <p className="mt-1 text-sm text-muted-foreground">
                  {workout.exerciseCount} exercise{workout.exerciseCount === 1 ? "" : "s"}
                </p>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <Button asChild variant="outline" className="min-h-11 min-w-0">
                  <Link
                    to="/bulk/training/workouts/$workoutId"
                    params={{ workoutId: workout.id }}
                    search={{ edit: false }}
                    preload="intent"
                  >
                    Open
                  </Link>
                </Button>
                <Button asChild variant="outline" className="min-h-11 min-w-0">
                  <Link
                    to="/bulk/training/workouts/$workoutId"
                    params={{ workoutId: workout.id }}
                    search={{ edit: true }}
                    preload="intent"
                  >
                    Edit
                  </Link>
                </Button>
                <Button
                  variant="outline"
                  className="min-h-11 min-w-0"
                  disabled={busyId !== null}
                  onClick={() => void duplicate(workout.id)}
                >
                  {busyId === workout.id ? <PendingLabel>Duplicating</PendingLabel> : "Duplicate"}
                </Button>
                <Button
                  variant="ghost"
                  className="min-h-11 min-w-0 text-danger"
                  disabled={busyId !== null}
                  onClick={() => setConfirmDelete(workout)}
                >
                  Delete
                </Button>
              </div>
            </Card>
          ))
        ) : (
          <Card>
            <h2 className="font-semibold">No workouts yet</h2>
            <p className="mt-2 text-sm text-muted-foreground">
              Create a standalone workout to reuse in your training plans later.
            </p>
          </Card>
        )}
      </div>
      <CreateWorkoutDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        onCreated={async (id) => {
          await cache.invalidateQueries({ queryKey: workoutListKey(userId, profileId) });
          await navigate({
            to: "/bulk/training/workouts/$workoutId",
            params: { workoutId: id },
            search: { edit: true },
          });
        }}
      />
      {confirmDelete ? (
        <WorkoutDeleteDialog
          key={confirmDelete.id}
          id={confirmDelete.id}
          title={confirmDelete.title}
          onClose={() => setConfirmDelete(null)}
          onDeleted={async () => {
            cache.removeQueries({
              queryKey: workoutDetailKey(userId, profileId, confirmDelete.id),
            });
            await cache.invalidateQueries({ queryKey: workoutListKey(userId, profileId) });
            setConfirmDelete(null);
          }}
        />
      ) : null}
    </AppShell>
  );
}

export function CreateWorkoutDialog({
  open,
  onOpenChange,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated: (id: string) => Promise<void>;
}) {
  const [title, setTitle] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const requestId = useRef<string | null>(null);
  const pending = useRef(false);
  async function create(event: React.FormEvent) {
    event.preventDefault();
    if (pending.current) return;
    if (title.trim().length < 2 || title.trim().length > 80) {
      setError("Workout name must be between 2 and 80 characters.");
      return;
    }
    requestId.current ??= crypto.randomUUID();
    pending.current = true;
    setSaving(true);
    setError(null);
    try {
      const id = await createWorkout(title, requestId.current);
      requestId.current = null;
      setTitle("");
      await onCreated(id);
      onOpenChange(false);
    } catch (cause) {
      setError(workoutActionError(cause, "create your workout"));
    } finally {
      pending.current = false;
      setSaving(false);
    }
  }
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!pending.current) onOpenChange(next);
      }}
    >
      <DialogContent className="w-[calc(100%-2rem)] max-w-sm rounded-2xl">
        <DialogHeader>
          <DialogTitle>Create workout</DialogTitle>
          <DialogDescription>
            Start with a name, then add exercises. Only you can see this workout.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={(event) => void create(event)} className="min-w-0 space-y-3">
          <label className="block text-sm">
            Workout name
            <input
              autoFocus
              value={title}
              maxLength={80}
              disabled={saving}
              onChange={(event) => setTitle(event.target.value)}
              className="mt-2 min-h-11 w-full min-w-0 rounded-xl border border-input bg-elevated px-3 text-base"
            />
          </label>
          {error ? (
            <p role="alert" className="text-sm text-danger">
              {error}
            </p>
          ) : null}
          <Button type="submit" disabled={saving} className="min-h-11 w-full">
            {saving ? <PendingLabel>Creating</PendingLabel> : "Create workout"}
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function WorkoutDeleteDialog({
  id,
  title,
  onClose,
  onDeleted,
}: {
  id: string;
  title: string;
  onClose: () => void;
  onDeleted: () => Promise<void>;
}) {
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const pending = useRef(false);
  async function remove() {
    if (pending.current) return;
    pending.current = true;
    setSaving(true);
    setError(null);
    try {
      await deleteWorkout(id);
      await onDeleted();
      toast.success("Workout removed");
    } catch (cause) {
      setError(workoutActionError(cause, "delete this workout"));
    } finally {
      pending.current = false;
      setSaving(false);
    }
  }
  return (
    <AlertDialog
      open
      onOpenChange={(open) => {
        if (!open && !pending.current) onClose();
      }}
    >
      <AlertDialogContent className="w-[calc(100%-2rem)] rounded-2xl">
        <AlertDialogHeader>
          <AlertDialogTitle>Delete this workout?</AlertDialogTitle>
          <AlertDialogDescription>
            Remove “{title}” from My workouts. Your plans, exercises and workout history stay
            unchanged.
          </AlertDialogDescription>
        </AlertDialogHeader>
        {error ? (
          <p role="alert" className="text-sm text-danger">
            {error}
          </p>
        ) : null}
        <AlertDialogFooter>
          <AlertDialogCancel disabled={saving}>Keep workout</AlertDialogCancel>
          <AlertDialogAction
            disabled={saving}
            className="min-h-11 bg-danger text-white hover:bg-danger/90"
            onClick={(event) => {
              event.preventDefault();
              void remove();
            }}
          >
            {saving ? <PendingLabel>Deleting</PendingLabel> : "Delete workout"}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

export function WorkoutDetail({
  userId,
  profileId,
  workoutId,
  edit,
}: {
  userId: string;
  profileId: string;
  workoutId: string;
  edit: boolean;
}) {
  const query = usePrivateWorkout(userId, profileId, workoutId);
  const cache = useQueryClient();
  const navigate = useNavigate();
  const [deleting, setDeleting] = useState(false);
  const setEdit = (next: boolean) =>
    navigate({
      to: "/bulk/training/workouts/$workoutId",
      params: { workoutId },
      search: { edit: next },
      replace: true,
    });
  const workout = query.data;
  return (
    <AppShell>
      {edit && workout ? (
        <WorkoutTemplateEditor
          key={workout.id}
          workout={workout}
          onCancel={() => void setEdit(false)}
          onSaved={async (saved) => {
            cache.setQueryData(workoutDetailKey(userId, profileId, workoutId), saved);
            await cache.invalidateQueries({ queryKey: workoutListKey(userId, profileId) });
            await setEdit(false);
          }}
        />
      ) : (
        <>
          <div className="min-w-0 [&_h1]:break-words">
            <PageHeader
              title={workout?.title ?? "My workout"}
              historyBack
              backTo="/bulk/training/workouts"
              backLabel="My workouts"
            />
          </div>
          {query.isLoading ? (
            <div
              role="status"
              aria-label="Loading workout"
              className="h-40 motion-safe:animate-pulse rounded-2xl bg-card"
            />
          ) : query.error ? (
            <DataError
              message={userFacingError(query.error, "load this workout")}
              onRetry={() => void query.refetch()}
            />
          ) : workout ? (
            <div className="min-w-0 space-y-3">
              <div className="grid grid-cols-2 gap-2">
                <Button variant="outline" className="min-h-11" onClick={() => void setEdit(true)}>
                  Edit workout
                </Button>
                <Button
                  variant="ghost"
                  className="min-h-11 text-danger"
                  onClick={() => setDeleting(true)}
                >
                  Delete
                </Button>
              </div>
              <WorkoutOverview exercises={workout.exercises} />
            </div>
          ) : (
            <Card>
              <h2 className="font-semibold">Workout unavailable</h2>
              <p className="mt-1 text-sm text-muted-foreground">
                This workout may have been deleted or isn’t available to your account.
              </p>
            </Card>
          )}
        </>
      )}
      {deleting && workout ? (
        <WorkoutDeleteDialog
          id={workoutId}
          title={workout.title}
          onClose={() => setDeleting(false)}
          onDeleted={async () => {
            cache.removeQueries({ queryKey: workoutDetailKey(userId, profileId, workoutId) });
            await cache.invalidateQueries({ queryKey: workoutListKey(userId, profileId) });
            await navigate({ to: "/bulk/training/workouts", replace: true });
          }}
        />
      ) : null}
    </AppShell>
  );
}
export function WorkoutOverview({
  exercises,
}: {
  exercises: import("@/lib/training-plans").TrainingPlanExercise[];
}) {
  return (
    <Card>
      <ol className="min-w-0 divide-y divide-border">
        {exercises.map((exercise, index) => (
          <li key={exercise.id} className="flex min-w-0 gap-3 py-3 first:pt-0 last:pb-0">
            <span className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-primary/15 text-xs text-primary">
              {index + 1}
            </span>
            <div className="min-w-0">
              <h2 className="break-words font-semibold">{exercise.name}</h2>
              <p className="mt-1 text-sm text-muted-foreground">
                {exercise.sets} × {exercise.repMin}–{exercise.repMax}
                {exercise.intendedUnilateralMode === "unilateral" ? " · Each side" : ""}
              </p>
              {exercise.notes ? (
                <p className="mt-2 break-words text-sm text-muted-foreground">{exercise.notes}</p>
              ) : null}
            </div>
          </li>
        ))}
      </ol>
      {!exercises.length ? (
        <p className="text-sm text-muted-foreground">
          No exercises yet. Edit this workout to add exercises.
        </p>
      ) : null}
    </Card>
  );
}
