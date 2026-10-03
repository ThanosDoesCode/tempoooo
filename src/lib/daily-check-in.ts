import { parseDecimal } from "./numeric.ts";
import type { DailyLog } from "./types.ts";

export type CheckInDraft = {
  weight: string;
  sleep: string;
  quality: number | null;
  steps: string;
  waist: string;
  restingHr: string;
};
export function checkInDraft(day?: DailyLog, weight?: number, yesterday?: DailyLog): CheckInDraft {
  return {
    weight: weight == null ? "" : String(weight),
    sleep: day?.sleepHours == null ? "" : String(day.sleepHours),
    quality: day?.sleepQuality ?? null,
    steps: yesterday?.steps == null ? "" : String(yesterday.steps),
    waist: day?.waist == null ? "" : String(day.waist),
    restingHr: day?.restingHr == null ? "" : String(day.restingHr),
  };
}
export function validateCheckIn(draft: CheckInDraft) {
  const errors: string[] = [];
  const number = (raw: string, label: string, min: number, max: number) => {
    if (!raw.trim()) return undefined;
    const parsed = parseDecimal(raw);
    if (parsed.kind !== "value" || parsed.value < min || parsed.value > max) {
      errors.push(`Enter ${label} between ${min} and ${max}.`);
      return undefined;
    }
    return parsed.value;
  };
  const weight = number(draft.weight, "weight in kg", 20, 400);
  const sleep = number(draft.sleep, "sleep hours", 0, 24);
  const steps = number(draft.steps, "steps", 0, 200000);
  const waist = number(draft.waist, "waist in cm", 20, 300);
  const restingHr = number(draft.restingHr, "resting heart rate", 20, 250);
  if (steps != null && !Number.isInteger(steps)) errors.push("Steps must be a whole number.");
  if (
    draft.quality != null &&
    (!Number.isInteger(draft.quality) || draft.quality < 1 || draft.quality > 5)
  )
    errors.push("Choose sleep quality from 1 to 5.");
  if (
    weight == null &&
    sleep == null &&
    steps == null &&
    waist == null &&
    restingHr == null &&
    draft.quality == null &&
    !errors.length
  )
    errors.push("Enter a check-in value before saving.");
  return {
    errors,
    weight,
    steps,
    patch: {
      ...(sleep != null ? { sleepHours: sleep } : {}),
      ...(draft.quality != null ? { sleepQuality: draft.quality } : {}),
      ...(waist != null ? { waist } : {}),
      ...(restingHr != null ? { restingHr } : {}),
    } satisfies Partial<DailyLog>,
  };
}
