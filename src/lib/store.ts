import { useCallback, useSyncExternalStore } from "react";
import { supabase } from "@/integrations/supabase/client";
import {
  DEFAULT_DATA,
  type AppData,
  type DailyLog,
  type PhotoSet,
  type Targets,
  type Workout,
} from "./types";

type Json = never;
const json = (v: unknown) => v as Json;

export type BulkRole = "owner" | "editor" | "viewer";

let bulkId: string | null = null;
let role: BulkRole = "viewer";
let state: AppData | null = null;
const listeners = new Set<() => void>();

function emit() {
  state = state ? { ...state } : null;
  listeners.forEach((l) => l());
}

function subscribe(cb: () => void) {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

export function useAppData(): AppData | null {
  return useSyncExternalStore(
    subscribe,
    () => state,
    () => null,
  );
}

export function useBulkMeta(): { bulkId: string | null; role: BulkRole } {
  return useSyncExternalStore(
    subscribe,
    () => metaSnapshot(),
    () => emptyMeta,
  );
}

type BulkMeta = { bulkId: string | null; role: BulkRole };
const emptyMeta: BulkMeta = { bulkId: null, role: "viewer" };
let meta: BulkMeta = emptyMeta;
function metaSnapshot() {
  if (meta.bulkId !== bulkId || meta.role !== role) meta = { bulkId, role };
  return meta;
}

export const getBulkId = () => bulkId;
export const getBulkRole = () => role;
export const canWrite = () => role === "owner" || role === "editor";

async function signPhotos(rows: PhotoRow[]): Promise<PhotoSet[]> {
  const paths = rows.flatMap((r) =>
    [r.front_path, r.side_path, r.back_path].filter((p): p is string => !!p),
  );
  const map = new Map<string, string>();
  if (paths.length) {
    const { data } = await supabase.storage
      .from("bulk-progress-photos")
      .createSignedUrls(paths, 60 * 60);
    data?.forEach((s) => {
      if (s.path && s.signedUrl) map.set(s.path, s.signedUrl);
    });
  }
  return rows.map((r) => ({
    id: r.id,
    date: r.taken_on,
    ...(r.weight != null ? { weight: Number(r.weight) } : {}),
    ...(r.front_path ? { front: map.get(r.front_path) } : {}),
    ...(r.side_path ? { side: map.get(r.side_path) } : {}),
    ...(r.back_path ? { back: map.get(r.back_path) } : {}),
  }));
}

type PhotoRow = {
  id: string;
  taken_on: string;
  weight: number | null;
  front_path: string | null;
  side_path: string | null;
  back_path: string | null;
};

export async function loadBulk(id: string, r: BulkRole) {
  bulkId = id;
  role = r;
  state = null;
  emit();

  const [targets, days, workouts, notes, photos] = await Promise.all([
    supabase.from("bulk_targets").select("payload").eq("bulk_profile_id", id).maybeSingle(),
    supabase.from("bulk_days").select("day,payload").eq("bulk_profile_id", id),
    supabase.from("bulk_workouts").select("day,payload").eq("bulk_profile_id", id),
    supabase.from("bulk_week_notes").select("week_start,note").eq("bulk_profile_id", id),
    supabase
      .from("bulk_photos")
      .select("id,taken_on,weight,front_path,side_path,back_path")
      .eq("bulk_profile_id", id)
      .order("taken_on"),
  ]);

  const next: AppData = {
    days: {},
    workouts: {},
    weekNotes: {},
    photos: await signPhotos((photos.data ?? []) as PhotoRow[]),
    targets: { ...DEFAULT_DATA.targets, ...((targets.data?.payload ?? {}) as Partial<Targets>) },
  };
  (days.data ?? []).forEach((row) => {
    next.days[row.day] = { ...(row.payload as DailyLog), date: row.day };
  });
  (workouts.data ?? []).forEach((row) => {
    next.workouts[row.day] = row.payload as Workout;
  });
  (notes.data ?? []).forEach((row) => {
    next.weekNotes[row.week_start] = row.note;
  });

  state = next;
  emit();
}

export function clearBulk() {
  bulkId = null;
  state = null;
  emit();
}

export function useActions() {
  const saveDay = useCallback(async (date: string, patch: Partial<DailyLog>) => {
    if (!state || !bulkId || !canWrite()) return;
    const merged: DailyLog = { ...state.days[date], ...patch, date };
    state.days[date] = merged;
    emit();
    await supabase
      .from("bulk_days")
      .upsert({ bulk_profile_id: bulkId, day: date, payload: json(merged) }, {
        onConflict: "bulk_profile_id,day",
      });
  }, []);

  const saveWorkout = useCallback(async (workout: Workout) => {
    if (!state || !bulkId || !canWrite()) return;
    state.workouts[workout.date] = workout;
    emit();
    await supabase.from("bulk_workouts").upsert(
      { bulk_profile_id: bulkId, day: workout.date, payload: json(workout) },
      { onConflict: "bulk_profile_id,day" },
    );
  }, []);

  const setWeekNote = useCallback(async (weekStart: string, note: string) => {
    if (!state || !bulkId || !canWrite()) return;
    state.weekNotes[weekStart] = note;
    emit();
    await supabase.from("bulk_week_notes").upsert(
      { bulk_profile_id: bulkId, week_start: weekStart, note },
      { onConflict: "bulk_profile_id,week_start" },
    );
  }, []);

  const saveTargets = useCallback(async (targets: Targets) => {
    if (!state || !bulkId || !canWrite()) return;
    state.targets = targets;
    emit();
    await supabase
      .from("bulk_targets")
      .upsert({ bulk_profile_id: bulkId, payload: json(targets) }, { onConflict: "bulk_profile_id" });
  }, []);

  const addPhotoSet = useCallback(async (date: string, weight?: number) => {
    if (!state || !bulkId || !canWrite()) return;
    const { data } = await supabase
      .from("bulk_photos")
      .insert({ bulk_profile_id: bulkId, taken_on: date, weight: weight ?? null })
      .select("id")
      .single();
    if (!data) return;
    state.photos = [...state.photos, { id: data.id, date, ...(weight ? { weight } : {}) }].sort(
      (a, b) => a.date.localeCompare(b.date),
    );
    emit();
  }, []);

  const setPhotoImage = useCallback(
    async (photoId: string, slot: "front" | "side" | "back", dataUrl: string) => {
      if (!state || !bulkId || !canWrite()) return;
      const blob = await (await fetch(dataUrl)).blob();
      const path = `${bulkId}/${photoId}/${slot}-${Date.now()}.jpg`;
      const up = await supabase.storage
        .from("bulk-progress-photos")
        .upload(path, blob, { contentType: "image/jpeg" });
      if (up.error) return;
      await supabase
        .from("bulk_photos")
        .update(json({ [`${slot}_path`]: path }))
        .eq("id", photoId);
      const { data } = await supabase.storage
        .from("bulk-progress-photos")
        .createSignedUrl(path, 60 * 60);
      state.photos = state.photos.map((p) =>
        p.id === photoId ? { ...p, [slot]: data?.signedUrl } : p,
      );
      emit();
    },
    [],
  );

  const importBackup = useCallback(async (parsed: AppData) => {
    if (!bulkId || !canWrite()) return;
    const id = bulkId;
    const days = Object.values(parsed.days ?? {}).map((d) => ({
      bulk_profile_id: id,
      day: d.date,
      payload: json(d),
    }));
    const workouts = Object.values(parsed.workouts ?? {}).map((w) => ({
      bulk_profile_id: id,
      day: w.date,
      payload: json(w),
    }));
    const notes = Object.entries(parsed.weekNotes ?? {}).map(([week_start, note]) => ({
      bulk_profile_id: id,
      week_start,
      note,
    }));
    if (days.length)
      await supabase.from("bulk_days").upsert(days, { onConflict: "bulk_profile_id,day" });
    if (workouts.length)
      await supabase.from("bulk_workouts").upsert(workouts, { onConflict: "bulk_profile_id,day" });
    if (notes.length)
      await supabase
        .from("bulk_week_notes")
        .upsert(notes, { onConflict: "bulk_profile_id,week_start" });
    if (parsed.targets)
      await supabase
        .from("bulk_targets")
        .upsert(
          { bulk_profile_id: id, payload: json({ ...DEFAULT_DATA.targets, ...parsed.targets }) },
          { onConflict: "bulk_profile_id" },
        );
    await loadBulk(id, role);
  }, []);

  return {
    saveDay,
    saveWorkout,
    setWeekNote,
    saveTargets,
    addPhotoSet,
    setPhotoImage,
    importBackup,
  };
}
