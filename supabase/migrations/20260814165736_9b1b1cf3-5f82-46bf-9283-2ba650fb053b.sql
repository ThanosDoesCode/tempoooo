ALTER TABLE public.challenge_activities
ADD COLUMN IF NOT EXISTS extra_evidence_paths text[] NOT NULL DEFAULT '{}'::text[];