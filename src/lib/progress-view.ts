import { subDays } from "date-fns";
import { useState } from "react";

import { useBulkProgressPhotos, useBulkWeights } from "./bulk-progress-query.ts";
import { useCompletedSessionDates } from "./bulk-training-sessions.ts";
import { iso } from "./calc.ts";
import { useMyChallenge } from "./challenge.ts";
import {
  availableProgressSections,
  hasBodyFoodData,
  hasStrengthData,
  type ProgressSection,
} from "./progress-sections.ts";
import { useProgressMode } from "./progress-model.ts";
import { defaultTrackedLifts } from "./strength-estimates.ts";
import { useAppData } from "./store.ts";
import type { AppData } from "./types.ts";

export type { ProgressSection } from "./progress-sections.ts";

/**
 * Which Progress sections the signed-in user has usable data for. Works in both modes: legacy uses
 * the store's logs; public/normalized uses the Supabase-backed weight/session/photo rows. Delegates
 * to the pure `availableProgressSections`, so an empty product area is never shown.
 */
export function useProgressSections(): { sections: ProgressSection[]; hasChallenge: boolean } {
  const data = useAppData();
  const { mode, publicId } = useProgressMode();
  const hasChallenge = !!useMyChallenge().data;
  const weights = useBulkWeights(publicId, iso(subDays(new Date(), 400)));
  const sessionDates = useCompletedSessionDates(publicId, "2000-01-01", iso(new Date()));
  const photos = useBulkProgressPhotos(publicId);

  const legacyStrength = !!data && hasStrengthData(data);
  const legacyBodyFood = !!data && hasBodyFoodData(data);
  const hasStrength =
    mode === "public" ? (sessionDates.data?.length ?? 0) > 0 || legacyStrength : legacyStrength;
  const hasBodyFood =
    mode === "public"
      ? (weights.data?.length ?? 0) > 0 || (photos.data?.length ?? 0) > 0 || legacyBodyFood
      : legacyBodyFood;

  return {
    sections: availableProgressSections({ hasChallenge, hasStrength, hasBodyFood }),
    hasChallenge,
  };
}

const PERIOD_KEY = "tempo:progress-period-weeks";
export const PERIOD_OPTIONS = [4, 8, 12] as const;

function readPeriod(): number {
  try {
    const raw = Number(localStorage.getItem(PERIOD_KEY));
    if (PERIOD_OPTIONS.includes(raw as (typeof PERIOD_OPTIONS)[number])) return raw;
  } catch {
    /* storage may be unavailable */
  }
  return 4;
}

/**
 * The period selection shared across Progress views. A per-viewer UI preference, so it lives in
 * localStorage (no migration needed) and reads back to 4 weeks when storage is unavailable.
 */
export function usePeriodWeeks(): [number, (weeks: number) => void] {
  const [weeks, setWeeks] = useState(readPeriod);
  const update = (next: number) => {
    setWeeks(next);
    try {
      localStorage.setItem(PERIOD_KEY, String(next));
    } catch {
      /* ignore */
    }
  };
  return [weeks, update];
}

const TRACKED_KEY = "tempo:progress-tracked-lifts";

/**
 * The user's tracked main lifts for the Strength view. Defaults to the first lift of each plan day
 * and remembers an explicit choice as a per-viewer preference (localStorage, no migration).
 */
export function useTrackedLifts(data: AppData): [string[], (names: string[]) => void] {
  const [override, setOverride] = useState<string[] | null>(() => {
    try {
      const raw = localStorage.getItem(TRACKED_KEY);
      const parsed = raw ? (JSON.parse(raw) as unknown) : null;
      return Array.isArray(parsed) && parsed.every((name) => typeof name === "string")
        ? (parsed as string[])
        : null;
    } catch {
      return null;
    }
  });
  const update = (names: string[]) => {
    setOverride(names);
    try {
      localStorage.setItem(TRACKED_KEY, JSON.stringify(names));
    } catch {
      /* ignore */
    }
  };
  return [override ?? defaultTrackedLifts(data), update];
}

export const chartAxis = {
  tick: { fontSize: 10, fill: "var(--color-muted-foreground)" },
  axisLine: false,
  tickLine: false,
} as const;

export const chartTooltip = {
  contentStyle: {
    background: "var(--color-card)",
    border: "1px solid var(--color-border)",
    borderRadius: 12,
    fontSize: 12,
  },
} as const;
