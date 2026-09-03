import { supabaseAdmin } from "@/integrations/supabase/client.server";

type RelatedProfile = { id: string; display_name: string | null; email: string | null };

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

export const finalizeChallengeFor = (caller: string, challenge: string) =>
  rpc<number>("finalize_challenge", { _caller: caller, _c: challenge });

export const relatedProfilesFor = (caller: string) =>
  rpc<RelatedProfile[]>("related_profiles", { _caller: caller });

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
  const membership = await supabaseAdmin
    .from("bulk_members")
    .select("id")
    .eq("user_id", caller)
    .eq("role", "owner")
    .limit(1);
  if (membership.error) throw new Error("diagnostics_authorization_failed");
  if (!membership.data.length) throw new Error("Forbidden");

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
