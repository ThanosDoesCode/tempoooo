import { inProgressRange, progressRangeDays, type ProgressRange } from "./progress-period.ts";
import type { Activity, WeekRow } from "./challenge.ts";

export type EnduranceBar = {
  weekNumber: number;
  date: string;
  equivalentKm: number;
  targetKm: number;
  paused: boolean;
  hit: boolean;
};

export type EnduranceSummary = {
  bars: EnduranceBar[];
  avgKmPerActiveWeek: number | null;
  targetKm: number | null;
  weeksHit: number;
  activeWeeks: number;
  pausedWeeks: number;
  totalKm: number;
  bestStreak: number;
  currentStreak: number;
  averageTargetKm: number | null;
};

const userWeeks = (weeks: WeekRow[], userId: string) =>
  weeks.filter((week) => week.user_id === userId).sort((a, b) => a.week_number - b.week_number);

/** Longest run of consecutive non-paused weeks that hit target, in week-number order. */
function bestStreak(rows: EnduranceBar[]): number {
  let best = 0;
  let current = 0;
  let previousWeek: number | null = null;
  for (const row of rows) {
    if (previousWeek != null && row.weekNumber > previousWeek + 1) current = 0;
    previousWeek = row.weekNumber;
    if (row.paused) continue; // a paused week neither breaks nor extends the streak
    if (row.hit) {
      current += 1;
      best = Math.max(best, current);
    } else {
      current = 0;
    }
  }
  return best;
}

/**
 * Challenge endurance summary from the authoritative settled week rows (never re-deriving penalty
 * or qualification math). `periodWeeks` limits the bars/averages to the most recent weeks; totals
 * and streak stay whole-challenge.
 */
export function enduranceSummary(
  weeks: WeekRow[],
  userId: string,
  periodWeeks: number | ProgressRange,
): EnduranceSummary {
  const mine = userWeeks(weeks, userId);
  const allBars: EnduranceBar[] = mine.map((week) => ({
    weekNumber: week.week_number,
    date: week.week_start,
    equivalentKm: Number(week.equivalent_km) || 0,
    targetKm: Number(week.target_km) || 0,
    paused: week.paused === true,
    hit: !week.paused && Number(week.equivalent_km) >= Number(week.target_km) && week.target_km > 0,
  }));
  const bars =
    typeof periodWeeks === "number"
      ? allBars.slice(-periodWeeks)
      : allBars.filter((bar) => inProgressRange(bar.date, periodWeeks));
  const activeBars = bars.filter((bar) => !bar.paused);
  const avgKmPerActiveWeek = activeBars.length
    ? activeBars.reduce((sum, bar) => sum + bar.equivalentKm, 0) / activeBars.length
    : null;
  const latestTarget = activeBars.length ? activeBars[activeBars.length - 1]!.targetKm : null;
  const totalKm = mine
    .filter(
      (week) => typeof periodWeeks === "number" || inProgressRange(week.week_start, periodWeeks),
    )
    .reduce(
      (sum, week) => sum + (Number(week.running_km) || 0) + (Number(week.cycling_km) || 0),
      0,
    );
  return {
    bars,
    avgKmPerActiveWeek,
    targetKm: latestTarget,
    weeksHit: activeBars.filter((bar) => bar.hit).length,
    activeWeeks: activeBars.length,
    pausedWeeks: bars.filter((bar) => bar.paused).length,
    totalKm,
    bestStreak: bestStreak(typeof periodWeeks === "number" ? allBars : bars),
    currentStreak: (() => {
      let n = 0;
      let previousWeek: number | null = null;
      for (const bar of [...bars].reverse()) {
        if (previousWeek != null && bar.weekNumber < previousWeek - 1) break;
        previousWeek = bar.weekNumber;
        if (bar.paused) continue;
        if (!bar.hit) break;
        n++;
      }
      return n;
    })(),
    averageTargetKm: activeBars.length
      ? activeBars.reduce((sum, bar) => sum + bar.targetKm, 0) / activeBars.length
      : null,
  };
}

/**
 * The calendar date range covered by the displayed (most-recent `periodWeeks`) week rows for a
 * user, so period metrics drawn from activities match the bars. Null when the user has no weeks.
 */
export function periodRange(
  weeks: WeekRow[],
  userId: string,
  periodWeeks: number,
): { start: string; end: string } | null {
  const displayed = userWeeks(weeks, userId).slice(-periodWeeks);
  if (!displayed.length) return null;
  return { start: displayed[0]!.week_start, end: displayed[displayed.length - 1]!.week_end };
}

export type RivalRow = { km: number; weeksHit: number; activeWeeks: number };

/** Whole-challenge you-vs-opponent totals from the week rows. */
export function rivalComparison(weeks: WeekRow[], userId: string): RivalRow {
  const mine = userWeeks(weeks, userId);
  const active = mine.filter((week) => !week.paused);
  return {
    km: mine.reduce((sum, week) => sum + (Number(week.equivalent_km) || 0), 0),
    weeksHit: active.filter(
      (week) => Number(week.equivalent_km) >= Number(week.target_km) && week.target_km > 0,
    ).length,
    activeWeeks: active.length,
  };
}

export type PaceTrend = {
  kind: "run" | "ride";
  /** Pace seconds/km (run) or speed km/h (ride), oldest first. */
  series: number[];
  latest: number | null;
  first: number | null;
  longestRunKm: number | null;
};

/**
 * Pace (runs) or speed (rides) trend over the activities passed in — the caller supplies the full
 * set of activities for the selected period. Only qualifying activities count (the stored
 * `is_qualified`, never re-derived), using the dominant type; a thin/ambiguous mix yields a neutral
 * empty trend.
 */
export function paceTrend(activities: Activity[], userId: string): PaceTrend {
  const mine = activities.filter(
    (activity) =>
      activity.user_id === userId &&
      activity.is_qualified === true &&
      Number(activity.duration_seconds) > 0,
  );
  const runs = mine.filter((activity) => activity.activity_type === "run");
  const rides = mine.filter((activity) => activity.activity_type === "cycle");
  const kind: "run" | "ride" = runs.length >= rides.length ? "run" : "ride";
  const chosen = (kind === "run" ? runs : rides)
    .slice()
    .sort((a, b) => a.activity_date.localeCompare(b.activity_date));
  const series = chosen.map((activity) => {
    const distance = Number(activity.distance_km);
    const duration = Number(activity.duration_seconds);
    return kind === "run" ? duration / distance : (distance * 3600) / duration;
  });
  const longestRunKm = runs.length
    ? Math.max(...runs.map((activity) => Number(activity.distance_km)))
    : null;
  return {
    kind,
    series,
    latest: series.length ? series[series.length - 1]! : null,
    first: series.length ? series[0]! : null,
    longestRunKm,
  };
}

export function runningPeriodStats(
  activities: Activity[],
  userId: string,
  range: ProgressRange,
  previous: ProgressRange | null = null,
) {
  // Raw runs only: converted cycle distance never enters running analytics.
  const runs = activities
    .filter((a) => a.user_id === userId && a.activity_type === "run" && Number(a.distance_km) > 0)
    .sort(
      (a, b) =>
        a.activity_date.localeCompare(b.activity_date) ||
        a.created_at.localeCompare(b.created_at) ||
        a.id.localeCompare(b.id),
    );
  const selected = runs.filter((a) => inProgressRange(a.activity_date, range));
  const points = selected
    .filter((a) => Number(a.duration_seconds) > 0)
    .map((a) => ({
      id: a.id,
      date: a.activity_date,
      distanceKm: Number(a.distance_km),
      durationSeconds: Number(a.duration_seconds),
      pace: Number(a.duration_seconds) / Number(a.distance_km),
    }));
  const averagePace = (values: Activity[]) => {
    const timed = values.filter((a) => Number(a.duration_seconds) > 0);
    const km = timed.reduce((sum, a) => sum + Number(a.distance_km), 0);
    return km ? timed.reduce((sum, a) => sum + Number(a.duration_seconds), 0) / km : null;
  };
  const pace = averagePace(selected);
  const previousPace = previous
    ? averagePace(runs.filter((a) => inProgressRange(a.activity_date, previous)))
    : null;
  const spanDays = progressRangeDays(range, selected[0]?.activity_date);
  return {
    points,
    runs: selected.length,
    distanceKm: selected.reduce((sum, a) => sum + Number(a.distance_km), 0),
    longestRunKm: selected.length ? Math.max(...selected.map((a) => Number(a.distance_km))) : null,
    durationSeconds:
      points.length === selected.length && selected.length
        ? points.reduce((sum, p) => sum + p.durationSeconds, 0)
        : null,
    pace,
    previousPace,
    paceChange: pace != null && previousPace != null ? previousPace - pace : null,
    runsPerWeek: selected.length && spanDays >= 7 ? selected.length / (spanDays / 7) : null,
  };
}
