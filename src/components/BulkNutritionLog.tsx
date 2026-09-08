import { useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { addDays, format, parseISO } from "date-fns";
import { ChevronLeft, ChevronRight, Pencil, Plus, Trash2 } from "lucide-react";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Card, DataError, Field, PendingLabel } from "@/components/ui-kit";
import type { BulkMealPreset } from "@/lib/bulk-meal-presets";
import { useBulkMealPresets } from "@/lib/bulk-meal-presets-query";
import {
  emptyNutritionEntryDraft,
  isIsoLocalDay,
  nutritionEntryDraft,
  nutritionSummary,
  validateNutritionEntryDraft,
  type BulkNutritionEntry,
  type NutritionEntryDraft,
  type NutritionMacros,
  type NutritionMacroStatus,
} from "@/lib/bulk-nutrition";
import {
  bulkNutritionDayQueryKey,
  createBulkNutritionEntry,
  deleteBulkNutritionEntry,
  logBulkMealPreset,
  updateBulkNutritionEntry,
  useBulkNutritionDay,
} from "@/lib/bulk-nutrition-query";
import { iso } from "@/lib/calc";
import { userFacingError } from "@/lib/network-errors";

type EntryEditor = {
  entry: BulkNutritionEntry | null;
  draft: NutritionEntryDraft;
  initial: string;
  requestId: string;
};

type FailedPresetLog = { presetId: string; requestId: string };
const draftSignature = (draft: NutritionEntryDraft) => JSON.stringify(draft);
const EMPTY_ENTRIES: BulkNutritionEntry[] = [];

export function BulkNutritionLog({
  bulkProfileId,
  selectedDate,
  currentTargets,
  onDateChange,
}: {
  bulkProfileId: string;
  selectedDate: string;
  currentTargets: NutritionMacros;
  onDateChange: (date: string) => void;
}) {
  const queryClient = useQueryClient();
  const dayQuery = useBulkNutritionDay(bulkProfileId, selectedDate);
  const presets = useBulkMealPresets(bulkProfileId);
  const [pending, setPending] = useState<string | null>(null);
  const [failedPreset, setFailedPreset] = useState<FailedPresetLog | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [editor, setEditor] = useState<EntryEditor | null>(null);
  const today = iso(new Date());
  const isFuture = selectedDate > today;

  const invalidate = () =>
    Promise.all([
      queryClient.invalidateQueries({
        queryKey: bulkNutritionDayQueryKey(bulkProfileId, selectedDate),
      }),
      queryClient.invalidateQueries({ queryKey: ["bulk-progress-summary"] }),
    ]);

  const entries = dayQuery.data?.entries ?? EMPTY_ENTRIES;
  const targets = dayQuery.data?.day?.targets ?? currentTargets;
  const summary = useMemo(() => nutritionSummary(entries, targets), [entries, targets]);

  const changeDate = (date: string) => {
    if (!isIsoLocalDay(date)) return;
    if (
      editor &&
      draftSignature(editor.draft) !== editor.initial &&
      !window.confirm("Discard the unsaved nutrition entry?")
    )
      return;
    setEditor(null);
    setError(null);
    setFailedPreset(null);
    onDateChange(date);
  };

  const logPreset = async (presetId: string, requestId: string = crypto.randomUUID()) => {
    if (pending || isFuture) return;
    setPending(`preset:${presetId}`);
    setError(null);
    try {
      await logBulkMealPreset(presetId, selectedDate, requestId);
      await invalidate();
      setFailedPreset(null);
      toast.success("Meal logged");
    } catch (cause) {
      setFailedPreset({ presetId, requestId });
      setError(userFacingError(cause, "log this meal"));
    } finally {
      setPending(null);
    }
  };

  const saveEntry = async () => {
    if (!editor || pending || isFuture) return;
    const result = validateNutritionEntryDraft(editor.draft);
    if (!result.input) {
      setError(result.errors[0] ?? "Check the entry and try again.");
      return;
    }
    setPending("entry:save");
    setError(null);
    try {
      if (editor.entry) await updateBulkNutritionEntry(editor.entry, result.input);
      else await createBulkNutritionEntry(selectedDate, editor.requestId, result.input);
      await invalidate();
      toast.success(editor.entry ? "Entry updated" : "Entry added");
      setEditor(null);
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : "";
      setError(
        message.includes("another device")
          ? `${message}. Your entered data is still here.`
          : userFacingError(cause, "save this entry", { inputPreserved: true }),
      );
    } finally {
      setPending(null);
    }
  };

  const removeEntry = async (entry: BulkNutritionEntry) => {
    if (pending || isFuture || !window.confirm(`Delete “${entry.name}” from this day?`)) return;
    setPending(`delete:${entry.id}`);
    setError(null);
    try {
      await deleteBulkNutritionEntry(entry.id);
      await invalidate();
      toast.success("Entry deleted");
    } catch (cause) {
      setError(userFacingError(cause, "delete this entry"));
    } finally {
      setPending(null);
    }
  };

  const closeEditor = () => {
    if (
      editor &&
      draftSignature(editor.draft) !== editor.initial &&
      !window.confirm("Discard the unsaved nutrition entry?")
    )
      return;
    setEditor(null);
  };

  return (
    <div className="space-y-4">
      <DateNavigation selectedDate={selectedDate} today={today} onChange={changeDate} />
      {isFuture ? (
        <p role="status" className="rounded-xl bg-elevated px-3 py-2 text-xs text-muted-foreground">
          Future days are view-only. Come back on this date to log meals.
        </p>
      ) : null}

      {dayQuery.isLoading ? (
        <div className="grid grid-cols-2 gap-2" aria-label="Loading daily nutrition">
          {Array.from({ length: 4 }, (_, index) => (
            <div key={index} className="h-24 animate-pulse rounded-2xl bg-card" />
          ))}
        </div>
      ) : dayQuery.error ? (
        <DataError
          message={userFacingError(dayQuery.error, "load this nutrition day")}
          onRetry={() => void dayQuery.refetch()}
        />
      ) : (
        <>
          <div className="grid grid-cols-2 gap-2">
            <MacroCard label="Calories" unit="kcal" value={summary.calories} />
            <MacroCard label="Protein" unit="g" value={summary.protein} />
            <MacroCard label="Carbs" unit="g" value={summary.carbs} />
            <MacroCard label="Fat" unit="g" value={summary.fat} />
          </div>
          <p className="text-center text-[11px] text-muted-foreground">
            {dayQuery.data?.day
              ? "Targets were saved with this nutrition day."
              : "Current targets will be saved when you add the first entry."}
          </p>
        </>
      )}

      {error ? (
        <div role="alert" className="rounded-xl border border-danger/30 bg-danger/5 p-3">
          <p className="text-sm text-danger">{error}</p>
          {failedPreset ? (
            <div className="mt-2 flex gap-2">
              <Button
                variant="outline"
                className="min-h-11 rounded-xl"
                disabled={!!pending}
                onClick={() => void logPreset(failedPreset.presetId, failedPreset.requestId)}
              >
                Retry same log
              </Button>
              <Button
                variant="ghost"
                className="min-h-11 rounded-xl"
                disabled={!!pending}
                onClick={() => {
                  setFailedPreset(null);
                  setError(null);
                }}
              >
                Dismiss
              </Button>
            </div>
          ) : null}
        </div>
      ) : null}

      {isFuture ? null : editor ? (
        <NutritionEntryEditor
          editor={editor}
          disabled={pending === "entry:save"}
          onChange={(draft) => setEditor((value) => (value ? { ...value, draft } : value))}
          onCancel={closeEditor}
          onSave={() => void saveEntry()}
        />
      ) : (
        <Button
          variant="outline"
          className="min-h-11 w-full rounded-xl"
          onClick={() => {
            const draft = emptyNutritionEntryDraft();
            setEditor({
              entry: null,
              draft,
              initial: draftSignature(draft),
              requestId: crypto.randomUUID(),
            });
          }}
        >
          <Plus /> Add Custom Entry
        </Button>
      )}

      {!isFuture ? (
        <Card className="p-3">
          <h2 className="text-sm font-semibold">Quick add saved meals</h2>
          <p className="mt-0.5 text-xs text-muted-foreground">
            Log to {format(parseISO(selectedDate), "d MMM")}. Each tap creates one meal occurrence.
          </p>
          {presets.isLoading ? (
            <div className="mt-3 h-16 animate-pulse rounded-xl bg-elevated" />
          ) : presets.error ? (
            <div className="mt-3">
              <DataError
                title="Could not load saved meals"
                message={userFacingError(presets.error, "load your saved meals")}
                onRetry={() => void presets.refetch()}
              />
            </div>
          ) : presets.data?.length ? (
            <div className="mt-2 divide-y divide-border">
              {presets.data.map((preset) => (
                <PresetQuickAdd
                  key={preset.id}
                  preset={preset}
                  disabled={!!pending}
                  retry={failedPreset?.presetId === preset.id}
                  loading={pending === `preset:${preset.id}`}
                  onLog={() =>
                    void logPreset(
                      preset.id,
                      failedPreset?.presetId === preset.id ? failedPreset.requestId : undefined,
                    )
                  }
                />
              ))}
            </div>
          ) : (
            <div className="mt-3 rounded-xl bg-elevated p-3">
              <p className="font-semibold">No meal presets yet</p>
              <p className="mt-1 text-sm text-muted-foreground">
                Create meals you eat often so logging them later is fast.
              </p>
              <Button asChild className="mt-3 min-h-11 rounded-xl">
                <Link to="/bulk/meals/presets">Create meal preset</Link>
              </Button>
            </div>
          )}
        </Card>
      ) : null}

      <div>
        <h2 className="text-sm font-semibold">Entries</h2>
        {entries.length === 0 ? (
          <Card className="mt-2 py-7 text-center">
            <p className="font-semibold">Nothing logged for this day</p>
            <p className="mt-1 text-sm text-muted-foreground">
              Add a saved meal or a one-off entry when you are ready.
            </p>
          </Card>
        ) : (
          <div className="mt-2 space-y-2">
            {entries.map((entry) => (
              <NutritionEntryCard
                key={entry.id}
                entry={entry}
                disabled={!!pending || isFuture}
                readOnly={isFuture}
                deleting={pending === `delete:${entry.id}`}
                onEdit={() => {
                  const draft = nutritionEntryDraft(entry);
                  setEditor({
                    entry,
                    draft,
                    initial: draftSignature(draft),
                    requestId: crypto.randomUUID(),
                  });
                }}
                onDelete={() => void removeEntry(entry)}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function DateNavigation({
  selectedDate,
  today,
  onChange,
}: {
  selectedDate: string;
  today: string;
  onChange: (date: string) => void;
}) {
  const move = (amount: number) => onChange(iso(addDays(parseISO(selectedDate), amount)));
  return (
    <div className="card-surface flex items-center gap-2 p-2">
      <button
        type="button"
        aria-label="Previous day"
        className="grid min-h-11 min-w-11 place-items-center rounded-xl active:bg-elevated"
        onClick={() => move(-1)}
      >
        <ChevronLeft />
      </button>
      <label className="min-w-0 flex-1 text-center text-xs text-muted-foreground">
        Nutrition date
        <Input
          type="date"
          className="mt-1 min-h-11 text-center text-base font-semibold"
          value={selectedDate}
          onChange={(event) => onChange(event.target.value)}
        />
      </label>
      <button
        type="button"
        aria-label="Next day"
        className="grid min-h-11 min-w-11 place-items-center rounded-xl active:bg-elevated"
        onClick={() => move(1)}
      >
        <ChevronRight />
      </button>
      {selectedDate !== today ? (
        <Button variant="ghost" className="min-h-11 px-2" onClick={() => onChange(today)}>
          Today
        </Button>
      ) : null}
    </div>
  );
}

function MacroCard({
  label,
  unit,
  value,
}: {
  label: string;
  unit: string;
  value: NutritionMacroStatus;
}) {
  const percent = value.target > 0 ? Math.min(100, (value.consumed / value.target) * 100) : 0;
  const amount = (number: number) => number.toLocaleString(undefined, { maximumFractionDigits: 2 });
  return (
    <div className="card-surface p-3">
      <p className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
        {label}
      </p>
      <p className="num mt-1 text-lg font-semibold">
        {amount(value.consumed)}{" "}
        <span className="text-xs font-normal text-muted-foreground">
          / {amount(value.target)} {unit}
        </span>
      </p>
      <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-secondary">
        <div className="h-full rounded-full bg-primary" style={{ width: `${percent}%` }} />
      </div>
      <p className="mt-1 text-[11px] text-muted-foreground">
        {value.status === "at"
          ? "Target reached"
          : `${amount(value.delta)} ${unit} ${value.status === "over" ? "over" : "remaining"}`}
      </p>
    </div>
  );
}

function PresetQuickAdd({
  preset,
  disabled,
  retry,
  loading,
  onLog,
}: {
  preset: BulkMealPreset;
  disabled: boolean;
  retry: boolean;
  loading: boolean;
  onLog: () => void;
}) {
  return (
    <div className="flex items-center justify-between gap-3 py-2">
      <div className="min-w-0">
        <p className="truncate text-sm font-medium">{preset.name}</p>
        <p className="num text-xs text-muted-foreground">
          {preset.calories} kcal · P {preset.protein} · C {preset.carbs} · F {preset.fat}
        </p>
      </div>
      <Button className="min-h-11 shrink-0 rounded-xl px-3" disabled={disabled} onClick={onLog}>
        {loading ? <PendingLabel>Logging...</PendingLabel> : retry ? "Retry Log" : "Log Meal"}
      </Button>
    </div>
  );
}

function NutritionEntryCard({
  entry,
  disabled,
  readOnly,
  deleting,
  onEdit,
  onDelete,
}: {
  entry: BulkNutritionEntry;
  disabled: boolean;
  readOnly: boolean;
  deleting: boolean;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const ingredients = entry.ingredients
    .map((item) => `${item.quantity} ${item.unit} ${item.name}`)
    .join(", ");
  return (
    <Card className="p-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="font-semibold">{entry.name}</p>
          <p className="num mt-1 text-xs text-muted-foreground">
            {entry.calories} kcal · P {entry.protein} · C {entry.carbs} · F {entry.fat}
          </p>
          {ingredients ? (
            <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">{ingredients}</p>
          ) : null}
          {entry.note ? <p className="mt-1 text-xs">{entry.note}</p> : null}
          <p className="mt-1 text-[10px] uppercase tracking-wider text-muted-foreground">
            {entry.sourceType === "preset" ? "Saved meal snapshot" : "Custom entry"}
          </p>
        </div>
        {!readOnly ? (
          <div className="flex">
            <button
              type="button"
              aria-label={`Edit ${entry.name}`}
              className="grid min-h-11 min-w-11 place-items-center rounded-xl text-muted-foreground active:bg-elevated disabled:opacity-40"
              disabled={disabled}
              onClick={onEdit}
            >
              <Pencil className="h-4 w-4" />
            </button>
            <button
              type="button"
              aria-label={`Delete ${entry.name}`}
              className="grid min-h-11 min-w-11 place-items-center rounded-xl text-danger active:bg-elevated disabled:opacity-40"
              disabled={disabled}
              onClick={onDelete}
            >
              {deleting ? <PendingLabel>Deleting...</PendingLabel> : <Trash2 className="h-4 w-4" />}
            </button>
          </div>
        ) : null}
      </div>
    </Card>
  );
}

function NutritionEntryEditor({
  editor,
  disabled,
  onChange,
  onCancel,
  onSave,
}: {
  editor: EntryEditor;
  disabled: boolean;
  onChange: (draft: NutritionEntryDraft) => void;
  onCancel: () => void;
  onSave: () => void;
}) {
  const patch = (value: Partial<NutritionEntryDraft>) => onChange({ ...editor.draft, ...value });
  return (
    <Card className="space-y-3">
      <h2 className="font-semibold">{editor.entry ? "Edit logged entry" : "Add custom entry"}</h2>
      <Field label="Name">
        <Input
          className="mt-1 min-h-11"
          maxLength={100}
          value={editor.draft.name}
          onChange={(event) => patch({ name: event.target.value })}
          placeholder="Protein bar"
        />
      </Field>
      <div className="grid grid-cols-2 gap-3">
        {(["calories", "protein", "carbs", "fat"] as const).map((field) => (
          <Field
            key={field}
            label={
              field === "calories"
                ? "Calories (kcal)"
                : `${field[0]!.toUpperCase()}${field.slice(1)} (g)`
            }
          >
            <Input
              className="num mt-1 min-h-11 text-lg"
              inputMode="decimal"
              value={editor.draft[field]}
              onChange={(event) => patch({ [field]: event.target.value })}
              placeholder="0"
            />
          </Field>
        ))}
      </div>
      <Field label="Note" hint="Optional">
        <Textarea
          className="mt-1"
          maxLength={240}
          value={editor.draft.note}
          onChange={(event) => patch({ note: event.target.value })}
        />
      </Field>
      <div className="grid grid-cols-2 gap-2">
        <Button
          variant="outline"
          className="min-h-11 rounded-xl"
          disabled={disabled}
          onClick={onCancel}
        >
          Cancel
        </Button>
        <Button className="min-h-11 rounded-xl" disabled={disabled} onClick={onSave}>
          {disabled ? <PendingLabel>Saving...</PendingLabel> : "Save entry"}
        </Button>
      </div>
    </Card>
  );
}
