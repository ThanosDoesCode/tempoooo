-- Travel-pause eligibility becomes an immutable Challenge creation term.
-- Existing Challenges keep the published Greece + Sweden legacy behavior.
CREATE FUNCTION private.valid_travel_pause_countries(_codes text[])
RETURNS boolean
LANGUAGE sql
IMMUTABLE
SET search_path = ''
AS $$
  SELECT _codes IS NOT NULL
    AND cardinality(_codes) BETWEEN 1 AND 12
    AND cardinality(_codes) = (
      SELECT count(DISTINCT country)::integer FROM unnest(_codes) country
    )
    AND NOT EXISTS (
      SELECT 1 FROM unnest(_codes) country
      WHERE country <> upper(btrim(country))
        OR country NOT IN ('AD', 'AE', 'AF', 'AG', 'AI', 'AL', 'AM', 'AO', 'AQ', 'AR', 'AS', 'AT', 'AU', 'AW', 'AX', 'AZ', 'BA', 'BB', 'BD', 'BE', 'BF', 'BG', 'BH', 'BI', 'BJ', 'BL', 'BM', 'BN', 'BO', 'BQ', 'BR', 'BS', 'BT', 'BV', 'BW', 'BY', 'BZ', 'CA', 'CC', 'CD', 'CF', 'CG', 'CH', 'CI', 'CK', 'CL', 'CM', 'CN', 'CO', 'CR', 'CU', 'CV', 'CW', 'CX', 'CY', 'CZ', 'DE', 'DJ', 'DK', 'DM', 'DO', 'DZ', 'EC', 'EE', 'EG', 'EH', 'ER', 'ES', 'ET', 'FI', 'FJ', 'FK', 'FM', 'FO', 'FR', 'GA', 'GB', 'GD', 'GE', 'GF', 'GG', 'GH', 'GI', 'GL', 'GM', 'GN', 'GP', 'GQ', 'GR', 'GS', 'GT', 'GU', 'GW', 'GY', 'HK', 'HM', 'HN', 'HR', 'HT', 'HU', 'ID', 'IE', 'IL', 'IM', 'IN', 'IO', 'IQ', 'IR', 'IS', 'IT', 'JE', 'JM', 'JO', 'JP', 'KE', 'KG', 'KH', 'KI', 'KM', 'KN', 'KP', 'KR', 'KW', 'KY', 'KZ', 'LA', 'LB', 'LC', 'LI', 'LK', 'LR', 'LS', 'LT', 'LU', 'LV', 'LY', 'MA', 'MC', 'MD', 'ME', 'MF', 'MG', 'MH', 'MK', 'ML', 'MM', 'MN', 'MO', 'MP', 'MQ', 'MR', 'MS', 'MT', 'MU', 'MV', 'MW', 'MX', 'MY', 'MZ', 'NA', 'NC', 'NE', 'NF', 'NG', 'NI', 'NL', 'NO', 'NP', 'NR', 'NU', 'NZ', 'OM', 'PA', 'PE', 'PF', 'PG', 'PH', 'PK', 'PL', 'PM', 'PN', 'PR', 'PS', 'PT', 'PW', 'PY', 'QA', 'RE', 'RO', 'RS', 'RU', 'RW', 'SA', 'SB', 'SC', 'SD', 'SE', 'SG', 'SH', 'SI', 'SJ', 'SK', 'SL', 'SM', 'SN', 'SO', 'SR', 'SS', 'ST', 'SV', 'SX', 'SY', 'SZ', 'TC', 'TD', 'TF', 'TG', 'TH', 'TJ', 'TK', 'TL', 'TM', 'TN', 'TO', 'TR', 'TT', 'TV', 'TW', 'TZ', 'UA', 'UG', 'UM', 'US', 'UY', 'UZ', 'VA', 'VC', 'VE', 'VG', 'VI', 'VN', 'VU', 'WF', 'WS', 'YE', 'YT', 'ZA', 'ZM', 'ZW')
    )
$$;

REVOKE ALL ON FUNCTION private.valid_travel_pause_countries(text[])
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION private.valid_travel_pause_countries(text[])
  TO service_role;

ALTER TABLE public.challenges
  ADD COLUMN travel_pause_enabled boolean NOT NULL DEFAULT true,
  ADD COLUMN travel_pause_home_countries text[] NOT NULL DEFAULT ARRAY['GR', 'SE']::text[],
  ADD CONSTRAINT challenge_travel_pause_terms_ck CHECK (
    (travel_pause_enabled
      AND private.valid_travel_pause_countries(travel_pause_home_countries))
    OR
    (NOT travel_pause_enabled AND cardinality(travel_pause_home_countries) = 0)
  );

CREATE OR REPLACE FUNCTION private.guard_challenge_terms()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF NEW.weekly_target_km IS DISTINCT FROM OLD.weekly_target_km
    OR NEW.penalty_high_eur IS DISTINCT FROM OLD.penalty_high_eur
    OR NEW.penalty_medium_eur IS DISTINCT FROM OLD.penalty_medium_eur
    OR NEW.penalty_low_eur IS DISTINCT FROM OLD.penalty_low_eur
    OR NEW.penalty_mode IS DISTINCT FROM OLD.penalty_mode
    OR NEW.penalty_high_custom IS DISTINCT FROM OLD.penalty_high_custom
    OR NEW.penalty_medium_custom IS DISTINCT FROM OLD.penalty_medium_custom
    OR NEW.penalty_low_custom IS DISTINCT FROM OLD.penalty_low_custom
    OR NEW.legacy_photo_owed IS DISTINCT FROM OLD.legacy_photo_owed
    OR NEW.travel_pause_enabled IS DISTINCT FROM OLD.travel_pause_enabled
    OR NEW.travel_pause_home_countries IS DISTINCT FROM OLD.travel_pause_home_countries
  THEN
    RAISE EXCEPTION 'Challenge target and rules are immutable';
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION private.guard_challenge_terms()
  FROM PUBLIC, anon, authenticated;

DROP TRIGGER challenges_terms_immutable ON public.challenges;
CREATE TRIGGER challenges_terms_immutable
BEFORE UPDATE OF weekly_target_km, penalty_high_eur, penalty_medium_eur, penalty_low_eur,
  penalty_mode, penalty_high_custom, penalty_medium_custom, penalty_low_custom,
  legacy_photo_owed, travel_pause_enabled, travel_pause_home_countries
ON public.challenges
FOR EACH ROW EXECUTE FUNCTION private.guard_challenge_terms();

CREATE OR REPLACE FUNCTION public.guard_challenge_travel_pause()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  actor uuid := auth.uid();
  row_challenge uuid := CASE WHEN TG_OP = 'DELETE' THEN OLD.challenge_id ELSE NEW.challenge_id END;
  row_user uuid := CASE WHEN TG_OP = 'DELETE' THEN OLD.user_id ELSE NEW.user_id END;
  row_week integer := CASE WHEN TG_OP = 'DELETE' THEN OLD.week_number ELSE NEW.week_number END;
  current_week integer;
  duration integer;
  pauses_enabled boolean;
  home_countries text[];
BEGIN
  IF actor IS NULL OR row_user <> actor THEN
    RAISE EXCEPTION 'You can only manage your own travel pauses';
  END IF;
  IF NOT private.is_challenge_member(row_challenge) THEN
    RAISE EXCEPTION 'Not a member of this challenge';
  END IF;
  IF TG_OP = 'UPDATE' AND (
    NEW.challenge_id IS DISTINCT FROM OLD.challenge_id
    OR NEW.user_id IS DISTINCT FROM OLD.user_id
    OR NEW.week_number IS DISTINCT FROM OLD.week_number
  ) THEN
    RAISE EXCEPTION 'Travel pause identity is immutable';
  END IF;

  SELECT c.duration_weeks, c.travel_pause_enabled, c.travel_pause_home_countries
  INTO duration, pauses_enabled, home_countries
  FROM public.challenges c WHERE c.id = row_challenge;
  IF duration IS NULL OR row_week < 1 OR row_week > duration THEN
    RAISE EXCEPTION 'That week is outside the challenge';
  END IF;
  current_week := private.challenge_week_of(row_challenge, private.challenge_today(row_challenge));
  IF row_week < current_week THEN
    RAISE EXCEPTION 'Past travel pauses cannot be changed';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.challenge_weeks week
    WHERE week.challenge_id = row_challenge
      AND week.user_id = row_user
      AND week.week_number = row_week
  ) THEN
    RAISE EXCEPTION 'Finalized travel pauses cannot be changed';
  END IF;

  IF TG_OP <> 'DELETE' THEN
    IF NOT pauses_enabled THEN
      RAISE EXCEPTION 'Travel pauses are disabled for this challenge';
    END IF;
    NEW.country := upper(btrim(NEW.country));
    IF NOT private.valid_travel_pause_countries(ARRAY[NEW.country]) THEN
      RAISE EXCEPTION 'Select a valid travel country';
    END IF;
    IF NEW.country = ANY(home_countries) THEN
      RAISE EXCEPTION 'Travel pauses are only allowed outside the challenge home countries';
    END IF;
    NEW.updated_at := now();
    RETURN NEW;
  END IF;
  RETURN OLD;
END;
$$;

REVOKE ALL ON FUNCTION public.guard_challenge_travel_pause()
  FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION private.challenge_week_paused(_c uuid, _u uuid, _w integer)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.challenge_travel_pauses pause
    JOIN public.challenges challenge ON challenge.id = pause.challenge_id
    WHERE pause.challenge_id = _c
      AND pause.user_id = _u
      AND pause.week_number = _w
      AND challenge.travel_pause_enabled
  )
$$;

REVOKE ALL ON FUNCTION private.challenge_week_paused(uuid, uuid, integer)
  FROM PUBLIC, anon, authenticated;

-- Replace the Money + Custom signature with the travel-configurable atomic contract.
DROP FUNCTION public.create_challenge_atomic(
  uuid, text, date, text, integer, text, text, numeric, text,
  numeric, numeric, numeric, text, text, text
);

CREATE FUNCTION public.create_challenge_atomic(
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
SET search_path = ''
AS $$
DECLARE
  caller uuid := auth.uid();
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
$$;

REVOKE ALL ON FUNCTION public.create_challenge_atomic(
  uuid, text, date, text, integer, text, text, numeric, text,
  numeric, numeric, numeric, text, text, text, boolean, text[]
) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.create_challenge_atomic(
  uuid, text, date, text, integer, text, text, numeric, text,
  numeric, numeric, numeric, text, text, text, boolean, text[]
) TO authenticated;

DROP FUNCTION public.preview_challenge_invitation(uuid, text, text);

CREATE FUNCTION public.preview_challenge_invitation(
  _caller uuid,
  _email text,
  _token text
)
RETURNS TABLE(
  challenge_id uuid,
  challenge_name text,
  duration_weeks integer,
  weekly_target_km numeric,
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
AS $$
DECLARE
  invitation public.challenge_invitations%ROWTYPE;
BEGIN
  IF _caller IS NULL OR coalesce(_email, '') = '' THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;
  SELECT * INTO invitation
  FROM public.challenge_invitations
  WHERE token_hash = pg_catalog.encode(pg_catalog.sha256(_token::bytea), 'hex')
  LIMIT 1;
  IF invitation IS NULL THEN RAISE EXCEPTION 'Invalid invitation'; END IF;
  IF invitation.accepted_at IS NOT NULL OR invitation.revoked_at IS NOT NULL THEN
    RAISE EXCEPTION 'This invitation is no longer valid';
  END IF;
  IF invitation.expires_at < now() THEN RAISE EXCEPTION 'This invitation has expired'; END IF;
  IF lower(invitation.invited_email) <> lower(_email) THEN
    RAISE EXCEPTION 'This invitation was sent to a different email address';
  END IF;
  RETURN QUERY
  SELECT challenge.id, challenge.name, challenge.duration_weeks,
    challenge.weekly_target_km, challenge.penalty_mode, challenge.penalty_high_eur,
    challenge.penalty_medium_eur, challenge.penalty_low_eur,
    challenge.penalty_high_custom, challenge.penalty_medium_custom,
    challenge.penalty_low_custom, challenge.legacy_photo_owed,
    challenge.travel_pause_enabled, challenge.travel_pause_home_countries
  FROM public.challenges challenge
  WHERE challenge.id = invitation.challenge_id;
END;
$$;

REVOKE ALL ON FUNCTION public.preview_challenge_invitation(uuid, text, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.preview_challenge_invitation(uuid, text, text)
  TO service_role;
