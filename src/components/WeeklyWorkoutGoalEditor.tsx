import { useEffect, useRef, useState } from "react";
import { Card, Note, PendingLabel, SectionTitle } from "@/components/ui-kit";
import { useActions, useAppData, useBulkMeta } from "@/lib/store";
import { resolveWeeklyWorkoutTarget } from "@/lib/goal-metrics";
import { useActiveTrainingPlan } from "@/lib/training-plans-query";

const MIN = 1;
const MAX = 14;
const goalDraftValue = (draft: string) =>
  draft.trim() === "" ? null : Number(draft.replace(",", "."));

/**
 * Edits the weekly completed-workout goal through the existing saveTargets() mutation.
 * This is deliberately separate from the training plan's structured-day count: a 3-day
 * plan can carry a 5-workout weekly goal. Only weeklyWorkoutGoal changes here; the plan,
 * its days and history are untouched.
 */
export function WeeklyWorkoutGoalEditor({
  onDirtyChange,
}: { onDirtyChange?: (dirty: boolean) => void } = {}) {
  const data = useAppData();
  const { role, bulkId } = useBulkMeta();
  const plan = useActiveTrainingPlan(bulkId ?? null);
  const canEdit = role !== "viewer";
  const { saveTargets } = useActions();
  const targets = data?.targets;
  const configuredGoal = resolveWeeklyWorkoutTarget({
    weeklyWorkoutGoal: targets?.weeklyWorkoutGoal ?? null,
    targetDaysPerWeek: targets?.trainingDaysPerWeek ?? null,
    activePlanDaysPerWeek: plan.data?.trainingDaysPerWeek ?? null,
  });
  const [draft, setDraft] = useState("");
  const [status, setStatus] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [error, setError] = useState<string | null>(null);
  const [initialized, setInitialized] = useState(false);
  const edited = useRef(false);

  useEffect(() => {
    // Keep the draft when the existing optimistic store rolls back a failed save.
    if (edited.current || status === "saving" || status === "error") return;
    if (!targets) return;
    setDraft(configuredGoal == null ? "" : String(configuredGoal));
    setInitialized(true);
  }, [!!targets, configuredGoal]); // eslint-disable-line react-hooks/exhaustive-deps

  const dirty = !!targets && canEdit && initialized && goalDraftValue(draft) !== configuredGoal;
  useEffect(() => {
    onDirtyChange?.(dirty);
  }, [dirty, onDirtyChange]);

  if (!targets) return null;

  const save = async () => {
    if (!dirty || status === "saving") return;
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
      edited.current = false;
      setStatus("saved");
    } catch {
      setStatus("error");
      setError("Goal was not saved. Check your connection and try again.");
    }
  };

  return (
    <Card>
      <SectionTitle>Weekly workout goal</SectionTitle>
      <label className="block text-[13px] text-muted-foreground">
        Completed workouts per week
        <input
          inputMode="numeric"
          disabled={!canEdit || status === "saving"}
          value={draft}
          placeholder="Not configured"
          onChange={(event) => {
            edited.current = goalDraftValue(event.target.value) !== configuredGoal;
            setDraft(event.target.value);
            setStatus("idle");
          }}
          aria-label="Weekly workout goal"
          className="account-input num mt-2 font-semibold"
        />
      </label>
      <div className="mt-3">
        <Note>
          This is your target number of completed workouts each week. It is independent of how many
          structured days your training plan has, and does not change your plan or history. Your
          configured goal updates now. Streak targets stay fixed for each week.
        </Note>
      </div>
      {error ? (
        <p role="alert" className="mt-3 text-sm text-warn">
          {error}
        </p>
      ) : null}
      <button
        type="button"
        disabled={!canEdit || !dirty || status === "saving"}
        onClick={() => void save()}
        aria-live="polite"
        className="account-primary mt-4"
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
