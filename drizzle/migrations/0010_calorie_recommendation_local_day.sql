-- Add the explicit-timezone contract without changing the existing two-argument RPC.
-- _timezone has no default: PostgreSQL/PostgREST resolve the distinct named argument sets.
-- Old PWA clients retain their previous target-snapshot behavior until updated; never guess
-- their timezone. Removing that compatibility signature needs separate approval.

CREATE FUNCTION public.apply_bulk_calorie_recommendation(
  _expected_current_calories numeric,
  _new_calories numeric,
  _timezone text
)
RETURNS date
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  caller uuid := (SELECT auth.uid());
  profile_id uuid := private.current_bulk_profile();
  targets jsonb;
  current_calories numeric;
  local_day date;
BEGIN
  IF caller IS NULL OR profile_id IS NULL THEN
    RAISE EXCEPTION 'Goal profile not found' USING ERRCODE = '42501';
  END IF;
  IF _timezone IS NULL OR NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_timezone_names WHERE name = _timezone
  ) THEN
    RAISE EXCEPTION 'Invalid device timezone' USING ERRCODE = '22023';
  END IF;
  local_day := (pg_catalog.now() AT TIME ZONE _timezone)::date;

  -- Match manual target saving and meal-day creation: profile before targets/day.
  PERFORM 1 FROM public.bulk_profiles profile
  JOIN public.bulk_members member ON member.bulk_profile_id = profile.id
  WHERE profile.id = profile_id AND profile.owner_id = caller
    AND member.user_id = caller AND member.role = 'owner'
  FOR UPDATE OF profile, member;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Goal profile not found' USING ERRCODE = '42501';
  END IF;

  SELECT payload INTO targets FROM public.bulk_targets
  WHERE bulk_profile_id = profile_id FOR UPDATE;
  IF targets IS NULL OR NOT targets ? 'trainingSetupPreference'
    OR pg_catalog.jsonb_typeof(targets->'calories') IS DISTINCT FROM 'number'
    OR pg_catalog.jsonb_typeof(targets->'protein') IS DISTINCT FROM 'number'
    OR pg_catalog.jsonb_typeof(targets->'carbs') IS DISTINCT FROM 'number'
    OR pg_catalog.jsonb_typeof(targets->'fat') IS DISTINCT FROM 'number' THEN
    RAISE EXCEPTION 'Public Bulk targets are unavailable';
  END IF;
  IF (targets->>'protein')::numeric NOT BETWEEN 0 AND 2000
    OR (targets->>'carbs')::numeric NOT BETWEEN 0 AND 3000
    OR (targets->>'fat')::numeric NOT BETWEEN 0 AND 2000 THEN
    RAISE EXCEPTION 'Goal nutrition targets are outside the allowed range';
  END IF;
  IF _expected_current_calories IS NULL OR _new_calories IS NULL THEN
    RAISE EXCEPTION 'Invalid calorie recommendation request';
  END IF;
  current_calories := (targets->>'calories')::numeric;

  -- Preserve exact-retry semantics; reconcile today's snapshot even on a retry.
  IF current_calories IS DISTINCT FROM _new_calories THEN
    IF current_calories <> _expected_current_calories THEN
      RAISE EXCEPTION 'Calorie target changed on another device';
    END IF;
    IF _new_calories < 1000 OR _new_calories > 10000
      OR abs(_new_calories - current_calories) > 150
      OR abs(_new_calories - current_calories) = 0
      OR mod(_new_calories, 50) <> 0 THEN
      RAISE EXCEPTION 'Calorie recommendation is outside the allowed adjustment';
    END IF;

    -- The existing trigger records the full authoritative quartet from today onward.
    PERFORM pg_catalog.set_config('tempo.nutrition_timezone', _timezone, true);
    UPDATE public.bulk_targets
    SET payload = jsonb_set(payload, '{calories}', to_jsonb(_new_calories), false),
        updated_at = pg_catalog.now()
    WHERE bulk_profile_id = profile_id;
  ELSE
    PERFORM private.record_bulk_nutrition_targets(profile_id, _timezone);
  END IF;

  -- No day is manufactured before the first meal. Keep known macro snapshots;
  -- an all-null snapshot becomes a complete quartet using current saved macros.
  UPDATE public.bulk_nutrition_days
  SET target_calories = _new_calories,
      target_protein_g = coalesce(target_protein_g, (targets->>'protein')::numeric),
      target_carbs_g = coalesce(target_carbs_g, (targets->>'carbs')::numeric),
      target_fat_g = coalesce(target_fat_g, (targets->>'fat')::numeric),
      updated_at = pg_catalog.now()
  WHERE bulk_profile_id = profile_id AND log_date = local_day
    AND (target_calories IS DISTINCT FROM _new_calories OR target_protein_g IS NULL);
  RETURN local_day;
END;
$function$;

REVOKE ALL ON FUNCTION public.apply_bulk_calorie_recommendation(numeric,numeric,text)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.apply_bulk_calorie_recommendation(numeric,numeric,text)
  TO authenticated, service_role;
