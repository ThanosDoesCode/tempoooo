import { ChevronDown } from "lucide-react";
import { NativeSelect } from "@/components/ui/native-select";
import { createFileRoute } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import { format, parseISO } from "date-fns";
import { useMemo, useRef, useState } from "react";
import { AppShell, PageHeader } from "@/components/AppShell";
import { Card, Chip, Note, PendingLabel } from "@/components/ui-kit";
import { fmt, iso, latestWeight } from "@/lib/calc";
import { useActions, useAppData, useBulkMeta } from "@/lib/store";
import { useProgressMode } from "@/lib/progress-model";
import {
  bulkPhotoQueryKey,
  deleteBulkProgressPhoto,
  uploadBulkProgressPhoto,
  useBulkProgressPhotos,
} from "@/lib/bulk-progress-query";
import type { BulkProgressPhoto } from "@/lib/bulk-progress";
import {
  inspectPrivateImage,
  isPrivateImageValidationError,
  STANDARD_PRIVATE_IMAGE_MIME_TYPES,
} from "@/lib/private-image-upload";
import { optimizeBulkPhoto } from "@/lib/challenge-evidence";
import { type AppData, type PhotoSet } from "@/lib/types";

type Angle = "front" | "side" | "back";
const ANGLES: Angle[] = ["front", "side", "back"];

export const Route = createFileRoute("/_authenticated/bulk/progress_/photos")({
  head: () => ({ meta: [{ title: "Tempo" }] }),
  component: PhotosPage,
});

function PhotosPage() {
  const data = useAppData();
  const { mode, publicId } = useProgressMode();
  return (
    <AppShell>
      <PageHeader
        title="Progress photos"
        subtitle="Only you can see these. Same light and pose each time."
        backTo="/bulk/progress/body"
        backLabel="Body & food"
      />
      {mode === "public" && publicId ? (
        <PublicPhotosSection profileId={publicId} />
      ) : data ? (
        <PhotosSection data={data} />
      ) : (
        <div className="h-40 animate-pulse rounded-2xl bg-card" aria-label="Loading photos" />
      )}
    </AppShell>
  );
}

/** Normalized/public progress photos: private bucket, signed URLs, owner-only delete, angle-first. */
function PublicPhotosSection({ profileId }: { profileId: string }) {
  const { role } = useBulkMeta();
  const owner = role === "owner";
  const client = useQueryClient();
  const fileRef = useRef<HTMLInputElement>(null);
  const [angle, setAngle] = useState<Angle>("front");
  const photosQuery = useBulkProgressPhotos(profileId, angle);
  const [phase, setPhase] = useState<"optimizing" | "uploading" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);

  const photos = useMemo(
    () =>
      (photosQuery.data ?? [])
        .filter((photo) => photo.viewType === angle)
        .sort((a, b) => b.logDate.localeCompare(a.logDate)),
    [photosQuery.data, angle],
  );

  const onFile = async (file: File) => {
    if (phase) return;
    setError(null);
    setPhase("optimizing");
    try {
      await inspectPrivateImage(file, STANDARD_PRIVATE_IMAGE_MIME_TYPES);
      const optimized = await optimizeBulkPhoto(file);
      setPhase("uploading");
      await uploadBulkProgressPhoto(profileId, {
        file: optimized,
        logDate: iso(new Date()),
        viewType: angle,
        note: null,
      });
      await client.invalidateQueries({ queryKey: bulkPhotoQueryKey(profileId) });
    } catch (cause) {
      setError(
        isPrivateImageValidationError(cause)
          ? "Choose a valid JPG, PNG or WebP image up to 15 MB."
          : "Photo was not uploaded. Try again when ready.",
      );
    } finally {
      setPhase(null);
    }
  };

  const removePhoto = async (photo: BulkProgressPhoto) => {
    setConfirmDelete(null);
    await deleteBulkProgressPhoto(photo);
    await client.invalidateQueries({ queryKey: bulkPhotoQueryKey(profileId) });
  };

  return (
    <div className="space-y-3">
      <div className="flex gap-1 rounded-[13px] bg-card p-1" role="tablist" aria-label="Angle">
        {ANGLES.map((option) => (
          <button
            key={option}
            role="tab"
            aria-selected={angle === option}
            onClick={() => setAngle(option)}
            className={`h-10 flex-1 rounded-[10px] text-sm capitalize ${
              angle === option
                ? "bg-elevated font-semibold text-foreground"
                : "font-medium text-muted-foreground"
            }`}
          >
            {option}
          </button>
        ))}
      </div>

      {phase ? (
        <p role="status" className="text-xs text-primary">
          <PendingLabel>
            {phase === "optimizing" ? "Optimizing photo…" : "Uploading photo…"}
          </PendingLabel>
        </p>
      ) : null}
      {error ? (
        <div role="alert" className="rounded-xl border border-danger/30 bg-danger/5 p-3">
          <p className="text-xs text-danger">{error}</p>
        </div>
      ) : null}

      {photosQuery.isLoading ? (
        <div className="h-40 animate-pulse rounded-2xl bg-card" aria-label="Loading photos" />
      ) : photos.length === 0 ? (
        <Card>
          <p className="text-sm text-muted-foreground">
            No {angle} photos yet. Add one, taken in the same light and pose each time.
          </p>
        </Card>
      ) : (
        <div className="grid grid-cols-2 gap-2.5">
          {photos.map((photo) => (
            <div key={photo.id}>
              <div className="aspect-[3/4] w-full overflow-hidden rounded-[18px] border border-border bg-card">
                {photo.signedUrl ? (
                  <img
                    src={photo.signedUrl}
                    alt={`${photo.viewType} progress, ${format(parseISO(photo.logDate), "d MMM yyyy")}`}
                    loading="lazy"
                    decoding="async"
                    className="h-full w-full object-cover"
                  />
                ) : (
                  <span className="grid h-full place-items-center text-[13px] text-muted-foreground">
                    Photo unavailable
                  </span>
                )}
              </div>
              <div className="mt-1.5 flex items-center justify-between text-[13px]">
                <span>{format(parseISO(photo.logDate), "d MMM")}</span>
                {owner ? (
                  <button
                    onClick={() => {
                      if (confirmDelete === photo.id) void removePhoto(photo);
                      else setConfirmDelete(photo.id);
                    }}
                    className={`min-h-11 rounded-lg px-1.5 text-[11px] font-medium ${
                      confirmDelete === photo.id
                        ? "bg-danger text-primary-foreground"
                        : "text-danger hover:bg-danger/10"
                    }`}
                  >
                    {confirmDelete === photo.id ? "Confirm delete" : "Delete"}
                  </button>
                ) : null}
              </div>
            </div>
          ))}
        </div>
      )}

      {photosQuery.error ? (
        <div role="alert" className="rounded-xl border border-danger/30 bg-danger/5 p-3">
          <p className="text-xs text-danger">
            Photos could not load. Your saved photos are unchanged.
          </p>
          <button
            type="button"
            className="min-h-11 text-sm text-primary"
            onClick={() =>
              void (photosQuery.isFetchNextPageError
                ? photosQuery.fetchNextPage()
                : photosQuery.refetch())
            }
          >
            Retry
          </button>
        </div>
      ) : null}
      {photosQuery.hasNextPage ? (
        <button
          type="button"
          disabled={photosQuery.isFetching}
          onClick={() => void photosQuery.fetchNextPage()}
          className="min-h-11 w-full rounded-xl border border-border text-sm text-primary disabled:opacity-60"
        >
          {photosQuery.isFetchingNextPage ? "Loading older photos…" : "Load older photos"}
        </button>
      ) : null}

      <button
        onClick={() => fileRef.current?.click()}
        disabled={phase !== null}
        className="flex min-h-[54px] w-full items-center justify-center gap-2 rounded-2xl bg-primary text-base font-semibold text-primary-foreground active:opacity-90 disabled:opacity-60"
      >
        Add photo
      </button>
      <input
        ref={fileRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) void onFile(f);
          e.target.value = "";
        }}
      />
    </div>
  );
}

function PhotosSection({ data }: { data: AppData }) {
  const { addPhotoSet, setPhotoImage, importBackup: restoreBackup, deletePhotoSet } = useActions();
  const { role } = useBulkMeta();
  const owner = role === "owner";
  const fileRef = useRef<HTMLInputElement>(null);
  const importRef = useRef<HTMLInputElement>(null);
  const [pending, setPending] = useState<{ id: string; slot: Angle } | null>(null);
  const [angle, setAngle] = useState<Angle>("front");
  const [compare, setCompare] = useState(false);
  const [aId, setAId] = useState<string | null>(null);
  const [bId, setBId] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const [selectedPhoto, setSelectedPhoto] = useState<File | null>(null);
  const [photoPhase, setPhotoPhase] = useState<"optimizing" | "uploading" | null>(null);
  const [photoError, setPhotoError] = useState<string | null>(null);

  const removeSet = async (id: string) => {
    setConfirmDelete(null);
    await deletePhotoSet(id);
  };

  const photos = useMemo(
    () => [...data.photos].sort((a, b) => b.date.localeCompare(a.date)),
    [data.photos],
  );
  const oldest = photos[photos.length - 1];
  const newest = photos[0];
  const a = photos.find((p) => p.id === aId) ?? oldest;
  const b = photos.find((p) => p.id === bId) ?? newest;

  const addSet = () => {
    const latest = latestWeight(data);
    void addPhotoSet(iso(new Date()), latest?.weight);
  };

  const pickForSet = (id: string) => {
    setPhotoError(null);
    setSelectedPhoto(null);
    setPending({ id, slot: angle });
    fileRef.current?.click();
  };

  const onFile = async (file: File) => {
    const destination = pending;
    if (!destination || photoPhase) return;
    setSelectedPhoto(file);
    setPhotoError(null);
    setPhotoPhase("optimizing");
    try {
      const optimized = await optimizeBulkPhoto(file);
      setPhotoPhase("uploading");
      await setPhotoImage(destination.id, destination.slot, optimized);
      setPending(null);
      setSelectedPhoto(null);
    } catch {
      setPhotoError("Photo was not uploaded. Your selected photo is still here; retry when ready.");
    } finally {
      setPhotoPhase(null);
    }
  };

  const exportBackup = () => {
    const blob = new Blob([JSON.stringify(data)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `tempo-bulk-backup-${iso(new Date())}.json`;
    link.click();
    URL.revokeObjectURL(url);
  };

  const importBackup = async (file: File) => {
    try {
      const parsed = JSON.parse(await file.text()) as AppData;
      if (!parsed.days) return;
      await restoreBackup(parsed);
    } catch {
      /* invalid file */
    }
  };

  return (
    <div className="space-y-3">
      <div className="flex gap-1 rounded-[13px] bg-card p-1" role="tablist" aria-label="Angle">
        {ANGLES.map((option) => (
          <button
            key={option}
            role="tab"
            aria-selected={angle === option}
            onClick={() => setAngle(option)}
            className={`h-10 flex-1 rounded-[10px] text-sm capitalize ${
              angle === option
                ? "bg-elevated font-semibold text-foreground"
                : "font-medium text-muted-foreground"
            }`}
          >
            {option}
          </button>
        ))}
      </div>

      {photoPhase ? (
        <p role="status" className="text-xs text-primary">
          <PendingLabel>
            {photoPhase === "optimizing" ? "Optimizing photo…" : "Uploading photo…"}
          </PendingLabel>
        </p>
      ) : null}
      {photoError ? (
        <div role="alert" className="rounded-xl border border-danger/30 bg-danger/5 p-3">
          <p className="text-xs text-danger">{photoError}</p>
          <div className="mt-2 flex gap-2">
            <button
              type="button"
              disabled={!selectedPhoto || photoPhase !== null}
              onClick={() => selectedPhoto && void onFile(selectedPhoto)}
              className="min-h-11 flex-1 rounded-lg border border-danger/40 px-3 py-2 text-xs font-semibold text-danger disabled:opacity-60"
            >
              Retry upload
            </button>
            <button
              type="button"
              disabled={photoPhase !== null}
              onClick={() => {
                setPending(null);
                setSelectedPhoto(null);
                setPhotoError(null);
              }}
              className="min-h-11 rounded-lg px-3 py-2 text-xs font-medium text-muted-foreground"
            >
              Cancel
            </button>
          </div>
        </div>
      ) : null}

      {photos.length === 0 ? (
        <Card>
          <p className="text-sm text-muted-foreground">
            No photos yet. Add your first set, then upload a {angle} shot.
          </p>
        </Card>
      ) : (
        <div className="grid grid-cols-2 gap-2.5">
          {photos.map((photo) => (
            <div key={photo.id}>
              <button
                disabled={photoPhase !== null}
                onClick={() => pickForSet(photo.id)}
                className="aspect-[3/4] w-full overflow-hidden rounded-[18px] border border-border bg-card disabled:opacity-60"
              >
                {photo[angle] ? (
                  <img
                    src={photo[angle]}
                    alt={`${angle} progress, ${format(parseISO(photo.date), "d MMM yyyy")}`}
                    loading="lazy"
                    decoding="async"
                    className="h-full w-full object-cover"
                  />
                ) : (
                  <span className="grid h-full place-items-center text-[13px] capitalize text-muted-foreground">
                    + {angle}
                  </span>
                )}
              </button>
              <div className="mt-1.5 flex items-center justify-between text-[13px]">
                <span>
                  {format(parseISO(photo.date), "d MMM")}
                  {photo.weight != null ? ` · ${fmt(photo.weight, 1)} kg` : ""}
                </span>
                {owner ? (
                  <button
                    onClick={() => {
                      if (confirmDelete === photo.id) void removeSet(photo.id);
                      else setConfirmDelete(photo.id);
                    }}
                    className={`min-h-11 rounded-lg px-1.5 text-[11px] font-medium ${
                      confirmDelete === photo.id
                        ? "bg-danger text-primary-foreground"
                        : "text-danger hover:bg-danger/10"
                    }`}
                  >
                    {confirmDelete === photo.id ? "Confirm delete" : "Delete"}
                  </button>
                ) : null}
              </div>
            </div>
          ))}
        </div>
      )}

      {photos.length > 1 ? (
        <button
          onClick={() => setCompare((c) => !c)}
          className="min-h-11 w-full text-left text-[15px] font-medium text-primary"
        >
          {compare ? "Hide comparison" : "Compare other dates"}
        </button>
      ) : null}

      {compare && a && b ? (
        <Card>
          <div className="mb-2 flex gap-1.5">
            {ANGLES.map((option) => (
              <Chip key={option} active={angle === option} onClick={() => setAngle(option)}>
                <span className="capitalize">{option}</span>
              </Chip>
            ))}
          </div>
          <div className="mb-2 grid grid-cols-2 gap-2">
            <PhotoSelect photos={photos} value={a.id} onChange={setAId} />
            <PhotoSelect photos={photos} value={b.id} onChange={setBId} />
          </div>
          <div className="grid grid-cols-2 gap-2">
            {[a, b].map((p, i) => (
              <div key={`${p.id}-${i}`} className="rounded-xl border border-border p-2">
                <p className="mb-1 text-[11px] text-muted-foreground">
                  {format(parseISO(p.date), "d MMM yy")} · {fmt(p.weight, 1)} kg
                </p>
                {p[angle] ? (
                  <img src={p[angle]} alt={`${angle} progress`} className="w-full rounded-lg" />
                ) : (
                  <div className="grid h-32 place-items-center rounded-lg bg-elevated text-[11px] capitalize text-muted-foreground">
                    No {angle} photo
                  </div>
                )}
              </div>
            ))}
          </div>
        </Card>
      ) : null}

      <button
        onClick={addSet}
        className="flex min-h-[54px] w-full items-center justify-center gap-2 rounded-2xl bg-primary text-base font-semibold text-primary-foreground active:opacity-90"
      >
        Add photo
      </button>

      <details className="rounded-[20px] bg-card">
        <summary className="disclosure-summary min-h-11 px-4 text-[13px] font-medium text-muted-foreground">
          Backup &amp; restore
          <ChevronDown className="disclosure-chevron text-muted-foreground" aria-hidden="true" />
        </summary>
        <div className="px-4 pb-4">
          <Note>
            Photos are stored privately in your account. You can also export a backup file of your
            logs and photos, or restore one.
          </Note>
          <div className="mt-3 grid grid-cols-2 gap-2">
            <button
              onClick={exportBackup}
              className="min-h-11 rounded-xl border border-border bg-elevated px-2 py-2 text-sm font-medium"
            >
              Export backup
            </button>
            <button
              onClick={() => importRef.current?.click()}
              className="min-h-11 rounded-xl border border-border bg-elevated px-2 py-2 text-sm font-medium"
            >
              Restore backup
            </button>
          </div>
        </div>
      </details>

      <input
        ref={importRef}
        type="file"
        accept="application/json"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) void importBackup(f);
          e.target.value = "";
        }}
      />
      <input
        ref={fileRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) void onFile(f);
          else setPending(null);
          e.target.value = "";
        }}
      />
    </div>
  );
}

function PhotoSelect({
  photos,
  value,
  onChange,
}: {
  photos: PhotoSet[];
  value: string;
  onChange: (id: string) => void;
}) {
  return (
    <NativeSelect
      value={value}
      onChange={(e) => onChange(e.target.value)}
      containerClassName="w-full"
      className="rounded-xl border border-input bg-elevated px-2 py-2 text-xs outline-none focus:border-ring"
    >
      {photos.map((p) => (
        <option key={p.id} value={p.id}>
          {format(parseISO(p.date), "d MMM yyyy")}
        </option>
      ))}
    </NativeSelect>
  );
}
