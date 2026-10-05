import { useState } from "react";

import { useMyChallenge } from "./challenge.ts";
import { availableProgressSections, type ProgressSection } from "./progress-sections.ts";
import { useProgressMode, useStrengthModel } from "./progress-model.ts";
import { useActiveTrainingPlan } from "./training-plans-query.ts";
import {
  defaultTrackedLifts,
  trackedLiftCandidates,
  resolveTrackedLifts,
} from "./strength-estimates.ts";
import { EXERCISES, orderedExerciseDefs, type AppData, type SplitType } from "./types.ts";

export type { ProgressSection } from "./progress-sections.ts";

/** Stable product sections in both fitness modes, independent of analytics history. */
export function useProgressSections(): { sections: ProgressSection[]; hasChallenge: boolean } {
  const { mode } = useProgressMode();
  const hasChallenge = !!useMyChallenge().data;
  return {
    sections: availableProgressSections({ hasFitnessTools: mode !== "none" }),
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

/** Plan-derived defaults with explicit per-profile preferences under the existing key. */
export function useTrackedLifts(
  data: AppData,
): [
  string[],
  (names: string[]) => void,
  () => void,
  { fromPlan: string[]; history: string[] },
  boolean,
] {
  const { publicId, bulkId, mode } = useProgressMode();
  const plan = useActiveTrainingPlan(publicId);
  const { records } = useStrengthModel();
  const scope = bulkId ?? "legacy";
  const read = (): string[] | null => {
    try {
      const parsed = JSON.parse(localStorage.getItem(TRACKED_KEY) ?? "null");
      const value = Array.isArray(parsed) ? parsed : parsed?.[scope];
      if (Array.isArray(parsed) && parsed.every((name) => typeof name === "string"))
        localStorage.setItem(TRACKED_KEY, JSON.stringify({ [scope]: parsed }));
      return Array.isArray(value) && value.every((name) => typeof name === "string") ? value : null;
    } catch {
      return null;
    }
  };
  const [saved, setSaved] = useState(() => ({ scope, value: read() }));
  const override = saved.scope === scope ? saved.value : read();
  const defaults = defaultTrackedLifts(mode === "public" ? (plan.data ?? null) : data);
  const candidates = trackedLiftCandidates(plan.data ?? null, records);
  if (mode !== "public")
    candidates.fromPlan = [
      ...new Set([
        ...defaults,
        ...(Object.keys(EXERCISES) as SplitType[]).flatMap((split) =>
          orderedExerciseDefs(data.targets, split).map((exercise) => exercise.name),
        ),
      ]),
    ];
  const available = [...new Set([...candidates.fromPlan, ...candidates.history, ...defaults])];
  const update = (names: string[] | null) => {
    setSaved({ scope, value: names });
    try {
      const old = JSON.parse(localStorage.getItem(TRACKED_KEY) ?? "null");
      const preferences = old && !Array.isArray(old) && typeof old === "object" ? old : {};
      if (names === null) delete preferences[scope];
      else preferences[scope] = names;
      localStorage.setItem(TRACKED_KEY, JSON.stringify(preferences));
    } catch {
      /* storage may be unavailable */
    }
  };
  return [
    resolveTrackedLifts(defaults, override, available),
    (names) => update(names),
    () => update(null),
    candidates,
    plan.isLoading,
  ];
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
