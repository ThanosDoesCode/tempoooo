import { createFileRoute } from "@tanstack/react-router";
import { addDays, endOfMonth, format, parseISO, startOfMonth } from "date-fns";
import { useMemo, useState } from "react";
import { AppShell, PageHeader } from "@/components/AppShell";
import { Card, Chip, SectionTitle } from "@/components/ui-kit";
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
  sum,
  weekStartOf,
} from "@/lib/calc";
import { useActions, useAppData, useBulkMeta } from "@/lib/store";
import { bulkPlanModeFor, useMemberships } from "@/lib/bulk-access";
import { useCompletedSessionDates } from "@/lib/bulk-training-sessions";
import { useActiveTrainingPlan } from "@/lib/training-plans-query";
import {
  collectCompletedWorkouts,
  countWorkoutsInRange,
  formatWorkoutProgress,
  goalWeightStatus,
  legacyDayWeights,
  resolveWeeklyWorkoutTarget,
  type CompletedWorkoutRecord,
  type GoalStatus,
} from "@/lib/goal-metrics";
import { useBulkWeights } from "@/lib/bulk-progress-query";
import { PublicWeeklyReview } from "@/components/PublicBulkProgress";
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
  const [copied, setCopied] = useState(false);

  const weekStart = useMemo(() => addDays(weekStartOf(new Date()), weekOffset * 7), [weekOffset]);
  const { bulkId } = useBulkMeta();
  const memberships = useMemberships();
  const publicId = bulkPlanModeFor(memberships.data, bulkId) === "public" ? bulkId : null;
  const sessions = useCompletedSessionDates(publicId, "2000-01-01", "2999-12-31");
  const activePlan = useActiveTrainingPlan(publicId);
  const publicWeights = useBulkWeights(publicId, "2000-01-01");
  // Same weight source and rules as Goal Today, so the badge never disagrees.
  const statusWeights = useMemo(
    () => (publicId ? (publicWeights.data ?? []) : data ? legacyDayWeights(data.days) : []),
    [publicId, publicWeights.data, data],
  );
  const workoutRecords = useMemo(
    () =>
      collectCompletedWorkouts({
        sessions: sessions.data ?? [],
        legacyWorkouts: data?.workouts ?? null,
        legacyDays: data?.days ?? null,
      }),
    [sessions.data, data?.workouts, data?.days],
  );

  if (!data) {
    return (
      <AppShell>
        <div className="h-40 animate-pulse rounded-2xl bg-card" />
      </AppShell>
    );
  }

  const statusAt = (end: Date): GoalStatus => {
    const todayIso = iso(new Date());
    const endIso = iso(end);
    return goalWeightStatus({
      weights: statusWeights,
      today: endIso < todayIso ? endIso : todayIso,
      goal: data.targets.goal,
      targetWeeklyGainKg: data.targets.targetWeeklyGainKg ?? null,
    });
  };
  const s = {
    ...buildWeekSummary(data, weekStart),
    goalStatus: statusAt(addDays(weekStart, 6)),
    gymSessions: countWorkoutsInRange(workoutRecords, iso(weekStart), iso(addDays(weekStart, 6))),
    gymTarget: resolveWeeklyWorkoutTarget({
      weeklyWorkoutGoal: data.targets.weeklyWorkoutGoal ?? null,
      activePlanDaysPerWeek: activePlan.data?.trainingDaysPerWeek ?? null,
      targetDaysPerWeek: data.targets.trainingDaysPerWeek ?? null,
    }),
  };

  if (share && mode === "monthly") {
    return (
      <ShareMonth
        data={data}
        records={workoutRecords}
        goalStatus={statusAt(endOfMonth(new Date()))}
        onClose={() => setShare(false)}
      />
    );
  }

  const displayedStatus = s.goalStatus;
  const calibrating = displayedStatus.basis === "insufficient";
  // Same 3-weigh-ins-per-week rule the recommendation engine uses (goalWeightStatus).
  const weighInsThisWeek = statusWeights.filter(
    (w) => w.logDate >= iso(weekStart) && w.logDate <= iso(addDays(weekStart, 6)),
  ).length;
  const weighInsNeeded = Math.max(1, 3 - weighInsThisWeek);
  const recommendation = data.targets.goal
    ? {
        headline:
          displayedStatus.label === "ON TRACK" || displayedStatus.label === "ON PACE"
            ? "Keep going"
            : `Adjust: ${displayedStatus.label.toLowerCase()}`,
        detail: displayedStatus.detail,
      }
    : { headline: s.advice.decision, detail: s.advice.detail };

  const copySummary = async () => {
    try {
      await navigator.clipboard.writeText(weeklySummaryText(data, s));
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false);
    }
  };

  return (
    <AppShell>
      <PageHeader
        title="Weekly review"
        subtitle={mode === "weekly" ? s.label : "Monthly summary"}
        backTo="/bulk/progress"
        backLabel="Progress"
      />

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
            <span className="text-xs text-muted-foreground">{s.label}</span>
            <span className="flex gap-1">
              <button
                onClick={() => setWeekOffset((w) => w - 1)}
                aria-label="Previous week"
                className="grid min-h-11 min-w-11 place-items-center rounded-lg text-primary active:bg-elevated"
              >
                ‹
              </button>
              <button
                onClick={() => setWeekOffset((w) => Math.min(0, w + 1))}
                aria-label="Next week"
                className="grid min-h-11 min-w-11 place-items-center rounded-lg text-primary active:bg-elevated disabled:opacity-30"
                disabled={weekOffset >= 0}
              >
                ›
              </button>
            </span>
          </div>

          {calibrating ? (
            <div className="rounded-[20px] bg-primary/10 p-[18px]">
              <div className="text-[13px] font-semibold text-primary">Weekly review</div>
              <div className="mt-1.5 text-[18px] font-semibold">
                {weighInsNeeded} more weigh-in{weighInsNeeded === 1 ? "" : "s"} to unlock your
                weekly review
              </div>
              <div className="mt-1.5 text-sm text-muted-foreground">{displayedStatus.detail}</div>
            </div>
          ) : (
            <div className="rounded-[20px] bg-primary/10 p-[18px]">
              <div className="text-[13px] font-semibold text-primary">What to do next week</div>
              <div className="mt-1.5 text-[22px] font-semibold">{recommendation.headline}</div>
              <div className="mt-1.5 text-sm leading-relaxed">{recommendation.detail}</div>
            </div>
          )}

          <div className="mt-3 space-y-3">
            <ThreeUp
              title="Body"
              items={[
                [fmt(s.currentAvg, 1, " kg"), "Average"],
                [signed(s.change, 1, " kg"), "Change"],
                [fmt(s.waist, 0, " cm"), "Waist"],
              ]}
            />
            <ThreeUp
              title="Food"
              items={[
                [fmt0(s.avgCalories), "kcal a day"],
                [`${s.daysOnTarget} of 7`, "Days on target"],
                [fmt0(s.avgProtein, " g"), "Protein a day"],
              ]}
            />
            <ThreeUp
              title="Training"
              items={[
                [formatWorkoutProgress(s.gymSessions, s.gymTarget), "Workouts"],
                [String(s.prs.length), "New records"],
                [String(s.regressed), "Went down"],
              ]}
            />
            <ThreeUp
              title="Activity and sleep"
              items={[
                [fmt0(s.avgSteps), "Steps a day"],
                [`${s.runningKm.toFixed(0)} km`, `Run · ${s.cyclingKm.toFixed(0)} km ride`],
                [fmt(s.avgSleep, 1, " h"), `Sleep · ${fmt0(s.avgSleepQuality)} of 5`],
              ]}
            />
          </div>

          {publicId && weekOffset === 0 ? (
            <div className="mt-3">
              <PublicWeeklyReview bulkProfileId={publicId} targets={data.targets} />
            </div>
          ) : null}

          <div className="mt-3">
            <Card>
              <SectionTitle>Notes</SectionTitle>
              <WeekNoteInput
                key={iso(weekStart)}
                initial={s.note}
                onSave={(note) => setWeekNote(iso(weekStart), note)}
              />
            </Card>
          </div>

          <button
            onClick={() => void copySummary()}
            className="mt-4 flex min-h-12 w-full items-center justify-center rounded-[14px] bg-elevated text-[15px] font-semibold text-foreground active:opacity-90"
          >
            {copied ? "Copied" : "Copy summary for ChatGPT"}
          </button>
        </>
      ) : (
        <>
          <MonthlyPreview
            data={data}
            records={workoutRecords}
            goalStatus={statusAt(endOfMonth(new Date()))}
          />
          <button
            onClick={() => setShare(true)}
            className="mt-5 w-full rounded-xl bg-primary py-3.5 text-base font-semibold text-primary-foreground transition-transform active:scale-[0.98]"
          >
            Generate ChatGPT Monthly Summary
          </button>
        </>
      )}
    </AppShell>
  );
}

function ThreeUp({ title, items }: { title: string; items: [string, string][] }) {
  return (
    <Card>
      <h2 className="mb-2 text-[13px] font-medium text-muted-foreground">{title}</h2>
      <div className="num grid grid-cols-3 gap-2">
        {items.map(([value, label]) => (
          <div key={label}>
            <div className="text-[19px] font-semibold">{value}</div>
            <div className="mt-0.5 text-[12px] text-muted-foreground">{label}</div>
          </div>
        ))}
      </div>
    </Card>
  );
}

/** Plain-text weekly summary for the clipboard ("Copy summary for ChatGPT"). */
function weeklySummaryText(
  data: AppData,
  s: ReturnType<typeof buildWeekSummary> & { gymTarget: number | null; goalStatus: GoalStatus },
): string {
  const recommendation = data.targets.goal ? s.goalStatus.detail : s.advice.decision;
  return [
    `Tempo weekly review · ${s.label}`,
    `Recommendation: ${recommendation}`,
    "",
    `Body: avg ${fmt(s.currentAvg, 1, " kg")}, change ${signed(s.change, 1, " kg")}, waist ${fmt(s.waist, 0, " cm")}`,
    `Food: ${fmt0(s.avgCalories)} kcal/day, ${s.daysOnTarget} of 7 days on target, protein ${fmt0(s.avgProtein, " g")}`,
    `Training: ${formatWorkoutProgress(s.gymSessions, s.gymTarget)} workouts, ${s.prs.length} new records, ${s.regressed} went down`,
    `Activity and sleep: ${fmt0(s.avgSteps)} steps/day, run ${s.runningKm.toFixed(0)} km, ride ${s.cyclingKm.toFixed(0)} km, sleep ${fmt(s.avgSleep, 1, " h")} (${fmt0(s.avgSleepQuality)} of 5)`,
    s.note ? `\nNotes: ${s.note}` : "",
  ]
    .join("\n")
    .trim();
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

const toneText = (t: string) =>
  t === "good"
    ? "text-good"
    : t === "warn"
      ? "text-warn"
      : t === "danger"
        ? "text-danger"
        : "text-foreground";

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
          <h1 className="text-center text-[17px] font-semibold tracking-[0.2em] text-primary">
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
    <p className="pt-1 text-[11px] font-semibold tracking-[0.18em] text-primary">{children}</p>
  );
}

function monthlyStats(
  data: AppData,
  month: Date,
  records: CompletedWorkoutRecord[],
  goalStatus: GoalStatus,
) {
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
    gymSessions: countWorkoutsInRange(records, iso(start), iso(end)),
    progressed: prog.progressed,
    regressed: prog.regressed,
    running: sum(days.map((d) => d.runningKm ?? 0)),
    cycling: sum(days.map((d) => d.cyclingKm ?? 0)),
    avgSleep: mean(days.map((d) => d.sleepHours).filter((v): v is number => v != null)),
    photos: data.photos.filter((p) => {
      const dt = parseISO(p.date);
      return dt >= start && dt <= end;
    }),
    status: goalStatus,
    overall: data.targets.goal
      ? goalOverall(goalStatus)
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

function goalOverall(status: GoalStatus) {
  const icon =
    status.tone === "good"
      ? "🟢"
      : status.tone === "danger"
        ? "🔴"
        : status.tone === "muted"
          ? "⚪"
          : "🟡";
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

function MonthlyPreview({
  data,
  records,
  goalStatus,
}: {
  data: AppData;
  records: CompletedWorkoutRecord[];
  goalStatus: GoalStatus;
}) {
  const m = monthlyStats(data, new Date(), records, goalStatus);
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

function ShareMonth({
  data,
  records,
  goalStatus,
  onClose,
}: {
  data: AppData;
  records: CompletedWorkoutRecord[];
  goalStatus: GoalStatus;
  onClose: () => void;
}) {
  const m = monthlyStats(data, new Date(), records, goalStatus);
  const publicGoal = !!data.targets.goal;
  const decision =
    m.status.basis === "insufficient"
      ? "Keep logging weigh-ins"
      : m.status.label === "ON TRACK" || m.status.label === "ON PACE"
        ? "Keep calories unchanged"
        : "Review calories";

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
                    loading="lazy"
                    decoding="async"
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
