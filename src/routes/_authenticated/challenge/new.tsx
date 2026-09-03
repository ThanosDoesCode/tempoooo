import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { addDays, format, startOfWeek } from "date-fns";
import { useRef, useState } from "react";
import { AppShell, PageHeader } from "@/components/AppShell";
import { ChallengePrimer } from "@/components/challenge-rules";
import { Card, Note, PendingLabel, SectionTitle } from "@/components/ui-kit";
import { supabase } from "@/integrations/supabase/client";
import { randomToken, sha256Hex, useAuth } from "@/lib/auth";
import { userFacingError } from "@/lib/network-errors";

export const Route = createFileRoute("/_authenticated/challenge/new")({
  head: () => ({
    meta: [
      { title: "Create challenge — Tempo" },
      {
        name: "description",
        content:
          "Create a private two-person 52-week running and cycling challenge and invite exactly one opponent.",
      },
      { property: "og:title", content: "Create challenge" },
      { property: "og:description", content: "Private, invite-only, 52 weeks, 15 km per week." },
    ],
  }),
  component: NewChallenge,
});

const TIMEZONES = [
  "Europe/Athens",
  "Europe/Stockholm",
  "Europe/London",
  "Europe/Berlin",
  "America/New_York",
  "UTC",
];

function NewChallenge() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const nextMonday = format(addDays(startOfWeek(new Date(), { weekStartsOn: 1 }), 7), "yyyy-MM-dd");
  const [name, setName] = useState("52-week challenge");
  const [start, setStart] = useState(nextMonday);
  const [timezone, setTimezone] = useState("Europe/Athens");
  const [weeks, setWeeks] = useState(52);
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [link, setLink] = useState<string | null>(null);
  const createLock = useRef(false);
  const creation = useRef<{ requestId: string; token: string } | null>(null);

  const create = async () => {
    if (!user || createLock.current) return;
    createLock.current = true;
    setBusy(true);
    setError(null);
    try {
      const request = creation.current ?? {
        requestId: crypto.randomUUID(),
        token: randomToken(),
      };
      creation.current = request;
      const { data: challengeId, error: rpcError } = await supabase.rpc("create_challenge_atomic", {
        _request_id: request.requestId,
        _name: name,
        _start_date: start,
        _timezone: timezone,
        _duration_weeks: Math.max(52, weeks),
        _invited_email: email,
        _token_hash: await sha256Hex(request.token),
      });
      if (rpcError) throw rpcError;
      if (challengeId !== request.requestId) {
        throw new Error("Challenge creation returned an unexpected result");
      }
      setLink(`${window.location.origin}/invite/challenge/${request.token}`);
    } catch (e) {
      setError(userFacingError(e, "create the challenge", { inputPreserved: true }));
    } finally {
      createLock.current = false;
      setBusy(false);
    }
  };

  if (link) {
    return (
      <AppShell>
        <PageHeader title="Challenge created" subtitle="Send this invitation to your opponent." />
        <Card>
          <SectionTitle>One-time invitation link</SectionTitle>
          <p className="break-all rounded-xl border border-border bg-elevated p-3 text-xs">
            {link}
          </p>
          <button
            onClick={() => void navigator.clipboard.writeText(link)}
            className="mt-3 w-full rounded-xl bg-primary py-2.5 text-sm font-semibold text-primary-foreground"
          >
            Copy link
          </button>
          <Note>
            Only {email} can accept it, it expires in 14 days, and it stops working as soon as the
            second member joins.
          </Note>
        </Card>
        <button
          onClick={() => void navigate({ to: "/challenge" })}
          className="mt-4 w-full rounded-xl border border-border py-2.5 text-sm font-medium"
        >
          Go to challenge
        </button>
      </AppShell>
    );
  }

  return (
    <AppShell>
      <PageHeader title="Create challenge" subtitle="Private, two people, minimum 52 weeks." />
      <ChallengePrimer />
      <Card className="mt-3 space-y-3">
        <Labelled label="Challenge name">
          <input value={name} onChange={(e) => setName(e.target.value)} className={inputCls} />
        </Labelled>
        <Labelled label="Start date (Monday)">
          <input
            type="date"
            value={start}
            onChange={(e) => setStart(e.target.value)}
            className={inputCls}
          />
        </Labelled>
        <Labelled label="Timezone">
          <select
            value={timezone}
            onChange={(e) => setTimezone(e.target.value)}
            className={inputCls}
          >
            {TIMEZONES.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
        </Labelled>
        <Labelled label="Duration (weeks, min 52)">
          <input
            type="number"
            min={52}
            value={weeks}
            onChange={(e) => setWeeks(Number(e.target.value))}
            className={inputCls}
          />
        </Labelled>
        <Labelled label="Opponent email">
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="friend@email.com"
            className={inputCls}
          />
        </Labelled>
        {error ? (
          <p role="alert" className="text-xs text-danger">
            {error}
          </p>
        ) : null}
        <button
          disabled={busy || !email}
          onClick={() => void create()}
          className="w-full rounded-xl bg-primary py-3 text-sm font-semibold text-primary-foreground disabled:opacity-60"
        >
          {busy ? <PendingLabel>Creating challenge…</PendingLabel> : "Create challenge"}
        </button>
      </Card>
    </AppShell>
  );
}

const inputCls =
  "w-full rounded-xl border border-border bg-elevated px-3 py-2.5 text-sm outline-none";

function Labelled({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-[11px] uppercase tracking-wider text-muted-foreground">
        {label}
      </span>
      {children}
    </label>
  );
}
