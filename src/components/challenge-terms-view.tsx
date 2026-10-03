import { Link } from "@tanstack/react-router";
import { Card } from "@/components/ui-kit";
import { challengeTerms, eur, owedText, penaltyBands, type ChallengeTerms } from "@/lib/challenge";
import { countryListLabel } from "@/lib/countries";

/**
 * The canonical read-only Terms cards (weekly target, what counts, penalties, travel). Shared by
 * the active-challenge Terms screen (manage=true adds the change-target / pause links) and the
 * read-only pending view shown to an invited user before they accept (manage=false).
 */
export function TermsCards({
  terms,
  timezone,
  manage = false,
}: {
  terms: Partial<ChallengeTerms> | null;
  timezone: string;
  manage?: boolean;
}) {
  const configured = challengeTerms(terms);
  const bands = penaltyBands(terms);
  const money = configured.penalty_mode === "money";

  const consequence = (band: "high" | "medium" | "low") => {
    if (money) {
      return owedText(
        {
          high: configured.penalty_high_eur,
          medium: configured.penalty_medium_eur,
          low: configured.penalty_low_eur,
        }[band],
        configured.legacy_photo_owed,
      );
    }
    return (
      {
        high: configured.penalty_high_custom,
        medium: configured.penalty_medium_custom,
        low: configured.penalty_low_custom,
      }[band] ?? "Custom consequence"
    );
  };

  return (
    <div className="space-y-3.5">
      <Card className="space-y-2.5 p-[18px]">
        <h2 className="text-[13px] font-medium text-muted-foreground">Every week</h2>
        <p className="num text-[28px] font-semibold leading-none">{formatKm(bands.target)} km</p>
        <p className="text-sm text-muted-foreground">
          Monday to Sunday, {timezone} time. Extra km don’t carry over.
        </p>
        {manage ? (
          <Link to="/challenge/terms/override" className="text-sm font-medium text-primary">
            Change one week’s target
          </Link>
        ) : null}
      </Card>

      <Card className="space-y-2.5 p-[18px]">
        <h2 className="text-[13px] font-medium text-muted-foreground">What counts</h2>
        <TermLine label="Run" value="1 km = 1 km, under 7:00 /km" />
        <TermLine label="Ride" value="3 km = 1 km, over 18 km/h" />
        <TermLine label="Proof" value="A screenshot for each one" />
      </Card>

      <Card className="space-y-2.5 p-[18px]">
        <h2 className="text-[13px] font-medium text-muted-foreground">If you fall short</h2>
        <TermLine
          label={`${formatKm(bands.target)} km or more`}
          value={money ? eur(0) : "No penalty"}
          strong
        />
        <TermLine
          label={`${formatKm(bands.mediumBelow)} to ${formatKm(bands.target)} km`}
          value={consequence("low")}
          strong
        />
        <TermLine
          label={`${formatKm(bands.highBelow)} to ${formatKm(bands.mediumBelow)} km`}
          value={consequence("medium")}
          strong
        />
        <TermLine
          label={`Under ${formatKm(bands.highBelow)} km`}
          value={consequence("high")}
          strong
          warn
        />
      </Card>

      <Card className="space-y-3 p-[18px]">
        <h2 className="text-[13px] font-medium text-muted-foreground">Travelling?</h2>
        {configured.travel_pause_enabled ? (
          <>
            <p className="text-[15px] leading-relaxed">
              Outside {countryListLabel(configured.travel_pause_home_countries, "disjunction")} you
              can pause a full week. No target, no penalty. Your opponent keeps going.
            </p>
            {manage ? (
              <Link
                to="/challenge/terms/pause"
                className="flex h-12 items-center justify-center rounded-[14px] bg-elevated text-[15px] font-semibold"
              >
                Pause a week
              </Link>
            ) : null}
          </>
        ) : (
          <p className="text-[15px] leading-relaxed text-muted-foreground">
            Travel pauses are not allowed under this challenge’s agreed terms.
          </p>
        )}
      </Card>
    </div>
  );
}

function TermLine({
  label,
  value,
  strong,
  warn,
}: {
  label: string;
  value: string;
  strong?: boolean;
  warn?: boolean;
}) {
  return (
    <div className="flex min-h-[30px] items-center justify-between gap-3 text-[15px]">
      <span>{label}</span>
      <span
        className={`${strong ? "num text-right font-semibold" : "text-right text-muted-foreground"} ${
          warn ? "text-warn" : ""
        }`}
      >
        {value}
      </span>
    </div>
  );
}

function formatKm(value: number) {
  return new Intl.NumberFormat("en", { maximumFractionDigits: 1 }).format(value);
}
