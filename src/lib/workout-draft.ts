import type { Workout } from "./types.ts";
import { EXERCISES } from "./types.ts";

/** Scoped to the authenticated user + bulk plan + date by the caller. Only unsynced edits live here. */
export function readWorkoutDraft(key: string, date: string): Workout | null {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    const w = JSON.parse(raw) as Workout;
    if (
      w.date !== date ||
      !Object.hasOwn(EXERCISES, w.type) ||
      !Array.isArray(w.entries) ||
      !w.entries.every((e) => typeof e.exercise === "string" && Array.isArray(e.reps))
    )
      return null;
    return w;
  } catch {
    return null;
  }
}

export function cacheWorkoutDraft(key: string, workout: Workout | null): boolean {
  try {
    if (workout) localStorage.setItem(key, JSON.stringify(workout));
    else localStorage.removeItem(key);
    return true;
  } catch {
    return false;
  }
}

/** A late save from an unmounted editor must not erase newer unsynced edits. */
export function clearWorkoutDraft(key: string, saved: Workout): boolean {
  try {
    if (localStorage.getItem(key) === JSON.stringify(saved)) localStorage.removeItem(key);
    return true;
  } catch {
    return false;
  }
}
