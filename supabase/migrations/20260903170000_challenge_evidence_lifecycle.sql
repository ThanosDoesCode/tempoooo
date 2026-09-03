-- Retain private evidence through the active week, then queue it for idempotent
-- server-side deletion only after the immutable finalized-week row is committed.
DROP POLICY IF EXISTS "challenge evidence delete" ON storage.objects;

CREATE TABLE public.challenge_evidence_cleanup (
  activity_id uuid PRIMARY KEY REFERENCES public.challenge_activities(id) ON DELETE CASCADE,
  challenge_id uuid NOT NULL REFERENCES public.challenges(id) ON DELETE CASCADE,
  storage_paths text[] NOT NULL CHECK (cardinality(storage_paths) > 0),
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'failed', 'completed')),
  attempts integer NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  last_error text,
  next_attempt_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX challenge_evidence_cleanup_retry_idx
  ON public.challenge_evidence_cleanup(status, next_attempt_at)
  WHERE status IN ('pending', 'failed');

ALTER TABLE public.challenge_evidence_cleanup ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.challenge_evidence_cleanup FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.challenge_evidence_cleanup TO service_role;

CREATE OR REPLACE FUNCTION private.queue_finalized_challenge_evidence()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  INSERT INTO public.challenge_evidence_cleanup(activity_id, challenge_id, storage_paths)
  SELECT
    activity.id,
    activity.challenge_id,
    array_prepend(
      activity.evidence_path,
      coalesce(activity.extra_evidence_paths, '{}'::text[])
    )
  FROM public.challenge_activities activity
  WHERE activity.challenge_id = NEW.challenge_id
    AND activity.user_id = NEW.user_id
    AND activity.activity_date BETWEEN NEW.week_start AND NEW.week_end
  ON CONFLICT (activity_id) DO NOTHING;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION private.queue_finalized_challenge_evidence()
  FROM PUBLIC, anon, authenticated;

CREATE TRIGGER challenge_week_queue_evidence_cleanup
AFTER INSERT ON public.challenge_weeks
FOR EACH ROW EXECUTE FUNCTION private.queue_finalized_challenge_evidence();

-- Existing finalized weeks are safe to enqueue. Open/current weeks have no matching
-- challenge_weeks row and are deliberately excluded.
INSERT INTO public.challenge_evidence_cleanup(activity_id, challenge_id, storage_paths)
SELECT
  activity.id,
  activity.challenge_id,
  array_prepend(
    activity.evidence_path,
    coalesce(activity.extra_evidence_paths, '{}'::text[])
  )
FROM public.challenge_activities activity
WHERE EXISTS (
  SELECT 1
  FROM public.challenge_weeks week
  WHERE week.challenge_id = activity.challenge_id
    AND week.user_id = activity.user_id
    AND activity.activity_date BETWEEN week.week_start AND week.week_end
)
ON CONFLICT (activity_id) DO NOTHING;
