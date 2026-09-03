import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { Check, ChevronDown, ImageUp } from "lucide-react";
import { toast } from "sonner";
import { AppShell, PageHeader } from "@/components/AppShell";
import { Card, DataError, Note, PendingLabel } from "@/components/ui-kit";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { normalizeDecimal, parseDecimal } from "@/lib/numeric";
import { userFacingError } from "@/lib/network-errors";
import {
  activityMetrics,
  DEFAULT_TARGET_KM,
  formatPace,
  todayIn,
  useMyChallenge,
} from "@/lib/challenge";

export const Route = createFileRoute("/_authenticated/challenge/log")({
  head: () => ({
    meta: [
      { title: "Add activity — Tempo" },
      {
        name: "description",
        content: "Log a qualifying run or ride with duration and a Strava screenshot as evidence.",
      },
      { property: "og:title", content: "Add activity — Tempo" },
      { property: "og:description", content: "Run or cycle, screenshot required." },
    ],
  }),
  component: LogActivity,
});

function LogActivity() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const challengeQuery = useMyChallenge();
  const { data: challenge, isLoading: challengeLoading, error: challengeError } = challengeQuery;
  const today = challenge ? todayIn(challenge.timezone) : new Date().toISOString().slice(0, 10);

  const [type, setType] = useState<"run" | "cycle">("run");
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
  const [draftReady, setDraftReady] = useState(false);
  const busy = pending !== null;
  const draftKey = challenge && user ? `challenge-activity-draft:${user.id}:${challenge.id}` : null;

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
    if (!draftKey) return;
    setDraftReady(false);
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
        if (draft.type === "run" || draft.type === "cycle") setType(draft.type);
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
        // Storage can be unavailable in restrictive browser modes; keep the in-memory form usable.
      }
    }
    setDraftReady(true);
  }, [draftKey, today]);

  useEffect(() => {
    if (!draftKey || !draftReady) return;
    try {
      sessionStorage.setItem(
        draftKey,
        JSON.stringify({ type, distance, date, duration, url, note, moreOpen }),
      );
    } catch {
      // Draft persistence is a safeguard; storage failure must not break activity entry.
    }
  }, [date, distance, draftKey, draftReady, duration, moreOpen, note, type, url]);

  const parsedDistance = parseDecimal(distance);
  const dist = parsedDistance.kind === "value" ? parsedDistance.value : NaN;
  const parsedDuration = parseDecimal(duration);
  const durationSeconds =
    parsedDuration.kind === "value" ? Math.round(parsedDuration.value * 60) : null;
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
    if (files.length === 0) {
      setValidationError("Attach at least one screenshot that verifies the activity.");
      return;
    }
    if (!(dist > 0 && dist <= 1000)) {
      setValidationError("Enter a distance above 0 and no greater than 1,000 km.");
      return;
    }
    const seconds = durationSeconds;
    if (
      parsedDuration.kind !== "value" ||
      seconds === null ||
      seconds <= 0 ||
      seconds > 2147483647
    ) {
      setValidationError("Enter a valid positive duration so pace or speed can be verified.");
      return;
    }
    setDistance(normalizeDecimal(distance));
    setDuration(normalizeDecimal(duration));
    setPending("uploading");
    try {
      const paths: string[] = [];
      for (const f of files) {
        const ext = f.name.split(".").pop() ?? "jpg";
        const path = `${challenge.id}/${user.id}/${crypto.randomUUID()}.${ext}`;
        const up = await supabase.storage.from("challenge-evidence").upload(path, f);
        if (up.error) throw up.error;
        paths.push(path);
      }
      setPending("saving");
      const { error } = await supabase.from("challenge_activities").insert({
        challenge_id: challenge.id,
        user_id: user.id,
        activity_type: type,
        distance_km: dist,
        activity_date: date,
        duration_seconds: seconds,
        evidence_path: paths[0]!,
        extra_evidence_paths: paths.slice(1),
        external_activity_url: url || null,
        note: note || null,
        verification_source: "manual_strava_screenshot",
      });
      if (error) throw error;
      if (draftKey) {
        try {
          sessionStorage.removeItem(draftKey);
        } catch {
          // The confirmed database write remains successful even if local cleanup is unavailable.
        }
      }
      void qc.invalidateQueries({ queryKey: ["challenge-activities"] });
      toast.success("Activity saved.");
      void navigate({ to: "/challenge" });
    } catch (e) {
      setRequestError(userFacingError(e, "save the activity", { inputPreserved: true }));
    } finally {
      setPending(null);
    }
  };

  if (challengeLoading) {
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
        <PageHeader title="Add activity" />
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
        <PageHeader title="Add activity" />
        <Note>You are not part of a challenge yet.</Note>
      </AppShell>
    );
  }

  return (
    <AppShell>
      <PageHeader
        title="Add activity"
        subtitle={`${DEFAULT_TARGET_KM} challenge km this week · duration and screenshot required.`}
      />
      <Card className="space-y-3 p-3">
        <div className="grid grid-cols-2 gap-2">
          {(["run", "cycle"] as const).map((t) => (
            <button
              key={t}
              type="button"
              disabled={busy}
              aria-pressed={type === t}
              onClick={() => setType(t)}
              className={`min-h-11 rounded-xl border py-2.5 text-sm font-medium capitalize disabled:opacity-60 ${
                type === t
                  ? "border-primary bg-primary/10 text-primary"
                  : "border-border bg-elevated"
              }`}
            >
              {t}
            </button>
          ))}
        </div>

        <Field label="Distance (km)">
          <input
            type="text"
            inputMode="decimal"
            step="0.01"
            value={distance}
            disabled={busy}
            onChange={(e) => setDistance(e.target.value)}
            onBlur={() => setDistance(normalizeDecimal(distance))}
            className={inputCls}
          />
        </Field>
        <Field label="Duration in minutes">
          <input
            type="text"
            inputMode="decimal"
            value={duration}
            disabled={busy}
            onChange={(e) => setDuration(e.target.value)}
            onBlur={() => setDuration(normalizeDecimal(duration))}
            placeholder="e.g. 36.5"
            className={inputCls}
          />
        </Field>
        <Field label="Strava screenshots (at least one)">
          <label
            className={`flex items-center gap-3 rounded-xl border border-dashed px-3 py-3 transition-colors ${
              busy ? "cursor-not-allowed opacity-60" : "cursor-pointer"
            } ${
              files.length
                ? "border-good/60 bg-good/5"
                : "border-border bg-elevated hover:border-ring"
            }`}
          >
            <span className="grid h-10 w-10 shrink-0 place-items-center rounded-lg bg-primary/15 text-primary">
              <ImageUp className="h-5 w-5" />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm font-medium">
                {files.length
                  ? `${files.length} screenshot${files.length > 1 ? "s" : ""} attached`
                  : "Attach screenshots"}
              </span>
              <span className="block text-[11px] text-muted-foreground">
                {files.length
                  ? "Tap to add more images"
                  : "PNG or JPG, you can pick several at once"}
              </span>
            </span>
            {files.length ? <Check className="h-4 w-4 shrink-0 text-good" /> : null}
            <input
              type="file"
              accept="image/*"
              multiple
              disabled={busy}
              className="hidden"
              onChange={(e) => {
                const picked = [...(e.target.files ?? [])];
                if (picked.length) setFiles((prev) => [...prev, ...picked]);
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
                    className="absolute right-1.5 top-1.5 rounded-lg bg-danger px-2 py-0.5 text-[11px] font-medium text-primary-foreground"
                  >
                    Remove
                  </button>
                </div>
              ))}
            </div>
          ) : null}
        </Field>

        {metrics ? (
          <div
            role="status"
            aria-live="polite"
            className={`rounded-xl border px-3 py-2 text-sm ${
              metrics.qualified ? "border-good/30 bg-good/5" : "border-danger/30 bg-danger/5"
            }`}
          >
            <div className="flex items-center justify-between gap-3">
              <span className="text-muted-foreground">
                {type === "run"
                  ? formatPace(metrics.averagePace)
                  : `${metrics.averageSpeed?.toFixed(1)} km/h`}
              </span>
              <span className={`font-semibold ${metrics.qualified ? "text-good" : "text-danger"}`}>
                {metrics.qualified
                  ? `${metrics.equivalent.toFixed(2)} challenge km`
                  : "Does not qualify"}
              </span>
            </div>
            {!metrics.qualified ? (
              <p className="mt-1 text-[11px] text-muted-foreground">
                {type === "run"
                  ? "Run pace must be under 7:00 min/km."
                  : "Ride speed must be at least 18 km/h."}
              </p>
            ) : null}
          </div>
        ) : null}

        <button
          type="button"
          disabled={busy}
          aria-expanded={moreOpen}
          onClick={() => setMoreOpen((open) => !open)}
          className="flex min-h-11 w-full items-center justify-between rounded-lg px-2 py-2 text-xs font-medium text-muted-foreground disabled:opacity-60"
        >
          More details
          <ChevronDown
            className={`h-4 w-4 transition-transform ${moreOpen ? "rotate-180" : ""}`}
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
            <p className="text-xs font-semibold text-danger">Activity was not saved</p>
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
                : "Save activity"
          }
          aria-busy={busy}
          disabled={busy}
          onClick={() => void submit()}
          className="w-full rounded-xl bg-primary py-3 text-sm font-semibold text-primary-foreground disabled:opacity-60"
        >
          {pending === "uploading" ? (
            <PendingLabel>Uploading evidence…</PendingLabel>
          ) : pending === "saving" ? (
            <PendingLabel>Saving activity…</PendingLabel>
          ) : (
            "Save activity"
          )}
        </button>
        <Note>
          Activities can only be logged inside the current, open week. Screenshots are private to
          both members. A run counts at 1:1 below 7:00 min/km; a ride counts at 3:1 from 18 km/h.
        </Note>
      </Card>
    </AppShell>
  );
}

const inputCls =
  "w-full rounded-xl border border-border bg-elevated px-3 py-2.5 text-sm outline-none";

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-[11px] uppercase tracking-wider text-muted-foreground">
        {label}
      </span>
      {children}
    </label>
  );
}
