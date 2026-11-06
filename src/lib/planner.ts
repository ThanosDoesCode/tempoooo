import {
  addDays,
  addMonths,
  differenceInCalendarDays,
  format,
  isValid,
  parseISO,
  startOfMonth,
  startOfWeek,
} from "date-fns";
import { parseDurationToSeconds } from "./duration.ts";
import { parseDecimal } from "./numeric.ts";

// Activity Planner model. A planned item is an intention, never activity history: completion is
// derived only from a linked REAL completed workout session or saved Challenge activity.

export type PlannedActivityType = "workout" | "run" | "ride";
export type WorkoutSource = "plan_day" | "my_workout";
export type PlannedStatus = "planned" | "in_progress" | "completed";

export type PlannedActivity = {
  id: string;
  type: PlannedActivityType;
  /** Local calendar date, YYYY-MM-DD. */
  date: string;
  /** Local 24-hour time, HH:MM, or null for "Any time". */
  time: string | null;
  source: WorkoutSource | null;
  planDayId: string | null;
  templateId: string | null;
  workoutName: string | null;
  exerciseCount: number | null;
  distanceKm: number | null;
  durationSeconds: number | null;
  note: string | null;
  sessionId: string | null;
  sessionStatus: "in_progress" | "completed" | null;
  challengeActivityId: string | null;
  /** The linked saved activity's own raw values (only present once linked). */
  loggedDistanceKm: number | null;
  loggedDurationSeconds: number | null;
  updatedAt: string;
};

export const ACTIVITY_LABEL: Record<PlannedActivityType, string> = {
  workout: "Workout",
  run: "Run",
  ride: "Ride",
};

/** Category colors: workout teal, run green, ride purple. Never the only indicator (icon + label). */
export const ACTIVITY_TONE: Record<PlannedActivityType, { tile: string; dot: string }> = {
  workout: { tile: "bg-cyan-400/15 text-cyan-300", dot: "bg-cyan-300" },
  run: { tile: "bg-primary/15 text-primary", dot: "bg-primary" },
  ride: { tile: "bg-violet-400/15 text-violet-300", dot: "bg-violet-300" },
};

/** Read-derived: the real linked record decides; a link alone is never completion. */
export function plannedStatus(item: PlannedActivity): PlannedStatus {
  if (item.type === "workout") {
    if (item.sessionId && item.sessionStatus === "completed") return "completed";
    if (item.sessionId && item.sessionStatus === "in_progress") return "in_progress";
    return "planned";
  }
  return item.challengeActivityId ? "completed" : "planned";
}

/** Date, then time (Any time last), then stable id. */
export function comparePlanned(a: PlannedActivity, b: PlannedActivity) {
  return (
    a.date.localeCompare(b.date) ||
    (a.time ?? "99:99").localeCompare(b.time ?? "99:99") ||
    a.id.localeCompare(b.id)
  );
}

export function formatKm(km: number) {
  return `${Number(km.toFixed(2))} km`;
}

export function formatMinutes(seconds: number) {
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} min`;
  const rest = minutes % 60;
  return rest ? `${Math.floor(minutes / 60)} h ${rest} min` : `${minutes / 60} h`;
}

export function plannedTitle(item: PlannedActivity) {
  if (item.type === "workout") return item.workoutName ?? "Workout";
  const label = ACTIVITY_LABEL[item.type];
  return item.distanceKm != null ? `${label} · ${formatKm(item.distanceKm)}` : label;
}

const local = (date: string) => parseISO(date);

/** "Today", "Tomorrow", a weekday within the next week, otherwise "Sat 17 Oct". */
export function plannedDayLabel(date: string, today: string) {
  const days = differenceInCalendarDays(local(date), local(today));
  if (days === 0) return "Today";
  if (days === 1) return "Tomorrow";
  if (days === -1) return "Yesterday";
  if (days > 1 && days < 7) return format(local(date), "EEEE");
  return format(local(date), "EEE d MMM");
}

/** "Tomorrow · 09:00", "Sunday · any time". */
export function plannedWhen(item: PlannedActivity, today: string) {
  return `${plannedDayLabel(item.date, today)} · ${item.time ?? "any time"}`;
}

function paceOrSpeed(item: PlannedActivity) {
  const km = item.loggedDistanceKm;
  const seconds = item.loggedDurationSeconds;
  if (!km || !seconds) return null;
  if (item.type === "ride") return `${(km / (seconds / 3600)).toFixed(1)} km/h`;
  const pace = Math.round(seconds / km);
  return `${Math.floor(pace / 60)}:${String(pace % 60).padStart(2, "0")} /km`;
}

/** Agenda second line: time first, then the most useful real detail. */
export function plannedDetail(item: PlannedActivity) {
  const status = plannedStatus(item);
  if (status === "completed") {
    const logged = [
      item.loggedDistanceKm != null ? formatKm(item.loggedDistanceKm) : null,
      paceOrSpeed(item),
    ].filter(Boolean);
    return ["Completed", ...logged].join(" · ");
  }
  if (status === "in_progress") return "In progress";
  const parts = [item.time ?? "Any time"];
  if (item.type === "workout")
    parts.push(item.source === "my_workout" ? "My Workouts" : "from your plan");
  else if (item.durationSeconds != null) parts.push(`about ${formatMinutes(item.durationSeconds)}`);
  else if (item.note) parts.push(item.note);
  return parts.join(" · ");
}

/** Only a current-plan workout, on its own local day, can use the existing start path. */
export function canStartPlanned(item: PlannedActivity, today: string) {
  return (
    item.type === "workout" &&
    item.source === "plan_day" &&
    !!item.planDayId &&
    item.date === today &&
    plannedStatus(item) !== "completed"
  );
}

// ---------------------------------------------------------------- weeks (Monday-first, local)

export const weekStart = (date: string) =>
  format(startOfWeek(local(date), { weekStartsOn: 1 }), "yyyy-MM-dd");

function weekRange(start: string) {
  const first = local(start);
  const last = addDays(first, 6);
  return first.getMonth() === last.getMonth()
    ? `${format(first, "d")} to ${format(last, "d MMM")}`
    : `${format(first, "d MMM")} to ${format(last, "d MMM")}`;
}

export function plannedCounts(items: PlannedActivity[]) {
  const counts = (["workout", "run", "ride"] as const)
    .map((type) => [type, items.filter((item) => item.type === type).length] as const)
    .filter(([, count]) => count > 0)
    .map(([type, count]) => `${count} ${type}${count === 1 ? "" : "s"}`);
  return counts.join(" · ");
}

export type PlannerWeek = {
  start: string;
  label: string;
  /** This week shows real counts; other weeks show their date range. */
  aside: string;
  items: PlannedActivity[];
};

export function groupPlannerWeeks(items: PlannedActivity[], today: string): PlannerWeek[] {
  const current = weekStart(today);
  const next = format(addDays(local(current), 7), "yyyy-MM-dd");
  const previous = format(addDays(local(current), -7), "yyyy-MM-dd");
  const weeks = new Map<string, PlannedActivity[]>();
  for (const item of [...items].sort(comparePlanned)) {
    const start = weekStart(item.date);
    weeks.set(start, [...(weeks.get(start) ?? []), item]);
  }
  return [...weeks].map(([start, weekItems]) => ({
    start,
    label:
      start === current
        ? "This week"
        : start === next
          ? "Next week"
          : start === previous
            ? "Last week"
            : `Week of ${format(local(start), "d MMM")}`,
    aside: start === current ? plannedCounts(weekItems) : weekRange(start),
    items: weekItems,
  }));
}

// ---------------------------------------------------------------- calendar month grid

export type CalendarDay = { date: string; inMonth: boolean };

/**
 * Monday-first weeks covering `month` (YYYY-MM), built from local dates only. Always 6 weeks
 * (42 days) so the month view keeps one height while navigating.
 */
export function calendarGrid(month: string): CalendarDay[][] {
  const first = local(`${month}-01`);
  const start = startOfWeek(first, { weekStartsOn: 1 });
  return Array.from({ length: 6 }, (_, week) =>
    Array.from({ length: 7 }, (_, weekday) => {
      const day = addDays(start, week * 7 + weekday);
      return { date: format(day, "yyyy-MM-dd"), inMonth: day.getMonth() === first.getMonth() };
    }),
  );
}

export const monthOf = (date: string) => date.slice(0, 7);
export const shiftMonth = (month: string, by: number) =>
  format(addMonths(startOfMonth(local(`${month}-01`)), by), "yyyy-MM");
export const monthTitle = (month: string) => format(local(`${month}-01`), "MMMM yyyy");
export function gridRange(month: string) {
  const weeks = calendarGrid(month);
  return { from: weeks[0]![0]!.date, to: weeks.at(-1)!.at(-1)!.date };
}

export function isPlannerDate(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = parseISO(value);
  return isValid(date) && format(date, "yyyy-MM-dd") === value;
}

export function selectedDayHeading(date: string, today: string) {
  const label = format(local(date), "EEEE d MMMM");
  return date === today ? `Today, ${label}` : label;
}

// ---------------------------------------------------------------- form parsing

export type ParsedField<T> = { value: T | null; error: string | null };

/** Optional km: comma or dot, 0.01–1000; raw text is preserved by the caller while typing. */
export function parsePlannedDistance(raw: string): ParsedField<number> {
  const parsed = parseDecimal(raw);
  if (parsed.kind === "empty") return { value: null, error: null };
  if (parsed.kind === "invalid") return { value: null, error: "Enter a distance like 5 or 5,5." };
  if (parsed.value < 0.01 || parsed.value > 1000)
    return { value: null, error: "Distance must be between 0.01 and 1000 km." };
  return { value: Math.round(parsed.value * 100) / 100, error: null };
}

/** Optional duration, using the shared clock grammar; existing 1 minute–24 hour bounds remain. */
export function parsePlannedMinutes(raw: string): ParsedField<number> {
  const text = raw.trim();
  if (!text) return { value: null, error: null };
  const seconds = parseDurationToSeconds(text);
  if (text === "0" || (seconds !== null && (seconds < 60 || seconds > 86400)))
    return { value: null, error: "Duration must be between 1 and 1440 minutes." };
  if (seconds === null) return { value: null, error: "Enter a duration like 30 or 15,35." };
  return { value: seconds, error: null };
}

export function parsePlannedNote(raw: string): ParsedField<string> {
  const text = raw.trim();
  if (!text) return { value: null, error: null };
  if (text.length > 200) return { value: null, error: "Keep the note to 200 characters." };
  return { value: text, error: null };
}
