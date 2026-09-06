import { queryOptions, useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { readRetryDelay, shouldRetryRead } from "./network-errors";
import type { BulkNutritionProgressDay, BulkProgressPhoto, BulkWeightEntry } from "./bulk-progress";

export const bulkWeightQueryKey = (profileId: string) =>
  ["bulk-weight-entries", profileId] as const;
export const bulkPhotoQueryKey = (profileId: string) =>
  ["bulk-progress-photos", profileId] as const;
export const bulkProgressNutritionQueryKey = (profileId: string, from: string, to: string) =>
  ["bulk-progress-summary", "nutrition", profileId, from, to] as const;

export const bulkWeightQueryOptions = (profileId: string | null, from: string) =>
  queryOptions({
    queryKey: bulkWeightQueryKey(profileId ?? ""),
    enabled: !!profileId,
    queryFn: async (): Promise<BulkWeightEntry[]> => {
      if (!profileId) return [];
      const { data, error } = await supabase
        .from("bulk_weight_entries")
        .select("*")
        .eq("bulk_profile_id", profileId)
        .gte("log_date", from)
        .order("log_date", { ascending: false })
        .limit(180);
      if (error) throw error;
      return (data ?? []).map((row) => ({
        id: row.id,
        bulkProfileId: row.bulk_profile_id,
        logDate: row.log_date,
        weightKg: Number(row.weight_kg),
        note: row.note,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
      }));
    },
    staleTime: 30_000,
    retry: shouldRetryRead,
    retryDelay: readRetryDelay,
  });

export const bulkProgressNutritionQueryOptions = (
  profileId: string | null,
  from: string,
  to: string,
) =>
  queryOptions({
    queryKey: bulkProgressNutritionQueryKey(profileId ?? "", from, to),
    enabled: !!profileId,
    queryFn: async (): Promise<BulkNutritionProgressDay[]> => {
      if (!profileId) return [];
      const { data: days, error } = await supabase
        .from("bulk_nutrition_days")
        .select("id,log_date,target_calories")
        .eq("bulk_profile_id", profileId)
        .gte("log_date", from)
        .lte("log_date", to)
        .order("log_date");
      if (error) throw error;
      if (!days?.length) return [];
      const { data: entries, error: entryError } = await supabase
        .from("bulk_nutrition_entries")
        .select("nutrition_day_id,calories,protein_g")
        .in(
          "nutrition_day_id",
          days.map((day) => day.id),
        );
      if (entryError) throw entryError;
      return days.map((day) => {
        const own = (entries ?? []).filter((entry) => entry.nutrition_day_id === day.id);
        return {
          logDate: day.log_date,
          calories: own.reduce((sum, entry) => sum + Number(entry.calories), 0),
          protein: own.reduce((sum, entry) => sum + Number(entry.protein_g), 0),
          targetCalories: Number(day.target_calories),
        };
      });
    },
    staleTime: 30_000,
    retry: shouldRetryRead,
    retryDelay: readRetryDelay,
  });

export const bulkPhotoQueryOptions = (profileId: string | null) =>
  queryOptions({
    queryKey: bulkPhotoQueryKey(profileId ?? ""),
    enabled: !!profileId,
    queryFn: async (): Promise<BulkProgressPhoto[]> => {
      if (!profileId) return [];
      const { data, error } = await supabase
        .from("bulk_progress_photos")
        .select("*")
        .eq("bulk_profile_id", profileId)
        .order("log_date", { ascending: false })
        .order("created_at", { ascending: false })
        .limit(24);
      if (error) throw error;
      const paths = (data ?? []).map((row) => row.storage_path);
      const signed = paths.length
        ? await supabase.storage.from("bulk-progress-photos").createSignedUrls(paths, 15 * 60)
        : { data: [], error: null };
      const urls = new Map((signed.data ?? []).map((item) => [item.path, item.signedUrl]));
      return (data ?? []).map((row) => ({
        id: row.id,
        bulkProfileId: row.bulk_profile_id,
        logDate: row.log_date,
        storagePath: row.storage_path,
        viewType: row.view_type as BulkProgressPhoto["viewType"],
        note: row.note,
        signedUrl: urls.get(row.storage_path) ?? null,
        createdAt: row.created_at,
      }));
    },
    staleTime: 10 * 60_000,
    gcTime: 15 * 60_000,
    retry: shouldRetryRead,
    retryDelay: readRetryDelay,
  });

export const useBulkWeights = (profileId: string | null, from: string) =>
  useQuery(bulkWeightQueryOptions(profileId, from));
export const useBulkProgressNutrition = (profileId: string | null, from: string, to: string) =>
  useQuery(bulkProgressNutritionQueryOptions(profileId, from, to));
export const useBulkProgressPhotos = (profileId: string | null) =>
  useQuery(bulkPhotoQueryOptions(profileId));

export async function saveBulkWeight(
  profileId: string,
  input: { logDate: string; weightKg: number; note: string | null },
) {
  const { error } = await supabase.from("bulk_weight_entries").upsert(
    {
      bulk_profile_id: profileId,
      log_date: input.logDate,
      weight_kg: input.weightKg,
      note: input.note,
    },
    { onConflict: "bulk_profile_id,log_date" },
  );
  if (error) throw error;
}
export async function deleteBulkWeight(id: string) {
  const { error } = await supabase.from("bulk_weight_entries").delete().eq("id", id);
  if (error) throw error;
}

export async function uploadBulkProgressPhoto(
  profileId: string,
  input: {
    file: File;
    logDate: string;
    viewType: BulkProgressPhoto["viewType"];
    note: string | null;
  },
) {
  const id = crypto.randomUUID();
  const extension =
    input.file.type === "image/webp" ? "webp" : input.file.type === "image/jpeg" ? "jpg" : "png";
  const path = `${profileId}/public/${id}/photo.${extension}`;
  const bucket = supabase.storage.from("bulk-progress-photos");
  const uploaded = await bucket.upload(path, input.file, {
    contentType: input.file.type,
    upsert: false,
  });
  if (uploaded.error) throw uploaded.error;
  const inserted = await supabase.from("bulk_progress_photos").insert({
    id,
    bulk_profile_id: profileId,
    log_date: input.logDate,
    storage_path: path,
    view_type: input.viewType,
    note: input.note,
  });
  if (inserted.error) {
    await bucket.remove([path]);
    throw inserted.error;
  }
}

export async function deleteBulkProgressPhoto(photo: BulkProgressPhoto) {
  const removed = await supabase.storage.from("bulk-progress-photos").remove([photo.storagePath]);
  if (removed.error) throw removed.error;
  const deleted = await supabase
    .from("bulk_progress_photos")
    .delete()
    .eq("id", photo.id)
    .eq("storage_path", photo.storagePath);
  if (deleted.error) throw deleted.error;
}
