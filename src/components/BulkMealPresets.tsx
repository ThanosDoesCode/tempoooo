import { useQueryClient } from "@tanstack/react-query";
import { ArrowDown, ArrowUp, Copy, LoaderCircle, Pencil, Plus, Trash2, X } from "lucide-react";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Card, DataError, Field, PendingLabel } from "@/components/ui-kit";
import {
  BULK_MEAL_UNITS,
  bulkMealDraft,
  emptyBulkMealDraft,
  moveDraftIngredient,
  validateBulkMealDraft,
  type BulkMealDraft,
  type BulkMealPreset,
  type BulkMealUnit,
} from "@/lib/bulk-meal-presets";
import {
  bulkMealPresetsQueryKey,
  createBulkMealPreset,
  deleteBulkMealPreset,
  duplicateBulkMealPreset,
  moveBulkMealPreset,
  updateBulkMealPreset,
  useBulkMealPresets,
} from "@/lib/bulk-meal-presets-query";
import { userFacingError } from "@/lib/network-errors";

type EditorState = { meal: BulkMealPreset | null; draft: BulkMealDraft; initial: string };

const draftSignature = (draft: BulkMealDraft) => JSON.stringify(draft);
const numberLabel = (value: number) =>
  value.toLocaleString(undefined, { maximumFractionDigits: 2 });

export function BulkMealPresets({ bulkProfileId }: { bulkProfileId: string }) {
  const queryClient = useQueryClient();
  const meals = useBulkMealPresets(bulkProfileId);
  const [editor, setEditor] = useState<EditorState | null>(null);
  const [pending, setPending] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const invalidate = () =>
    queryClient.invalidateQueries({ queryKey: bulkMealPresetsQueryKey(bulkProfileId) });

  const beginCreate = () => {
    const draft = emptyBulkMealDraft();
    setEditor({ meal: null, draft, initial: draftSignature(draft) });
    setActionError(null);
  };
  const beginEdit = (meal: BulkMealPreset) => {
    const draft = bulkMealDraft(meal);
    setEditor({ meal, draft, initial: draftSignature(draft) });
    setActionError(null);
  };

  const closeEditor = () => {
    if (
      editor &&
      draftSignature(editor.draft) !== editor.initial &&
      !window.confirm("Discard unsaved meal changes?")
    )
      return;
    setEditor(null);
    setActionError(null);
  };

  const save = async () => {
    if (!editor || pending) return;
    const validated = validateBulkMealDraft(editor.draft);
    if (!validated.input) {
      setActionError(validated.errors[0] ?? "Check the meal details and try again.");
      return;
    }
    setPending("save");
    setActionError(null);
    try {
      if (editor.meal) await updateBulkMealPreset(editor.meal, validated.input);
      else await createBulkMealPreset(validated.input);
      await invalidate();
      toast.success(editor.meal ? "Meal updated" : "Meal created");
      setEditor(null);
    } catch (error) {
      const message = error instanceof Error ? error.message : "";
      setActionError(
        message.includes("another device")
          ? `${message}. Your entered data is still here.`
          : userFacingError(error, "save this meal", { inputPreserved: true }),
      );
    } finally {
      setPending(null);
    }
  };

  const act = async (key: string, action: () => Promise<unknown>, success: string) => {
    if (pending) return;
    setPending(key);
    setActionError(null);
    try {
      await action();
      await invalidate();
      toast.success(success);
    } catch (error) {
      setActionError(userFacingError(error, "update your meals"));
    } finally {
      setPending(null);
    }
  };

  if (meals.isLoading) {
    return (
      <div className="space-y-3" aria-label="Loading meal presets">
        <div className="h-28 animate-pulse rounded-2xl bg-card" />
        <div className="h-28 animate-pulse rounded-2xl bg-card" />
      </div>
    );
  }
  if (meals.error) {
    return (
      <DataError
        message={userFacingError(meals.error, "load your meal presets")}
        onRetry={() => void meals.refetch()}
      />
    );
  }

  const rows = meals.data ?? [];
  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-3">
        <p className="text-sm text-muted-foreground">
          Save meals you eat often so logging them later is fast.
        </p>
        {!editor ? (
          <Button className="min-h-11 shrink-0 rounded-xl" onClick={beginCreate}>
            <Plus aria-hidden="true" /> Create Meal
          </Button>
        ) : null}
      </div>

      {actionError ? (
        <div
          role="alert"
          className="rounded-xl border border-danger/30 bg-danger/5 p-3 text-sm text-danger"
        >
          {actionError}
        </div>
      ) : null}

      {editor ? (
        <MealEditor
          state={editor}
          disabled={pending === "save"}
          onChange={(draft) => setEditor((current) => (current ? { ...current, draft } : current))}
          onCancel={closeEditor}
          onSave={() => void save()}
        />
      ) : null}

      {!editor && rows.length === 0 ? (
        <Card className="py-8 text-center">
          <p className="font-semibold">No meal presets yet</p>
          <p className="mx-auto mt-1 max-w-xs text-sm text-muted-foreground">
            Save meals you eat often so logging them later is fast.
          </p>
          <Button className="mt-4 min-h-11 rounded-xl" onClick={beginCreate}>
            Create your first meal
          </Button>
        </Card>
      ) : null}

      {!editor
        ? rows.map((meal, index) => (
            <MealCard
              key={meal.id}
              meal={meal}
              index={index}
              count={rows.length}
              pending={pending}
              onEdit={() => beginEdit(meal)}
              onDuplicate={() =>
                void act(
                  `duplicate:${meal.id}`,
                  () => duplicateBulkMealPreset(meal.id),
                  "Meal duplicated",
                )
              }
              onDelete={() => {
                if (!window.confirm(`Delete “${meal.name}”? This cannot be undone.`)) return;
                void act(`delete:${meal.id}`, () => deleteBulkMealPreset(meal.id), "Meal deleted");
              }}
              onMove={(direction) =>
                void act(
                  `move:${meal.id}`,
                  () => moveBulkMealPreset(meal.id, direction),
                  "Meal order updated",
                )
              }
            />
          ))
        : null}
    </div>
  );
}

function MealCard({
  meal,
  index,
  count,
  pending,
  onEdit,
  onDuplicate,
  onDelete,
  onMove,
}: {
  meal: BulkMealPreset;
  index: number;
  count: number;
  pending: string | null;
  onEdit: () => void;
  onDuplicate: () => void;
  onDelete: () => void;
  onMove: (direction: -1 | 1) => void;
}) {
  const busy = pending?.endsWith(meal.id) ?? false;
  const preview = meal.ingredients
    .slice(0, 3)
    .map((item) => item.name)
    .join(", ");
  return (
    <Card className="p-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="truncate font-semibold">{meal.name}</h2>
          {meal.description ? (
            <p className="mt-0.5 line-clamp-2 text-xs text-muted-foreground">{meal.description}</p>
          ) : null}
          <p className="num mt-2 text-sm font-medium">
            {numberLabel(meal.calories)} kcal
            <span className="text-muted-foreground">
              {` · P ${numberLabel(meal.protein)} · C ${numberLabel(meal.carbs)} · F ${numberLabel(meal.fat)}`}
            </span>
          </p>
          <p className="mt-1 truncate text-xs text-muted-foreground">
            {meal.ingredients.length
              ? `${meal.ingredients.length} ingredient${meal.ingredients.length === 1 ? "" : "s"}: ${preview}`
              : "Macro-only preset"}
          </p>
        </div>
        <div className="flex shrink-0 gap-1">
          <IconButton
            label={`Move ${meal.name} up`}
            disabled={!!pending || index === 0}
            onClick={() => onMove(-1)}
          >
            {pending === `move:${meal.id}` ? (
              <LoaderCircle className="animate-spin" />
            ) : (
              <ArrowUp />
            )}
          </IconButton>
          <IconButton
            label={`Move ${meal.name} down`}
            disabled={!!pending || index === count - 1}
            onClick={() => onMove(1)}
          >
            <ArrowDown />
          </IconButton>
        </div>
      </div>
      <div className="mt-3 grid grid-cols-3 gap-1 border-t border-border pt-2">
        <ActionButton label="Edit" disabled={!!pending} onClick={onEdit}>
          <Pencil />
        </ActionButton>
        <ActionButton
          label={pending === `duplicate:${meal.id}` ? "Copying..." : "Duplicate"}
          disabled={!!pending}
          onClick={onDuplicate}
        >
          <Copy />
        </ActionButton>
        <ActionButton
          label={pending === `delete:${meal.id}` ? "Deleting..." : "Delete"}
          disabled={!!pending}
          danger
          onClick={onDelete}
        >
          <Trash2 />
        </ActionButton>
      </div>
      {busy ? (
        <p aria-live="polite" className="mt-1 text-center text-[11px] text-muted-foreground">
          Updating meal...
        </p>
      ) : null}
    </Card>
  );
}

function ActionButton({
  children,
  label,
  danger,
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { label: string; danger?: boolean }) {
  return (
    <button
      type="button"
      className={`flex min-h-11 items-center justify-center gap-1 rounded-lg text-xs font-medium active:bg-elevated ${danger ? "text-danger" : "text-muted-foreground"}`}
      {...props}
    >
      <span className="[&_svg]:h-3.5 [&_svg]:w-3.5">{children}</span>
      {label}
    </button>
  );
}

function IconButton({
  label,
  children,
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { label: string }) {
  return (
    <button
      type="button"
      aria-label={label}
      className="grid min-h-11 min-w-11 place-items-center rounded-xl text-muted-foreground active:bg-elevated disabled:opacity-30 [&_svg]:h-4 [&_svg]:w-4"
      {...props}
    >
      {children}
    </button>
  );
}

function MealEditor({
  state,
  disabled,
  onChange,
  onCancel,
  onSave,
}: {
  state: EditorState;
  disabled: boolean;
  onChange: (draft: BulkMealDraft) => void;
  onCancel: () => void;
  onSave: () => void;
}) {
  const draft = state.draft;
  const dirty = useMemo(() => draftSignature(draft) !== state.initial, [draft, state.initial]);
  const patch = (value: Partial<BulkMealDraft>) => onChange({ ...draft, ...value });
  const updateIngredient = (index: number, value: Partial<BulkMealDraft["ingredients"][number]>) =>
    patch({
      ingredients: draft.ingredients.map((item, itemIndex) =>
        itemIndex === index ? { ...item, ...value } : item,
      ),
    });

  return (
    <Card className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold">{state.meal ? "Edit meal" : "Create meal"}</h2>
        <IconButton label="Close meal editor" onClick={onCancel}>
          <X />
        </IconButton>
      </div>
      <Field label="Meal name">
        <Input
          className="mt-1 min-h-11"
          maxLength={80}
          value={draft.name}
          onChange={(event) => patch({ name: event.target.value })}
          placeholder="Chicken rice"
        />
      </Field>
      <Field label="Description" hint={`${draft.description.length}/240`}>
        <Textarea
          className="mt-1"
          maxLength={240}
          value={draft.description}
          onChange={(event) => patch({ description: event.target.value })}
          placeholder="Optional preparation or serving note"
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
              value={draft[field]}
              onChange={(event) => patch({ [field]: event.target.value })}
              placeholder="0"
            />
          </Field>
        ))}
      </div>
      <div>
        <div className="flex items-center justify-between gap-2">
          <div>
            <h3 className="text-sm font-semibold">Ingredients</h3>
            <p className="text-xs text-muted-foreground">Optional · up to 30</p>
          </div>
          <Button
            type="button"
            variant="outline"
            className="min-h-11 rounded-xl"
            disabled={disabled || draft.ingredients.length >= 30}
            onClick={() =>
              patch({
                ingredients: [
                  ...draft.ingredients,
                  { key: crypto.randomUUID(), name: "", quantity: "", unit: "g" },
                ],
              })
            }
          >
            <Plus /> Add Ingredient
          </Button>
        </div>
        <div className="mt-3 space-y-3">
          {draft.ingredients.map((ingredient, index) => (
            <div
              key={ingredient.key}
              className="rounded-xl border border-border bg-elevated/40 p-3"
            >
              <div className="grid grid-cols-[minmax(0,1fr)_6rem] gap-2">
                <Field label={`Ingredient ${index + 1}`}>
                  <Input
                    className="mt-1 min-h-11"
                    maxLength={100}
                    value={ingredient.name}
                    onChange={(event) => updateIngredient(index, { name: event.target.value })}
                    placeholder="Salmon"
                  />
                </Field>
                <Field label="Quantity">
                  <Input
                    className="num mt-1 min-h-11"
                    inputMode="decimal"
                    value={ingredient.quantity}
                    onChange={(event) => updateIngredient(index, { quantity: event.target.value })}
                    placeholder="125"
                  />
                </Field>
              </div>
              <div className="mt-2 flex items-end gap-2">
                <label className="min-w-0 flex-1 text-xs font-medium text-muted-foreground">
                  Unit
                  <select
                    className="mt-1 min-h-11 w-full rounded-md border border-input bg-background px-3 text-base text-foreground"
                    value={ingredient.unit}
                    onChange={(event) =>
                      updateIngredient(index, { unit: event.target.value as BulkMealUnit })
                    }
                  >
                    {BULK_MEAL_UNITS.map((unit) => (
                      <option key={unit} value={unit}>
                        {unit}
                      </option>
                    ))}
                  </select>
                </label>
                <IconButton
                  label={`Move ingredient ${index + 1} up`}
                  disabled={index === 0}
                  onClick={() =>
                    patch({ ingredients: moveDraftIngredient(draft.ingredients, index, -1) })
                  }
                >
                  <ArrowUp />
                </IconButton>
                <IconButton
                  label={`Move ingredient ${index + 1} down`}
                  disabled={index === draft.ingredients.length - 1}
                  onClick={() =>
                    patch({ ingredients: moveDraftIngredient(draft.ingredients, index, 1) })
                  }
                >
                  <ArrowDown />
                </IconButton>
                <IconButton
                  label={`Remove ingredient ${index + 1}`}
                  onClick={() =>
                    patch({
                      ingredients: draft.ingredients.filter((_, itemIndex) => itemIndex !== index),
                    })
                  }
                >
                  <Trash2 />
                </IconButton>
              </div>
            </div>
          ))}
        </div>
      </div>
      <div className="grid grid-cols-2 gap-2">
        <Button
          type="button"
          variant="outline"
          className="min-h-11 rounded-xl"
          disabled={disabled}
          onClick={onCancel}
        >
          Cancel
        </Button>
        <Button
          type="button"
          className="min-h-11 rounded-xl"
          disabled={disabled || !dirty}
          onClick={onSave}
        >
          {disabled ? <PendingLabel>Saving...</PendingLabel> : "Save meal"}
        </Button>
      </div>
    </Card>
  );
}
