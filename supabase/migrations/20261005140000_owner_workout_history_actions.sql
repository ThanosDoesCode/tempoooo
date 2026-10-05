-- Forward migration with retry-safe DDL/grants. No historical rows are changed
-- on application or reapplication.
-- DEFINER is necessary: authenticated has SELECT only on the normalized tables.
-- Keep those grants/RLS unchanged; authorize every operation using both owner links.
-- This private scope is not a caller-controlled GUC. It exists only inside the
-- authorized correction transaction and is removed before that RPC returns.
CREATE TABLE IF NOT EXISTS private.bulk_completed_set_corrections (
  transaction_id bigint NOT NULL,
  set_id uuid NOT NULL,
  caller uuid NOT NULL,
  PRIMARY KEY (transaction_id, set_id)
);
REVOKE ALL ON private.bulk_completed_set_corrections FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION private.validate_bulk_training_session_set()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $function$
DECLARE
  exercise public.bulk_training_session_exercises;
  session_status text;
BEGIN
  SELECT e.* INTO exercise FROM public.bulk_training_session_exercises e
  WHERE e.id = NEW.session_exercise_id;
  IF exercise.id IS NULL THEN RAISE EXCEPTION 'Workout exercise not found'; END IF;
  SELECT s.status INTO session_status FROM public.bulk_training_sessions s WHERE s.id=exercise.session_id;
  IF session_status <> 'in_progress' AND NOT (
    TG_OP='UPDATE' AND session_status='completed'
    AND NEW.id=OLD.id AND NEW.session_exercise_id=OLD.session_exercise_id
    AND NEW.set_order=OLD.set_order AND NEW.is_extra=OLD.is_extra
    AND EXISTS (
      SELECT 1 FROM private.bulk_completed_set_corrections scope
      WHERE scope.transaction_id=pg_catalog.txid_current()
        AND scope.set_id=NEW.id AND scope.caller=(SELECT auth.uid())
    )
  ) THEN RAISE EXCEPTION 'Completed workouts cannot be changed'; END IF;
  -- Original validation/completion behavior is unchanged for active workouts.
  IF exercise.execution_mode='bilateral' THEN
    IF NEW.left_weight IS NOT NULL OR NEW.left_reps IS NOT NULL OR
       NEW.right_weight IS NOT NULL OR NEW.right_reps IS NOT NULL THEN
      RAISE EXCEPTION 'Bilateral sets cannot contain left or right values';
    END IF;
    NEW.is_complete := NEW.bilateral_reps IS NOT NULL AND
      (exercise.is_bodyweight OR NEW.bilateral_weight IS NOT NULL);
  ELSE
    IF NEW.bilateral_weight IS NOT NULL OR NEW.bilateral_reps IS NOT NULL THEN
      RAISE EXCEPTION 'Unilateral sets cannot contain bilateral values';
    END IF;
    NEW.is_complete := NEW.left_reps IS NOT NULL AND NEW.right_reps IS NOT NULL AND
      (exercise.is_bodyweight OR (NEW.left_weight IS NOT NULL AND NEW.right_weight IS NOT NULL));
  END IF;
  NEW.updated_at := now();
  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.correct_completed_bulk_training_set(
  _session uuid, _set uuid,
  _bilateral_weight numeric, _bilateral_reps integer,
  _left_weight numeric, _left_reps integer, _right_weight numeric, _right_reps integer,
  _set_type text, _rpe numeric
)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $function$
DECLARE caller uuid := (SELECT auth.uid()); result_id uuid; complete boolean;
BEGIN
  IF caller IS NULL THEN RAISE EXCEPTION 'Authentication required' USING ERRCODE='42501'; END IF;
  IF _set_type IS NULL OR _set_type NOT IN ('normal','warmup','failure','drop') THEN
    RAISE EXCEPTION 'Invalid set type' USING ERRCODE='22023';
  END IF;
  IF _rpe IS NOT NULL AND (_rpe<6 OR _rpe>10 OR _rpe*2<>trunc(_rpe*2)) THEN
    RAISE EXCEPTION 'RPE must be between 6 and 10 in half-point steps' USING ERRCODE='22023';
  END IF;
  PERFORM 1 FROM public.bulk_training_sessions s
  JOIN public.bulk_profiles p ON p.id=s.bulk_profile_id
  JOIN public.bulk_members m ON m.bulk_profile_id=p.id
  WHERE s.id=_session AND s.status='completed'
    AND p.owner_id=caller AND m.user_id=caller AND m.role='owner'
  FOR UPDATE OF s;
  IF NOT FOUND THEN RAISE EXCEPTION 'Completed workout not found' USING ERRCODE='42501'; END IF;
  PERFORM 1 FROM public.bulk_training_session_sets ss
  JOIN public.bulk_training_session_exercises e ON e.id=ss.session_exercise_id
  WHERE ss.id=_set AND e.session_id=_session;
  IF NOT FOUND THEN RAISE EXCEPTION 'Workout set not found' USING ERRCODE='22023'; END IF;
  INSERT INTO private.bulk_completed_set_corrections VALUES (pg_catalog.txid_current(),_set,caller);
  UPDATE public.bulk_training_session_sets SET
    bilateral_weight=_bilateral_weight, bilateral_reps=_bilateral_reps,
    left_weight=_left_weight, left_reps=_left_reps,
    right_weight=_right_weight, right_reps=_right_reps,
    set_type=_set_type, rpe=_rpe
  WHERE id=_set RETURNING id,is_complete INTO result_id,complete;
  IF NOT complete THEN RAISE EXCEPTION 'A historical set needs complete reps and load' USING ERRCODE='22023'; END IF;
  DELETE FROM private.bulk_completed_set_corrections
  WHERE transaction_id=pg_catalog.txid_current() AND set_id=_set;
  UPDATE public.bulk_training_sessions SET updated_at=now() WHERE id=_session;
  RETURN result_id;
END;
$function$;

CREATE OR REPLACE FUNCTION public.correct_completed_bulk_training_time(
  _session uuid, _workout_date date, _started_at timestamptz,
  _completed_at timestamptz, _timezone text
)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $function$
DECLARE caller uuid := (SELECT auth.uid());
BEGIN
  IF caller IS NULL THEN RAISE EXCEPTION 'Authentication required' USING ERRCODE='42501'; END IF;
  IF _timezone IS NULL OR NOT EXISTS (SELECT 1 FROM pg_catalog.pg_timezone_names WHERE name=_timezone) THEN
    RAISE EXCEPTION 'Invalid timezone' USING ERRCODE='22023';
  END IF;
  IF _workout_date IS NULL OR _started_at IS NULL OR _completed_at IS NULL
    OR NOT isfinite(_started_at) OR NOT isfinite(_completed_at) OR _completed_at<=_started_at THEN
    RAISE EXCEPTION 'End time must be after start time' USING ERRCODE='22023';
  END IF;
  IF (_started_at AT TIME ZONE _timezone)::date<>_workout_date THEN
    RAISE EXCEPTION 'Workout date must match the local start date' USING ERRCODE='22023';
  END IF;
  PERFORM 1 FROM public.bulk_training_sessions s
  JOIN public.bulk_profiles p ON p.id=s.bulk_profile_id
  JOIN public.bulk_members m ON m.bulk_profile_id=p.id
  WHERE s.id=_session AND s.status='completed'
    AND p.owner_id=caller AND m.user_id=caller AND m.role='owner'
  FOR UPDATE OF s;
  IF NOT FOUND THEN RAISE EXCEPTION 'Completed workout not found' USING ERRCODE='42501'; END IF;
  UPDATE public.bulk_training_sessions
  SET workout_date=_workout_date,started_at=_started_at,completed_at=_completed_at,updated_at=now()
  WHERE id=_session;
  -- Preserve the historical bodyweight snapshot; never guess/recalculate it.
  RETURN _session;
END;
$function$;

CREATE OR REPLACE FUNCTION public.repeat_completed_bulk_training_session(_session uuid, _workout_date date)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $function$
DECLARE
  caller uuid := (SELECT auth.uid()); source public.bulk_training_sessions;
  result_id uuid; exercise public.bulk_training_session_exercises; exercise_id uuid;
BEGIN
  IF caller IS NULL THEN RAISE EXCEPTION 'Authentication required' USING ERRCODE='42501'; END IF;
  IF _workout_date IS NULL OR _workout_date<CURRENT_DATE-1 OR _workout_date>CURRENT_DATE+1 THEN
    RAISE EXCEPTION 'Invalid local workout date' USING ERRCODE='22023';
  END IF;
  SELECT s.* INTO source FROM public.bulk_training_sessions s
  JOIN public.bulk_profiles p ON p.id=s.bulk_profile_id
  JOIN public.bulk_members m ON m.bulk_profile_id=p.id
  WHERE s.id=_session AND s.status='completed'
    AND p.owner_id=caller AND m.user_id=caller AND m.role='owner'
  FOR SHARE OF s;
  IF source.id IS NULL THEN RAISE EXCEPTION 'Completed workout not found' USING ERRCODE='42501'; END IF;
  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(source.bulk_profile_id::text || ':active-workout',0)
  );
  IF EXISTS (SELECT 1 FROM public.bulk_training_sessions WHERE bulk_profile_id=source.bulk_profile_id AND status='in_progress') OR
    EXISTS (SELECT 1 FROM public.bulk_workouts WHERE bulk_profile_id=source.bulk_profile_id AND payload->>'status'='draft') THEN
    RAISE EXCEPTION 'Finish or discard your active workout before repeating this workout'
      USING ERRCODE='55000', DETAIL='active_workout_exists';
  END IF;
  INSERT INTO public.bulk_training_sessions(
    bulk_profile_id,training_plan_id,source_plan_day_id,plan_name_snapshot,
    workout_day_name_snapshot,workout_day_order_snapshot,workout_date,bodyweight_kg
  ) VALUES (
    source.bulk_profile_id,source.training_plan_id,source.source_plan_day_id,source.plan_name_snapshot,
    source.workout_day_name_snapshot,source.workout_day_order_snapshot,_workout_date,
    (SELECT weight_kg FROM public.bulk_weight_entries WHERE bulk_profile_id=source.bulk_profile_id
      AND log_date<=_workout_date ORDER BY log_date DESC LIMIT 1)
  ) RETURNING id INTO result_id;
  FOR exercise IN SELECT * FROM public.bulk_training_session_exercises WHERE session_id=source.id ORDER BY exercise_order LOOP
    INSERT INTO public.bulk_training_session_exercises(
      session_id,source_plan_exercise_id,source_exercise_id,exercise_name_snapshot,
      exercise_order,execution_mode,is_bodyweight,target_sets,target_rep_min,target_rep_max,notes_snapshot
    ) VALUES (
      result_id,exercise.source_plan_exercise_id,exercise.source_exercise_id,exercise.exercise_name_snapshot,
      exercise.exercise_order,exercise.execution_mode,exercise.is_bodyweight,
      exercise.target_sets,exercise.target_rep_min,exercise.target_rep_max,exercise.notes_snapshot
    ) RETURNING id INTO exercise_id;
    -- Logged reps/RPE are performances, not prescriptions. Leave them empty so
    -- the unchanged active validator never treats the repeated sets as complete.
    INSERT INTO public.bulk_training_session_sets(
      session_exercise_id,set_order,is_extra,set_type,bilateral_weight,left_weight,right_weight
    ) SELECT exercise_id,set_order,is_extra,set_type,bilateral_weight,left_weight,right_weight
      FROM public.bulk_training_session_sets WHERE session_exercise_id=exercise.id ORDER BY set_order;
  END LOOP;
  RETURN result_id;
END;
$function$;

REVOKE ALL ON FUNCTION public.correct_completed_bulk_training_set(uuid,uuid,numeric,integer,numeric,integer,numeric,integer,text,numeric) FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON FUNCTION public.correct_completed_bulk_training_time(uuid,date,timestamptz,timestamptz,text) FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON FUNCTION public.repeat_completed_bulk_training_session(uuid,date) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.correct_completed_bulk_training_set(uuid,uuid,numeric,integer,numeric,integer,numeric,integer,text,numeric) TO authenticated;
GRANT EXECUTE ON FUNCTION public.correct_completed_bulk_training_time(uuid,date,timestamptz,timestamptz,text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.repeat_completed_bulk_training_session(uuid,date) TO authenticated;

-- Preserved JSON history remains JSON. Correct only this workout row, never
-- the daily nutrition/weight/notes/photos row that shares its calendar date.
CREATE OR REPLACE FUNCTION public.correct_legacy_bulk_workout_time(
  _day date, _workout_date date, _started_at timestamptz, _completed_at timestamptz, _timezone text
)
RETURNS date LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $function$
DECLARE caller uuid := (SELECT auth.uid()); profile_id uuid; row_id uuid;
BEGIN
  IF caller IS NULL THEN RAISE EXCEPTION 'Authentication required' USING ERRCODE='42501'; END IF;
  IF _timezone IS NULL OR NOT EXISTS (SELECT 1 FROM pg_catalog.pg_timezone_names WHERE name=_timezone) THEN
    RAISE EXCEPTION 'Invalid timezone' USING ERRCODE='22023';
  END IF;
  IF _workout_date IS NULL OR _started_at IS NULL OR _completed_at IS NULL
    OR NOT isfinite(_started_at) OR NOT isfinite(_completed_at) OR _completed_at<=_started_at THEN
    RAISE EXCEPTION 'End time must be after start time' USING ERRCODE='22023';
  END IF;
  IF (_started_at AT TIME ZONE _timezone)::date<>_workout_date THEN
    RAISE EXCEPTION 'Workout date must match the local start date' USING ERRCODE='22023';
  END IF;
  SELECT w.id,w.bulk_profile_id INTO row_id,profile_id FROM public.bulk_workouts w
  JOIN public.bulk_profiles p ON p.id=w.bulk_profile_id
  JOIN public.bulk_members m ON m.bulk_profile_id=p.id
  WHERE w.bulk_profile_id=private.current_bulk_profile() AND w.day=_day
    AND (w.payload->>'status'='completed' OR w.payload->>'status' IS NULL)
    AND p.owner_id=caller AND m.user_id=caller AND m.role='owner'
  FOR UPDATE OF w;
  IF row_id IS NULL THEN RAISE EXCEPTION 'Completed workout not found' USING ERRCODE='42501'; END IF;
  IF _day<>_workout_date AND EXISTS (SELECT 1 FROM public.bulk_workouts WHERE bulk_profile_id=profile_id AND day=_workout_date) THEN
    RAISE EXCEPTION 'That date already has a workout; choose another date' USING ERRCODE='23505';
  END IF;
  UPDATE public.bulk_workouts SET day=_workout_date,
    payload=payload || jsonb_build_object('date',_workout_date,'startedAt',_started_at,'completedAt',_completed_at,
      'durationSeconds',extract(epoch FROM (_completed_at-_started_at)),
      'durationOverrideSeconds',extract(epoch FROM (_completed_at-_started_at)))
  WHERE id=row_id;
  RETURN _workout_date;
END;
$function$;

-- Repeating JSON history creates a normalized template, not a history migration.
-- Rep targets come from the actual saved reps, not guessed historical prescriptions.
CREATE OR REPLACE FUNCTION public.repeat_legacy_bulk_workout(_day date, _workout_date date)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $function$
DECLARE
  caller uuid := (SELECT auth.uid()); source public.bulk_workouts;
  result_id uuid; exercise_id uuid; entry jsonb; position integer:=0;
  reps integer[]; load numeric; bw boolean; library_id text;
BEGIN
  IF caller IS NULL THEN RAISE EXCEPTION 'Authentication required' USING ERRCODE='42501'; END IF;
  IF _workout_date IS NULL OR _workout_date<CURRENT_DATE-1 OR _workout_date>CURRENT_DATE+1 THEN
    RAISE EXCEPTION 'Invalid local workout date' USING ERRCODE='22023';
  END IF;
  SELECT w.* INTO source FROM public.bulk_workouts w
  JOIN public.bulk_profiles p ON p.id=w.bulk_profile_id
  JOIN public.bulk_members m ON m.bulk_profile_id=p.id
  WHERE w.bulk_profile_id=private.current_bulk_profile() AND w.day=_day
    AND (w.payload->>'status'='completed' OR w.payload->>'status' IS NULL)
    AND p.owner_id=caller AND m.user_id=caller AND m.role='owner'
  FOR SHARE OF w;
  IF source.id IS NULL THEN RAISE EXCEPTION 'Completed workout not found' USING ERRCODE='42501'; END IF;
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(source.bulk_profile_id::text || ':active-workout',0));
  IF EXISTS (SELECT 1 FROM public.bulk_training_sessions WHERE bulk_profile_id=source.bulk_profile_id AND status='in_progress') OR
    EXISTS (SELECT 1 FROM public.bulk_workouts WHERE bulk_profile_id=source.bulk_profile_id AND payload->>'status'='draft') THEN
    RAISE EXCEPTION 'Finish or discard your active workout before repeating this workout' USING ERRCODE='55000',DETAIL='active_workout_exists';
  END IF;
  INSERT INTO public.bulk_training_sessions(bulk_profile_id,plan_name_snapshot,workout_day_name_snapshot,
    workout_day_order_snapshot,workout_date,bodyweight_kg)
  VALUES (source.bulk_profile_id,'Original Tempo program',source.payload->>'type',
    CASE source.payload->>'type' WHEN 'Legs' THEN 2 WHEN 'Arms & Shoulders' THEN 3 ELSE 1 END,_workout_date,
    (SELECT weight_kg FROM public.bulk_weight_entries WHERE bulk_profile_id=source.bulk_profile_id AND log_date<=_workout_date ORDER BY log_date DESC LIMIT 1))
  RETURNING id INTO result_id;
  FOR entry IN SELECT value FROM jsonb_array_elements(source.payload->'entries') LOOP
    SELECT array_agg(value::integer) INTO reps FROM jsonb_array_elements_text(entry->'reps') WHERE value IS NOT NULL AND value::integer>0;
    IF cardinality(reps) IS NULL THEN CONTINUE; END IF;
    IF jsonb_array_length(entry->'reps')>10 OR (SELECT max(r) FROM unnest(reps) r)>100 THEN
      RAISE EXCEPTION 'This legacy prescription exceeds the normalized plan limits; it has not been changed'
        USING ERRCODE='22023';
    END IF;
    IF entry->>'loadMode'='assisted' OR coalesce((entry->>'assistance')::numeric,0)>0 THEN
      RAISE EXCEPTION 'This legacy assisted workout cannot be repeated in the normalized logger' USING ERRCODE='22023';
    END IF;
    position:=position+1;
    bw := entry->>'bodyweight' IS NOT NULL OR entry->>'loadMode' IN ('bodyweight','added');
    bw := coalesce(bw,false);
    load := CASE WHEN bw THEN coalesce((entry->>'addedWeight')::numeric,0) ELSE (entry->>'weight')::numeric END;
    SELECT id INTO library_id FROM public.bulk_exercises WHERE name=entry->>'exercise'
      AND (is_system OR owner_id=caller) ORDER BY is_system DESC,id LIMIT 1;
    INSERT INTO public.bulk_training_session_exercises(session_id,source_exercise_id,exercise_name_snapshot,
      exercise_order,execution_mode,is_bodyweight,target_sets,target_rep_min,target_rep_max,notes_snapshot)
    VALUES (result_id,library_id,entry->>'exercise',position,'bilateral',bw,
      jsonb_array_length(entry->'reps'),
      (SELECT min(r) FROM unnest(reps) r),
      (SELECT max(r) FROM unnest(reps) r),entry->>'notes')
    RETURNING id INTO exercise_id;
    INSERT INTO public.bulk_training_session_sets(session_exercise_id,set_order,bilateral_weight)
    SELECT exercise_id,n,load FROM pg_catalog.generate_series(1,jsonb_array_length(entry->'reps')) n;
  END LOOP;
  IF position=0 THEN RAISE EXCEPTION 'This workout has no logged exercises' USING ERRCODE='22023'; END IF;
  RETURN result_id;
END;
$function$;
REVOKE ALL ON FUNCTION public.correct_legacy_bulk_workout_time(date,date,timestamptz,timestamptz,text) FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON FUNCTION public.repeat_legacy_bulk_workout(date,date) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.correct_legacy_bulk_workout_time(date,date,timestamptz,timestamptz,text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.repeat_legacy_bulk_workout(date,date) TO authenticated;
