import { addDays, parseISO } from "date-fns";

import { iso } from "./calc.ts";

/**
 * The authoritative photo count for the current mode: normalized progress photos in public mode,
 * legacy photo sets otherwise. Keeps the Body & food row in step with the Photos screen.
 */
export function resolvePhotoCount(
  mode: string,
  normalizedCount: number,
  legacyCount: number,
): number {
  return mode === "public" ? normalizedCount : legacyCount;
}

/** A map of ISO day → weight in kg, built from either legacy days or normalized weight entries. */
export type WeightByDate = Record<string, number>;

/** Trailing n-day (default 7) average ending on `dateISO`, or null when nothing is logged. */
export function trailingAvg(byDate: WeightByDate, dateISO: string, window = 7): number | null {
  const end = parseISO(dateISO);
  const values: number[] = [];
  for (let i = 0; i < window; i++) {
    const w = byDate[iso(addDays(end, -i))];
    if (typeof w === "number") values.push(w);
  }
  return values.length ? values.reduce((a, b) => a + b, 0) / values.length : null;
}

export function latestWeightEntry(byDate: WeightByDate): { date: string; weightKg: number } | null {
  const dates = Object.keys(byDate).sort();
  const last = dates[dates.length - 1];
  return last ? { date: last, weightKg: byDate[last]! } : null;
}

/**
 * Weight trend over the last `spanDays`: a per-day 7-day-average series, the current average and the
 * change in that average over the last 7 days. Mode-agnostic — it only needs a day→weight map.
 */
export function weightTrend(byDate: WeightByDate, spanDays: number) {
  const latest = latestWeightEntry(byDate);
  const today = iso(new Date());
  const series = Array.from({ length: spanDays }, (_, i) => {
    const d = iso(addDays(parseISO(today), spanDays - 1 - i));
    return { date: d, avg: trailingAvg(byDate, d) };
  });
  const avgKg = latest ? trailingAvg(byDate, latest.date) : null;
  const weekAgoAvg = latest ? trailingAvg(byDate, iso(addDays(parseISO(latest.date), -7))) : null;
  const weekDeltaKg = avgKg != null && weekAgoAvg != null ? avgKg - weekAgoAvg : null;
  return { latest, series, avgKg, weekDeltaKg, points: series.filter((p) => p.avg != null).length };
}

export type NutritionDay = {
  date: string;
  calories: number | null;
  protein: number | null;
  carbs: number | null;
  fat: number | null;
  /** The target in force for this day — a historical snapshot in normalized mode. */
  target: number;
};

const avg = (values: number[]) =>
  values.length ? values.reduce((a, b) => a + b, 0) / values.length : null;

/**
 * Summarises a nutrition window. Adherence is judged per day against that day's own `target`
 * (a historical snapshot in normalized mode), never against today's target. `week7` is the trailing
 * seven days for the bar chart; `past` is the most recent logged days as plain totals.
 */
export function nutritionWindow(days: NutritionDay[], spanDays: number) {
  const today = parseISO(iso(new Date()));
  const within = (d: NutritionDay, span: number) => {
    const diff = Math.round((today.getTime() - parseISO(d.date).getTime()) / 86_400_000);
    return diff >= 0 && diff < span;
  };
  const windowDays = days.filter((d) => within(d, spanDays) && d.calories != null);
  const onTargetDay = (d: NutritionDay) =>
    d.calories != null && d.target > 0 && Math.abs(d.calories - d.target) <= d.target * 0.1;

  const byDate = new Map(days.map((d) => [d.date, d]));
  const week7 = Array.from({ length: 7 }, (_, i) => {
    const date = iso(addDays(today, -(6 - i)));
    const day = byDate.get(date);
    return {
      date,
      calories: day?.calories ?? null,
      onTarget: day ? onTargetDay(day) : false,
    };
  });

  const macro = (key: "protein" | "carbs" | "fat") => {
    const vals = windowDays.map((d) => d[key]).filter((v): v is number => v != null);
    return vals.length ? Math.round(avg(vals) as number) : null;
  };

  const past = [...days]
    .filter((d) => d.calories != null)
    .sort((a, b) => a.date.localeCompare(b.date))
    .slice(-5)
    .reverse()
    .map((d) => ({ date: d.date, calories: d.calories as number }));

  return {
    loggedDays: windowDays.length,
    onTargetDays: windowDays.filter(onTargetDay).length,
    avgKcal: windowDays.length
      ? Math.round(avg(windowDays.map((d) => d.calories!)) as number)
      : null,
    protein: macro("protein"),
    carbs: macro("carbs"),
    fat: macro("fat"),
    week7,
    past,
  };
}
