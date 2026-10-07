import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { QUERY_PAGE_SIZE, readAllByKey } from "./query-pagination";

import type { AccountNotification, InvitationEventType } from "./account-notification-model";

type RelatedProfile = { id: string; display_name: string | null };

async function rpc<T>(name: string, params: Record<string, unknown>): Promise<T> {
  const client = supabaseAdmin as unknown as {
    rpc: (
      fn: string,
      args: Record<string, unknown>,
    ) => Promise<{ data: unknown; error: { message: string } | null }>;
  };
  const { data, error } = await client.rpc(name, params);
  if (error) throw new Error(error.message);
  return data as T;
}

export const acceptChallengeInvitationFor = (caller: string, email: string, token: string) =>
  rpc<string>("accept_challenge_invitation", { _caller: caller, _email: email, _token: token });

export type ChallengeInvitationTerms = {
  challenge_id: string;
  challenge_name: string;
  duration_weeks: number;
  weekly_target_km: number;
  penalty_mode: "money" | "custom";
  penalty_high_eur: number;
  penalty_medium_eur: number;
  penalty_low_eur: number;
  penalty_high_custom: string | null;
  penalty_medium_custom: string | null;
  penalty_low_custom: string | null;
  legacy_photo_owed: boolean;
  travel_pause_enabled: boolean;
  travel_pause_home_countries: string[];
};

export async function previewChallengeInvitationFor(caller: string, email: string, token: string) {
  const rows = await rpc<ChallengeInvitationTerms[]>("preview_challenge_invitation", {
    _caller: caller,
    _email: email,
    _token: token,
  });
  if (!rows[0]) throw new Error("Invalid invitation");
  return rows[0];
}

export async function finalizeChallengeFor(caller: string, challenge: string) {
  const finalized = await rpc<number>("finalize_challenge", { _caller: caller, _c: challenge });
  const { cleanupFinalizedChallengeEvidence } = await import("./challenge-evidence.server");
  await cleanupFinalizedChallengeEvidence(challenge);
  return finalized;
}

export async function relatedProfilesFor(caller: string): Promise<RelatedProfile[]> {
  const profiles = await rpc<Array<RelatedProfile & { email?: string | null }>>(
    "related_profiles",
    {
      _caller: caller,
    },
  );
  return profiles.map(({ id, display_name }) => ({ id, display_name }));
}

const DIAGNOSTIC_FIELDS =
  "id,kind,status,attempts,last_error,created_at,next_attempt_at,lease_until,finished_at" as const;

export type AdminDiagnosticEvent = {
  id: string;
  kind: string;
  status: string;
  attempts: number;
  last_error: string | null;
  created_at: string;
  next_attempt_at: string;
  lease_until: string | null;
  finished_at: string | null;
};

export async function adminDiagnosticsFor(caller: string) {
  const adminRecord = await supabaseAdmin
    .from("bulk_admins")
    .select("user_id")
    .eq("user_id", caller)
    .limit(1);
  if (adminRecord.error) throw new Error("diagnostics_authorization_failed");
  if (!adminRecord.data.length) throw new Error("Forbidden");

  const now = Date.now();
  const dayAgo = new Date(now - 24 * 60 * 60 * 1_000).toISOString();
  const weekAgo = new Date(now - 7 * 24 * 60 * 60 * 1_000).toISOString();
  const statuses = ["pending", "processing", "sent", "skipped", "failed"] as const;
  const countQueries = statuses.map((status) =>
    supabaseAdmin
      .from("challenge_notification_events")
      .select("id", { count: "exact", head: true })
      .eq("status", status)
      .gte("created_at", dayAgo),
  );
  const [countsResult, failed, active] = await Promise.all([
    Promise.all(countQueries),
    supabaseAdmin
      .from("challenge_notification_events")
      .select(DIAGNOSTIC_FIELDS)
      .eq("status", "failed")
      .gte("created_at", weekAgo)
      .order("created_at", { ascending: false })
      .limit(12),
    supabaseAdmin
      .from("challenge_notification_events")
      .select(DIAGNOSTIC_FIELDS)
      .in("status", ["pending", "processing"])
      .order("created_at", { ascending: true })
      .limit(30),
  ]);
  if (countsResult.some((result) => result.error) || failed.error || active.error)
    throw new Error("diagnostics_query_failed");

  const counts = Object.fromEntries(
    statuses.map((status, index) => [status, countsResult[index]!.count ?? 0]),
  ) as Record<(typeof statuses)[number], number>;
  const activeEvents = (active.data ?? []) as AdminDiagnosticEvent[];
  const retrying = activeEvents.filter((event) => event.status === "pending" && event.attempts > 0);
  const stuck = activeEvents.filter(
    (event) =>
      event.status === "processing" &&
      (event.lease_until === null || Date.parse(event.lease_until) < now),
  );

  return {
    generatedAt: new Date(now).toISOString(),
    windowHours: 24,
    counts,
    failed: (failed.data ?? []) as AdminDiagnosticEvent[],
    retrying,
    stuck,
    backendErrorsAvailable: false,
  };
}

export type CreateChallengeInput = {
  requestId: string;
  name: string;
  startDate: string;
  timezone: string;
  durationWeeks: number;
  invitedUsername: string;
  tokenHash: string;
  weeklyTargetKm: number;
  penaltyMode: "money" | "custom";
  penaltyHighEur: number;
  penaltyMediumEur: number;
  penaltyLowEur: number;
  penaltyHighCustom: string | null;
  penaltyMediumCustom: string | null;
  penaltyLowCustom: string | null;
  travelPauseEnabled: boolean;
  travelPauseHomeCountries: string[];
};

export const createChallengeFor = (caller: string, input: CreateChallengeInput) =>
  rpc<string>("create_challenge_atomic", {
    _caller: caller,
    _request_id: input.requestId,
    _name: input.name,
    _start_date: input.startDate,
    _timezone: input.timezone,
    _duration_weeks: input.durationWeeks,
    _invited_username: input.invitedUsername,
    _token_hash: input.tokenHash,
    _weekly_target_km: input.weeklyTargetKm,
    _penalty_mode: input.penaltyMode,
    _penalty_high_eur: input.penaltyHighEur,
    _penalty_medium_eur: input.penaltyMediumEur,
    _penalty_low_eur: input.penaltyLowEur,
    _penalty_high_custom: input.penaltyHighCustom,
    _penalty_medium_custom: input.penaltyMediumCustom,
    _penalty_low_custom: input.penaltyLowCustom,
    _travel_pause_enabled: input.travelPauseEnabled,
    _travel_pause_home_countries: input.travelPauseHomeCountries,
  });

export async function usernameAvailableFor(caller: string, username: string) {
  return rpc<boolean>("username_available", { _caller: caller, _username: username });
}

export async function setAccountUsernameFor(
  caller: string,
  username: string,
  completeOnboarding: boolean,
) {
  return rpc<string>("set_account_username", {
    _caller: caller,
    _username: username,
    _complete_onboarding: completeOnboarding,
  });
}

export async function createChallengeInvitationFor(
  caller: string,
  input: { challengeId: string; username: string; tokenHash: string },
) {
  return rpc<string>("create_challenge_invitation", {
    _caller: caller,
    _challenge: input.challengeId,
    _invited_username: input.username,
    _token_hash: input.tokenHash,
  });
}

export type ChallengeInviteCandidate = { username: string };

export const searchChallengeInviteUsersFor = (caller: string, challengeId: string, query: string) =>
  rpc<ChallengeInviteCandidate[]>("search_challenge_invite_users", {
    _caller: caller,
    _challenge: challengeId,
    _query: query,
  });

export const sendChallengeUsernameInvitationFor = (
  caller: string,
  challengeId: string,
  username: string,
) =>
  rpc<string>("send_challenge_username_invitation", {
    _caller: caller,
    _challenge: challengeId,
    _invited_username: username,
  });

export type PendingChallengeInvitation = {
  invitation_id: string;
  challenge_id: string;
  challenge_name: string;
  inviter_username: string;
  weekly_target_km: number;
  expires_at: string;
  duration_weeks: number;
  start_date: string;
  timezone: string;
  penalty_mode: "money" | "custom";
  penalty_high_eur: number;
  penalty_medium_eur: number;
  penalty_low_eur: number;
  penalty_high_custom: string | null;
  penalty_medium_custom: string | null;
  penalty_low_custom: string | null;
  legacy_photo_owed: boolean;
  travel_pause_enabled: boolean;
  travel_pause_home_countries: string[];
};

export const listMyChallengeInvitationsFor = (caller: string) =>
  rpc<PendingChallengeInvitation[]>("list_my_challenge_invitations", { _caller: caller });

export const acceptChallengeInvitationByIdFor = (caller: string, invitationId: string) =>
  rpc<string>("accept_challenge_invitation_by_id", {
    _caller: caller,
    _invitation: invitationId,
  });

export const declineChallengeInvitationFor = (caller: string, invitationId: string) =>
  rpc<boolean>("decline_challenge_invitation", {
    _caller: caller,
    _invitation: invitationId,
  });

export const cancelPendingChallengeFor = (caller: string, challengeId: string) =>
  rpc<boolean>("cancel_pending_challenge", {
    _caller: caller,
    _challenge: challengeId,
  });

export async function deleteTempoAccountFor(caller: string) {
  const profile = await supabaseAdmin
    .from("bulk_profiles")
    .select("id")
    .eq("owner_id", caller)
    .maybeSingle();
  if (profile.error) throw new Error("account_deletion_failed");
  if (profile.data?.id) {
    const profileId = profile.data.id;
    let paths: string[];
    try {
      // Drain both sources before removing anything. Short PostgREST pages are not
      // proof of completion; readAllByKey requires an empty page and a moving cursor.
      const [legacyPhotos, progressPhotos] = await Promise.all([
        readAllByKey(
          (cursor) => {
            let query = supabaseAdmin
              .from("bulk_photos")
              .select("id,front_path,side_path,back_path")
              .eq("bulk_profile_id", profileId)
              .order("id", { ascending: true })
              .limit(QUERY_PAGE_SIZE);
            if (cursor) query = query.gt("id", cursor);
            return query;
          },
          (photo) => photo.id,
        ),
        readAllByKey(
          (cursor) => {
            let query = supabaseAdmin
              .from("bulk_progress_photos")
              .select("id,storage_path")
              .eq("bulk_profile_id", profileId)
              .order("id", { ascending: true })
              .limit(QUERY_PAGE_SIZE);
            if (cursor) query = query.gt("id", cursor);
            return query;
          },
          (photo) => photo.id,
        ),
      ]);
      paths = [
        ...new Set(
          [
            ...legacyPhotos.flatMap((photo) => [
              photo.front_path,
              photo.side_path,
              photo.back_path,
            ]),
            ...progressPhotos.map((photo) => photo.storage_path),
          ].filter((path): path is string => Boolean(path)),
        ),
      ].sort();
      // The admin client bypasses Storage RLS. Never follow a corrupt legacy
      // reference into a different profile's folder, even from an owned row.
      if (
        paths.some(
          (path) =>
            !path.startsWith(`${profileId}/`) ||
            path.includes("\\") ||
            path.split("/").some((segment) => !segment || segment === "." || segment === ".."),
        )
      )
        throw new Error("Invalid owned photo path");
    } catch {
      throw new Error(
        "account_deletion_photo_discovery_failed: Could not load all owned private photos. Your account has not been deleted. Please retry.",
      );
    }
    try {
      const bucket = supabaseAdmin.storage.from("bulk-progress-photos");
      const batchSize = 100;
      for (let start = 0; start < paths.length; start += batchSize) {
        const removed = await bucket.remove(paths.slice(start, start + batchSize));
        if (removed.error) throw removed.error;
      }
    } catch {
      // Keep all DB references and the auth user. Already removed objects stay
      // removed; Storage remove tolerates missing paths when the user retries.
      throw new Error(
        "account_deletion_photo_cleanup_failed: Could not finish private photo cleanup. Your account has not been deleted. Some photos may already have been removed. Please retry.",
      );
    }
  }
  const { error } = await supabaseAdmin.auth.admin.deleteUser(caller);
  if (error) throw new Error("account_deletion_failed");
}

export const disableChallengePushFor = (caller: string) =>
  rpc<null>("disable_challenge_push", { _caller: caller });

export const setChallengeWeekTargetFor = (
  caller: string,
  input: { challenge: string; weekNumber: number; targetKm: number | null },
) =>
  rpc<number>("set_challenge_week_target", {
    _caller: caller,
    _challenge: input.challenge,
    _week: input.weekNumber,
    _target: input.targetKm,
  });

/** Authenticated server context supplies caller; the browser cannot select another inbox. */
export async function listAccountNotificationsFor(caller: string): Promise<AccountNotification[]> {
  const rows = await readAllByKey(
    (cursor) => {
      let query = supabaseAdmin
        .from("account_notification_events")
        .select(
          "id,recipient_user_id,actor_user_id,actor_username,event_type,challenge_id,invitation_id,created_at,read_at,challenge_invitations(expires_at,accepted_at,revoked_at)",
        )
        .eq("recipient_user_id", caller)
        .order("id", { ascending: true })
        .limit(QUERY_PAGE_SIZE);
      if (cursor) query = query.gt("id", cursor);
      return query;
    },
    (row) => row.id,
  );
  return rows
    .map(({ challenge_invitations: invitation, ...event }) => ({
      ...event,
      event_type: event.event_type as InvitationEventType,
      invitation_expires_at: invitation?.expires_at ?? "",
      invitation_pending: !!invitation && !invitation.accepted_at && !invitation.revoked_at,
    }))
    .sort((a, b) => b.created_at.localeCompare(a.created_at) || b.id.localeCompare(a.id));
}
