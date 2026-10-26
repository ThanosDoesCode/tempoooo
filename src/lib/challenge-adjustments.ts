import { queryOptions, useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export type AdjustmentKind = "sick" | "late_completion";
export type AdjustmentStatus = "pending" | "approved" | "rejected" | "cancelled";

export type WeekAdjustment = {
  id: string;
  challenge_id: string;
  user_id: string;
  week_number: number;
  kind: AdjustmentKind;
  status: AdjustmentStatus;
  requested_by: string;
  reviewed_by: string | null;
  note: string | null;
  evidence_path: string | null;
  created_at: string;
  reviewed_at: string | null;
};

/** Structured result of review_challenge_week_exception (the backend's manual-resolution flags). */
export type ReviewResult = {
  status: "approved" | "rejected";
  kind: AdjustmentKind;
  week_corrected?: boolean;
  payment_action?: "none" | "cancelled" | "already_settled";
  payment_manual_resolution_required?: boolean;
  photo_manual_resolution_required?: boolean;
  streak_manual_resolution_required?: boolean;
};

// Scoped to one challenge (never a broad all-challenge read, even though RLS now protects it).
export const challengeAdjustmentsQueryOptions = (challengeId: string) =>
  queryOptions({
    queryKey: ["challenge-adjustments", challengeId],
    staleTime: 30_000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("challenge_week_adjustments")
        .select("*")
        .eq("challenge_id", challengeId)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return (data ?? []) as unknown as WeekAdjustment[];
    },
  });

export function useChallengeAdjustments(challengeId: string | undefined) {
  return useQuery({
    ...challengeAdjustmentsQueryOptions(challengeId ?? ""),
    enabled: !!challengeId,
  });
}

export async function requestChallengeException(
  challengeId: string,
  week: number,
  kind: AdjustmentKind,
  note: string | null,
  requestId: string,
): Promise<string> {
  const { data, error } = await supabase.rpc("request_challenge_week_exception", {
    _challenge: challengeId,
    _week: week,
    _kind: kind,
    _request_id: requestId,
    ...(note ? { _note: note } : {}),
  });
  if (error) throw error;
  return data as string;
}

export async function cancelChallengeException(adjustmentId: string): Promise<boolean> {
  const { data, error } = await supabase.rpc("cancel_challenge_week_exception", {
    _adjustment: adjustmentId,
  });
  if (error) throw error;
  return data as boolean;
}

export async function reviewChallengeException(
  adjustmentId: string,
  approve: boolean,
): Promise<ReviewResult> {
  const { data, error } = await supabase.rpc("review_challenge_week_exception", {
    _adjustment: adjustmentId,
    _approve: approve,
  });
  if (error) throw error;
  return data as ReviewResult;
}

/** A user-facing line for any manual-resolution the backend flagged; null when nothing needs attention. */
export function manualResolutionMessage(result: ReviewResult): string | null {
  if (result.payment_manual_resolution_required)
    return "Result corrected. The payment was already settled and was not changed.";
  if (result.photo_manual_resolution_required)
    return "Result corrected. The existing photo obligation may need manual review.";
  if (result.streak_manual_resolution_required)
    return "Result corrected. Streak history needs manual review.";
  return null;
}
