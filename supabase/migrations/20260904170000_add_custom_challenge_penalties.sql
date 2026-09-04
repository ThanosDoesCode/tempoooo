-- Add custom consequences without replaying the already-applied money-only migration.
-- Existing money challenges are backfilled as money mode with their legacy photo-owed display.
ALTER TABLE public.challenges
  ADD COLUMN penalty_mode text NOT NULL DEFAULT 'money',
  ADD COLUMN penalty_high_custom text,
  ADD COLUMN penalty_medium_custom text,
  ADD COLUMN penalty_low_custom text,
  ADD COLUMN legacy_photo_owed boolean NOT NULL DEFAULT true,
  ADD CONSTRAINT challenge_penalty_terms_ck CHECK (
    (penalty_mode = 'money'
      AND penalty_high_custom IS NULL
      AND penalty_medium_custom IS NULL
      AND penalty_low_custom IS NULL)
    OR
    (penalty_mode = 'custom'
      AND length(btrim(penalty_high_custom)) BETWEEN 1 AND 160
      AND length(btrim(penalty_medium_custom)) BETWEEN 1 AND 160
      AND length(btrim(penalty_low_custom)) BETWEEN 1 AND 160)
  );

ALTER TABLE public.challenges
  ALTER COLUMN legacy_photo_owed SET DEFAULT false;

ALTER TABLE public.challenge_weeks
  ADD COLUMN penalty_mode text,
  ADD COLUMN penalty_band text,
  ADD COLUMN penalty_consequence text,
  ADD CONSTRAINT challenge_week_penalty_snapshot_ck CHECK (
    (penalty_mode IS NULL AND penalty_band IS NULL AND penalty_consequence IS NULL)
    OR
    (penalty_mode = 'money'
      AND (penalty_band IS NULL OR penalty_band IN ('high', 'medium', 'low'))
      AND penalty_consequence IS NULL)
    OR
    (penalty_mode = 'custom'
      AND penalty_eur = 0
      AND (
        (penalty_band IS NULL AND penalty_consequence IS NULL)
        OR
        (penalty_band IN ('high', 'medium', 'low')
          AND length(penalty_consequence) BETWEEN 1 AND 160)
      ))
  );

CREATE OR REPLACE FUNCTION private.guard_challenge_terms()
RETURNS trigger
LANGUAGE plpgsql
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
  THEN
    RAISE EXCEPTION 'Challenge target and penalties are immutable';
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION private.guard_challenge_terms()
  FROM PUBLIC, anon, authenticated;

DROP TRIGGER challenges_terms_immutable ON public.challenges;
CREATE TRIGGER challenges_terms_immutable
BEFORE UPDATE OF weekly_target_km, penalty_high_eur, penalty_medium_eur, penalty_low_eur,
  penalty_mode, penalty_high_custom, penalty_medium_custom, penalty_low_custom, legacy_photo_owed
ON public.challenges
FOR EACH ROW EXECUTE FUNCTION private.guard_challenge_terms();

-- Replace the money-only signature with the Money + Custom atomic creation contract.
DROP FUNCTION public.create_challenge_atomic(
  uuid, text, date, text, integer, text, text, numeric, numeric, numeric, numeric
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
  _penalty_low_custom text
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
    penalty_high_custom, penalty_medium_custom, penalty_low_custom, legacy_photo_owed
  ) VALUES (
    _request_id, caller, normalized_name, _start_date, _timezone, _duration_weeks,
    _weekly_target_km, _penalty_mode, _penalty_high_eur, _penalty_medium_eur, _penalty_low_eur,
    normalized_high_custom, normalized_medium_custom, normalized_low_custom, false
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
  numeric, numeric, numeric, text, text, text
) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.create_challenge_atomic(
  uuid, text, date, text, integer, text, text, numeric, text,
  numeric, numeric, numeric, text, text, text
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
  legacy_photo_owed boolean
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
    challenge.penalty_low_custom, challenge.legacy_photo_owed
  FROM public.challenges challenge
  WHERE challenge.id = invitation.challenge_id;
END;
$$;

REVOKE ALL ON FUNCTION public.preview_challenge_invitation(uuid, text, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.preview_challenge_invitation(uuid, text, text)
  TO service_role;

CREATE FUNCTION private.penalty_band_for(_km numeric, _target numeric)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path = ''
AS $$
  SELECT CASE
    WHEN _target <= 0 OR _km >= _target THEN NULL
    WHEN _km >= (_target * 2 / 3) THEN 'low'
    WHEN _km >= (_target / 3) THEN 'medium'
    ELSE 'high'
  END
$$;

REVOKE ALL ON FUNCTION private.penalty_band_for(numeric, numeric)
  FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.finalize_challenge(_caller uuid, _c uuid)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  ch record;
  cur integer;
  w integer;
  m record;
  other uuid;
  run_km numeric;
  cyc_km numeric;
  eq numeric;
  pen numeric;
  band text;
  consequence text;
  tgt numeric;
  is_paused boolean;
  paused_country text;
  wk_id uuid;
  inserted integer := 0;
BEGIN
  IF _caller IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.challenge_members WHERE challenge_id = _c AND user_id = _caller
  ) THEN RAISE EXCEPTION 'Not a member of this challenge'; END IF;
  SELECT * INTO ch FROM public.challenges WHERE id = _c;
  IF ch IS NULL THEN RAISE EXCEPTION 'Challenge not found'; END IF;

  cur := private.challenge_week_of(_c, private.challenge_today(_c));
  FOR w IN 1 .. least(cur - 1, ch.duration_weeks) LOOP
    FOR m IN SELECT user_id FROM public.challenge_members WHERE challenge_id = _c LOOP
      IF EXISTS (
        SELECT 1 FROM public.challenge_weeks
        WHERE challenge_id = _c AND user_id = m.user_id AND week_number = w
      ) THEN CONTINUE; END IF;

      SELECT
        coalesce(sum(CASE WHEN activity_type = 'run' THEN distance_km ELSE 0 END), 0),
        coalesce(sum(CASE WHEN activity_type = 'cycle' THEN distance_km ELSE 0 END), 0),
        coalesce(sum(qualifying_equivalent_km), 0)
      INTO run_km, cyc_km, eq
      FROM public.challenge_activities
      WHERE challenge_id = _c AND user_id = m.user_id
        AND activity_date >= ch.start_date + ((w - 1) * 7)
        AND activity_date <= ch.start_date + ((w - 1) * 7) + 6;

      is_paused := private.challenge_week_paused(_c, m.user_id, w);
      SELECT pause.country INTO paused_country
      FROM public.challenge_travel_pauses pause
      WHERE pause.challenge_id = _c AND pause.user_id = m.user_id
        AND pause.week_number = w;
      tgt := private.target_for_week(_c, w, m.user_id);
      band := private.penalty_band_for(eq, tgt);
      IF ch.penalty_mode = 'money' THEN
        pen := public.penalty_for(
          eq, tgt, ch.penalty_high_eur, ch.penalty_medium_eur, ch.penalty_low_eur
        );
        consequence := NULL;
      ELSE
        pen := 0;
        consequence := CASE band
          WHEN 'high' THEN ch.penalty_high_custom
          WHEN 'medium' THEN ch.penalty_medium_custom
          WHEN 'low' THEN ch.penalty_low_custom
          ELSE NULL
        END;
      END IF;

      INSERT INTO public.challenge_weeks(
        challenge_id, user_id, week_number, week_start, week_end,
        running_km, cycling_km, equivalent_km, target_km, completed,
        penalty_eur, penalty_mode, penalty_band, penalty_consequence, paused, pause_country
      ) VALUES (
        _c, m.user_id, w, ch.start_date + ((w - 1) * 7),
        ch.start_date + ((w - 1) * 7) + 6, run_km, cyc_km, round(eq, 2),
        tgt, is_paused OR eq >= tgt, pen, ch.penalty_mode, band, consequence,
        is_paused, paused_country
      ) RETURNING id INTO wk_id;
      inserted := inserted + 1;

      IF ch.penalty_mode = 'money' AND pen > 0 THEN
        SELECT user_id INTO other FROM public.challenge_members
        WHERE challenge_id = _c AND user_id <> m.user_id LIMIT 1;
        IF other IS NOT NULL THEN
          INSERT INTO public.challenge_payments(
            challenge_id, week_id, payer_id, recipient_id, amount_eur
          ) VALUES (_c, wk_id, m.user_id, other, pen)
          ON CONFLICT (week_id) DO NOTHING;
        END IF;
      END IF;
    END LOOP;
  END LOOP;
  RETURN inserted;
END;
$$;

