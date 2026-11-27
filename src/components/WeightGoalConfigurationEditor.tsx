import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Card, DataError, PendingLabel, SectionTitle } from "@/components/ui-kit";
import { NativeSelect } from "@/components/ui/native-select";
import { getBulkId, getBulkRole, useActions, useBulkMeta } from "@/lib/store";
import type { useBulkToday } from "@/lib/bulk-today-query";
import type { Targets } from "@/lib/types";
import { weightGoalConfiguration } from "@/lib/weekly-progress-coach";
import { refreshBulkNutritionTargets } from "@/lib/bulk-nutrition-query";
import { userFacingError } from "@/lib/network-errors";

type Draft = { goal: string; targetWeight: string; targetWeeklyGainKg: string };
const fields = ["goal", "targetWeight", "targetWeeklyGainKg"] as const;
const draftFor = (saved: Partial<Targets>): Draft => ({
  goal: weightGoalConfiguration(saved).goal ?? "",
  targetWeight: typeof saved.targetWeight === "number" ? String(saved.targetWeight) : "",
  targetWeeklyGainKg:
    typeof saved.targetWeeklyGainKg === "number" ? String(saved.targetWeeklyGainKg) : "",
});
const numberFrom = (value: string) => (value.trim() ? Number(value.replace(",", ".")) : undefined);

/** Repair incomplete saved goals through the existing target-save path, without onboarding. */
export function WeightGoalConfigurationEditor({
  query,
  onDirtyChange,
}: {
  query: ReturnType<typeof useBulkToday>;
  onDirtyChange?: (dirty: boolean) => void;
}) {
  const client = useQueryClient();
  const { bulkId, role } = useBulkMeta();
  const { saveTargets } = useActions();
  const raw = query.data?.savedTargets;
  const [initial, setInitial] = useState<Partial<Targets> | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [status, setStatus] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [error, setError] = useState<string | null>(null);
  const [syncError, setSyncError] = useState(false);
  useEffect(() => {
    if (raw && !initial) {
      setInitial({ ...raw });
      setDraft(draftFor(raw));
    }
  }, [raw, initial]);
  const dirty =
    !!draft &&
    !!initial &&
    status !== "saved" &&
    fields.some((field) => draft[field] !== draftFor(initial)[field]);
  useEffect(() => {
    onDirtyChange?.(dirty);
  }, [dirty, onDirtyChange]);

  const save = async () => {
    if (!draft || !initial || !dirty || !bulkId || role !== "owner" || status === "saving") return;
    const goal =
      draft.goal === "gain" || draft.goal === "cut" || draft.goal === "maintain"
        ? draft.goal
        : undefined;
    const targetWeight = numberFrom(draft.targetWeight);
    const selected = weightGoalConfiguration({
      goal,
      ...(targetWeight === undefined ? {} : { targetWeight }),
      targetWeeklyGainKg: numberFrom(draft.targetWeeklyGainKg),
    });
    if (!selected.complete) {
      setError(
        `Check ${selected.missing.join(", ")}. Pace is 0 for maintenance, or 0.05–1.5 kg/week for gain or cut.`,
      );
      setStatus("error");
      return;
    }
    setStatus("saving");
    setError(null);
    let day: string;
    try {
      const refreshed = await query.refetch({ throwOnError: true });
      const latest = refreshed.data?.savedTargets;
      if (getBulkId() !== bulkId || getBulkRole() !== "owner")
        throw new Error("Account changed. Reopen Goal settings before saving.");
      if (!latest || fields.some((field) => !Object.is(initial[field], latest[field])))
        throw new Error("Goal details changed on another device. Reload before saving.");
      const { calories, protein, carbs, fat } = latest;
      if (
        typeof calories !== "number" ||
        !Number.isFinite(calories) ||
        typeof protein !== "number" ||
        !Number.isFinite(protein) ||
        typeof carbs !== "number" ||
        !Number.isFinite(carbs) ||
        typeof fat !== "number" ||
        !Number.isFinite(fat)
      )
        throw new Error("Saved nutrition targets are unavailable. No goal details were changed.");
      const savedDay = await saveTargets({
        ...latest,
        calories,
        protein,
        carbs,
        fat,
        goal: selected.goal!,
        targetWeight: selected.targetWeight!,
        targetWeeklyGainKg: selected.pace!,
      });
      if (!savedDay) throw new Error("Goal details were not saved. Reload and try again.");
      day = savedDay;
    } catch (cause) {
      setStatus("error");
      setError(userFacingError(cause, "save your weight goal details"));
      return;
    }
    setStatus("saved");
    try {
      await refreshBulkNutritionTargets(client, bulkId, day, undefined, { throwOnError: true });
    } catch {
      setSyncError(true);
    }
  };

  if (query.error)
    return (
      <DataError message="Couldn’t load saved goal details." onRetry={() => void query.refetch()} />
    );
  if (query.data !== undefined && !raw)
    return (
      <DataError
        message="No saved goal settings are available. Complete your daily targets before saving weight goal details."
        onRetry={() => void query.refetch()}
      />
    );
  if (query.isLoading || !draft || !raw)
    return (
      <p role="status" className="text-sm text-muted-foreground">
        Loading saved goal details…
      </p>
    );
  if (weightGoalConfiguration(raw).complete && !dirty && status !== "saved") return null;
  const disabled = role !== "owner" || status === "saving" || status === "saved";
  return (
    <Card>
      <SectionTitle>Complete weight goal</SectionTitle>
      <p className="mb-3 text-xs text-muted-foreground">
        Fill in the missing details. Your history, training plan and nutrition targets stay in
        place.
      </p>
      <div className="space-y-3">
        <label className="block text-sm">
          Goal type
          <NativeSelect
            value={draft.goal}
            disabled={disabled}
            className="mt-1"
            onChange={(event) => setDraft({ ...draft, goal: event.target.value })}
          >
            <option value="">Choose goal type</option>
            <option value="gain">Gain</option>
            <option value="cut">Cut</option>
            <option value="maintain">Maintain</option>
          </NativeSelect>
        </label>
        {(
          [
            ["targetWeight", "Target weight (kg)"],
            ["targetWeeklyGainKg", "Weekly pace (kg/week)"],
          ] as const
        ).map(([field, label]) => (
          <label key={field} className="block text-sm">
            {label}
            <input
              type="text"
              inputMode="decimal"
              autoComplete="off"
              disabled={disabled}
              value={draft[field]}
              onChange={(event) => setDraft({ ...draft, [field]: event.target.value })}
              className="mt-1 min-h-11 w-full min-w-0 rounded-xl border border-input bg-elevated px-3 text-base"
            />
          </label>
        ))}
      </div>
      <p className="mt-2 text-xs text-muted-foreground">
        Use 0 for maintenance. Gain and cut use a positive pace from 0.05 to 1.5 kg/week.
      </p>
      <button
        type="button"
        onClick={() => void save()}
        disabled={disabled || !dirty}
        className="mt-3 min-h-11 w-full rounded-xl bg-primary px-3 text-sm font-semibold text-primary-foreground disabled:opacity-50"
      >
        {status === "saving" ? (
          <PendingLabel>Saving goal details…</PendingLabel>
        ) : status === "saved" ? (
          "Goal details saved"
        ) : (
          "Save goal details"
        )}
      </button>
      {error ? (
        <p role="alert" className="mt-2 text-sm text-danger">
          {error}
        </p>
      ) : null}
      {syncError ? (
        <p role="status" className="mt-2 text-sm text-muted-foreground">
          Goal details were saved, but the screen couldn’t refresh. Reload to see them.
        </p>
      ) : null}
    </Card>
  );
}
