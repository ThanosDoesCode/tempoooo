import { addDays, differenceInCalendarDays, parseISO, subMonths } from "date-fns";
import { iso } from "./calc.ts";

export const PROGRESS_PERIODS = ["1", "3", "6", "12", "all"] as const;
export type ProgressPeriod = (typeof PROGRESS_PERIODS)[number];
export type ProgressRange = { start: string | null; end: string };
export const DEFAULT_PROGRESS_PERIOD: ProgressPeriod = "3";
export const PROGRESS_PERIOD_KEY = "tempo:progress-period-months";
export function isProgressPeriod(value: unknown): value is ProgressPeriod {
  return PROGRESS_PERIODS.includes(value as ProgressPeriod);
}
export const progressPeriodLabel = (period: ProgressPeriod) =>
  period === "all" ? "All time" : `Last ${period} month${period === "1" ? "" : "s"}`;
export const recordsPeriodTitle = (period: ProgressPeriod) =>
  period === "all" ? "All-time records" : `Records · ${progressPeriodLabel(period)}`;
export function progressRange(period: ProgressPeriod, today = iso(new Date())): ProgressRange {
  return {
    start: period === "all" ? null : iso(subMonths(parseISO(today), Number(period))),
    end: today,
  };
}
export function inProgressRange(date: string, range: ProgressRange) {
  const day = date.includes("T") ? iso(parseISO(date)) : date.slice(0, 10);
  return (!range.start || day >= range.start) && day <= range.end;
}
export function progressRangeDays(range: ProgressRange, earliest?: string | null) {
  const start = range.start ?? earliest ?? range.end;
  return Math.max(1, differenceInCalendarDays(parseISO(range.end), parseISO(start)) + 1);
}
export function previousProgressRange(
  period: ProgressPeriod,
  today = iso(new Date()),
): ProgressRange | null {
  const current = progressRange(period, today);
  if (!current.start) return null;
  return {
    start: iso(subMonths(parseISO(current.start), Number(period))),
    end: iso(addDays(parseISO(current.start), -1)),
  };
}

/** Exclusive local-day boundary for timestamp queries, including devices behind UTC. */
export const progressEndInstant = (day = iso(new Date())) =>
  addDays(parseISO(day), 1).toISOString();
