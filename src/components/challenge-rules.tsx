import { Card, Note, SectionTitle } from "@/components/ui-kit";
import { challengeTerms, eur, penaltyBands, type ChallengeTerms } from "@/lib/challenge";
import { countryListLabel } from "@/lib/countries";

export function ChallengePrimer({ terms }: { terms?: Partial<ChallengeTerms> | null }) {
  const configured = challengeTerms(terms);
  return (
    <Card>
      <SectionTitle>How Tempo works</SectionTitle>
      <ol className="space-y-2 text-sm">
        <PrimerStep
          number="1"
          title={`Reach ${formatKm(configured.weekly_target_km)} challenge km each week`}
        >
          Equivalent km are your converted progress: runs count 1:1 below 7:00 min/km, and rides
          count 3:1 from 18 km/h.
        </PrimerStep>
        <PrimerStep number="2" title="Add duration and evidence">
          Every activity needs its duration and a screenshot that verifies distance and pace or
          speed.
        </PrimerStep>
        <PrimerStep number="3" title="Sunday locks the result">
          Finishing below the target applies the agreed consequence. Extra km do not carry over.
        </PrimerStep>
        <PrimerStep number="4" title="Travelling can pause your week">
          {terms
            ? configured.travel_pause_enabled
              ? `Outside ${countryListLabel(configured.travel_pause_home_countries, "disjunction")}, you can pause your own full week so it is penalty-free.`
              : "Travel pauses are disabled for this Challenge."
            : "The creator decides whether travel pauses are allowed and which countries keep the Challenge active."}
        </PrimerStep>
      </ol>
      <details className="group mt-3 border-t border-border pt-1">
        <summary className="flex min-h-11 cursor-pointer list-none items-center text-xs font-semibold text-primary [&::-webkit-details-marker]:hidden">
          View all challenge rules
          <span className="ml-auto text-muted-foreground group-open:hidden">+</span>
          <span className="ml-auto hidden text-muted-foreground group-open:inline">−</span>
        </summary>
        <div className="space-y-4 pb-1 pt-2">
          <RulesContent terms={configured} />
        </div>
      </details>
    </Card>
  );
}

export function RulesCard({ terms }: { terms?: Partial<ChallengeTerms> | null }) {
  return (
    <Card className="space-y-4">
      <SectionTitle>Challenge rules</SectionTitle>
      <RulesContent terms={terms ?? null} />
    </Card>
  );
}

export function ChallengeTermsSummary({ terms }: { terms?: Partial<ChallengeTerms> | null }) {
  const bands = penaltyBands(terms);
  const configured = challengeTerms(terms);
  const value = (band: "high" | "medium" | "low") => {
    if (configured.penalty_mode === "custom") {
      return (
        {
          high: configured.penalty_high_custom,
          medium: configured.penalty_medium_custom,
          low: configured.penalty_low_custom,
        }[band] ?? "—"
      );
    }
    const amount = {
      high: configured.penalty_high_eur,
      medium: configured.penalty_medium_eur,
      low: configured.penalty_low_eur,
    }[band];
    if (!configured.legacy_photo_owed) return eur(amount);
    const photos = Math.floor(Math.max(0, amount) / 5);
    return photos ? `${eur(amount)} + ${photos} photo${photos === 1 ? "" : "s"}` : eur(amount);
  };
  return (
    <div className="grid gap-2 text-xs sm:grid-cols-2">
      <Tier
        label={`${formatKm(bands.target)} km or more`}
        value={configured.penalty_mode === "money" ? "€0" : "No penalty"}
      />
      <Tier
        label={`≥ ⅔ target (${formatKm(bands.mediumBelow, 4)} km) and <${formatKm(bands.target)} km`}
        value={value("low")}
      />
      <Tier
        label={`≥ ⅓ target (${formatKm(bands.highBelow, 4)} km) and <⅔ (${formatKm(bands.mediumBelow, 4)} km)`}
        value={value("medium")}
      />
      <Tier label={`Below ⅓ target (${formatKm(bands.highBelow, 4)} km)`} value={value("high")} />
    </div>
  );
}

function RulesContent({ terms }: { terms?: Partial<ChallengeTerms> | null }) {
  const configured = challengeTerms(terms);
  const homeCountries = countryListLabel(configured.travel_pause_home_countries);
  return (
    <>
      <RuleGroup title="Weekly target">
        <li>Weekly target is {formatKm(configured.weekly_target_km)} challenge km.</li>
        <li>Extra distance above the target does not carry over.</li>
      </RuleGroup>

      <div className="grid gap-4 sm:grid-cols-2">
        <RuleGroup title="Running">
          <li>Running counts 1:1.</li>
          <li>1 km running = 1 challenge km.</li>
          <li>Average pace must be under 7:00 min/km.</li>
        </RuleGroup>
        <RuleGroup title="Cycling">
          <li>Cycling counts at 3:1.</li>
          <li>3 km cycling = 1 challenge km.</li>
          <li>Average speed must be at least 18 km/h.</li>
        </RuleGroup>
      </div>

      <RuleGroup title="Travel">
        {configured.travel_pause_enabled ? (
          <>
            <li>The challenge stays active in {homeCountries}.</li>
            <li>
              Outside {countryListLabel(configured.travel_pause_home_countries, "disjunction")},
              each participant can continue normally or pause their own full challenge week.
            </li>
            <li>A paused week has a 0 km target and no penalty for that participant only.</li>
          </>
        ) : (
          <li>Travel pauses are not allowed for this Challenge.</li>
        )}
      </RuleGroup>

      <RuleGroup title="Evidence">
        <li>Every activity needs a screenshot; a Strava link can be added as extra evidence.</li>
        <li>The evidence must verify distance and the relevant pace or cycling speed.</li>
      </RuleGroup>

      <RuleGroup title={`${configured.penalty_mode === "money" ? "Money" : "Custom"} penalties`}>
        <li>Penalty bands are one-third and two-thirds of the weekly target.</li>
        <li>The exact consequences were agreed when this challenge was created.</li>
        {configured.legacy_photo_owed ? (
          <li>This legacy Challenge also owes one photo for every €5.</li>
        ) : null}
      </RuleGroup>

      <ChallengeTermsSummary terms={configured} />
      <Note>
        Weeks run Monday 00:00 to Sunday 23:59 in the challenge timezone. Finalized results stay
        locked.
      </Note>
    </>
  );
}

function formatKm(value: number, maximumFractionDigits = 2) {
  return new Intl.NumberFormat("en", { maximumFractionDigits }).format(value);
}

function PrimerStep({
  number,
  title,
  children,
}: {
  number: string;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <li className="flex gap-3">
      <span className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-primary/15 text-xs font-bold text-primary">
        {number}
      </span>
      <span className="min-w-0">
        <span className="block font-semibold">{title}</span>
        <span className="mt-0.5 block text-xs leading-relaxed text-muted-foreground">
          {children}
        </span>
      </span>
    </li>
  );
}

function RuleGroup({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section>
      <h3 className="text-xs font-semibold uppercase tracking-wider text-foreground">{title}</h3>
      <ul className="mt-1.5 list-disc space-y-1 pl-4 text-sm text-muted-foreground">{children}</ul>
    </section>
  );
}

function Tier({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between rounded-xl border border-border bg-elevated px-3 py-2">
      <span className="text-muted-foreground">{label}</span>
      <span className="max-w-[55%] text-right font-semibold">{value}</span>
    </div>
  );
}
