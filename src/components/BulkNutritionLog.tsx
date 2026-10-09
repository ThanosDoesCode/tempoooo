import { MealDeleteDialog } from "./MealDeleteDialog";
import { NutritionDateStrip } from "./NutritionDateStrip";
import { NativeSelect } from "@/components/ui/native-select";
import { Drawer, DrawerContent, DrawerTitle } from "@/components/ui/drawer";
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
import { useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate } from "@tanstack/react-router";
import { format, parseISO } from "date-fns";
import { ChevronDown, Pencil, Plus, Trash2 } from "lucide-react";
import { useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { DataError, Field, PendingLabel } from "@/components/ui-kit";
import type { BulkMealPreset } from "@/lib/bulk-meal-presets";
import {
  createBulkMealPreset,
  bulkMealPresetsQueryKey,
  useBulkMealPresets,
} from "@/lib/bulk-meal-presets-query";
import {
  MEAL_CATEGORIES,
  mealCategoryLabel,
  type MealCategory,
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
  initialCategory = null,
}: {
  bulkProfileId: string;
  selectedDate: string;
  currentTargets: NutritionMacros;
  onDateChange: (date: string) => void;
  mode?: "overview" | "add";
  initialCategory?: MealCategory | null;
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
  const quickAddPresets = (presets.data ?? []).filter((preset) => preset.showInQuickAdd);
  const [deleteEntry, setDeleteEntry] = useState<BulkNutritionEntry | null>(null);
  const [pending, setPending] = useState<string | null>(null);
  const [failedPreset, setFailedPreset] = useState<FailedPresetLog | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [editor, setEditor] = useState<EntryEditor | null>(() => {
    if (mode !== "add") return null;
    const draft = { ...emptyNutritionEntryDraft(), mealCategory: initialCategory };
    return { entry: null, draft, initial: draftSignature(draft), requestId: crypto.randomUUID() };
  });
  // When set, the "Discard changes?" dialog is open; a date string is the pending date to switch
  // to on discard, "close" means just close the editor.
  const [discardPending, setDiscardPending] = useState<string | "close" | null>(null);
  const editorDirty = editor != null && draftSignature(editor.draft) !== editor.initial;
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
  const targets = dayQuery.data?.day
    ? dayQuery.data.day.targets
    : (dayQuery.data?.effectiveTargets ?? (selectedDate === today ? currentTargets : null));
  const legacyOnly = !dayQuery.data?.day && legacyTotals != null;
  const summary = useMemo(() => {
    if (!legacyOnly || !legacyTotals) return nutritionSummary(entries, targets);
    return {
      totals: legacyTotals,
      calories: nutritionMacroStatus(legacyTotals.calories, targets?.calories ?? null),
      protein: nutritionMacroStatus(legacyTotals.protein, targets?.protein ?? null),
      carbs: nutritionMacroStatus(legacyTotals.carbs, targets?.carbs ?? null),
      fat: nutritionMacroStatus(legacyTotals.fat, targets?.fat ?? null),
    };
  }, [entries, targets, legacyOnly, legacyTotals]);

  const changeDate = (date: string) => {
    if (mutationBusy.current || !isIsoLocalDay(date)) return;
    if (editorDirty) {
      setDiscardPending(date);
      return;
    }
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
        await logBulkMealPreset(
          selectedPreset.current,
          selectedDate,
          editor.requestId,
          result.input.mealCategory ?? null,
        );
      else if (saveQuick && mode === "add") {
        // Keep the created preset identity on retry; the meal-log request remains idempotent.
        if (!savedQuickPreset.current)
          savedQuickPreset.current = await createBulkMealPreset({
            ...result.input,
            description: result.input.note,
            ingredients: [],
          });
        await logBulkMealPreset(
          savedQuickPreset.current,
          selectedDate,
          editor.requestId,
          result.input.mealCategory ?? null,
        );
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
    if (mutationBusy.current || isFuture) return;
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

  const onEditorDraftChange = (draft: NutritionEntryDraft) => {
    savedQuickPreset.current = null;
    selectedPreset.current = null;
    setEditor((value) => (value ? { ...value, draft, requestId: crypto.randomUUID() } : value));
  };

  // Close request from Cancel, Escape or backdrop: confirm first if there are unsaved edits.
  const requestClose = () => {
    if (editorDirty) setDiscardPending("close");
    else setEditor(null);
  };

  const confirmDiscard = () => {
    const target = discardPending;
    setDiscardPending(null);
    setEditor(null);
    setError(null);
    if (target && target !== "close") {
      setFailedPreset(null);
      onDateChange(target);
    }
  };

  const renderEntry = (entry: BulkNutritionEntry) => (
    <NutritionEntryCard
      key={entry.id}
      entry={entry}
      disabled={!!pending || isFuture}
      readOnly={isFuture}
      deleting={pending === `delete:${entry.id}`}
      onEdit={() => {
        const draft = nutritionEntryDraft(entry);
        setEditor({ entry, draft, initial: draftSignature(draft), requestId: crypto.randomUUID() });
      }}
      onDelete={() => setDeleteEntry(entry)}
    />
  );

  return (
    <div className="min-w-0 space-y-4">
      <MealDeleteDialog
        name={deleteEntry?.name ?? ""}
        open={deleteEntry != null}
        onOpenChange={(open) => {
          if (!open) setDeleteEntry(null);
        }}
        onConfirm={() => {
          if (!deleteEntry) return;
          const entry = deleteEntry;
          setDeleteEntry(null);
          void removeEntry(entry);
        }}
      />
      {mode === "overview" ? (
        <NutritionDateStrip selectedDate={selectedDate} today={today} onChange={changeDate} />
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
              </p>
            ) : null}
          </>
        )
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
                  mealCategory: editor.draft.mealCategory ?? null,
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

      {mode === "add" && !isFuture && editor ? (
        <NutritionEntryEditor
          editor={editor}
          disabled={!!pending}
          onChange={onEditorDraftChange}
          adding
          saveQuick={saveQuick}
          onSaveQuick={setSaveQuick}
          onCancel={requestClose}
          onSave={() => void saveEntry()}
        />
      ) : null}

      {mode === "overview" ? (
        <Drawer
          open={editor != null && !isFuture}
          onOpenChange={(open) => {
            if (!open) requestClose();
          }}
        >
          <DrawerContent className="mt-24 max-h-[88vh] overflow-y-auto rounded-t-[28px] border-0 bg-card px-5 pb-[max(2rem,env(safe-area-inset-bottom))] pt-3 [&>div:first-child]:mt-0 [&>div:first-child]:h-[5px] [&>div:first-child]:w-10 [&>div:first-child]:bg-[oklch(38%_.01_260)]">
            <DrawerTitle className="sr-only">Edit meal</DrawerTitle>
            {editor ? (
              <NutritionEntryEditor
                editor={editor}
                disabled={!!pending}
                onChange={onEditorDraftChange}
                onCancel={requestClose}
                onSave={() => void saveEntry()}
              />
            ) : null}
          </DrawerContent>
        </Drawer>
      ) : null}

      <AlertDialog
        open={discardPending != null}
        onOpenChange={(open) => {
          if (!open) setDiscardPending(null);
        }}
      >
        <AlertDialogContent className="w-[calc(100%-2.5rem)] max-w-sm gap-4 rounded-[20px] border-border bg-card p-5 sm:rounded-[20px] motion-reduce:animate-none">
          <AlertDialogHeader className="space-y-1 text-left">
            <AlertDialogTitle className="text-lg">Discard changes?</AlertDialogTitle>
            <AlertDialogDescription>
              Your meal edits haven&rsquo;t been saved.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter className="grid grid-cols-2 gap-2 sm:space-x-0">
            <AlertDialogCancel className="mt-0 h-12 min-w-0 rounded-xl border-border bg-elevated px-2 text-sm">
              Keep editing
            </AlertDialogCancel>
            <AlertDialogAction
              className="h-12 min-w-0 rounded-xl bg-danger px-2 text-sm text-white hover:bg-danger/90"
              onClick={confirmDiscard}
            >
              Discard
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {mode === "overview" && !isFuture ? (
        <div>
          <div className="flex min-h-11 items-center justify-between gap-3">
            <h2 className="px-1 text-[13px] text-muted-foreground">Quick add</h2>
            <Link
              to="/bulk/meals/presets"
              preload="intent"
              className="inline-flex min-h-11 items-center rounded-lg px-3 text-sm font-medium text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring active:bg-elevated"
            >
              Manage
            </Link>
          </div>
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
          ) : quickAddPresets.length ? (
            <div className="mt-2 flex gap-2 overflow-x-auto pb-1">
              {quickAddPresets.map((preset) => (
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
            <div className="mt-2 flex flex-wrap items-center justify-between gap-3 rounded-xl bg-elevated px-3 py-1">
              <p className="text-sm text-muted-foreground">
                {presets.data?.length ? "No presets in Quick Add" : "No meal presets yet"}
              </p>
              <Link
                to="/bulk/meals/presets"
                preload="intent"
                className="inline-flex min-h-11 shrink-0 items-center rounded-lg px-2 text-sm font-medium text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring active:opacity-80"
              >
                {presets.data?.length ? "Manage presets" : "Create meal preset"}
              </Link>
            </div>
          )}
        </div>
      ) : null}

      {mode === "overview" && !dayQuery.isLoading && !dayQuery.error ? (
        <div className="space-y-3">
          {MEAL_CATEGORIES.map((category) => {
            const meals = entries.filter((entry) => entry.mealCategory === category);
            return (
              <section key={category} className="rounded-[20px] bg-card px-4 py-3">
                <div className="flex min-h-11 flex-wrap items-center justify-between gap-x-3 gap-y-1">
                  <h2 className="text-base font-semibold">{mealCategoryLabel(category)}</h2>
                  {meals.length ? (
                    <span className="num min-w-0 text-[13px] text-muted-foreground [overflow-wrap:anywhere]">
                      {meals.reduce((sum, entry) => sum + entry.calories, 0).toLocaleString()} kcal
                    </span>
                  ) : null}
                </div>
                {meals.map(renderEntry)}
                {!isFuture ? (
                  <Link
                    to="/bulk/meals/add"
                    search={{ date: selectedDate, category }}
                    preload="intent"
                    className="flex min-h-11 items-center gap-2 rounded-xl text-sm font-medium text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring active:bg-elevated"
                  >
                    <Plus className="h-4 w-4" aria-hidden="true" /> Add {category}
                  </Link>
                ) : null}
              </section>
            );
          })}
          {entries.some((entry) => !entry.mealCategory) ? (
            <section className="rounded-[20px] bg-card px-4 py-3">
              <h2 className="py-2 text-base font-semibold">Other logged meals</h2>
              {entries.filter((entry) => !entry.mealCategory).map(renderEntry)}
            </section>
          ) : null}
          {!entries.length && legacyOnly ? (
            <p className="text-sm text-muted-foreground">Earlier daily totals preserved</p>
          ) : null}
        </div>
      ) : null}
      {mode === "overview" && !isFuture ? (
        <Link
          to="/bulk/meals/add"
          search={{ date: selectedDate, category: undefined }}
          className="flex h-[52px] items-center justify-center gap-2 rounded-[16px] bg-primary font-semibold text-primary-foreground"
        >
          <Plus className="h-5 w-5" />
          Add meal
        </Link>
      ) : null}
    </div>
  );
}

function NutritionOverview({ summary }: { summary: ReturnType<typeof nutritionSummary> }) {
  const calories = summary.calories;
  const progress =
    calories.target != null && calories.target > 0
      ? Math.min(100, (calories.consumed / calories.target) * 100)
      : 0;
  return (
    <section className="space-y-3" aria-label="Daily nutrition summary">
      <div className="card-surface flex items-center justify-between gap-3 p-[18px]">
        <div className="min-w-0 flex-1 [overflow-wrap:anywhere]">
          <p className="num text-[28px] min-[360px]:text-[34px] font-semibold tracking-tight">
            {calories.consumed.toLocaleString()}{" "}
            <span className="text-sm font-normal text-muted-foreground">kcal</span>
          </p>
          {calories.target != null ? (
            <>
              <p className="text-sm text-muted-foreground">
                of {calories.target.toLocaleString()} kcal
              </p>
              <p className="num mt-2 text-sm">
                {calories.delta?.toLocaleString()} kcal{" "}
                {calories.status === "over" ? "over target" : "remaining"}
              </p>
            </>
          ) : (
            <p className="mt-1 text-sm text-muted-foreground">Target unavailable for this day</p>
          )}
        </div>
        {calories.target != null ? (
          <svg
            viewBox="0 0 80 80"
            className="h-16 w-16 shrink-0 -rotate-90 min-[360px]:h-20 min-[360px]:w-20"
            role="progressbar"
            aria-label="Calorie target progress"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={progress}
          >
            <circle
              cx="40"
              cy="40"
              r="32"
              fill="none"
              stroke="var(--color-secondary)"
              strokeWidth="6"
            />
            <circle
              cx="40"
              cy="40"
              r="32"
              fill="none"
              stroke="var(--color-primary)"
              strokeWidth="6"
              strokeLinecap="round"
              pathLength="100"
              strokeDasharray={`${progress} 100`}
            />
          </svg>
        ) : null}
      </div>
      <div className="grid grid-cols-3 gap-2">
        {(["protein", "carbs", "fat"] as const).map((key) => (
          <div key={key} className="min-w-0 rounded-[16px] bg-card p-2.5 [overflow-wrap:anywhere]">
            <p className="text-[12px] text-muted-foreground">
              {key[0]!.toUpperCase()}
              {key.slice(1)}
            </p>
            <p className="num mt-1 break-words text-[13px] font-semibold">
              {summary[key].consumed}
              <span className="block text-xs font-normal text-muted-foreground">
                / {summary[key].target ?? "—"} g
              </span>
            </p>
            <div className="mt-2 h-1 overflow-hidden rounded-full bg-secondary">
              <div
                className="h-full rounded-full bg-primary"
                style={{
                  width: `${summary[key].target != null && summary[key].target! > 0 ? Math.min(100, (summary[key].consumed / summary[key].target!) * 100) : 0}%`,
                }}
              />
            </div>
          </div>
        ))}
      </div>
    </section>
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
      className="flex min-h-11 max-w-[min(200px,100%)] shrink-0 flex-col gap-0.5 rounded-[14px] border border-border bg-card px-[14px] py-2.5 text-left disabled:opacity-60 active:opacity-80"
    >
      <span className="line-clamp-2 text-sm font-medium [overflow-wrap:anywhere]">
        {preset.name}
      </span>
      <span className="num text-[13px] text-muted-foreground [overflow-wrap:anywhere]">
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
    <div className="border-t border-border py-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1 [overflow-wrap:anywhere]">
          <p className="break-words text-[15px] font-medium">{entry.name}</p>
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
          <div className="flex shrink-0">
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
    </div>
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
      <label className="block text-sm text-muted-foreground">
        Meal
        <NativeSelect
          value={editor.draft.mealCategory ?? ""}
          disabled={disabled}
          onChange={(event) =>
            patch({ mealCategory: (event.target.value || null) as MealCategory | null })
          }
          containerClassName="mt-1"
          className="min-h-11 rounded-xl bg-card"
        >
          <option value="">Unclassified</option>
          {MEAL_CATEGORIES.map((category) => (
            <option key={category} value={category}>
              {mealCategoryLabel(category)}
            </option>
          ))}
        </NativeSelect>
      </label>
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
          {disabled ? <PendingLabel>Saving...</PendingLabel> : adding ? "Add meal" : "Save entry"}
        </Button>
      </div>
    </div>
  );
}
