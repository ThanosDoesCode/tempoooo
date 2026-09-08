-- Keep public Goal plan switching and nutrition-date enforcement transactional.
-- Legacy My Bulk tables and completed public workout snapshots are unchanged.

CREATE FUNCTION private.validate_bulk_nutrition_write_day(
  _log_date date,
  _local_today date
)
RETURNS void
LANGUAGE plpgsql
STABLE
SET search_path = ''
AS $function$
BEGIN
  PERFORM private.validate_bulk_nutrition_date(_log_date);
  IF _local_today IS NULL OR _local_today NOT BETWEEN current_date - 1 AND current_date + 1 THEN
    RAISE EXCEPTION 'Invalid local nutrition date';
  END IF;
  IF _log_date > _local_today THEN
    RAISE EXCEPTION 'Future nutrition days are view-only';
  END IF;
END;
$function$;

-- Keep the old signatures for trusted service-role maintenance only. Authenticated
-- clients must supply the browser's logical local day to the guarded overloads.
REVOKE EXECUTE ON FUNCTION public.log_bulk_meal_preset(uuid,date,uuid) FROM authenticated;
REVOKE EXECUTE ON FUNCTION public.create_bulk_nutrition_entry(date,uuid,text,numeric,numeric,numeric,numeric,text) FROM authenticated;
REVOKE EXECUTE ON FUNCTION public.update_bulk_nutrition_entry(uuid,timestamptz,text,numeric,numeric,numeric,numeric,text) FROM authenticated;
REVOKE EXECUTE ON FUNCTION public.delete_bulk_nutrition_entry(uuid) FROM authenticated;

CREATE FUNCTION public.log_bulk_meal_preset(
  _preset uuid,
  _log_date date,
  _request_id uuid,
  _local_today date
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
BEGIN
  PERFORM private.validate_bulk_nutrition_write_day(_log_date, _local_today);
  RETURN public.log_bulk_meal_preset(_preset, _log_date, _request_id);
END;
$function$;

CREATE FUNCTION public.create_bulk_nutrition_entry(
  _log_date date,
  _request_id uuid,
  _name text,
  _calories numeric,
  _protein numeric,
  _carbs numeric,
  _fat numeric,
  _local_today date,
  _note text DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
BEGIN
  PERFORM private.validate_bulk_nutrition_write_day(_log_date, _local_today);
  RETURN public.create_bulk_nutrition_entry(
    _log_date, _request_id, _name, _calories, _protein, _carbs, _fat, _note
  );
END;
$function$;

CREATE FUNCTION public.update_bulk_nutrition_entry(
  _entry uuid,
  _expected_updated_at timestamptz,
  _name text,
  _calories numeric,
  _protein numeric,
  _carbs numeric,
  _fat numeric,
  _local_today date,
  _note text DEFAULT NULL
)
RETURNS timestamptz
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  profile_id uuid := private.current_bulk_profile();
  selected_date date;
BEGIN
  SELECT day.log_date INTO selected_date
  FROM public.bulk_nutrition_entries entry
  JOIN public.bulk_nutrition_days day ON day.id = entry.nutrition_day_id
  WHERE entry.id = _entry AND day.bulk_profile_id = profile_id;
  IF selected_date IS NULL THEN RAISE EXCEPTION 'Nutrition entry not found'; END IF;
  PERFORM private.validate_bulk_nutrition_write_day(selected_date, _local_today);
  RETURN public.update_bulk_nutrition_entry(
    _entry, _expected_updated_at, _name, _calories, _protein, _carbs, _fat, _note
  );
END;
$function$;

CREATE FUNCTION public.delete_bulk_nutrition_entry(
  _entry uuid,
  _local_today date
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  profile_id uuid := private.current_bulk_profile();
  selected_date date;
BEGIN
  SELECT day.log_date INTO selected_date
  FROM public.bulk_nutrition_entries entry
  JOIN public.bulk_nutrition_days day ON day.id = entry.nutrition_day_id
  WHERE entry.id = _entry AND day.bulk_profile_id = profile_id;
  IF selected_date IS NULL THEN RETURN false; END IF;
  PERFORM private.validate_bulk_nutrition_write_day(selected_date, _local_today);
  RETURN public.delete_bulk_nutrition_entry(_entry);
END;
$function$;

REVOKE ALL ON FUNCTION private.validate_bulk_nutrition_write_day(date,date) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.log_bulk_meal_preset(uuid,date,uuid,date) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.create_bulk_nutrition_entry(date,uuid,text,numeric,numeric,numeric,numeric,date,text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.update_bulk_nutrition_entry(uuid,timestamptz,text,numeric,numeric,numeric,numeric,date,text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.delete_bulk_nutrition_entry(uuid,date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.log_bulk_meal_preset(uuid,date,uuid,date) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.create_bulk_nutrition_entry(date,uuid,text,numeric,numeric,numeric,numeric,date,text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.update_bulk_nutrition_entry(uuid,timestamptz,text,numeric,numeric,numeric,numeric,date,text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.delete_bulk_nutrition_entry(uuid,date) TO authenticated, service_role;

CREATE FUNCTION public.switch_bulk_training_plan(_template_id text, _plan_type text)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  caller uuid := (SELECT auth.uid());
  profile_id uuid;
  existing_id uuid;
BEGIN
  IF caller IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  SELECT p.id INTO profile_id
  FROM public.bulk_profiles p
  JOIN public.bulk_members member ON member.bulk_profile_id = p.id
  WHERE p.owner_id = caller AND p.goal_status = 'active'
    AND member.user_id = caller AND member.role = 'owner'
  LIMIT 1;
  IF profile_id IS NULL THEN RAISE EXCEPTION 'Active Goal profile required'; END IF;
  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(profile_id::text || ':training-plan', 0)
  );
  IF NOT EXISTS (
    SELECT 1 FROM public.bulk_profiles
    WHERE id = profile_id AND owner_id = caller AND goal_status = 'active'
  ) THEN RAISE EXCEPTION 'Active Goal profile required'; END IF;
  IF EXISTS (
    SELECT 1 FROM public.bulk_training_sessions
    WHERE bulk_profile_id = profile_id AND status = 'in_progress'
  ) THEN
    RAISE EXCEPTION 'Finish or discard your current workout before changing plans.';
  END IF;
  SELECT id INTO existing_id FROM public.bulk_training_plans
  WHERE bulk_profile_id = profile_id AND active FOR UPDATE;
  IF existing_id IS NOT NULL THEN
    UPDATE public.bulk_training_plans SET active = false, updated_at = now()
    WHERE id = existing_id;
  END IF;
  RETURN public.instantiate_bulk_training_plan(_template_id, _plan_type);
END;
$function$;

CREATE FUNCTION public.switch_to_empty_bulk_training_plan(_name text)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  caller uuid := (SELECT auth.uid());
  profile_id uuid;
  existing_id uuid;
BEGIN
  IF caller IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  SELECT p.id INTO profile_id
  FROM public.bulk_profiles p
  JOIN public.bulk_members member ON member.bulk_profile_id = p.id
  WHERE p.owner_id = caller AND p.goal_status = 'active'
    AND member.user_id = caller AND member.role = 'owner'
  LIMIT 1;
  IF profile_id IS NULL THEN RAISE EXCEPTION 'Active Goal profile required'; END IF;
  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(profile_id::text || ':training-plan', 0)
  );
  IF NOT EXISTS (
    SELECT 1 FROM public.bulk_profiles
    WHERE id = profile_id AND owner_id = caller AND goal_status = 'active'
  ) THEN RAISE EXCEPTION 'Active Goal profile required'; END IF;
  IF EXISTS (
    SELECT 1 FROM public.bulk_training_sessions
    WHERE bulk_profile_id = profile_id AND status = 'in_progress'
  ) THEN
    RAISE EXCEPTION 'Finish or discard your current workout before changing plans.';
  END IF;
  SELECT id INTO existing_id FROM public.bulk_training_plans
  WHERE bulk_profile_id = profile_id AND active FOR UPDATE;
  IF existing_id IS NOT NULL THEN
    UPDATE public.bulk_training_plans SET active = false, updated_at = now()
    WHERE id = existing_id;
  END IF;
  RETURN public.create_empty_bulk_training_plan(_name);
END;
$function$;

REVOKE ALL ON FUNCTION public.switch_bulk_training_plan(text,text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.switch_to_empty_bulk_training_plan(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.switch_bulk_training_plan(text,text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.switch_to_empty_bulk_training_plan(text) TO authenticated, service_role;

-- A nullable status distinguishes legacy My Bulk profiles from public Goal plans
-- that have been deliberately reset. Existing public plans remain active.
ALTER TABLE public.bulk_profiles ADD COLUMN goal_status text;
ALTER TABLE public.bulk_profiles ADD CONSTRAINT bulk_profiles_goal_status_ck
  CHECK (goal_status IS NULL OR goal_status IN ('active', 'inactive'));
UPDATE public.bulk_profiles profile
SET goal_status = 'active'
FROM public.bulk_targets targets
WHERE targets.bulk_profile_id = profile.id
  AND targets.payload ? 'trainingSetupPreference';
REVOKE UPDATE ON public.bulk_profiles FROM authenticated;
GRANT UPDATE (name, allow_editor) ON public.bulk_profiles TO authenticated;
REVOKE EXECUTE ON FUNCTION public.complete_bulk_onboarding(
  text,numeric,numeric,numeric,text,integer,text[],text,integer,integer,integer,integer
) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.complete_bulk_onboarding(
  text,numeric,numeric,numeric,text,integer,text[],text,integer,integer,integer,integer
) TO service_role;

CREATE FUNCTION public.complete_goal_onboarding(
  _goal text,
  _current_weight_kg numeric,
  _target_weight_kg numeric,
  _target_weekly_gain_kg numeric,
  _experience_level text,
  _training_days_per_week integer,
  _available_equipment text[],
  _training_setup_preference text,
  _calories integer,
  _protein integer,
  _carbs integer,
  _fat integer
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  caller uuid := (SELECT auth.uid());
  plan_id uuid;
  existing_status text;
  normalized_equipment text[];
BEGIN
  IF caller IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  SELECT id, goal_status INTO plan_id, existing_status
  FROM public.bulk_profiles WHERE owner_id = caller FOR UPDATE;
  IF plan_id IS NOT NULL AND existing_status IS NULL THEN
    RAISE EXCEPTION 'Legacy My Bulk profiles cannot be converted through public onboarding';
  END IF;

  -- The existing atomic function remains the canonical validation and creation path.
  plan_id := public.complete_bulk_onboarding(
    _goal, _current_weight_kg, _target_weight_kg, _target_weekly_gain_kg,
    _experience_level, _training_days_per_week, _available_equipment,
    _training_setup_preference, _calories, _protein, _carbs, _fat
  );
  IF existing_status = 'active' THEN RETURN plan_id; END IF;

  SELECT pg_catalog.array_agg(DISTINCT value ORDER BY value)
  INTO normalized_equipment
  FROM pg_catalog.unnest(_available_equipment) AS equipment(value);
  INSERT INTO public.bulk_targets(bulk_profile_id, payload)
  VALUES (plan_id, pg_catalog.jsonb_build_object(
    'goal', _goal,
    'calories', _calories,
    'protein', _protein,
    'carbs', _carbs,
    'fat', _fat,
    'water', 3,
    'startWeight', _current_weight_kg,
    'targetWeight', _target_weight_kg,
    'targetWeeklyGainKg', _target_weekly_gain_kg,
    'experienceLevel', _experience_level,
    'trainingDaysPerWeek', _training_days_per_week,
    'availableEquipment', normalized_equipment,
    'trainingSetupPreference', _training_setup_preference,
    'onboardingCompletedAt', pg_catalog.now()
  ))
  ON CONFLICT (bulk_profile_id) DO UPDATE SET payload = EXCLUDED.payload;
  UPDATE public.bulk_profiles SET goal_status = 'active' WHERE id = plan_id;
  RETURN plan_id;
END;
$function$;

CREATE FUNCTION public.deactivate_public_goal()
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  caller uuid := (SELECT auth.uid());
  profile_id uuid;
BEGIN
  IF caller IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  SELECT id INTO profile_id FROM public.bulk_profiles
  WHERE owner_id = caller AND goal_status = 'active' FOR UPDATE;
  IF profile_id IS NULL THEN RAISE EXCEPTION 'Active Goal profile required'; END IF;
  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(profile_id::text || ':training-plan', 0)
  );
  IF EXISTS (
    SELECT 1 FROM public.bulk_training_sessions
    WHERE bulk_profile_id = profile_id AND status = 'in_progress'
  ) THEN
    RAISE EXCEPTION 'Finish or discard your current workout before resetting Goal.';
  END IF;
  UPDATE public.bulk_training_plans SET active = false, updated_at = now()
  WHERE bulk_profile_id = profile_id AND active;
  DELETE FROM public.bulk_targets WHERE bulk_profile_id = profile_id;
  UPDATE public.bulk_profiles SET goal_status = 'inactive' WHERE id = profile_id;
  RETURN profile_id;
END;
$function$;

REVOKE ALL ON FUNCTION public.complete_goal_onboarding(text,numeric,numeric,numeric,text,integer,text[],text,integer,integer,integer,integer) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.deactivate_public_goal() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.complete_goal_onboarding(text,numeric,numeric,numeric,text,integer,text[],text,integer,integer,integer,integer) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.deactivate_public_goal() TO authenticated, service_role;
