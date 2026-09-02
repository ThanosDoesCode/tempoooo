import { addDays, format, parseISO } from "date-fns";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { getRelatedProfiles } from "./privileged-rpcs.functions";

export type Challenge = {
  id: string;
  created_by: string;
  name: string;
  start_date: string;
  duration_weeks: number;
  timezone: string;
  weekly_target_km: number;
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
};

export const TIERS = [
  { min: 15, penalty: 0, label: "15.00 km or more" },
  { min: 10, penalty: 5, label: "10.00 to 14.99 km" },
  { min: 5, penalty: 10, label: "5.00 to 9.99 km" },
  { min: 0, penalty: 15, label: "Below 5.00 km" },
];

export const DEFAULT_TARGET_KM = 15;

/** Mirrors the database penalty_for() function. Official values always come from the server. */
export function penaltyFor(equivalentKm: number, targetKm: number = DEFAULT_TARGET_KM) {
  if (targetKm <= 0 || equivalentKm >= 15) return 0;
  if (equivalentKm >= 10) return 5;
  if (equivalentKm >= 5) return 10;
  return 15;
}

/** Forfeit rule: one photo for every 5 euro owed. */
export const photosFor = (euros: number) => Math.floor(Math.max(0, euros) / 5);

export const photoText = (euros: number) => {
  const n = photosFor(euros);
  return n === 0 ? "" : `${n} photo${n > 1 ? "s" : ""}`;
};

/** "€10 + 2 photos" for any owed amount, "€0" when nothing is owed. */
export const owedText = (euros: number) => {
  const p = photoText(euros);
  return p ? `${eur(euros)} + ${p}` : eur(euros);
};

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
export function useMyChallenge() {
  return useQuery({
    queryKey: ["challenge"],
    staleTime: 5 * 60_000,
    queryFn: async () => {
      const { data: auth } = await supabase.auth.getUser();
      const uid = auth.user?.id;
      if (!uid) return null;
      const memberships = await supabase
        .from("challenge_members")
        .select("challenge_id, joined_at")
        .eq("user_id", uid)
        .order("joined_at", { ascending: false });
      if (memberships.error) throw memberships.error;
      const ids = (memberships.data ?? []).map((m) => m.challenge_id);
      if (ids.length === 0) return null;
      const { data, error } = await supabase
        .from("challenges")
        .select(
          "id, created_by, name, start_date, duration_weeks, timezone, weekly_target_km, running_ratio, cycling_ratio, max_members, status",
        )
        .in("id", ids)
        .order("created_at", { ascending: false })
        .limit(1);
      if (error) throw error;
      return (data?.[0] as Challenge | undefined) ?? null;
    },
  });
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
      const names = new Map(
        (profiles ?? []).map((p) => [p.id, p.display_name || p.email || "Athlete"]),
      );
      return (members.data ?? []).map((m) => ({
        userId: m.user_id,
        name: names.get(m.user_id) ?? "Athlete",
      }));
    },
  });
}

export function useActivities(challengeId: string | undefined) {
  return useQuery({
    enabled: !!challengeId,
    queryKey: ["challenge-activities", challengeId],
    staleTime: 30_000,
    queryFn: async () => {
      const rows: Activity[] = [];
      const pageSize = 500;
      for (let from = 0; ; from += pageSize) {
        const { data, error } = await supabase
          .from("challenge_activities")
          .select("*")
          .eq("challenge_id", challengeId!)
          .order("activity_date", { ascending: false })
          .order("created_at", { ascending: false })
          .order("id", { ascending: true })
          .range(from, from + pageSize - 1);
        if (error) throw error;
        const page = (data ?? []) as unknown as Activity[];
        rows.push(...page);
        if (page.length < pageSize) break;
      }
      return rows;
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

export function useWeeks(challengeId: string | undefined) {
  return useQuery({
    enabled: !!challengeId,
    queryKey: ["challenge-weeks", challengeId],
    staleTime: 60_000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("challenge_weeks")
        .select("*")
        .eq("challenge_id", challengeId!)
        .order("week_number", { ascending: false });
      if (error) throw error;
      return (data ?? []) as unknown as WeekRow[];
    },
  });
}

export function usePayments(challengeId: string | undefined) {
  return useQuery({
    enabled: !!challengeId,
    queryKey: ["challenge-payments", challengeId],
    staleTime: 30_000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("challenge_payments")
        .select("*")
        .eq("challenge_id", challengeId!)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return (data ?? []) as unknown as PaymentRow[];
    },
  });
}

export const eur = (n: number) => `€${n.toFixed(0)}`;
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
