import { addDays, format, parseISO, startOfWeek } from "date-fns";
import type { AppData, DailyLog, Workout } from "./types";

export const iso = (d: Date) => format(d, "yyyy-MM-dd");

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

export type WeekSummary = ReturnType<typeof buildWeekSummary>;

export function buildWeekSummary(data: AppData, weekStart: Date) {
  const days = weekDays(weekStart).map((d) => data.days[d]).filter(Boolean) as DailyLog[];
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
    avgCalories: mean(cals),
    avgProtein: mean(num((d) => d.protein)),
    avgCarbs: mean(num((d) => d.carbs)),
    avgFat: mean(num((d) => d.fat)),
    daysOnTarget,
    gymSessions: days.filter((d) => d.gym).length,
    ...prog,
    avgSteps: mean(num((d) => d.steps)),
    runningKm: sum(num((d) => d.runningKm)),
    cyclingKm: sum(num((d) => d.cyclingKm)),
    cardioSessions: days.filter((d) => (d.cardioMin ?? 0) > 0 || (d.runningKm ?? 0) > 0).length,
    avgSleep: mean(num((d) => d.sleepHours)),
    avgSleepQuality: mean(num((d) => d.sleepQuality)),
    note: data.weekNotes[iso(weekStart)] ?? "",
    status: statusOf(change),
  };
}

export function statusOf(change: number | null) {
  if (change == null) return { label: "NO DATA", tone: "muted" as const };
  if (change < 0.2) return { label: "TOO SLOW", tone: "warn" as const };
  if (change > 0.3) return { label: "TOO FAST", tone: "danger" as const };
  return { label: "ON TARGET", tone: "good" as const };
}

/** Compares each exercise in given workouts against its previous occurrence. */
export function progressionCounts(data: AppData, workouts: Workout[]) {
  let progressed = 0;
  let same = 0;
  let regressed = 0;
  const prs: string[] = [];

  for (const w of workouts) {
    for (const e of w.entries) {
      const prev = previousEntry(data, e.exercise, w.date);
      if (!prev) continue;
      const cur = score(e.weight, e.reps);
      const old = score(prev.weight, prev.reps);
      if (cur > old) {
        progressed++;
        if ((e.weight ?? 0) > (prev.weight ?? 0)) prs.push(`${e.exercise} ${e.weight}kg`);
        else if (bestRep(e.reps) > bestRep(prev.reps)) prs.push(`${e.exercise} ${bestRep(e.reps)} reps`);
      } else if (cur === old) same++;
      else regressed++;
    }
  }
  return { progressed, same, regressed, prs };
}

const bestRep = (reps: (number | undefined)[]) => Math.max(0, ...reps.map((r) => r ?? 0));
const score = (weight: number | undefined, reps: (number | undefined)[]) =>
  (weight ?? 1) * sum(reps.map((r) => r ?? 0));

export function previousEntry(data: AppData, exercise: string, beforeDate: string) {
  const candidates = Object.values(data.workouts)
    .filter((w) => w.date < beforeDate)
    .sort((a, b) => b.date.localeCompare(a.date));
  for (const w of candidates) {
    const e = w.entries.find((x) => x.exercise === exercise && (x.weight || bestRep(x.reps)));
    if (e) return { ...e, date: w.date };
  }
  return null;
}

export function exerciseHistory(data: AppData, exercise: string) {
  return Object.values(data.workouts)
    .sort((a, b) => a.date.localeCompare(b.date))
    .flatMap((w) => {
      const e = w.entries.find((x) => x.exercise === exercise);
      if (!e || (!e.weight && !bestRep(e.reps))) return [];
      return [{ date: w.date, weight: e.weight ?? 0, bestReps: bestRep(e.reps), volume: score(e.weight, e.reps) }];
    });
}

export function dayCompletion(d: DailyLog | undefined) {
  if (!d) return 0;
  const checks = [
    d.weight != null,
    d.sleepHours != null,
    d.sleepQuality != null,
    d.calories != null,
    d.protein != null,
    d.carbs != null,
    d.fat != null,
    d.water != null,
    d.steps != null,
    d.gym != null,
  ];
  return Math.round((checks.filter(Boolean).length / checks.length) * 100);
}

export const fmt = (v: number | null | undefined, digits = 1, suffix = "") =>
  v == null || Number.isNaN(v) ? "—" : `${v.toFixed(digits)}${suffix}`;

export const fmt0 = (v: number | null | undefined, suffix = "") =>
  v == null || Number.isNaN(v) ? "—" : `${Math.round(v)}${suffix}`;

export const signed = (v: number | null | undefined, digits = 2, suffix = "") =>
  v == null || Number.isNaN(v) ? "—" : `${v >= 0 ? "+" : ""}${v.toFixed(digits)}${suffix}`;
