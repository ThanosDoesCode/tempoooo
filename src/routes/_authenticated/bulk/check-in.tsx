import { createFileRoute } from "@tanstack/react-router";
import { addDays, endOfMonth, format, parseISO, startOfMonth } from "date-fns";
import { useMemo, useState } from "react";
import { AppShell, PageHeader } from "@/components/AppShell";
import { Card, Chip, SectionTitle, Stat } from "@/components/ui-kit";
import { ALL_EXERCISES } from "@/lib/types";
import {
  bulkStatus,
  strengthChange,
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

export const Route = createFileRoute("/_authenticated/bulk/check-in")({
  head: () => ({
    meta: [
      { title: "Tempo" },
      {
        name: "description",
        content:
          "Weekly and monthly Goal progress summaries built for a single clean screenshot to share with ChatGPT.",
      },
      { property: "og:title", content: "Tempo" },
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

  const weekStart = useMemo(() => addDays(weekStartOf(new Date()), weekOffset * 7), [weekOffset]);

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

  const displayedStatus = data.targets.goal ? bulkStatus(data, addDays(s.weekStart, 6)) : s.status;
  const tone = displayedStatus.tone === "muted" ? "muted" : displayedStatus.tone;

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
            <button
              onClick={() => setWeekOffset((w) => w - 1)}
              className="min-h-11 rounded-lg px-2 text-sm text-primary active:bg-elevated"
            >
              ← Prev
            </button>
            <span className="text-xs text-muted-foreground">{s.label}</span>
            <button
              onClick={() => setWeekOffset((w) => Math.min(0, w + 1))}
              className="min-h-11 rounded-lg px-2 text-sm text-primary active:bg-elevated disabled:opacity-30"
              disabled={weekOffset >= 0}
            >
              Next →
            </button>
          </div>

          <div className={`card-surface fade-up mb-4 p-4 text-center ${toneBg(tone)}`}>
            <p className="text-[11px] uppercase tracking-[0.18em] text-muted-foreground">
              Weekly weight change
            </p>
            <p className={`num mt-1 text-5xl font-semibold ${toneText(tone)}`}>
              {signed(s.change, 2)}
            </p>
            <p className={`mt-1 text-sm font-semibold tracking-wide ${toneText(tone)}`}>
              {displayedStatus.label}
            </p>
          </div>

          <div className="mb-4">
            <Card>
              <SectionTitle>{data.targets.goal ? "Goal phase" : "Decision"}</SectionTitle>
              {data.targets.goal ? (
                <>
                  <p className={`text-base font-semibold ${toneText(displayedStatus.tone)}`}>
                    {data.targets.goal === "cut"
                      ? "Lose fat"
                      : data.targets.goal === "maintain"
                        ? "Recomp / maintain"
                        : "Gain muscle"}
                  </p>
                  <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                    Goal-aware calorie guidance is based on completed weeks and appears in Progress.
                  </p>
                </>
              ) : (
                <>
                  <p className={`text-base font-semibold ${toneText(s.advice.tone)}`}>
                    {s.advice.decision}
                  </p>
                  <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                    {s.advice.detail}
                  </p>
                  {s.focus.length ? (
                    <>
                      <p className="mt-3 text-[10px] uppercase tracking-wider text-muted-foreground">
                        Focus next week
                      </p>
                      <ul className="mt-1 space-y-0.5 text-sm">
                        {s.focus.map((f) => (
                          <li key={f}>· {f}</li>
                        ))}
                      </ul>
                    </>
                  ) : null}
                </>
              )}
            </Card>
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
              <WeekNoteInput
                key={iso(weekStart)}
                initial={s.note}
                onSave={(note) => setWeekNote(iso(weekStart), note)}
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

function WeekNoteInput({
  initial,
  onSave,
}: {
  initial: string;
  onSave: (note: string) => Promise<void>;
}) {
  const [value, setValue] = useState(initial);
  const [status, setStatus] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const save = async () => {
    setStatus("saving");
    try {
      await onSave(value);
      setStatus("saved");
    } catch {
      setStatus("error");
    }
  };
  return (
    <div>
      <textarea
        value={value}
        onChange={(event) => {
          setValue(event.target.value);
          setStatus("idle");
        }}
        onBlur={() => void save()}
        rows={3}
        placeholder="Anything unusual this week? Sick, missed gym, ate out, travelled, cycled to university 5 days, poor sleep, very sore."
        className="w-full resize-none rounded-xl border border-input bg-elevated px-3 py-2.5 text-sm outline-none focus:border-ring"
      />
      <p
        role={status === "error" ? "alert" : "status"}
        className={`mt-1 text-[11px] ${status === "error" ? "text-danger" : "text-muted-foreground"}`}
      >
        {status === "saving"
          ? "Saving note…"
          : status === "saved"
            ? "Note saved"
            : status === "error"
              ? "Note was not saved. Tap outside to retry."
              : "Saved when you leave the field"}
      </p>
    </div>
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
  t === "good"
    ? "text-good"
    : t === "warn"
      ? "text-warn"
      : t === "danger"
        ? "text-danger"
        : "text-foreground";

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

function ShareHead({ children }: { children: React.ReactNode }) {
  return (
    <p className="pt-1 text-[11px] font-semibold uppercase tracking-[0.18em] text-primary">
      {children}
    </p>
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
  const displayedStatus = data.targets.goal ? bulkStatus(data, addDays(s.weekStart, 6)) : s.status;
  const targetChange = data.targets.targetWeeklyGainKg ?? 0.25;
  const onGoal = (change: number) =>
    data.targets.goal === "cut"
      ? change >= -targetChange - 0.15 && change <= -targetChange + 0.15
      : data.targets.goal === "maintain"
        ? Math.abs(change) <= 0.15
        : change >= 0.2 && change <= 0.3;
  return (
    <ShareWrap
      title={data.targets.goal ? "Tempo Goal Check-In" : "Tempo Bulk Check-In"}
      subtitle={s.label}
      onClose={onClose}
    >
      <div className="pb-2">
        <ShareHead>Weight</ShareHead>
        <ShareLine
          label="Weekly change"
          value={signed(s.change, 2, " kg/week")}
          mark={trend(s.change, onGoal)}
        />
        <ShareLine label="7-day avg" value={fmt(s.currentAvg, 2, " kg")} />
        <ShareLine label="Current weight" value={fmt(latest?.weight, 1, " kg")} />
        <ShareLine label="Waist (4 weeks)" value={signed(s.waist4w, 1, " cm")} />
        <p className={`mt-1 text-[15px] font-semibold ${toneText(displayedStatus.tone)}`}>
          {displayedStatus.label}
        </p>
      </div>
      <div className="py-2">
        <ShareHead>Nutrition</ShareHead>
        <ShareLine label="Average" value={fmt0(s.avgCalories, " kcal")} />
        <ShareLine label="Days within target" value={`${s.daysOnTarget}/7`} />
        <ShareLine
          label="Protein / carbs / fat"
          value={`${fmt0(s.avgProtein)} / ${fmt0(s.avgCarbs)} / ${fmt0(s.avgFat)} g`}
        />
      </div>
      <div className="py-2">
        <ShareHead>Training</ShareHead>
        <ShareLine label="Sessions" value={`${s.gymSessions}/5`} />
        <ShareLine label="Progressed" value={String(s.progressed)} />
        <ShareLine label="Unchanged" value={String(s.same)} />
        <ShareLine label="Regressed" value={String(s.regressed)} />
        <ShareLine label="PRs" value={s.prs.length ? String(s.prs.length) : "0"} />
      </div>
      <div className="py-2">
        <ShareHead>Recovery</ShareHead>
        <ShareLine label="Average sleep" value={fmt(s.avgSleep, 1, " hours")} />
        <ShareLine label="Steps/day" value={fmt0(s.avgSteps)} />
        <ShareLine label="Resting HR" value={fmt0(s.avgRestingHr, " bpm")} />
        <ShareLine
          label="Cycling / running"
          value={`${s.cyclingKm.toFixed(1)} / ${s.runningKm.toFixed(1)} km`}
        />
      </div>
      {data.targets.goal ? (
        <div className="py-2">
          <ShareHead>Goal phase</ShareHead>
          <p className={`mt-1 text-[17px] font-semibold ${toneText(displayedStatus.tone)}`}>
            {data.targets.goal === "cut"
              ? "Lose fat"
              : data.targets.goal === "maintain"
                ? "Recomp / maintain"
                : "Gain muscle"}
          </p>
          <p className="mt-1 text-[13px] leading-snug text-muted-foreground">
            Use the completed-week recommendation in Progress for goal-aware calorie guidance.
          </p>
        </div>
      ) : (
        <>
          <div className="py-2">
            <ShareHead>Decision</ShareHead>
            <p className={`mt-1 text-[17px] font-semibold ${toneText(s.advice.tone)}`}>
              {s.advice.decision}
            </p>
            <p className="mt-1 text-[13px] leading-snug text-muted-foreground">{s.advice.detail}</p>
          </div>
          <div className="py-2">
            <ShareHead>Focus next week</ShareHead>
            <ul className="mt-1 space-y-0.5 text-[15px]">
              {(s.focus.length ? s.focus : ["Keep logging and repeat the plan"]).map((f) => (
                <li key={f}>· {f}</li>
              ))}
            </ul>
          </div>
        </>
      )}
      {s.note ? (
        <div className="py-2">
          <ShareHead>Notes</ShareHead>
          <p className="mt-1 text-[15px] leading-snug">{s.note}</p>
        </div>
      ) : null}
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
  const workouts = days.map((d) => data.workouts[d.date]).filter(Boolean) as Workout[];
  const prog = progressionCounts(data, workouts);
  const weeks = Math.max(1, Math.round(days.length / 7));
  const gained =
    weights.length > 1 ? (weights[weights.length - 1] as number) - (weights[0] as number) : null;

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
    status: data.targets.goal
      ? bulkStatus(data, end)
      : statusOf(gained == null ? null : gained / weeks),
    overall: data.targets.goal
      ? goalOverall(bulkStatus(data, end))
      : overallStatus(
          gained == null ? null : gained / weeks,
          waists.length > 1 ? (waists[waists.length - 1] as number) - (waists[0] as number) : null,
          prog.progressed,
          prog.regressed,
        ),
    bulk: bulkStatus(data, end),
    strength: ALL_EXERCISES.map((d) => ({ name: d.name, s: strengthChange(data, d.name) })).filter(
      (x) => x.s != null,
    ),
  };
}

function goalOverall(status: ReturnType<typeof bulkStatus>) {
  const icon = status.tone === "good" ? "🟢" : status.tone === "danger" ? "🔴" : "🟡";
  return { icon, text: status.label, tone: status.tone };
}

function overallStatus(
  rate: number | null,
  waist: number | null,
  progressed: number,
  regressed: number,
) {
  if (rate == null) return { icon: "⚪", text: "Not enough data yet", tone: "muted" as const };
  if (rate < 0.15) return { icon: "🔵", text: "Weight gain too slow", tone: "warn" as const };
  if (rate > 0.45 || (rate > 0.35 && (waist ?? 0) > 1.5))
    return { icon: "🔴", text: "Calories likely too high", tone: "danger" as const };
  if (rate > 0.3)
    return {
      icon: "🟡",
      text: "Muscle gain good, but weight gain slightly fast",
      tone: "warn" as const,
    };
  if (progressed >= regressed)
    return { icon: "🟢", text: "Lean bulk progressing well", tone: "good" as const };
  return { icon: "🟡", text: "Weight on target, strength stalling", tone: "warn" as const };
}

function MonthlyPreview({ data }: { data: AppData }) {
  const m = monthlyStats(data, new Date());
  const publicGoal = !!data.targets.goal;
  return (
    <Card>
      <SectionTitle>{m.label}</SectionTitle>
      <p className={`mb-2 text-base font-semibold ${toneText(m.overall.tone)}`}>
        {m.overall.icon} {m.overall.text}
      </p>
      <Rows
        rows={[
          ["Start weight", fmt(m.startWeight, 1, " kg")],
          ["Current 7-day avg", fmt(m.bulk.currentAvg, 2, " kg")],
          [publicGoal ? "Total change" : "Total gained", signed(m.gained, 2, " kg")],
          [publicGoal ? "Avg weekly change" : "Avg weekly gain", signed(m.avgWeeklyGain, 2, " kg")],
          ["Waist change", signed(m.waistChange, 1, " cm")],
          ["Avg calories", fmt0(m.avgCalories, " kcal")],
          ["Gym sessions", String(m.gymSessions)],
          ["Avg sleep", fmt(m.avgSleep, 1, " h")],
          [
            publicGoal ? `Projected ${data.targets.targetWeight} kg` : "Projected 75 kg",
            m.bulk.projectedDate ? format(parseISO(m.bulk.projectedDate), "MMM yyyy") : "—",
          ],
        ]}
      />
    </Card>
  );
}

function ShareMonth({ data, onClose }: { data: AppData; onClose: () => void }) {
  const m = monthlyStats(data, new Date());
  const publicGoal = !!data.targets.goal;
  const decision = m.status.label === "ON TARGET" ? "Keep calories unchanged" : "Review calories";

  return (
    <ShareWrap
      title={data.targets.goal ? "Tempo Goal Monthly" : "Tempo Bulk Monthly"}
      subtitle={m.label}
      onClose={onClose}
    >
      <div className="pb-2">
        <ShareLine label="Start weight" value={fmt(m.startWeight, 1, " kg")} />
        <ShareLine label="End weight" value={fmt(m.endWeight, 1, " kg")} />
        <ShareLine label="Monthly average" value={fmt(m.avgWeight, 2, " kg")} />
        <ShareLine
          label={publicGoal ? "Total change" : "Total gained"}
          value={signed(m.gained, 2, " kg")}
        />
        <ShareLine
          label={publicGoal ? "Avg weekly change" : "Avg weekly gain"}
          value={signed(m.avgWeeklyGain, 2, " kg")}
        />
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
              [p.front, p.side, p.back]
                .filter(Boolean)
                .map((src, i) => (
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
