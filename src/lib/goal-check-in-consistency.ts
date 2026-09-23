import { addDays, format, parseISO, startOfWeek, subWeeks } from "date-fns";

export type CheckInWeekStatus = "completed" | "missed" | "current-incomplete" | "not-started";
export type CheckInWeek = { weekStart: string; label: string; status: CheckInWeekStatus };

const monday = (day: string) =>
  format(startOfWeek(parseISO(day), { weekStartsOn: 1 }), "yyyy-MM-dd");

export function buildCheckInConsistency(
  goalStartedAt: string,
  completedWeekStarts: string[],
  today: string,
): CheckInWeek[] {
  const current = startOfWeek(parseISO(today), { weekStartsOn: 1 });
  const goalWeek = monday(goalStartedAt.slice(0, 10));
  const completed = new Set(completedWeekStarts.map(monday));
  return Array.from({ length: 8 }, (_, index) => {
    const start = subWeeks(current, 7 - index);
    const weekStart = format(start, "yyyy-MM-dd");
    const isCurrent = index === 7;
    const status: CheckInWeekStatus =
      weekStart < goalWeek
        ? "not-started"
        : completed.has(weekStart)
          ? "completed"
          : isCurrent
            ? "current-incomplete"
            : "missed";
    return { weekStart, label: format(addDays(start, 3), "d MMM"), status };
  });
}
