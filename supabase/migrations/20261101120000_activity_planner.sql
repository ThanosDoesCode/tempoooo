-- Activity Planner V1: private, owner-only intentions to do a workout, run or ride on a local calendar
-- date. A planned row is never activity history: Challenge, streak, Endurance, PRs, workout history and
-- weekly consistency never read this table. Completion is derived at read time from the optional link
-- to a REAL completed workout session or saved Challenge activity; links are SET NULL when that
-- history is deleted, so a planned row can never hold a fake completed state and never cascades into
-- fitness history (no existing table references planned_activities).
--
-- Reads: owner SELECT through private.can_read_bulk. Writes: SECURITY DEFINER RPCs only, scoped to the
-- caller's own active public fitness profile (Planner is full-fitness only; core accounts have none).

CREATE TABLE public.planned_activities (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  bulk_profile_id uuid NOT NULL REFERENCES public.bulk_profiles(id) ON DELETE CASCADE,
  activity_type text NOT NULL CHECK (activity_type IN ('workout','run','ride')),
  -- The user's local calendar date; never derived from a UTC timestamp.
  planned_date date NOT NULL,
  planned_time time(0) without time zone,
  workout_source_type text CHECK (workout_source_type IN ('plan_day','my_workout')),
  training_plan_day_id uuid REFERENCES public.bulk_training_plan_days(id) ON DELETE SET NULL,
  workout_template_id uuid REFERENCES public.workout_templates(id) ON DELETE SET NULL,
  -- Presentation snapshot so a changed/deleted source never makes the row unreadable.
  workout_name_snapshot text CHECK (
    workout_name_snapshot IS NULL OR char_length(btrim(workout_name_snapshot)) BETWEEN 1 AND 80),
  exercise_count_snapshot integer CHECK (
    exercise_count_snapshot IS NULL OR exercise_count_snapshot BETWEEN 0 AND 50),
  -- Raw planned distance (a Ride stays raw km; no Challenge conversion at planning time).
  planned_distance_km numeric(7,2) CHECK (
    planned_distance_km IS NULL OR (planned_distance_km > 0 AND planned_distance_km <= 1000)),
  planned_duration_seconds integer CHECK (
    planned_duration_seconds IS NULL OR planned_duration_seconds BETWEEN 60 AND 86400),
  note text CHECK (note IS NULL OR char_length(note) BETWEEN 1 AND 200),
  workout_session_id uuid REFERENCES public.bulk_training_sessions(id) ON DELETE SET NULL,
  challenge_activity_id uuid REFERENCES public.challenge_activities(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT planned_activities_shape_ck CHECK (
    (activity_type = 'workout'
      AND workout_source_type IS NOT NULL
      AND workout_name_snapshot IS NOT NULL
      AND (workout_source_type = 'plan_day' OR training_plan_day_id IS NULL)
      AND (workout_source_type = 'my_workout' OR workout_template_id IS NULL)
      AND planned_distance_km IS NULL
      AND planned_duration_seconds IS NULL
      AND challenge_activity_id IS NULL)
    OR
    (activity_type IN ('run','ride')
      AND workout_source_type IS NULL
      AND training_plan_day_id IS NULL
      AND workout_template_id IS NULL
      AND workout_name_snapshot IS NULL
      AND exercise_count_snapshot IS NULL
      AND workout_session_id IS NULL)
  )
);

CREATE INDEX planned_activities_profile_date_idx
  ON public.planned_activities(bulk_profile_id, planned_date, planned_time, id);
-- One planner row per real completion record.
CREATE UNIQUE INDEX planned_activities_session_uidx
  ON public.planned_activities(workout_session_id) WHERE workout_session_id IS NOT NULL;
CREATE UNIQUE INDEX planned_activities_challenge_activity_uidx
  ON public.planned_activities(challenge_activity_id) WHERE challenge_activity_id IS NOT NULL;

ALTER TABLE public.planned_activities ENABLE ROW LEVEL SECURITY;

CREATE POLICY "planned activities owner read" ON public.planned_activities
FOR SELECT TO authenticated
USING (private.can_read_bulk(bulk_profile_id));

-- authenticated: SELECT only (RPC-only writes). anon: nothing. service_role: administrative.
REVOKE ALL ON public.planned_activities FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.planned_activities TO authenticated;
GRANT ALL ON public.planned_activities TO service_role;

-- ---------------------------------------------------------------- helpers
-- The caller's own ACTIVE PUBLIC fitness profile (owner membership), or NULL.
CREATE FUNCTION private.planner_profile()
RETURNS uuid
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ''
AS $function$
  SELECT p.id
  FROM public.bulk_profiles p
  JOIN public.bulk_members m ON m.bulk_profile_id = p.id
  WHERE p.owner_id = (SELECT auth.uid())
    AND m.user_id = (SELECT auth.uid())
    AND m.role = 'owner'
    AND p.goal_status IS NOT NULL
    AND p.goal_status <> 'inactive'
  ORDER BY p.id
  LIMIT 1
$function$;

REVOKE ALL ON FUNCTION private.planner_profile() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION private.planner_profile() TO service_role;

-- Validates shared fields and resolves the workout snapshot from the caller's OWN source.
CREATE FUNCTION private.planner_fields(
  _profile uuid,
  _activity_type text,
  _planned_date date,
  _workout_source_type text,
  _training_plan_day_id uuid,
  _workout_template_id uuid,
  _distance_km numeric,
  _duration_seconds integer,
  _note text
)
RETURNS TABLE(workout_name text, exercise_count integer, distance_km numeric, note text)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = ''
AS $function$
DECLARE
  clean_note text := nullif(btrim(coalesce(_note, '')), '');
BEGIN
  IF _activity_type IS NULL OR _activity_type NOT IN ('workout','run','ride') THEN
    RAISE EXCEPTION 'Choose a workout, run or ride';
  END IF;
  IF _planned_date IS NULL THEN RAISE EXCEPTION 'Choose a date'; END IF;
  IF _planned_date < CURRENT_DATE - 366 OR _planned_date > CURRENT_DATE + 731 THEN
    RAISE EXCEPTION 'Choose a date within the next two years';
  END IF;
  IF clean_note IS NOT NULL AND char_length(clean_note) > 200 THEN
    RAISE EXCEPTION 'Note must be 200 characters or fewer';
  END IF;

  IF _activity_type = 'workout' THEN
    IF _distance_km IS NOT NULL OR _duration_seconds IS NOT NULL THEN
      RAISE EXCEPTION 'Workouts do not take a distance or duration';
    END IF;
    IF _workout_source_type = 'plan_day' AND _training_plan_day_id IS NOT NULL
       AND _workout_template_id IS NULL THEN
      RETURN QUERY
      SELECT d.name, (SELECT count(*)::integer FROM public.bulk_training_plan_exercises e
                      WHERE e.plan_day_id = d.id), NULL::numeric, clean_note
      FROM public.bulk_training_plan_days d
      JOIN public.bulk_training_plans p ON p.id = d.plan_id
      WHERE d.id = _training_plan_day_id AND p.bulk_profile_id = _profile AND p.active;
      IF NOT FOUND THEN RAISE EXCEPTION 'Workout day not found in your current plan'; END IF;
      RETURN;
    ELSIF _workout_source_type = 'my_workout' AND _workout_template_id IS NOT NULL
       AND _training_plan_day_id IS NULL THEN
      RETURN QUERY
      SELECT t.title, (SELECT count(*)::integer FROM public.workout_template_exercises e
                       WHERE e.workout_template_id = t.id), NULL::numeric, clean_note
      FROM public.workout_templates t
      WHERE t.id = _workout_template_id AND t.bulk_profile_id = _profile
        AND NOT t.is_system AND t.visibility = 'private';
      IF NOT FOUND THEN RAISE EXCEPTION 'Workout not found in My Workouts'; END IF;
      RETURN;
    END IF;
    RAISE EXCEPTION 'Choose a workout';
  END IF;

  IF _workout_source_type IS NOT NULL OR _training_plan_day_id IS NOT NULL
     OR _workout_template_id IS NOT NULL THEN
    RAISE EXCEPTION 'Runs and rides do not take a workout';
  END IF;
  IF _distance_km IS NOT NULL AND (_distance_km < 0.01 OR _distance_km > 1000) THEN
    RAISE EXCEPTION 'Distance must be between 0.01 and 1000 km';
  END IF;
  IF _duration_seconds IS NOT NULL AND (_duration_seconds < 60 OR _duration_seconds > 86400) THEN
    RAISE EXCEPTION 'Duration must be between 1 minute and 24 hours';
  END IF;
  RETURN QUERY SELECT NULL::text, NULL::integer, round(_distance_km, 2), clean_note;
END;
$function$;

REVOKE ALL ON FUNCTION private.planner_fields(uuid, text, date, text, uuid, uuid, numeric, integer, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION private.planner_fields(uuid, text, date, text, uuid, uuid, numeric, integer, text)
  TO service_role;

-- ---------------------------------------------------------------- create (idempotent by request id)
CREATE FUNCTION public.create_planned_activity(
  _request_id uuid,
  _activity_type text,
  _planned_date date,
  _planned_time time DEFAULT NULL,
  _workout_source_type text DEFAULT NULL,
  _training_plan_day_id uuid DEFAULT NULL,
  _workout_template_id uuid DEFAULT NULL,
  _distance_km numeric DEFAULT NULL,
  _duration_seconds integer DEFAULT NULL,
  _note text DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $function$
DECLARE
  profile_id uuid;
  fields record;
  result_id uuid;
BEGIN
  IF (SELECT auth.uid()) IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  IF _request_id IS NULL THEN RAISE EXCEPTION 'Request id required'; END IF;
  profile_id := private.planner_profile();
  IF profile_id IS NULL THEN RAISE EXCEPTION 'Active fitness profile required'; END IF;

  -- A retried request returns the row it already created; another owner's id is never reused.
  SELECT id INTO result_id FROM public.planned_activities WHERE id = _request_id;
  IF result_id IS NOT NULL THEN
    IF NOT EXISTS (SELECT 1 FROM public.planned_activities
                   WHERE id = _request_id AND bulk_profile_id = profile_id) THEN
      RAISE EXCEPTION 'Planned activity not found';
    END IF;
    RETURN result_id;
  END IF;

  SELECT * INTO fields FROM private.planner_fields(profile_id, _activity_type, _planned_date,
    _workout_source_type, _training_plan_day_id, _workout_template_id, _distance_km,
    _duration_seconds, _note);

  INSERT INTO public.planned_activities(
    id, bulk_profile_id, activity_type, planned_date, planned_time, workout_source_type,
    training_plan_day_id, workout_template_id, workout_name_snapshot, exercise_count_snapshot,
    planned_distance_km, planned_duration_seconds, note)
  VALUES (
    _request_id, profile_id, _activity_type, _planned_date, _planned_time,
    CASE WHEN _activity_type = 'workout' THEN _workout_source_type END,
    CASE WHEN _activity_type = 'workout' THEN _training_plan_day_id END,
    CASE WHEN _activity_type = 'workout' THEN _workout_template_id END,
    fields.workout_name, fields.exercise_count, fields.distance_km,
    CASE WHEN _activity_type <> 'workout' THEN _duration_seconds END, fields.note)
  RETURNING id INTO result_id;
  RETURN result_id;
END;
$function$;

-- ---------------------------------------------------------------- edit (type is fixed; stale-safe)
CREATE FUNCTION public.update_planned_activity(
  _id uuid,
  _expected_updated_at timestamptz,
  _planned_date date,
  _planned_time time DEFAULT NULL,
  _workout_source_type text DEFAULT NULL,
  _training_plan_day_id uuid DEFAULT NULL,
  _workout_template_id uuid DEFAULT NULL,
  _distance_km numeric DEFAULT NULL,
  _duration_seconds integer DEFAULT NULL,
  _note text DEFAULT NULL
)
RETURNS timestamptz
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $function$
DECLARE
  profile_id uuid;
  current_row public.planned_activities%ROWTYPE;
  snap_name text;
  snap_count integer;
  clean_distance numeric;
  clean_note text;
  source_changed boolean;
  result_updated_at timestamptz;
BEGIN
  IF (SELECT auth.uid()) IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  profile_id := private.planner_profile();
  IF profile_id IS NULL THEN RAISE EXCEPTION 'Active fitness profile required'; END IF;
  SELECT * INTO current_row FROM public.planned_activities
  WHERE id = _id AND bulk_profile_id = profile_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Planned activity not found'; END IF;
  IF _expected_updated_at IS NULL OR current_row.updated_at <> _expected_updated_at THEN
    RAISE EXCEPTION 'This planned activity changed elsewhere. Reload and try again.';
  END IF;

  source_changed := current_row.activity_type = 'workout' AND (
    current_row.workout_source_type IS DISTINCT FROM _workout_source_type
    OR current_row.training_plan_day_id IS DISTINCT FROM _training_plan_day_id
    OR current_row.workout_template_id IS DISTINCT FROM _workout_template_id);
  IF current_row.activity_type = 'workout' AND NOT source_changed THEN
    -- Unchanged source keeps its snapshot even if the source itself was later edited or deleted.
    SELECT f.note INTO clean_note FROM private.planner_fields(profile_id, 'run', _planned_date,
      NULL, NULL, NULL, NULL, NULL, _note) f;
    snap_name := current_row.workout_name_snapshot;
    snap_count := current_row.exercise_count_snapshot;
  ELSE
    SELECT f.workout_name, f.exercise_count, f.distance_km, f.note
      INTO snap_name, snap_count, clean_distance, clean_note
    FROM private.planner_fields(profile_id, current_row.activity_type, _planned_date,
      _workout_source_type, _training_plan_day_id, _workout_template_id, _distance_km,
      _duration_seconds, _note) f;
  END IF;

  UPDATE public.planned_activities SET
    planned_date = _planned_date,
    planned_time = _planned_time,
    workout_source_type = CASE WHEN activity_type = 'workout' THEN _workout_source_type END,
    training_plan_day_id = CASE WHEN activity_type = 'workout' THEN _training_plan_day_id END,
    workout_template_id = CASE WHEN activity_type = 'workout' THEN _workout_template_id END,
    workout_name_snapshot = snap_name,
    exercise_count_snapshot = snap_count,
    planned_distance_km = clean_distance,
    planned_duration_seconds = CASE WHEN activity_type <> 'workout' THEN _duration_seconds END,
    note = clean_note,
    -- A different workout is a different intention: an earlier session link no longer applies.
    workout_session_id = CASE WHEN source_changed THEN NULL ELSE workout_session_id END,
    updated_at = greatest(now(), current_row.updated_at + interval '1 microsecond')
  WHERE id = _id
  RETURNING updated_at INTO result_updated_at;
  RETURN result_updated_at;
END;
$function$;

-- ---------------------------------------------------------------- reschedule (date/time only)
CREATE FUNCTION public.reschedule_planned_activity(
  _id uuid,
  _planned_date date,
  _planned_time time DEFAULT NULL
)
RETURNS timestamptz
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $function$
DECLARE
  profile_id uuid;
  result_updated_at timestamptz;
BEGIN
  IF (SELECT auth.uid()) IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  profile_id := private.planner_profile();
  IF profile_id IS NULL THEN RAISE EXCEPTION 'Active fitness profile required'; END IF;
  PERFORM private.planner_fields(profile_id, 'run', _planned_date, NULL, NULL, NULL, NULL, NULL,
    NULL);
  UPDATE public.planned_activities SET
    planned_date = _planned_date,
    planned_time = _planned_time,
    updated_at = greatest(now(), updated_at + interval '1 microsecond')
  WHERE id = _id AND bulk_profile_id = profile_id
  RETURNING updated_at INTO result_updated_at;
  IF result_updated_at IS NULL THEN RAISE EXCEPTION 'Planned activity not found'; END IF;
  RETURN result_updated_at;
END;
$function$;

-- ---------------------------------------------------------------- delete (planner row only)
CREATE FUNCTION public.delete_planned_activity(_id uuid)
RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $function$
DECLARE
  profile_id uuid;
  deleted uuid;
BEGIN
  IF (SELECT auth.uid()) IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  profile_id := private.planner_profile();
  IF profile_id IS NULL THEN RAISE EXCEPTION 'Active fitness profile required'; END IF;
  -- Linked sessions/Challenge activities are referenced FROM here, so they are never touched.
  DELETE FROM public.planned_activities WHERE id = _id AND bulk_profile_id = profile_id
  RETURNING id INTO deleted;
  RETURN deleted IS NOT NULL;
END;
$function$;

-- ---------------------------------------------------------------- completion links
-- Called after the EXISTING start RPC returns a session. Links only the caller's own session for the
-- same plan day and local date; a resumed session for a different day is left unlinked (false).
-- Linking is not completion: completion is the linked session's own status.
CREATE FUNCTION public.link_planned_activity_session(_id uuid, _session uuid)
RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $function$
DECLARE
  profile_id uuid;
  linked uuid;
BEGIN
  IF (SELECT auth.uid()) IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  profile_id := private.planner_profile();
  IF profile_id IS NULL THEN RAISE EXCEPTION 'Active fitness profile required'; END IF;
  UPDATE public.planned_activities a SET
    workout_session_id = s.id,
    updated_at = greatest(now(), a.updated_at + interval '1 microsecond')
  FROM public.bulk_training_sessions s
  WHERE a.id = _id
    AND a.bulk_profile_id = profile_id
    AND a.activity_type = 'workout'
    AND a.workout_source_type = 'plan_day'
    AND a.training_plan_day_id IS NOT NULL
    AND a.workout_session_id IS NULL
    AND s.id = _session
    AND s.bulk_profile_id = profile_id
    AND s.source_plan_day_id = a.training_plan_day_id
    AND s.workout_date = a.planned_date
    AND NOT EXISTS (SELECT 1 FROM public.planned_activities o WHERE o.workout_session_id = s.id)
  RETURNING a.id INTO linked;
  RETURN linked IS NOT NULL;
END;
$function$;

-- Called only after the EXISTING Challenge save succeeded. The activity must be the caller's own and
-- of the same kind (ride = cycle). Its distance/qualification stay authoritative in the Challenge.
CREATE FUNCTION public.link_planned_activity_challenge_activity(_id uuid, _activity uuid)
RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $function$
DECLARE
  profile_id uuid;
  linked uuid;
BEGIN
  IF (SELECT auth.uid()) IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  profile_id := private.planner_profile();
  IF profile_id IS NULL THEN RAISE EXCEPTION 'Active fitness profile required'; END IF;
  UPDATE public.planned_activities a SET
    challenge_activity_id = c.id,
    updated_at = greatest(now(), a.updated_at + interval '1 microsecond')
  FROM public.challenge_activities c
  WHERE a.id = _id
    AND a.bulk_profile_id = profile_id
    AND a.activity_type IN ('run','ride')
    AND a.challenge_activity_id IS NULL
    AND c.id = _activity
    AND c.user_id = (SELECT auth.uid())
    AND c.activity_type::text = CASE a.activity_type WHEN 'ride' THEN 'cycle' ELSE 'run' END
    AND NOT EXISTS (SELECT 1 FROM public.planned_activities o WHERE o.challenge_activity_id = c.id)
  RETURNING a.id INTO linked;
  RETURN linked IS NOT NULL;
END;
$function$;

-- ---------------------------------------------------------------- Today's upcoming read
-- The next unresolved items from a local date, capped server-side AFTER excluding completed rows so
-- completed items can never consume the limit. "Completed" is the same read-derived rule the client
-- uses: a linked Challenge activity, or a linked session whose own status is completed. SECURITY
-- INVOKER: planned_activities and bulk_training_sessions RLS still apply to the caller.
CREATE FUNCTION public.planner_upcoming(_profile uuid, _from date, _limit integer DEFAULT 3)
RETURNS SETOF public.planned_activities
LANGUAGE sql STABLE SECURITY INVOKER SET search_path = ''
AS $function$
  SELECT a.*
  FROM public.planned_activities a
  WHERE a.bulk_profile_id = _profile
    AND a.planned_date >= _from
    AND a.challenge_activity_id IS NULL
    AND NOT EXISTS (
      SELECT 1 FROM public.bulk_training_sessions s
      WHERE s.id = a.workout_session_id AND s.status = 'completed')
  ORDER BY a.planned_date, a.planned_time NULLS LAST, a.id
  LIMIT least(greatest(coalesce(_limit, 3), 1), 10)
$function$;

REVOKE ALL ON FUNCTION public.create_planned_activity(uuid, text, date, time, text, uuid, uuid, numeric, integer, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.update_planned_activity(uuid, timestamptz, date, time, text, uuid, uuid, numeric, integer, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.reschedule_planned_activity(uuid, date, time) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.delete_planned_activity(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.link_planned_activity_session(uuid, uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.link_planned_activity_challenge_activity(uuid, uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.planner_upcoming(uuid, date, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_planned_activity(uuid, text, date, time, text, uuid, uuid, numeric, integer, text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.update_planned_activity(uuid, timestamptz, date, time, text, uuid, uuid, numeric, integer, text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.reschedule_planned_activity(uuid, date, time) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.delete_planned_activity(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.link_planned_activity_session(uuid, uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.link_planned_activity_challenge_activity(uuid, uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.planner_upcoming(uuid, date, integer) TO authenticated, service_role;
