export const EVIDENCE_CLEANUP_BATCH_SIZE = 50;

export type ClaimedEvidenceCleanup = {
  activity_id: string;
  challenge_id: string;
  storage_paths: string[];
  attempts: number;
  lease_token: string;
};

export type EvidenceCleanupStore = {
  claim(challengeId: string | null, limit: number): Promise<ClaimedEvidenceCleanup[]>;
  remove(paths: string[]): Promise<void>;
  finish(job: ClaimedEvidenceCleanup, succeeded: boolean): Promise<void>;
};

function safePaths(job: ClaimedEvidenceCleanup) {
  const prefix = `${job.challenge_id}/`;
  return [...new Set(job.storage_paths)].filter(
    (path) => path.startsWith(prefix) && !path.includes("..") && path.length <= 1024,
  );
}

export async function runEvidenceCleanupBatch(
  store: EvidenceCleanupStore,
  challengeId: string | null = null,
  limit = EVIDENCE_CLEANUP_BATCH_SIZE,
) {
  const jobs = await store.claim(challengeId, Math.max(1, Math.min(limit, 100)));
  let completed = 0;
  let failed = 0;

  for (const job of jobs) {
    try {
      const paths = safePaths(job);
      if (paths.length === 0) throw new Error("invalid_cleanup_paths");
      await store.remove(paths);
      await store.finish(job, true);
      completed += 1;
    } catch {
      failed += 1;
      try {
        await store.finish(job, false);
      } catch {
        // The lease expires so another scheduled run can reclaim this job.
      }
    }
  }

  return { claimed: jobs.length, completed, failed };
}
