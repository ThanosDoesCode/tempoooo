import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { AppShell, PageHeader } from "@/components/AppShell";
import { Card, Note, SectionTitle } from "@/components/ui-kit";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { todayIn, useMyChallenge } from "@/lib/challenge";

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
  const today = challenge ? todayIn(challenge.timezone) : new Date().toISOString().slice(0, 10);

  const [type, setType] = useState<"run" | "cycle">("run");
  const [distance, setDistance] = useState("");
  const [date, setDate] = useState(today);
  const [duration, setDuration] = useState("");
  const [url, setUrl] = useState("");
  const [note, setNote] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const dist = Number(distance);
  const equivalent = type === "run" ? dist : dist / 3;

  const submit = async () => {
    if (!challenge || !user || !file || !dist) return;
    setBusy(true);
    setError(null);
    try {
      const ext = file.name.split(".").pop() ?? "jpg";
      const path = `${challenge.id}/${user.id}/${crypto.randomUUID()}.${ext}`;
      const up = await supabase.storage.from("challenge-evidence").upload(path, file);
      if (up.error) throw up.error;
      const { error } = await supabase.from("challenge_activities").insert({
        challenge_id: challenge.id,
        user_id: user.id,
        activity_type: type,
        distance_km: dist,
        activity_date: date,
        duration_seconds: duration ? Math.round(Number(duration) * 60) : null,
        evidence_path: path,
        external_activity_url: url || null,
        note: note || null,
        verification_source: "manual_strava_screenshot",
      });
      if (error) throw error;
      await qc.invalidateQueries({ queryKey: ["challenge-activities"] });
      void navigate({ to: "/challenge" });
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
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
      <PageHeader title="Add activity" subtitle="Evidence screenshot is required." />
      <Card className="space-y-3">
        <div className="grid grid-cols-2 gap-2">
          {(["run", "cycle"] as const).map((t) => (
            <button
              key={t}
              onClick={() => setType(t)}
              className={`rounded-xl border py-2.5 text-sm font-medium capitalize ${
                type === t ? "border-primary bg-primary/10 text-primary" : "border-border bg-elevated"
              }`}
            >
              {t}
            </button>
          ))}
        </div>

        <Field label="Distance (km)">
          <input
            type="number"
            inputMode="decimal"
            step="0.01"
            value={distance}
            onChange={(e) => setDistance(e.target.value)}
            className={inputCls}
          />
        </Field>
        <Field label="Activity date">
          <input
            type="date"
            max={today}
            value={date}
            onChange={(e) => setDate(e.target.value)}
            className={inputCls}
          />
        </Field>
        <Field label="Strava screenshot (required)">
          <input
            type="file"
            accept="image/*"
            onChange={(e) => setFile(e.target.files?.[0] ?? null)}
            className="w-full text-xs text-muted-foreground"
          />
        </Field>
        <Field label="Duration in minutes (optional)">
          <input
            type="number"
            inputMode="numeric"
            value={duration}
            onChange={(e) => setDuration(e.target.value)}
            className={inputCls}
          />
        </Field>
        <Field label="Strava URL (optional)">
          <input value={url} onChange={(e) => setUrl(e.target.value)} className={inputCls} />
        </Field>
        <Field label="Note (optional)">
          <input value={note} onChange={(e) => setNote(e.target.value)} className={inputCls} />
        </Field>

        {dist > 0 ? (
          <div className="rounded-xl border border-border bg-elevated px-3 py-2 text-sm">
            Equivalent: <span className="num font-semibold">{equivalent.toFixed(2)} km</span>
          </div>
        ) : null}
        {error ? <p className="text-xs text-danger">{error}</p> : null}
        <button
          disabled={busy || !file || !dist}
          onClick={() => void submit()}
          className="w-full rounded-xl bg-primary py-3 text-sm font-semibold text-primary-foreground disabled:opacity-60"
        >
          Save activity
        </button>
        <Note>
          Activities can only be logged inside the current, open week. Screenshots are private to
          the two members of this challenge.
        </Note>
      </Card>

      <div className="mt-4">
        <SectionTitle>Conversion</SectionTitle>
        <Note>1 km running = 1 equivalent km. 3 km cycling = 1 equivalent km.</Note>
      </div>
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
