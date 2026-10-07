import {
  infiniteQueryOptions,
  queryOptions,
  useInfiniteQuery,
  useQuery,
} from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import type { Tables } from "@/integrations/supabase/types";
import { readRetryDelay, shouldRetryRead } from "./network-errors";
import type { BulkNutritionProgressDay, BulkProgressPhoto, BulkWeightEntry } from "./bulk-progress";
import { inspectPrivateImage, STANDARD_PRIVATE_IMAGE_MIME_TYPES } from "./private-image-upload";
import { refreshActiveBulkTrainingBodyweight } from "./bulk-training-sessions";
import { QUERY_ID_BATCH_SIZE, QUERY_PAGE_SIZE, readAllByKey } from "./query-pagination";

export const bulkWeightQueryKey = (profileId: string) =>
  ["bulk-weight-entries", profileId] as const;
export const bulkPhotoQueryKey = (profileId: string) =>
  ["bulk-progress-photos", profileId] as const;
export const bulkProgressNutritionQueryKey = (profileId: string, from: string | null, to: string) =>
  ["bulk-progress-summary", "nutrition", profileId, from, to] as const;

export const bulkWeightQueryOptions = (
  profileId: string | null,
  from: string | null,
  to?: string,
) =>
  queryOptions({
    // Today and Progress read different ranges. Keep the profile prefix for
    // write invalidation, but never share a partial range as complete history.
    queryKey: [...bulkWeightQueryKey(profileId ?? ""), from, to ?? null],
    enabled: !!profileId,
    queryFn: async (): Promise<BulkWeightEntry[]> => {
      if (!profileId) return [];
      const data = await readAllByKey<Tables<"bulk_weight_entries">>(
        (cursor) => {
          let query = supabase
            .from("bulk_weight_entries")
            .select("*")
            .eq("bulk_profile_id", profileId)
            .order("log_date")
            .limit(QUERY_PAGE_SIZE);
          if (from) query = query.gte("log_date", from);
          if (to) query = query.lte("log_date", to);
          if (cursor) query = query.gt("log_date", cursor);
          return query;
        },
        (row) => row.log_date,
      );
      return data.reverse().map((row) => ({
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
  from: string | null,
  to: string,
) =>
  queryOptions({
    queryKey: bulkProgressNutritionQueryKey(profileId ?? "", from, to),
    enabled: !!profileId,
    queryFn: async (): Promise<BulkNutritionProgressDay[]> => {
      if (!profileId) return [];
      const days = await readAllByKey<
        Pick<Tables<"bulk_nutrition_days">, "id" | "log_date" | "target_calories">
      >(
        (cursor) => {
          let query = supabase
            .from("bulk_nutrition_days")
            .select("id,log_date,target_calories")
            .eq("bulk_profile_id", profileId)
            .lte("log_date", to)
            .order("id")
            .limit(QUERY_PAGE_SIZE);
          if (from) query = query.gte("log_date", from);
          if (cursor) query = query.gt("id", cursor);
          return query;
        },
        (row) => row.id,
      );
      const totals = new Map<string, { calories: number; protein: number }>();
      for (let offset = 0; offset < days.length; offset += QUERY_ID_BATCH_SIZE) {
        const ids = days.slice(offset, offset + QUERY_ID_BATCH_SIZE).map((day) => day.id);
        const entries = await readAllByKey<
          Pick<
            Tables<"bulk_nutrition_entries">,
            "id" | "nutrition_day_id" | "calories" | "protein_g"
          >
        >(
          (cursor) => {
            let query = supabase
              .from("bulk_nutrition_entries")
              .select("id,nutrition_day_id,calories,protein_g")
              .in("nutrition_day_id", ids)
              .order("id")
              .limit(QUERY_PAGE_SIZE);
            if (cursor) query = query.gt("id", cursor);
            return query;
          },
          (row) => row.id,
        );
        for (const entry of entries) {
          const total = totals.get(entry.nutrition_day_id) ?? { calories: 0, protein: 0 };
          total.calories += Number(entry.calories);
          total.protein += Number(entry.protein_g);
          totals.set(entry.nutrition_day_id, total);
        }
      }
      return days
        .sort((a, b) => a.log_date.localeCompare(b.log_date))
        .map((day) => {
          const total = totals.get(day.id);
          return {
            logDate: day.log_date,
            calories: total?.calories ?? 0,
            protein: total?.protein ?? 0,
            targetCalories: Number(day.target_calories),
          };
        });
    },
    staleTime: 30_000,
    retry: shouldRetryRead,
    retryDelay: readRetryDelay,
  });

type PhotoRow = Tables<"bulk_progress_photos">;
type PhotoCursor = Pick<PhotoRow, "log_date" | "created_at" | "id">;
export const PHOTO_PAGE_SIZE = 24;

export const bulkPhotoCountQueryOptions = (profileId: string | null) =>
  queryOptions({
    queryKey: [...bulkPhotoQueryKey(profileId ?? ""), "count"],
    enabled: !!profileId,
    queryFn: async () => {
      if (!profileId) return 0;
      const { count, error } = await supabase
        .from("bulk_progress_photos")
        .select("id", { count: "exact", head: true })
        .eq("bulk_profile_id", profileId);
      if (error) throw error;
      if (count === null) throw new Error("Photo count unavailable");
      return count;
    },
    staleTime: 30_000,
    retry: shouldRetryRead,
    retryDelay: readRetryDelay,
  });

export const bulkPhotoQueryOptions = (
  profileId: string | null,
  angle?: BulkProgressPhoto["viewType"],
) =>
  infiniteQueryOptions({
    queryKey: [...bulkPhotoQueryKey(profileId ?? ""), "pages", angle ?? "all"],
    enabled: !!profileId,
    initialPageParam: null as PhotoCursor | null,
    queryFn: async ({
      pageParam,
    }): Promise<{ photos: BulkProgressPhoto[]; next: PhotoCursor | null }> => {
      if (!profileId) return { photos: [], next: null };
      let query = supabase
        .from("bulk_progress_photos")
        .select("*", { count: "exact" })
        .eq("bulk_profile_id", profileId)
        .order("log_date", { ascending: false })
        .order("created_at", { ascending: false })
        .order("id", { ascending: false })
        .limit(PHOTO_PAGE_SIZE);
      if (angle) query = query.eq("view_type", angle);
      if (pageParam) {
        const { log_date: day, created_at: created, id } = pageParam;
        if (
          !/^\d{4}-\d{2}-\d{2}$/.test(day) ||
          !/^\d{4}-\d{2}-\d{2}T[0-9:.]+(?:Z|[+-]\d{2}:\d{2})$/.test(created) ||
          !/^[0-9a-f-]{36}$/i.test(id)
        )
          throw new Error("Invalid photo cursor");
        query = query.or(
          `log_date.lt.${day},and(log_date.eq.${day},created_at.lt.${created}),and(log_date.eq.${day},created_at.eq.${created},id.lt.${id})`,
        );
      }
      const { data, error, count } = await query;
      if (error) throw error;
      const paths = (data ?? []).map((row) => row.storage_path);
      const signed = paths.length
        ? await supabase.storage.from("bulk-progress-photos").createSignedUrls(paths, 15 * 60)
        : { data: [], error: null };
      const urls = new Map((signed.data ?? []).map((item) => [item.path, item.signedUrl]));
      const photos = (data ?? []).map((row) => ({
        id: row.id,
        bulkProfileId: row.bulk_profile_id,
        logDate: row.log_date,
        storagePath: row.storage_path,
        viewType: row.view_type as BulkProgressPhoto["viewType"],
        note: row.note,
        signedUrl: urls.get(row.storage_path) ?? null,
        createdAt: row.created_at,
      }));
      const last = data?.[data.length - 1];
      const next =
        last && (count === null || (data?.length ?? 0) < count)
          ? { log_date: last.log_date, created_at: last.created_at, id: last.id }
          : null;
      if (next && pageParam && JSON.stringify(next) === JSON.stringify(pageParam))
        throw new Error("Photo pagination cursor did not advance");
      return { photos, next };
    },
    getNextPageParam: (lastPage) => lastPage.next,
    select: (data) => [
      ...new Map(
        data.pages.flatMap((page) => page.photos).map((photo) => [photo.id, photo]),
      ).values(),
    ],
    staleTime: 10 * 60_000,
    gcTime: 15 * 60_000,
    retry: shouldRetryRead,
    retryDelay: readRetryDelay,
  });

export const useBulkWeights = (profileId: string | null, from: string | null, to?: string) =>
  useQuery(bulkWeightQueryOptions(profileId, from, to));
export const useBulkProgressNutrition = (
  profileId: string | null,
  from: string | null,
  to: string,
) => useQuery(bulkProgressNutritionQueryOptions(profileId, from, to));
export const useBulkProgressPhotos = (
  profileId: string | null,
  angle?: BulkProgressPhoto["viewType"],
) => useInfiniteQuery(bulkPhotoQueryOptions(profileId, angle));
export const useBulkProgressPhotoCount = (profileId: string | null) =>
  useQuery(bulkPhotoCountQueryOptions(profileId));

export async function saveBulkWeight(
  profileId: string,
  input: { logDate: string; weightKg: number; note: string | null },
) {
  const { error } = await supabase.rpc("save_bulk_weight_for_local_day", {
    _profile: profileId,
    _log_date: input.logDate,
    _weight_kg: input.weightKg,
    // Postgres accepts NULL, but generated Supabase RPC types omit nullable args.
    // This compile-time cast preserves the runtime null unchanged.
    _note: input.note as string,
    _timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
  });
  if (error) throw error;
  await refreshActiveBulkTrainingBodyweight(profileId);
}
export async function deleteBulkWeight(id: string, profileId: string) {
  const { error } = await supabase.from("bulk_weight_entries").delete().eq("id", id);
  if (error) throw error;
  await refreshActiveBulkTrainingBodyweight(profileId);
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
  const imageType = await inspectPrivateImage(input.file, STANDARD_PRIVATE_IMAGE_MIME_TYPES);
  const extension = imageType.extension;
  const path = `${profileId}/public/${id}/photo.${extension}`;
  const bucket = supabase.storage.from("bulk-progress-photos");
  const uploaded = await bucket.upload(path, input.file, {
    contentType: imageType.mimeType,
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

export async function applyBulkCalorieRecommendation(
  expectedCurrentCalories: number,
  newCalories: number,
) {
  const { data, error } = await supabase.rpc("apply_bulk_calorie_recommendation", {
    _expected_current_calories: expectedCurrentCalories,
    _new_calories: newCalories,
  });
  if (error) throw error;
  if (!data) throw new Error("Calorie recommendation could not be applied");
}
