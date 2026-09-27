import { useEffect, useState } from "react";
import { Card, Note, PendingLabel, SectionTitle } from "@/components/ui-kit";
import { useActions, useAppData, useBulkMeta } from "@/lib/store";

const MIN = 1;
const MAX = 14;

/**
 * Edits the weekly completed-workout goal through the existing saveTargets() mutation.
 * This is deliberately separate from the training plan's structured-day count: a 3-day
 * plan can carry a 5-workout weekly goal. Only weeklyWorkoutGoal changes here; the plan,
 * its days and history are untouched.
 */
export function WeeklyWorkoutGoalEditor() {
  const data = useAppData();
  const { role } = useBulkMeta();
  const canEdit = role !== "viewer";
  const { saveTargets } = useActions();
  const targets = data?.targets;
  const [draft, setDraft] = useState("");
  const [status, setStatus] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (targets?.weeklyWorkoutGoal != null) setDraft(String(targets.weeklyWorkoutGoal));
  }, [targets?.weeklyWorkoutGoal]);

  if (!targets) return null;

  const save = async () => {
    const value = Number(draft.replace(",", "."));
    if (!Number.isInteger(value) || value < MIN || value > MAX) {
      setStatus("error");
      setError(`Enter a whole number between ${MIN} and ${MAX} workouts per week.`);
      return;
    }
    setStatus("saving");
    setError(null);
    try {
      await saveTargets({ ...targets, weeklyWorkoutGoal: value });
      setStatus("saved");
    } catch {
      setStatus("error");
      setError("Goal was not saved. Check your connection and try again.");
    }
  };

  return (
    <Card>
      <SectionTitle>Weekly workout goal</SectionTitle>
      <label className="block text-xs text-muted-foreground">
        Completed workouts per week
        <input
          inputMode="numeric"
          disabled={!canEdit}
          value={draft}
          onChange={(event) => {
            setDraft(event.target.value);
            setStatus("idle");
          }}
          aria-label="Weekly workout goal"
          className="num mt-1 w-full rounded-xl border border-input bg-elevated px-3 py-2.5 text-lg font-semibold text-foreground outline-none focus:border-ring disabled:opacity-60"
        />
      </label>
      <div className="mt-3">
        <Note>
          This is your target number of completed workouts each week. It is independent of how many
          structured days your training plan has, and does not change your plan or history.
        </Note>
      </div>
      {error ? (
        <p role="alert" className="mt-3 text-sm text-danger">
          {error}
        </p>
      ) : null}
      <button
        type="button"
        disabled={!canEdit || status === "saving"}
        onClick={() => void save()}
        className="mt-4 flex min-h-11 w-full items-center justify-center rounded-xl bg-primary px-4 text-sm font-semibold text-primary-foreground disabled:opacity-60"
      >
        {status === "saving" ? (
          <PendingLabel>Saving goal...</PendingLabel>
        ) : status === "saved" ? (
          "Goal saved"
        ) : (
          "Save goal"
        )}
      </button>
    </Card>
  );
}
