import { useCallback, useSyncExternalStore } from "react";
import { supabase } from "@/integrations/supabase/client";
import { createSaveQueue } from "./workout-save";
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
const queueWorkoutSave = createSaveQueue();

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
export const isOwner = () => role === "owner";

/** Storage object paths per photo set, needed to clean up files on delete. */
const photoPaths = new Map<string, string[]>();

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
  rows.forEach((r) =>
    photoPaths.set(
      r.id,
      [r.front_path, r.side_path, r.back_path].filter((p): p is string => !!p),
    ),
  );
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

  const failed = [targets.error, days.error, workouts.error, notes.error, photos.error].find(
    (error) => error !== null,
  );
  if (failed) {
    bulkId = null;
    state = null;
    emit();
    throw new Error(failed.message);
  }

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

/**
 * Owner-only wipe of a plan's logged data. Usable even when the plan is not
 * the one currently loaded in the store (for example from the profile page).
 */
export async function resetBulkData(
  id: string,
  opts: { photos: boolean; targets: boolean } = { photos: true, targets: false },
) {
  for (const table of ["bulk_days", "bulk_workouts", "bulk_week_notes"] as const) {
    const { error } = await supabase.from(table).delete().eq("bulk_profile_id", id);
    if (error) throw new Error(error.message);
  }
  if (opts.photos) {
    const { data: rows } = await supabase
      .from("bulk_photos")
      .select("front_path,side_path,back_path")
      .eq("bulk_profile_id", id);
    const all = (rows ?? []).flatMap((r) =>
      [r.front_path, r.side_path, r.back_path].filter((p): p is string => !!p),
    );
    if (all.length) await supabase.storage.from("bulk-progress-photos").remove(all);
    const { error } = await supabase.from("bulk_photos").delete().eq("bulk_profile_id", id);
    if (error) throw new Error(error.message);
    photoPaths.clear();
  }
  if (opts.targets) {
    const { error } = await supabase
      .from("bulk_targets")
      .upsert(
        { bulk_profile_id: id, payload: json(DEFAULT_DATA.targets) },
        { onConflict: "bulk_profile_id" },
      );
    if (error) throw new Error(error.message);
  }
  if (bulkId === id) await loadBulk(id, role);
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
    await supabase.from("bulk_days").upsert(
      { bulk_profile_id: bulkId, day: date, payload: json(merged) },
      {
        onConflict: "bulk_profile_id,day",
      },
    );
  }, []);

  const saveWorkout = useCallback(async (workout: Workout, expectedUserId?: string) => {
    if (!state || !bulkId || !canWrite()) throw new Error("This workout cannot be edited.");
    if (!expectedUserId) throw new Error("Reopen Training before saving this workout.");
    const id = bulkId;
    return queueWorkoutSave(async () => {
      const current = await supabase.auth.getSession();
      if (bulkId !== id || !canWrite() || current.data.session?.user.id !== expectedUserId)
        throw new Error("Account or plan changed. Reopen Training before saving.");
      const { error } = await supabase
        .from("bulk_workouts")
        .upsert(
          { bulk_profile_id: id, day: workout.date, payload: json(workout) },
          { onConflict: "bulk_profile_id,day" },
        );
      if (error) throw new Error(error.message);
      // Completed totals use server-confirmed saves only.
      const after = await supabase.auth.getSession();
      if (state && bulkId === id && after.data.session?.user.id === expectedUserId) {
        state.workouts = { ...state.workouts, [workout.date]: workout };
        emit();
      }
    });
  }, []);

  const setWeekNote = useCallback(async (weekStart: string, note: string) => {
    if (!state || !bulkId || !canWrite()) return;
    state.weekNotes[weekStart] = note;
    emit();
    await supabase
      .from("bulk_week_notes")
      .upsert(
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
      .upsert(
        { bulk_profile_id: bulkId, payload: json(targets) },
        { onConflict: "bulk_profile_id" },
      );
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

  const deletePhotoSet = useCallback(async (photoId: string) => {
    if (!state || !bulkId || !isOwner()) return;
    const paths = photoPaths.get(photoId) ?? [];
    if (paths.length) await supabase.storage.from("bulk-progress-photos").remove(paths);
    const { error } = await supabase.from("bulk_photos").delete().eq("id", photoId);
    if (error) throw new Error(error.message);
    photoPaths.delete(photoId);
    state.photos = state.photos.filter((p) => p.id !== photoId);
    emit();
  }, []);

  const deleteDay = useCallback(async (date: string) => {
    if (!state || !bulkId || !isOwner()) return;
    const { error } = await supabase
      .from("bulk_days")
      .delete()
      .eq("bulk_profile_id", bulkId)
      .eq("day", date);
    if (error) throw new Error(error.message);
    delete state.days[date];
    emit();
  }, []);

  const deleteWorkout = useCallback(async (date: string) => {
    if (!state || !bulkId || !isOwner()) return;
    const { error } = await supabase
      .from("bulk_workouts")
      .delete()
      .eq("bulk_profile_id", bulkId)
      .eq("day", date);
    if (error) throw new Error(error.message);
    delete state.workouts[date];
    emit();
  }, []);

  /** Owner-only wipe. Keeps the plan and its people, removes the logged data. */
  const resetBulkPlan = useCallback(
    async (opts: { photos: boolean; targets: boolean } = { photos: true, targets: false }) => {
      if (!bulkId || !isOwner()) return;
      await resetBulkData(bulkId, opts);
    },
    [],
  );

  return {
    saveDay,
    saveWorkout,
    setWeekNote,
    saveTargets,
    addPhotoSet,
    setPhotoImage,
    importBackup,
    deletePhotoSet,
    deleteDay,
    deleteWorkout,
    resetBulkPlan,
  };
}
