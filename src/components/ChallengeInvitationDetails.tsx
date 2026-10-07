import { format, parseISO } from "date-fns";
import { TermsCards } from "@/components/challenge-terms-view";
import type { PendingChallengeInvitation } from "@/lib/privileged-rpcs.server";

/** Read-only details from the same invitation snapshot used by acceptance. */
export function ChallengeInvitationDetails({
  invitation,
}: {
  invitation: PendingChallengeInvitation;
}) {
  const terms = {
    weekly_target_km: Number(invitation.weekly_target_km),
    penalty_mode: invitation.penalty_mode,
    penalty_high_eur: Number(invitation.penalty_high_eur),
    penalty_medium_eur: Number(invitation.penalty_medium_eur),
    penalty_low_eur: Number(invitation.penalty_low_eur),
    penalty_high_custom: invitation.penalty_high_custom,
    penalty_medium_custom: invitation.penalty_medium_custom,
    penalty_low_custom: invitation.penalty_low_custom,
    legacy_photo_owed: invitation.legacy_photo_owed,
    travel_pause_enabled: invitation.travel_pause_enabled,
    travel_pause_home_countries: invitation.travel_pause_home_countries,
  };
  return (
    <div className="space-y-3">
      <p className="text-sm text-muted-foreground">
        {invitation.duration_weeks} weeks · Starts{" "}
        {format(parseISO(invitation.start_date), "EEEE d MMM")}
        <br />
        Runs 1:1 · rides 3:1
      </p>
      <TermsCards terms={terms} timezone={invitation.timezone} />
      <p className="text-xs text-muted-foreground">
        The terms lock once you accept. Expires {format(parseISO(invitation.expires_at), "d MMM")}.
      </p>
    </div>
  );
}
