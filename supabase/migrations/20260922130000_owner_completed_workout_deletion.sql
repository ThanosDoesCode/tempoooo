-- Owner-authorized deletion of one completed workout. Snapshot children cascade
-- with the session; plans, exercises, Goal data and all unrelated history stay.
CREATE FUNCTION public.delete_completed_bulk_training_session(_session uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  caller uuid := (SELECT auth.uid());
  removed uuid;
BEGIN
  IF caller IS NULL OR _session IS NULL THEN RETURN false; END IF;
  PERFORM 1
  FROM public.bulk_training_sessions session
  JOIN public.bulk_members member ON member.bulk_profile_id = session.bulk_profile_id
  JOIN public.bulk_profiles profile ON profile.id = session.bulk_profile_id
  WHERE session.id = _session AND session.status = 'completed'
    AND member.user_id = caller AND member.role = 'owner' AND profile.owner_id = caller
  FOR UPDATE OF session;
  IF NOT FOUND THEN RETURN false; END IF;

  DELETE FROM public.bulk_training_sessions
  WHERE id = _session AND status = 'completed'
  RETURNING id INTO removed;
  RETURN removed IS NOT NULL;
END;
$function$;

CREATE FUNCTION public.delete_legacy_bulk_workout(_day date)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  profile_id uuid := private.current_bulk_profile();
  removed uuid;
BEGIN
  IF profile_id IS NULL OR _day IS NULL THEN RETURN false; END IF;
  DELETE FROM public.bulk_workouts
  WHERE bulk_profile_id = profile_id AND day = _day
    AND (payload->>'status' = 'completed' OR payload->>'status' IS NULL)
  RETURNING id INTO removed;
  RETURN removed IS NOT NULL;
END;
$function$;

REVOKE ALL ON FUNCTION public.delete_completed_bulk_training_session(uuid)
  FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.delete_legacy_bulk_workout(date)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.delete_completed_bulk_training_session(uuid)
  TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.delete_legacy_bulk_workout(date)
  TO authenticated, service_role;
