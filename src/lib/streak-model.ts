// Pure parsing/derivation for the weekly streak. The recompute_streak RPC returns Json, so the
// whole untyped shape is validated here in one place (no scattered `as` casts in components).
// current/best are already derived from LOCKED weeks server-side; the open week never changes them.

export type StreakRingState = "inactive" | "open" | "closed" | "skipped";
export type StreakWeekResult = "open" | "kept" | "missed" | "paused" | "free" | "none";
export type RingKey = "run" | "train" | "eat";

export type RingSummary = { key: RingKey; active: boolean; state: StreakRingState };
export type StreakThisWeek = {
  weekStart: string;
  weekEnd: string;
  result: StreakWeekResult;
  rings: RingSummary[];
};
export type StreakWeekTile = {
  weekStart: string;
  weekEnd: string;
  result: StreakWeekResult;
  freeMissUsed: boolean;
  locked: boolean;
};
export type StreakData = {
  current: number;
  best: number;
  /** true only once a streak exists and the current run equals the best. */
  isBest: boolean;
  thisWeek: StreakThisWeek | null;
  activeRings: RingSummary[];
  recentWeeks: StreakWeekTile[];
  nextMilestone: number | null;
  freeMissUsedThisMonth: boolean;
};

/** Streak milestones, in weeks. No 6-week milestone. */
export const STREAK_MILESTONES = [4, 8, 12, 26, 52] as const;
export const RING_KEYS: readonly RingKey[] = ["run", "train", "eat"];

const RING_STATES = new Set<StreakRingState>(["inactive", "open", "closed", "skipped"]);
const WEEK_RESULTS = new Set<StreakWeekResult>([
  "open",
  "kept",
  "missed",
  "paused",
  "free",
  "none",
]);

type Rec = Record<string, unknown>;
const rec = (v: unknown): Rec => (v && typeof v === "object" ? (v as Rec) : {});
const num = (v: unknown): number => (typeof v === "number" && Number.isFinite(v) ? v : 0);
const bool = (v: unknown): boolean => v === true;
const str = (v: unknown): string => (typeof v === "string" ? v : "");
const ringState = (v: unknown): StreakRingState =>
  RING_STATES.has(v as StreakRingState) ? (v as StreakRingState) : "inactive";
const weekResult = (v: unknown): StreakWeekResult =>
  WEEK_RESULTS.has(v as StreakWeekResult) ? (v as StreakWeekResult) : "open";

const ringsOf = (row: Rec): RingSummary[] =>
  RING_KEYS.map((key) => ({
    key,
    active: bool(row[`${key}_active`]),
    state: ringState(row[`${key}_state`]),
  }));

/** First milestone strictly above the current streak, or null once past the last one. */
export function nextMilestone(current: number): number | null {
  return STREAK_MILESTONES.find((m) => m > current) ?? null;
}

/** Whether this calendar month's single free miss has already been used (from recent weeks). */
export function isFreeMissUsedThisMonth(weeks: StreakWeekTile[], monthKey: string): boolean {
  return weeks.some((w) => w.freeMissUsed && w.weekStart.slice(0, 7) === monthKey);
}

/**
 * Parse the recompute_streak Json into the frontend model. The free-miss month is the calendar
 * month of the current streak week's `week_start` (the backend's own scope — a stored date, never
 * the device timezone). recent_weeks always covers that month (<=5 week starts within the latest 8).
 */
export function parseStreakResponse(json: unknown): StreakData {
  const root = rec(json);
  const current = num(root["current"]);
  const best = num(root["best"]);

  const tw = root["this_week"];
  let thisWeek: StreakThisWeek | null = null;
  if (tw && typeof tw === "object") {
    const row = rec(tw);
    const weekStart = str(row["week_start"]);
    if (weekStart) {
      thisWeek = {
        weekStart,
        weekEnd: str(row["week_end"]),
        result: weekResult(row["result"]),
        rings: ringsOf(row),
      };
    }
  }

  const recentRaw = Array.isArray(root["recent_weeks"]) ? (root["recent_weeks"] as unknown[]) : [];
  const recentWeeks: StreakWeekTile[] = recentRaw
    .map((entry) => {
      const row = rec(entry);
      return {
        weekStart: str(row["week_start"]),
        weekEnd: str(row["week_end"]),
        result: weekResult(row["result"]),
        freeMissUsed: bool(row["free_miss_used"]),
        locked: str(row["locked_at"]) !== "",
      };
    })
    .filter((w) => w.weekStart !== "");

  // Scope the free miss to the streak month of week_start (authoritative), not the device month.
  const streakMonth = (thisWeek?.weekStart ?? recentWeeks[0]?.weekStart ?? "").slice(0, 7);

  return {
    current,
    best,
    isBest: current > 0 && current === best,
    thisWeek,
    activeRings: thisWeek ? thisWeek.rings.filter((r) => r.active) : [],
    recentWeeks,
    nextMilestone: nextMilestone(current),
    freeMissUsedThisMonth: streakMonth ? isFreeMissUsedThisMonth(recentWeeks, streakMonth) : false,
  };
}
