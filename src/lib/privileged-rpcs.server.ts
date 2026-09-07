import { supabaseAdmin } from "@/integrations/supabase/client.server";

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
  invitedEmail: string;
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
    _invited_email: input.invitedEmail,
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
