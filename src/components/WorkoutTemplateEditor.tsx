import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { WorkoutExerciseListEditor } from "@/components/WorkoutExerciseListEditor";
import { BackButton } from "@/components/BackControl";
import { Button } from "@/components/ui/button";
import { Card, PendingLabel } from "@/components/ui-kit";
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
import { validateTrainingExercises } from "@/lib/training-plans";
import { saveWorkout, type PrivateWorkout } from "@/lib/workout-templates-query";
import { userFacingError } from "@/lib/network-errors";

export function WorkoutTemplateEditor({
  workout,
  onCancel,
  onSaved,
}: {
  workout: PrivateWorkout;
  onCancel: () => void;
  onSaved: (workout: PrivateWorkout) => Promise<void>;
}) {
  const [title, setTitle] = useState(workout.title);
  const [exercises, setExercises] = useState(() => structuredClone(workout.exercises));
  const [updatedAt, setUpdatedAt] = useState(workout.updatedAt);
  const [baseline, setBaseline] = useState(
    JSON.stringify({ title: workout.title, exercises: workout.exercises }),
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [discard, setDiscard] = useState(false);
  const pending = useRef(false);
  const dirty = JSON.stringify({ title, exercises }) !== baseline;
  useEffect(() => {
    if (!dirty) return;
    const warn = (event: BeforeUnloadEvent) => event.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);
  function cancel() {
    if (dirty) setDiscard(true);
    else onCancel();
  }
  async function save() {
    if (pending.current) return;
    const validation = validateTrainingExercises(exercises, "Workout");
    if (title.trim().length < 2 || title.trim().length > 80)
      validation.unshift("Workout name must be between 2 and 80 characters.");
    if (exercises.some((exercise) => !exercise.exerciseId))
      validation.push("Replace unavailable exercises before saving.");
    if (validation.length) {
      setError(validation[0]!);
      return;
    }
    pending.current = true;
    setSaving(true);
    setError(null);
    try {
      const saved = { id: workout.id, title: title.trim(), updatedAt, exercises };
      const authoritativeTimestamp = await saveWorkout(saved);
      // PostgreSQL returns the exact concurrency token, including sub-millisecond precision.
      // Never substitute a browser clock or the previous query snapshot on the next save.
      saved.updatedAt = authoritativeTimestamp;
      setUpdatedAt(authoritativeTimestamp);
      setTitle(saved.title);
      setBaseline(JSON.stringify({ title: saved.title, exercises }));
      await onSaved(saved);
      toast.success("Workout saved");
    } catch (cause) {
      const message =
        cause && typeof cause === "object" && "message" in cause ? String(cause.message) : "";
      setError(
        /changed on another device/i.test(message)
          ? "Workout changed on another device"
          : userFacingError(cause, "save your workout", { inputPreserved: true }),
      );
    } finally {
      pending.current = false;
      setSaving(false);
    }
  }
  return (
    <div className="min-w-0 space-y-3">
      <BackButton onClick={cancel}>My workout</BackButton>
      <Card className="space-y-3">
        <h1 className="text-xl font-semibold">Edit workout</h1>
        <label className="block text-xs font-medium text-muted-foreground">
          Workout name
          <input
            value={title}
            maxLength={80}
            disabled={saving}
            onChange={(event) => setTitle(event.target.value)}
            className="mt-1 min-h-11 w-full min-w-0 rounded-xl border border-input bg-elevated px-3 text-base"
          />
        </label>
        <WorkoutExerciseListEditor
          exercises={exercises}
          onChange={setExercises}
          title={title || "workout"}
          disabled={saving}
        />
      </Card>
      {error ? (
        <p role="alert" className="rounded-xl bg-danger/10 p-3 text-sm text-danger">
          {error}
          {error === "Workout changed on another device" ? (
            <span className="mt-1 block">
              Your edits are still here. Reopen the workout to load the latest version.
            </span>
          ) : null}
        </p>
      ) : null}
      <div className="sticky bottom-[calc(5rem+env(safe-area-inset-bottom))] z-10 grid grid-cols-2 gap-2 rounded-2xl border border-border bg-background/95 p-2">
        <Button variant="outline" className="min-h-11 min-w-0" disabled={saving} onClick={cancel}>
          Cancel
        </Button>
        <Button
          className="min-h-11 min-w-0"
          disabled={saving || !dirty}
          onClick={() => void save()}
        >
          {saving ? <PendingLabel>Saving</PendingLabel> : "Save workout"}
        </Button>
      </div>
      <AlertDialog open={discard} onOpenChange={setDiscard}>
        <AlertDialogContent className="w-[calc(100%-2rem)] rounded-2xl">
          <AlertDialogHeader>
            <AlertDialogTitle>Discard unsaved changes?</AlertDialogTitle>
            <AlertDialogDescription>Your workout edits haven’t been saved.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep editing</AlertDialogCancel>
            <AlertDialogAction
              className="bg-danger text-white hover:bg-danger/90"
              onClick={onCancel}
            >
              Discard
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
