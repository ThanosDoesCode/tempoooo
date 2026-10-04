import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import type { Challenge, OutgoingInvitation } from "./challenge";

/** Presentation only: acceptance is recorded by membership/the invitation, never by week progress. */
export function challengeParticipation(
  challenge: Challenge | null | undefined,
  userId: string | undefined,
  members: Array<{ userId: string }> | undefined,
  invitation: OutgoingInvitation | null | undefined,
  now = Date.now(),
) {
  if (!challenge) return "none";
  if (
    challenge.created_by !== userId ||
    members?.some((member) => member.userId !== userId) ||
    invitation?.accepted_at
  )
    return "accepted";
  if (!invitation) return "uninvited";
  return Date.parse(invitation.expires_at) <= now ? "expired" : "pending";
}

/** Foreground-only refresh while waiting, including exact expiry and return from the share sheet.
 * No realtime publication is assumed and no auth/startup caches are touched.
 */
export function usePendingChallengeRefresh(
  challengeId: string | undefined,
  waiting: boolean,
  expiresAt?: string,
) {
  const qc = useQueryClient();
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!challengeId || !waiting) return;
    let stopped = false;
    let refreshing = false;
    const refresh = async () => {
      if (stopped || document.visibilityState === "hidden") return;
      setNow(Date.now());
      if (refreshing) return;
      refreshing = true;
      try {
        await Promise.all([
          qc.refetchQueries({ queryKey: ["challenge"], exact: true, type: "active" }),
          qc.refetchQueries({ queryKey: ["challenge-members", challengeId], type: "active" }),
          qc.refetchQueries({
            queryKey: ["challenge-outgoing-invitation", challengeId],
            type: "active",
          }),
        ]);
        const members = qc.getQueryData<Array<{ userId: string }>>([
          "challenge-members",
          challengeId,
        ]);
        if (!stopped && (members?.length ?? 0) >= 2)
          await qc.invalidateQueries({
            predicate: (query) =>
              query.queryKey[1] === challengeId &&
              ["challenge-activities", "challenge-weeks", "challenge-payments"].includes(
                String(query.queryKey[0]),
              ),
          });
      } finally {
        refreshing = false;
      }
    };
    const onReturn = () => void refresh();
    const interval = window.setInterval(onReturn, 15_000);
    const remaining = expiresAt ? Date.parse(expiresAt) - Date.now() : NaN;
    const expiry =
      remaining > 0 ? window.setTimeout(onReturn, Math.min(remaining, 2_147_483_647)) : undefined;
    window.addEventListener("focus", onReturn);
    document.addEventListener("visibilitychange", onReturn);
    return () => {
      stopped = true;
      window.clearInterval(interval);
      window.clearTimeout(expiry);
      window.removeEventListener("focus", onReturn);
      document.removeEventListener("visibilitychange", onReturn);
    };
  }, [challengeId, waiting, expiresAt, qc]);
  return now;
}
