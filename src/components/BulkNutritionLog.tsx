import { NativeSelect } from "@/components/ui/native-select";
import { useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate } from "@tanstack/react-router";
import { addDays, format, parseISO } from "date-fns";
import { ChevronDown, ChevronLeft, ChevronRight, Pencil, Plus, Trash2 } from "lucide-react";
import { useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Card, DataError, Field, PendingLabel } from "@/components/ui-kit";
import type { BulkMealPreset } from "@/lib/bulk-meal-presets";
import {
  createBulkMealPreset,
  bulkMealPresetsQueryKey,
  useBulkMealPresets,
} from "@/lib/bulk-meal-presets-query";
import {
  emptyNutritionEntryDraft,
  isIsoLocalDay,
  nutritionEntryDraft,
  nutritionSummary,
  nutritionMacroStatus,
  validateNutritionEntryDraft,
  type BulkNutritionEntry,
  type NutritionEntryDraft,
  type NutritionMacros,
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
  mode = "overview",
  legacyTotals,
}: {
  bulkProfileId: string;
  selectedDate: string;
  currentTargets: NutritionMacros;
  onDateChange: (date: string) => void;
  mode?: "overview" | "add";
  legacyTotals?: NutritionMacros | undefined;
}) {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const mutationBusy = useRef(false);
  const savedQuickPreset = useRef<string | null>(null);
  const selectedPreset = useRef<string | null>(null);
  const [saveQuick, setSaveQuick] = useState(false);
  const dayQuery = useBulkNutritionDay(bulkProfileId, selectedDate);
  const presets = useBulkMealPresets(bulkProfileId);
  const [pending, setPending] = useState<string | null>(null);
  const [failedPreset, setFailedPreset] = useState<FailedPresetLog | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [editor, setEditor] = useState<EntryEditor | null>(() => {
    if (mode !== "add") return null;
    const draft = emptyNutritionEntryDraft();
    return { entry: null, draft, initial: draftSignature(draft), requestId: crypto.randomUUID() };
  });
  const today = iso(new Date());
  const isFuture = selectedDate > today;

  const invalidate = () =>
    Promise.all([
      queryClient.invalidateQueries({
        queryKey: bulkNutritionDayQueryKey(bulkProfileId, selectedDate),
      }),
      queryClient.invalidateQueries({ queryKey: ["bulk-progress-summary"] }),
      queryClient.invalidateQueries({ queryKey: ["bulk-weekly-recommendation", bulkProfileId] }),
      queryClient.invalidateQueries({ queryKey: ["goal-settings-dashboard", bulkProfileId] }),
    ]);

  const entries = dayQuery.data?.entries ?? EMPTY_ENTRIES;
  const targets = dayQuery.data?.day?.targets ?? currentTargets;
  const legacyOnly = !dayQuery.data?.day && legacyTotals != null;
  const summary = useMemo(() => {
    if (!legacyOnly || !legacyTotals) return nutritionSummary(entries, targets);
    return {
      totals: legacyTotals,
      calories: nutritionMacroStatus(legacyTotals.calories, targets.calories),
      protein: nutritionMacroStatus(legacyTotals.protein, targets.protein),
      carbs: nutritionMacroStatus(legacyTotals.carbs, targets.carbs),
      fat: nutritionMacroStatus(legacyTotals.fat, targets.fat),
    };
  }, [entries, targets, legacyOnly, legacyTotals]);

  const changeDate = (date: string) => {
    if (mutationBusy.current || !isIsoLocalDay(date)) return;
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
    if (mutationBusy.current || isFuture) return;
    mutationBusy.current = true;
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
      mutationBusy.current = false;
      setPending(null);
    }
  };

  const saveEntry = async () => {
    if (!editor || mutationBusy.current || isFuture) return;
    const result = validateNutritionEntryDraft(editor.draft);
    if (!result.input) {
      setError(result.errors[0] ?? "Check the entry and try again.");
      return;
    }
    mutationBusy.current = true;
    setPending("entry:save");
    setError(null);
    try {
      if (editor.entry) await updateBulkNutritionEntry(editor.entry, result.input);
      else if (selectedPreset.current && mode === "add")
        await logBulkMealPreset(selectedPreset.current, selectedDate, editor.requestId);
      else if (saveQuick && mode === "add") {
        // Keep the created preset identity on retry; the meal-log request remains idempotent.
        if (!savedQuickPreset.current)
          savedQuickPreset.current = await createBulkMealPreset({
            ...result.input,
            description: result.input.note,
            ingredients: [],
          });
        await logBulkMealPreset(savedQuickPreset.current, selectedDate, editor.requestId);
        await queryClient.invalidateQueries({ queryKey: bulkMealPresetsQueryKey(bulkProfileId) });
      } else await createBulkNutritionEntry(selectedDate, editor.requestId, result.input);
      await invalidate();
      toast.success(editor.entry ? "Entry updated" : "Entry added");
      setEditor(null);
      if (mode === "add") void navigate({ to: "/bulk/meals", search: { date: selectedDate } });
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : "";
      setError(
        message.includes("another device")
          ? `${message}. Your entered data is still here.`
          : userFacingError(cause, "save this entry", { inputPreserved: true }),
      );
    } finally {
      mutationBusy.current = false;
      setPending(null);
    }
  };

  const removeEntry = async (entry: BulkNutritionEntry) => {
    if (
      mutationBusy.current ||
      isFuture ||
      !window.confirm(`Delete “${entry.name}” from this day?`)
    )
      return;
    mutationBusy.current = true;
    setPending(`delete:${entry.id}`);
    setError(null);
    try {
      await deleteBulkNutritionEntry(entry.id);
      await invalidate();
      toast.success("Entry deleted");
    } catch (cause) {
      setError(userFacingError(cause, "delete this entry"));
    } finally {
      mutationBusy.current = false;
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
      {mode === "overview" ? (
        <DateNavigation selectedDate={selectedDate} today={today} onChange={changeDate} />
      ) : (
        <p className="text-sm text-muted-foreground">
          {format(parseISO(selectedDate), "EEEE d MMM")}
        </p>
      )}
      {isFuture ? (
        <p role="status" className="rounded-xl bg-elevated px-3 py-2 text-xs text-muted-foreground">
          Future days are view-only. Come back on this date to log meals.
        </p>
      ) : null}

      {mode === "overview" ? (
        dayQuery.isLoading ? (
          <div
            className="h-40 motion-safe:animate-pulse rounded-[20px] bg-card"
            aria-label="Loading daily nutrition"
          />
        ) : dayQuery.error ? (
          <DataError
            message={userFacingError(dayQuery.error, "load this nutrition day")}
            onRetry={() => void dayQuery.refetch()}
          />
        ) : (
          <>
            <NutritionOverview summary={summary} />
            {legacyOnly ? (
              <p className="mt-2 text-sm text-muted-foreground">
                Saved daily totals from your earlier log; individual meals were not recorded.
                {selectedDate === today ? (
                  <Link
                    to="/bulk/daily-log"
                    className="ml-1 inline-flex min-h-11 items-center text-primary"
                  >
                    Open daily log
                  </Link>
                ) : null}
              </p>
            ) : null}
          </>
        )
      ) : null}
      {mode === "overview" && !isFuture ? (
        <Link
          to="/bulk/meals/add"
          search={{ date: selectedDate }}
          className="flex h-[52px] items-center justify-center gap-2 rounded-[16px] bg-primary font-semibold text-primary-foreground"
        >
          <Plus className="h-5 w-5" />
          Add meal
        </Link>
      ) : null}
      {mode === "add" && presets.data?.length ? (
        <label className="block text-[13px] text-muted-foreground">
          Use a saved meal
          <NativeSelect
            disabled={!!pending}
            defaultValue=""
            onChange={(event) => {
              const preset = presets.data?.find((p) => p.id === event.target.value);
              if (!preset || !editor) return;
              savedQuickPreset.current = null;
              selectedPreset.current = preset.id;
              setEditor({
                ...editor,
                requestId: crypto.randomUUID(),
                draft: {
                  name: preset.name,
                  calories: String(preset.calories),
                  protein: String(preset.protein),
                  carbs: String(preset.carbs),
                  fat: String(preset.fat),
                  note: "",
                },
              });
            }}
            containerClassName="mt-1.5 w-full"
            className="h-[52px] rounded-[14px] border border-input bg-card px-3 text-base text-foreground"
          >
            <option value="">Choose a saved meal</option>
            {presets.data.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </NativeSelect>
        </label>
      ) : null}

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
          disabled={!!pending}
          onChange={(draft) => {
            savedQuickPreset.current = null;
            selectedPreset.current = null;
            setEditor((value) =>
              value ? { ...value, draft, requestId: crypto.randomUUID() } : value,
            );
          }}
          adding={mode === "add"}
          saveQuick={saveQuick}
          onSaveQuick={setSaveQuick}
          onCancel={closeEditor}
          onSave={() => void saveEntry()}
        />
      ) : null}

      {mode === "overview" && !isFuture ? (
        <div>
          <h2 className="px-1 text-[13px] text-muted-foreground">Quick add</h2>
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
            <div className="mt-2 flex gap-2 overflow-x-auto pb-1">
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
        </div>
      ) : null}

      {mode === "overview" && !dayQuery.isLoading && !dayQuery.error ? (
        <div>
          <h2 className="px-1 text-[13px] text-muted-foreground">
            {selectedDate === today ? "Logged today" : "Logged meals"}
          </h2>
          {entries.length === 0 ? (
            <Card className="mt-2 py-7 text-center">
              <p className="font-semibold">
                {legacyOnly ? "Earlier daily totals preserved" : "Nothing logged for this day"}
              </p>
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
      ) : null}
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
    <div className="flex items-center justify-center gap-2">
      <button
        type="button"
        aria-label="Previous day"
        className="grid min-h-11 min-w-11 place-items-center rounded-xl active:bg-elevated"
        onClick={() => move(-1)}
      >
        <ChevronLeft aria-hidden="true" className="control-chevron" />
      </button>
      <label className="min-w-0 text-center text-xs text-muted-foreground">
        <span className="sr-only">Nutrition date</span>
        <Input
          type="date"
          className="min-h-11 rounded-[14px] text-center text-sm font-medium"
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
        <ChevronRight aria-hidden="true" className="control-chevron" />
      </button>
      {selectedDate !== today ? (
        <Button variant="ghost" className="min-h-11 px-2" onClick={() => onChange(today)}>
          Today
        </Button>
      ) : null}
    </div>
  );
}

function NutritionOverview({ summary }: { summary: ReturnType<typeof nutritionSummary> }) {
  const calories = summary.calories;
  return (
    <div className="card-surface flex flex-col gap-3 p-[18px]">
      <p className="num">
        <span className="text-[40px] font-semibold tracking-tight">
          {calories.delta.toLocaleString()}
        </span>
        <span className="text-[17px] text-muted-foreground">
          {" "}
          kcal {calories.status === "over" ? "over" : "left"} of {calories.target.toLocaleString()}
        </span>
      </p>
      <div className="h-2 overflow-hidden rounded-full bg-secondary">
        <div
          className="h-full rounded-full bg-primary"
          style={{
            width: `${calories.target > 0 ? Math.min(100, (calories.consumed / calories.target) * 100) : 0}%`,
          }}
        />
      </div>
      <div className="num flex flex-wrap justify-between gap-x-2 gap-y-1 text-[13px] text-muted-foreground">
        {(["protein", "carbs", "fat"] as const).map((key) => (
          <span key={key}>
            {key[0]!.toUpperCase()}
            {key.slice(1)}{" "}
            <strong className="font-semibold text-foreground">{summary[key].consumed}</strong>/
            {summary[key].target} g
          </span>
        ))}
      </div>
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
    <button
      type="button"
      disabled={disabled}
      onClick={onLog}
      aria-label={`Log ${preset.name}`}
      className="flex min-h-11 shrink-0 flex-col gap-0.5 rounded-[14px] border border-border bg-card px-[14px] py-2.5 text-left disabled:opacity-60 active:opacity-80"
    >
      <span className="text-sm font-medium">{preset.name}</span>
      <span className="num text-[13px] text-muted-foreground">
        {loading ? (
          <PendingLabel>Logging…</PendingLabel>
        ) : retry ? (
          "Retry log"
        ) : (
          `${preset.calories} kcal`
        )}
      </span>
    </button>
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
    <Card className="p-[14px]">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-[15px] font-medium">{entry.name}</p>
          <p className="num mt-1 text-xs text-muted-foreground">
            {entry.calories} kcal · P {entry.protein} · C {entry.carbs} · F {entry.fat}
          </p>
          {ingredients || entry.note ? (
            <details className="mt-1 text-xs text-muted-foreground">
              <summary className="disclosure-summary min-h-11">
                Meal details
                <ChevronDown
                  className="disclosure-chevron text-muted-foreground"
                  aria-hidden="true"
                />
              </summary>
              {ingredients ? <p>{ingredients}</p> : null}
              {entry.note ? <p>{entry.note}</p> : null}
              <p>{entry.sourceType === "preset" ? "Saved meal snapshot" : "Custom entry"}</p>
            </details>
          ) : null}
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
  adding = false,
  saveQuick = false,
  onSaveQuick,
}: {
  adding?: boolean;
  saveQuick?: boolean;
  onSaveQuick?: (value: boolean) => void;
  editor: EntryEditor;
  disabled: boolean;
  onChange: (draft: NutritionEntryDraft) => void;
  onCancel: () => void;
  onSave: () => void;
}) {
  const patch = (value: Partial<NutritionEntryDraft>) => onChange({ ...editor.draft, ...value });
  return (
    <div className="space-y-[14px]">
      {!adding ? (
        <h2 className="font-semibold">{editor.entry ? "Edit logged entry" : "Add custom entry"}</h2>
      ) : null}
      <Field label="What did you eat?">
        <Input
          className="mt-1 h-[52px] rounded-[14px] bg-card"
          maxLength={100}
          disabled={disabled}
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
              className="num mt-1 h-[52px] rounded-[14px] bg-card text-lg"
              inputMode="decimal"
              disabled={disabled}
              value={editor.draft[field]}
              onChange={(event) => patch({ [field]: event.target.value })}
              placeholder="0"
            />
          </Field>
        ))}
      </div>
      {adding ? (
        <details>
          <summary className="disclosure-summary min-h-11 text-sm text-muted-foreground">
            Note (optional)
            <ChevronDown className="disclosure-chevron text-muted-foreground" aria-hidden="true" />
          </summary>
          <Field label="Note" hint="Optional">
            <Textarea
              className="mt-1"
              maxLength={240}
              disabled={disabled}
              value={editor.draft.note}
              onChange={(event) => patch({ note: event.target.value })}
            />
          </Field>
        </details>
      ) : (
        <Field label="Note" hint="Optional">
          <Textarea
            className="mt-1"
            maxLength={240}
            disabled={disabled}
            value={editor.draft.note}
            onChange={(event) => patch({ note: event.target.value })}
          />
        </Field>
      )}
      {adding ? (
        <label className="flex min-h-11 items-center gap-3 rounded-[16px] bg-card px-4 py-[14px]">
          <span className="flex-1">
            <span className="block text-[15px] font-medium">Save for quick add</span>
            <span className="text-[13px] text-muted-foreground">One tap next time</span>
          </span>
          <input
            type="checkbox"
            role="switch"
            checked={saveQuick}
            disabled={disabled}
            onChange={(event) => onSaveQuick?.(event.target.checked)}
            className="peer sr-only"
          />
          <span
            aria-hidden="true"
            className="relative h-6 w-11 shrink-0 rounded-full bg-secondary peer-checked:bg-primary peer-focus-visible:ring-2 peer-focus-visible:ring-ring [&>span]:peer-checked:translate-x-5"
          >
            <span
              className={`absolute left-0.5 top-0.5 h-5 w-5 rounded-full bg-foreground motion-safe:transition-transform ${saveQuick ? "translate-x-5" : ""}`}
            />
          </span>
        </label>
      ) : null}
      <div className={adding ? "space-y-2" : "grid grid-cols-2 gap-2"}>
        {!adding ? (
          <Button
            variant="outline"
            className="h-[54px] w-full rounded-[16px]"
            disabled={disabled}
            onClick={onCancel}
          >
            Cancel
          </Button>
        ) : null}
        <Button className="h-[54px] w-full rounded-[16px]" disabled={disabled} onClick={onSave}>
          {disabled ? (
            <PendingLabel>Saving...</PendingLabel>
          ) : adding ? (
            "Add to today"
          ) : (
            "Save entry"
          )}
        </Button>
      </div>
    </div>
  );
}
