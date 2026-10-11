-- Phase A: a saved training-plan library with at-most-one active plan.
--
-- Creating a plan is now non-destructive: the first plan for a profile is active, any further plan
-- is saved inactive and NEVER deactivates the current one. Activation/deletion/duplication are
-- explicit. The at-most-one-active invariant stays enforced by bulk_training_plans_one_active_uidx;
-- zero active plans is a valid state. Completed sessions are untouched (snapshots + SET NULL FKs).
--
-- Request-level idempotency reuses the established caller-supplied-uuid-as-primary-key pattern
-- (see create_challenge_atomic): the same _request_id returns the same row on retry/replay. Plan
-- name and source_template_id are NOT identity — duplicate names and repeated template copies are
-- intentionally allowed.

-- ---------------------------------------------------------------- non-destructive create (empty)
DROP FUNCTION IF EXISTS public.create_empty_bulk_training_plan(text);
CREATE FUNCTION public.create_empty_bulk_training_plan(
  _name text,
  _request_id uuid DEFAULT gen_random_uuid()
)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $function$
DECLARE
  caller uuid := (SELECT auth.uid());
  profile_id uuid;
  result_id uuid;
  clean_name text := btrim(_name);
  has_active boolean;
BEGIN
  IF caller IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  IF clean_name IS NULL OR char_length(clean_name) NOT BETWEEN 2 AND 80 THEN
    RAISE EXCEPTION 'Plan name must be between 2 and 80 characters';
  END IF;
  SELECT p.id INTO profile_id FROM public.bulk_profiles p
  JOIN public.bulk_members m ON m.bulk_profile_id = p.id
  WHERE p.owner_id = caller AND m.user_id = caller AND m.role = 'owner' LIMIT 1;
  IF profile_id IS NULL THEN RAISE EXCEPTION 'Active Bulk profile required'; END IF;
  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(profile_id::text || ':training-plan', 0));

  -- Idempotent retry: same request id returns the same saved plan.
  SELECT id INTO result_id FROM public.bulk_training_plans
    WHERE id = _request_id AND bulk_profile_id = profile_id;
  IF result_id IS NOT NULL THEN RETURN result_id; END IF;

  has_active := EXISTS (
    SELECT 1 FROM public.bulk_training_plans WHERE bulk_profile_id = profile_id AND active);
  INSERT INTO public.bulk_training_plans(id, bulk_profile_id, plan_type, name, training_days_per_week, active)
  VALUES (_request_id, profile_id, 'custom', clean_name, 0, NOT has_active)
  RETURNING id INTO result_id;
  RETURN result_id;
END;
$function$;

-- ---------------------------------------------------------------- non-destructive create (template)
DROP FUNCTION IF EXISTS public.instantiate_bulk_training_plan(text, text);
CREATE FUNCTION public.instantiate_bulk_training_plan(
  _template_id text,
  _plan_type text,
  _request_id uuid DEFAULT gen_random_uuid()
)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $function$
DECLARE
  caller uuid := (SELECT auth.uid());
  profile_id uuid;
  result_id uuid;
  template public.bulk_training_plan_templates;
  has_active boolean;
BEGIN
  IF caller IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  IF _template_id IS NULL OR _template_id = '' OR _plan_type NOT IN ('generated','tempo_preset') THEN
    RAISE EXCEPTION 'Invalid training plan selection';
  END IF;
  SELECT p.id INTO profile_id FROM public.bulk_profiles p
  JOIN public.bulk_members m ON m.bulk_profile_id = p.id
  WHERE p.owner_id = caller AND m.user_id = caller AND m.role = 'owner' LIMIT 1;
  IF profile_id IS NULL THEN RAISE EXCEPTION 'Active Bulk profile required'; END IF;
  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(profile_id::text || ':training-plan', 0));

  SELECT id INTO result_id FROM public.bulk_training_plans
    WHERE id = _request_id AND bulk_profile_id = profile_id;
  IF result_id IS NOT NULL THEN RETURN result_id; END IF;

  SELECT * INTO template FROM public.bulk_training_plan_templates t WHERE t.id = _template_id AND t.active;
  IF template.id IS NULL THEN RAISE EXCEPTION 'Training plan template not found'; END IF;

  has_active := EXISTS (
    SELECT 1 FROM public.bulk_training_plans WHERE bulk_profile_id = profile_id AND active);
  INSERT INTO public.bulk_training_plans(
    id, bulk_profile_id, source_template_id, plan_type, name, description, experience_level,
    training_days_per_week, active)
  VALUES (
    _request_id, profile_id, template.id, _plan_type, template.name, template.description,
    template.experience_level, template.training_days_per_week, NOT has_active)
  RETURNING id INTO result_id;
  INSERT INTO public.bulk_training_plan_days(plan_id, day_order, name)
  SELECT result_id, d.day_order, d.name FROM public.bulk_training_plan_template_days d
    WHERE d.template_id = template.id ORDER BY d.day_order;
  INSERT INTO public.bulk_training_plan_exercises(
    plan_day_id, exercise_id, source_system_exercise_id, exercise_name, exercise_order,
    sets, rep_min, rep_max, intended_unilateral_mode, notes)
  SELECT ud.id, te.exercise_id, te.exercise_id, e.name, te.exercise_order,
         te.sets, te.rep_min, te.rep_max, te.intended_unilateral_mode, te.notes
  FROM public.bulk_training_plan_template_days td
  JOIN public.bulk_training_plan_template_exercises te ON te.template_day_id = td.id
  JOIN public.bulk_training_plan_days ud ON ud.plan_id = result_id AND ud.day_order = td.day_order
  JOIN public.bulk_exercises e ON e.id = te.exercise_id
  WHERE td.template_id = template.id ORDER BY td.day_order, te.exercise_order;
  RETURN result_id;
END;
$function$;

-- ---------------------------------------------------------------- explicit activation
CREATE FUNCTION public.activate_bulk_training_plan(_plan_id uuid)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $function$
DECLARE
  caller uuid := (SELECT auth.uid());
  profile_id uuid;
  is_active boolean;
BEGIN
  IF caller IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  SELECT p.id INTO profile_id FROM public.bulk_profiles p
  JOIN public.bulk_members m ON m.bulk_profile_id = p.id
  WHERE p.owner_id = caller AND m.user_id = caller AND m.role = 'owner' LIMIT 1;
  IF profile_id IS NULL THEN RAISE EXCEPTION 'Active Bulk profile required'; END IF;
  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(profile_id::text || ':training-plan', 0));

  SELECT active INTO is_active FROM public.bulk_training_plans
    WHERE id = _plan_id AND bulk_profile_id = profile_id;
  IF is_active IS NULL THEN RAISE EXCEPTION 'Training plan not found'; END IF;
  IF is_active THEN RETURN; END IF;  -- already active: idempotent

  IF EXISTS (
    SELECT 1 FROM public.bulk_training_sessions
    WHERE bulk_profile_id = profile_id AND status = 'in_progress'
  ) THEN
    RAISE EXCEPTION 'Finish or discard your current workout before changing plans.';
  END IF;

  UPDATE public.bulk_training_plans SET active = false, updated_at = now()
    WHERE bulk_profile_id = profile_id AND active;
  UPDATE public.bulk_training_plans SET active = true, updated_at = now()
    WHERE id = _plan_id AND bulk_profile_id = profile_id;
END;
$function$;

-- ---------------------------------------------------------------- explicit deletion
-- Deleting the active plan leaves ZERO active plans (no auto-activation). Completed sessions
-- survive: their training_plan_id / source_plan_day_id / source_plan_exercise_id are ON DELETE
-- SET NULL and they carry full snapshots.
CREATE FUNCTION public.delete_bulk_training_plan(_plan_id uuid)
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
    pg_catalog.hashtextextended(profile_id::text || ':training-plan', 0));

  -- Not found / not owned: idempotent no-op (never touches another user's plan).
  IF NOT EXISTS (
    SELECT 1 FROM public.bulk_training_plans WHERE id = _plan_id AND bulk_profile_id = profile_id
  ) THEN RETURN false; END IF;

  IF EXISTS (
    SELECT 1 FROM public.bulk_training_sessions
    WHERE bulk_profile_id = profile_id AND training_plan_id = _plan_id AND status = 'in_progress'
  ) THEN
    RAISE EXCEPTION 'Finish or discard your current workout before deleting this plan.';
  END IF;

  DELETE FROM public.bulk_training_plans
    WHERE id = _plan_id AND bulk_profile_id = profile_id RETURNING id INTO deleted;
  RETURN deleted IS NOT NULL;
END;
$function$;

-- ---------------------------------------------------------------- deep-copy duplicate
CREATE FUNCTION public.duplicate_bulk_training_plan(
  _plan_id uuid,
  _request_id uuid DEFAULT gen_random_uuid()
)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $function$
DECLARE
  caller uuid := (SELECT auth.uid());
  profile_id uuid;
  source public.bulk_training_plans;
  result_id uuid;
  copy_name text;
BEGIN
  IF caller IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  SELECT p.id INTO profile_id FROM public.bulk_profiles p
  JOIN public.bulk_members m ON m.bulk_profile_id = p.id
  WHERE p.owner_id = caller AND m.user_id = caller AND m.role = 'owner' LIMIT 1;
  IF profile_id IS NULL THEN RAISE EXCEPTION 'Active Bulk profile required'; END IF;
  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(profile_id::text || ':training-plan', 0));

  SELECT id INTO result_id FROM public.bulk_training_plans
    WHERE id = _request_id AND bulk_profile_id = profile_id;
  IF result_id IS NOT NULL THEN RETURN result_id; END IF;

  SELECT * INTO source FROM public.bulk_training_plans
    WHERE id = _plan_id AND bulk_profile_id = profile_id;
  IF source.id IS NULL THEN RAISE EXCEPTION 'Training plan not found'; END IF;

  -- Pre-flight: refuse before inserting anything if any source exercise cannot be validly copied
  -- (missing link, inactive, or not system/owner-owned), mirroring validate_bulk_plan_exercise so
  -- the trigger is never relaxed and no partial copy is ever created.
  IF EXISTS (
    SELECT 1
    FROM public.bulk_training_plan_days sd
    JOIN public.bulk_training_plan_exercises pe ON pe.plan_day_id = sd.id
    LEFT JOIN public.bulk_exercises e ON e.id = pe.exercise_id AND e.active
    WHERE sd.plan_id = source.id
      AND (
        pe.exercise_id IS NULL
        OR e.id IS NULL
        OR (NOT e.is_system AND e.owner_id IS DISTINCT FROM caller)
      )
  ) THEN
    RAISE EXCEPTION 'This plan contains an unavailable exercise. Remove or replace it before duplicating the plan.';
  END IF;

  -- "<name> (copy)", truncated so the 80-char name check always holds.
  copy_name := substring(source.name for 73) || ' (copy)';
  INSERT INTO public.bulk_training_plans(
    id, bulk_profile_id, source_template_id, plan_type, name, description, experience_level,
    training_days_per_week, active)
  VALUES (
    _request_id, profile_id, source.source_template_id, source.plan_type, copy_name,
    source.description, source.experience_level, source.training_days_per_week, false)
  RETURNING id INTO result_id;

  INSERT INTO public.bulk_training_plan_days(plan_id, day_order, name)
  SELECT result_id, d.day_order, d.name FROM public.bulk_training_plan_days d
    WHERE d.plan_id = source.id ORDER BY d.day_order;
  INSERT INTO public.bulk_training_plan_exercises(
    plan_day_id, exercise_id, source_system_exercise_id, exercise_name, exercise_order,
    sets, rep_min, rep_max, intended_unilateral_mode, notes)
  SELECT nd.id, pe.exercise_id, pe.source_system_exercise_id, pe.exercise_name, pe.exercise_order,
         pe.sets, pe.rep_min, pe.rep_max, pe.intended_unilateral_mode, pe.notes
  FROM public.bulk_training_plan_days sd
  JOIN public.bulk_training_plan_exercises pe ON pe.plan_day_id = sd.id
  JOIN public.bulk_training_plan_days nd ON nd.plan_id = result_id AND nd.day_order = sd.day_order
  WHERE sd.plan_id = source.id ORDER BY sd.day_order, pe.exercise_order;
  RETURN result_id;
END;
$function$;

-- ---------------------------------------------------------------- grants
REVOKE ALL ON FUNCTION public.create_empty_bulk_training_plan(text, uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.instantiate_bulk_training_plan(text, text, uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.activate_bulk_training_plan(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.delete_bulk_training_plan(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.duplicate_bulk_training_plan(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_empty_bulk_training_plan(text, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.instantiate_bulk_training_plan(text, text, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.activate_bulk_training_plan(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.delete_bulk_training_plan(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.duplicate_bulk_training_plan(uuid, uuid) TO authenticated;
