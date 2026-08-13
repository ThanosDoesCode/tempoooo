import { createFileRoute } from "@tanstack/react-router";
import { format, parseISO } from "date-fns";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { AppShell, PageHeader } from "@/components/AppShell";
import { Card, Chip, Note, SectionTitle } from "@/components/ui-kit";
import { exerciseHistory, iso, progressionFor, totalReps } from "@/lib/calc";
import { useActions, useAppData } from "@/lib/store";
import { EXERCISES, type ExerciseEntry, type SplitType } from "@/lib/types";

export const Route = createFileRoute("/training")({
  head: () => ({
    meta: [
      { title: "Training — Lean Bulk Tracker" },
      {
        name: "description",
        content: "Log sets, reps and weights with last session's numbers side by side.",
      },
      { property: "og:title", content: "Training — Lean Bulk Tracker" },
      {
        property: "og:description",
        content: "Exercise logging with progression status and strength history graphs.",
      },
    ],
  }),
  component: TrainingPage,
});

const SPLITS: SplitType[] = ["Chest & Back", "Legs", "Arms & Shoulders"];

function TrainingPage() {
  const data = useAppData();
  const { saveWorkout } = useActions();
  const today = iso(new Date());
  const existing = data?.workouts[today];
  const [split, setSplit] = useState<SplitType>(existing?.type ?? "Chest & Back");
  const [graphFor, setGraphFor] = useState<string | null>(null);
  const [restKey, setRestKey] = useState(0);
  const [restRunning, setRestRunning] = useState(false);

  const entries: ExerciseEntry[] = useMemo(() => {
    const base = EXERCISES[split].map<ExerciseEntry>((def) => ({
      exercise: def.name,
      reps: [undefined, undefined, undefined],
    }));
    if (existing?.type !== split) return base;
    return base.map((b) => existing.entries.find((e) => e.exercise === b.exercise) ?? b);
  }, [split, existing]);

  if (!data) {
    return (
      <AppShell>
        <div className="h-40 animate-pulse rounded-2xl bg-card" />
      </AppShell>
    );
  }

  const update = (exercise: string, patch: Partial<ExerciseEntry>) => {
    const next = entries.map((e) => (e.exercise === exercise ? { ...e, ...patch } : e));
    saveWorkout({ date: today, type: split, entries: next });
  };

  const startRest = () => {
    setRestKey((k) => k + 1);
    setRestRunning(true);
  };

  return (
    <AppShell>
      <PageHeader title="Training" subtitle={format(new Date(), "EEEE, d MMMM")} />

      <div className="mb-4 flex flex-wrap gap-1.5">
        {SPLITS.map((s) => (
          <Chip key={s} active={split === s} onClick={() => setSplit(s)}>
            {s}
          </Chip>
        ))}
      </div>

      <div className="space-y-3">
        {EXERCISES[split].map((def) => {
          const entry = entries.find((e) => e.exercise === def.name) as ExerciseEntry;
          const p = progressionFor(data, entry, today);
          const prev = p.prev;
          return (
            <Card key={def.name}>
              <div className="mb-2 flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <h3 className="truncate text-base font-semibold">{def.name}</h3>
                  <p className="mt-0.5 text-[11px] text-muted-foreground">
                    Target: {def.min} to {def.max} reps
                  </p>
                </div>
                <span
                  className={`shrink-0 rounded-full px-2 py-1 text-[10px] font-semibold uppercase tracking-wider ${toneCls(p.tone)}`}
                >
                  {p.label}
                </span>
              </div>

              <p className="mb-2 text-[11px] text-muted-foreground">
                {prev
                  ? `Previous ${format(parseISO(prev.date), "d MMM")}: ${prev.weight ?? "—"} kg | ${prev.reps
                      .map((r) => r ?? "—")
                      .join(", ")} (${totalReps(prev.reps)} reps)`
                  : "No previous session"}
              </p>

              <div className="grid grid-cols-4 gap-2">
                <SmallInput
                  label="kg"
                  value={entry.weight}
                  onChange={(v) => update(def.name, { weight: v })}
                />
                {[0, 1, 2].map((i) => (
                  <SmallInput
                    key={i}
                    label={`Set ${i + 1}`}
                    value={entry.reps[i]}
                    step="1"
                    onChange={(v) => {
                      const reps = [...entry.reps];
                      reps[i] = v;
                      update(def.name, { reps });
                      if (v != null) startRest();
                    }}
                  />
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
                  className={`mt-2 rounded-xl px-3 py-2 text-[12px] font-semibold ${
                    p.readyForWeight ? "bg-primary/15 text-primary" : "bg-elevated text-muted-foreground"
                  }`}
                >
                  {p.readyForWeight ? "⬆ " : ""}
                  {p.hint}
                </p>
              ) : null}

              <input
                value={entry.notes ?? ""}
                onChange={(e) => update(def.name, { notes: e.target.value })}
                placeholder="Notes (form, RPE, tempo)"
                className="mt-2 w-full rounded-xl border border-input bg-elevated px-3 py-2 text-sm outline-none focus:border-ring"
              />

              <button
                onClick={() => setGraphFor(graphFor === def.name ? null : def.name)}
                className="mt-2 text-xs font-medium text-primary"
              >
                {graphFor === def.name ? "Hide history" : "History"}
              </button>

              {graphFor === def.name ? (
                <ExerciseGraph history={exerciseHistory(data, def.name)} />
              ) : null}
            </Card>
          );
        })}
      </div>

      <div className="mt-4">
        <Note>
          Progression rule: add reps inside the target range first. Once every set hits the top of
          the range, add weight and rebuild reps from the bottom.
        </Note>
      </div>

      <RestTimer
        key={restKey}
        running={restRunning}
        onStart={startRest}
        onStop={() => setRestRunning(false)}
      />
    </AppShell>
  );
}

const toneCls = (t: string) =>
  t === "good"
    ? "bg-good/15 text-good"
    : t === "warn"
      ? "bg-warn/15 text-warn"
      : t === "danger"
        ? "bg-danger/15 text-danger"
        : "bg-secondary text-muted-foreground";

function RestTimer({
  running,
  onStart,
  onStop,
}: {
  running: boolean;
  onStart: () => void;
  onStop: () => void;
}) {
  const [left, setLeft] = useState(120);
  const ref = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    if (!running) return;
    setLeft(120);
    ref.current = setInterval(() => {
      setLeft((l) => {
        if (l <= 1) {
          if (ref.current) clearInterval(ref.current);
          return 0;
        }
        return l - 1;
      });
    }, 1000);
    return () => {
      if (ref.current) clearInterval(ref.current);
    };
  }, [running]);

  const mm = Math.floor(left / 60);
  const ss = String(left % 60).padStart(2, "0");

  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-20 z-20 flex justify-center px-4">
      <div className="pointer-events-auto flex items-center gap-3 rounded-full border border-border bg-card/95 px-4 py-2 shadow-lg backdrop-blur">
        <span className="text-[11px] uppercase tracking-wider text-muted-foreground">Rest</span>
        <span className={`num text-lg font-semibold ${left === 0 ? "text-good" : ""}`}>
          {mm}:{ss}
        </span>
        <button onClick={running ? onStop : onStart} className="text-xs font-medium text-primary">
          {running ? "Stop" : "Start 2:00"}
        </button>
      </div>
    </div>
  );
}

function SmallInput({
  label,
  value,
  onChange,
  step = "0.5",
}: {
  label: string;
  value: number | undefined;
  onChange: (v: number | undefined) => void;
  step?: string;
}) {
  return (
    <label className="block">
      <span className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</span>
      <input
        type="number"
        inputMode="decimal"
        step={step}
        value={value ?? ""}
        onChange={(e) => onChange(e.target.value === "" ? undefined : Number(e.target.value))}
        className="num mt-1 w-full rounded-xl border border-input bg-elevated px-2 py-2 text-center text-lg font-semibold outline-none focus:border-ring"
      />
    </label>
  );
}

function ExerciseGraph({
  history,
}: {
  history: { date: string; weight: number; bestReps: number; volume: number }[];
}) {
  if (history.length < 2) {
    return (
      <p className="mt-3 text-xs text-muted-foreground">
        Log at least two sessions to see a trend.
      </p>
    );
  }
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
          <YAxis tick={{ fontSize: 10, fill: "var(--color-muted-foreground)" }} axisLine={false} tickLine={false} />
          <Tooltip
            contentStyle={{
              background: "var(--color-card)",
              border: "1px solid var(--color-border)",
              borderRadius: 12,
              fontSize: 12,
            }}
          />
          <Line type="monotone" dataKey="weight" stroke="var(--color-chart-1)" strokeWidth={2} dot={false} name="Weight kg" />
          <Line type="monotone" dataKey="bestReps" stroke="var(--color-chart-2)" strokeWidth={2} dot={false} name="Best reps" />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
