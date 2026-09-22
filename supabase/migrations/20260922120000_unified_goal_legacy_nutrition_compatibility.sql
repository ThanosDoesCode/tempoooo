-- A migrated legacy Goal can have complete calorie and macro targets without
-- the later public-onboarding presentation preference. Nutrition-day creation
-- depends only on the persisted targets it snapshots.
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
