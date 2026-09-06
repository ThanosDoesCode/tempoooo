-- Segment 5: transactional editing for user-owned training plans.
-- Historical workout payloads and immutable system templates are untouched.
CREATE FUNCTION private.validate_bulk_plan_exercise()
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

REVOKE ALL ON FUNCTION private.validate_bulk_plan_exercise() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION private.validate_bulk_plan_exercise() TO service_role;

CREATE TRIGGER bulk_training_plan_exercises_validate
BEFORE INSERT OR UPDATE
ON public.bulk_training_plan_exercises
FOR EACH ROW EXECUTE FUNCTION private.validate_bulk_plan_exercise();

CREATE FUNCTION public.save_bulk_training_plan(
  _plan uuid,
  _expected_updated_at timestamptz,
  _name text,
  _days jsonb
)
RETURNS timestamptz
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  caller uuid := (SELECT auth.uid());
  plan public.bulk_training_plans;
  day_item record;
  exercise_item record;
  day_id uuid;
  exercise public.bulk_exercises;
  day_name text;
  exercise_id text;
  exercise_mode text;
  exercise_notes text;
  set_count integer;
  rep_minimum integer;
  rep_maximum integer;
  result_updated_at timestamptz;
BEGIN
  IF caller IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  IF _plan IS NULL OR _expected_updated_at IS NULL THEN RAISE EXCEPTION 'Invalid plan request'; END IF;
  IF _name IS NULL OR char_length(btrim(_name)) NOT BETWEEN 2 AND 80 THEN
    RAISE EXCEPTION 'Plan name must be between 2 and 80 characters';
  END IF;
  IF _days IS NULL OR pg_catalog.jsonb_typeof(_days) <> 'array'
    OR pg_catalog.jsonb_array_length(_days) > 6 THEN
    RAISE EXCEPTION 'A plan may contain up to 6 workout days';
  END IF;

  SELECT p.* INTO plan
  FROM public.bulk_training_plans p
  JOIN public.bulk_members m ON m.bulk_profile_id = p.bulk_profile_id
  WHERE p.id = _plan AND p.active AND m.user_id = caller AND m.role = 'owner'
  FOR UPDATE OF p;
  IF plan.id IS NULL THEN RAISE EXCEPTION 'Active training plan not found'; END IF;
  IF plan.updated_at IS DISTINCT FROM _expected_updated_at THEN
    RAISE EXCEPTION 'Training plan changed on another device';
  END IF;

  -- Validate the complete payload before deleting any current configuration.
  FOR day_item IN
    SELECT value, ordinality FROM pg_catalog.jsonb_array_elements(_days) WITH ORDINALITY
  LOOP
    IF pg_catalog.jsonb_typeof(day_item.value) <> 'object' THEN RAISE EXCEPTION 'Invalid workout day'; END IF;
    day_name := btrim(day_item.value->>'name');
    IF day_name IS NULL OR char_length(day_name) NOT BETWEEN 1 AND 60 THEN RAISE EXCEPTION 'Invalid workout day name'; END IF;
    IF pg_catalog.jsonb_typeof(day_item.value->'exercises') <> 'array'
      OR pg_catalog.jsonb_array_length(day_item.value->'exercises') > 20 THEN
      RAISE EXCEPTION 'A workout day may contain up to 20 exercises';
    END IF;
    FOR exercise_item IN
      SELECT value, ordinality FROM pg_catalog.jsonb_array_elements(day_item.value->'exercises') WITH ORDINALITY
    LOOP
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
  END LOOP;

  DELETE FROM public.bulk_training_plan_days WHERE plan_id = plan.id;
  FOR day_item IN
    SELECT value, ordinality FROM pg_catalog.jsonb_array_elements(_days) WITH ORDINALITY
  LOOP
    INSERT INTO public.bulk_training_plan_days(plan_id,day_order,name)
    VALUES(plan.id,day_item.ordinality,btrim(day_item.value->>'name')) RETURNING id INTO day_id;
    FOR exercise_item IN
      SELECT value, ordinality FROM pg_catalog.jsonb_array_elements(day_item.value->'exercises') WITH ORDINALITY
    LOOP
      exercise_id := exercise_item.value->>'exerciseId';
      SELECT * INTO exercise FROM public.bulk_exercises e WHERE e.id = exercise_id;
      exercise_mode := COALESCE(exercise_item.value->>'executionMode', 'bilateral');
      exercise_notes := NULLIF(btrim(exercise_item.value->>'notes'), '');
      INSERT INTO public.bulk_training_plan_exercises(
        plan_day_id,exercise_id,source_system_exercise_id,exercise_name,exercise_order,
        sets,rep_min,rep_max,intended_unilateral_mode,notes
      ) VALUES (
        day_id,exercise.id,CASE WHEN exercise.is_system THEN exercise.id ELSE NULL END,
        exercise.name,exercise_item.ordinality,(exercise_item.value->>'sets')::integer,
        (exercise_item.value->>'repMin')::integer,(exercise_item.value->>'repMax')::integer,
        exercise_mode,exercise_notes
      );
    END LOOP;
  END LOOP;

  UPDATE public.bulk_training_plans
  SET name=btrim(_name), training_days_per_week=pg_catalog.jsonb_array_length(_days)
  WHERE id=plan.id RETURNING updated_at INTO result_updated_at;
  RETURN result_updated_at;
END;
$function$;

REVOKE ALL ON FUNCTION public.save_bulk_training_plan(uuid,timestamptz,text,jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.save_bulk_training_plan(uuid,timestamptz,text,jsonb) TO authenticated;
