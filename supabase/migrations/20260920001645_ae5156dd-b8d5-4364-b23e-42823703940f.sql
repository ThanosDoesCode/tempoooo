ALTER TABLE public.bulk_training_session_sets
  ADD COLUMN set_type text NOT NULL DEFAULT 'normal',
  ADD COLUMN rpe numeric(3,1),
  ADD CONSTRAINT bulk_training_session_sets_type_ck
    CHECK (set_type IN ('warmup', 'normal', 'failure', 'drop')),
  ADD CONSTRAINT bulk_training_session_sets_rpe_ck
    CHECK (rpe IS NULL OR (rpe BETWEEN 6 AND 10 AND rpe * 2 = trunc(rpe * 2)));

CREATE FUNCTION public.save_bulk_training_session_set_details(
  _session uuid, _set uuid,
  _bilateral_weight numeric, _bilateral_reps integer,
  _left_weight numeric, _left_reps integer,
  _right_weight numeric, _right_reps integer,
  _set_type text, _rpe numeric
)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $function$
DECLARE caller uuid := (SELECT auth.uid()); result_id uuid;
BEGIN
  IF caller IS NULL OR _session IS NULL OR _set IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;
  IF _set_type IS NULL OR _set_type NOT IN ('warmup', 'normal', 'failure', 'drop') THEN
    RAISE EXCEPTION 'Invalid set type';
  END IF;
  IF _rpe IS NOT NULL AND (_rpe < 6 OR _rpe > 10 OR _rpe * 2 <> trunc(_rpe * 2)) THEN
    RAISE EXCEPTION 'RPE must be between 6 and 10 in half-point steps';
  END IF;

  PERFORM 1 FROM public.bulk_training_sessions s
  JOIN public.bulk_members m ON m.bulk_profile_id = s.bulk_profile_id
  WHERE s.id = _session AND s.status = 'in_progress'
    AND m.user_id = caller AND m.role = 'owner'
  FOR UPDATE OF s;
  IF NOT FOUND THEN RAISE EXCEPTION 'Active workout not found'; END IF;

  UPDATE public.bulk_training_session_sets ss SET
    bilateral_weight = _bilateral_weight,
    bilateral_reps = _bilateral_reps,
    left_weight = _left_weight,
    left_reps = _left_reps,
    right_weight = _right_weight,
    right_reps = _right_reps,
    set_type = _set_type,
    rpe = _rpe
  FROM public.bulk_training_session_exercises se
  WHERE ss.id = _set AND ss.session_exercise_id = se.id AND se.session_id = _session
  RETURNING ss.id INTO result_id;
  IF result_id IS NULL THEN RAISE EXCEPTION 'Workout set not found'; END IF;
  UPDATE public.bulk_training_sessions SET updated_at = now() WHERE id = _session;
  RETURN result_id;
END;
$function$;

CREATE OR REPLACE FUNCTION public.remove_bulk_training_session_set(_session uuid, _set uuid)
RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $function$
DECLARE caller uuid := (SELECT auth.uid()); removed uuid; exercise_id uuid;
BEGIN
  IF caller IS NULL OR _session IS NULL OR _set IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;
  PERFORM 1 FROM public.bulk_training_sessions s
  JOIN public.bulk_members m ON m.bulk_profile_id = s.bulk_profile_id
  WHERE s.id = _session AND s.status = 'in_progress'
    AND m.user_id = caller AND m.role = 'owner'
  FOR UPDATE OF s;
  IF NOT FOUND THEN RAISE EXCEPTION 'Active workout not found'; END IF;

  SELECT ss.session_exercise_id INTO exercise_id
  FROM public.bulk_training_session_sets ss
  JOIN public.bulk_training_session_exercises se ON se.id = ss.session_exercise_id
  WHERE ss.id = _set AND se.session_id = _session;
  IF exercise_id IS NULL THEN RAISE EXCEPTION 'Workout set not found'; END IF;
  IF (SELECT count(*) FROM public.bulk_training_session_sets WHERE session_exercise_id = exercise_id) <= 1 THEN
    RAISE EXCEPTION 'An exercise must keep at least one set';
  END IF;

  DELETE FROM public.bulk_training_session_sets WHERE id = _set RETURNING id INTO removed;
  IF removed IS NULL THEN RAISE EXCEPTION 'Workout set not found'; END IF;
  UPDATE public.bulk_training_sessions SET updated_at = now() WHERE id = _session;
  RETURN true;
END;
$function$;

REVOKE ALL ON FUNCTION public.remove_bulk_training_session_set(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.remove_bulk_training_session_set(uuid, uuid) TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.save_bulk_training_session_set_details(
  uuid,uuid,numeric,integer,numeric,integer,numeric,integer,text,numeric
) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.save_bulk_training_session_set_details(
  uuid,uuid,numeric,integer,numeric,integer,numeric,integer,text,numeric
) TO authenticated, service_role;