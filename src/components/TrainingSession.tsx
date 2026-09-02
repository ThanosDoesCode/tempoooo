import { format, parseISO } from "date-fns";
import { useEffect, useRef, useState } from "react";
import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { Card, Note, SectionTitle } from "./ui-kit";
import { DecimalInput } from "./DecimalInput";
import { ExerciseNotes } from "./ExerciseNotes";
import { exerciseHistory, progressionFor, totalReps } from "@/lib/calc";
import {
  EXERCISES,
  exerciseDef,
  type AppData,
  type ExerciseEntry,
  type SplitType,
  type Workout,
} from "@/lib/types";
import {
  bestRecentSet,
  bodyweightMode,
  completeWorkout,
  createWorkout,
  effectiveLoad,
  entryLoadLabel,
  exerciseMetrics,
  isBodyweight,
  metricNumber,
  notesPreview,
  repeatPreviousSet,
  restSecondsRemaining,
  setSessionBodyweight,
  updateExercise,
  volumeMultiplier,
  workoutDuration,
  workoutMetrics,
} from "@/lib/training";
import { cacheWorkoutDraft, clearWorkoutDraft, readWorkoutDraft } from "@/lib/workout-draft";

const inputClass =
  "num mt-1 min-h-11 w-full min-w-0 rounded-xl border border-input bg-elevated px-2 py-2 text-center text-base font-semibold outline-none focus:border-ring";

export function TrainingSession({
  data,
  date,
  cacheKey,
  onSave,
  onSaveSetupNote,
  readOnly = false,
}: {
  data: AppData;
  date: string;
  cacheKey: string;
  onSave: (workout: Workout) => Promise<void>;
  onSaveSetupNote?: (exercise: string, note: string) => Promise<void>;
  readOnly?: boolean;
}) {
  const [restored] = useState(() => (readOnly ? null : readWorkoutDraft(cacheKey, date)));
  const [storedAtOpen] = useState(() => !!restored || !!data.workouts[date]);
  const [workout, setWorkout] = useState<Workout>(
    () => restored ?? data.workouts[date] ?? createWorkout(data, date, "Chest & Back"),
  );
  const current = useRef(workout);
  const revision = useRef(0);
  const failedAttempt = useRef<Workout | null>(null);
  const [sync, setSync] = useState<"saved" | "saving" | "error">(restored ? "error" : "saved");
  const [error, setError] = useState(
    restored ? "Unsynced edits restored on this device. Retry save when connected." : "",
  );
  const [cacheError, setCacheError] = useState(false);
  const [completing, setCompleting] = useState(false);
  const [graphFor, setGraphFor] = useState<string | null>(null);
  const [restKey, setRestKey] = useState(0);
  const [restRunning, setRestRunning] = useState(false);
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const tick = () => setNow(new Date());
    const timer = setInterval(tick, 1000);
    document.addEventListener("visibilitychange", tick);
    return () => {
      clearInterval(timer);
      document.removeEventListener("visibilitychange", tick);
    };
  }, []);

  const persist = async (next: Workout, finishing = false) => {
    if (readOnly) return;
    const version = ++revision.current;
    const cached = finishing ? current.current : next;
    setSync("saving");
    setError("");
    if (!finishing) setCacheError(!cacheWorkoutDraft(cacheKey, next));
    try {
      await onSave(next);
      if (version !== revision.current) return;
      clearWorkoutDraft(cacheKey, cached);
      setSync("saved");
      failedAttempt.current = null;
      setCacheError(false);
      if (finishing) {
        current.current = next;
        setWorkout(next);
        setRestRunning(false);
      }
    } catch (reason) {
      if (version === revision.current) {
        failedAttempt.current = next;
        setSync("error");
        setError(reason instanceof Error ? reason.message : "Could not save this workout.");
      }
    } finally {
      if (finishing) setCompleting(false);
    }
  };
  const change = (next: Workout) => {
    current.current = next;
    setWorkout(next);
    void persist(next);
  };
  const update = (name: string, patch: Partial<ExerciseEntry>) =>
    change(updateExercise(current.current, name, patch));
  const startRest = () => {
    setRestKey((key) => key + 1);
    setRestRunning(true);
  };
  const metrics = workoutMetrics(workout);
  const displayedExercises = storedAtOpen
    ? workout.entries.map(
        (entry) => exerciseDef(entry.exercise) ?? { name: entry.exercise, min: 1, max: 99 },
      )
    : EXERCISES[workout.type];
  const duration = workoutDuration(workout, now);
  const hasContent =
    metrics.workingSets > 0 ||
    !!workout.sessionNote ||
    workout.entries.some((e) => e.weight != null || !!notesPreview(e));
  const complete = () => {
    try {
      const next = completeWorkout(current.current);
      setCompleting(true);
      void persist(next, true);
    } catch (reason) {
      setError((reason as Error).message);
    }
  };

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
        if (event.currentTarget.reportValidity() && !readOnly && !completing) complete();
      }}
    >
      <fieldset disabled={readOnly || completing} className="min-w-0">
        <div className="mb-3 flex flex-wrap gap-1.5">
          {(Object.keys(EXERCISES) as SplitType[]).map((split) => (
            <button
              key={split}
              type="button"
              disabled={hasContent && split !== workout.type}
              onClick={() => {
                const next = createWorkout(data, date, split);
                current.current = next;
                setWorkout(next);
              }}
              className={`min-h-11 rounded-full border px-3 py-2 text-sm font-medium disabled:opacity-40 ${workout.type === split ? "border-primary bg-primary text-primary-foreground" : "border-border bg-elevated text-muted-foreground"}`}
            >
              {split}
            </button>
          ))}
        </div>
        {hasContent ? (
          <p className="mb-2 text-[11px] text-muted-foreground">
            One split per date. Logged sets and notes keep this session’s split.
          </p>
        ) : null}
        {displayedExercises.some((def) => isBodyweight(def.name)) ? (
          <Card className="mb-3">
            <SmallInput
              label="Session bodyweight kg"
              value={
                workout.sessionBodyweight ??
                workout.entries.find((entry) => isBodyweight(entry.exercise))?.bodyweight
              }
              min={0.1}
              onChange={(value) => change(setSessionBodyweight(current.current, value))}
            />
            <p className="mt-2 text-[11px] text-muted-foreground">
              Saved once for this workout and reused by every bodyweight exercise.
            </p>
          </Card>
        ) : null}
        <div
          className="mb-3 flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground"
          aria-live="polite"
        >
          <span>
            {workout.status === "completed"
              ? "Completed"
              : workout.status === "draft"
                ? "Draft"
                : "Historical log"}{" "}
            · {sync === "saving" ? "Saving…" : sync === "error" ? "Unsynced" : "Saved entries"}
          </span>
          <span className="num">
            Duration:{" "}
            {duration == null
              ? "—"
              : `${Math.floor(duration / 60)}:${String(Math.floor(duration % 60)).padStart(2, "0")}`}
          </span>
        </div>
        {error ? (
          <div role="alert" className="mb-3 rounded-xl bg-danger/10 p-3 text-xs text-danger">
            {error}{" "}
            <button
              type="button"
              onClick={() => {
                const retry = failedAttempt.current ?? current.current;
                void persist(retry, retry.status === "completed");
              }}
              className="min-h-11 underline"
            >
              {failedAttempt.current?.status === "completed" ? "Retry completion" : "Retry save"}
            </button>
          </div>
        ) : null}
        {cacheError ? (
          <p role="alert" className="mb-3 text-xs text-danger">
            Device storage is unavailable. Keep this page open until the save succeeds.
          </p>
        ) : null}
        <div className="space-y-3">
          {displayedExercises.map((def) => {
            const entry = workout.entries.find((e) => e.exercise === def.name) ?? {
              exercise: def.name,
              reps: [undefined, undefined, undefined],
            };
            const p = progressionFor(data, entry, date);
            const prev = p.prev;
            const bw = isBodyweight(def.name);
            const stats = exerciseMetrics(entry);
            const best = bestRecentSet(data, def.name, date);
            return (
              <Card key={def.name}>
                <div className="mb-2 flex flex-wrap items-start justify-between gap-2">
                  <div className="min-w-0">
                    <h3 className="text-base font-semibold">{def.name}</h3>
                    <p className="mt-0.5 text-[11px] text-muted-foreground">
                      Target: {def.min} to {def.max} reps
                      {volumeMultiplier(def.name) === 2 ? " · kg per dumbbell" : ""}
                    </p>
                  </div>
                  <span
                    className={`rounded-full px-2 py-1 text-[10px] font-semibold uppercase tracking-wider ${toneCls(p.tone)}`}
                  >
                    {p.label}
                  </span>
                </div>
                {p.explanation ? (
                  <p className="mb-2 text-xs text-muted-foreground">{p.explanation}</p>
                ) : null}
                <p className="mb-2 text-[11px] text-muted-foreground">
                  {prev
                    ? `Previous ${format(parseISO(prev.date), "d MMM")}: ${entryLoadLabel(prev)} | ${prev.reps.map((r) => r ?? "—").join(", ")} (${totalReps(prev.reps)} reps)`
                    : "No previous session"}
                </p>
                {bw ? (
                  <>
                    <div className="mb-2 flex flex-wrap gap-1.5" aria-label="Load mode">
                      {(
                        [
                          ["bodyweight", "BW"],
                          ["added", "BW + weight"],
                          ["assisted", "Assisted"],
                        ] as const
                      ).map(([mode, label]) => (
                        <button
                          key={mode}
                          type="button"
                          onClick={() =>
                            update(def.name, {
                              loadMode: mode,
                              ...(mode === "added" ? { assistance: 0 } : { addedWeight: 0 }),
                              ...(mode === "bodyweight" ? { assistance: 0 } : {}),
                            })
                          }
                          className={`min-h-11 rounded-full border px-3 py-2 text-xs font-semibold ${bodyweightMode(entry) === mode ? "border-primary bg-primary/15 text-primary" : "border-border bg-elevated text-muted-foreground"}`}
                        >
                          {label}
                        </button>
                      ))}
                    </div>
                    {bodyweightMode(entry) === "added" ? (
                      <SmallInput
                        label="Extra weight kg"
                        value={entry.addedWeight ?? 0}
                        onChange={(value) => update(def.name, { addedWeight: value ?? 0 })}
                      />
                    ) : bodyweightMode(entry) === "assisted" ? (
                      <SmallInput
                        label="Assistance kg"
                        value={entry.assistance ?? 0}
                        onChange={(value) => update(def.name, { assistance: value ?? 0 })}
                      />
                    ) : null}
                    <p className="mb-2 text-[11px] text-muted-foreground">
                      {effectiveLoad(entry) == null
                        ? "Enter bodyweight for this session; older weights are never guessed."
                        : `${entryLoadLabel(entry)} · bodyweight saved for this session`}
                      {entry.assistance ? ` · ${metricNumber(entry.assistance)} kg assistance` : ""}
                    </p>
                  </>
                ) : null}
                <div className={`grid ${bw ? "grid-cols-3" : "grid-cols-4"} gap-2`}>
                  {!bw ? (
                    <SmallInput
                      label="kg"
                      value={entry.weight}
                      onChange={(value) => update(def.name, { weight: value })}
                    />
                  ) : null}
                  {[0, 1, 2].map((i) => (
                    <div key={i} className="min-w-0">
                      <SmallInput
                        label={`Set ${i + 1}`}
                        value={entry.reps[i]}
                        integer
                        onChange={(value) => {
                          const savedEntry =
                            current.current.entries.find((e) => e.exercise === def.name) ?? entry;
                          const reps = [...savedEntry.reps];
                          reps[i] = value;
                          update(def.name, { reps });
                          if (value != null && value > 0) startRest();
                        }}
                      />
                      {i > 0 ? (
                        <button
                          type="button"
                          disabled={entry.reps[i - 1] == null || entry.reps[i] != null}
                          onClick={() => {
                            const savedEntry =
                              current.current.entries.find((e) => e.exercise === def.name) ?? entry;
                            const repeated = repeatPreviousSet(savedEntry, i);
                            if (repeated === savedEntry) return;
                            update(def.name, { reps: repeated.reps });
                            startRest();
                          }}
                          className="mt-1 min-h-11 w-full rounded-lg text-[10px] font-semibold text-primary disabled:text-muted-foreground/40"
                        >
                          Same
                        </button>
                      ) : null}
                    </div>
                  ))}
                </div>
                {p.prs.length ? (
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {p.prs.map((pr) => (
                      <span
                        key={pr}
                        className="rounded-full bg-good/15 px-2 py-1 text-[11px] font-semibold text-good"
                      >
                        {pr}
                      </span>
                    ))}
                  </div>
                ) : null}
                {p.hint ? (
                  <p
                    className={`mt-2 rounded-xl px-3 py-2 text-[12px] font-semibold ${p.readyForWeight ? "bg-primary/15 text-primary" : "bg-elevated text-muted-foreground"}`}
                  >
                    {p.readyForWeight ? "⬆ " : ""}
                    {p.hint}
                  </p>
                ) : null}
                <p className="num mt-2 text-[11px] text-muted-foreground">
                  {stats.totalReps} working reps ·{" "}
                  {stats.volume == null ? "—" : metricNumber(stats.volume)} kg volume
                </p>
                <ExerciseNotes
                  entry={entry}
                  onSave={(patch) => update(def.name, patch)}
                  disabled={readOnly || completing}
                />
                {onSaveSetupNote ? (
                  <SetupNote
                    initial={data.targets.exerciseSetupNotes?.[def.name] ?? ""}
                    onSave={(note) => onSaveSetupNote(def.name, note)}
                    disabled={readOnly || completing}
                  />
                ) : null}
                <button
                  type="button"
                  onClick={() => setGraphFor(graphFor === def.name ? null : def.name)}
                  className="mt-1 min-h-11 text-xs font-medium text-primary"
                >
                  {graphFor === def.name ? "Hide history" : "History"}
                </button>
                {graphFor === def.name ? (
                  <div>
                    <p className="text-xs text-muted-foreground">
                      Best set (last 90 days):{" "}
                      <span className="num font-medium text-foreground">
                        {best ? `${entryLoadLabel(best.entry)} × ${best.reps}` : "—"}
                      </span>
                      {best ? ` · ${format(parseISO(best.date), "d MMM")}` : ""}
                    </p>
                    <ExerciseGraph
                      history={exerciseHistory(data, def.name).filter((h) => h.date <= date)}
                    />
                    <div className="mt-3 max-h-64 space-y-3 overflow-y-auto">
                      {exerciseHistory(data, def.name)
                        .filter((h) => h.date <= date)
                        .reverse()
                        .map((h) => (
                          <div key={h.date} className="border-t border-border pt-2 text-xs">
                            <p className="text-muted-foreground">
                              {format(parseISO(h.date), "d MMM yyyy")} · {entryLoadLabel(h.entry)}
                            </p>
                            <p className="num mt-1">
                              {h.entry.reps.map((r) => r ?? "—").join(" / ")} ·{" "}
                              {h.volume == null ? "—" : metricNumber(h.volume)} kg volume
                            </p>
                            {h.entry.noteTags?.includes("Pain/discomfort") ? (
                              <span className="mt-1 inline-block rounded-full bg-danger/15 px-2 py-1 font-semibold text-danger">
                                Pain/discomfort
                              </span>
                            ) : null}
                            {notesPreview(h.entry) ? (
                              <p className="mt-1 whitespace-pre-wrap break-words text-muted-foreground">
                                {notesPreview(h.entry)}
                              </p>
                            ) : null}
                            {h.sessionNote ? (
                              <p className="mt-1 whitespace-pre-wrap break-words text-muted-foreground">
                                Session: {h.sessionNote}
                              </p>
                            ) : null}
                          </div>
                        ))}
                    </div>
                    <p className="mt-2 text-[11px] text-muted-foreground">
                      Open the training date above to edit a historical note.
                    </p>
                  </div>
                ) : null}
              </Card>
            );
          })}
        </div>
        <Card className="mt-3 space-y-3">
          <label className="block text-xs text-muted-foreground">
            Session note (optional)
            <textarea
              defaultValue={workout.sessionNote ?? ""}
              rows={2}
              onBlur={(event) => {
                if (event.target.value !== current.current.sessionNote)
                  change({ ...current.current, sessionNote: event.target.value });
              }}
              className="mt-1 w-full rounded-xl border border-input bg-elevated p-3 text-base outline-none focus:border-ring"
              placeholder="Energy, sleep, short on time…"
            />
          </label>
          <details>
            <summary className="min-h-11 cursor-pointer py-3 text-xs text-muted-foreground">
              Correct workout duration
            </summary>
            <SmallInput
              label="Duration minutes (optional)"
              value={
                workout.durationOverrideSeconds == null
                  ? undefined
                  : workout.durationOverrideSeconds / 60
              }
              onChange={(value) =>
                change({
                  ...current.current,
                  durationOverrideSeconds: value == null ? undefined : Math.round(value * 60),
                })
              }
            />
            <p className="mt-1 text-[11px] text-muted-foreground">
              Leave blank to use the automatic timestamps. Timing starts with your first working set
              and stops on completion.
            </p>
          </details>
          {workout.status === "completed" ? (
            <div>
              <SectionTitle>Workout summary</SectionTitle>
              <p className="num text-sm">
                {metrics.volume == null ? "—" : metricNumber(metrics.volume)} kg volume ·{" "}
                {metrics.workingSets} sets · {metrics.totalReps} reps
              </p>
              {sync !== "saved" ? (
                <p className="mt-1 text-xs text-muted-foreground">
                  Changes are not yet confirmed saved.
                </p>
              ) : null}
            </div>
          ) : null}
          <button
            disabled={completing || metrics.workingSets === 0}
            className="min-h-11 w-full rounded-xl bg-primary px-4 py-3 text-sm font-semibold text-primary-foreground disabled:opacity-50"
          >
            {completing
              ? "Saving…"
              : workout.status === "completed"
                ? "Save completed workout"
                : "Complete workout"}
          </button>
          <p className="text-[11px] text-muted-foreground">
            Sets autosave as a draft. Complete when finished to include this workout in Training
            totals.
          </p>
        </Card>
      </fieldset>
      <div className="mt-4">
        <Note>
          Progression rule: add reps inside the target range first. Once every set hits the top of
          the range, add weight and rebuild reps from the bottom.
        </Note>
      </div>
      <RestTimer
        restartToken={restKey}
        running={restRunning}
        onStart={startRest}
        onStop={() => setRestRunning(false)}
      />
    </form>
  );
}

function SetupNote({
  initial,
  onSave,
  disabled,
}: {
  initial: string;
  onSave: (note: string) => Promise<void>;
  disabled: boolean;
}) {
  const [value, setValue] = useState(initial);
  const [status, setStatus] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const save = async () => {
    setStatus("saving");
    try {
      await onSave(value.trim());
      setStatus("saved");
    } catch {
      setStatus("error");
    }
  };
  return (
    <details className="mt-1">
      <summary className="min-h-11 cursor-pointer py-3 text-xs font-medium text-primary">
        Setup note
      </summary>
      <label className="block text-xs text-muted-foreground">
        Saved for future workouts
        <input
          value={value}
          disabled={disabled || status === "saving"}
          onChange={(event) => {
            setValue(event.target.value);
            setStatus("idle");
          }}
          placeholder="Seat 4, cable height 7…"
          className="mt-1 min-h-11 w-full rounded-xl border border-input bg-elevated px-3 text-base outline-none focus:border-ring"
        />
      </label>
      <button
        type="button"
        disabled={disabled || status === "saving"}
        onClick={() => void save()}
        className="mt-2 min-h-11 rounded-xl border border-border px-3 text-xs font-semibold text-primary disabled:opacity-50"
      >
        {status === "saving" ? "Saving setup…" : status === "saved" ? "Setup saved" : "Save setup"}
      </button>
      {status === "error" ? (
        <p role="alert" className="mt-1 text-xs text-danger">
          Setup note was not saved. Try again.
        </p>
      ) : null}
    </details>
  );
}

const toneCls = (tone: string) =>
  tone === "good"
    ? "bg-good/15 text-good"
    : tone === "warn"
      ? "bg-warn/15 text-warn"
      : tone === "danger"
        ? "bg-danger/15 text-danger"
        : "bg-secondary text-muted-foreground";

function SmallInput({
  label,
  value,
  onChange,
  integer = false,
  min = 0,
}: {
  label: string;
  value: number | undefined;
  onChange: (value: number | undefined) => void;
  integer?: boolean;
  min?: number;
}) {
  return (
    <label className="block min-w-0">
      <span className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</span>
      <DecimalInput
        value={value}
        onChange={onChange}
        integer={integer}
        min={min}
        className={inputClass}
      />
    </label>
  );
}

function RestTimer({
  restartToken,
  running,
  onStart,
  onStop,
}: {
  restartToken: number;
  running: boolean;
  onStart: () => void;
  onStop: () => void;
}) {
  const [deadline, setDeadline] = useState<number | null>(null);
  const [left, setLeft] = useState(120);
  const [typing, setTyping] = useState(false);
  useEffect(() => {
    const focus = () =>
      setTyping(
        document.activeElement instanceof HTMLInputElement ||
          document.activeElement instanceof HTMLTextAreaElement,
      );
    document.addEventListener("focusin", focus);
    document.addEventListener("focusout", focus);
    focus();
    return () => {
      document.removeEventListener("focusin", focus);
      document.removeEventListener("focusout", focus);
    };
  }, []);
  useEffect(() => {
    if (!running) {
      setDeadline(null);
      return;
    }
    setDeadline(Date.now() + 120_000);
  }, [restartToken, running]);
  useEffect(() => {
    if (!running || deadline == null) return;
    const tick = () => setLeft(restSecondsRemaining(deadline));
    tick();
    const timer = setInterval(tick, 1000);
    document.addEventListener("visibilitychange", tick);
    return () => {
      clearInterval(timer);
      document.removeEventListener("visibilitychange", tick);
    };
  }, [deadline, running]);
  return (
    <div
      className={`pointer-events-none fixed inset-x-0 bottom-20 z-20 flex justify-center px-4 ${typing ? "invisible" : ""}`}
    >
      <div className="pointer-events-auto flex items-center gap-3 rounded-full border border-border bg-card/95 px-4 py-1 shadow-lg backdrop-blur">
        <span className="text-[11px] uppercase tracking-wider text-muted-foreground">Rest</span>
        <span className={`num text-lg font-semibold ${left === 0 ? "text-good" : ""}`}>
          {Math.floor(left / 60)}:{String(left % 60).padStart(2, "0")}
        </span>
        <button
          type="button"
          onClick={running ? onStop : onStart}
          className="min-h-11 text-xs font-medium text-primary"
        >
          {running ? "Stop" : "Start 2:00"}
        </button>
      </div>
    </div>
  );
}

function ExerciseGraph({ history }: { history: ReturnType<typeof exerciseHistory> }) {
  if (history.length < 2)
    return (
      <p className="mt-3 text-xs text-muted-foreground">
        Log at least two sessions to see a trend.
      </p>
    );
  return (
    <div className="mt-3 h-40">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={history} margin={{ top: 8, right: 8, left: -20, bottom: 0 }}>
          <CartesianGrid stroke="var(--color-border)" vertical={false} />
          <XAxis
            dataKey="date"
            tickFormatter={(d: string) => format(parseISO(d), "d MMM")}
            tick={{ fontSize: 10, fill: "var(--color-muted-foreground)" }}
            axisLine={false}
            tickLine={false}
          />
          <YAxis
            tick={{ fontSize: 10, fill: "var(--color-muted-foreground)" }}
            axisLine={false}
            tickLine={false}
          />
          <Tooltip
            contentStyle={{
              background: "var(--color-card)",
              border: "1px solid var(--color-border)",
              borderRadius: 12,
              fontSize: 12,
            }}
          />
          <Line
            type="monotone"
            dataKey="weight"
            stroke="var(--color-chart-1)"
            strokeWidth={2}
            dot={false}
            name="Load kg (effective for bodyweight)"
          />
          <Line
            type="monotone"
            dataKey="bestReps"
            stroke="var(--color-chart-2)"
            strokeWidth={2}
            dot={false}
            name="Best reps"
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
