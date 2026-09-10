-- Account onboarding and UUID-backed Challenge usernames.
-- Existing accounts are backfilled as complete; no Goal, Bulk, Challenge, or history rows change.

ALTER TABLE public.profiles
  ADD COLUMN username text,
  ADD COLUMN account_onboarded_at timestamptz;

-- Every account that existed at migration time is established, including rare auth
-- accounts that did not yet have a public profile row.
INSERT INTO public.profiles(id, account_onboarded_at)
SELECT u.id, now()
FROM auth.users u
ON CONFLICT (id) DO UPDATE
SET account_onboarded_at = coalesce(public.profiles.account_onboarded_at, EXCLUDED.account_onboarded_at);

ALTER TABLE public.profiles
  ADD CONSTRAINT profiles_username_format_ck CHECK (
    username IS NULL OR (
      username = lower(btrim(username))
      AND username ~ '^[a-z0-9_]{3,20}$'
      AND username NOT IN ('admin', 'administrator', 'tempo', 'support', 'system')
    )
  );

CREATE UNIQUE INDEX profiles_username_unique_ci
  ON public.profiles(lower(username))
  WHERE username IS NOT NULL;

REVOKE INSERT, UPDATE ON public.profiles FROM authenticated;
GRANT INSERT(id, email, display_name, avatar_url) ON public.profiles TO authenticated;
GRANT UPDATE(email, display_name, avatar_url, goal_seen_at) ON public.profiles TO authenticated;

ALTER TABLE public.challenge_invitations
  ADD COLUMN invited_user_id uuid REFERENCES public.profiles(id),
  ADD COLUMN invited_username_snapshot text;

ALTER TABLE public.challenge_invitations
  ALTER COLUMN invited_email DROP NOT NULL;

ALTER TABLE public.challenge_invitations
  ADD CONSTRAINT challenge_invitation_target_ck CHECK (
    (invited_user_id IS NOT NULL AND invited_username_snapshot IS NOT NULL)
    OR invited_email IS NOT NULL
  );

ALTER TABLE public.challenge_invitations
  ADD CONSTRAINT challenge_invitation_username_snapshot_ck CHECK (
    invited_username_snapshot IS NULL OR (
      invited_username_snapshot = lower(btrim(invited_username_snapshot))
      AND invited_username_snapshot ~ '^[a-z0-9_]{3,20}$'
      AND invited_username_snapshot NOT IN ('admin', 'administrator', 'tempo', 'support', 'system')
    )
  );

CREATE UNIQUE INDEX challenge_invitation_pending_user_unique
  ON public.challenge_invitations(challenge_id, invited_user_id)
  WHERE accepted_at IS NULL AND revoked_at IS NULL AND invited_user_id IS NOT NULL;

CREATE OR REPLACE FUNCTION private.valid_tempo_username(_username text)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
SET search_path = ''
AS $function$
  SELECT _username ~ '^[a-z0-9_]{3,20}$'
    AND _username NOT IN ('admin', 'administrator', 'tempo', 'support', 'system');
$function$;

CREATE OR REPLACE FUNCTION public.username_available(_caller uuid, _username text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
  SELECT _caller IS NOT NULL
    AND private.valid_tempo_username(lower(btrim(_username)))
    AND NOT EXISTS (
      SELECT 1 FROM public.profiles WHERE username = lower(btrim(_username)) AND id <> _caller
    );
$function$;

CREATE OR REPLACE FUNCTION public.set_account_username(
  _caller uuid,
  _username text,
  _complete_onboarding boolean
)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE normalized text := lower(btrim(coalesce(_username, '')));
BEGIN
  IF _caller IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  IF NOT private.valid_tempo_username(normalized) THEN RAISE EXCEPTION 'Invalid username'; END IF;
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(normalized, 0));
  IF EXISTS (SELECT 1 FROM public.profiles WHERE username = normalized AND id <> _caller) THEN
    RAISE EXCEPTION 'That username is already taken';
  END IF;
  UPDATE public.profiles
  SET username = normalized,
      account_onboarded_at = CASE
        WHEN _complete_onboarding THEN coalesce(account_onboarded_at, now())
        ELSE account_onboarded_at
      END
  WHERE id = _caller;
  IF NOT FOUND THEN RAISE EXCEPTION 'Profile not found'; END IF;
  RETURN normalized;
EXCEPTION WHEN unique_violation THEN
  RAISE EXCEPTION 'That username is already taken';
END;
$function$;

DROP FUNCTION public.create_challenge_atomic(
  uuid, uuid, text, date, text, integer, text, text, numeric, text,
  numeric, numeric, numeric, text, text, text, boolean, text[]
);
DROP FUNCTION private.create_challenge_atomic(
  uuid, uuid, text, date, text, integer, text, text, numeric, text,
  numeric, numeric, numeric, text, text, text, boolean, text[]
);

CREATE FUNCTION private.create_challenge_atomic(
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
  IF _duration_weeks IS NULL OR _duration_weeks < 52 THEN
    RAISE EXCEPTION 'Challenge duration must be at least 52 weeks';
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

CREATE FUNCTION public.create_challenge_atomic(
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
LANGUAGE sql
SECURITY DEFINER
SET search_path = ''
AS $function$
  SELECT private.create_challenge_atomic(
    _caller, _request_id, _name, _start_date, _timezone, _duration_weeks, _invited_username,
    _token_hash, _weekly_target_km, _penalty_mode, _penalty_high_eur, _penalty_medium_eur,
    _penalty_low_eur, _penalty_high_custom, _penalty_medium_custom, _penalty_low_custom,
    _travel_pause_enabled, _travel_pause_home_countries
  );
$function$;

CREATE OR REPLACE FUNCTION public.create_challenge_invitation(
  _caller uuid,
  _challenge uuid,
  _invited_username text,
  _token_hash text
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  normalized text := lower(btrim(coalesce(_invited_username, '')));
  target_user uuid;
  invitation_id uuid;
BEGIN
  IF _caller IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  IF NOT private.valid_tempo_username(normalized) THEN RAISE EXCEPTION 'Invalid username'; END IF;
  IF _token_hash !~ '^[0-9a-f]{64}$' THEN RAISE EXCEPTION 'Invalid invitation token'; END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.challenges c
    JOIN public.challenge_members cm ON cm.challenge_id = c.id
    WHERE c.id = _challenge AND c.created_by = _caller AND cm.user_id = _caller
  ) THEN RAISE EXCEPTION 'Only the Challenge creator can invite'; END IF;
  IF (SELECT count(*) FROM public.challenge_members WHERE challenge_id = _challenge) >= 2 THEN
    RAISE EXCEPTION 'This person is already part of the Challenge';
  END IF;
  SELECT id INTO target_user FROM public.profiles WHERE username = normalized;
  IF target_user IS NULL THEN RAISE EXCEPTION 'Username not found'; END IF;
  IF target_user = _caller THEN RAISE EXCEPTION 'You cannot invite yourself'; END IF;
  IF EXISTS (
    SELECT 1 FROM public.challenge_members
    WHERE challenge_id = _challenge AND user_id = target_user
  ) THEN RAISE EXCEPTION 'This person is already part of the Challenge'; END IF;
  IF EXISTS (
    SELECT 1 FROM public.challenge_invitations
    WHERE challenge_id = _challenge AND invited_user_id = target_user
      AND accepted_at IS NULL AND revoked_at IS NULL
  ) THEN RAISE EXCEPTION 'An invitation has already been sent to this username'; END IF;

  UPDATE public.challenge_invitations
  SET revoked_at = now()
  WHERE challenge_id = _challenge AND accepted_at IS NULL AND revoked_at IS NULL;

  INSERT INTO public.challenge_invitations(
    challenge_id, invited_user_id, invited_username_snapshot, token_hash, expires_at, created_by
  ) VALUES (
    _challenge, target_user, normalized, _token_hash, now() + interval '14 days', _caller
  )
  RETURNING id INTO invitation_id;
  RETURN invitation_id;
END;
$function$;

CREATE OR REPLACE FUNCTION public.preview_challenge_invitation(
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
AS $function$
DECLARE invitation public.challenge_invitations%ROWTYPE;
BEGIN
  IF _caller IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  SELECT * INTO invitation FROM public.challenge_invitations
  WHERE token_hash = pg_catalog.encode(pg_catalog.sha256(_token::bytea), 'hex') LIMIT 1;
  IF invitation IS NULL THEN RAISE EXCEPTION 'Invalid invitation'; END IF;
  IF invitation.accepted_at IS NOT NULL OR invitation.revoked_at IS NOT NULL THEN
    RAISE EXCEPTION 'This invitation is no longer valid';
  END IF;
  IF invitation.expires_at < now() THEN RAISE EXCEPTION 'This invitation has expired'; END IF;
  IF invitation.invited_user_id IS NOT NULL THEN
    IF invitation.invited_user_id <> _caller THEN
      RAISE EXCEPTION 'This invitation belongs to another Tempo user';
    END IF;
  ELSIF lower(invitation.invited_email) <> lower(coalesce(_email, '')) THEN
    RAISE EXCEPTION 'This invitation was sent to a different email address';
  END IF;
  RETURN QUERY SELECT c.id, c.name, c.duration_weeks, c.weekly_target_km, c.penalty_mode,
    c.penalty_high_eur, c.penalty_medium_eur, c.penalty_low_eur,
    c.penalty_high_custom, c.penalty_medium_custom, c.penalty_low_custom,
    c.legacy_photo_owed, c.travel_pause_enabled, c.travel_pause_home_countries
  FROM public.challenges c WHERE c.id = invitation.challenge_id;
END;
$function$;

CREATE OR REPLACE FUNCTION public.accept_challenge_invitation(_caller uuid, _email text, _token text)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE inv public.challenge_invitations%ROWTYPE; member_count integer;
BEGIN
  IF _caller IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  SELECT * INTO inv FROM public.challenge_invitations
  WHERE token_hash = pg_catalog.encode(pg_catalog.sha256(_token::bytea), 'hex')
  FOR UPDATE LIMIT 1;
  IF inv IS NULL THEN RAISE EXCEPTION 'Invalid invitation'; END IF;
  IF inv.accepted_at IS NOT NULL OR inv.revoked_at IS NOT NULL THEN
    RAISE EXCEPTION 'This invitation is no longer valid';
  END IF;
  IF inv.expires_at < now() THEN RAISE EXCEPTION 'This invitation has expired'; END IF;
  IF inv.invited_user_id IS NOT NULL THEN
    IF inv.invited_user_id <> _caller THEN RAISE EXCEPTION 'This invitation belongs to another Tempo user'; END IF;
  ELSIF lower(inv.invited_email) <> lower(coalesce(_email, '')) THEN
    RAISE EXCEPTION 'This invitation was sent to a different email address';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.challenge_members WHERE challenge_id = inv.challenge_id AND user_id = _caller
  ) THEN RAISE EXCEPTION 'This person is already part of the Challenge'; END IF;
  SELECT count(*) INTO member_count FROM public.challenge_members WHERE challenge_id = inv.challenge_id;
  IF member_count >= 2 THEN RAISE EXCEPTION 'This challenge is already full'; END IF;
  INSERT INTO public.challenge_members(challenge_id, user_id) VALUES (inv.challenge_id, _caller);
  UPDATE public.challenge_invitations SET accepted_at = now() WHERE id = inv.id;
  UPDATE public.challenge_invitations SET revoked_at = now()
  WHERE challenge_id = inv.challenge_id AND accepted_at IS NULL AND revoked_at IS NULL;
  RETURN inv.challenge_id;
END;
$function$;

REVOKE ALL ON FUNCTION private.valid_tempo_username(text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION private.create_challenge_atomic(
  uuid, uuid, text, date, text, integer, text, text, numeric, text,
  numeric, numeric, numeric, text, text, text, boolean, text[]
) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.username_available(uuid, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.set_account_username(uuid, text, boolean) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.create_challenge_invitation(uuid, uuid, text, text)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.create_challenge_atomic(
  uuid, uuid, text, date, text, integer, text, text, numeric, text,
  numeric, numeric, numeric, text, text, text, boolean, text[]
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.username_available(uuid, text) TO service_role;
GRANT EXECUTE ON FUNCTION private.create_challenge_atomic(
  uuid, uuid, text, date, text, integer, text, text, numeric, text,
  numeric, numeric, numeric, text, text, text, boolean, text[]
) TO service_role;
GRANT EXECUTE ON FUNCTION public.set_account_username(uuid, text, boolean) TO service_role;
GRANT EXECUTE ON FUNCTION public.create_challenge_invitation(uuid, uuid, text, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.create_challenge_atomic(
  uuid, uuid, text, date, text, integer, text, text, numeric, text,
  numeric, numeric, numeric, text, text, text, boolean, text[]
) TO service_role;

REVOKE INSERT, UPDATE, DELETE ON public.challenge_invitations FROM authenticated;
REVOKE ALL ON FUNCTION public.preview_challenge_invitation(uuid, text, text)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.accept_challenge_invitation(uuid, text, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.preview_challenge_invitation(uuid, text, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.accept_challenge_invitation(uuid, text, text) TO service_role;
