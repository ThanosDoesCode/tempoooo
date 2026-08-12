import { useCallback, useSyncExternalStore } from "react";
import { DEFAULT_DATA, type AppData, type DailyLog, type Workout } from "./types";

const KEY = "lean-bulk-tracker.v1";

let state: AppData = DEFAULT_DATA;
let loaded = false;
const listeners = new Set<() => void>();

function emit() {
  listeners.forEach((l) => l());
}

function load() {
  if (loaded || typeof window === "undefined") return;
  loaded = true;
  try {
    const raw = window.localStorage.getItem(KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<AppData>;
      state = {
        ...DEFAULT_DATA,
        ...parsed,
        targets: { ...DEFAULT_DATA.targets, ...(parsed.targets ?? {}) },
      };
    }
  } catch {
    state = DEFAULT_DATA;
  }
}

function persist() {
  try {
    window.localStorage.setItem(KEY, JSON.stringify(state));
  } catch {
    /* quota */
  }
}

function subscribe(cb: () => void) {
  load();
  listeners.add(cb);
  return () => listeners.delete(cb);
}

export function setData(updater: (prev: AppData) => AppData) {
  load();
  state = updater(state);
  persist();
  emit();
}

export function useAppData(): AppData | null {
  return useSyncExternalStore(
    subscribe,
    () => {
      load();
      return state;
    },
    () => null,
  );
}

export function useActions() {
  const saveDay = useCallback((date: string, patch: Partial<DailyLog>) => {
    setData((prev) => ({
      ...prev,
      days: { ...prev.days, [date]: { ...prev.days[date], ...patch, date } },
    }));
  }, []);

  const saveWorkout = useCallback((workout: Workout) => {
    setData((prev) => ({
      ...prev,
      workouts: { ...prev.workouts, [workout.date]: workout },
    }));
  }, []);

  const setWeekNote = useCallback((weekStart: string, note: string) => {
    setData((prev) => ({ ...prev, weekNotes: { ...prev.weekNotes, [weekStart]: note } }));
  }, []);

  return { saveDay, saveWorkout, setWeekNote, setData };
}
