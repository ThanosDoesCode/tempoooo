-- Segment 12: explicitly apply one conservative public Bulk calorie recommendation.
-- Recommendations remain derived; this mutates only the current calorie target.
CREATE FUNCTION public.apply_bulk_calorie_recommendation(
  _expected_current_calories numeric,
  _new_calories numeric
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  profile_id uuid := private.current_bulk_profile();
  targets jsonb;
  current_calories numeric;
BEGIN
  IF profile_id IS NULL OR _expected_current_calories IS NULL OR _new_calories IS NULL THEN
    RAISE EXCEPTION 'Invalid calorie recommendation request';
  END IF;

  SELECT payload INTO targets
  FROM public.bulk_targets
  WHERE bulk_profile_id = profile_id
  FOR UPDATE;

  IF targets IS NULL OR NOT targets ? 'trainingSetupPreference'
    OR jsonb_typeof(targets->'calories') <> 'number' THEN
    RAISE EXCEPTION 'Public Bulk targets are unavailable';
  END IF;
  current_calories := (targets->>'calories')::numeric;

  -- An exact retry after a successful application is idempotent.
  IF current_calories = _new_calories THEN RETURN true; END IF;
  IF current_calories <> _expected_current_calories THEN
    RAISE EXCEPTION 'Calorie target changed on another device';
  END IF;
  IF _new_calories < 1000 OR _new_calories > 10000
    OR abs(_new_calories - current_calories) > 150
    OR abs(_new_calories - current_calories) = 0
    OR mod(_new_calories, 50) <> 0 THEN
    RAISE EXCEPTION 'Calorie recommendation is outside the allowed adjustment';
  END IF;

  UPDATE public.bulk_targets
  SET payload = jsonb_set(payload, '{calories}', to_jsonb(_new_calories), false),
      updated_at = now()
  WHERE bulk_profile_id = profile_id;
  RETURN true;
END;
$function$;

REVOKE ALL ON FUNCTION public.apply_bulk_calorie_recommendation(numeric,numeric)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.apply_bulk_calorie_recommendation(numeric,numeric)
  TO authenticated, service_role;
