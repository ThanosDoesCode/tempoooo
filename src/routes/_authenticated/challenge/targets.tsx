import { createFileRoute } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { format, parseISO } from "date-fns";
import { AppShell, PageHeader } from "@/components/AppShell";
import { Card, Note, SectionTitle } from "@/components/ui-kit";
import { useAuth } from "@/lib/auth";
import {
  DEFAULT_TARGET_KM,
  setWeekTargets,
  targetForWeek,
  todayIn,
  useMyChallenge,
  useWeekTargets,
  weekBounds,
  weekNumberOf,
} from "@/lib/challenge";

export const Route = createFileRoute("/_authenticated/challenge/targets")({
  head: () => ({
    meta: [
      { title: "Weekly targets — Challenge" },
      {
        name: "description",
        content:
          "Set a lower or higher kilometre target for upcoming weeks when life gets busy. Past and current weeks stay locked.",
      },
      { property: "og:title", content: "Weekly targets — Challenge" },
      {
        property: "og:description",
        content: "Adjust the weekly kilometre target for future weeks only.",
      },
    ],
  }),
  component: Targets,
});

function Targets() {
  const { user } = useAuth();
  const qc = useQueryClient();
  const { data: challenge } = useMyChallenge();
  const { data: overrides } = useWeekTargets(challenge?.id);
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [value, setValue] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);

  const currentWeek = challenge ? weekNumberOf(challenge, todayIn(challenge.timezone)) : 0;
  const isCreator = !!challenge && challenge.created_by === user?.id;

  const upcoming = useMemo(() => {
    if (!challenge) return [];
    const list: { n: number; start: string; end: string; target: number; custom: boolean }[] = [];
    for (let n = Math.max(1, currentWeek + 1); n <= challenge.duration_weeks; n++) {
      const b = weekBounds(challenge, n);
      list.push({
        n,
        start: b.start,
        end: b.end,
        target: targetForWeek(challenge, overrides, n),
        custom: !!overrides?.some((o) => o.week_number === n),
      });
    }
    return list.slice(0, 26);
  }, [challenge, overrides, currentWeek]);

  const apply = async (weeks: number[], km: number | null) => {
    if (!challenge) return;
    setBusy(true);
    setError(null);
    setOk(null);
    try {
      await setWeekTargets(challenge.id, weeks, km);
      await qc.invalidateQueries({ queryKey: ["challenge-week-targets"] });
      setOk(km === null ? "Back to the default target." : `Saved ${km} km.`);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const applyRange = () => {
    const a = Number(from);
    const b = Number(to || from);
    const km = value === "" ? null : (parseDecimal(value) ?? null);
    if (!a || !b || b < a) {
      setError("Enter a valid week range.");
      return;
    }
    if (a <= currentWeek) {
      setError(`Week ${a} has already started. Start from week ${currentWeek + 1}.`);
      return;
    }
    const weeks: number[] = [];
    for (let n = a; n <= b; n++) weeks.push(n);
    void apply(weeks, km);
  };

  if (!challenge) {
    return (
      <AppShell>
        <PageHeader title="Weekly targets" />
        <Note>You are not part of a challenge yet.</Note>
      </AppShell>
    );
  }

  return (
    <AppShell>
      <PageHeader
        title="Weekly targets"
        subtitle={`Default is ${Number(challenge.weekly_target_km || DEFAULT_TARGET_KM).toFixed(0)} equivalent km. Only future weeks can change.`}
      />

      {!isCreator ? (
        <Note>
          Only the person who created this challenge can change targets. You can see what is set for
          the weeks ahead below.
        </Note>
      ) : (
        <Card className="space-y-3">
          <SectionTitle>Set a range</SectionTitle>
          <div className="grid grid-cols-3 gap-2">
            <Field label="From week">
              <input
                type="number"
                inputMode="numeric"
                value={from}
                onChange={(e) => setFrom(e.target.value)}
                placeholder={String(currentWeek + 1)}
                className={inputCls}
              />
            </Field>
            <Field label="To week">
              <input
                type="number"
                inputMode="numeric"
                value={to}
                onChange={(e) => setTo(e.target.value)}
                placeholder={String(currentWeek + 1)}
                className={inputCls}
              />
            </Field>
            <Field label="Target km">
              <input
                type="text"
                inputMode="decimal"
                value={value}
                onChange={(e) => {
                  const raw = e.target.value;
                  if (!/^[0-9]*[.,]?[0-9]*$/.test(raw)) return;
                  setValue(raw);
                }}
                placeholder="10"
                className={inputCls}
              />
            </Field>
          </div>
          <button
            disabled={busy}
            onClick={applyRange}
            className="w-full rounded-xl bg-primary py-2.5 text-sm font-semibold text-primary-foreground disabled:opacity-60"
          >
            {busy ? "Saving…" : "Apply to these weeks"}
          </button>
          <Note>
            Leave the target empty and apply to reset those weeks to the default. A busy month is
            one action: for example weeks {currentWeek + 1} to {currentWeek + 4} at 8 km.
          </Note>
          {error ? <p className="text-xs text-danger">{error}</p> : null}
          {ok ? <p className="text-xs text-good">{ok}</p> : null}
        </Card>
      )}

      <div className="mt-4 space-y-2">
        <SectionTitle>Upcoming weeks</SectionTitle>
        {upcoming.length === 0 ? <Note>No upcoming weeks left in this challenge.</Note> : null}
        {upcoming.map((w) => (
          <Card key={w.n} className="p-3">
            <div className="flex items-center justify-between gap-3">
              <div className="min-w-0">
                <p className="text-sm font-medium">Week {w.n}</p>
                <p className="text-[11px] text-muted-foreground">
                  {format(parseISO(w.start), "d MMM")} to {format(parseISO(w.end), "d MMM yyyy")}
                </p>
              </div>
              <div className="flex items-center gap-2">
                <span
                  className={`num rounded-lg px-2.5 py-1 text-sm font-semibold ${
                    w.custom ? "bg-primary/15 text-primary" : "bg-elevated text-muted-foreground"
                  }`}
                >
                  {w.target.toFixed(w.target % 1 === 0 ? 0 : 1)} km
                </span>
                {isCreator && w.custom ? (
                  <button
                    disabled={busy}
                    onClick={() => void apply([w.n], null)}
                    className="rounded-lg border border-border px-2 py-1 text-[11px] font-medium"
                  >
                    Reset
                  </button>
                ) : null}
              </div>
            </div>
          </Card>
        ))}
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
