-- Segment 6: structured, user-owned public Bulk workout sessions.
-- Legacy bulk_workouts JSON history is intentionally untouched.

CREATE TABLE public.bulk_training_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  bulk_profile_id uuid NOT NULL REFERENCES public.bulk_profiles(id) ON DELETE CASCADE,
  training_plan_id uuid REFERENCES public.bulk_training_plans(id) ON DELETE SET NULL,
  source_plan_day_id uuid REFERENCES public.bulk_training_plan_days(id) ON DELETE SET NULL,
  plan_name_snapshot text NOT NULL CHECK (char_length(btrim(plan_name_snapshot)) BETWEEN 2 AND 80),
  workout_day_name_snapshot text NOT NULL CHECK (char_length(btrim(workout_day_name_snapshot)) BETWEEN 1 AND 60),
  workout_day_order_snapshot integer NOT NULL CHECK (workout_day_order_snapshot BETWEEN 1 AND 6),
  status text NOT NULL DEFAULT 'in_progress' CHECK (status IN ('in_progress','completed')),
  started_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT bulk_training_sessions_completion_ck CHECK (
    (status = 'in_progress' AND completed_at IS NULL) OR
    (status = 'completed' AND completed_at IS NOT NULL)
  )
);

CREATE UNIQUE INDEX bulk_training_sessions_one_active_uidx
  ON public.bulk_training_sessions(bulk_profile_id) WHERE status = 'in_progress';
CREATE INDEX bulk_training_sessions_profile_status_idx
  ON public.bulk_training_sessions(bulk_profile_id, status, started_at DESC);
CREATE INDEX bulk_training_sessions_completed_idx
  ON public.bulk_training_sessions(bulk_profile_id, completed_at DESC) WHERE status = 'completed';

CREATE TABLE public.bulk_training_session_exercises (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id uuid NOT NULL REFERENCES public.bulk_training_sessions(id) ON DELETE CASCADE,
  source_plan_exercise_id uuid REFERENCES public.bulk_training_plan_exercises(id) ON DELETE SET NULL,
  source_exercise_id text REFERENCES public.bulk_exercises(id) ON DELETE SET NULL,
  exercise_name_snapshot text NOT NULL CHECK (char_length(btrim(exercise_name_snapshot)) BETWEEN 2 AND 80),
  exercise_order integer NOT NULL CHECK (exercise_order BETWEEN 1 AND 20),
  execution_mode text NOT NULL CHECK (execution_mode IN ('bilateral','unilateral')),
  is_bodyweight boolean NOT NULL,
  target_sets integer NOT NULL CHECK (target_sets BETWEEN 1 AND 10),
  target_rep_min integer NOT NULL CHECK (target_rep_min BETWEEN 1 AND 100),
  target_rep_max integer NOT NULL CHECK (target_rep_max BETWEEN target_rep_min AND 100),
  notes_snapshot text CHECK (notes_snapshot IS NULL OR char_length(notes_snapshot) <= 240),
  UNIQUE(session_id, exercise_order)
);
CREATE INDEX bulk_training_session_exercises_order_idx
  ON public.bulk_training_session_exercises(session_id, exercise_order);

CREATE TABLE public.bulk_training_session_sets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  session_exercise_id uuid NOT NULL REFERENCES public.bulk_training_session_exercises(id) ON DELETE CASCADE,
  set_order integer NOT NULL CHECK (set_order BETWEEN 1 AND 20),
  is_extra boolean NOT NULL DEFAULT false,
  bilateral_weight numeric(7,2),
  bilateral_reps integer,
  left_weight numeric(7,2),
  left_reps integer,
  right_weight numeric(7,2),
  right_reps integer,
  is_complete boolean NOT NULL DEFAULT false,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT bulk_training_session_sets_weights_ck CHECK (
    (bilateral_weight IS NULL OR bilateral_weight BETWEEN 0 AND 1000) AND
    (left_weight IS NULL OR left_weight BETWEEN 0 AND 1000) AND
    (right_weight IS NULL OR right_weight BETWEEN 0 AND 1000)
  ),
  CONSTRAINT bulk_training_session_sets_reps_ck CHECK (
    (bilateral_reps IS NULL OR bilateral_reps BETWEEN 1 AND 1000) AND
    (left_reps IS NULL OR left_reps BETWEEN 1 AND 1000) AND
    (right_reps IS NULL OR right_reps BETWEEN 1 AND 1000)
  ),
  UNIQUE(session_exercise_id, set_order)
);
CREATE INDEX bulk_training_session_sets_order_idx
  ON public.bulk_training_session_sets(session_exercise_id, set_order);

CREATE FUNCTION private.validate_bulk_training_session_set()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $function$
DECLARE
  exercise public.bulk_training_session_exercises;
  session_status text;
BEGIN
  SELECT e.* INTO exercise
  FROM public.bulk_training_session_exercises e
  WHERE e.id = NEW.session_exercise_id;
  IF exercise.id IS NULL THEN RAISE EXCEPTION 'Workout exercise not found'; END IF;

  SELECT s.status INTO session_status
  FROM public.bulk_training_sessions s WHERE s.id = exercise.session_id;
  IF session_status <> 'in_progress' THEN RAISE EXCEPTION 'Completed workouts cannot be changed'; END IF;

  IF exercise.execution_mode = 'bilateral' THEN
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

CREATE TRIGGER bulk_training_session_sets_validate
BEFORE INSERT OR UPDATE ON public.bulk_training_session_sets
FOR EACH ROW EXECUTE FUNCTION private.validate_bulk_training_session_set();

CREATE FUNCTION private.guard_bulk_training_session_snapshot()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $function$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF EXISTS (
      SELECT 1 FROM public.bulk_training_sessions s
      WHERE s.id = OLD.session_id AND s.status = 'completed'
    ) THEN RAISE EXCEPTION 'Completed workouts cannot be changed'; END IF;
    RETURN OLD;
  END IF;
  IF TG_OP = 'UPDATE' AND EXISTS (
    SELECT 1 FROM public.bulk_training_sessions s
    WHERE s.id = OLD.session_id AND s.status = 'completed'
  ) THEN
    -- A later plan edit may remove the provenance FK. All historical snapshots stay fixed.
    IF OLD.source_plan_exercise_id IS NOT NULL AND NEW.source_plan_exercise_id IS NULL AND
       NEW.session_id IS NOT DISTINCT FROM OLD.session_id AND
       NEW.source_exercise_id IS NOT DISTINCT FROM OLD.source_exercise_id AND
       NEW.exercise_name_snapshot IS NOT DISTINCT FROM OLD.exercise_name_snapshot AND
       NEW.exercise_order IS NOT DISTINCT FROM OLD.exercise_order AND
       NEW.execution_mode IS NOT DISTINCT FROM OLD.execution_mode AND
       NEW.is_bodyweight IS NOT DISTINCT FROM OLD.is_bodyweight AND
       NEW.target_sets IS NOT DISTINCT FROM OLD.target_sets AND
       NEW.target_rep_min IS NOT DISTINCT FROM OLD.target_rep_min AND
       NEW.target_rep_max IS NOT DISTINCT FROM OLD.target_rep_max AND
       NEW.notes_snapshot IS NOT DISTINCT FROM OLD.notes_snapshot THEN
      RETURN NEW;
    END IF;
    RAISE EXCEPTION 'Completed workouts cannot be changed';
  END IF;
  RETURN NEW;
END;
$function$;

CREATE TRIGGER bulk_training_session_exercises_guard
BEFORE UPDATE OR DELETE ON public.bulk_training_session_exercises
FOR EACH ROW EXECUTE FUNCTION private.guard_bulk_training_session_snapshot();

CREATE FUNCTION private.guard_bulk_training_session_set_delete()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $function$
BEGIN
  IF EXISTS (
    SELECT 1 FROM public.bulk_training_session_exercises e
    JOIN public.bulk_training_sessions s ON s.id = e.session_id
    WHERE e.id = OLD.session_exercise_id AND s.status = 'completed'
  ) THEN RAISE EXCEPTION 'Completed workouts cannot be changed'; END IF;
  RETURN OLD;
END;
$function$;

CREATE TRIGGER bulk_training_session_sets_delete_guard
BEFORE DELETE ON public.bulk_training_session_sets
FOR EACH ROW EXECUTE FUNCTION private.guard_bulk_training_session_set_delete();

ALTER TABLE public.bulk_training_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.bulk_training_session_exercises ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.bulk_training_session_sets ENABLE ROW LEVEL SECURITY;

CREATE POLICY "bulk training sessions own read" ON public.bulk_training_sessions
FOR SELECT TO authenticated USING (private.can_read_bulk(bulk_profile_id));
CREATE POLICY "bulk training session exercises own read" ON public.bulk_training_session_exercises
FOR SELECT TO authenticated USING (EXISTS (
  SELECT 1 FROM public.bulk_training_sessions s
  WHERE s.id = session_id AND private.can_read_bulk(s.bulk_profile_id)
));
CREATE POLICY "bulk training session sets own read" ON public.bulk_training_session_sets
FOR SELECT TO authenticated USING (EXISTS (
  SELECT 1 FROM public.bulk_training_session_exercises e
  JOIN public.bulk_training_sessions s ON s.id = e.session_id
  WHERE e.id = session_exercise_id AND private.can_read_bulk(s.bulk_profile_id)
));

GRANT SELECT ON public.bulk_training_sessions, public.bulk_training_session_exercises,
  public.bulk_training_session_sets TO authenticated;
GRANT ALL ON public.bulk_training_sessions, public.bulk_training_session_exercises,
  public.bulk_training_session_sets TO service_role;

CREATE FUNCTION public.start_bulk_training_session(_plan_day uuid)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $function$
DECLARE
  caller uuid := (SELECT auth.uid());
  chosen record;
  existing_id uuid;
  result_id uuid;
BEGIN
  IF caller IS NULL OR _plan_day IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  SELECT p.bulk_profile_id, p.id AS plan_id, p.name AS plan_name,
    d.id AS day_id, d.name AS day_name, d.day_order
  INTO chosen
  FROM public.bulk_training_plan_days d
  JOIN public.bulk_training_plans p ON p.id = d.plan_id
  JOIN public.bulk_members m ON m.bulk_profile_id = p.bulk_profile_id
  WHERE d.id = _plan_day AND p.active AND m.user_id = caller AND m.role = 'owner'
  FOR SHARE OF p, d;
  IF chosen.plan_id IS NULL THEN RAISE EXCEPTION 'Active workout day not found'; END IF;

  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(chosen.bulk_profile_id::text || ':active-workout', 0)
  );
  SELECT s.id INTO existing_id FROM public.bulk_training_sessions s
  WHERE s.bulk_profile_id = chosen.bulk_profile_id AND s.status = 'in_progress';
  IF existing_id IS NOT NULL THEN RETURN existing_id; END IF;

  IF NOT EXISTS (SELECT 1 FROM public.bulk_training_plan_exercises e WHERE e.plan_day_id = chosen.day_id)
    THEN RAISE EXCEPTION 'Workout day has no exercises'; END IF;
  IF EXISTS (
    SELECT 1 FROM public.bulk_training_plan_exercises pe
    LEFT JOIN public.bulk_exercises e ON e.id=pe.exercise_id
    WHERE pe.plan_day_id=chosen.day_id AND e.id IS NULL
  ) THEN RAISE EXCEPTION 'Workout day contains an unavailable exercise'; END IF;

  INSERT INTO public.bulk_training_sessions(
    bulk_profile_id,training_plan_id,source_plan_day_id,plan_name_snapshot,
    workout_day_name_snapshot,workout_day_order_snapshot
  ) VALUES (
    chosen.bulk_profile_id,chosen.plan_id,chosen.day_id,chosen.plan_name,
    chosen.day_name,chosen.day_order
  ) RETURNING id INTO result_id;

  INSERT INTO public.bulk_training_session_exercises(
    session_id,source_plan_exercise_id,source_exercise_id,exercise_name_snapshot,
    exercise_order,execution_mode,is_bodyweight,target_sets,target_rep_min,target_rep_max,notes_snapshot
  )
  SELECT result_id, pe.id, pe.exercise_id, pe.exercise_name, pe.exercise_order,
    pe.intended_unilateral_mode, e.is_bodyweight, pe.sets, pe.rep_min, pe.rep_max, pe.notes
  FROM public.bulk_training_plan_exercises pe
  JOIN public.bulk_exercises e ON e.id = pe.exercise_id
  WHERE pe.plan_day_id = chosen.day_id
  ORDER BY pe.exercise_order;

  INSERT INTO public.bulk_training_session_sets(session_exercise_id,set_order,is_extra)
  SELECT se.id, n, false
  FROM public.bulk_training_session_exercises se
  CROSS JOIN LATERAL pg_catalog.generate_series(1,se.target_sets) n
  WHERE se.session_id = result_id;
  RETURN result_id;
END;
$function$;

CREATE FUNCTION public.save_bulk_training_session_set(
  _session uuid, _set uuid,
  _bilateral_weight numeric, _bilateral_reps integer,
  _left_weight numeric, _left_reps integer,
  _right_weight numeric, _right_reps integer
)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $function$
DECLARE caller uuid := (SELECT auth.uid()); result_id uuid;
BEGIN
  IF caller IS NULL OR _session IS NULL OR _set IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  PERFORM 1 FROM public.bulk_training_sessions s
  JOIN public.bulk_members m ON m.bulk_profile_id = s.bulk_profile_id
  WHERE s.id = _session AND s.status = 'in_progress' AND m.user_id = caller AND m.role = 'owner'
  FOR UPDATE OF s;
  IF NOT FOUND THEN RAISE EXCEPTION 'Active workout not found'; END IF;
  UPDATE public.bulk_training_session_sets ss SET
    bilateral_weight=_bilateral_weight,bilateral_reps=_bilateral_reps,
    left_weight=_left_weight,left_reps=_left_reps,right_weight=_right_weight,right_reps=_right_reps
  FROM public.bulk_training_session_exercises se
  WHERE ss.id=_set AND ss.session_exercise_id=se.id AND se.session_id=_session
  RETURNING ss.id INTO result_id;
  IF result_id IS NULL THEN RAISE EXCEPTION 'Workout set not found'; END IF;
  UPDATE public.bulk_training_sessions SET updated_at=now() WHERE id=_session;
  RETURN result_id;
END;
$function$;

CREATE FUNCTION public.add_bulk_training_session_set(_session uuid, _exercise uuid)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $function$
DECLARE caller uuid := (SELECT auth.uid()); result_id uuid; next_order integer;
BEGIN
  IF caller IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  PERFORM 1 FROM public.bulk_training_sessions s
  JOIN public.bulk_members m ON m.bulk_profile_id=s.bulk_profile_id
  WHERE s.id=_session AND s.status='in_progress' AND m.user_id=caller AND m.role='owner'
  FOR UPDATE OF s;
  IF NOT FOUND THEN RAISE EXCEPTION 'Active workout not found'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.bulk_training_session_exercises e WHERE e.id=_exercise AND e.session_id=_session)
    THEN RAISE EXCEPTION 'Workout exercise not found'; END IF;
  SELECT COALESCE(max(set_order),0)+1 INTO next_order
  FROM public.bulk_training_session_sets WHERE session_exercise_id=_exercise;
  IF next_order > 20 THEN RAISE EXCEPTION 'A workout exercise can contain up to 20 sets'; END IF;
  INSERT INTO public.bulk_training_session_sets(session_exercise_id,set_order,is_extra)
  VALUES(_exercise,next_order,true) RETURNING id INTO result_id;
  UPDATE public.bulk_training_sessions SET updated_at=now() WHERE id=_session;
  RETURN result_id;
END;
$function$;

CREATE FUNCTION public.remove_bulk_training_session_set(_session uuid, _set uuid)
RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $function$
DECLARE caller uuid := (SELECT auth.uid()); removed uuid;
BEGIN
  IF caller IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  PERFORM 1 FROM public.bulk_training_sessions s
  JOIN public.bulk_members m ON m.bulk_profile_id=s.bulk_profile_id
  WHERE s.id=_session AND s.status='in_progress' AND m.user_id=caller AND m.role='owner'
  FOR UPDATE OF s;
  IF NOT FOUND THEN RAISE EXCEPTION 'Active workout not found'; END IF;
  DELETE FROM public.bulk_training_session_sets ss USING public.bulk_training_session_exercises se
  WHERE ss.id=_set AND ss.session_exercise_id=se.id AND se.session_id=_session
    AND ss.is_extra AND ss.bilateral_weight IS NULL AND ss.bilateral_reps IS NULL
    AND ss.left_weight IS NULL AND ss.left_reps IS NULL AND ss.right_weight IS NULL AND ss.right_reps IS NULL
  RETURNING ss.id INTO removed;
  IF removed IS NULL THEN RAISE EXCEPTION 'Only an unused extra set can be removed'; END IF;
  UPDATE public.bulk_training_sessions SET updated_at=now() WHERE id=_session;
  RETURN true;
END;
$function$;

CREATE FUNCTION public.finish_bulk_training_session(_session uuid, _confirm_incomplete boolean DEFAULT false)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $function$
DECLARE caller uuid := (SELECT auth.uid()); current_status text; incomplete integer;
BEGIN
  IF caller IS NULL OR _session IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  SELECT s.status INTO current_status FROM public.bulk_training_sessions s
  JOIN public.bulk_members m ON m.bulk_profile_id=s.bulk_profile_id
  WHERE s.id=_session AND m.user_id=caller AND m.role='owner' FOR UPDATE OF s;
  IF current_status IS NULL THEN RAISE EXCEPTION 'Workout not found'; END IF;
  IF current_status='completed' THEN RETURN _session; END IF;
  SELECT count(*) INTO incomplete FROM public.bulk_training_session_sets ss
  JOIN public.bulk_training_session_exercises se ON se.id=ss.session_exercise_id
  WHERE se.session_id=_session AND NOT ss.is_complete;
  IF incomplete > 0 AND COALESCE(_confirm_incomplete,false)=false THEN
    RAISE EXCEPTION 'Incomplete sets require confirmation';
  END IF;
  UPDATE public.bulk_training_sessions
  SET status='completed',completed_at=now(),updated_at=now() WHERE id=_session;
  RETURN _session;
END;
$function$;

CREATE FUNCTION public.discard_bulk_training_session(_session uuid)
RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $function$
DECLARE caller uuid := (SELECT auth.uid()); removed uuid;
BEGIN
  IF caller IS NULL OR _session IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  DELETE FROM public.bulk_training_sessions s USING public.bulk_members m
  WHERE s.id=_session AND s.status='in_progress' AND m.bulk_profile_id=s.bulk_profile_id
    AND m.user_id=caller AND m.role='owner'
  RETURNING s.id INTO removed;
  IF removed IS NULL THEN RAISE EXCEPTION 'Active workout not found'; END IF;
  RETURN true;
END;
$function$;

REVOKE ALL ON FUNCTION public.start_bulk_training_session(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.save_bulk_training_session_set(uuid,uuid,numeric,integer,numeric,integer,numeric,integer) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.add_bulk_training_session_set(uuid,uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.remove_bulk_training_session_set(uuid,uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.finish_bulk_training_session(uuid,boolean) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.discard_bulk_training_session(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.start_bulk_training_session(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.save_bulk_training_session_set(uuid,uuid,numeric,integer,numeric,integer,numeric,integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.add_bulk_training_session_set(uuid,uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.remove_bulk_training_session_set(uuid,uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.finish_bulk_training_session(uuid,boolean) TO authenticated;
GRANT EXECUTE ON FUNCTION public.discard_bulk_training_session(uuid) TO authenticated;
