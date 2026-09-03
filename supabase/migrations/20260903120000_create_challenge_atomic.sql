-- Challenge creation is one transaction and is idempotent for a single client request.
CREATE FUNCTION public.create_challenge_atomic(
  _request_id uuid,
  _name text,
  _start_date date,
  _timezone text,
  _duration_weeks integer,
  _invited_email text,
  _token_hash text
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  caller uuid := auth.uid();
  normalized_name text := btrim(coalesce(_name, ''));
  normalized_email text := lower(btrim(coalesce(_invited_email, '')));
  existing public.challenges%ROWTYPE;
BEGIN
  IF caller IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  IF _request_id IS NULL THEN RAISE EXCEPTION 'Invalid creation request'; END IF;
  IF length(normalized_name) NOT BETWEEN 1 AND 120 THEN
    RAISE EXCEPTION 'Challenge name must be between 1 and 120 characters';
  END IF;
  IF _start_date IS NULL OR extract(isodow FROM _start_date) <> 1 THEN
    RAISE EXCEPTION 'Challenge start date must be a Monday';
  END IF;
  IF _duration_weeks IS NULL OR _duration_weeks < 52 THEN
    RAISE EXCEPTION 'Challenge duration must be at least 52 weeks';
  END IF;
  IF length(coalesce(_timezone, '')) NOT BETWEEN 1 AND 100 OR NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_timezone_names WHERE name = _timezone
  ) THEN
    RAISE EXCEPTION 'Invalid challenge timezone';
  END IF;
  IF length(normalized_email) NOT BETWEEN 3 AND 254
    OR normalized_email LIKE '% %'
    OR length(normalized_email) - length(replace(normalized_email, '@', '')) <> 1
    OR position('@' IN normalized_email) <= 1
    OR position('.' IN split_part(normalized_email, '@', 2)) = 0
  THEN
    RAISE EXCEPTION 'Invalid opponent email';
  END IF;
  IF _token_hash IS NULL OR _token_hash !~ '^[0-9a-f]{64}$' THEN
    RAISE EXCEPTION 'Invalid invitation token';
  END IF;

  -- Serializes retries and concurrent double submissions for this request UUID.
  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(_request_id::text, 0)
  );

  SELECT * INTO existing FROM public.challenges WHERE id = _request_id FOR UPDATE;
  IF FOUND THEN
    IF existing.created_by <> caller
      OR existing.name <> normalized_name
      OR existing.start_date <> _start_date
      OR existing.timezone <> _timezone
      OR existing.duration_weeks <> _duration_weeks
      OR NOT EXISTS (
        SELECT 1 FROM public.challenge_members
        WHERE challenge_id = _request_id AND user_id = caller
      )
      OR NOT EXISTS (
        SELECT 1 FROM public.challenge_invitations
        WHERE challenge_id = _request_id
          AND created_by = caller
          AND invited_email = normalized_email
          AND token_hash = _token_hash
      )
    THEN
      RAISE EXCEPTION 'Creation request conflicts with existing state';
    END IF;
    RETURN _request_id;
  END IF;

  INSERT INTO public.challenges(id, created_by, name, start_date, timezone, duration_weeks)
  VALUES (_request_id, caller, normalized_name, _start_date, _timezone, _duration_weeks);

  INSERT INTO public.challenge_members(challenge_id, user_id)
  VALUES (_request_id, caller);

  INSERT INTO public.challenge_invitations(
    challenge_id, invited_email, token_hash, expires_at, created_by
  ) VALUES (
    _request_id, normalized_email, _token_hash, now() + interval '14 days', caller
  );

  RETURN _request_id;
END;
$$;

REVOKE ALL ON FUNCTION public.create_challenge_atomic(uuid, text, date, text, integer, text, text)
  FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.create_challenge_atomic(uuid, text, date, text, integer, text, text)
  TO authenticated;

-- New challenges and their first membership must go through the transaction above.
DROP POLICY IF EXISTS "challenges insert self" ON public.challenges;
DROP POLICY IF EXISTS "cm insert creator" ON public.challenge_members;
REVOKE INSERT ON public.challenges FROM authenticated;
REVOKE INSERT ON public.challenge_members FROM authenticated;
