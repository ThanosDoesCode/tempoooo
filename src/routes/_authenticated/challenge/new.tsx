import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { addDays, format, startOfWeek } from "date-fns";
import { useRef, useState } from "react";
import { AppShell, PageHeader } from "@/components/AppShell";
import { ChallengePrimer, ChallengeTermsSummary } from "@/components/challenge-rules";
import { Card, Note, PendingLabel, SectionTitle } from "@/components/ui-kit";
import { supabase } from "@/integrations/supabase/client";
import { randomToken, sha256Hex, useAuth } from "@/lib/auth";
import type { PenaltyMode } from "@/lib/challenge";
import { COUNTRIES, countryListLabel } from "@/lib/countries";
import { userFacingError } from "@/lib/network-errors";

export const Route = createFileRoute("/_authenticated/challenge/new")({
  head: () => ({
    meta: [
      { title: "Tempo" },
      {
        name: "description",
        content:
          "Create a private two-person 52-week running and cycling challenge and invite exactly one opponent.",
      },
      { property: "og:title", content: "Tempo" },
      {
        property: "og:description",
        content: "Create a private 52-week challenge with an agreed weekly target.",
      },
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
  const [target, setTarget] = useState("15");
  const [penaltyMode, setPenaltyMode] = useState<PenaltyMode>("money");
  const [highPenalty, setHighPenalty] = useState("15");
  const [mediumPenalty, setMediumPenalty] = useState("10");
  const [lowPenalty, setLowPenalty] = useState("5");
  const [highCustom, setHighCustom] = useState("");
  const [mediumCustom, setMediumCustom] = useState("");
  const [lowCustom, setLowCustom] = useState("");
  const [travelPauseEnabled, setTravelPauseEnabled] = useState(true);
  const [homeCountries, setHomeCountries] = useState<string[]>(["GR", "SE"]);
  const [countryToAdd, setCountryToAdd] = useState("");
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [link, setLink] = useState<string | null>(null);
  const createLock = useRef(false);
  const creation = useRef<{ requestId: string; token: string } | null>(null);
  const terms = {
    weekly_target_km: Number(target),
    penalty_mode: penaltyMode,
    penalty_high_eur: Number(highPenalty),
    penalty_medium_eur: Number(mediumPenalty),
    penalty_low_eur: Number(lowPenalty),
    penalty_high_custom: highCustom.trim() || null,
    penalty_medium_custom: mediumCustom.trim() || null,
    penalty_low_custom: lowCustom.trim() || null,
    legacy_photo_owed: false,
    travel_pause_enabled: travelPauseEnabled,
    travel_pause_home_countries: travelPauseEnabled ? homeCountries : [],
  };
  const validDecimal = (value: string) => /^\d+(?:\.\d{1,2})?$/.test(value);
  const customTermsValid = [highCustom, mediumCustom, lowCustom].every(
    (value) => value.trim().length >= 1 && value.trim().length <= 160,
  );
  const moneyTermsValid =
    [highPenalty, mediumPenalty, lowPenalty].every(validDecimal) &&
    [terms.penalty_high_eur, terms.penalty_medium_eur, terms.penalty_low_eur].every(
      (amount) => Number.isFinite(amount) && amount >= 0 && amount <= 1000,
    ) &&
    terms.penalty_high_eur >= terms.penalty_medium_eur &&
    terms.penalty_medium_eur >= terms.penalty_low_eur;
  const termsValid =
    validDecimal(target) &&
    Number.isFinite(terms.weekly_target_km) &&
    terms.weekly_target_km >= 1 &&
    terms.weekly_target_km <= 500 &&
    (penaltyMode === "money" ? moneyTermsValid : customTermsValid) &&
    (!travelPauseEnabled || (homeCountries.length >= 1 && homeCountries.length <= 12));

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
      const challengeId = await createChallenge({
        data: {
          requestId: request.requestId,
          name,
          startDate: start,
          timezone,
          durationWeeks: Math.max(52, weeks),
          invitedEmail: email,
          tokenHash: await sha256Hex(request.token),
          weeklyTargetKm: terms.weekly_target_km,
          penaltyMode: terms.penalty_mode,
          penaltyHighEur: terms.penalty_high_eur,
          penaltyMediumEur: terms.penalty_medium_eur,
          penaltyLowEur: terms.penalty_low_eur,
          penaltyHighCustom: terms.penalty_high_custom,
          penaltyMediumCustom: terms.penalty_medium_custom,
          penaltyLowCustom: terms.penalty_low_custom,
          travelPauseEnabled: terms.travel_pause_enabled,
          travelPauseHomeCountries: terms.travel_pause_home_countries,
        },
      });
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
      <ChallengePrimer terms={terms} />
      <Card className="mt-3 min-w-0 space-y-3">
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
        <Labelled label="Weekly target (challenge km)">
          <input
            type="number"
            inputMode="decimal"
            min={1}
            max={500}
            step="0.01"
            value={target}
            onChange={(event) => setTarget(event.target.value)}
            className={inputCls}
          />
        </Labelled>
        <fieldset className="rounded-xl border border-border p-3">
          <legend className="px-1 text-[11px] uppercase tracking-wider text-muted-foreground">
            Penalty mode
          </legend>
          <div className="grid grid-cols-2 gap-2">
            {(["money", "custom"] as const).map((mode) => (
              <button
                key={mode}
                type="button"
                aria-pressed={penaltyMode === mode}
                onClick={() => setPenaltyMode(mode)}
                className={`min-h-11 rounded-xl border px-3 py-2 text-sm font-semibold capitalize ${
                  penaltyMode === mode
                    ? "border-primary bg-primary/15 text-primary"
                    : "border-border bg-elevated text-muted-foreground"
                }`}
              >
                {mode}
              </button>
            ))}
          </div>
        </fieldset>
        {penaltyMode === "money" ? (
          <fieldset className="rounded-xl border border-border p-3">
            <legend className="px-1 text-[11px] uppercase tracking-wider text-muted-foreground">
              Weekly money penalties
            </legend>
            <div className="grid grid-cols-3 gap-2">
              <MoneyInput label="High" value={highPenalty} onChange={setHighPenalty} />
              <MoneyInput label="Medium" value={mediumPenalty} onChange={setMediumPenalty} />
              <MoneyInput label="Low" value={lowPenalty} onChange={setLowPenalty} />
            </div>
            <p className="mt-2 text-[11px] text-muted-foreground">
              High must be at least medium, and medium at least low.
            </p>
          </fieldset>
        ) : (
          <fieldset className="space-y-2 rounded-xl border border-border p-3">
            <legend className="px-1 text-[11px] uppercase tracking-wider text-muted-foreground">
              Custom consequences
            </legend>
            <CustomInput label="High shortfall" value={highCustom} onChange={setHighCustom} />
            <CustomInput label="Medium shortfall" value={mediumCustom} onChange={setMediumCustom} />
            <CustomInput label="Low shortfall" value={lowCustom} onChange={setLowCustom} />
          </fieldset>
        )}
        <fieldset className="min-w-0 rounded-xl border border-border p-3">
          <legend className="px-1 text-[11px] uppercase tracking-wider text-muted-foreground">
            Travel pause
          </legend>
          <div className="grid grid-cols-2 gap-2">
            {([true, false] as const).map((enabled) => (
              <button
                key={String(enabled)}
                type="button"
                aria-pressed={travelPauseEnabled === enabled}
                onClick={() => setTravelPauseEnabled(enabled)}
                className={`min-h-11 rounded-xl border px-3 py-2 text-sm font-semibold ${
                  travelPauseEnabled === enabled
                    ? "border-primary bg-primary/15 text-primary"
                    : "border-border bg-elevated text-muted-foreground"
                }`}
              >
                {enabled ? "Enabled" : "Disabled"}
              </button>
            ))}
          </div>
          {travelPauseEnabled ? (
            <div className="mt-3 min-w-0 space-y-2">
              <p className="text-xs text-muted-foreground">
                Participants may pause their own full week only while travelling outside every home
                country below. A paused week has a 0 km target and no penalty.
              </p>
              <div className="flex min-w-0 gap-2">
                <select
                  aria-label="Country to add"
                  value={countryToAdd}
                  onChange={(event) => setCountryToAdd(event.target.value)}
                  className={`${inputCls} min-w-0 flex-1`}
                >
                  <option value="">Add a home country…</option>
                  {COUNTRIES.filter((country) => !homeCountries.includes(country.code)).map(
                    (country) => (
                      <option key={country.code} value={country.code}>
                        {country.name}
                      </option>
                    ),
                  )}
                </select>
                <button
                  type="button"
                  disabled={!countryToAdd || homeCountries.length >= 12}
                  onClick={() => {
                    if (!countryToAdd || homeCountries.includes(countryToAdd)) return;
                    setHomeCountries((countries) => [...countries, countryToAdd].sort());
                    setCountryToAdd("");
                  }}
                  className="min-h-11 shrink-0 rounded-xl border border-border px-3 text-sm font-semibold disabled:opacity-50"
                >
                  Add
                </button>
              </div>
              <div className="flex flex-wrap gap-2" aria-label="Selected home countries">
                {homeCountries.map((code) => (
                  <button
                    key={code}
                    type="button"
                    aria-label={`Remove ${countryListLabel([code])}`}
                    onClick={() =>
                      setHomeCountries((countries) => countries.filter((c) => c !== code))
                    }
                    className="min-h-11 rounded-full border border-border bg-elevated px-3 text-xs font-medium"
                  >
                    {countryListLabel([code])} ×
                  </button>
                ))}
              </div>
              {homeCountries.length ? (
                <p className="text-xs text-muted-foreground">
                  Pause allowed while travelling outside{" "}
                  {countryListLabel(homeCountries, "disjunction")}.
                </p>
              ) : (
                <p role="alert" className="text-xs text-danger">
                  Select at least one home country.
                </p>
              )}
            </div>
          ) : (
            <p className="mt-3 text-xs text-muted-foreground">
              Travel pauses will not be allowed for this Challenge.
            </p>
          )}
        </fieldset>
        <div className="rounded-xl bg-elevated p-3">
          <p className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
            Live penalty summary
          </p>
          {termsValid ? (
            <ChallengeTermsSummary terms={terms} />
          ) : (
            <p className="text-xs text-danger">
              Enter a valid target and complete all {penaltyMode} penalty terms.
            </p>
          )}
        </div>
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
          disabled={busy || !email || !termsValid}
          onClick={() => void create()}
          className="w-full rounded-xl bg-primary py-3 text-sm font-semibold text-primary-foreground disabled:opacity-60"
        >
          {busy ? <PendingLabel>Creating challenge…</PendingLabel> : "Create challenge"}
        </button>
      </Card>
    </AppShell>
  );
}

function MoneyInput({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <label>
      <span className="mb-1 block text-[10px] text-muted-foreground">{label} €</span>
      <input
        type="number"
        inputMode="decimal"
        min={0}
        max={1000}
        step="0.01"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className={inputCls}
      />
    </label>
  );
}

function CustomInput({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <label>
      <span className="mb-1 block text-[10px] text-muted-foreground">{label}</span>
      <input
        type="text"
        maxLength={160}
        value={value}
        placeholder="e.g. Buy dinner"
        onChange={(event) => onChange(event.target.value)}
        className={inputCls}
      />
    </label>
  );
}

const inputCls =
  "block min-w-0 w-full max-w-full rounded-xl border border-border bg-elevated px-3 py-2.5 text-sm outline-none";

function Labelled({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block min-w-0 w-full max-w-full">
      <span className="mb-1 block text-[11px] uppercase tracking-wider text-muted-foreground">
        {label}
      </span>
      {children}
    </label>
  );
}
