import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { Check, ChevronDown, ImageUp } from "lucide-react";
import { toast } from "sonner";
import { AppShell, PageHeader } from "@/components/AppShell";
import { Card, Note, PendingLabel } from "@/components/ui-kit";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { normalizeDecimal, parseDecimal } from "@/lib/numeric";
import {
  targetForWeek,
  todayIn,
  useMyChallenge,
  useWeekTargets,
  weekNumberOf,
} from "@/lib/challenge";

export const Route = createFileRoute("/_authenticated/challenge/log")({
  head: () => ({
    meta: [
      { title: "Add activity — Challenge" },
      {
        name: "description",
        content:
          "Log a run or ride with a Strava screenshot as evidence and see the equivalent kilometres instantly.",
      },
      { property: "og:title", content: "Add activity — Challenge" },
      { property: "og:description", content: "Run or cycle, screenshot required." },
    ],
  }),
  component: LogActivity,
});

function LogActivity() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { data: challenge } = useMyChallenge();
  const { data: weekTargets } = useWeekTargets(challenge?.id);
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
  const [error, setError] = useState<string | null>(null);
  const [moreOpen, setMoreOpen] = useState(false);
  const busy = pending !== null;

  useEffect(() => {
    if (files.length === 0) {
      setPreviews([]);
      return;
    }
    const urls = files.map((f) => URL.createObjectURL(f));
    setPreviews(urls);
    return () => urls.forEach((u) => URL.revokeObjectURL(u));
  }, [files]);

  const parsedDistance = parseDecimal(distance);
  const dist = parsedDistance.kind === "value" ? parsedDistance.value : NaN;
  const equivalent = type === "run" ? dist : dist / 3;

  const submit = async () => {
    if (!challenge || !user || files.length === 0) return;
    const minutes = parseDecimal(duration);
    if (!(dist > 0 && dist <= 1000)) {
      setError("Enter a distance above 0 and no greater than 1,000 km.");
      return;
    }
    const seconds = minutes.kind === "value" ? Math.round(minutes.value * 60) : null;
    if (minutes.kind === "invalid" || (seconds != null && (seconds <= 0 || seconds > 2147483647))) {
      setError("Enter a valid positive duration in minutes, or leave it blank.");
      return;
    }
    setDistance(normalizeDecimal(distance));
    setDuration(normalizeDecimal(duration));
    setPending("uploading");
    setError(null);
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
      void qc.invalidateQueries({ queryKey: ["challenge-activities"] });
      toast.success("Activity saved.");
      void navigate({ to: "/challenge" });
    } catch (e) {
      setError(`Could not save activity. ${(e as Error).message}`);
    } finally {
      setPending(null);
    }
  };

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
        subtitle={`${targetForWeek(challenge, weekTargets, weekNumberOf(challenge, today)).toFixed(0)} equivalent km this week · screenshot required.`}
      />
      <Card className="space-y-3 p-3">
        <div className="grid grid-cols-2 gap-2">
          {(["run", "cycle"] as const).map((t) => (
            <button
              key={t}
              type="button"
              disabled={busy}
              onClick={() => setType(t)}
              className={`rounded-xl border py-2.5 text-sm font-medium capitalize disabled:opacity-60 ${
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

        {dist > 0 ? (
          <div className="flex items-center justify-between rounded-xl bg-elevated px-3 py-2 text-sm">
            <span className="text-muted-foreground">Equivalent distance</span>
            <span className="num font-semibold">{equivalent.toFixed(2)} km</span>
          </div>
        ) : null}

        <button
          type="button"
          disabled={busy}
          aria-expanded={moreOpen}
          onClick={() => setMoreOpen((open) => !open)}
          className="flex w-full items-center justify-between rounded-lg px-1 py-1 text-xs font-medium text-muted-foreground disabled:opacity-60"
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
            <Field label="Duration in minutes (optional)">
              <input
                type="text"
                inputMode="decimal"
                value={duration}
                disabled={busy}
                onChange={(e) => setDuration(e.target.value)}
                onBlur={() => setDuration(normalizeDecimal(duration))}
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
        {error ? (
          <p role="alert" className="text-xs text-danger">
            {error}
          </p>
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
          disabled={busy || files.length === 0}
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
          both challenge members. Running counts 1:1; cycling counts 3:1.
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
