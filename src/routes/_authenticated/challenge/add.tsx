import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { Check, ChevronDown, ImageUp } from "lucide-react";
import { toast } from "sonner";
import { AppShell, PageHeader } from "@/components/AppShell";
import { DataError, Note, PendingLabel } from "@/components/ui-kit";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { normalizeDecimal, parseDecimal } from "@/lib/numeric";
import { canonicalDuration, formatClock, parseDurationToSeconds } from "@/lib/duration";
import { userFacingError } from "@/lib/network-errors";
import { reportLovableError } from "@/lib/lovable-error-reporting";
import { safeStravaUrl } from "@/lib/safe-url";
import { optimizeEvidenceImage } from "@/lib/challenge-evidence";
import {
  inspectPrivateImage,
  isPrivateImageValidationError,
  PRIVATE_IMAGE_MAX_BYTES,
} from "@/lib/private-image-upload";
import {
  activityMetrics,
  formatPace,
  isActivityEditable,
  todayIn,
  useActivity,
  useMyChallenge,
} from "@/lib/challenge";

const MAX_EVIDENCE_FILES = 4;
const MAX_EVIDENCE_FILE_BYTES = PRIVATE_IMAGE_MAX_BYTES;

type AddSearch = { type?: "run" | "cycle" | undefined; edit?: string | undefined };

export const Route = createFileRoute("/_authenticated/challenge/add")({
  validateSearch: (search: Record<string, unknown>): AddSearch => ({
    type: search["type"] === "cycle" ? "cycle" : search["type"] === "run" ? "run" : undefined,
    edit: typeof search["edit"] === "string" && search["edit"] ? search["edit"] : undefined,
  }),
  head: () => ({
    meta: [
      { title: "Tempo" },
      {
        name: "description",
        content: "Log a qualifying run or ride with duration and a Strava screenshot as evidence.",
      },
      { property: "og:title", content: "Tempo" },
      { property: "og:description", content: "Run or cycle, screenshot required." },
    ],
  }),
  component: AddActivity,
});

function AddActivity() {
  const { type: searchType, edit: editId } = Route.useSearch();
  const editing = !!editId;
  const { user } = useAuth();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const challengeQuery = useMyChallenge();
  const { data: challenge, isLoading: challengeLoading, error: challengeError } = challengeQuery;
  const editQuery = useActivity(editId);
  const today = challenge ? todayIn(challenge.timezone) : new Date().toISOString().slice(0, 10);

  const [type, setType] = useState<"run" | "cycle">(searchType ?? "run");
  const [distance, setDistance] = useState("");
  const [date, setDate] = useState(today);
  const [duration, setDuration] = useState("");
  const [url, setUrl] = useState("");
  const [note, setNote] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const [previews, setPreviews] = useState<string[]>([]);
  const [pending, setPending] = useState<"uploading" | "saving" | null>(null);
  const [validationError, setValidationError] = useState<string | null>(null);
  const [requestError, setRequestError] = useState<string | null>(null);
  const [moreOpen, setMoreOpen] = useState(false);
  const [draftReady, setDraftReady] = useState<string | null>(null);
  const hydratedContext = useRef<string | null>(null);
  const draftClosed = useRef(false);
  const hydratedDraftKey = useRef<string | null>(null);
  const busy = pending !== null;
  // An edit has its own owner/challenge/activity key; it never reads the generic new draft.
  const draftKey =
    challenge && user
      ? `challenge-activity-draft:${user.id}:${challenge.id}${editing ? `:edit:${editId}` : ""}`
      : null;
  const draftContext = draftKey ? `${draftKey}:${searchType ?? ""}` : null;

  useEffect(() => {
    if (files.length === 0) {
      setPreviews([]);
      return;
    }
    const urls = files.map((f) => URL.createObjectURL(f));
    setPreviews(urls);
    return () => urls.forEach((u) => URL.revokeObjectURL(u));
  }, [files]);

  useEffect(() => {
    const activity = editing ? editQuery.data : null;
    if (!draftKey || !draftContext || (editing && !activity)) return;
    if (hydratedContext.current === draftContext) return;
    hydratedContext.current = draftContext;
    draftClosed.current = false;
    setDraftReady(null);
    // Reset fields before restoring this context. A type-only sheet choice keeps selected files.
    setType(activity?.activity_type ?? searchType ?? "run");
    setDistance(activity ? String(Number(activity.distance_km)) : "");
    setDuration(activity?.duration_seconds ? formatClock(activity.duration_seconds) : "");
    setDate(activity?.activity_date ?? today);
    setUrl(activity?.external_activity_url ?? "");
    setNote(activity?.note ?? "");
    if (hydratedDraftKey.current !== draftKey) setFiles([]);
    hydratedDraftKey.current = draftKey;
    setValidationError(null);
    setRequestError(null);
    setMoreOpen(!!(activity?.external_activity_url || activity?.note));
    try {
      const raw = sessionStorage.getItem(draftKey);
      if (raw) {
        const draft = JSON.parse(raw) as {
          type?: "run" | "cycle";
          distance?: string;
          date?: string;
          duration?: string;
          url?: string;
          note?: string;
          moreOpen?: boolean;
        };
        // Explicit new-activity sheet selection wins, including same-route Run -> Ride navigation.
        if (!searchType && (draft.type === "run" || draft.type === "cycle")) setType(draft.type);
        if (typeof draft.distance === "string") setDistance(draft.distance);
        if (typeof draft.date === "string" && draft.date <= today) setDate(draft.date);
        if (typeof draft.duration === "string") setDuration(draft.duration);
        if (typeof draft.url === "string") setUrl(draft.url);
        if (typeof draft.note === "string") setNote(draft.note);
        if (typeof draft.moreOpen === "boolean") setMoreOpen(draft.moreOpen);
      }
    } catch {
      try {
        sessionStorage.removeItem(draftKey);
      } catch {
        // Storage failure must not break the in-memory form.
      }
    }
    setDraftReady(draftContext);
  }, [draftKey, draftContext, today, searchType, editing, editQuery.data]);

  const clearDraft = () => {
    // Close persistence synchronously before state updates/navigation can run another effect.
    draftClosed.current = true;
    setDraftReady(null);
    if (draftKey) {
      try {
        sessionStorage.removeItem(draftKey);
      } catch {
        // A confirmed save remains successful when browser storage is unavailable.
      }
    }
    setDistance("");
    setDuration("");
    setDate(today);
    setUrl("");
    setNote("");
    setFiles([]);
    setPreviews([]);
    setMoreOpen(false);
    setValidationError(null);
    setRequestError(null);
  };

  useEffect(() => {
    if (
      !draftKey ||
      draftReady !== draftContext ||
      hydratedContext.current !== draftContext ||
      draftClosed.current
    )
      return;
    try {
      sessionStorage.setItem(
        draftKey,
        JSON.stringify({ type, distance, date, duration, url, note, moreOpen }),
      );
    } catch {
      // Draft persistence is a safeguard; storage failure must not break activity entry.
    }
  }, [date, distance, draftKey, draftContext, draftReady, duration, moreOpen, note, type, url]);

  const parsedDistance = parseDecimal(distance);
  const dist = parsedDistance.kind === "value" ? parsedDistance.value : NaN;
  const durationSeconds = parseDurationToSeconds(duration);
  const metrics =
    dist > 0 && durationSeconds && durationSeconds > 0
      ? activityMetrics({
          activity_type: type,
          distance_km: dist,
          duration_seconds: durationSeconds,
        })
      : null;

  const submit = async () => {
    if (!challenge || !user || busy) return;
    setValidationError(null);
    setRequestError(null);
    const replacingEvidence = files.length > 0;
    if (!editing && files.length === 0) {
      setValidationError("Attach at least one screenshot that verifies the activity.");
      return;
    }
    if (files.length > MAX_EVIDENCE_FILES) {
      setValidationError(`Attach no more than ${MAX_EVIDENCE_FILES} screenshots.`);
      return;
    }
    if (
      files.some(
        (file) =>
          (!!file.type && !file.type.startsWith("image/")) || file.size > MAX_EVIDENCE_FILE_BYTES,
      )
    ) {
      setValidationError("Each screenshot must be an image no larger than 15 MB.");
      return;
    }
    if (!(dist > 0 && dist <= 1000)) {
      setValidationError("Enter a distance above 0 and no greater than 1,000 km.");
      return;
    }
    const externalActivityUrl = url.trim() ? safeStravaUrl(url.trim()) : null;
    if (url.trim() && !externalActivityUrl) {
      setValidationError("Enter a valid HTTPS Strava URL.");
      return;
    }
    const seconds = durationSeconds;
    if (seconds === null || seconds <= 0 || seconds > 2147483647) {
      setValidationError("Enter a valid duration as mm:ss so pace or speed can be verified.");
      return;
    }
    setDistance(normalizeDecimal(distance));
    setPending(replacingEvidence ? "uploading" : "saving");
    const paths: string[] = [];
    try {
      if (replacingEvidence) {
        for (const selectedFile of files) {
          const selectedType = await inspectPrivateImage(selectedFile);
          const uploadFile = await optimizeEvidenceImage(selectedFile);
          const optimizedType =
            uploadFile === selectedFile ? selectedType : await inspectPrivateImage(uploadFile);
          const ext = optimizedType.extension;
          const path = `${challenge.id}/${user.id}/${crypto.randomUUID()}.${ext}`;
          const up = await supabase.storage.from("challenge-evidence").upload(path, uploadFile, {
            contentType: optimizedType.mimeType,
            upsert: false,
          });
          if (up.error) throw up.error;
          paths.push(path);
        }
      }
      setPending("saving");
      const evidence = replacingEvidence
        ? { evidence_path: paths[0]!, extra_evidence_paths: paths.slice(1) }
        : {};
      const fields = {
        activity_type: type,
        distance_km: dist,
        activity_date: date,
        duration_seconds: seconds,
        external_activity_url: externalActivityUrl,
        note: note || null,
      };

      if (editing) {
        // The owner-only, open-week RLS policy and the BEFORE UPDATE trigger enforce editability;
        // qualification, counted km, pace and speed are GENERATED columns and recompute server-side.
        const { error } = await supabase
          .from("challenge_activities")
          .update({ ...fields, ...evidence })
          .eq("id", editId!);
        if (error) throw error;
        clearDraft();
        if (replacingEvidence) {
          const oldPaths = [
            editQuery.data?.evidence_path,
            ...(editQuery.data?.extra_evidence_paths ?? []),
          ].filter((p): p is string => !!p);
          if (oldPaths.length) {
            try {
              await supabase.storage.from("challenge-evidence").remove(oldPaths);
            } catch {
              // The edit is saved; leaving a replaced screenshot behind is a harmless cleanup miss.
            }
          }
        }
        void qc.invalidateQueries({ queryKey: ["challenge-activities"] });
        void qc.invalidateQueries({ queryKey: ["challenge-activity", editId] });
        toast.success("Activity updated.");
        void navigate({ to: "/challenge/activity/$activityId", params: { activityId: editId! } });
        return;
      }

      const { error } = await supabase.from("challenge_activities").insert({
        challenge_id: challenge.id,
        user_id: user.id,
        ...fields,
        evidence_path: paths[0]!,
        extra_evidence_paths: paths.slice(1),
        verification_source: "manual_strava_screenshot",
      });
      if (error) throw error;
      clearDraft();
      void qc.invalidateQueries({ queryKey: ["challenge-activities"] });
      toast.success("Activity saved.");
      void navigate({ to: "/challenge" });
    } catch (e) {
      if (paths.length) {
        try {
          await supabase.storage.from("challenge-evidence").remove(paths);
        } catch {
          // The database write did not complete. Best-effort cleanup prevents
          // partially uploaded evidence without hiding the original failure.
        }
      }
      if (isPrivateImageValidationError(e)) {
        setValidationError(
          "Choose valid JPG, PNG, WebP, GIF, HEIC or HEIF images up to 15 MB each.",
        );
      } else {
        // Surface the real Supabase/PostgREST/storage error to the preview/editor telemetry so the
        // exact failing operation is diagnosable, while the user-facing message stays generic.
        reportLovableError(e, {
          boundary: "challenge_activity_save",
          phase: editing ? "update" : "insert",
          hadEvidenceUpload: replacingEvidence,
        });
        setRequestError(
          userFacingError(e, editing ? "update the activity" : "save the activity", {
            inputPreserved: true,
          }),
        );
      }
    } finally {
      setPending(null);
    }
  };

  const noun = type === "run" ? "run" : "ride";
  const lockedForEdit =
    editing &&
    !!editQuery.data &&
    !!challenge &&
    !isActivityEditable(challenge, editQuery.data, user?.id);

  if (challengeLoading || (editing && editQuery.isLoading)) {
    return (
      <AppShell>
        <div className="space-y-3">
          <div className="h-16 animate-pulse rounded-2xl bg-card" />
          <div className="h-72 animate-pulse rounded-2xl bg-card" />
        </div>
      </AppShell>
    );
  }

  if (challengeError && !challenge) {
    return (
      <AppShell>
        <PageHeader title="Add a run" backTo="/challenge" backLabel="This week" />
        <DataError
          message="Your form has not been changed. Check your connection and try loading the challenge again."
          onRetry={() => void challengeQuery.refetch()}
        />
      </AppShell>
    );
  }

  if (!challenge) {
    return (
      <AppShell>
        <PageHeader title="Add a run" backTo="/challenge" backLabel="This week" />
        <Note>You are not part of a challenge yet.</Note>
      </AppShell>
    );
  }

  if (editing && !editQuery.data) {
    return (
      <AppShell>
        <PageHeader title="Edit activity" backTo="/challenge" backLabel="This week" />
        <Note>This activity is unavailable or does not belong to your challenge.</Note>
      </AppShell>
    );
  }

  if (lockedForEdit) {
    return (
      <AppShell>
        <PageHeader title="Edit activity" backTo="/challenge" backLabel="This week" />
        <Note>This week is finalized, so the activity can no longer be edited.</Note>
      </AppShell>
    );
  }

  return (
    <AppShell>
      {editing ? (
        <PageHeader
          title={`Edit ${noun}`}
          backTo="/challenge/activity/$activityId"
          backParams={{ activityId: editId! }}
          backLabel="Activity"
        />
      ) : (
        <PageHeader title={`Add a ${noun}`} backTo="/challenge" backLabel="This week" />
      )}

      <div className="space-y-4">
        <div
          role="radiogroup"
          aria-label="Activity type"
          className="grid grid-cols-2 gap-1 rounded-[13px] bg-card p-1"
        >
          {(["run", "cycle"] as const).map((t) => (
            <button
              key={t}
              type="button"
              role="radio"
              aria-checked={type === t}
              disabled={busy}
              onClick={() => setType(t)}
              className={`min-h-11 rounded-[10px] py-2.5 text-[15px] disabled:opacity-60 ${
                type === t
                  ? "bg-elevated font-semibold text-foreground"
                  : "font-medium text-muted-foreground"
              }`}
            >
              {t === "run" ? "Run" : "Ride"}
            </button>
          ))}
        </div>

        <div className="grid grid-cols-2 gap-3">
          <Field label="Distance">
            <div className="flex h-14 items-center gap-2 rounded-[14px] border border-input bg-card px-4">
              <input
                type="text"
                inputMode="decimal"
                step="0.01"
                value={distance}
                disabled={busy}
                placeholder="0.0"
                onChange={(e) => setDistance(e.target.value)}
                onBlur={() => setDistance(normalizeDecimal(distance))}
                className="num min-w-0 flex-1 bg-transparent text-xl font-semibold outline-none placeholder:font-normal placeholder:text-muted-foreground/50"
              />
              <span className="text-sm text-muted-foreground">km</span>
            </div>
          </Field>
          <Field label="Time">
            <div className="flex h-14 items-center gap-2 rounded-[14px] border border-input bg-card px-4">
              <input
                type="text"
                inputMode="numeric"
                value={duration}
                disabled={busy}
                placeholder="e.g. 22:20"
                onChange={(e) => setDuration(e.target.value)}
                onBlur={() => setDuration(canonicalDuration(duration))}
                className="num min-w-0 flex-1 bg-transparent text-xl font-semibold outline-none placeholder:font-normal placeholder:text-muted-foreground/50"
              />
              <span className="text-sm text-muted-foreground">min</span>
            </div>
          </Field>
        </div>

        {metrics ? (
          <div
            role="status"
            aria-live="polite"
            className={`flex items-center gap-3 rounded-[16px] px-4 py-3.5 ${
              metrics.qualified ? "bg-primary/10" : "bg-warn/10"
            }`}
          >
            <span
              className={`grid h-7 w-7 flex-none place-items-center rounded-full ${
                metrics.qualified ? "bg-primary text-primary-foreground" : "bg-warn text-background"
              }`}
            >
              {metrics.qualified ? (
                <Check className="h-4 w-4" strokeWidth={3} aria-hidden="true" />
              ) : (
                <span aria-hidden="true" className="text-sm font-bold">
                  !
                </span>
              )}
            </span>
            <div className="min-w-0">
              <p className="text-base font-semibold">
                {metrics.qualified
                  ? `Counts as ${metrics.equivalent.toFixed(1)} km`
                  : "Doesn’t count yet"}
              </p>
              <p className="text-[13px] text-muted-foreground">
                {type === "run"
                  ? metrics.qualified
                    ? `Pace ${pace(metrics.averagePace)}, faster than the 7:00 limit`
                    : `Pace ${pace(metrics.averagePace)}, slower than the 7:00 /km limit`
                  : metrics.qualified
                    ? `Speed ${metrics.averageSpeed?.toFixed(1)} km/h, over the 18 km/h limit`
                    : `Speed ${metrics.averageSpeed?.toFixed(1)} km/h, under the 18 km/h limit`}
              </p>
            </div>
          </div>
        ) : null}

        <div>
          <label
            className={`flex min-h-[72px] items-center gap-3.5 rounded-[16px] border border-dashed px-4 py-3 transition-colors ${
              busy ? "cursor-not-allowed opacity-60" : "cursor-pointer"
            } ${files.length ? "border-primary/60 bg-primary/5" : "border-[oklch(38%_.01_260)]"}`}
          >
            <span className="grid h-6 w-6 flex-none place-items-center text-muted-foreground">
              {files.length ? (
                <Check className="h-5 w-5 text-primary" aria-hidden="true" />
              ) : (
                <ImageUp className="h-6 w-6" strokeWidth={1.8} aria-hidden="true" />
              )}
            </span>
            <span className="min-w-0 flex-1">
              <span className="block text-[15px] font-medium">
                {files.length
                  ? `${files.length} screenshot${files.length > 1 ? "s" : ""} attached`
                  : editing
                    ? "Replace Strava screenshot"
                    : "Add Strava screenshot"}
              </span>
              <span className="block text-[13px] text-muted-foreground">
                {files.length
                  ? "Tap to add more images"
                  : editing
                    ? "Current screenshot is kept unless you add a new one."
                    : "Your proof. Only you and your opponent see it."}
              </span>
            </span>
            <input
              type="file"
              accept="image/*"
              multiple
              disabled={busy}
              className="hidden"
              onChange={(e) => {
                const picked = [...(e.target.files ?? [])];
                if (picked.length) {
                  const next = [...files, ...picked];
                  if (next.length > MAX_EVIDENCE_FILES) {
                    setValidationError(`Attach no more than ${MAX_EVIDENCE_FILES} screenshots.`);
                  } else if (
                    picked.some(
                      (file) =>
                        (!!file.type && !file.type.startsWith("image/")) ||
                        file.size > MAX_EVIDENCE_FILE_BYTES,
                    )
                  ) {
                    setValidationError("Each screenshot must be an image no larger than 15 MB.");
                  } else {
                    setValidationError(null);
                    setFiles(next);
                  }
                }
                e.target.value = "";
              }}
            />
          </label>
          {previews.length ? (
            <div className="mt-2 grid grid-cols-2 gap-2">
              {previews.map((p, i) => (
                <div key={p} className="relative">
                  <img
                    src={p}
                    alt={`Selected evidence preview ${i + 1}`}
                    className="h-24 w-full rounded-xl border border-border object-cover"
                  />
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => setFiles((prev) => prev.filter((_, j) => j !== i))}
                    aria-label={`Remove evidence screenshot ${i + 1}`}
                    className="absolute right-1.5 top-1.5 min-h-11 rounded-lg bg-danger px-2 py-0.5 text-[11px] font-medium text-primary-foreground"
                  >
                    Remove
                  </button>
                </div>
              ))}
            </div>
          ) : null}
        </div>

        <button
          type="button"
          disabled={busy}
          aria-expanded={moreOpen}
          onClick={() => setMoreOpen((open) => !open)}
          className="flex min-h-11 w-full items-center justify-between gap-3 rounded-lg px-4 py-2 text-[13px] font-medium text-muted-foreground disabled:opacity-60"
        >
          More details
          <ChevronDown
            className={`control-chevron transition-transform duration-150 motion-reduce:transition-none ${moreOpen ? "rotate-180" : ""}`}
            aria-hidden="true"
          />
        </button>

        {moreOpen ? (
          <div className="space-y-3 border-t border-border pt-3">
            <Field label="Activity date">
              <input
                type="date"
                max={today}
                value={date}
                disabled={busy}
                onChange={(e) => setDate(e.target.value)}
                className={inputCls}
              />
            </Field>
            <Field label="Strava URL (optional)">
              <input
                value={url}
                disabled={busy}
                onChange={(e) => setUrl(e.target.value)}
                className={inputCls}
              />
            </Field>
            <Field label="Note (shared with both members)">
              <input
                value={note}
                maxLength={500}
                disabled={busy}
                onChange={(e) => setNote(e.target.value)}
                placeholder="e.g. easy pace, hilly route"
                className={inputCls}
              />
            </Field>
          </div>
        ) : null}

        {validationError ? (
          <div role="alert" className="rounded-xl border border-warn/30 bg-warn/5 p-3">
            <p className="text-xs font-semibold text-warn">Check your activity</p>
            <p className="mt-1 text-xs text-muted-foreground">{validationError}</p>
          </div>
        ) : null}
        {requestError ? (
          <div role="alert" className="rounded-xl border border-danger/30 bg-danger/5 p-3">
            <p className="text-xs font-semibold text-danger">
              {editing ? "Activity was not updated" : "Activity was not saved"}
            </p>
            <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
              Your entered details and selected screenshots are still here. {requestError}
            </p>
            <button
              type="button"
              disabled={busy}
              onClick={() => void submit()}
              className="mt-3 min-h-11 rounded-xl border border-danger/40 px-4 py-2 text-sm font-semibold text-danger disabled:opacity-60"
            >
              Try saving again
            </button>
          </div>
        ) : null}

        <button
          type="button"
          aria-label={
            pending === "uploading"
              ? "Uploading activity evidence"
              : pending === "saving"
                ? "Saving activity"
                : editing
                  ? "Save changes"
                  : `Save ${noun}`
          }
          aria-busy={busy}
          disabled={busy}
          onClick={() => void submit()}
          className="h-[54px] w-full rounded-[16px] bg-primary text-base font-semibold text-primary-foreground disabled:opacity-60"
        >
          {pending === "uploading" ? (
            <PendingLabel>Uploading evidence…</PendingLabel>
          ) : pending === "saving" ? (
            <PendingLabel>{editing ? "Saving changes…" : "Saving activity…"}</PendingLabel>
          ) : editing ? (
            "Save changes"
          ) : (
            `Save ${noun}`
          )}
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={() => {
            if (!window.confirm("Discard your unsaved activity changes?")) return;
            clearDraft();
            if (editing)
              void navigate({
                to: "/challenge/activity/$activityId",
                params: { activityId: editId! },
              });
            else void navigate({ to: "/challenge" });
          }}
          className="min-h-11 w-full rounded-xl px-3 text-sm text-muted-foreground disabled:opacity-60"
        >
          {editing ? "Cancel edit" : "Discard draft"}
        </button>
        <Note>
          Activities can only be logged or edited inside the current, open week. A run counts 1:1
          below 7:00 min/km; a ride counts 3:1 from 18 km/h. The rules live in Terms.
        </Note>
      </div>
    </AppShell>
  );
}

const inputCls =
  "w-full rounded-xl border border-border bg-elevated px-3 py-2.5 text-sm outline-none";

/** "5:35 /km" — matches the Terms wording and the handoff live card. */
function pace(secondsPerKm: number | null) {
  return formatPace(secondsPerKm).replace(" min/km", " /km");
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-[13px] text-muted-foreground">{label}</span>
      {children}
    </label>
  );
}
