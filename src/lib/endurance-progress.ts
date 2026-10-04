import type { Activity, WeekRow } from "./challenge.ts";

export type EnduranceBar = {
  weekNumber: number;
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
};

const userWeeks = (weeks: WeekRow[], userId: string) =>
  weeks.filter((week) => week.user_id === userId).sort((a, b) => a.week_number - b.week_number);

/** Longest run of consecutive non-paused weeks that hit target, in week-number order. */
function bestStreak(rows: EnduranceBar[]): number {
  let best = 0;
  let current = 0;
  for (const row of rows) {
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
  periodWeeks: number,
): EnduranceSummary {
  const mine = userWeeks(weeks, userId);
  const allBars: EnduranceBar[] = mine.map((week) => ({
    weekNumber: week.week_number,
    equivalentKm: Number(week.equivalent_km) || 0,
    targetKm: Number(week.target_km) || 0,
    paused: week.paused === true,
    hit: !week.paused && Number(week.equivalent_km) >= Number(week.target_km) && week.target_km > 0,
  }));
  const bars = allBars.slice(-periodWeeks);
  const activeBars = bars.filter((bar) => !bar.paused);
  const avgKmPerActiveWeek = activeBars.length
    ? activeBars.reduce((sum, bar) => sum + bar.equivalentKm, 0) / activeBars.length
    : null;
  const latestTarget = activeBars.length ? activeBars[activeBars.length - 1]!.targetKm : null;
  const totalKm = mine.reduce(
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
    bestStreak: bestStreak(allBars),
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
