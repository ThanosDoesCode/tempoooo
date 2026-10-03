import { useState, useRef } from "react";
import { addDays, parseISO } from "date-fns";
import { useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { toast } from "sonner";
import { PendingLabel } from "./ui-kit";
import { checkInDraft, validateCheckIn } from "@/lib/daily-check-in";
import { iso } from "@/lib/calc";
import { useActions } from "@/lib/store";
import { bulkWeightQueryKey, saveBulkWeight } from "@/lib/bulk-progress-query";
import { userFacingError } from "@/lib/network-errors";
import type { DailyLog } from "@/lib/types";

export function DailyCheckIn({
  profileId,
  date,
  day,
  yesterdayDay,
  weight,
  publicGoal,
  weightNote,
}: {
  profileId: string;
  date: string;
  day?: DailyLog | undefined;
  yesterdayDay?: DailyLog | undefined;
  weight?: number | undefined;
  publicGoal: boolean;
  weightNote?: string | null | undefined;
}) {
  const [draft, setDraft] = useState(() => checkInDraft(day, weight, yesterdayDay));
  const [more, setMore] = useState(!!(day?.waist || day?.restingHr));
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const busy = useRef(false);
  const qc = useQueryClient();
  const navigate = useNavigate();
  const { saveDay } = useActions();
  const patch = (value: Partial<typeof draft>) => setDraft((old) => ({ ...old, ...value }));
  const save = async () => {
    if (busy.current) return;
    const result = validateCheckIn(draft);
    if (result.errors.length) {
      setError(result.errors[0]!);
      return;
    }
    busy.current = true;
    setPending(true);
    setError(null);
    try {
      if (publicGoal && result.weight != null)
        await saveBulkWeight(profileId, {
          logDate: date,
          weightKg: result.weight,
          note: weightNote ?? null,
        });
      await saveDay(date, {
        ...result.patch,
        ...(!publicGoal && result.weight != null ? { weight: result.weight } : {}),
      });
      // The screenshot explicitly asks for yesterday's steps; never attach them to today's movement.
      if (result.steps != null)
        await saveDay(iso(addDays(parseISO(date), -1)), { steps: result.steps });
      await Promise.all([
        qc.invalidateQueries({ queryKey: bulkWeightQueryKey(profileId) }),
        qc.invalidateQueries({ queryKey: ["bulk-progress-summary"] }),
        qc.invalidateQueries({ queryKey: ["bulk-weekly-recommendation", profileId] }),
        qc.invalidateQueries({ queryKey: ["bulk-training-session", "active", profileId] }),
        qc.invalidateQueries({ queryKey: ["goal-settings-dashboard", profileId] }),
      ]);
      toast.success("Check-in saved");
      await navigate({ to: "/bulk" });
    } catch (cause) {
      setError(userFacingError(cause, "save your check-in", { inputPreserved: true }));
    } finally {
      busy.current = false;
      setPending(false);
    }
  };
  const field = (
    key: "weight" | "sleep" | "steps" | "waist" | "restingHr",
    label: string,
    unit: string,
  ) => (
    <label className="block text-[13px] text-muted-foreground">
      {label}
      <span className="mt-1.5 flex h-14 items-center gap-2 rounded-[14px] border border-input bg-card px-4">
        <input
          aria-label={label}
          inputMode={key === "steps" || key === "restingHr" ? "numeric" : "decimal"}
          value={draft[key]}
          onChange={(e) => patch({ [key]: e.target.value })}
          disabled={pending}
          className="num min-w-0 flex-1 bg-transparent text-xl font-semibold text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring"
        />
        <span>{unit}</span>
      </span>
    </label>
  );
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3">
        {field("weight", "Weight", "kg")}
        {field("sleep", "Sleep", "hours")}
      </div>
      <fieldset>
        <legend className="mb-1.5 text-[13px] text-muted-foreground">
          How well did you sleep?
        </legend>
        <div className="grid grid-cols-5 gap-1 rounded-[13px] bg-card p-1">
          {[1, 2, 3, 4, 5].map((n) => (
            <label
              key={n}
              className={`grid min-h-11 cursor-pointer place-items-center focus-within:ring-2 focus-within:ring-ring rounded-[10px] text-[15px] ${draft.quality === n ? "bg-primary font-semibold text-primary-foreground" : "text-muted-foreground"}`}
            >
              <input
                type="radio"
                name="sleep-quality"
                value={n}
                checked={draft.quality === n}
                disabled={pending}
                onChange={() => patch({ quality: n })}
                className="sr-only"
              />
              {n}
            </label>
          ))}
        </div>
        <div className="mt-1.5 flex justify-between text-xs text-muted-foreground">
          <span>Poorly</span>
          <span>Great</span>
        </div>
      </fieldset>
      {field("steps", "Steps yesterday (optional)", "")}
      <button
        type="button"
        onClick={() => setMore(!more)}
        aria-expanded={more}
        className="min-h-11 text-[15px] text-primary"
      >
        {more ? "−" : "+"} Waist or resting heart rate
      </button>
      {more ? (
        <div className="grid grid-cols-2 gap-3">
          {field("waist", "Waist (optional)", "cm")}
          {field("restingHr", "Resting HR (optional)", "bpm")}
        </div>
      ) : null}
      {error ? (
        <p role="alert" className="text-sm text-danger">
          {error}
        </p>
      ) : null}
      <button
        type="button"
        disabled={pending}
        aria-busy={pending}
        onClick={() => void save()}
        className="h-[54px] w-full rounded-[16px] bg-primary text-base font-semibold text-primary-foreground disabled:opacity-60"
      >
        {pending ? <PendingLabel>Saving check-in…</PendingLabel> : "Save check-in"}
      </button>
    </div>
  );
}
