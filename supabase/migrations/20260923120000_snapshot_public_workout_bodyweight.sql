-- Snapshot the public Goal bodyweight used by normalized workout sessions.
-- Existing sessions receive a structural date derived in UTC because their original
-- local calendar date was not stored. That approximation can differ from the date the
-- athlete saw locally. Existing completed sessions deliberately keep bodyweight_kg
-- NULL so the approximation never fabricates historical effective load or volume.
ALTER TABLE public.bulk_training_sessions
  ADD COLUMN workout_date date,
  ADD COLUMN bodyweight_kg numeric(6,2),
  ADD CONSTRAINT bulk_training_sessions_bodyweight_ck
    CHECK (bodyweight_kg IS NULL OR bodyweight_kg BETWEEN 20 AND 400);

UPDATE public.bulk_training_sessions
SET workout_date = (started_at AT TIME ZONE 'UTC')::date
WHERE workout_date IS NULL;

ALTER TABLE public.bulk_training_sessions
  ALTER COLUMN workout_date SET DEFAULT CURRENT_DATE,
  ALTER COLUMN workout_date SET NOT NULL;

CREATE FUNCTION public.refresh_active_bulk_training_bodyweight(_profile uuid)
RETURNS numeric
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $function$
DECLARE caller uuid := (SELECT auth.uid()); snapshot numeric;
BEGIN
  IF caller IS NULL OR _profile IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  IF NOT EXISTS (
    SELECT 1
    FROM public.bulk_members m
    JOIN public.bulk_profiles p ON p.id=m.bulk_profile_id
    WHERE m.bulk_profile_id=_profile AND m.user_id=caller AND m.role='owner'
      AND p.owner_id=caller
  ) THEN RAISE EXCEPTION 'Goal profile not found'; END IF;

  UPDATE public.bulk_training_sessions s
  SET bodyweight_kg=(
        SELECT w.weight_kg
        FROM public.bulk_weight_entries w
        WHERE w.bulk_profile_id=s.bulk_profile_id AND w.log_date<=s.workout_date
        ORDER BY w.log_date DESC,w.updated_at DESC
        LIMIT 1
      ),
      updated_at=now()
  WHERE s.bulk_profile_id=_profile AND s.status='in_progress';

  SELECT s.bodyweight_kg INTO snapshot
  FROM public.bulk_training_sessions s
  WHERE s.bulk_profile_id=_profile AND s.status='in_progress'
  ORDER BY s.workout_date DESC,s.started_at DESC,s.id
  LIMIT 1;
  RETURN snapshot;
END;
$function$;

CREATE FUNCTION public.start_bulk_training_session_for_date(_plan_day uuid,_workout_date date)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $function$
DECLARE
  caller uuid := (SELECT auth.uid());
  result_id uuid;
  profile_id uuid;
  existing_id uuid;
BEGIN
  IF caller IS NULL OR _plan_day IS NULL OR _workout_date IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;
  IF _workout_date<CURRENT_DATE-1 OR _workout_date>CURRENT_DATE+1 THEN
    RAISE EXCEPTION 'Invalid local workout date';
  END IF;

  SELECT p.bulk_profile_id INTO profile_id
  FROM public.bulk_training_plan_days d
  JOIN public.bulk_training_plans p ON p.id=d.plan_id
  JOIN public.bulk_members m ON m.bulk_profile_id=p.bulk_profile_id
  JOIN public.bulk_profiles bp ON bp.id=p.bulk_profile_id
  WHERE d.id=_plan_day AND p.active
    AND m.user_id=caller AND m.role='owner' AND bp.owner_id=caller
  FOR SHARE OF p,d,bp;
  IF profile_id IS NULL THEN RAISE EXCEPTION 'Active workout day not found'; END IF;

  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(profile_id::text || ':active-workout',0)
  );
  SELECT s.id INTO existing_id
  FROM public.bulk_training_sessions s
  WHERE s.bulk_profile_id=profile_id AND s.status='in_progress'
  FOR UPDATE OF s;

  result_id := public.start_bulk_training_session(_plan_day);
  PERFORM 1
  FROM public.bulk_training_sessions s
  JOIN public.bulk_members m ON m.bulk_profile_id=s.bulk_profile_id
  JOIN public.bulk_profiles bp ON bp.id=s.bulk_profile_id
  WHERE s.id=result_id AND s.bulk_profile_id=profile_id AND s.status='in_progress'
    AND m.user_id=caller AND m.role='owner' AND bp.owner_id=caller
  FOR UPDATE OF s;
  IF NOT FOUND THEN RAISE EXCEPTION 'Active workout not found'; END IF;

  -- Resuming preserves the original local workout date and bodyweight snapshot.
  IF existing_id IS NOT NULL THEN RETURN result_id; END IF;

  UPDATE public.bulk_training_sessions s
  SET workout_date=_workout_date,
      bodyweight_kg=(
        SELECT w.weight_kg FROM public.bulk_weight_entries w
        WHERE w.bulk_profile_id=s.bulk_profile_id AND w.log_date<=_workout_date
        ORDER BY w.log_date DESC,w.updated_at DESC LIMIT 1
      ),updated_at=now()
  WHERE s.id=result_id AND s.bulk_profile_id=profile_id AND s.status='in_progress';
  RETURN result_id;
END;
$function$;

REVOKE ALL ON FUNCTION public.refresh_active_bulk_training_bodyweight(uuid) FROM PUBLIC,anon;
REVOKE ALL ON FUNCTION public.start_bulk_training_session_for_date(uuid,date) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.refresh_active_bulk_training_bodyweight(uuid) TO authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.start_bulk_training_session_for_date(uuid,date) TO authenticated,service_role;
