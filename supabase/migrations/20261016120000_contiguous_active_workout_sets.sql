-- Preserve set UUIDs and metadata while keeping active exercise order contiguous.
-- No data is changed on migration application. Existing active gaps are repaired
-- on the next add/delete; completed snapshots and all other exercises are untouched.
-- Both mutations retain the session FOR UPDATE lock shared with autosave/finish.
-- Add also compacts old sparse orders so the 20-set limit counts actual rows.
-- Authenticated clients have SELECT only: normalization must happen inside these
-- existing authorized RPCs, not via client-side renumbering or delete/recreation.

CREATE OR REPLACE FUNCTION public.add_bulk_training_session_set(_session uuid, _exercise uuid)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $function$
DECLARE caller uuid := (SELECT auth.uid()); result_id uuid; next_order integer := 1; remaining_set record;
BEGIN
  IF caller IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  PERFORM 1 FROM public.bulk_training_sessions s
  JOIN public.bulk_members m ON m.bulk_profile_id=s.bulk_profile_id
  WHERE s.id=_session AND s.status='in_progress' AND m.user_id=caller AND m.role='owner'
  FOR UPDATE OF s;
  IF NOT FOUND THEN RAISE EXCEPTION 'Active workout not found'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.bulk_training_session_exercises e WHERE e.id=_exercise AND e.session_id=_session)
    THEN RAISE EXCEPTION 'Workout exercise not found'; END IF;
  IF (SELECT count(*) FROM public.bulk_training_session_sets WHERE session_exercise_id=_exercise) >= 20 THEN RAISE EXCEPTION 'A workout exercise can contain up to 20 sets'; END IF;
  -- Compact in ascending old order: every destination is vacant (or unchanged),
  -- so the immediate UNIQUE(exercise, set_order) and 1..20 CHECK remain valid.
  -- Update only the order on the same UUID; values/type/RPE stay on their row.
  FOR remaining_set IN
    SELECT id,set_order FROM public.bulk_training_session_sets
    WHERE session_exercise_id=_exercise ORDER BY set_order
  LOOP
    IF remaining_set.set_order <> next_order THEN
      UPDATE public.bulk_training_session_sets SET set_order=next_order WHERE id=remaining_set.id;
    END IF;
    next_order := next_order + 1;
  END LOOP;
  INSERT INTO public.bulk_training_session_sets(session_exercise_id,set_order,is_extra)
  VALUES(_exercise,next_order,true) RETURNING id INTO result_id;
  UPDATE public.bulk_training_sessions SET updated_at=now() WHERE id=_session;
  RETURN result_id;
END;
$function$;

CREATE OR REPLACE FUNCTION public.remove_bulk_training_session_set(_session uuid, _set uuid)
RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $function$
DECLARE caller uuid := (SELECT auth.uid()); removed uuid; exercise_id uuid; next_order integer := 1; remaining_set record;
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
  -- Compact in ascending old order: every destination is vacant (or unchanged),
  -- so the immediate UNIQUE(exercise, set_order) and 1..20 CHECK remain valid.
  -- Update only the order on the same UUID; values/type/RPE stay on their row.
  FOR remaining_set IN
    SELECT id,set_order FROM public.bulk_training_session_sets
    WHERE session_exercise_id=exercise_id ORDER BY set_order
  LOOP
    IF remaining_set.set_order <> next_order THEN
      UPDATE public.bulk_training_session_sets SET set_order=next_order WHERE id=remaining_set.id;
    END IF;
    next_order := next_order + 1;
  END LOOP;
  UPDATE public.bulk_training_sessions SET updated_at = now() WHERE id = _session;
  RETURN true;
END;
$function$;

REVOKE ALL ON FUNCTION public.add_bulk_training_session_set(uuid, uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.remove_bulk_training_session_set(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.add_bulk_training_session_set(uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.remove_bulk_training_session_set(uuid, uuid) TO authenticated, service_role;
