-- Phase B Step 1: standalone, reusable, PRIVATE-ONLY workout templates, owned independently of
-- training plans and of workout sessions/history.
--
-- A workout template is a top-level owned unit (not a plan day): library-listed, unbounded count,
-- no active/inactive concept, reusable across many plans later by SNAPSHOT copy. It never backs a
-- session at runtime; sessions keep their own snapshots + nullable SET NULL source FKs.
--
-- Writes are RPC-only. authenticated receives SELECT (RLS-scoped) but NO direct INSERT/UPDATE/DELETE
-- grant, so clients cannot bypass validation, optimistic concurrency, request-id idempotency, atomic
-- replacement, or the private-only guarantee. All user writes go through SECURITY DEFINER RPCs.
--
-- Forward-compat columns exist now but are inert in Step 1: visibility is forced to 'private' by every
-- user RPC (no publish/unpublish, no public SELECT policy), and is_system / system rows (bulk_profile_id
-- NULL) have no read or write path for users yet. Phase B2/B3 add plan integration and publication.

-- ---------------------------------------------------------------- tables
CREATE TABLE public.workout_templates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  -- Nullable ONLY to host future Tempo/system workouts; user rows must have a profile (origin check).
  bulk_profile_id uuid REFERENCES public.bulk_profiles(id) ON DELETE CASCADE,
  title text NOT NULL CHECK (char_length(btrim(title)) BETWEEN 2 AND 80),
  description text NOT NULL DEFAULT '' CHECK (char_length(description) <= 500),
  visibility text NOT NULL DEFAULT 'private' CHECK (visibility IN ('private','public')),
  is_system boolean NOT NULL DEFAULT false,
  source_workout_template_id uuid REFERENCES public.workout_templates(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT workout_templates_origin_ck CHECK (
    (is_system AND bulk_profile_id IS NULL) OR (NOT is_system AND bulk_profile_id IS NOT NULL)
  )
);
CREATE INDEX workout_templates_owner_idx
  ON public.workout_templates(bulk_profile_id, created_at DESC) WHERE bulk_profile_id IS NOT NULL;

CREATE TABLE public.workout_template_exercises (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workout_template_id uuid NOT NULL REFERENCES public.workout_templates(id) ON DELETE CASCADE,
  exercise_id text REFERENCES public.bulk_exercises(id) ON DELETE SET NULL,
  source_system_exercise_id text REFERENCES public.bulk_exercises(id) ON DELETE SET NULL,
  exercise_name text NOT NULL CHECK (char_length(btrim(exercise_name)) BETWEEN 2 AND 80),
  exercise_order integer NOT NULL CHECK (exercise_order BETWEEN 1 AND 20),
  sets integer NOT NULL CHECK (sets BETWEEN 1 AND 10),
  rep_min integer NOT NULL CHECK (rep_min BETWEEN 1 AND 100),
  rep_max integer NOT NULL CHECK (rep_max BETWEEN 1 AND 100 AND rep_max >= rep_min),
  intended_unilateral_mode text NOT NULL DEFAULT 'bilateral'
    CHECK (intended_unilateral_mode IN ('bilateral','unilateral')),
  notes text CHECK (notes IS NULL OR char_length(notes) <= 240),
  UNIQUE(workout_template_id, exercise_order)
);
CREATE INDEX workout_template_exercises_template_idx
  ON public.workout_template_exercises(workout_template_id, exercise_order);

-- ---------------------------------------------------------------- updated_at trigger
CREATE TRIGGER workout_templates_touch BEFORE UPDATE ON public.workout_templates
FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

-- ---------------------------------------------------------------- exercise validation trigger
-- Mirrors validate_bulk_plan_exercise: the referenced exercise must be active and either a system
-- exercise or the caller's own custom exercise (another user's private custom is rejected), snapshots
-- the canonical name, and records source_system_exercise_id only for system exercises.
CREATE FUNCTION private.validate_workout_template_exercise()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  exercise public.bulk_exercises;
BEGIN
  SELECT * INTO exercise FROM public.bulk_exercises WHERE id = NEW.exercise_id AND active;
  IF exercise.id IS NULL OR (NOT exercise.is_system AND exercise.owner_id IS DISTINCT FROM (SELECT auth.uid())) THEN
    RAISE EXCEPTION 'Exercise is unavailable';
  END IF;
  IF NEW.intended_unilateral_mode = 'unilateral' AND NOT exercise.supports_unilateral THEN
    RAISE EXCEPTION 'Exercise does not support unilateral mode';
  END IF;
  IF exercise.is_system THEN NEW.source_system_exercise_id := exercise.id;
  ELSE NEW.source_system_exercise_id := NULL;
  END IF;
  NEW.exercise_name := exercise.name;
  RETURN NEW;
END;
$function$;

REVOKE ALL ON FUNCTION private.validate_workout_template_exercise() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION private.validate_workout_template_exercise() TO service_role;

CREATE TRIGGER workout_template_exercises_validate
BEFORE INSERT OR UPDATE
ON public.workout_template_exercises
FOR EACH ROW EXECUTE FUNCTION private.validate_workout_template_exercise();

-- ---------------------------------------------------------------- RLS (owner-only, private only)
ALTER TABLE public.workout_templates ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.workout_template_exercises ENABLE ROW LEVEL SECURITY;

-- SELECT only. System rows (bulk_profile_id IS NULL) are intentionally unreadable: no public/system
-- read path exists in Step 1. Writes have no policy and no grant -> RPC-only.
CREATE POLICY "workout templates owner read" ON public.workout_templates FOR SELECT TO authenticated
USING (bulk_profile_id IS NOT NULL AND private.can_read_bulk(bulk_profile_id));

CREATE POLICY "workout template exercises owner read" ON public.workout_template_exercises
FOR SELECT TO authenticated
USING (EXISTS (
  SELECT 1 FROM public.workout_templates t
  WHERE t.id = workout_template_id
    AND t.bulk_profile_id IS NOT NULL
    AND private.can_read_bulk(t.bulk_profile_id)
));

-- authenticated: SELECT only (no direct INSERT/UPDATE/DELETE). service_role: full administrative.
GRANT SELECT ON public.workout_templates, public.workout_template_exercises TO authenticated;
GRANT ALL ON public.workout_templates, public.workout_template_exercises TO service_role;

-- ---------------------------------------------------------------- create (empty, private)
CREATE FUNCTION public.create_workout_template(
  _title text,
  _request_id uuid DEFAULT gen_random_uuid()
)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $function$
DECLARE
  caller uuid := (SELECT auth.uid());
  profile_id uuid;
  result_id uuid;
  clean_title text := btrim(_title);
BEGIN
  IF caller IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  IF clean_title IS NULL OR char_length(clean_title) NOT BETWEEN 2 AND 80 THEN
    RAISE EXCEPTION 'Workout name must be between 2 and 80 characters';
  END IF;
  SELECT p.id INTO profile_id FROM public.bulk_profiles p
  JOIN public.bulk_members m ON m.bulk_profile_id = p.id
  WHERE p.owner_id = caller AND m.user_id = caller AND m.role = 'owner' LIMIT 1;
  IF profile_id IS NULL THEN RAISE EXCEPTION 'Active Bulk profile required'; END IF;
  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(profile_id::text || ':workout-template', 0));

  -- Idempotent retry: the same request id returns the same workout. Title is NOT identity.
  SELECT id INTO result_id FROM public.workout_templates
    WHERE id = _request_id AND bulk_profile_id = profile_id;
  IF result_id IS NOT NULL THEN RETURN result_id; END IF;

  INSERT INTO public.workout_templates(id, bulk_profile_id, title, visibility, is_system)
  VALUES (_request_id, profile_id, clean_title, 'private', false)
  RETURNING id INTO result_id;
  RETURN result_id;
END;
$function$;

-- ---------------------------------------------------------------- atomic save (title + exercises)
-- Validates the ENTIRE payload before deleting any existing rows, then replaces atomically. Always
-- advances updated_at (even when only exercises changed) so stale clients cannot silently overwrite a
-- newer edit. visibility stays 'private' (never touched here).
CREATE FUNCTION public.save_workout_template_exercises(
  _template uuid,
  _expected_updated_at timestamptz,
  _title text,
  _exercises jsonb
)
RETURNS timestamptz
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $function$
DECLARE
  caller uuid := (SELECT auth.uid());
  profile_id uuid;
  template public.workout_templates;
  clean_title text := btrim(_title);
  exercise_item record;
  exercise public.bulk_exercises;
  exercise_id text;
  exercise_mode text;
  exercise_notes text;
  set_count integer;
  rep_minimum integer;
  rep_maximum integer;
  result_updated_at timestamptz;
BEGIN
  IF caller IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  IF _template IS NULL OR _expected_updated_at IS NULL THEN RAISE EXCEPTION 'Invalid workout request'; END IF;
  IF clean_title IS NULL OR char_length(clean_title) NOT BETWEEN 2 AND 80 THEN
    RAISE EXCEPTION 'Workout name must be between 2 and 80 characters';
  END IF;
  IF _exercises IS NULL OR pg_catalog.jsonb_typeof(_exercises) <> 'array'
    OR pg_catalog.jsonb_array_length(_exercises) > 20 THEN
    RAISE EXCEPTION 'A workout may contain up to 20 exercises';
  END IF;

  SELECT t.* INTO template
  FROM public.workout_templates t
  JOIN public.bulk_members m ON m.bulk_profile_id = t.bulk_profile_id
  WHERE t.id = _template AND m.user_id = caller AND m.role = 'owner'
  FOR UPDATE OF t;
  IF template.id IS NULL THEN RAISE EXCEPTION 'Workout not found'; END IF;
  IF template.is_system THEN RAISE EXCEPTION 'System workouts cannot be edited'; END IF;
  IF template.updated_at IS DISTINCT FROM _expected_updated_at THEN
    RAISE EXCEPTION 'Workout changed on another device';
  END IF;

  -- Validate the complete payload BEFORE deleting any current exercises.
  FOR exercise_item IN
    SELECT value, ordinality FROM pg_catalog.jsonb_array_elements(_exercises) WITH ORDINALITY
  LOOP
    IF pg_catalog.jsonb_typeof(exercise_item.value) <> 'object' THEN RAISE EXCEPTION 'Invalid exercise'; END IF;
    exercise_id := exercise_item.value->>'exerciseId';
    IF exercise_id IS NULL OR exercise_id = '' THEN RAISE EXCEPTION 'Exercise is required'; END IF;
    BEGIN
      set_count := (exercise_item.value->>'sets')::integer;
      rep_minimum := (exercise_item.value->>'repMin')::integer;
      rep_maximum := (exercise_item.value->>'repMax')::integer;
    EXCEPTION WHEN invalid_text_representation OR numeric_value_out_of_range THEN
      RAISE EXCEPTION 'Invalid exercise prescription';
    END;
    IF set_count NOT BETWEEN 1 AND 10 THEN RAISE EXCEPTION 'Sets must be between 1 and 10'; END IF;
    IF rep_minimum NOT BETWEEN 1 AND 100 OR rep_maximum NOT BETWEEN 1 AND 100 OR rep_minimum > rep_maximum THEN
      RAISE EXCEPTION 'Invalid rep range';
    END IF;
    exercise_mode := COALESCE(exercise_item.value->>'executionMode', 'bilateral');
    IF exercise_mode NOT IN ('bilateral','unilateral') THEN RAISE EXCEPTION 'Invalid execution mode'; END IF;
    exercise_notes := NULLIF(btrim(exercise_item.value->>'notes'), '');
    IF exercise_notes IS NOT NULL AND char_length(exercise_notes) > 240 THEN RAISE EXCEPTION 'Exercise note is too long'; END IF;
    SELECT * INTO exercise FROM public.bulk_exercises e WHERE e.id = exercise_id AND e.active;
    IF exercise.id IS NULL OR (NOT exercise.is_system AND exercise.owner_id IS DISTINCT FROM caller) THEN
      RAISE EXCEPTION 'Exercise is unavailable';
    END IF;
    IF exercise_mode = 'unilateral' AND NOT exercise.supports_unilateral THEN
      RAISE EXCEPTION 'Exercise does not support unilateral mode';
    END IF;
  END LOOP;

  DELETE FROM public.workout_template_exercises WHERE workout_template_id = template.id;
  FOR exercise_item IN
    SELECT value, ordinality FROM pg_catalog.jsonb_array_elements(_exercises) WITH ORDINALITY
  LOOP
    exercise_id := exercise_item.value->>'exerciseId';
    SELECT * INTO exercise FROM public.bulk_exercises e WHERE e.id = exercise_id;
    exercise_mode := COALESCE(exercise_item.value->>'executionMode', 'bilateral');
    exercise_notes := NULLIF(btrim(exercise_item.value->>'notes'), '');
    INSERT INTO public.workout_template_exercises(
      workout_template_id, exercise_id, source_system_exercise_id, exercise_name, exercise_order,
      sets, rep_min, rep_max, intended_unilateral_mode, notes
    ) VALUES (
      template.id, exercise.id, CASE WHEN exercise.is_system THEN exercise.id ELSE NULL END,
      exercise.name, exercise_item.ordinality, (exercise_item.value->>'sets')::integer,
      (exercise_item.value->>'repMin')::integer, (exercise_item.value->>'repMax')::integer,
      exercise_mode, exercise_notes
    );
  END LOOP;

  -- Always UPDATE the parent so the touch trigger advances updated_at, even for exercise-only edits.
  UPDATE public.workout_templates SET title = clean_title
  WHERE id = template.id RETURNING updated_at INTO result_updated_at;
  RETURN result_updated_at;
END;
$function$;

-- ---------------------------------------------------------------- deep-copy duplicate (private)
CREATE FUNCTION public.duplicate_workout_template(
  _template_id uuid,
  _request_id uuid DEFAULT gen_random_uuid()
)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $function$
DECLARE
  caller uuid := (SELECT auth.uid());
  profile_id uuid;
  source public.workout_templates;
  result_id uuid;
  copy_title text;
BEGIN
  IF caller IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  SELECT p.id INTO profile_id FROM public.bulk_profiles p
  JOIN public.bulk_members m ON m.bulk_profile_id = p.id
  WHERE p.owner_id = caller AND m.user_id = caller AND m.role = 'owner' LIMIT 1;
  IF profile_id IS NULL THEN RAISE EXCEPTION 'Active Bulk profile required'; END IF;
  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(profile_id::text || ':workout-template', 0));

  SELECT id INTO result_id FROM public.workout_templates
    WHERE id = _request_id AND bulk_profile_id = profile_id;
  IF result_id IS NOT NULL THEN RETURN result_id; END IF;

  -- Owner-only source in Step 1 (system rows have a NULL profile and never match).
  SELECT * INTO source FROM public.workout_templates
    WHERE id = _template_id AND bulk_profile_id = profile_id;
  IF source.id IS NULL THEN RAISE EXCEPTION 'Workout not found'; END IF;

  -- Pre-flight: refuse before inserting anything if any source exercise cannot be validly copied,
  -- mirroring validate_workout_template_exercise so no partial copy is ever created.
  IF EXISTS (
    SELECT 1
    FROM public.workout_template_exercises we
    LEFT JOIN public.bulk_exercises e ON e.id = we.exercise_id AND e.active
    WHERE we.workout_template_id = source.id
      AND (
        we.exercise_id IS NULL
        OR e.id IS NULL
        OR (NOT e.is_system AND e.owner_id IS DISTINCT FROM caller)
      )
  ) THEN
    RAISE EXCEPTION 'This workout contains an unavailable exercise. Remove or replace it before duplicating the workout.';
  END IF;

  -- "<title> (copy)", truncated so the 80-char title check always holds.
  copy_title := substring(source.title for 73) || ' (copy)';
  INSERT INTO public.workout_templates(id, bulk_profile_id, title, description, visibility, is_system)
  VALUES (_request_id, profile_id, copy_title, source.description, 'private', false)
  RETURNING id INTO result_id;

  INSERT INTO public.workout_template_exercises(
    workout_template_id, exercise_id, source_system_exercise_id, exercise_name, exercise_order,
    sets, rep_min, rep_max, intended_unilateral_mode, notes)
  SELECT result_id, we.exercise_id, we.source_system_exercise_id, we.exercise_name, we.exercise_order,
         we.sets, we.rep_min, we.rep_max, we.intended_unilateral_mode, we.notes
  FROM public.workout_template_exercises we
  WHERE we.workout_template_id = source.id ORDER BY we.exercise_order;
  RETURN result_id;
END;
$function$;

-- ---------------------------------------------------------------- delete (owner only)
CREATE FUNCTION public.delete_workout_template(_template_id uuid)
RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $function$
DECLARE
  caller uuid := (SELECT auth.uid());
  profile_id uuid;
  deleted uuid;
BEGIN
  IF caller IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  SELECT p.id INTO profile_id FROM public.bulk_profiles p
  JOIN public.bulk_members m ON m.bulk_profile_id = p.id
  WHERE p.owner_id = caller AND m.user_id = caller AND m.role = 'owner' LIMIT 1;
  IF profile_id IS NULL THEN RAISE EXCEPTION 'Active Bulk profile required'; END IF;
  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(profile_id::text || ':workout-template', 0));

  -- Not found / not owned / system: idempotent no-op (never touches another user's or a system row).
  -- Child exercise rows cascade; bulk_exercises, plans and sessions are untouched.
  DELETE FROM public.workout_templates
    WHERE id = _template_id AND bulk_profile_id = profile_id RETURNING id INTO deleted;
  RETURN deleted IS NOT NULL;
END;
$function$;

-- ---------------------------------------------------------------- grants (RPC execute, authenticated)
REVOKE ALL ON FUNCTION public.create_workout_template(text, uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.save_workout_template_exercises(uuid, timestamptz, text, jsonb) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.duplicate_workout_template(uuid, uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.delete_workout_template(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_workout_template(text, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.save_workout_template_exercises(uuid, timestamptz, text, jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.duplicate_workout_template(uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.delete_workout_template(uuid) TO authenticated;
