-- Lease finalized evidence cleanup jobs so immediate and scheduled workers can
-- overlap safely. Only service_role can claim or finish cleanup work.
ALTER TABLE public.challenge_evidence_cleanup
  DROP CONSTRAINT challenge_evidence_cleanup_status_check;

ALTER TABLE public.challenge_evidence_cleanup
  ADD CONSTRAINT challenge_evidence_cleanup_status_check
    CHECK (status IN ('pending', 'processing', 'failed', 'completed')),
  ADD COLUMN lease_token uuid,
  ADD COLUMN lease_until timestamptz;

CREATE OR REPLACE FUNCTION public.claim_challenge_evidence_cleanup(
  _challenge uuid DEFAULT NULL,
  _limit integer DEFAULT 50
)
RETURNS TABLE(
  activity_id uuid,
  challenge_id uuid,
  storage_paths text[],
  attempts integer,
  lease_token uuid
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  RETURN QUERY
  WITH due AS (
    SELECT queue.activity_id
    FROM public.challenge_evidence_cleanup queue
    JOIN public.challenge_activities activity ON activity.id = queue.activity_id
    WHERE (_challenge IS NULL OR queue.challenge_id = _challenge)
      AND (
        (queue.status IN ('pending', 'failed') AND queue.next_attempt_at <= now())
        OR (queue.status = 'processing' AND queue.lease_until < now())
      )
      AND EXISTS (
        SELECT 1
        FROM public.challenge_weeks week
        WHERE week.challenge_id = activity.challenge_id
          AND week.user_id = activity.user_id
          AND activity.activity_date BETWEEN week.week_start AND week.week_end
      )
    ORDER BY queue.next_attempt_at, queue.created_at
    FOR UPDATE OF queue SKIP LOCKED
    LIMIT greatest(1, least(coalesce(_limit, 50), 100))
  ), claimed AS (
    UPDATE public.challenge_evidence_cleanup queue
    SET status = 'processing',
        attempts = queue.attempts + 1,
        lease_token = gen_random_uuid(),
        lease_until = now() + interval '5 minutes',
        updated_at = now()
    FROM due
    WHERE queue.activity_id = due.activity_id
    RETURNING queue.activity_id, queue.challenge_id, queue.storage_paths,
      queue.attempts, queue.lease_token
  )
  SELECT claimed.activity_id, claimed.challenge_id, claimed.storage_paths,
    claimed.attempts, claimed.lease_token
  FROM claimed;
END;
$$;

REVOKE ALL ON FUNCTION public.claim_challenge_evidence_cleanup(uuid, integer)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_challenge_evidence_cleanup(uuid, integer)
  TO service_role;

CREATE OR REPLACE FUNCTION public.finish_challenge_evidence_cleanup(
  _activity uuid,
  _lease uuid,
  _succeeded boolean
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  changed integer;
BEGIN
  IF _succeeded THEN
    UPDATE public.challenge_evidence_cleanup
    SET status = 'completed',
        completed_at = now(),
        last_error = NULL,
        lease_token = NULL,
        lease_until = NULL,
        updated_at = now()
    WHERE activity_id = _activity
      AND status = 'processing'
      AND lease_token = _lease;
  ELSE
    UPDATE public.challenge_evidence_cleanup
    SET status = 'failed',
        last_error = 'storage_delete_failed',
        next_attempt_at = now() + make_interval(
          secs => least(
            86400,
            (60 * power(2, least(greatest(attempts - 1, 0), 10)))::integer
          )
        ),
        lease_token = NULL,
        lease_until = NULL,
        updated_at = now()
    WHERE activity_id = _activity
      AND status = 'processing'
      AND lease_token = _lease;
  END IF;
  GET DIAGNOSTICS changed = ROW_COUNT;
  RETURN changed = 1;
END;
$$;

REVOKE ALL ON FUNCTION public.finish_challenge_evidence_cleanup(uuid, uuid, boolean)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.finish_challenge_evidence_cleanup(uuid, uuid, boolean)
  TO service_role;
