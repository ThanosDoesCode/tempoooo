import type { SupabaseClient } from "@supabase/supabase-js";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import {
  EVIDENCE_CLEANUP_BATCH_SIZE,
  runEvidenceCleanupBatch,
  type ClaimedEvidenceCleanup,
  type EvidenceCleanupStore,
} from "../../supabase/functions/_shared/evidence-cleanup";

const cleanupClient = supabaseAdmin as unknown as SupabaseClient;

export async function cleanupFinalizedChallengeEvidence(challengeId: string) {
  const store: EvidenceCleanupStore = {
    async claim(claimChallengeId, limit) {
      const result = await cleanupClient.rpc("claim_challenge_evidence_cleanup", {
        _challenge: claimChallengeId,
        _limit: limit,
      });
      if (result.error) throw new Error("cleanup_claim_failed");
      return (result.data ?? []) as ClaimedEvidenceCleanup[];
    },
    async remove(paths) {
      const result = await supabaseAdmin.storage.from("challenge-evidence").remove(paths);
      if (result.error) throw new Error("storage_delete_failed");
    },
    async finish(job, succeeded) {
      const result = await cleanupClient.rpc("finish_challenge_evidence_cleanup", {
        _activity: job.activity_id,
        _lease: job.lease_token,
        _succeeded: succeeded,
      });
      if (result.error || result.data !== true) throw new Error("cleanup_lease_lost");
    },
  };

  try {
    const result = await runEvidenceCleanupBatch(store, challengeId, EVIDENCE_CLEANUP_BATCH_SIZE);
    if (result.failed > 0) {
      console.error(
        JSON.stringify({
          level: "error",
          operation: "challenge_evidence_cleanup",
          phase: "delete_storage",
          code: "storage_delete_failed",
          failed: result.failed,
          processed: result.claimed,
        }),
      );
    }
    return result;
  } catch {
    console.error(
      JSON.stringify({
        level: "error",
        operation: "challenge_evidence_cleanup",
        phase: "claim_jobs",
        code: "cleanup_claim_failed",
      }),
    );
    return { claimed: 0, completed: 0, failed: 0 };
  }
}
