-- Reuse the existing per-week target table through the privileged server boundary.
-- Members may read targets through RLS; only the service-role wrapper may mutate them.
ALTER TABLE public.challenge_week_targets
  ADD CONSTRAINT challenge_week_targets_value_v2_ck CHECK (
    target_km BETWEEN 1 AND 500
    AND round(target_km, 2) = target_km
  ) NOT VALID;

REVOKE INSERT, UPDATE, DELETE ON public.challenge_week_targets FROM authenticated;
DROP POLICY IF EXISTS "cwt insert creator" ON public.challenge_week_targets;
DROP POLICY IF EXISTS "cwt update creator" ON public.challenge_week_targets;
DROP POLICY IF EXISTS "cwt delete creator" ON public.challenge_week_targets;

CREATE OR REPLACE FUNCTION public.guard_week_target()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  row_challenge_id uuid := CASE WHEN TG_OP = 'DELETE' THEN OLD.challenge_id ELSE NEW.challenge_id END;
  week_no integer := CASE WHEN TG_OP = 'DELETE' THEN OLD.week_number ELSE NEW.week_number END;
  challenge_row public.challenges%ROWTYPE;
BEGIN
  SELECT * INTO challenge_row FROM public.challenges WHERE id = row_challenge_id;
  IF challenge_row IS NULL THEN RAISE EXCEPTION 'Challenge not found'; END IF;
  IF week_no < 1 OR week_no > challenge_row.duration_weeks THEN
    RAISE EXCEPTION 'Week is outside the challenge';
  END IF;
  IF week_no <= private.challenge_week_of(row_challenge_id, private.challenge_today(row_challenge_id)) THEN
    RAISE EXCEPTION 'Only future week targets can be changed';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.challenge_weeks
    WHERE challenge_weeks.challenge_id = row_challenge_id
      AND challenge_weeks.week_number = week_no
  ) THEN
    RAISE EXCEPTION 'Finalized week targets cannot be changed';
  END IF;
  IF TG_OP <> 'DELETE' AND (
    NEW.target_km NOT BETWEEN 1 AND 500 OR round(NEW.target_km, 2) <> NEW.target_km
  ) THEN
    RAISE EXCEPTION 'Weekly target must be between 1 and 500 km with at most 2 decimals';
  END IF;
  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END;
$$;

CREATE OR REPLACE FUNCTION private.set_challenge_week_target(
  _caller uuid,
  _challenge uuid,
  _week integer,
  _target numeric
)
RETURNS numeric
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  challenge_row public.challenges%ROWTYPE;
BEGIN
  IF _caller IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  IF _challenge IS NULL OR _week IS NULL THEN RAISE EXCEPTION 'Invalid weekly target request'; END IF;
  SELECT * INTO challenge_row FROM public.challenges WHERE id = _challenge FOR UPDATE;
  IF challenge_row IS NULL THEN RAISE EXCEPTION 'Challenge not found'; END IF;
  IF challenge_row.created_by <> _caller THEN
    RAISE EXCEPTION 'Only the challenge creator can change future targets';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.challenge_members
    WHERE challenge_id = _challenge AND user_id = _caller
  ) THEN
    RAISE EXCEPTION 'Active challenge membership required';
  END IF;
  IF _week < 1 OR _week > challenge_row.duration_weeks THEN
    RAISE EXCEPTION 'Week is outside the challenge';
  END IF;
  IF _week <= private.challenge_week_of(_challenge, private.challenge_today(_challenge)) THEN
    RAISE EXCEPTION 'Only future week targets can be changed';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.challenge_weeks
    WHERE challenge_id = _challenge AND week_number = _week
  ) THEN
    RAISE EXCEPTION 'Finalized week targets cannot be changed';
  END IF;

  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(_challenge::text || ':' || _week::text, 0)
  );
  IF _target IS NULL THEN
    DELETE FROM public.challenge_week_targets
    WHERE challenge_id = _challenge AND week_number = _week;
    RETURN challenge_row.weekly_target_km;
  END IF;
  IF _target NOT BETWEEN 1 AND 500 OR round(_target, 2) <> _target THEN
    RAISE EXCEPTION 'Weekly target must be between 1 and 500 km with at most 2 decimals';
  END IF;
  INSERT INTO public.challenge_week_targets(challenge_id, week_number, target_km, set_by)
  VALUES (_challenge, _week, _target, _caller)
  ON CONFLICT (challenge_id, week_number) DO UPDATE
    SET target_km = EXCLUDED.target_km,
        set_by = EXCLUDED.set_by,
        updated_at = pg_catalog.now();
  RETURN _target;
END;
$$;

CREATE OR REPLACE FUNCTION public.set_challenge_week_target(
  _caller uuid,
  _challenge uuid,
  _week integer,
  _target numeric
)
RETURNS numeric
LANGUAGE sql
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT private.set_challenge_week_target(_caller, _challenge, _week, _target)
$$;

REVOKE ALL ON FUNCTION private.set_challenge_week_target(uuid, uuid, integer, numeric)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.set_challenge_week_target(uuid, uuid, integer, numeric)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION private.set_challenge_week_target(uuid, uuid, integer, numeric)
  TO service_role;
GRANT EXECUTE ON FUNCTION public.set_challenge_week_target(uuid, uuid, integer, numeric)
  TO service_role;

-- Common target: week override, then the immutable challenge default.
CREATE OR REPLACE FUNCTION private.target_for_week(_c uuid, _w integer)
RETURNS numeric
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT coalesce(target.target_km, challenge.weekly_target_km)
  FROM public.challenges challenge
  LEFT JOIN public.challenge_week_targets target
    ON target.challenge_id = challenge.id AND target.week_number = _w
  WHERE challenge.id = _c
$$;

-- Participant target: travel pause, then override, then challenge default.
CREATE OR REPLACE FUNCTION private.target_for_week(_c uuid, _w integer, _u uuid)
RETURNS numeric
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT CASE
    WHEN private.challenge_week_paused(_c, _u, _w) THEN 0
    ELSE private.target_for_week(_c, _w)
  END
$$;

REVOKE ALL ON FUNCTION private.target_for_week(uuid, integer) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION private.target_for_week(uuid, integer, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION private.target_for_week(uuid, integer) TO service_role;
GRANT EXECUTE ON FUNCTION private.target_for_week(uuid, integer, uuid) TO service_role;
