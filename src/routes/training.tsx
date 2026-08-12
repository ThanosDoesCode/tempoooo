import { createFileRoute } from "@tanstack/react-router";
import { format, parseISO } from "date-fns";
import { useMemo, useState } from "react";
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
import { exerciseHistory, iso, previousEntry } from "@/lib/calc";
import { useActions, useAppData } from "@/lib/store";
import { EXERCISES, type ExerciseEntry, type WorkoutType } from "@/lib/types";

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

type SplitType = Exclude<WorkoutType, "Rest">;
const SPLITS: SplitType[] = ["Chest & Back", "Legs", "Arms & Shoulders"];

export default function noop() {}

function TrainingPage() {
  const data = useAppData();
  const { saveWorkout } = useActions();
  const today = iso(new Date());
  const existing = data?.workouts[today];
  const [split, setSplit] = useState<SplitType>(existing?.type ?? "Chest & Back");
  const [graphFor, setGraphFor] = useState<string | null>(null);

  const entries: ExerciseEntry[] = useMemo(() => {
    const base = EXERCISES[split].map<ExerciseEntry>((exercise) => ({
      exercise,
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
        {entries.map((entry) => {
          const prev = previousEntry(data, entry.exercise, today);
          const status = compare(entry, prev);
          return (
            <Card key={entry.exercise}>
              <div className="mb-3 flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <h3 className="truncate text-base font-semibold">{entry.exercise}</h3>
                  <p className="mt-0.5 text-[11px] text-muted-foreground">
                    {prev
                      ? `Last ${format(parseISO(prev.date), "d MMM")}: ${prev.weight ?? "—"}kg · ${prev.reps
                          .map((r) => r ?? "—")
                          .join(" / ")}`
                      : "No previous session"}
                  </p>
                </div>
                <span
                  className={`shrink-0 rounded-full px-2 py-1 text-[10px] font-semibold uppercase tracking-wider ${status.cls}`}
                >
                  {status.label}
                </span>
              </div>

              <div className="grid grid-cols-4 gap-2">
                <SmallInput
                  label="kg"
                  value={entry.weight}
                  onChange={(v) => update(entry.exercise, { weight: v })}
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
                      update(entry.exercise, { reps });
                    }}
                  />
                ))}
              </div>

              <input
                value={entry.notes ?? ""}
                onChange={(e) => update(entry.exercise, { notes: e.target.value })}
                placeholder="Notes (form, RPE, tempo)"
                className="mt-2 w-full rounded-xl border border-input bg-elevated px-3 py-2 text-sm outline-none focus:border-ring"
              />

              <button
                onClick={() => setGraphFor(graphFor === entry.exercise ? null : entry.exercise)}
                className="mt-2 text-xs font-medium text-primary"
              >
                {graphFor === entry.exercise ? "Hide history" : "History"}
              </button>

              {graphFor === entry.exercise ? (
                <ExerciseGraph history={exerciseHistory(data, entry.exercise)} />
              ) : null}
            </Card>
          );
        })}
      </div>

      <div className="mt-4">
        <Note>
          Progression rule: increase reps within your target range first. Once you hit the top of the
          range with good form, add weight and start again at the bottom of the range.
        </Note>
      </div>
    </AppShell>
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

function compare(entry: ExerciseEntry, prev: ReturnType<typeof previousEntry>) {
  const s = (w: number | undefined, r: (number | undefined)[]) =>
    (w ?? 1) * r.reduce<number>((a, b) => a + (b ?? 0), 0);
  const logged = entry.weight != null || entry.reps.some((r) => r != null);
  if (!logged) return { label: "Not logged", cls: "bg-secondary text-muted-foreground" };
  if (!prev) return { label: "Baseline", cls: "bg-secondary text-muted-foreground" };
  const cur = s(entry.weight, entry.reps);
  const old = s(prev.weight, prev.reps);
  if ((entry.weight ?? 0) > (prev.weight ?? 0) && cur >= old)
    return { label: "Weight PR", cls: "bg-good/15 text-good" };
  if (cur > old) return { label: "Rep PR", cls: "bg-good/15 text-good" };
  if (cur === old) return { label: "Same", cls: "bg-warn/15 text-warn" };
  return { label: "Down", cls: "bg-danger/15 text-danger" };
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
