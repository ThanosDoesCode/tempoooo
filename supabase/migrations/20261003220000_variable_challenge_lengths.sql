-- Phase 3: allow 4, 12 or 52 week challenges (previously 52+ only), let a creator cancel a
-- still-pending challenge, and expose full agreed terms to an invited user before they accept.
--
-- Why this migration is required:
--  * challenge_duration_ck and create_challenge_atomic both hard-enforced >= 52 weeks.
--  * There was no way for a creator to cancel a pending (unaccepted) challenge, so abandoning
--    setup left an orphaned challenge + invitation.
--  * list_my_challenge_invitations returned only name/target/expiry, too little to render the
--    invitation card and read-only pending Terms the invited user needs before accepting.
-- Nothing here changes qualification thresholds, km conversion, penalty bands, pause semantics
-- or payment confirmation — only the allowed lengths, a new cancel path, and richer invite reads.

-- 1. Pin the table constraint to exactly the supported product lengths. Existing challenges were
--    all created at 52 weeks (the old UI defaulted to and required 52), so this validates cleanly.
--    create_challenge_atomic enforces the same set below — defense in depth is intentional.
ALTER TABLE public.challenges DROP CONSTRAINT IF EXISTS challenge_duration_ck;
ALTER TABLE public.challenges
  ADD CONSTRAINT challenge_duration_ck CHECK (duration_weeks IN (4, 12, 52));

-- 2. Re-create create_challenge_atomic with the only change being the duration check:
--    was "< 52", now "NOT IN (4, 12, 52)".
CREATE OR REPLACE FUNCTION public.create_challenge_atomic(
  _caller uuid,
  _request_id uuid,
  _name text,
  _start_date date,
  _timezone text,
  _duration_weeks integer,
  _invited_username text,
  _token_hash text,
  _weekly_target_km numeric,
  _penalty_mode text,
  _penalty_high_eur numeric,
  _penalty_medium_eur numeric,
  _penalty_low_eur numeric,
  _penalty_high_custom text,
  _penalty_medium_custom text,
  _penalty_low_custom text,
  _travel_pause_enabled boolean,
  _travel_pause_home_countries text[]
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  caller uuid := _caller;
  normalized_name text := btrim(coalesce(_name, ''));
  normalized_username text := lower(btrim(coalesce(_invited_username, '')));
  normalized_high_custom text := nullif(btrim(coalesce(_penalty_high_custom, '')), '');
  normalized_medium_custom text := nullif(btrim(coalesce(_penalty_medium_custom, '')), '');
  normalized_low_custom text := nullif(btrim(coalesce(_penalty_low_custom, '')), '');
  normalized_home_countries text[] := ARRAY(
    SELECT DISTINCT upper(btrim(country))
    FROM unnest(coalesce(_travel_pause_home_countries, ARRAY[]::text[])) country
    ORDER BY 1
  );
  existing public.challenges%ROWTYPE;
  invited_user uuid;
BEGIN
  IF caller IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  IF _request_id IS NULL THEN RAISE EXCEPTION 'Invalid creation request'; END IF;
  IF length(normalized_name) NOT BETWEEN 1 AND 120 THEN
    RAISE EXCEPTION 'Challenge name must be between 1 and 120 characters';
  END IF;
  IF _start_date IS NULL OR extract(isodow FROM _start_date) <> 1 THEN
    RAISE EXCEPTION 'Challenge start date must be a Monday';
  END IF;
  IF _duration_weeks IS NULL OR _duration_weeks NOT IN (4, 12, 52) THEN
    RAISE EXCEPTION 'Challenge duration must be 4, 12 or 52 weeks';
  END IF;
  IF length(coalesce(_timezone, '')) NOT BETWEEN 1 AND 100 OR NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_timezone_names WHERE name = _timezone
  ) THEN
    RAISE EXCEPTION 'Invalid challenge timezone';
  END IF;
  IF normalized_username !~ '^[a-z0-9_]{3,20}$'
    OR normalized_username IN ('admin', 'administrator', 'tempo', 'support', 'system')
  THEN
    RAISE EXCEPTION 'Invalid username';
  END IF;
  SELECT id INTO invited_user
  FROM public.profiles
  WHERE username = normalized_username;
  IF invited_user IS NULL THEN RAISE EXCEPTION 'Username not found'; END IF;
  IF invited_user = caller THEN RAISE EXCEPTION 'You cannot invite yourself'; END IF;
  IF _token_hash IS NULL OR _token_hash !~ '^[0-9a-f]{64}$' THEN
    RAISE EXCEPTION 'Invalid invitation token';
  END IF;
  IF _weekly_target_km IS NULL OR _weekly_target_km NOT BETWEEN 1 AND 500
    OR round(_weekly_target_km, 2) <> _weekly_target_km
  THEN
    RAISE EXCEPTION 'Weekly target must be between 1 and 500 km with at most 2 decimals';
  END IF;
  IF _penalty_mode IS NULL OR _penalty_mode NOT IN ('money', 'custom') THEN
    RAISE EXCEPTION 'Penalty mode must be money or custom';
  END IF;
  IF _penalty_high_eur IS NULL OR _penalty_medium_eur IS NULL OR _penalty_low_eur IS NULL
    OR _penalty_high_eur NOT BETWEEN 0 AND 1000
    OR _penalty_medium_eur NOT BETWEEN 0 AND 1000
    OR _penalty_low_eur NOT BETWEEN 0 AND 1000
    OR round(_penalty_high_eur, 2) <> _penalty_high_eur
    OR round(_penalty_medium_eur, 2) <> _penalty_medium_eur
    OR round(_penalty_low_eur, 2) <> _penalty_low_eur
    OR _penalty_high_eur < _penalty_medium_eur
    OR _penalty_medium_eur < _penalty_low_eur
  THEN
    RAISE EXCEPTION 'Penalty amounts must be ordered high to low and between 0 and 1000 euro';
  END IF;
  IF _penalty_mode = 'money' AND (
    normalized_high_custom IS NOT NULL
    OR normalized_medium_custom IS NOT NULL
    OR normalized_low_custom IS NOT NULL
  ) THEN
    RAISE EXCEPTION 'Money penalties cannot include custom consequences';
  END IF;
  IF _penalty_mode = 'custom' AND (
    length(coalesce(normalized_high_custom, '')) NOT BETWEEN 1 AND 160
    OR length(coalesce(normalized_medium_custom, '')) NOT BETWEEN 1 AND 160
    OR length(coalesce(normalized_low_custom, '')) NOT BETWEEN 1 AND 160
  ) THEN
    RAISE EXCEPTION 'Custom consequences must be between 1 and 160 characters';
  END IF;
  IF _travel_pause_enabled IS NULL THEN
    RAISE EXCEPTION 'Travel pause configuration is required';
  END IF;
  IF NOT _travel_pause_enabled AND cardinality(normalized_home_countries) <> 0 THEN
    RAISE EXCEPTION 'Disabled travel pauses cannot include home countries';
  END IF;
  IF _travel_pause_enabled
    AND NOT private.valid_travel_pause_countries(normalized_home_countries)
  THEN
    RAISE EXCEPTION 'Travel pauses require 1 to 12 valid home countries';
  END IF;

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
      OR existing.weekly_target_km <> _weekly_target_km
      OR existing.penalty_high_eur <> _penalty_high_eur
      OR existing.penalty_medium_eur <> _penalty_medium_eur
      OR existing.penalty_low_eur <> _penalty_low_eur
      OR existing.penalty_mode <> _penalty_mode
      OR existing.penalty_high_custom IS DISTINCT FROM normalized_high_custom
      OR existing.penalty_medium_custom IS DISTINCT FROM normalized_medium_custom
      OR existing.penalty_low_custom IS DISTINCT FROM normalized_low_custom
      OR existing.legacy_photo_owed
      OR existing.travel_pause_enabled IS DISTINCT FROM _travel_pause_enabled
      OR existing.travel_pause_home_countries IS DISTINCT FROM normalized_home_countries
      OR NOT EXISTS (
        SELECT 1 FROM public.challenge_members
        WHERE challenge_id = _request_id AND user_id = caller
      )
      OR NOT EXISTS (
        SELECT 1 FROM public.challenge_invitations
        WHERE challenge_id = _request_id
          AND created_by = caller
          AND invited_user_id = invited_user
          AND invited_username_snapshot = normalized_username
          AND token_hash = _token_hash
      )
    THEN
      RAISE EXCEPTION 'Creation request conflicts with existing state';
    END IF;
    RETURN _request_id;
  END IF;

  INSERT INTO public.challenges(
    id, created_by, name, start_date, timezone, duration_weeks, weekly_target_km,
    penalty_mode, penalty_high_eur, penalty_medium_eur, penalty_low_eur,
    penalty_high_custom, penalty_medium_custom, penalty_low_custom, legacy_photo_owed,
    travel_pause_enabled, travel_pause_home_countries
  ) VALUES (
    _request_id, caller, normalized_name, _start_date, _timezone, _duration_weeks,
    _weekly_target_km, _penalty_mode, _penalty_high_eur, _penalty_medium_eur, _penalty_low_eur,
    normalized_high_custom, normalized_medium_custom, normalized_low_custom, false,
    _travel_pause_enabled, normalized_home_countries
  );

  INSERT INTO public.challenge_members(challenge_id, user_id)
  VALUES (_request_id, caller);

  INSERT INTO public.challenge_invitations(
    challenge_id, invited_user_id, invited_username_snapshot, token_hash, expires_at, created_by
  ) VALUES (
    _request_id, invited_user, normalized_username, _token_hash, now() + interval '14 days', caller
  );

  RETURN _request_id;
END;
$function$;

-- 3. Creator-only cancel of a still-pending challenge. The opponent having accepted (a second
--    member) blocks it. Deleting the challenge cascades to its membership + invitation(s).
CREATE OR REPLACE FUNCTION public.cancel_pending_challenge(_caller uuid, _challenge uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE creator uuid; member_count integer;
BEGIN
  IF _caller IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(_challenge::text, 0));
  SELECT created_by INTO creator FROM public.challenges WHERE id = _challenge FOR UPDATE;
  IF creator IS NULL THEN RAISE EXCEPTION 'Challenge not found'; END IF;
  IF creator <> _caller THEN RAISE EXCEPTION 'Only the Challenge creator can cancel it'; END IF;
  SELECT count(*) INTO member_count FROM public.challenge_members WHERE challenge_id = _challenge;
  IF member_count > 1 THEN
    RAISE EXCEPTION 'This Challenge has been accepted and can no longer be cancelled';
  END IF;
  DELETE FROM public.challenges WHERE id = _challenge;
  RETURN true;
END;
$function$;

-- 4. Give an invited user the full agreed terms so the invitation card and a read-only pending
--    Terms view can render without making them a member first.
DROP FUNCTION IF EXISTS public.list_my_challenge_invitations(uuid);
CREATE FUNCTION public.list_my_challenge_invitations(_caller uuid)
RETURNS TABLE(
  invitation_id uuid,
  challenge_id uuid,
  challenge_name text,
  inviter_username text,
  weekly_target_km numeric,
  expires_at timestamptz,
  duration_weeks integer,
  start_date date,
  timezone text,
  penalty_mode text,
  penalty_high_eur numeric,
  penalty_medium_eur numeric,
  penalty_low_eur numeric,
  penalty_high_custom text,
  penalty_medium_custom text,
  penalty_low_custom text,
  legacy_photo_owed boolean,
  travel_pause_enabled boolean,
  travel_pause_home_countries text[]
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
BEGIN
  IF _caller IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  RETURN QUERY
  SELECT invitation.id, challenge.id, challenge.name,
    coalesce(inviter.username, 'Tempo user'), challenge.weekly_target_km, invitation.expires_at,
    challenge.duration_weeks, challenge.start_date, challenge.timezone,
    challenge.penalty_mode, challenge.penalty_high_eur, challenge.penalty_medium_eur,
    challenge.penalty_low_eur, challenge.penalty_high_custom, challenge.penalty_medium_custom,
    challenge.penalty_low_custom, challenge.legacy_photo_owed,
    challenge.travel_pause_enabled, challenge.travel_pause_home_countries
  FROM public.challenge_invitations invitation
  JOIN public.challenges challenge ON challenge.id = invitation.challenge_id
  LEFT JOIN public.profiles inviter ON inviter.id = invitation.created_by
  WHERE invitation.invited_user_id = _caller
    AND invitation.accepted_at IS NULL
    AND invitation.revoked_at IS NULL
    AND invitation.expires_at > now()
  ORDER BY invitation.created_at DESC;
END;
$function$;

REVOKE ALL ON FUNCTION public.cancel_pending_challenge(uuid, uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.list_my_challenge_invitations(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.cancel_pending_challenge(uuid, uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.list_my_challenge_invitations(uuid) TO service_role;
