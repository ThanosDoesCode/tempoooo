CREATE OR REPLACE FUNCTION private.create_challenge_atomic(
  _caller uuid,
  _request_id uuid,
  _name text,
  _start_date date,
  _timezone text,
  _duration_weeks integer,
  _invited_email text,
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
  normalized_email text := lower(btrim(coalesce(_invited_email, '')));
  normalized_high_custom text := nullif(btrim(coalesce(_penalty_high_custom, '')), '');
  normalized_medium_custom text := nullif(btrim(coalesce(_penalty_medium_custom, '')), '');
  normalized_low_custom text := nullif(btrim(coalesce(_penalty_low_custom, '')), '');
  normalized_home_countries text[] := ARRAY(
    SELECT DISTINCT upper(btrim(country))
    FROM unnest(coalesce(_travel_pause_home_countries, ARRAY[]::text[])) country
    ORDER BY 1
  );
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
          AND invited_email = normalized_email
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
    challenge_id, invited_email, token_hash, expires_at, created_by
  ) VALUES (
    _request_id, normalized_email, _token_hash, now() + interval '14 days', caller
  );

  RETURN _request_id;
END;
$function$;

CREATE OR REPLACE FUNCTION private.disable_challenge_push(_caller uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
BEGIN
  IF _caller IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  UPDATE public.challenge_push_users SET enabled = false WHERE user_id = _caller;
  UPDATE public.push_subscriptions SET is_active = false, updated_at = now() WHERE user_id = _caller;
END;
$function$;

REVOKE ALL ON FUNCTION private.create_challenge_atomic(
  uuid, uuid, text, date, text, integer, text, text, numeric, text,
  numeric, numeric, numeric, text, text, text, boolean, text[]
) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION private.disable_challenge_push(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION private.create_challenge_atomic(
  uuid, uuid, text, date, text, integer, text, text, numeric, text,
  numeric, numeric, numeric, text, text, text, boolean, text[]
) TO service_role;
GRANT EXECUTE ON FUNCTION private.disable_challenge_push(uuid) TO service_role;

DROP FUNCTION IF EXISTS public.create_challenge_atomic(
  uuid, text, date, text, integer, text, text, numeric, text,
  numeric, numeric, numeric, text, text, text, boolean, text[]
);
DROP FUNCTION IF EXISTS public.disable_challenge_push();

CREATE OR REPLACE FUNCTION public.guard_activity()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  actor uuid := auth.uid();
  row_challenge uuid := CASE WHEN TG_OP = 'INSERT' THEN NEW.challenge_id ELSE OLD.challenge_id END;
  activity_user uuid := CASE WHEN TG_OP = 'INSERT' THEN NEW.user_id ELSE OLD.user_id END;
  qualification_changed boolean;
BEGIN
  IF actor IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  IF activity_user <> actor THEN
    IF TG_OP = 'INSERT' THEN RAISE EXCEPTION 'You can only log your own activities'; END IF;
    IF TG_OP = 'UPDATE' THEN RAISE EXCEPTION 'You can only edit your own activities'; END IF;
    RAISE EXCEPTION 'You can only delete your own activities';
  END IF;
  IF NOT private.is_challenge_member(row_challenge) THEN
    RAISE EXCEPTION 'Not a member of this challenge';
  END IF;

  IF TG_OP = 'INSERT' THEN
    IF NEW.duration_seconds IS NULL THEN
      RAISE EXCEPTION 'Duration is required to verify pace or speed';
    END IF;
    IF NOT private.challenge_week_open(NEW.challenge_id, NEW.activity_date) THEN
      RAISE EXCEPTION 'That week is closed or the date is invalid';
    END IF;
    IF EXISTS (
      SELECT 1 FROM public.challenge_weeks w
      WHERE w.challenge_id = NEW.challenge_id
        AND w.user_id = NEW.user_id
        AND w.week_number = private.challenge_week_of(NEW.challenge_id, NEW.activity_date)
    ) THEN RAISE EXCEPTION 'Finalized activity cannot be changed'; END IF;
    NEW.verification_source := 'manual_strava_screenshot';
    NEW.strava_activity_id := NULL;
    NEW.strava_athlete_id := NULL;
    NEW.edited := false;
    RETURN NEW;
  END IF;

  IF TG_OP = 'UPDATE' THEN
    IF NEW.user_id IS DISTINCT FROM OLD.user_id
       OR NEW.challenge_id IS DISTINCT FROM OLD.challenge_id THEN
      RAISE EXCEPTION 'Immutable activity identity';
    END IF;
    IF NOT private.challenge_week_open(OLD.challenge_id, OLD.activity_date)
       OR NOT private.challenge_week_open(NEW.challenge_id, NEW.activity_date) THEN
      RAISE EXCEPTION 'That week is closed';
    END IF;
    IF EXISTS (
      SELECT 1 FROM public.challenge_weeks w
      WHERE w.challenge_id = OLD.challenge_id
        AND w.user_id = OLD.user_id
        AND w.week_number = private.challenge_week_of(OLD.challenge_id, OLD.activity_date)
    ) THEN RAISE EXCEPTION 'Finalized activity cannot be changed'; END IF;

    NEW.verification_source := OLD.verification_source;
    NEW.strava_activity_id := OLD.strava_activity_id;
    NEW.strava_athlete_id := OLD.strava_athlete_id;
    NEW.created_at := OLD.created_at;

    qualification_changed :=
      NEW.activity_type IS DISTINCT FROM OLD.activity_type
      OR NEW.distance_km IS DISTINCT FROM OLD.distance_km
      OR NEW.activity_date IS DISTINCT FROM OLD.activity_date
      OR NEW.duration_seconds IS DISTINCT FROM OLD.duration_seconds;
    IF qualification_changed AND NEW.duration_seconds IS NULL THEN
      RAISE EXCEPTION 'Duration is required to verify pace or speed';
    END IF;
    NEW.edited := OLD.edited OR qualification_changed;
    RETURN NEW;
  END IF;

  IF NOT private.challenge_week_open(OLD.challenge_id, OLD.activity_date) THEN
    RAISE EXCEPTION 'That week is closed';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.challenge_weeks w
    WHERE w.challenge_id = OLD.challenge_id
      AND w.user_id = OLD.user_id
      AND w.week_number = private.challenge_week_of(OLD.challenge_id, OLD.activity_date)
  ) THEN RAISE EXCEPTION 'Finalized activity cannot be changed'; END IF;
  RETURN OLD;
END;
$function$;