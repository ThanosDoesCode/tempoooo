import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { addDays, format, parseISO, startOfWeek } from "date-fns";
import { useEffect, useRef, useState } from "react";
import { ArrowLeft } from "lucide-react";
import { AppShell } from "@/components/AppShell";
import { PendingLabel } from "@/components/ui-kit";
import { randomToken, sha256Hex, useAuth } from "@/lib/auth";
import { penaltyBands, type PenaltyMode } from "@/lib/challenge";
import { COUNTRIES, countryListLabel, countryName } from "@/lib/countries";
import { createChallenge, checkUsernameAvailability } from "@/lib/privileged-rpcs.functions";
import {
  challengeUsernameError,
  normalizeUsername,
  useAccountProfile,
  usernameValidationError,
} from "@/lib/account-profile";

const LENGTHS = [4, 12, 52] as const;
type Length = (typeof LENGTHS)[number];

export const Route = createFileRoute("/_authenticated/challenge/new")({
  validateSearch: (search: Record<string, unknown>): { step?: 1 | 2 | 3 } => {
    const step = Number(search["step"]);
    return { step: step === 2 ? 2 : step === 3 ? 3 : 1 };
  },
  head: () => ({
    meta: [
      { title: "Tempo" },
      {
        name: "description",
        content:
          "Create a private two-person running and cycling challenge and invite one opponent.",
      },
      { property: "og:title", content: "Tempo" },
      { property: "og:description", content: "Pick the length, the weekly target and the stakes." },
    ],
  }),
  component: NewChallenge,
});

function NewChallenge() {
  const { step = 1 } = Route.useSearch();
  const { user } = useAuth();
  const navigate = useNavigate();
  const myProfile = useAccountProfile(user?.id);

  const nextMonday = format(addDays(startOfWeek(new Date(), { weekStartsOn: 1 }), 7), "yyyy-MM-dd");
  const timezone = (() => {
    try {
      return Intl.DateTimeFormat().resolvedOptions().timeZone || "Europe/Athens";
    } catch {
      return "Europe/Athens";
    }
  })();

  const [username, setUsername] = useState("");
  const [length, setLength] = useState<Length>(12);
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
  const [usernameState, setUsernameState] = useState<"idle" | "checking" | "found" | "missing">(
    "idle",
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const createLock = useRef(false);
  const creation = useRef<{ requestId: string; token: string } | null>(null);

  const normalized = normalizeUsername(username);
  const formatError = usernameValidationError(username);
  const isSelf = !!myProfile.data?.username && normalized === myProfile.data.username;

  // Real opponent lookup: a valid Tempo username must already exist and not be the current user.
  useEffect(() => {
    if (formatError || isSelf) {
      setUsernameState("idle");
      return;
    }
    setUsernameState("checking");
    const timer = window.setTimeout(() => {
      void checkUsernameAvailability({ data: { username: normalized } })
        .then((available) => setUsernameState(available ? "missing" : "found"))
        .catch(() => setUsernameState("idle"));
    }, 350);
    return () => window.clearTimeout(timer);
  }, [normalized, formatError, isSelf]);

  const targetKm = Number(target);
  const bands = penaltyBands({ weekly_target_km: Number.isFinite(targetKm) ? targetKm : 15 });

  const terms = {
    weekly_target_km: targetKm,
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
  const moneyValid =
    [highPenalty, mediumPenalty, lowPenalty].every(validDecimal) &&
    [terms.penalty_high_eur, terms.penalty_medium_eur, terms.penalty_low_eur].every(
      (amount) => Number.isFinite(amount) && amount >= 0 && amount <= 1000,
    ) &&
    terms.penalty_high_eur >= terms.penalty_medium_eur &&
    terms.penalty_medium_eur >= terms.penalty_low_eur;
  const customValid = [highCustom, mediumCustom, lowCustom].every(
    (value) => value.trim().length >= 1 && value.trim().length <= 160,
  );
  const targetValid =
    validDecimal(target) && Number.isFinite(targetKm) && targetKm >= 1 && targetKm <= 500;
  const stakesValid = penaltyMode === "money" ? moneyValid : customValid;
  const travelValid =
    !travelPauseEnabled || (homeCountries.length >= 1 && homeCountries.length <= 12);

  const step1Valid = !formatError && !isSelf && usernameState === "found" && targetValid;

  const goStep = (next: 1 | 2 | 3) =>
    void navigate({ to: "/challenge/new", search: { step: next } });

  const create = async () => {
    if (!user || createLock.current) return;
    if (formatError) {
      setError(formatError);
      return;
    }
    createLock.current = true;
    setBusy(true);
    setError(null);
    try {
      const request = creation.current ?? { requestId: crypto.randomUUID(), token: randomToken() };
      creation.current = request;
      const challengeId = await createChallenge({
        data: {
          requestId: request.requestId,
          name: `${length}-week challenge`,
          startDate: nextMonday,
          timezone,
          durationWeeks: length,
          invitedUsername: normalized,
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
      void navigate({ to: "/challenge" });
    } catch (e) {
      setError(challengeUsernameError(e, username));
    } finally {
      createLock.current = false;
      setBusy(false);
    }
  };

  const atUser = normalized ? `@${normalized}` : "your opponent";

  return (
    <AppShell>
      <div className="flex min-h-[calc(100dvh-4rem)] flex-col gap-[18px]">
        <div className="flex items-center justify-between">
          {step === 1 ? (
            <button
              type="button"
              onClick={() => void navigate({ to: "/challenge" })}
              className="flex h-11 items-center text-[15px] text-muted-foreground"
            >
              Cancel
            </button>
          ) : (
            <button
              type="button"
              onClick={() => goStep((step - 1) as 1 | 2 | 3)}
              className="flex h-11 items-center gap-1 text-[15px] text-muted-foreground"
            >
              <ArrowLeft className="h-[18px] w-[18px]" aria-hidden="true" /> Back
            </button>
          )}
          <span className="text-sm text-muted-foreground">Step {step} of 3</span>
        </div>

        <div className="grid grid-cols-3 gap-1.5" aria-hidden="true">
          {[1, 2, 3].map((n) => (
            <span
              key={n}
              className={`h-1 rounded-full ${n <= step ? "bg-primary" : "bg-border"}`}
            />
          ))}
        </div>

        {step === 1 ? (
          <StepOne
            username={username}
            setUsername={setUsername}
            usernameState={usernameState}
            formatError={formatError}
            isSelf={isSelf}
            length={length}
            setLength={setLength}
            target={target}
            setTarget={setTarget}
            targetValid={targetValid}
          />
        ) : step === 2 ? (
          <StepTwo
            penaltyMode={penaltyMode}
            setPenaltyMode={setPenaltyMode}
            bands={bands}
            high={highPenalty}
            medium={mediumPenalty}
            low={lowPenalty}
            setHigh={setHighPenalty}
            setMedium={setMediumPenalty}
            setLow={setLowPenalty}
            highCustom={highCustom}
            mediumCustom={mediumCustom}
            lowCustom={lowCustom}
            setHighCustom={setHighCustom}
            setMediumCustom={setMediumCustom}
            setLowCustom={setLowCustom}
          />
        ) : (
          <StepThree
            travelPauseEnabled={travelPauseEnabled}
            setTravelPauseEnabled={setTravelPauseEnabled}
            homeCountries={homeCountries}
            setHomeCountries={setHomeCountries}
            countryToAdd={countryToAdd}
            setCountryToAdd={setCountryToAdd}
            atUser={atUser}
            startLabel={format(parseISO(nextMonday), "EEEE d MMM")}
            length={length}
            target={target}
            penaltyMode={penaltyMode}
            high={highPenalty}
            medium={mediumPenalty}
            low={lowPenalty}
            highCustom={highCustom}
          />
        )}

        {error ? (
          <p role="alert" className="text-[13px] text-danger">
            {error}
          </p>
        ) : null}

        <div className="mt-auto pt-2">
          {step === 1 ? (
            <button
              type="button"
              disabled={!step1Valid}
              onClick={() => goStep(2)}
              className="h-[54px] w-full rounded-[16px] bg-primary text-base font-semibold text-primary-foreground disabled:opacity-50"
            >
              Continue
            </button>
          ) : step === 2 ? (
            <button
              type="button"
              disabled={!stakesValid}
              onClick={() => goStep(3)}
              className="h-[54px] w-full rounded-[16px] bg-primary text-base font-semibold text-primary-foreground disabled:opacity-50"
            >
              Continue
            </button>
          ) : (
            <button
              type="button"
              disabled={busy || !targetValid || !stakesValid || !travelValid || !!formatError}
              onClick={() => void create()}
              className="h-[54px] w-full rounded-[16px] bg-primary text-base font-semibold text-primary-foreground disabled:opacity-50"
            >
              {busy ? <PendingLabel>Sending invite…</PendingLabel> : `Send invite to ${atUser}`}
            </button>
          )}
        </div>
      </div>
    </AppShell>
  );
}

function StepOne({
  username,
  setUsername,
  usernameState,
  formatError,
  isSelf,
  length,
  setLength,
  target,
  setTarget,
  targetValid,
}: {
  username: string;
  setUsername: (v: string) => void;
  usernameState: "idle" | "checking" | "found" | "missing";
  formatError: string | null;
  isSelf: boolean;
  length: Length;
  setLength: (v: Length) => void;
  target: string;
  setTarget: (v: string) => void;
  targetValid: boolean;
}) {
  const targetKm = Number(target);
  const step = (delta: number) =>
    setTarget(
      String(
        Math.min(500, Math.max(1, (Number.isFinite(targetKm) ? Math.round(targetKm) : 15) + delta)),
      ),
    );
  return (
    <>
      <div>
        <h1 className="text-[28px] font-semibold tracking-tight">Who are you taking on?</h1>
        <p className="mt-1.5 text-[15px] text-muted-foreground">
          Next: what’s at stake, then travel rules.
        </p>
      </div>

      <label className="flex flex-col gap-2">
        <span className="text-[13px] text-muted-foreground">Their username</span>
        <div className="flex h-14 items-center gap-1 rounded-[14px] border border-input bg-card px-4">
          <span className="text-lg text-muted-foreground">@</span>
          <input
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            autoCapitalize="none"
            autoCorrect="off"
            placeholder="username"
            aria-label="Opponent username"
            className="min-w-0 flex-1 bg-transparent text-lg font-semibold outline-none placeholder:font-normal placeholder:text-muted-foreground/50"
          />
        </div>
        {isSelf ? (
          <span className="text-[13px] text-danger">You can’t challenge yourself.</span>
        ) : formatError && username ? (
          <span className="text-[13px] text-danger">{formatError}</span>
        ) : usernameState === "checking" ? (
          <span className="text-[13px] text-muted-foreground">Checking…</span>
        ) : usernameState === "missing" ? (
          <span className="text-[13px] text-danger">No Tempo user with that username.</span>
        ) : usernameState === "found" ? (
          <span className="text-[13px] text-good">@{normalizeUsername(username)} is on Tempo.</span>
        ) : null}
      </label>

      <div className="flex flex-col gap-2">
        <span className="text-[13px] text-muted-foreground">How long?</span>
        <div
          className="grid grid-cols-3 gap-1 rounded-[13px] bg-card p-1"
          role="radiogroup"
          aria-label="Length"
        >
          {LENGTHS.map((weeks) => (
            <button
              key={weeks}
              type="button"
              role="radio"
              aria-checked={length === weeks}
              onClick={() => setLength(weeks)}
              className={`h-12 rounded-[10px] text-[15px] ${
                length === weeks
                  ? "bg-elevated font-semibold text-foreground"
                  : "font-medium text-muted-foreground"
              }`}
            >
              {weeks} weeks
            </button>
          ))}
        </div>
      </div>

      <div className="flex flex-col gap-2">
        <span className="text-[13px] text-muted-foreground">Weekly target</span>
        <div className="flex h-16 items-center justify-between rounded-[14px] bg-card px-2">
          <button
            type="button"
            aria-label="Less"
            onClick={() => step(-1)}
            className="h-12 w-12 rounded-xl bg-elevated text-2xl font-medium"
          >
            –
          </button>
          <span className="num text-2xl font-semibold">
            {targetValid ? Number(target) : target} km
          </span>
          <button
            type="button"
            aria-label="More"
            onClick={() => step(1)}
            className="h-12 w-12 rounded-xl bg-elevated text-2xl font-medium"
          >
            +
          </button>
        </div>
        <span className="text-[13px] text-muted-foreground">
          About 3 easy runs a week. Rides count at a third.
        </span>
      </div>
    </>
  );
}

function StepTwo({
  penaltyMode,
  setPenaltyMode,
  bands,
  high,
  medium,
  low,
  setHigh,
  setMedium,
  setLow,
  highCustom,
  mediumCustom,
  lowCustom,
  setHighCustom,
  setMediumCustom,
  setLowCustom,
}: {
  penaltyMode: PenaltyMode;
  setPenaltyMode: (v: PenaltyMode) => void;
  bands: ReturnType<typeof penaltyBands>;
  high: string;
  medium: string;
  low: string;
  setHigh: (v: string) => void;
  setMedium: (v: string) => void;
  setLow: (v: string) => void;
  highCustom: string;
  mediumCustom: string;
  lowCustom: string;
  setHighCustom: (v: string) => void;
  setMediumCustom: (v: string) => void;
  setLowCustom: (v: string) => void;
}) {
  const fmt = (value: number) =>
    new Intl.NumberFormat("en", { maximumFractionDigits: 1 }).format(value);
  return (
    <>
      <div>
        <h1 className="text-[28px] font-semibold tracking-tight">What’s at stake?</h1>
        <p className="mt-1.5 text-[15px] text-muted-foreground">
          The less you do, the more you pay.
        </p>
      </div>

      <div
        className="grid grid-cols-2 gap-1 rounded-[13px] bg-card p-1"
        role="radiogroup"
        aria-label="Penalty type"
      >
        {(["money", "custom"] as const).map((mode) => (
          <button
            key={mode}
            type="button"
            role="radio"
            aria-checked={penaltyMode === mode}
            onClick={() => setPenaltyMode(mode)}
            className={`h-12 rounded-[10px] text-[15px] ${
              penaltyMode === mode
                ? "bg-elevated font-semibold text-foreground"
                : "font-medium text-muted-foreground"
            }`}
          >
            {mode === "money" ? "Money" : "Something else"}
          </button>
        ))}
      </div>

      <div>
        <p className="mx-1 mb-2 text-[13px] text-muted-foreground">If you finish the week with…</p>
        <div className="rounded-[18px] bg-card px-4">
          <div className="flex min-h-16 items-center gap-3 border-t border-border first:border-t-0">
            <span className="flex-1 text-[15px]">{fmt(bands.target)} km or more</span>
            <span className="text-[15px] text-muted-foreground">Nothing</span>
          </div>
          {penaltyMode === "money" ? (
            <>
              <EurRow
                label={`${fmt(bands.mediumBelow)} to ${fmt(bands.target)} km`}
                value={low}
                onChange={setLow}
              />
              <EurRow
                label={`${fmt(bands.highBelow)} to ${fmt(bands.mediumBelow)} km`}
                value={medium}
                onChange={setMedium}
              />
              <EurRow label={`Under ${fmt(bands.highBelow)} km`} value={high} onChange={setHigh} />
            </>
          ) : (
            <>
              <CustomRow
                label={`${fmt(bands.mediumBelow)} to ${fmt(bands.target)} km`}
                value={lowCustom}
                onChange={setLowCustom}
              />
              <CustomRow
                label={`${fmt(bands.highBelow)} to ${fmt(bands.mediumBelow)} km`}
                value={mediumCustom}
                onChange={setMediumCustom}
              />
              <CustomRow
                label={`Under ${fmt(bands.highBelow)} km`}
                value={highCustom}
                onChange={setHighCustom}
              />
            </>
          )}
        </div>
      </div>

      <p className="mx-1 text-[13px] text-muted-foreground">
        {penaltyMode === "money"
          ? "Money is paid between you two, outside the app. Tempo keeps track."
          : "Agree the consequence between you two. Tempo keeps track of who owes what."}
      </p>
    </>
  );
}

function EurRow({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <div className="flex min-h-16 items-center gap-3 border-t border-border">
      <span className="flex-1 text-[15px]">{label}</span>
      <div className="flex h-11 w-[92px] items-center gap-0.5 rounded-xl bg-elevated px-3">
        <span className="text-muted-foreground">€</span>
        <input
          value={value}
          inputMode="numeric"
          onChange={(e) => onChange(e.target.value)}
          aria-label={`Penalty for ${label}`}
          className="num w-full bg-transparent text-right text-lg font-semibold outline-none"
        />
      </div>
    </div>
  );
}

function CustomRow({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <div className="flex min-h-16 flex-col justify-center gap-1 border-t border-border py-2">
      <span className="text-[13px] text-muted-foreground">{label}</span>
      <input
        value={value}
        maxLength={160}
        placeholder="e.g. Buy dinner"
        onChange={(e) => onChange(e.target.value)}
        aria-label={`Consequence for ${label}`}
        className="w-full bg-transparent text-[15px] outline-none placeholder:text-muted-foreground/50"
      />
    </div>
  );
}

function StepThree({
  travelPauseEnabled,
  setTravelPauseEnabled,
  homeCountries,
  setHomeCountries,
  countryToAdd,
  setCountryToAdd,
  atUser,
  startLabel,
  length,
  target,
  penaltyMode,
  high,
  medium,
  low,
  highCustom,
}: {
  travelPauseEnabled: boolean;
  setTravelPauseEnabled: (v: boolean) => void;
  homeCountries: string[];
  setHomeCountries: (updater: (prev: string[]) => string[]) => void;
  countryToAdd: string;
  setCountryToAdd: (v: string) => void;
  atUser: string;
  startLabel: string;
  length: Length;
  target: string;
  penaltyMode: PenaltyMode;
  high: string;
  medium: string;
  low: string;
  highCustom: string;
}) {
  const [adding, setAdding] = useState(false);
  const stakes =
    penaltyMode === "money"
      ? `€${low} · €${medium} · €${high}`
      : highCustom.trim()
        ? "Something else"
        : "Something else";
  return (
    <>
      <h1 className="text-[28px] font-semibold tracking-tight">Travel, then check it over</h1>

      <div className="flex flex-col gap-3 rounded-[18px] bg-card p-4">
        <label className="flex items-center gap-3 text-[15px]">
          <span className="flex-1">Let us pause a week when travelling</span>
          <input
            type="checkbox"
            role="switch"
            checked={travelPauseEnabled}
            onChange={(e) => setTravelPauseEnabled(e.target.checked)}
            className="h-8 w-[52px] flex-none appearance-none rounded-2xl bg-border transition-colors checked:bg-primary relative before:absolute before:left-[3px] before:top-[3px] before:h-[26px] before:w-[26px] before:rounded-full before:bg-foreground before:transition-transform checked:before:translate-x-5 checked:before:bg-primary-foreground"
          />
        </label>
        {travelPauseEnabled ? (
          <>
            <p className="text-[13px] text-muted-foreground">
              Pausing works anywhere outside your home countries:
            </p>
            <div className="flex flex-wrap gap-2">
              {homeCountries.map((code) => (
                <button
                  key={code}
                  type="button"
                  aria-label={`Remove ${countryName(code)}`}
                  onClick={() => setHomeCountries((prev) => prev.filter((c) => c !== code))}
                  className="inline-flex h-9 items-center gap-1.5 rounded-full bg-elevated px-3 text-sm"
                >
                  {countryName(code)} <span className="text-muted-foreground">×</span>
                </button>
              ))}
              {adding ? (
                <select
                  autoFocus
                  value={countryToAdd}
                  onChange={(e) => {
                    const code = e.target.value;
                    if (code && !homeCountries.includes(code) && homeCountries.length < 12) {
                      setHomeCountries((prev) => [...prev, code].sort());
                    }
                    setCountryToAdd("");
                    setAdding(false);
                  }}
                  className="h-9 rounded-full border border-dashed border-input bg-transparent px-3 text-sm text-primary outline-none"
                >
                  <option value="">Select…</option>
                  {COUNTRIES.filter((c) => !homeCountries.includes(c.code)).map((c) => (
                    <option key={c.code} value={c.code}>
                      {c.name}
                    </option>
                  ))}
                </select>
              ) : (
                <button
                  type="button"
                  disabled={homeCountries.length >= 12}
                  onClick={() => setAdding(true)}
                  className="inline-flex h-9 items-center rounded-full border border-dashed border-input px-3 text-sm text-primary disabled:opacity-50"
                >
                  + Add
                </button>
              )}
            </div>
            {homeCountries.length === 0 ? (
              <p className="text-[13px] text-danger">Add at least one home country.</p>
            ) : null}
          </>
        ) : (
          <p className="text-[13px] text-muted-foreground">
            Every week counts the same — no travel pauses for this challenge.
          </p>
        )}
      </div>

      <div className="rounded-[18px] bg-card p-4">
        <p className="mb-1.5 text-[13px] text-muted-foreground">Your challenge</p>
        <SummaryLine label="With" value={atUser} />
        <SummaryLine label="Starts" value={startLabel} />
        <SummaryLine label="Length" value={`${length} weeks`} />
        <SummaryLine label="Every week" value={`${target} km`} />
        <SummaryLine label="Stakes" value={stakes} num />
        <SummaryLine
          label="Travel pause"
          value={travelPauseEnabled ? `Outside ${countryListLabel(homeCountries)}` : "Off"}
        />
      </div>

      <p className="text-center text-[13px] text-muted-foreground">
        These terms lock once {atUser} accepts.
      </p>
    </>
  );
}

function SummaryLine({ label, value, num }: { label: string; value: string; num?: boolean }) {
  return (
    <div className="flex min-h-8 items-center justify-between text-[15px]">
      <span className="text-muted-foreground">{label}</span>
      <span className={num ? "num" : ""}>{value}</span>
    </div>
  );
}
