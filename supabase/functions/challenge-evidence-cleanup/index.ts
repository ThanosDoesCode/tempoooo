import { authorizedDispatcher } from "../_shared/challenge-push.ts";
import {
  EVIDENCE_CLEANUP_BATCH_SIZE,
  runEvidenceCleanupBatch,
  type ClaimedEvidenceCleanup,
  type EvidenceCleanupStore,
} from "../_shared/evidence-cleanup.ts";
import { operationalLog, safeOperationalCode } from "../_shared/observability.ts";
import { adminClient } from "../_shared/push-store.ts";

Deno.serve(async (request: Request) => {
  const requestId = crypto.randomUUID();
  if (request.method !== "POST") return new Response(null, { status: 405 });
  if (
    !(await authorizedDispatcher(request, Deno.env.get("CHALLENGE_PUSH_DISPATCH_SECRET") ?? ""))
  ) {
    return new Response(null, { status: 401 });
  }

  try {
    const db = adminClient();
    const store: EvidenceCleanupStore = {
      async claim(challengeId, limit) {
        const result = await db.rpc("claim_challenge_evidence_cleanup", {
          _challenge: challengeId,
          _limit: limit,
        });
        if (result.error) throw new Error("cleanup_claim_failed");
        return (result.data ?? []) as ClaimedEvidenceCleanup[];
      },
      async remove(paths) {
        const result = await db.storage.from("challenge-evidence").remove(paths);
        if (result.error) throw new Error("storage_delete_failed");
      },
      async finish(job, succeeded) {
        const result = await db.rpc("finish_challenge_evidence_cleanup", {
          _activity: job.activity_id,
          _lease: job.lease_token,
          _succeeded: succeeded,
        });
        if (result.error || result.data !== true) throw new Error("cleanup_lease_lost");
      },
    };
    const result = await runEvidenceCleanupBatch(store, null, EVIDENCE_CLEANUP_BATCH_SIZE);
    operationalLog("info", "challenge_evidence_cleanup_worker", {
      requestId,
      processed: result.claimed,
      outcome: result.failed > 0 ? "partial" : "complete",
    });
    return Response.json(result);
  } catch (error) {
    operationalLog("error", "challenge_evidence_cleanup_worker", {
      requestId,
      phase: "claim_or_cleanup",
      code: safeOperationalCode(error, "cleanup_worker_failed"),
    });
    return Response.json({ error: "Evidence cleanup unavailable" }, { status: 503 });
  }
});
