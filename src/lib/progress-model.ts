import { parseISO, subDays } from "date-fns";
import { useMemo } from "react";

import { bulkPlanModeFor, useMemberships, type BulkPlanMode } from "./bulk-access.ts";
import {
  useBulkProgressNutrition,
  useBulkProgressPhotoCount,
  useBulkWeights,
} from "./bulk-progress-query.ts";
import { useCompletedBulkTrainingSessions } from "./bulk-training-sessions.ts";
import { iso } from "./calc.ts";
import { collectCompletedWorkouts } from "./goal-metrics.ts";
import { recordedLegacyWorkouts } from "./workout-history.ts";
import {
  deriveLegacyPersonalRecords,
  derivePublicPersonalRecords,
  mergePersonalRecords,
  type PersonalRecord,
} from "./personal-records.ts";
import {
  nutritionWindow,
  resolvePhotoCount,
  weightTrend,
  weightPeriodTrend,
  type NutritionDay,
  type WeightByDate,
} from "./progress-model-core.ts";
import { progressRangeDays, progressEndInstant, type ProgressRange } from "./progress-period.ts";
import { useAppData, useBulkMeta } from "./store.ts";

export function useProgressMode() {
  const { bulkId } = useBulkMeta();
  const memberships = useMemberships();
  const mode: BulkPlanMode = bulkPlanModeFor(memberships.data, bulkId);
  return { mode, bulkId, publicId: mode === "public" ? bulkId : null };
}

/**
 * Mode-aware total count. Public counts metadata without fetching/signing gallery pages;
 * legacy counts the exhaustively loaded photo sets.
 */
export function usePhotoCount(): number {
  const data = useAppData();
  const { mode, publicId } = useProgressMode();
  const photos = useBulkProgressPhotoCount(publicId);
  return resolvePhotoCount(mode, photos.data ?? 0, data?.photos.length ?? 0);
}

/**
 * Current weight, 7-day average, this-week delta, a period trend series and goal progress — from
 * normalized weight entries in public mode, or legacy day logs otherwise. One shared trend
 * computation (`weightTrend`) runs over whichever source, so the maths never forks per mode.
 */
export function useWeightModel(selection: number | ProgressRange) {
  const data = useAppData();
  const { mode, publicId } = useProgressMode();
  const range = typeof selection === "number" ? null : selection;
  const spanDays = typeof selection === "number" ? selection : progressRangeDays(selection);
  const from = range
    ? range.start
      ? iso(subDays(parseISO(range.start), 6))
      : null
    : iso(subDays(new Date(), Math.max(spanDays, 90)));
  const weights = useBulkWeights(publicId, from, range?.end);

  const byDate = useMemo<WeightByDate>(() => {
    const map: WeightByDate = {};
    if (mode === "public") {
      for (const entry of weights.data ?? []) map[entry.logDate] = entry.weightKg;
    } else if (data) {
      for (const day of Object.values(data.days))
        if (day.weight != null) map[day.date] = day.weight;
    }
    return map;
  }, [mode, weights.data, data]);

  const trend = range ? weightPeriodTrend(byDate, range) : weightTrend(byDate, spanDays);
  const start = data?.targets.startWeight ?? 0;
  const target = data?.targets.targetWeight ?? 0;
  const latestKg = trend.latest?.weightKg ?? null;
  const gaining = target >= start;
  const remainingKg = latestKg != null ? target - latestKg : null;
  const pct =
    latestKg != null && target !== start
      ? Math.max(0, Math.min(100, ((latestKg - start) / (target - start)) * 100))
      : 0;

  return {
    ...trend,
    latestKg,
    goal: { start, target, gaining, remainingKg, pct },
    hasData: trend.latest != null,
    loading: mode === "public" ? weights.isLoading : !data,
  };
}

/**
 * Nutrition window summary. In public mode this uses the normalized per-day rows, so adherence is
 * judged against each day's own stored target snapshot (never today's target); legacy days fall
 * back to the current target. Carbs/fat exist only on the legacy path.
 */
export function useFoodModel(selection: number | ProgressRange) {
  const data = useAppData();
  const { mode, publicId } = useProgressMode();
  const range = typeof selection === "number" ? null : selection;
  const spanDays = typeof selection === "number" ? selection : progressRangeDays(selection);
  const today = range?.end ?? iso(new Date());
  const from = range ? range.start : iso(subDays(new Date(), Math.max(spanDays, 35)));
  const nutrition = useBulkProgressNutrition(publicId, from, today);
  const currentTarget = data?.targets.calories ?? 0;

  const days = useMemo<NutritionDay[]>(() => {
    if (mode === "public") {
      return (nutrition.data ?? []).map((day) => ({
        date: day.logDate,
        calories: day.calories,
        protein: day.protein,
        carbs: null,
        fat: null,
        target: day.targetCalories,
      }));
    }
    const out: NutritionDay[] = [];
    if (data) {
      for (const day of Object.values(data.days)) {
        if (day.calories == null) continue;
        out.push({
          date: day.date,
          calories: day.calories,
          protein: day.protein ?? null,
          carbs: day.carbs ?? null,
          fat: day.fat ?? null,
          target: currentTarget,
        });
      }
    }
    return out;
  }, [mode, nutrition.data, data, currentTarget]);

  return {
    ...nutritionWindow(days, spanDays, today, range ?? undefined),
    target: currentTarget,
    usesSnapshots: mode === "public",
    loading: mode === "public" ? nutrition.isLoading : !data,
  };
}

/**
 * Personal records and completed-workout dates for strength. Public mode merges normalized sessions
 * with any preserved legacy records (mirroring the PRs screen); legacy mode uses the legacy records.
 * `liftEstimate` then runs on the resulting `PersonalRecord[]` regardless of source.
 */
export function useStrengthModel() {
  const data = useAppData();
  const { mode, publicId } = useProgressMode();
  const sessions = useCompletedBulkTrainingSessions(publicId, null, progressEndInstant());
  // Reuse the hydrated complete sessions rather than fetching their dates again.

  const records = useMemo<PersonalRecord[]>(() => {
    if (!data || mode === "none") return [];
    return mode === "public"
      ? mergePersonalRecords(
          derivePublicPersonalRecords(sessions.data ?? []),
          deriveLegacyPersonalRecords(data),
        )
      : deriveLegacyPersonalRecords(data);
  }, [mode, sessions.data, data]);

  const workoutRecords = useMemo(
    () =>
      collectCompletedWorkouts({
        sessions: sessions.data ?? [],
        legacyWorkouts: recordedLegacyWorkouts(data),
      }),
    [sessions.data, data],
  );

  return {
    records,
    workoutRecords,
    error: sessions.error,
    refetch: sessions.refetch,
    loading: mode === "public" ? sessions.isLoading : !data,
  };
}
