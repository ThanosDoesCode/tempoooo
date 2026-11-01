import { addDays, differenceInCalendarDays, format, parseISO, startOfWeek } from "date-fns";

export type ActivityCell = { date: string; count: number; future: boolean; today: boolean };

/** First day (Monday) of the grid: the start of the week `weeks` weeks before this one. */
export const activityGridStart = (today: string, weeks = 13) =>
  format(addDays(startOfWeek(parseISO(today), { weekStartsOn: 1 }), -7 * weeks), "yyyy-MM-dd");

/**
 * Activity-frequency heatmap: Monday-start week columns ending this week, one cell per day, counting
 * the activity dates passed in (repeats on a day raise its intensity). This is a frequency view and
 * is deliberately NOT the official weekly streak. Pure, so it is testable without rendering.
 */
export function activityGrid(dates: readonly string[], today: string, weeks = 13) {
  const counts = new Map<string, number>();
  for (const date of dates) counts.set(date, (counts.get(date) ?? 0) + 1);
  const start = activityGridStart(today, weeks);
  const startDate = parseISO(start);
  const columns: ActivityCell[][] = [];
  for (let week = 0; week <= weeks; week++) {
    const column: ActivityCell[] = [];
    for (let day = 0; day < 7; day++) {
      const date = format(addDays(startDate, week * 7 + day), "yyyy-MM-dd");
      column.push({
        date,
        count: counts.get(date) ?? 0,
        future: date > today,
        today: date === today,
      });
    }
    columns.push(column);
  }
  const activeDays = [...counts.keys()].filter((date) => date >= start && date <= today).length;
  const elapsedWeeks = (differenceInCalendarDays(parseISO(today), startDate) + 1) / 7;
  return { columns, activeDays, perWeek: Math.round((activeDays / elapsedWeeks) * 10) / 10 };
}
