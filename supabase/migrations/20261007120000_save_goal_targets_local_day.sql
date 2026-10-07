-- Save current Goal targets and today's existing nutrition snapshot together.
-- No history is backfilled; earlier days and logged meal snapshots stay untouched.
CREATE FUNCTION public.save_bulk_targets_for_local_day(
  _profile uuid,
  _targets jsonb,
  _timezone text
)
RETURNS date
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  caller uuid := (SELECT auth.uid());
  local_day date;
BEGIN
  IF caller IS NULL THEN
    RAISE EXCEPTION 'Authentication required' USING ERRCODE = '42501';
  END IF;
  IF _timezone IS NULL OR NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_timezone_names WHERE name = _timezone
  ) THEN
    RAISE EXCEPTION 'Invalid device timezone' USING ERRCODE = '22023';
  END IF;
  local_day := (pg_catalog.now() AT TIME ZONE _timezone)::date;

  PERFORM 1 FROM public.bulk_profiles profile
  JOIN public.bulk_members member ON member.bulk_profile_id = profile.id
  WHERE profile.id = _profile AND profile.owner_id = caller
    AND member.user_id = caller AND member.role = 'owner'
  FOR UPDATE OF profile, member;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Goal profile not found' USING ERRCODE = '42501';
  END IF;

  IF pg_catalog.jsonb_typeof(_targets) IS DISTINCT FROM 'object'
    OR pg_catalog.jsonb_typeof(_targets->'calories') IS DISTINCT FROM 'number'
    OR pg_catalog.jsonb_typeof(_targets->'protein') IS DISTINCT FROM 'number'
    OR pg_catalog.jsonb_typeof(_targets->'carbs') IS DISTINCT FROM 'number'
    OR pg_catalog.jsonb_typeof(_targets->'fat') IS DISTINCT FROM 'number' THEN
    RAISE EXCEPTION 'Goal nutrition targets are unavailable' USING ERRCODE = '22023';
  END IF;
  -- Preserve the existing nutrition snapshot ranges and bulk_targets constraints.
  IF (_targets->>'calories')::numeric NOT BETWEEN 0 AND 20000
    OR (_targets->>'protein')::numeric NOT BETWEEN 0 AND 2000
    OR (_targets->>'carbs')::numeric NOT BETWEEN 0 AND 3000
    OR (_targets->>'fat')::numeric NOT BETWEEN 0 AND 2000 THEN
    RAISE EXCEPTION 'Goal nutrition targets are outside the allowed range' USING ERRCODE = '22023';
  END IF;

  INSERT INTO public.bulk_targets(bulk_profile_id, payload)
  VALUES (_profile, _targets)
  ON CONFLICT (bulk_profile_id) DO UPDATE SET payload = EXCLUDED.payload;

  UPDATE public.bulk_nutrition_days
  SET target_calories = (_targets->>'calories')::numeric,
      target_protein_g = (_targets->>'protein')::numeric,
      target_carbs_g = (_targets->>'carbs')::numeric,
      target_fat_g = (_targets->>'fat')::numeric,
      updated_at = pg_catalog.now()
  WHERE bulk_profile_id = _profile AND log_date = local_day;
  RETURN local_day;
END;
$function$;

REVOKE ALL ON FUNCTION public.save_bulk_targets_for_local_day(uuid,jsonb,text)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.save_bulk_targets_for_local_day(uuid,jsonb,text)
  TO authenticated;

-- Preserve existing day-creation rules; serialize only against same-profile target saves.
CREATE OR REPLACE FUNCTION private.ensure_bulk_nutrition_day(_profile uuid, _log_date date)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  day_id uuid;
  targets jsonb;
  calories numeric;
  protein numeric;
  carbs numeric;
  fat numeric;
BEGIN
  -- Use the same profile lock as target saving so a concurrent first meal cannot
  -- snapshot the old targets after the save has completed.
  PERFORM 1 FROM public.bulk_profiles WHERE id = _profile FOR UPDATE;

  SELECT id INTO day_id FROM public.bulk_nutrition_days
  WHERE bulk_profile_id = _profile AND log_date = _log_date FOR UPDATE;
  IF day_id IS NOT NULL THEN RETURN day_id; END IF;

  SELECT payload INTO targets FROM public.bulk_targets WHERE bulk_profile_id = _profile;
  IF targets IS NULL
    OR pg_catalog.jsonb_typeof(targets->'calories') <> 'number'
    OR pg_catalog.jsonb_typeof(targets->'protein') <> 'number'
    OR pg_catalog.jsonb_typeof(targets->'carbs') <> 'number'
    OR pg_catalog.jsonb_typeof(targets->'fat') <> 'number' THEN
    RAISE EXCEPTION 'Goal nutrition targets are unavailable';
  END IF;
  calories := (targets->>'calories')::numeric;
  protein := (targets->>'protein')::numeric;
  carbs := (targets->>'carbs')::numeric;
  fat := (targets->>'fat')::numeric;
  IF calories NOT BETWEEN 0 AND 20000
    OR protein NOT BETWEEN 0 AND 2000
    OR carbs NOT BETWEEN 0 AND 3000
    OR fat NOT BETWEEN 0 AND 2000 THEN
    RAISE EXCEPTION 'Goal nutrition targets are outside the allowed range';
  END IF;
  INSERT INTO public.bulk_nutrition_days(
    bulk_profile_id, log_date, target_calories, target_protein_g, target_carbs_g, target_fat_g
  ) VALUES (_profile, _log_date, calories, protein, carbs, fat)
  RETURNING id INTO day_id;
  RETURN day_id;
END;
$function$;

REVOKE ALL ON FUNCTION private.ensure_bulk_nutrition_day(uuid,date)
  FROM PUBLIC, anon, authenticated;
