import { useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import { format, parseISO } from "date-fns";
import { Card, PendingLabel } from "@/components/ui-kit";
import { TermsCards } from "@/components/challenge-terms-view";
import { useChallengeInvitations } from "@/lib/challenge-invitations";
import type { PendingChallengeInvitation } from "@/lib/privileged-rpcs.server";
import {
  acceptChallengeInvitationById,
  declineChallengeInvitation,
} from "@/lib/privileged-rpcs.functions";
import { countryListLabel } from "@/lib/countries";
import { type ChallengeTerms } from "@/lib/challenge";

/** Prominent received-invitation card on Today (Invite.html). Shown only when one is pending. */
export function ChallengeInviteReceiver() {
  const invitations = useChallengeInvitations();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [pending, setPending] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refresh = () =>
    Promise.all([
      qc.invalidateQueries({ queryKey: ["challenge-invitations", "mine"] }),
      qc.invalidateQueries({ queryKey: ["challenge"] }),
      qc.invalidateQueries({ queryKey: ["challenge-members"] }),
    ]);

  const accept = async (id: string) => {
    if (pending) return;
    setPending(id);
    setError(null);
    try {
      await acceptChallengeInvitationById({ data: { invitationId: id } });
      await refresh();
      await navigate({ to: "/challenge" });
    } catch {
      setError(
        "This invitation could not be accepted. It may have expired or the challenge is full.",
      );
      setPending(null);
    }
  };

  const decline = async (id: string) => {
    if (pending) return;
    setPending(id);
    setError(null);
    try {
      await declineChallengeInvitation({ data: { invitationId: id } });
      await refresh();
    } catch {
      setError("This invitation could not be declined. Try again.");
    } finally {
      setPending(null);
    }
  };

  if (!invitations.data?.length) return null;

  return (
    <div className="mb-4 space-y-4">
      {invitations.data.map((invitation) => (
        <InviteCard
          key={invitation.invitation_id}
          invitation={invitation}
          busy={pending === invitation.invitation_id}
          disabled={pending !== null}
          onAccept={() => void accept(invitation.invitation_id)}
          onDecline={() => void decline(invitation.invitation_id)}
          error={pending === invitation.invitation_id ? error : null}
        />
      ))}
    </div>
  );
}

function InviteCard({
  invitation,
  busy,
  disabled,
  onAccept,
  onDecline,
  error,
}: {
  invitation: PendingChallengeInvitation;
  busy: boolean;
  disabled: boolean;
  onAccept: () => void;
  onDecline: () => void;
  error: string | null;
}) {
  const [showTerms, setShowTerms] = useState(false);
  const money = invitation.penalty_mode === "money";
  const stakes = money
    ? `€${num(invitation.penalty_low_eur)} · €${num(invitation.penalty_medium_eur)} · €${num(invitation.penalty_high_eur)}`
    : "Something else";
  const travel = invitation.travel_pause_enabled
    ? `Outside ${countryListLabel(invitation.travel_pause_home_countries)}`
    : "Off";

  const terms: ChallengeTerms = {
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
    <section>
      <header className="mb-3">
        <p className="text-sm text-primary">New invitation</p>
        <h2 className="mt-1 text-2xl font-semibold tracking-tight">
          @{invitation.inviter_username} wants a challenge
        </h2>
      </header>

      <Card className="space-y-0 p-[18px]">
        <TermLine label="Length" value={`${invitation.duration_weeks} weeks`} />
        <TermLine label="Starts" value={format(parseISO(invitation.start_date), "EEEE d MMM")} />
        <TermLine label="Every week" value={`${num(invitation.weekly_target_km)} km`} />
        <TermLine label="What counts" value="Runs 1:1 · rides 3:1" />
        <TermLine label="Stakes" value={stakes} num />
        <TermLine label="Travel pause" value={travel} />
        <button
          type="button"
          onClick={() => setShowTerms((v) => !v)}
          className="mt-1.5 min-h-11 text-left text-sm font-medium text-primary"
        >
          {showTerms ? "Hide the full terms" : "Read the full terms"}
        </button>
      </Card>

      {showTerms ? (
        <div className="mt-3">
          <TermsCards terms={terms} timezone={invitation.timezone} />
        </div>
      ) : null}

      <p className="mt-3 text-center text-[13px] text-muted-foreground">
        The terms lock once you accept. Expires {format(parseISO(invitation.expires_at), "d MMM")}.
      </p>

      <button
        type="button"
        disabled={disabled}
        onClick={onAccept}
        className="mt-2 h-[54px] w-full rounded-[16px] bg-primary text-base font-semibold text-primary-foreground disabled:opacity-60"
      >
        {busy ? <PendingLabel>Accepting…</PendingLabel> : "Accept challenge"}
      </button>
      <button
        type="button"
        disabled={disabled}
        onClick={onDecline}
        className="mt-2 h-12 w-full rounded-[14px] bg-muted text-[15px] font-semibold disabled:opacity-60"
      >
        Decline
      </button>
      {error ? (
        <p role="alert" className="mt-2 text-[13px] text-danger">
          {error}
        </p>
      ) : null}
    </section>
  );
}

function TermLine({ label, value, num: isNum }: { label: string; value: string; num?: boolean }) {
  return (
    <div className="flex min-h-[34px] items-center justify-between text-[15px]">
      <span className="text-muted-foreground">{label}</span>
      <span className={isNum ? "num" : ""}>{value}</span>
    </div>
  );
}

function num(value: number) {
  return new Intl.NumberFormat("en", { maximumFractionDigits: 2 }).format(Number(value));
}
