import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { DecimalInput } from "./DecimalInput";
import { NOTE_TAGS, notesPreview } from "@/lib/training";
import type { ExerciseEntry } from "@/lib/types";
import { parseDecimal } from "@/lib/numeric";

export function ExerciseNotes({
  entry,
  onSave,
  disabled,
}: {
  entry: ExerciseEntry;
  onSave: (patch: Partial<ExerciseEntry>) => void;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [notes, setNotes] = useState("");
  const [tags, setTags] = useState<string[]>([]);
  const [rpe, setRpe] = useState<number | undefined>();
  const preview = notesPreview(entry);
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (next) {
          setNotes(entry.notes ?? "");
          setTags(entry.noteTags ?? []);
          setRpe(entry.rpe);
        }
        setOpen(next);
      }}
    >
      <DialogTrigger asChild>
        <button
          type="button"
          disabled={disabled}
          aria-label={`Notes for ${entry.exercise}`}
          className="mt-2 min-h-11 w-full min-w-0 truncate rounded-xl border border-input bg-elevated px-3 py-2 text-left text-sm text-muted-foreground"
        >
          {preview || "Notes · form, effort, anything to remember"}
        </button>
      </DialogTrigger>
      <DialogContent
        className="max-h-[85dvh] w-[calc(100%-1.5rem)] overflow-y-auto rounded-2xl p-4 [&>button]:grid [&>button]:min-h-11 [&>button]:min-w-11 [&>button]:place-items-center"
        onOpenAutoFocus={(event) => event.preventDefault()}
      >
        <DialogTitle className="pr-12 text-base">{entry.exercise} notes</DialogTitle>
        <DialogDescription className="text-xs">
          Optional context for this exercise.
        </DialogDescription>
        <form
          className="space-y-4"
          onSubmit={(event) => {
            event.preventDefault();
            event.stopPropagation();
            // Blur commits the raw RPE before submit; read it directly to avoid a stale state closure.
            const field = event.currentTarget.querySelector<HTMLInputElement>("input");
            field?.blur();
            if (!event.currentTarget.reportValidity()) return;
            const effort = parseDecimal(field?.value ?? "");
            onSave({
              notes,
              noteTags: tags,
              rpe: effort.kind === "value" ? effort.value : undefined,
            });
            setOpen(false);
          }}
        >
          <div className="flex flex-wrap gap-2">
            {NOTE_TAGS.map((tag) => (
              <button
                key={tag}
                type="button"
                aria-pressed={tags.includes(tag)}
                onClick={() =>
                  setTags((current) =>
                    current.includes(tag) ? current.filter((t) => t !== tag) : [...current, tag],
                  )
                }
                className={`min-h-11 rounded-full border px-3 py-2 text-xs font-medium ${tags.includes(tag) ? (tag === "Pain/discomfort" ? "border-danger bg-danger/15 text-danger" : "border-primary bg-primary/15 text-primary") : "border-border bg-elevated text-muted-foreground"}`}
              >
                {tag}
              </button>
            ))}
          </div>
          <label className="block text-xs text-muted-foreground">
            RPE (optional, 1–10)
            <DecimalInput
              value={rpe}
              onChange={setRpe}
              min={1}
              max={10}
              className="num mt-1 min-h-11 w-full rounded-xl border border-input bg-elevated px-3 text-base outline-none focus:border-ring"
            />
          </label>
          <label className="block text-xs text-muted-foreground">
            Notes
            <textarea
              rows={4}
              value={notes}
              onChange={(event) => setNotes(event.target.value)}
              className="mt-1 w-full resize-y rounded-xl border border-input bg-elevated p-3 text-base outline-none focus:border-ring"
              placeholder="Form, tempo, how the sets felt…"
            />
          </label>
          <button className="min-h-11 w-full rounded-xl bg-primary px-4 py-3 text-sm font-semibold text-primary-foreground">
            Save notes
          </button>
        </form>
      </DialogContent>
    </Dialog>
  );
}
