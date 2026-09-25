import { useEffect, useState } from "react";
import { Card, Note, PendingLabel, SectionTitle } from "@/components/ui-kit";
import { useActions, useAppData, useBulkMeta } from "@/lib/store";

type Field = "calories" | "protein" | "carbs" | "fat";
const FIELDS: Array<{ key: Field; label: string; unit: string; min: number; max: number }> = [
  { key: "calories", label: "Calories", unit: "kcal", min: 800, max: 10000 },
  { key: "protein", label: "Protein", unit: "g", min: 1, max: 1000 },
  { key: "carbs", label: "Carbs", unit: "g", min: 1, max: 1000 },
  { key: "fat", label: "Fat", unit: "g", min: 1, max: 1000 },
];

/**
 * Edits daily calorie and macro targets in place through the existing saveTargets()
 * mutation. Only these four fields change; goal, weights, training preferences and
 * plans are untouched. Past nutrition days keep their own target snapshots.
 */
export function NutritionTargetsEditor() {
  const data = useAppData();
  const { role } = useBulkMeta();
  const canEdit = role !== "viewer";
  const { saveTargets } = useActions();
  const targets = data?.targets;
  const [draft, setDraft] = useState<Record<Field, string>>({
    calories: "",
    protein: "",
    carbs: "",
    fat: "",
  });
  const [status, setStatus] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!targets) return;
    setDraft({
      calories: String(targets.calories),
      protein: String(targets.protein),
      carbs: String(targets.carbs),
      fat: String(targets.fat),
    });
  }, [targets?.calories, targets?.protein, targets?.carbs, targets?.fat]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!targets) return null;

  const save = async () => {
    const next: Partial<Record<Field, number>> = {};
    for (const field of FIELDS) {
      const value = Number(draft[field.key].replace(",", "."));
      if (!Number.isFinite(value) || value < field.min || value > field.max) {
        setStatus("error");
        setError(`${field.label} must be between ${field.min} and ${field.max} ${field.unit}.`);
        return;
      }
      next[field.key] = Math.round(value);
    }
    setStatus("saving");
    setError(null);
    try {
      await saveTargets({ ...targets, ...next });
      setStatus("saved");
    } catch {
      setStatus("error");
      setError("Targets were not saved. Check your connection and try again.");
    }
  };

  return (
    <Card>
      <SectionTitle>Daily nutrition targets</SectionTitle>
      <div className="grid grid-cols-2 gap-3">
        {FIELDS.map((field) => (
          <label key={field.key} className="block text-xs text-muted-foreground">
            {field.label} ({field.unit})
            <input
              inputMode="numeric"
              disabled={!canEdit}
              value={draft[field.key]}
              onChange={(event) => {
                setDraft((current) => ({ ...current, [field.key]: event.target.value }));
                setStatus("idle");
              }}
              className="num mt-1 w-full rounded-xl border border-input bg-elevated px-3 py-2.5 text-lg font-semibold text-foreground outline-none focus:border-ring disabled:opacity-60"
            />
          </label>
        ))}
      </div>
      <div className="mt-3">
        <Note>
          Changes apply from today. Past days keep the targets they were logged with. Your Goal,
          weight targets and training plan are not reset.
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
          <PendingLabel>Saving targets...</PendingLabel>
        ) : status === "saved" ? (
          "Targets saved"
        ) : (
          "Save targets"
        )}
      </button>
    </Card>
  );
}
