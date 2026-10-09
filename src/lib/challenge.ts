import { addDays, format, parseISO } from "date-fns";
import { queryOptions, useQuery, useInfiniteQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import {
  ACTIVITY_FIELDS,
  ACTIVITY_PAGE_SIZE,
  RECENT_ACTIVITY_FIRST_PAGE_SIZE,
  RECENT_ACTIVITY_OLDER_PAGE_SIZE,
  activityCursorFilter,
  activityPage,
  collectActivityPages,
  uniqueActivityPages,
  type ActivityCursor,
  type ActivityDateRange,
} from "./challenge-activity-data";
import { getRelatedProfiles } from "./privileged-rpcs.functions";

export type Challenge = {
  id: string;
  created_by: string;
  name: string;
  start_date: string;
  duration_weeks: number;
  timezone: string;
  weekly_target_km: number;
  penalty_high_eur: number;
  penalty_medium_eur: number;
  penalty_low_eur: number;
  penalty_mode: PenaltyMode;
  penalty_high_custom: string | null;
  penalty_medium_custom: string | null;
  penalty_low_custom: string | null;
  legacy_photo_owed: boolean;
  travel_pause_enabled: boolean;
  travel_pause_home_countries: string[];
  running_ratio: number;
  cycling_ratio: number;
  max_members: number;
  status: string;
};

export type Activity = {
  id: string;
  challenge_id: string;
  user_id: string;
  activity_type: "run" | "cycle";
  distance_km: number;
  equivalent_km: number;
  qualifying_equivalent_km: number;
  is_qualified: boolean;
  average_speed_kmh: number | null;
  average_pace_seconds_per_km: number | null;
  activity_date: string;
  duration_seconds: number | null;
  evidence_path: string;
  extra_evidence_paths: string[] | null;
  external_activity_url: string | null;
  note: string | null;
  edited: boolean;
  created_at: string;
  updated_at: string;
  evidence_expired_at?: string | null;
};

export type WeekTargetOverride = {
  id: string;
  challenge_id: string;
  week_number: number;
  target_km: number;
  set_by: string;
  created_at: string;
  updated_at: string;
};

export const DEFAULT_TARGET_KM = 15;
export const DEFAULT_PENALTIES = { high: 15, medium: 10, low: 5 } as const;
export type PenaltyMode = "money" | "custom";

export type ChallengeTerms = {
  weekly_target_km: number;
  penalty_mode: PenaltyMode;
  penalty_high_eur: number;
  penalty_medium_eur: number;
  penalty_low_eur: number;
  penalty_high_custom: string | null;
  penalty_medium_custom: string | null;
  penalty_low_custom: string | null;
  legacy_photo_owed: boolean;
  travel_pause_enabled: boolean;
  travel_pause_home_countries: string[];
};

export function challengeTerms(terms?: Partial<ChallengeTerms> | null): ChallengeTerms {
  return {
    weekly_target_km: Number(terms?.weekly_target_km ?? DEFAULT_TARGET_KM),
    penalty_mode: terms?.penalty_mode === "custom" ? "custom" : "money",
    penalty_high_eur: Number(terms?.penalty_high_eur ?? DEFAULT_PENALTIES.high),
    penalty_medium_eur: Number(terms?.penalty_medium_eur ?? DEFAULT_PENALTIES.medium),
    penalty_low_eur: Number(terms?.penalty_low_eur ?? DEFAULT_PENALTIES.low),
    penalty_high_custom: terms?.penalty_high_custom?.trim() || null,
    penalty_medium_custom: terms?.penalty_medium_custom?.trim() || null,
    penalty_low_custom: terms?.penalty_low_custom?.trim() || null,
    legacy_photo_owed: terms?.legacy_photo_owed === true,
    travel_pause_enabled: terms?.travel_pause_enabled !== false,
    travel_pause_home_countries: terms?.travel_pause_home_countries ?? ["GR", "SE"],
  };
}

export function penaltyBands(terms?: Partial<ChallengeTerms> | null) {
  const value = challengeTerms(terms);
  return {
    highBelow: value.weekly_target_km / 3,
    mediumBelow: (value.weekly_target_km * 2) / 3,
    target: value.weekly_target_km,
    highPenalty: value.penalty_high_eur,
    mediumPenalty: value.penalty_medium_eur,
    lowPenalty: value.penalty_low_eur,
  };
}

/** Mirrors the database penalty_for() function. Official values always come from the server. */
export function penaltyFor(
  equivalentKm: number,
  targetKm: number = DEFAULT_TARGET_KM,
  penalties: { high: number; medium: number; low: number } = DEFAULT_PENALTIES,
) {
  if (targetKm <= 0 || equivalentKm >= targetKm) return 0;
  if (equivalentKm >= (targetKm * 2) / 3) return penalties.low;
  if (equivalentKm >= targetKm / 3) return penalties.medium;
  return penalties.high;
}

export type PenaltyBand = "high" | "medium" | "low";

export function penaltyBandFor(equivalentKm: number, targetKm: number): PenaltyBand | null {
  if (targetKm <= 0 || equivalentKm >= targetKm) return null;
  if (equivalentKm >= (targetKm * 2) / 3) return "low";
  if (equivalentKm >= targetKm / 3) return "medium";
  return "high";
}

export const photosFor = (euros: number) => Math.floor(Math.max(0, euros) / 5);

export const photoText = (euros: number) => {
  const photos = photosFor(euros);
  return photos === 0 ? "" : `${photos} photo${photos === 1 ? "" : "s"}`;
};

export const owedText = (euros: number, legacyPhotoOwed = false) => {
  const photos = legacyPhotoOwed ? photoText(euros) : "";
  return photos ? `${eur(euros)} + ${photos}` : eur(euros);
};

export function penaltyTextFor(equivalentKm: number, terms?: Partial<ChallengeTerms> | null) {
  const configured = challengeTerms(terms);
  const band = penaltyBandFor(equivalentKm, configured.weekly_target_km);
  if (!band) return configured.penalty_mode === "money" ? "€0" : "None";
  if (configured.penalty_mode === "custom") {
    return (
      {
        high: configured.penalty_high_custom,
        medium: configured.penalty_medium_custom,
        low: configured.penalty_low_custom,
      }[band] ?? "Custom consequence"
    );
  }
  return owedText(
    {
      high: configured.penalty_high_eur,
      medium: configured.penalty_medium_eur,
      low: configured.penalty_low_eur,
    }[band],
    configured.legacy_photo_owed,
  );
}

/**
 * The live week penalty line for the Challenge card. Reuses the authoritative penalty bands
 * and amounts via penaltyFor — it never re-derives the penalty formula. Money mode returns the
 * amount owed now plus the distance to the next lower band; custom mode names the consequence.
 */
export type WeekPenalty = {
  atRisk: boolean;
  /** Legacy single-line form, kept for any plain-text consumer. */
  line: string;
  /** The consequence that applies right now (null when on target). */
  consequence: string | null;
  /** The action that lowers it, e.g. "4.8 km to reduce it" (null when nothing lowers it). */
  action: string | null;
};

export function weekPenaltyMessage(
  equivalentKm: number,
  targetKm: number,
  terms?: Partial<ChallengeTerms> | null,
): WeekPenalty {
  const configured = challengeTerms(terms);
  const onTarget: WeekPenalty = {
    atRisk: false,
    line: "On target · no penalty",
    consequence: null,
    action: null,
  };
  if (targetKm <= 0 || equivalentKm >= targetKm) return onTarget;
  if (configured.penalty_mode !== "money") {
    const consequence = penaltyTextFor(equivalentKm, configured);
    return { atRisk: true, line: `At risk: ${consequence}`, consequence, action: null };
  }
  const penalties = {
    high: configured.penalty_high_eur,
    medium: configured.penalty_medium_eur,
    low: configured.penalty_low_eur,
  };
  const current = penaltyFor(equivalentKm, targetKm, penalties);
  if (current === 0) return onTarget;
  const nextBoundary = [targetKm / 3, (targetKm * 2) / 3, targetKm].find((b) => b > equivalentKm)!;
  const consequence = owedText(current, configured.legacy_photo_owed);
  const reduceKm = Math.max(0, nextBoundary - equivalentKm);
  const nextPenalty = penaltyFor(nextBoundary, targetKm, penalties);
  const nextOwed = nextPenalty === 0 ? eur(0) : owedText(nextPenalty, configured.legacy_photo_owed);
  return {
    atRisk: true,
    line: `At risk: ${consequence} · ${km(reduceKm)} more → ${nextOwed}`,
    consequence,
    action: `${km(reduceKm)} to reduce it`,
  };
}

export function activityMetrics(activity: {
  activity_type: "run" | "cycle";
  distance_km: number;
  duration_seconds: number | null;
}) {
  const distance = Number(activity.distance_km);
  const duration = Number(activity.duration_seconds);
  const averageSpeed = duration > 0 ? (distance * 3600) / duration : null;
  const averagePace = duration > 0 && distance > 0 ? duration / distance : null;
  const qualified =
    activity.activity_type === "run"
      ? averagePace !== null && averagePace < 420
      : averageSpeed !== null && averageSpeed >= 18;
  return {
    averageSpeed,
    averagePace,
    qualified,
    equivalent: qualified ? (activity.activity_type === "run" ? distance : distance / 3) : 0,
  };
}

export function qualifiedEquivalentKm(activity: Activity) {
  const stored = Number(activity.qualifying_equivalent_km);
  return Number.isFinite(stored) ? stored : activityMetrics(activity).equivalent;
}

export function formatPace(secondsPerKm: number | null) {
  if (secondsPerKm === null || !Number.isFinite(secondsPerKm)) return "—";
  const rounded = Math.round(secondsPerKm);
  return `${Math.floor(rounded / 60)}:${String(rounded % 60).padStart(2, "0")} min/km`;
}

/** Today's date in the challenge timezone (never the device clock's date). */
export function todayIn(timezone: string) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: timezone }).format(new Date());
}

export function weekNumberOf(challenge: Challenge, day: string) {
  const diff = Math.floor(
    (parseISO(day).getTime() - parseISO(challenge.start_date).getTime()) / 86_400_000,
  );
  return Math.floor(diff / 7) + 1;
}

export function weekBounds(challenge: Challenge, weekNumber: number) {
  const start = addDays(parseISO(challenge.start_date), (weekNumber - 1) * 7);
  return { start: format(start, "yyyy-MM-dd"), end: format(addDays(start, 6), "yyyy-MM-dd") };
}

export function targetOverrideForWeek(
  challenge: Pick<Challenge, "weekly_target_km">,
  overrides: WeekTargetOverride[] | undefined,
  weekNumber: number,
) {
  return Number(
    overrides?.find((override) => override.week_number === weekNumber)?.target_km ??
      challenge.weekly_target_km,
  );
}

export function resolvedTargetForWeek(
  challenge: Pick<Challenge, "weekly_target_km">,
  overrides: WeekTargetOverride[] | undefined,
  pauses: TravelPause[] | undefined,
  userId: string,
  weekNumber: number,
) {
  return weekPaused(pauses, userId, weekNumber)
    ? 0
    : targetOverrideForWeek(challenge, overrides, weekNumber);
}

/** Owner can edit/delete only inside the current open week, mirroring finalization locking. */
export function isActivityEditable(
  challenge: Challenge,
  activity: Pick<Activity, "user_id" | "activity_date">,
  userId: string | undefined,
) {
  if (!userId || activity.user_id !== userId) return false;
  const n = weekNumberOf(challenge, todayIn(challenge.timezone));
  const { start, end } = weekBounds(challenge, n);
  return activity.activity_date >= start && activity.activity_date <= end;
}

export function hoursLeft(challenge: Challenge, weekNumber: number) {
  const { end } = weekBounds(challenge, weekNumber);
  const endOfWeek = new Date(`${end}T23:59:59`);
  const nowLocal = new Date(
    new Intl.DateTimeFormat("en-CA", {
      timeZone: challenge.timezone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    })
      .format(new Date())
      .replace(", ", "T") + ":00",
  );
  return Math.max(0, (endOfWeek.getTime() - nowLocal.getTime()) / 3_600_000);
}

/** Only challenges the signed-in user is still a member of. Leaving frees them to start a new one. */
export const myChallengeQueryOptions = (challengeId?: string) =>
  queryOptions({
    queryKey: challengeId ? ["challenge", challengeId] : ["challenge"],
    staleTime: 5 * 60_000,
    queryFn: async () => {
      // The session lookup is local; RLS still authenticates the joined database read.
      const { data: auth } = await supabase.auth.getSession();
      const uid = auth.session?.user.id;
      if (!uid) return null;
      let query = supabase
        .from("challenge_members")
        .select(
          "joined_at, challenges!inner(id, created_by, name, start_date, duration_weeks, timezone, weekly_target_km, penalty_mode, penalty_high_eur, penalty_medium_eur, penalty_low_eur, penalty_high_custom, penalty_medium_custom, penalty_low_custom, legacy_photo_owed, travel_pause_enabled, travel_pause_home_countries, running_ratio, cycling_ratio, max_members, status)",
        )
        .eq("user_id", uid);
      if (challengeId) query = query.eq("challenge_id", challengeId);
      const { data, error } = await query
        .order("joined_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (error) throw error;
      const joined = (data as unknown as { challenges?: Challenge | Challenge[] } | null)
        ?.challenges;
      return (Array.isArray(joined) ? joined[0] : joined) ?? null;
    },
  });

export function useMyChallenge(challengeId?: string) {
  return useQuery(myChallengeQueryOptions(challengeId));
}

/** Removes the signed-in user from a challenge. Their logged activities stay in the record. */
export async function leaveChallenge(challengeId: string) {
  const { data: auth } = await supabase.auth.getUser();
  const uid = auth.user?.id;
  if (!uid) throw new Error("Not signed in");
  const { error } = await supabase
    .from("challenge_members")
    .delete()
    .eq("challenge_id", challengeId)
    .eq("user_id", uid);
  if (error) throw error;
}

export function useChallengeMembers(challengeId: string | undefined) {
  return useQuery({
    enabled: !!challengeId,
    queryKey: ["challenge-members", challengeId],
    staleTime: 5 * 60_000,
    queryFn: async () => {
      const [members, profiles] = await Promise.all([
        supabase
          .from("challenge_members")
          .select("user_id, joined_at")
          .eq("challenge_id", challengeId!),
        getRelatedProfiles(),
      ]);
      if (members.error) throw members.error;
      const names = new Map((profiles ?? []).map((p) => [p.id, p.display_name || "Athlete"]));
      return (members.data ?? []).map((m) => ({
        userId: m.user_id,
        name: names.get(m.user_id) ?? "Athlete",
      }));
    },
  });
}

export async function fetchActivityPage(
  challengeId: string,
  cursor: ActivityCursor | null = null,
  range?: ActivityDateRange,
  pageSize = ACTIVITY_PAGE_SIZE,
) {
  let query = supabase
    .from("challenge_activities")
    .select(ACTIVITY_FIELDS)
    .eq("challenge_id", challengeId)
    .order("activity_date", { ascending: false })
    .order("created_at", { ascending: false })
    .order("id", { ascending: true })
    .limit(pageSize + 1);
  if (range) query = query.gte("activity_date", range.start).lte("activity_date", range.end);
  if (cursor) query = query.or(activityCursorFilter(cursor));
  const { data, error } = await query;
  if (error) throw error;
  return activityPage((data ?? []) as unknown as Activity[], pageSize);
}

export const activityQueryOptions = (activityId: string) =>
  queryOptions({
    queryKey: ["challenge-activity", activityId],
    staleTime: 30_000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("challenge_activities")
        .select(ACTIVITY_FIELDS)
        .eq("id", activityId)
        .maybeSingle();
      if (error) throw error;
      return (data as unknown as Activity | null) ?? null;
    },
  });

/** A single activity by id for the detail screen. RLS still scopes it to challenge members. */
export function useActivity(activityId: string | undefined) {
  return useQuery({
    ...activityQueryOptions(activityId ?? ""),
    enabled: !!activityId,
  });
}

export function useActivities(challengeId: string | undefined, range?: ActivityDateRange) {
  const query = useInfiniteQuery({
    enabled: !!challengeId && (!range || !!range.start),
    queryKey: [
      "challenge-activities",
      challengeId,
      "feed",
      range ? "week" : "recent-5-10",
      range?.start ?? null,
      range?.end ?? null,
    ],
    staleTime: 30_000,
    initialPageParam: null as ActivityCursor | null,
    queryFn: ({ pageParam }) =>
      fetchActivityPage(
        challengeId!,
        pageParam,
        range,
        range
          ? ACTIVITY_PAGE_SIZE
          : pageParam
            ? RECENT_ACTIVITY_OLDER_PAGE_SIZE
            : RECENT_ACTIVITY_FIRST_PAGE_SIZE,
      ),
    getNextPageParam: (page) => page.next ?? undefined,
  });
  return { ...query, activities: uniqueActivityPages(query.data?.pages ?? []) };
}

/**
 * Every activity inside a date range, for period-scoped endurance analytics (longest run, pace and
 * speed trends over the selected Progress period). Pages the shared cursor fetch to exhaustion
 * within the range — so it is complete, not capped at one page — while still bounded to the period
 * (never the whole history). Reuses the shared fetch/qualification fields and dedupe; it never
 * re-derives qualification or conversion.
 */
export async function fetchActivitiesInRange(
  challengeId: string,
  range: ActivityDateRange,
  pageSize = ACTIVITY_PAGE_SIZE,
) {
  return collectActivityPages((cursor) => fetchActivityPage(challengeId, cursor, range, pageSize));
}

export const enduranceActivitiesQueryOptions = (challengeId: string, range: ActivityDateRange) =>
  queryOptions({
    queryKey: ["challenge-activities", challengeId, "endurance", range.start, range.end],
    staleTime: 60_000,
    queryFn: () => fetchActivitiesInRange(challengeId, range),
  });

export function useEnduranceActivities(
  challengeId: string | undefined,
  range: ActivityDateRange | null,
) {
  return useQuery({
    ...enduranceActivitiesQueryOptions(challengeId ?? "", range ?? { start: "", end: "" }),
    enabled: !!challengeId && !!range,
  });
}

/** Full history is read only after an explicit export request, never on route entry. */
export async function fetchActivitiesForExport(challengeId: string) {
  const pages = [];
  let cursor: ActivityCursor | null = null;
  do {
    const page = await fetchActivityPage(challengeId, cursor, undefined, 500);
    pages.push(page);
    cursor = page.next;
  } while (cursor);
  return uniqueActivityPages(pages);
}

export type ActivitySummary = {
  userId: string;
  running: number;
  cycling: number;
  equivalent: number;
  stats: LifetimeStats;
};

export function useActivitySummary(challengeId: string | undefined, range?: ActivityDateRange) {
  return useQuery({
    enabled: !!challengeId && (!range || !!range.start),
    queryKey: [
      "challenge-activities",
      challengeId,
      "summary",
      range?.start ?? null,
      range?.end ?? null,
    ],
    staleTime: 30_000,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("challenge_activity_summary", {
        _challenge: challengeId!,
        ...(range ? { _start: range.start, _end: range.end } : {}),
      });
      if (error) throw error;
      return data as unknown as ActivitySummary[];
    },
  });
}

export function sumWeek(activities: Activity[], userId: string, start: string, end: string) {
  const rows = activities.filter(
    (a) => a.user_id === userId && a.activity_date >= start && a.activity_date <= end,
  );
  const running = rows
    .filter((a) => a.activity_type === "run")
    .reduce((s, a) => s + Number(a.distance_km), 0);
  const cycling = rows
    .filter((a) => a.activity_type === "cycle")
    .reduce((s, a) => s + Number(a.distance_km), 0);
  const equivalent = rows.reduce((sum, activity) => sum + qualifiedEquivalentKm(activity), 0);
  return { running, cycling, equivalent, rows };
}

export type TravelPause = {
  id: string;
  challenge_id: string;
  user_id: string;
  week_number: number;
  country: string;
  created_at: string;
  updated_at: string;
};

export type OutgoingInvitation = {
  id: string;
  invited_username: string;
  invited_user_id: string | null;
  expires_at: string;
  accepted_at: string | null;
};

// Retain the latest unrevoked invitation after expiry/acceptance for honest state presentation.
export function useOutgoingInvitation(challengeId: string | undefined, enabled = true) {
  return useQuery({
    enabled: !!challengeId && enabled,
    queryKey: ["challenge-outgoing-invitation", challengeId],
    staleTime: 30_000,
    queryFn: async (): Promise<OutgoingInvitation | null> => {
      const { data, error } = await supabase
        .from("challenge_invitations")
        .select("id, invited_username_snapshot, invited_user_id, expires_at, accepted_at")
        .eq("challenge_id", challengeId!)
        .is("revoked_at", null)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (error) throw error;
      if (!data) return null;
      const row = data as unknown as {
        id: string;
        invited_username_snapshot: string | null;
        invited_user_id: string | null;
        accepted_at: string | null;
        expires_at: string;
      };
      return {
        id: row.id,
        invited_username: row.invited_username_snapshot ?? "your opponent",
        expires_at: row.expires_at,
        invited_user_id: row.invited_user_id,
        accepted_at: row.accepted_at,
      };
    },
  });
}

export function useTravelPauses(challengeId: string | undefined) {
  return useQuery({
    enabled: !!challengeId,
    queryKey: ["challenge-travel-pauses", challengeId],
    staleTime: 30_000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("challenge_travel_pauses")
        .select("*")
        .eq("challenge_id", challengeId!)
        .order("week_number", { ascending: true });
      if (error) throw error;
      return (data ?? []) as unknown as TravelPause[];
    },
  });
}

export const weekTargetsQueryOptions = (challengeId: string) =>
  queryOptions({
    queryKey: ["challenge-week-targets", challengeId],
    staleTime: 60_000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("challenge_week_targets")
        .select("*")
        .eq("challenge_id", challengeId)
        .order("week_number", { ascending: true });
      if (error) throw error;
      return (data ?? []) as unknown as WeekTargetOverride[];
    },
  });

export function useWeekTargets(challengeId: string | undefined) {
  return useQuery({
    ...weekTargetsQueryOptions(challengeId ?? ""),
    enabled: !!challengeId,
  });
}

export async function setTravelPause(challengeId: string, weekNumber: number, country: string) {
  const { data: auth } = await supabase.auth.getUser();
  const uid = auth.user?.id;
  if (!uid) throw new Error("Not signed in");
  const { error } = await supabase.from("challenge_travel_pauses").upsert(
    {
      challenge_id: challengeId,
      user_id: uid,
      week_number: weekNumber,
      country: country.trim(),
    },
    { onConflict: "challenge_id,user_id,week_number" },
  );
  if (error) throw error;
}

export async function removeTravelPause(pauseId: string) {
  const { error } = await supabase.from("challenge_travel_pauses").delete().eq("id", pauseId);
  if (error) throw error;
}

export function weekPaused(pauses: TravelPause[] | undefined, userId: string, weekNumber: number) {
  return !!pauses?.some((pause) => pause.user_id === userId && pause.week_number === weekNumber);
}

export type LifetimeStats = {
  totalKm: number;
  challengeKm: number;
  averageSpeedKmh: number | null;
  runningKm: number;
  cyclingKm: number;
  runningPaceSecondsPerKm: number | null;
  cyclingSpeedKmh: number | null;
  activities: number;
  qualifiedActivities: number;
};

export function summarizeActivities(activities: Activity[], userId: string): LifetimeStats {
  const rows = activities.filter((activity) => activity.user_id === userId);
  const timed = rows.filter((activity) => Number(activity.duration_seconds) > 0);
  const runs = timed.filter((activity) => activity.activity_type === "run");
  const rides = timed.filter((activity) => activity.activity_type === "cycle");
  const distance = (list: Activity[]) =>
    list.reduce((sum, activity) => sum + Number(activity.distance_km), 0);
  const duration = (list: Activity[]) =>
    list.reduce((sum, activity) => sum + Number(activity.duration_seconds), 0);
  const speed = (list: Activity[]) => {
    const seconds = duration(list);
    return seconds > 0 ? (distance(list) * 3600) / seconds : null;
  };
  const runDistance = distance(runs);
  const runDuration = duration(runs);
  return {
    totalKm: distance(rows),
    challengeKm: rows.reduce((sum, activity) => sum + qualifiedEquivalentKm(activity), 0),
    averageSpeedKmh: speed(timed),
    runningKm: distance(rows.filter((activity) => activity.activity_type === "run")),
    cyclingKm: distance(rows.filter((activity) => activity.activity_type === "cycle")),
    runningPaceSecondsPerKm: runDistance > 0 ? runDuration / runDistance : null,
    cyclingSpeedKmh: speed(rides),
    activities: rows.length,
    qualifiedActivities: rows.filter((activity) => activityMetrics(activity).qualified).length,
  };
}

export type WeekRow = {
  id: string;
  challenge_id: string;
  user_id: string;
  week_number: number;
  week_start: string;
  week_end: string;
  running_km: number;
  cycling_km: number;
  equivalent_km: number;
  target_km: number;
  completed: boolean;
  penalty_eur: number;
  penalty_mode: PenaltyMode | null;
  penalty_band: PenaltyBand | null;
  penalty_consequence: string | null;
  paused: boolean;
  pause_country: string | null;
};

export type PaymentRow = {
  id: string;
  challenge_id: string;
  week_id: string;
  payer_id: string;
  recipient_id: string;
  amount_eur: number;
  status: "unpaid" | "marked_paid" | "confirmed_paid";
  payment_evidence_path: string | null;
  settled_by: string | null;
};

export const weeksQueryOptions = (challengeId: string) =>
  queryOptions({
    queryKey: ["challenge-weeks", challengeId],
    staleTime: 60_000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("challenge_weeks")
        .select("*")
        .eq("challenge_id", challengeId)
        .order("week_number", { ascending: false });
      if (error) throw error;
      return (data ?? []) as unknown as WeekRow[];
    },
  });

export function useWeeks(challengeId: string | undefined) {
  return useQuery({
    ...weeksQueryOptions(challengeId ?? ""),
    enabled: !!challengeId,
  });
}

export const paymentsQueryOptions = (challengeId: string) =>
  queryOptions({
    queryKey: ["challenge-payments", challengeId],
    staleTime: 30_000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("challenge_payments")
        .select("*")
        .eq("challenge_id", challengeId)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return (data ?? []) as unknown as PaymentRow[];
    },
  });

export function usePayments(challengeId: string | undefined) {
  return useQuery({
    ...paymentsQueryOptions(challengeId ?? ""),
    enabled: !!challengeId,
  });
}

export const eur = (n: number) =>
  `€${new Intl.NumberFormat("en", { maximumFractionDigits: 2 }).format(n)}`;
export const km = (n: number) => `${n.toFixed(1)} km`;

/** Marks every open obligation of the signed-in payer as settled in one step. */
export async function settleMyDebts(challengeId: string, userId: string) {
  const { error } = await supabase
    .from("challenge_payments")
    .update({ status: "confirmed_paid" })
    .eq("challenge_id", challengeId)
    .eq("payer_id", userId)
    .neq("status", "confirmed_paid");
  if (error) throw error;
}

/** Reopens a settle done by the signed-in user, in case it was a mistake. */
export async function reopenPayment(paymentId: string) {
  const { error } = await supabase
    .from("challenge_payments")
    .update({ status: "unpaid" })
    .eq("id", paymentId);
  if (error) throw error;
}
