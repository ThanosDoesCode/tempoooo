import { createFileRoute } from "@tanstack/react-router";
import { addDays, addMonths, endOfMonth, format, parseISO, startOfMonth } from "date-fns";
import { useMemo, useState } from "react";
import { AppShell, PageHeader } from "@/components/AppShell";
import { Card, Chip, SectionTitle, Stat } from "@/components/ui-kit";
import {
  avg7,
  buildWeekSummary,
  fmt,
  fmt0,
  iso,
  mean,
  progressionCounts,
  signed,
  sortedDays,
  statusOf,
  sum,
  weekStartOf,
} from "@/lib/calc";
import { useActions, useAppData } from "@/lib/store";
import type { AppData, Workout } from "@/lib/types";

export const Route = createFileRoute("/check-in")({
  head: () => ({
    meta: [
      { title: "Check-In — Lean Bulk Tracker" },
      {
        name: "description",
        content:
          "Weekly and monthly lean bulk summaries built for a single clean screenshot to share with ChatGPT.",
      },
      { property: "og:title", content: "Check-In — Lean Bulk Tracker" },
      {
        property: "og:description",
        content: "One screenshot with weight trend, nutrition, training, activity and recovery.",
      },
    ],
  }),
  component: CheckInPage,
});

function CheckInPage() {
  const data = useAppData();
  const { setWeekNote } = useActions();
  const [weekOffset, setWeekOffset] = useState(0);
  const [mode, setMode] = useState<"weekly" | "monthly">("weekly");
  const [share, setShare] = useState(false);

  const weekStart = useMemo(
    () => addDays(weekStartOf(new Date()), weekOffset * 7),
    [weekOffset],
  );

  if (!data) {
    return (
      <AppShell>
        <div className="h-40 animate-pulse rounded-2xl bg-card" />
      </AppShell>
    );
  }

  const s = buildWeekSummary(data, weekStart);

  if (share) {
    return mode === "weekly" ? (
      <ShareWeek data={data} s={s} onClose={() => setShare(false)} />
    ) : (
      <ShareMonth data={data} onClose={() => setShare(false)} />
    );
  }

  const tone = s.status.tone === "muted" ? "muted" : s.status.tone;

  return (
    <AppShell>
      <PageHeader title="Check-In" subtitle={mode === "weekly" ? s.label : "Monthly summary"} />

      <div className="mb-4 flex gap-1.5">
        <Chip active={mode === "weekly"} onClick={() => setMode("weekly")}>
          Weekly
        </Chip>
        <Chip active={mode === "monthly"} onClick={() => setMode("monthly")}>
          Monthly
        </Chip>
      </div>

      {mode === "weekly" ? (
        <>
          <div className="mb-3 flex items-center justify-between">
            <button onClick={() => setWeekOffset((w) => w - 1)} className="text-sm text-primary">
              ← Prev
            </button>
            <span className="text-xs text-muted-foreground">{s.label}</span>
            <button
              onClick={() => setWeekOffset((w) => Math.min(0, w + 1))}
              className="text-sm text-primary disabled:opacity-30"
              disabled={weekOffset >= 0}
            >
              Next →
            </button>
          </div>

          <div className={`card-surface fade-up mb-4 p-4 text-center ${toneBg(tone)}`}>
            <p className="text-[11px] uppercase tracking-[0.18em] text-muted-foreground">
              Weekly weight change
            </p>
            <p className={`num mt-1 text-5xl font-semibold ${toneText(tone)}`}>{signed(s.change, 2)}</p>
            <p className={`mt-1 text-sm font-semibold tracking-wide ${toneText(tone)}`}>
              {s.status.label}
            </p>
            <p className="mt-2 text-[11px] text-muted-foreground">
              Review with ChatGPT before adjusting calorie intake.
            </p>
          </div>

          <Card>
            <SectionTitle>Body</SectionTitle>
            <Rows
              rows={[
                ["Start weight", fmt(s.startWeight, 1, " kg")],
                ["End weight", fmt(s.endWeight, 1, " kg")],
                ["7-day average", fmt(s.currentAvg, 2, " kg")],
                ["Previous 7-day avg", fmt(s.prevAvg, 2, " kg")],
                ["Weekly change", signed(s.change, 2, " kg")],
                ["Waist", fmt(s.waist, 1, " cm")],
                ["Waist change", signed(s.waistChange, 1, " cm")],
              ]}
            />
          </Card>

          <div className="mt-4 grid grid-cols-2 gap-2">
            <Stat label="Avg calories" value={fmt0(s.avgCalories)} hint="kcal/day" />
            <Stat label="Avg protein" value={fmt0(s.avgProtein, " g")} hint="per day" />
            <Stat label="Avg carbs" value={fmt0(s.avgCarbs, " g")} hint="per day" />
            <Stat label="Avg fat" value={fmt0(s.avgFat, " g")} hint="per day" />
          </div>
          <div className="mt-2">
            <Stat label="Days calorie target hit" value={`${s.daysOnTarget}/7`} hint="±150 kcal" />
          </div>

          <div className="mt-4">
            <Card>
              <SectionTitle>Training</SectionTitle>
              <Rows
                rows={[
                  ["Gym sessions", `${s.gymSessions}/5`],
                  ["Progressed", String(s.progressed)],
                  ["Stayed the same", String(s.same)],
                  ["Regressed", String(s.regressed)],
                  ["New PRs", s.prs.length ? s.prs.join(", ") : "None"],
                ]}
              />
            </Card>
          </div>

          <div className="mt-4">
            <Card>
              <SectionTitle>Activity & recovery</SectionTitle>
              <Rows
                rows={[
                  ["Avg steps/day", fmt0(s.avgSteps)],
                  ["Cycling", `${s.cyclingKm.toFixed(1)} km`],
                  ["Running", `${s.runningKm.toFixed(1)} km`],
                  ["Cardio sessions", String(s.cardioSessions)],
                  ["Avg sleep", fmt(s.avgSleep, 1, " h")],
                  ["Avg sleep score", fmt(s.avgSleepQuality, 1, " / 5")],
                ]}
              />
            </Card>
          </div>

          <div className="mt-4">
            <Card>
              <SectionTitle>Notes</SectionTitle>
              <textarea
                value={s.note}
                onChange={(e) => setWeekNote(iso(weekStart), e.target.value)}
                rows={3}
                placeholder="Anything unusual this week? Sick, missed gym, ate out, travelled, cycled to university 5 days, poor sleep, very sore."
                className="w-full resize-none rounded-xl border border-input bg-elevated px-3 py-2.5 text-sm outline-none focus:border-ring"
              />
            </Card>
          </div>
        </>
      ) : (
        <MonthlyPreview data={data} />
      )}

      <button
        onClick={() => setShare(true)}
        className="mt-5 w-full rounded-xl bg-primary py-3.5 text-base font-semibold text-primary-foreground transition-transform active:scale-[0.98]"
      >
        Generate ChatGPT {mode === "weekly" ? "Check-In" : "Monthly Summary"}
      </button>
    </AppShell>
  );
}

function Rows({ rows }: { rows: [string, string][] }) {
  return (
    <div className="divide-y divide-border">
      {rows.map(([k, v]) => (
        <div key={k} className="flex items-center justify-between gap-3 py-2 text-sm">
          <span className="text-muted-foreground">{k}</span>
          <span className="num text-right font-semibold">{v}</span>
        </div>
      ))}
    </div>
  );
}

const toneBg = (t: string) =>
  t === "good" ? "bg-good/10" : t === "warn" ? "bg-warn/10" : t === "danger" ? "bg-danger/10" : "";
const toneText = (t: string) =>
  t === "good" ? "text-good" : t === "warn" ? "text-warn" : t === "danger" ? "text-danger" : "text-foreground";

const trend = (v: number | null, good: (n: number) => boolean) =>
  v == null ? "•" : good(v) ? "▲" : v < 0 ? "▼" : "▲";

/* ---------------- Share modes ---------------- */

function ShareLine({ label, value, mark }: { label: string; value: string; mark?: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3 py-1.5">
      <span className="text-[15px] text-muted-foreground">{label}</span>
      <span className="num text-[17px] font-semibold">
        {value} {mark ? <span className="text-good">{mark}</span> : null}
      </span>
    </div>
  );
}

function ShareWrap({
  title,
  subtitle,
  onClose,
  children,
}: {
  title: string;
  subtitle: string;
  onClose: () => void;
  children: React.ReactNode;
}) {
  return (
    <div className="min-h-screen bg-background px-4 py-6">
      <div className="mx-auto w-full max-w-lg">
        <div className="card-surface fade-up p-5">
          <h1 className="text-center text-[17px] font-semibold uppercase tracking-[0.2em] text-primary">
            {title}
          </h1>
          <p className="mt-1 text-center text-sm text-muted-foreground">{subtitle}</p>
          <div className="mt-4 divide-y divide-border">{children}</div>
        </div>
        <button
          onClick={onClose}
          className="mt-4 w-full rounded-xl border border-border bg-card py-3 text-sm font-medium text-muted-foreground"
        >
          Close
        </button>
      </div>
    </div>
  );
}

function ShareWeek({
  data,
  s,
  onClose,
}: {
  data: AppData;
  s: ReturnType<typeof buildWeekSummary>;
  onClose: () => void;
}) {
  const latest = sortedDays(data)
    .filter((d) => d.weight != null)
    .pop();
  return (
    <ShareWrap title="Lean Bulk Check-In" subtitle={s.label} onClose={onClose}>
      <div className="pb-2">
        <ShareLine label="Current weight" value={fmt(latest?.weight, 1, " kg")} />
        <ShareLine
          label="7-day avg"
          value={fmt(s.currentAvg, 2, " kg")}
          mark={trend(s.change, (n) => n > 0)}
        />
        <ShareLine label="Previous 7-day avg" value={fmt(s.prevAvg, 2, " kg")} />
        <ShareLine label="Weekly change" value={signed(s.change, 2, " kg")} />
        <ShareLine label="Waist" value={fmt(s.waist, 1, " cm")} />
        <ShareLine
          label="Waist change"
          value={signed(s.waistChange, 1, " cm")}
          mark={s.waistChange == null ? "" : s.waistChange <= 0 ? "▼" : "▲"}
        />
      </div>
      <div className="py-2">
        <ShareLine
          label="Avg calories"
          value={fmt0(s.avgCalories, " kcal")}
          mark={s.avgCalories == null ? "" : s.avgCalories >= data.targets.calories ? "▲" : "▼"}
        />
        <ShareLine label="Avg protein" value={fmt0(s.avgProtein, " g")} />
        <ShareLine label="Avg carbs" value={fmt0(s.avgCarbs, " g")} />
        <ShareLine label="Avg fat" value={fmt0(s.avgFat, " g")} />
      </div>
      <div className="py-2">
        <ShareLine
          label="Gym sessions"
          value={`${s.gymSessions} / 5`}
          mark={s.progressed > s.regressed ? "▲" : s.regressed > s.progressed ? "▼" : ""}
        />
        <ShareLine label="Exercises progressed" value={String(s.progressed)} />
        <ShareLine label="PRs" value={s.prs.length ? String(s.prs.length) : "0"} />
      </div>
      <div className="py-2">
        <ShareLine label="Cycling" value={`${s.cyclingKm.toFixed(1)} km`} />
        <ShareLine label="Running" value={`${s.runningKm.toFixed(1)} km`} />
        <ShareLine label="Avg steps" value={fmt0(s.avgSteps)} />
      </div>
      <div className="py-2">
        <ShareLine label="Avg sleep" value={fmt(s.avgSleep, 1, " h")} />
      </div>
      <div className="py-2">
        <p className="text-[15px] text-muted-foreground">Notes</p>
        <p className="mt-1 text-[16px] leading-snug">{s.note || "—"}</p>
      </div>
      <div className="py-2">
        <ShareLine label="Current calorie target" value={`${data.targets.calories} kcal`} />
        <p className={`num mt-2 text-center text-[19px] font-semibold ${toneText(s.status.tone)}`}>
          {s.status.label}
        </p>
        <p className="mt-1 text-center text-[13px] text-muted-foreground">
          Review with ChatGPT before adjusting calorie intake.
        </p>
      </div>
    </ShareWrap>
  );
}

function monthlyStats(data: AppData, month: Date) {
  const start = startOfMonth(month);
  const end = endOfMonth(month);
  const days = sortedDays(data).filter((d) => {
    const dt = parseISO(d.date);
    return dt >= start && dt <= end;
  });
  const weights = days.filter((d) => d.weight != null).map((d) => d.weight as number);
  const waists = days.filter((d) => d.waist != null).map((d) => d.waist as number);
  const workouts = days
    .map((d) => data.workouts[d.date])
    .filter(Boolean) as Workout[];
  const prog = progressionCounts(data, workouts);
  const weeks = Math.max(1, Math.round(days.length / 7));
  const gained = weights.length > 1 ? (weights[weights.length - 1] as number) - (weights[0] as number) : null;

  return {
    label: format(month, "MMMM yyyy"),
    startWeight: weights[0] ?? null,
    endWeight: weights[weights.length - 1] ?? null,
    avgWeight: mean(weights),
    gained,
    avgWeeklyGain: gained == null ? null : gained / weeks,
    waistChange:
      waists.length > 1 ? (waists[waists.length - 1] as number) - (waists[0] as number) : null,
    avgCalories: mean(days.map((d) => d.calories).filter((v): v is number => v != null)),
    avgProtein: mean(days.map((d) => d.protein).filter((v): v is number => v != null)),
    avgFat: mean(days.map((d) => d.fat).filter((v): v is number => v != null)),
    gymSessions: days.filter((d) => d.gym).length,
    progressed: prog.progressed,
    regressed: prog.regressed,
    running: sum(days.map((d) => d.runningKm ?? 0)),
    cycling: sum(days.map((d) => d.cyclingKm ?? 0)),
    avgSleep: mean(days.map((d) => d.sleepHours).filter((v): v is number => v != null)),
    photos: data.photos.filter((p) => {
      const dt = parseISO(p.date);
      return dt >= start && dt <= end;
    }),
    status: statusOf(gained == null ? null : gained / weeks),
  };
}

function MonthlyPreview({ data }: { data: AppData }) {
  const m = monthlyStats(data, new Date());
  return (
    <Card>
      <SectionTitle>{m.label}</SectionTitle>
      <Rows
        rows={[
          ["Start weight", fmt(m.startWeight, 1, " kg")],
          ["End weight", fmt(m.endWeight, 1, " kg")],
          ["Monthly average", fmt(m.avgWeight, 2, " kg")],
          ["Total gained", signed(m.gained, 2, " kg")],
          ["Avg weekly gain", signed(m.avgWeeklyGain, 2, " kg")],
          ["Waist change", signed(m.waistChange, 1, " cm")],
          ["Gym sessions", String(m.gymSessions)],
        ]}
      />
    </Card>
  );
}

function ShareMonth({ data, onClose }: { data: AppData; onClose: () => void }) {
  const m = monthlyStats(data, new Date());
  const decision =
    m.status.label === "ON TARGET" ? "Keep calories unchanged" : "Review calories";
  return (
    <ShareWrap title="Lean Bulk Monthly" subtitle={m.label} onClose={onClose}>
      <div className="pb-2">
        <ShareLine label="Start weight" value={fmt(m.startWeight, 1, " kg")} />
        <ShareLine label="End weight" value={fmt(m.endWeight, 1, " kg")} />
        <ShareLine label="Monthly average" value={fmt(m.avgWeight, 2, " kg")} />
        <ShareLine label="Total gained" value={signed(m.gained, 2, " kg")} />
        <ShareLine label="Avg weekly gain" value={signed(m.avgWeeklyGain, 2, " kg")} />
        <ShareLine label="Waist change" value={signed(m.waistChange, 1, " cm")} />
      </div>
      <div className="py-2">
        <ShareLine label="Avg calories" value={fmt0(m.avgCalories, " kcal")} />
        <ShareLine label="Avg protein" value={fmt0(m.avgProtein, " g")} />
        <ShareLine label="Avg fat" value={fmt0(m.avgFat, " g")} />
      </div>
      <div className="py-2">
        <ShareLine label="Gym sessions" value={String(m.gymSessions)} />
        <ShareLine label="Exercises progressed" value={String(m.progressed)} />
        <ShareLine label="Exercises regressed" value={String(m.regressed)} />
      </div>
      <div className="py-2">
        <ShareLine label="Cycling total" value={`${m.cycling.toFixed(1)} km`} />
        <ShareLine label="Running total" value={`${m.running.toFixed(1)} km`} />
        <ShareLine label="Avg sleep" value={fmt(m.avgSleep, 1, " h")} />
      </div>
      {m.photos.length ? (
        <div className="py-3">
          <div className="flex gap-2">
            {m.photos.flatMap((p) =>
              [p.front, p.side, p.back].filter(Boolean).map((src, i) => (
                <img
                  key={`${p.id}-${i}`}
                  src={src as string}
                  alt="Monthly progress"
                  className="h-24 w-20 rounded-lg object-cover"
                />
              )),
            )}
          </div>
        </div>
      ) : null}
      <div className="py-2">
        <ShareLine label="Current calorie target" value={`${data.targets.calories} kcal`} />
        <p className="mt-2 text-center text-[16px] font-semibold">
          Suggested decision: <span className={toneText(m.status.tone)}>{decision}</span>
        </p>
      </div>
    </ShareWrap>
  );
}

export const _unused = { addMonths, avg7 };
