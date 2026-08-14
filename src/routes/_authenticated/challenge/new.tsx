import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { addDays, format, startOfWeek } from "date-fns";
import { useState } from "react";
import { AppShell, PageHeader } from "@/components/AppShell";
import { RulesCard } from "@/components/challenge-rules";
import { Card, Note, SectionTitle } from "@/components/ui-kit";
import { supabase } from "@/integrations/supabase/client";
import { randomToken, sha256Hex, useAuth } from "@/lib/auth";

export const Route = createFileRoute("/_authenticated/challenge/new")({
  head: () => ({
    meta: [
      { title: "Create challenge — Lean Bulk Tracker" },
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

  const create = async () => {
    if (!user) return;
    setBusy(true);
    setError(null);
    try {
      const { data: ch, error: e1 } = await supabase
        .from("challenges")
        .insert({
          created_by: user.id,
          name,
          start_date: start,
          timezone,
          duration_weeks: Math.max(52, weeks),
        })
        .select("id")
        .single();
      if (e1) throw e1;
      const { error: e2 } = await supabase
        .from("challenge_members")
        .insert({ challenge_id: ch.id, user_id: user.id });
      if (e2) throw e2;

      const token = randomToken();
      const { error: e3 } = await supabase.from("challenge_invitations").insert({
        challenge_id: ch.id,
        invited_email: email.trim().toLowerCase(),
        token_hash: await sha256Hex(token),
        expires_at: new Date(Date.now() + 14 * 86_400_000).toISOString(),
        created_by: user.id,
      });
      if (e3) throw e3;
      setLink(`${window.location.origin}/invite/challenge/${token}`);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  if (link) {
    return (
      <AppShell>
        <PageHeader title="Challenge created" subtitle="Send this invitation to your opponent." />
        <Card>
          <SectionTitle>One-time invitation link</SectionTitle>
          <p className="break-all rounded-xl border border-border bg-elevated p-3 text-xs">{link}</p>
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
      <RulesCard />
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
        {error ? <p className="text-xs text-danger">{error}</p> : null}
        <button
          disabled={busy || !email}
          onClick={() => void create()}
          className="w-full rounded-xl bg-primary py-3 text-sm font-semibold text-primary-foreground disabled:opacity-60"
        >
          Create challenge
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
