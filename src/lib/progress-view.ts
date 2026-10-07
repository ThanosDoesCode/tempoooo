import { useCallback, useSyncExternalStore, useState } from "react";

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

export { PROGRESS_PERIODS as PERIOD_OPTIONS } from "./progress-period.ts";
import {
  DEFAULT_PROGRESS_PERIOD,
  PROGRESS_PERIOD_KEY,
  isProgressPeriod,
  type ProgressPeriod,
} from "./progress-period.ts";
let memoryPeriod: ProgressPeriod = DEFAULT_PROGRESS_PERIOD;
const periodListeners = new Set<() => void>();
function readPeriod(): ProgressPeriod {
  try {
    const raw = localStorage.getItem(PROGRESS_PERIOD_KEY);
    if (isProgressPeriod(raw)) return raw;
  } catch {
    /* unavailable storage */
  }
  return memoryPeriod;
}
function subscribePeriod(listener: () => void) {
  periodListeners.add(listener);
  if (typeof window !== "undefined") window.addEventListener("storage", listener);
  return () => {
    periodListeners.delete(listener);
    if (typeof window !== "undefined") window.removeEventListener("storage", listener);
  };
}
/** Shared presentation preference; stable SSR default, no account data stored here. */
export function useProgressPeriod(): [ProgressPeriod, (period: ProgressPeriod) => void] {
  const period = useSyncExternalStore(subscribePeriod, readPeriod, () => DEFAULT_PROGRESS_PERIOD);
  const update = useCallback((next: ProgressPeriod) => {
    if (!isProgressPeriod(next)) return;
    memoryPeriod = next;
    try {
      localStorage.setItem(PROGRESS_PERIOD_KEY, next);
    } catch {
      /* unavailable storage */
    }
    periodListeners.forEach((listener) => listener());
  }, []);
  return [period, update];
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
  itemStyle: { color: "var(--color-foreground)" },
  labelStyle: { color: "var(--color-foreground)", fontWeight: 600 },
  allowEscapeViewBox: { x: false, y: false },
  isAnimationActive: false,
  contentStyle: {
    background: "var(--color-card)",
    border: "1px solid var(--color-border)",
    borderRadius: 12,
    fontSize: 12,
    color: "var(--color-foreground)",
    maxWidth: "min(240px, calc(100vw - 56px))",
  },
} as const;
