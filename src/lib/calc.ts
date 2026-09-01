import { addDays, differenceInCalendarDays, format, parseISO, startOfWeek } from "date-fns";
import type { AppData, DailyLog, ExerciseEntry, Workout } from "./types.ts";
import { exerciseDef } from "./types.ts";
import {
  effectiveLoad,
  entryLoadLabel,
  exerciseMetrics,
  isBodyweight,
  metricNumber,
  workingReps,
} from "./training.ts";

export const iso = (d: Date) => format(d, "yyyy-MM-dd");

export const BULK_START = "2026-09-01";
export const BULK_END = "2027-09-01";

export function weekStartOf(d: Date) {
  return startOfWeek(d, { weekStartsOn: 1 });
}

export function weekDays(weekStart: Date) {
  return Array.from({ length: 7 }, (_, i) => iso(addDays(weekStart, i)));
}

export function sortedDays(data: AppData): DailyLog[] {
  return Object.values(data.days).sort((a, b) => a.date.localeCompare(b.date));
}

/** Trailing 7-day average weight ending on `date` (inclusive). */
export function avg7(data: AppData, date: string): number | null {
  const end = parseISO(date);
  const vals: number[] = [];
  for (let i = 0; i < 7; i++) {
    const w = data.days[iso(addDays(end, -i))]?.weight;
    if (typeof w === "number") vals.push(w);
  }
  return vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : null;
}

export function latestWeight(data: AppData): { date: string; weight: number } | null {
  const withW = sortedDays(data).filter((d) => typeof d.weight === "number");
  const last = withW[withW.length - 1];
  return last ? { date: last.date, weight: last.weight as number } : null;
}

export const mean = (vals: number[]) =>
  vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : null;

export const sum = (vals: number[]) => vals.reduce((a, b) => a + b, 0);

/* ---------------- Bulk status & projection ---------------- */

export type BulkStatus = {
  rate: number | null; // kg per week
  label: "ON TRACK" | "TOO SLOW" | "TOO FAST" | "CALIBRATING" | "NO DATA";
  tone: "good" | "warn" | "danger" | "muted";
  currentAvg: number | null;
  daysLogged: number;
  projected: number | null; // projected weight at bulk end
  projectedDate: string | null; // date target weight is reached
};

/** Weekly rate from the trailing 7-day average now vs 14 days ago. */
export function bulkStatus(data: AppData, on: Date = new Date()): BulkStatus {
  const today = iso(on);
  const currentAvg =
    avg7(data, today) ?? (latestWeight(data) ? avg7(data, latestWeight(data)!.date) : null);
  const daysLogged = sortedDays(data).filter((d) => d.weight != null).length;
  const past = avg7(data, iso(addDays(on, -14)));
  const rate = currentAvg != null && past != null ? (currentAvg - past) / 2 : null;

  const weeksLeft = Math.max(0, differenceInCalendarDays(parseISO(BULK_END), on) / 7);
  const projected = currentAvg != null && rate != null ? currentAvg + rate * weeksLeft : null;
  const projectedDate =
    currentAvg != null && rate != null && rate > 0.01
      ? iso(addDays(on, ((data.targets.targetWeight - currentAvg) / rate) * 7))
      : null;

  const base = { rate, currentAvg, daysLogged, projected, projectedDate };
  if (daysLogged < 14) return { ...base, label: "CALIBRATING", tone: "muted" };
  if (rate == null) return { ...base, label: "NO DATA", tone: "muted" };
  if (rate < 0.2) return { ...base, label: "TOO SLOW", tone: "warn" };
  if (rate > 0.3) return { ...base, label: "TOO FAST", tone: "danger" };
  return { ...base, label: "ON TRACK", tone: "good" };
}

/** Weight change over the last 7-day averages of each of the last `n` weeks. */
export function weeklyChanges(data: AppData, n: number, on: Date = new Date()): (number | null)[] {
  const out: (number | null)[] = [];
  for (let i = n - 1; i >= 0; i--) {
    const end = addDays(on, -7 * i);
    const cur = avg7(data, iso(end));
    const prev = avg7(data, iso(addDays(end, -7)));
    out.push(cur != null && prev != null ? cur - prev : null);
  }
  return out;
}

export type CalorieAdvice = {
  decision: string;
  detail: string;
  tone: "good" | "warn" | "danger" | "muted";
  suggestedTarget: number;
};

/** The 2-week calorie adjustment rule. Never reacts to a single week. */
export function calorieAdvice(data: AppData, on: Date = new Date()): CalorieAdvice {
  const target = data.targets.calories;
  const logged = sortedDays(data).filter((d) => d.weight != null).length;
  if (logged < 14) {
    return {
      decision: "Calibration period",
      detail:
        "Do not change calories yet. Early weight swings come from carbs, glycogen, creatine, water and food in the digestive system. Let the first two weeks set your baseline.",
      tone: "muted",
      suggestedTarget: target,
    };
  }
  const last2 = weeklyChanges(data, 2, on).filter((v): v is number => v != null);
  if (last2.length < 2) {
    return {
      decision: "Keep calories",
      detail: "Not enough complete weeks to compare. Keep logging.",
      tone: "muted",
      suggestedTarget: target,
    };
  }
  const stalled = last2.every((v) => v < 0.1);
  const fast = last2.every((v) => v > 0.4);
  const waist4 = waistChange(data, 28, on);

  if (stalled) {
    return {
      decision: `Add 100 to 150 kcal/day → ${target + 150} kcal`,
      detail:
        "No meaningful gain for two consecutive weeks. Add the calories through pasta, rice or oats rather than oil or mayo.",
      tone: "warn",
      suggestedTarget: target + 150,
    };
  }
  if (fast) {
    return {
      decision: `Consider reducing 100 to 150 kcal/day → ${target - 150} kcal`,
      detail:
        waist4 != null && waist4 > 1
          ? `Gain above +0.4 kg/week for two weeks and waist up ${waist4.toFixed(1)} cm in 4 weeks.`
          : "Gain has been above +0.4 kg/week for two consecutive weeks.",
      tone: "danger",
      suggestedTarget: target - 150,
    };
  }
  return {
    decision: `Keep calories at ${target} kcal`,
    detail: "Weight is moving inside the +0.2 to +0.3 kg/week band. Do not change anything.",
    tone: "good",
    suggestedTarget: target,
  };
}

/** Waist change over the last `days` days. */
export function waistChange(data: AppData, days: number, on: Date = new Date()): number | null {
  const all = sortedDays(data).filter((d) => d.waist != null);
  if (all.length < 2) return null;
  const cutoff = iso(addDays(on, -days));
  const recent = all[all.length - 1]!;
  const older = [...all].reverse().find((d) => d.date <= cutoff) ?? all[0]!;
  if (older.date === recent.date) return null;
  return (recent.waist as number) - (older.waist as number);
}

export type WeekSummary = ReturnType<typeof buildWeekSummary>;

export function buildWeekSummary(data: AppData, weekStart: Date) {
  const days = weekDays(weekStart)
    .map((d) => data.days[d])
    .filter(Boolean) as DailyLog[];
  const dates = weekDays(weekStart);
  const num = (sel: (d: DailyLog) => number | undefined) =>
    days.map(sel).filter((v): v is number => typeof v === "number");

  const weights = days.filter((d) => typeof d.weight === "number");
  const endDate = dates[6] as string;
  const prevEnd = iso(addDays(weekStart, -1));

  const currentAvg = avg7(data, endDate) ?? avg7(data, iso(addDays(weekStart, 6)));
  const prevAvg = avg7(data, prevEnd);
  const change = currentAvg != null && prevAvg != null ? currentAvg - prevAvg : null;

  const waistVals = num((d) => d.waist);
  const prevWaist = (() => {
    for (let i = 1; i <= 7; i++) {
      const w = data.days[iso(addDays(weekStart, -i))]?.waist;
      if (typeof w === "number") return w;
    }
    return null;
  })();
  const waist = waistVals.length ? (waistVals[waistVals.length - 1] as number) : null;

  const cals = num((d) => d.calories);
  const target = data.targets.calories;
  const daysOnTarget = cals.filter((c) => Math.abs(c - target) <= 150).length;

  const workouts = dates.map((d) => data.workouts[d]).filter(Boolean) as Workout[];
  const prog = progressionCounts(data, workouts);
  const advice = calorieAdvice(data, addDays(weekStart, 6));

  return {
    weekStart,
    label: `${format(weekStart, "MMMM d")} to ${format(addDays(weekStart, 6), "MMMM d")}`,
    startWeight: weights.length ? (weights[0]!.weight as number) : null,
    endWeight: weights.length ? (weights[weights.length - 1]!.weight as number) : null,
    currentAvg,
    prevAvg,
    change,
    waist,
    waistChange: waist != null && prevWaist != null ? waist - prevWaist : null,
    waist4w: waistChange(data, 28, addDays(weekStart, 6)),
    avgCalories: mean(cals),
    avgProtein: mean(num((d) => d.protein)),
    avgCarbs: mean(num((d) => d.carbs)),
    avgFat: mean(num((d) => d.fat)),
    daysOnTarget,
    daysLogged: cals.length,
    gymSessions: days.filter((d) => d.gym).length,
    ...prog,
    avgSteps: mean(num((d) => d.steps)),
    avgRestingHr: mean(num((d) => d.restingHr)),
    runningKm: sum(num((d) => d.runningKm)),
    cyclingKm: sum(num((d) => d.cyclingKm)),
    cardioSessions: days.filter((d) => (d.cardioMin ?? 0) > 0 || (d.runningKm ?? 0) > 0).length,
    avgSleep: mean(num((d) => d.sleepHours)),
    avgSleepQuality: mean(num((d) => d.sleepQuality)),
    note: data.weekNotes[iso(weekStart)] ?? "",
    status: statusOf(change),
    advice,
    focus: focusPoints(data, workouts),
  };
}

/** Two concrete things to chase next week. */
export function focusPoints(data: AppData, workouts: Workout[]): string[] {
  const out: string[] = [];
  for (const w of workouts) {
    if (w.status === "draft") continue;
    for (const e of w.entries) {
      const p = progressionFor(data, e, w.date);
      if (p.readyForWeight) out.push(`Increase weight on ${e.exercise}`);
      else if (p.state === "regressed" || p.state === "same")
        out.push(`Add one rep on ${e.exercise}`);
    }
  }
  return [...new Set(out)].slice(0, 3);
}

export function statusOf(change: number | null) {
  if (change == null) return { label: "NO DATA", tone: "muted" as const };
  if (change < 0.2) return { label: "TOO SLOW", tone: "warn" as const };
  if (change > 0.3) return { label: "TOO FAST", tone: "danger" as const };
  return { label: "ON TARGET", tone: "good" as const };
}

/* ---------------- Progression ---------------- */

export const totalReps = (reps: (number | undefined)[]) => sum(reps.map((r) => r ?? 0));
const bestRep = (reps: (number | undefined)[]) => Math.max(0, ...reps.map((r) => r ?? 0));
const score = (weight: number | undefined, reps: (number | undefined)[]) =>
  (weight ?? 1) * totalReps(reps);

export type ProgressionResult = {
  state: "empty" | "baseline" | "progressed" | "same" | "regressed";
  label: string;
  tone: "good" | "warn" | "danger" | "muted";
  repDelta: number | null;
  prs: string[];
  readyForWeight: boolean;
  hint: string | null;
  explanation: string | null;
  prev: (ExerciseEntry & { date: string }) | null;
};

/** Full progression verdict for one exercise entry versus its previous session. */
export function progressionFor(
  data: AppData,
  entry: ExerciseEntry,
  date: string,
): ProgressionResult {
  const def = exerciseDef(entry.exercise);
  const prev = previousEntry(data, entry.exercise, date);
  if (isBodyweight(entry.exercise)) return bodyweightProgression(entry, prev);
  const logged = entry.weight != null || entry.reps.some((r) => r != null);
  const setsFilled = entry.reps.filter((r) => r != null);
  const atTop =
    !!def &&
    setsFilled.length === entry.reps.length &&
    entry.reps.every((r) => (r ?? 0) >= def.max);

  const base = {
    repDelta: null,
    prs: [] as string[],
    readyForWeight: atTop,
    prev,
    hint: null,
    explanation: null,
  };

  if (!logged)
    return { ...base, state: "empty", label: "Not logged", tone: "muted", readyForWeight: false };
  if (!prev)
    return {
      ...base,
      state: "baseline",
      label: "Baseline",
      tone: "muted",
      hint: atTop ? "Increase weight next session" : null,
    };

  const sameWeight = (entry.weight ?? 0) === (prev.weight ?? 0);
  const repDelta = totalReps(entry.reps) - totalReps(prev.reps);
  const heavier = (entry.weight ?? 0) > (prev.weight ?? 0);

  const prs: string[] = [];
  if (heavier) prs.push("🏆 Weight PR");
  if (bestRep(entry.reps) > bestRep(prev.reps) && !heavier) prs.push("🏆 Rep PR");
  if (score(entry.weight, entry.reps) > score(prev.weight, prev.reps)) prs.push("🏆 Volume PR");

  let state: ProgressionResult["state"];
  let label: string;
  let tone: ProgressionResult["tone"];

  if (heavier || (sameWeight && repDelta >= 2)) {
    state = "progressed";
    label = heavier ? "PROGRESSED · heavier" : `PROGRESSED · +${repDelta} reps`;
    tone = "good";
  } else if (sameWeight && repDelta <= -3) {
    state = "regressed";
    label = `REGRESSED · ${repDelta} reps`;
    tone = "danger";
  } else if (!sameWeight && !heavier) {
    state = "regressed";
    label = "REGRESSED · lighter";
    tone = "danger";
  } else {
    state = "same";
    label = "SAME";
    tone = "warn";
  }

  const hint = atTop
    ? "Increase weight next session"
    : def && heavier
      ? `Rebuild reps from ${def.min} upward`
      : null;

  const explanation = trendExplanation(entry, prev, entry.weight ?? 0, prev.weight ?? 0);
  return { state, label, tone, repDelta, prs, readyForWeight: atTop, hint, prev, explanation };
}

function trendExplanation(
  entry: ExerciseEntry,
  prev: ExerciseEntry,
  load: number,
  oldLoad: number,
): string {
  const delta = totalReps(entry.reps) - totalReps(prev.reps);
  const loadDelta = load - oldLoad;
  const signedValue = (n: number) => `${n > 0 ? "+" : ""}${metricNumber(n)}`;
  if (Math.abs(loadDelta) < 0.000001)
    return delta === 0
      ? "Same load and total reps"
      : `${signedValue(delta)} total reps at the same load`;
  const bodyweightOnly =
    isBodyweight(entry.exercise) &&
    (entry.addedWeight ?? 0) === (prev.addedWeight ?? 0) &&
    (entry.assistance ?? 0) === (prev.assistance ?? 0);
  return `${delta === 0 ? "Same reps" : `${signedValue(delta)} total reps`} at ${signedValue(loadDelta)} kg${bodyweightOnly ? " bodyweight" : isBodyweight(entry.exercise) ? " effective load" : ""}`;
}

function bodyweightProgression(
  entry: ExerciseEntry,
  prev: ProgressionResult["prev"],
): ProgressionResult {
  const reps = workingReps(entry);
  const def = exerciseDef(entry.exercise)!;
  const load = effectiveLoad(entry);
  const atTop =
    load != null &&
    reps.length === entry.reps.length &&
    reps.length > 0 &&
    reps.every((r) => r >= def.max);
  const base: ProgressionResult = {
    state: "baseline",
    label: "Baseline",
    tone: "muted",
    repDelta: null,
    prs: [],
    readyForWeight: atTop,
    prev,
    hint: atTop ? "Increase weight next session" : null,
    explanation: null,
  };
  if (!reps.length)
    return { ...base, state: "empty", label: "Not logged", readyForWeight: false, hint: null };
  if (load == null)
    return { ...base, explanation: "Session bodyweight is needed to compare load." };
  if (!prev) return base;
  const oldLoad = effectiveLoad(prev);
  if (oldLoad == null)
    return {
      ...base,
      explanation: "Previous bodyweight is unknown; this establishes a load baseline.",
    };
  const oldReps = workingReps(prev);
  if (reps.length !== oldReps.length || !oldReps.length)
    return {
      ...base,
      readyForWeight: false,
      hint: null,
      explanation: "Log the same number of working sets to compare performance.",
    };
  const repDelta = totalReps(reps) - totalReps(oldReps);
  const sameLoad = Math.abs(load - oldLoad) < 0.000001;
  const heavier = !sameLoad && load > oldLoad;
  // At higher loads, maintain each set or lose at most two reps per set while
  // staying at/above the target minimum. Volume never determines the verdict.
  const maintained = reps.every((r, i) => r >= oldReps[i]!);
  const rebuilding = reps.every((r, i) => r >= def.min && r >= oldReps[i]! - 2);
  const progressed = (heavier && (maintained || rebuilding)) || (sameLoad && repDelta >= 2);
  const regressed =
    (!sameLoad && !heavier) ||
    (sameLoad && repDelta <= -3) ||
    (heavier && !maintained && !rebuilding);
  const prs: string[] = [];
  if (heavier) prs.push("🏆 Weight PR");
  if (bestRep(reps) > bestRep(oldReps) && !heavier) prs.push("🏆 Rep PR");
  if (load * totalReps(reps) > oldLoad * totalReps(oldReps)) prs.push("🏆 Volume PR");
  return {
    ...base,
    state: progressed ? "progressed" : regressed ? "regressed" : "same",
    label: progressed ? "PROGRESSED" : regressed ? "REGRESSED" : "SAME",
    tone: progressed ? "good" : regressed ? "danger" : "warn",
    repDelta,
    prs,
    hint: atTop
      ? "Increase weight next session"
      : heavier
        ? `Rebuild reps from ${def.min} upward`
        : null,
    explanation: `${trendExplanation(entry, prev, load, oldLoad)}${heavier && !maintained && !rebuilding ? "; rep loss exceeds the rebuild range" : ""}`,
  };
}

/** Compares each exercise in given workouts against its previous occurrence. */
export function progressionCounts(data: AppData, workouts: Workout[]) {
  let progressed = 0;
  let same = 0;
  let regressed = 0;
  const prs: string[] = [];

  for (const w of workouts) {
    if (w.status === "draft") continue;
    for (const e of w.entries) {
      const r = progressionFor(data, e, w.date);
      if (r.state === "progressed") {
        progressed++;
        if (r.prs.length) prs.push(`${e.exercise} ${entryLoadLabel(e)} × ${bestRep(e.reps)}`);
      } else if (r.state === "same") same++;
      else if (r.state === "regressed") regressed++;
    }
  }
  return { progressed, same, regressed, prs };
}

export function previousEntry(data: AppData, exercise: string, beforeDate: string) {
  const candidates = Object.values(data.workouts)
    .filter((w) => w.date < beforeDate && w.status !== "draft")
    .sort((a, b) => b.date.localeCompare(a.date));
  for (const w of candidates) {
    const e = w.entries.find((x) => x.exercise === exercise && (x.weight || bestRep(x.reps)));
    if (e) return { ...e, date: w.date };
  }
  return null;
}

export function exerciseHistory(data: AppData, exercise: string) {
  return Object.values(data.workouts)
    .filter((w) => w.status !== "draft")
    .sort((a, b) => a.date.localeCompare(b.date))
    .flatMap((w) => {
      const e = w.entries.find((x) => x.exercise === exercise);
      if (!e || (!e.weight && !bestRep(e.reps))) return [];
      return [
        {
          date: w.date,
          weight: effectiveLoad(e),
          bestReps: bestRep(e.reps),
          volume: exerciseMetrics(e).volume,
          entry: e,
          sessionNote: w.sessionNote,
        },
      ];
    });
}

/** Percentage volume change from the first logged session to the latest. */
export function strengthChange(data: AppData, exercise: string) {
  const h = exerciseHistory(data, exercise);
  const first = h[0];
  const last = h[h.length - 1];
  if (
    !first ||
    !last ||
    h.length < 2 ||
    first.volume == null ||
    last.volume == null ||
    first.volume === 0
  )
    return null;
  return {
    pct: ((last.volume - first.volume) / first.volume) * 100,
    latest: `${entryLoadLabel(last.entry)} × ${last.bestReps}`,
    sessions: h.length,
  };
}

/* ---------------- Day completion ---------------- */

/** Only the things that actually matter count towards completion. */
export function dayCompletion(d: DailyLog | undefined, hasWorkout = false) {
  if (!d) return 0;
  const scheduled = d.workoutType != null && d.workoutType !== "Rest";
  const checks: boolean[] = [
    d.weight != null,
    d.calories != null && d.protein != null,
    d.creatine != null,
    d.steps != null || (d.cyclingKm ?? 0) > 0 || (d.runningKm ?? 0) > 0 || (d.cardioMin ?? 0) > 0,
    d.sleepHours != null,
  ];
  if (scheduled) checks.push(hasWorkout);
  return Math.round((checks.filter(Boolean).length / checks.length) * 100);
}

export const fmt = (v: number | null | undefined, digits = 1, suffix = "") =>
  v == null || Number.isNaN(v) ? "—" : `${v.toFixed(digits)}${suffix}`;

export const fmt0 = (v: number | null | undefined, suffix = "") =>
  v == null || Number.isNaN(v) ? "—" : `${Math.round(v)}${suffix}`;

export const signed = (v: number | null | undefined, digits = 2, suffix = "") =>
  v == null || Number.isNaN(v) ? "—" : `${v >= 0 ? "+" : ""}${v.toFixed(digits)}${suffix}`;

export const pctSigned = (v: number | null | undefined) =>
  v == null || Number.isNaN(v) ? "—" : `${v >= 0 ? "+" : ""}${v.toFixed(0)}%`;
