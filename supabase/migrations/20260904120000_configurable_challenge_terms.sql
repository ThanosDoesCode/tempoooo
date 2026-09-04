-- Challenge target and money penalties are selected once during atomic creation.
-- Existing challenges receive the published €15 / €10 / €5 defaults without rewriting results.
ALTER TABLE public.challenges
  DROP CONSTRAINT challenge_target_ck,
  ADD COLUMN penalty_high_eur numeric(8,2) NOT NULL DEFAULT 15,
  ADD COLUMN penalty_medium_eur numeric(8,2) NOT NULL DEFAULT 10,
  ADD COLUMN penalty_low_eur numeric(8,2) NOT NULL DEFAULT 5,
  ADD CONSTRAINT challenge_target_ck
    CHECK (weekly_target_km BETWEEN 1 AND 500),
  ADD CONSTRAINT challenge_penalty_amounts_ck CHECK (
    penalty_high_eur BETWEEN 0 AND 1000
    AND penalty_medium_eur BETWEEN 0 AND 1000
    AND penalty_low_eur BETWEEN 0 AND 1000
    AND penalty_high_eur >= penalty_medium_eur
    AND penalty_medium_eur >= penalty_low_eur
  );

CREATE FUNCTION private.guard_challenge_terms()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  IF NEW.weekly_target_km IS DISTINCT FROM OLD.weekly_target_km
    OR NEW.penalty_high_eur IS DISTINCT FROM OLD.penalty_high_eur
    OR NEW.penalty_medium_eur IS DISTINCT FROM OLD.penalty_medium_eur
    OR NEW.penalty_low_eur IS DISTINCT FROM OLD.penalty_low_eur
  THEN
    RAISE EXCEPTION 'Challenge target and penalties are immutable';
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION private.guard_challenge_terms()
  FROM PUBLIC, anon, authenticated;

CREATE TRIGGER challenges_terms_immutable
BEFORE UPDATE OF weekly_target_km, penalty_high_eur, penalty_medium_eur, penalty_low_eur
ON public.challenges
FOR EACH ROW EXECUTE FUNCTION private.guard_challenge_terms();

-- Replace the original signature so creation cannot bypass explicit validated terms.
DROP FUNCTION public.create_challenge_atomic(uuid, text, date, text, integer, text, text);
DROP FUNCTION public.penalty_for(numeric);

CREATE FUNCTION public.create_challenge_atomic(
  _request_id uuid,
  _name text,
  _start_date date,
  _timezone text,
  _duration_weeks integer,
  _invited_email text,
  _token_hash text,
  _weekly_target_km numeric,
  _penalty_high_eur numeric,
  _penalty_medium_eur numeric,
  _penalty_low_eur numeric
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
  IF _weekly_target_km IS NULL OR _weekly_target_km NOT BETWEEN 1 AND 500
    OR round(_weekly_target_km, 2) <> _weekly_target_km
  THEN
    RAISE EXCEPTION 'Weekly target must be between 1 and 500 km with at most 2 decimals';
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
    penalty_high_eur, penalty_medium_eur, penalty_low_eur
  ) VALUES (
    _request_id, caller, normalized_name, _start_date, _timezone, _duration_weeks,
    _weekly_target_km, _penalty_high_eur, _penalty_medium_eur, _penalty_low_eur
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
  uuid, text, date, text, integer, text, text, numeric, numeric, numeric, numeric
) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.create_challenge_atomic(
  uuid, text, date, text, integer, text, text, numeric, numeric, numeric, numeric
) TO authenticated;

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
  penalty_high_eur numeric,
  penalty_medium_eur numeric,
  penalty_low_eur numeric
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
    challenge.weekly_target_km, challenge.penalty_high_eur,
    challenge.penalty_medium_eur, challenge.penalty_low_eur
  FROM public.challenges challenge
  WHERE challenge.id = invitation.challenge_id;
END;
$$;

REVOKE ALL ON FUNCTION public.preview_challenge_invitation(uuid, text, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.preview_challenge_invitation(uuid, text, text)
  TO service_role;

CREATE OR REPLACE FUNCTION public.penalty_for(
  _km numeric,
  _target numeric,
  _high numeric,
  _medium numeric,
  _low numeric
)
RETURNS numeric
LANGUAGE sql
IMMUTABLE
SET search_path = ''
AS $$
  SELECT CASE
    WHEN _target <= 0 OR _km >= _target THEN 0
    WHEN _km >= (_target * 2 / 3) THEN _low
    WHEN _km >= (_target / 3) THEN _medium
    ELSE _high
  END::numeric
$$;

REVOKE ALL ON FUNCTION public.penalty_for(numeric, numeric, numeric, numeric, numeric)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.penalty_for(numeric, numeric, numeric, numeric, numeric)
  TO authenticated, service_role;

-- Compatibility wrapper for legacy callers; thresholds are still target-relative.
CREATE OR REPLACE FUNCTION public.penalty_for(_km numeric, _target numeric)
RETURNS numeric
LANGUAGE sql
IMMUTABLE
SET search_path = ''
AS $$
  SELECT public.penalty_for(_km, _target, 15, 10, 5)
$$;

CREATE OR REPLACE FUNCTION private.target_for_week(_c uuid, _w integer)
RETURNS numeric
LANGUAGE sql
STABLE
SET search_path = ''
AS $$
  SELECT challenge.weekly_target_km
  FROM public.challenges challenge
  WHERE challenge.id = _c
$$;

CREATE OR REPLACE FUNCTION private.target_for_week(_c uuid, _w integer, _u uuid)
RETURNS numeric
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT CASE
    WHEN private.challenge_week_paused(_c, _u, _w) THEN 0
    ELSE challenge.weekly_target_km
  END
  FROM public.challenges challenge
  WHERE challenge.id = _c
$$;

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
      pen := public.penalty_for(
        eq, tgt, ch.penalty_high_eur, ch.penalty_medium_eur, ch.penalty_low_eur
      );

      INSERT INTO public.challenge_weeks(
        challenge_id, user_id, week_number, week_start, week_end,
        running_km, cycling_km, equivalent_km, target_km, completed,
        penalty_eur, paused, pause_country
      ) VALUES (
        _c, m.user_id, w, ch.start_date + ((w - 1) * 7),
        ch.start_date + ((w - 1) * 7) + 6, run_km, cyc_km, round(eq, 2),
        tgt, is_paused OR eq >= tgt, pen, is_paused, paused_country
      ) RETURNING id INTO wk_id;
      inserted := inserted + 1;

      IF pen > 0 THEN
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

-- Keep push/outbox behavior unchanged while reading each challenge's target.
CREATE OR REPLACE FUNCTION private.capture_challenge_activity_push()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  batch record;
  activity record;
  week_start date;
  total numeric;
  previous_total numeric;
  old_total numeric;
  target numeric;
  paused boolean;
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF NOT EXISTS (
      SELECT 1 FROM new_activities n JOIN old_activities o USING (id)
      WHERE n.distance_km IS DISTINCT FROM o.distance_km
        OR n.activity_type IS DISTINCT FROM o.activity_type
        OR n.activity_date IS DISTINCT FROM o.activity_date
        OR n.duration_seconds IS DISTINCT FROM o.duration_seconds
    ) THEN RETURN NULL; END IF;
  END IF;

  FOR batch IN
    SELECT n.challenge_id, n.user_id,
      private.challenge_week_of(n.challenge_id, n.activity_date) AS week_no,
      sum(n.qualifying_equivalent_km) AS new_total
    FROM new_activities n
    WHERE private.challenge_week_open(n.challenge_id, n.activity_date)
    GROUP BY n.challenge_id, n.user_id,
      private.challenge_week_of(n.challenge_id, n.activity_date)
  LOOP
    SELECT start_date + (batch.week_no - 1) * 7 INTO week_start
    FROM public.challenges WHERE id = batch.challenge_id;
    SELECT coalesce(sum(qualifying_equivalent_km), 0) INTO total
    FROM public.challenge_activities
    WHERE challenge_id = batch.challenge_id AND user_id = batch.user_id
      AND activity_date BETWEEN week_start AND week_start + 6;

    paused := private.challenge_week_paused(batch.challenge_id, batch.user_id, batch.week_no);
    target := private.target_for_week(batch.challenge_id, batch.week_no, batch.user_id);
    previous_total := total - batch.new_total;
    IF TG_OP = 'UPDATE' THEN
      SELECT coalesce(sum(qualifying_equivalent_km), 0) INTO old_total
      FROM old_activities
      WHERE challenge_id = batch.challenge_id AND user_id = batch.user_id
        AND activity_date BETWEEN week_start AND week_start + 6;
      previous_total := previous_total + old_total;
    ELSE
      FOR activity IN
        SELECT * FROM new_activities
        WHERE challenge_id = batch.challenge_id AND user_id = batch.user_id
          AND activity_date BETWEEN week_start AND week_start + 6
      LOOP
        PERFORM private.enqueue_challenge_push(
          activity.challenge_id, activity.user_id, 'activity_posted',
          'activity:' || activity.id,
          jsonb_build_object(
            'activity_type', activity.activity_type,
            'distance_km', activity.distance_km,
            'equivalent_km', activity.qualifying_equivalent_km,
            'qualified', activity.is_qualified,
            'total_km', total,
            'target_km', target,
            'paused', paused
          )
        );
      END LOOP;
    END IF;

    IF NOT paused AND previous_total < target AND total >= target THEN
      PERFORM private.enqueue_challenge_push(
        batch.challenge_id, batch.user_id, 'target_reached',
        'target:' || batch.challenge_id || ':' || batch.user_id || ':' || batch.week_no,
        jsonb_build_object('target_km', target)
      );
    END IF;
  END LOOP;
  RETURN NULL;
END;
$$;
