import { queryOptions, useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { assertCurrentAuthIdentity, captureAuthIdentity, useAuth } from "./auth";
import { useBulkMeta } from "./store";
import { useCompletedSessionDates } from "./bulk-training-sessions";
import { useBulkProgressNutrition } from "./bulk-progress-query";
import { nutritionWeekSummary } from "./bulk-progress";
import {
  resolvedTargetForWeek,
  useActivitySummary,
  useMyChallenge,
  useTravelPauses,
  useWeekTargets,
} from "./challenge";
import {
  parseStreakResponse,
  type RingKey,
  type StreakData,
  type StreakThisWeek,
} from "./streak-model";

export const localTimezone = () => Intl.DateTimeFormat().resolvedOptions().timeZone;

export const streakQueryOptions = (userId: string | null) => {
  const tz = localTimezone();
  return queryOptions({
    queryKey: ["streak", userId, tz],
    enabled: !!userId,
    staleTime: 60_000,
    queryFn: async ({ signal }): Promise<StreakData> => {
      const revision = captureAuthIdentity();
      // Account cleanup refetches active observers; an old observer must not read as the new user.
      assertCurrentAuthIdentity(revision, signal, userId);
      const { data, error } = await supabase
        .rpc("recompute_streak", { _timezone: tz })
        .abortSignal(signal);
      assertCurrentAuthIdentity(revision, signal, userId);
      if (error) throw error;
      return parseStreakResponse(data);
    },
  });
};

/** The authoritative streak: headline (locked weeks only), this week's rings, recent weeks. */
export const useStreak = () => {
  const { user } = useAuth();
  return useQuery(streakQueryOptions(user?.id ?? null));
};

export type RingProgress =
  | { kind: "count"; current: number; target: number | null; unit?: string }
  | { kind: "multiLeg"; legCount: number; completed: number };
export type ThisWeekRingProgress = Partial<Record<RingKey, RingProgress>>;

/** Frozen Train/Eat targets for a streak week (owner-scoped read of the persisted row). */
function useStreakFrozen(userId: string | null, weekStart: string | null, enabled: boolean) {
  return useQuery({
    queryKey: ["streak-frozen", userId, weekStart],
    enabled: enabled && !!userId && !!weekStart,
    staleTime: 60_000,
    queryFn: async ({ signal }) => {
      const revision = captureAuthIdentity();
      assertCurrentAuthIdentity(revision, signal, userId);
      const { data, error } = await supabase
        .from("streak_weeks")
        .select("train_target_workouts,eat_required_days")
        .eq("user_id", userId!)
        .eq("week_start", weekStart!)
        .abortSignal(signal)
        .maybeSingle();
      assertCurrentAuthIdentity(revision, signal, userId);
      if (error) throw error;
      return {
        trainTarget: data?.train_target_workouts ?? null,
        eatRequired: data?.eat_required_days ?? 5,
      };
    },
  });
}

/**
 * Live progress numbers for this week's active rings, reusing the app's canonical sources (the
 * Challenge week for Run, completed sessions for Train, calorie adherence for Eat). The pass/fail
 * state itself is authoritative from the streak RPC; these numbers are a progress hint only.
 */
export function useThisWeekRingProgress(thisWeek: StreakThisWeek | null): ThisWeekRingProgress {
  const { user } = useAuth();
  const userId = user?.id ?? null;
  const { bulkId } = useBulkMeta();
  const weekStart = thisWeek?.weekStart ?? null;
  const weekEnd = thisWeek?.weekEnd ?? weekStart ?? "";
  const active = (key: RingKey) => thisWeek?.rings.find((r) => r.key === key)?.active ?? false;
  const runActive = active("run");
  const trainActive = active("train");
  const eatActive = active("eat");

  // Run: source from the frozen legs mapped into THIS account week. Not useMyChallenge (which
  // picks the most-recently-joined Challenge) and not the Challenge's currently-visible week
  // (whose end instant may map to a different account week) — use each leg's own challenge + week.
  const legs =
    useQuery({
      queryKey: ["streak-run-legs", userId, weekStart],
      enabled: runActive && !!userId && !!weekStart,
      staleTime: 60_000,
      queryFn: async ({ signal }) => {
        const revision = captureAuthIdentity();
        assertCurrentAuthIdentity(revision, signal, userId);
        const { data, error } = await supabase
          .from("streak_week_run_legs")
          .select(
            "source_challenge_id,challenge_week_number,challenge_week_start,challenge_week_end,target_km,settlement_state",
          )
          .eq("user_id", userId!)
          .eq("week_start", weekStart!)
          .abortSignal(signal);
        assertCurrentAuthIdentity(revision, signal, userId);
        if (error) throw error;
        return data ?? [];
      },
    }).data ?? [];
  const singleLeg = legs.length === 1 ? legs[0] : null;
  const runChallenge = useMyChallenge(singleLeg?.source_challenge_id).data;
  const overrides = useWeekTargets(singleLeg?.source_challenge_id).data;
  const pauses = useTravelPauses(singleLeg?.source_challenge_id).data;
  const summary = useActivitySummary(
    singleLeg?.source_challenge_id,
    singleLeg
      ? { start: singleLeg.challenge_week_start, end: singleLeg.challenge_week_end }
      : undefined,
  );

  const frozen = useStreakFrozen(userId, weekStart, trainActive || eatActive);
  const sessions = useCompletedSessionDates(trainActive ? bulkId : null, weekStart ?? "", weekEnd);
  const nutrition = useBulkProgressNutrition(eatActive ? bulkId : null, weekStart, weekEnd);

  const progress: ThisWeekRingProgress = {};
  if (runActive) {
    if (legs.length > 1) {
      // Independent Challenges: never sum km across them. Show how many have been kept.
      progress.run = {
        kind: "multiLeg",
        legCount: legs.length,
        completed: legs.filter((l) => l.settlement_state === "completed").length,
      };
    } else if (singleLeg && runChallenge && user) {
      const mine = summary.data?.find((s) => s.userId === user.id);
      const target =
        singleLeg.target_km != null
          ? Number(singleLeg.target_km)
          : resolvedTargetForWeek(
              runChallenge,
              overrides,
              pauses,
              user.id,
              singleLeg.challenge_week_number,
            );
      progress.run = {
        kind: "count",
        current: Math.round((mine?.equivalent ?? 0) * 10) / 10,
        target,
        unit: "km",
      };
    }
  }
  if (trainActive) {
    const done = sessions.data?.filter((s) => s.status === "completed").length ?? 0;
    progress.train = { kind: "count", current: done, target: frozen.data?.trainTarget ?? null };
  }
  if (eatActive && weekStart) {
    const adherent = nutrition.data
      ? nutritionWeekSummary(nutrition.data, weekStart).calorieAdherentDays
      : 0;
    progress.eat = {
      kind: "count",
      current: adherent,
      target: frozen.data?.eatRequired ?? 5,
      unit: "days",
    };
  }
  return progress;
}
