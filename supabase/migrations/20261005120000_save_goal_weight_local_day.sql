-- Morning check-in accepts today's calendar date in the validated device timezone.
-- It is not a historical-weight/backfill endpoint. The server derives the current
-- local date; supplying a valid timezone never permits tomorrow in that timezone.
-- Evaluate the unchanged table constraint in that timezone for this write only.
-- The function's TimeZone setting restores the caller's setting on return/error.
-- No stored rows, table constraints, RLS policies or existing table grants are changed.
CREATE FUNCTION public.save_bulk_weight_for_local_day(
  _profile uuid,
  _log_date date,
  _weight_kg numeric,
  _note text,
  _timezone text
)
RETURNS void
LANGUAGE plpgsql SECURITY INVOKER
SET search_path = ''
SET TimeZone = 'UTC'
AS $function$
DECLARE caller uuid := (SELECT auth.uid());
BEGIN
  IF caller IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  IF _profile IS NULL OR _log_date IS NULL OR _weight_kg IS NULL THEN
    RAISE EXCEPTION 'Missing weight entry';
  END IF;
  IF _timezone IS NULL OR NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_timezone_names WHERE name = _timezone
  ) THEN RAISE EXCEPTION 'Invalid device timezone'; END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.bulk_profiles p
    JOIN public.bulk_members m ON m.bulk_profile_id = p.id
    WHERE p.id = _profile AND p.owner_id = caller
      AND m.user_id = caller AND m.role = 'owner'
  ) THEN RAISE EXCEPTION 'Goal profile not found'; END IF;

  IF _log_date IS DISTINCT FROM (pg_catalog.now() AT TIME ZONE _timezone)::date THEN
    RAISE EXCEPTION 'Weight date must be today in the supplied timezone';
  END IF;

  PERFORM pg_catalog.set_config('TimeZone', _timezone, true);
  INSERT INTO public.bulk_weight_entries(bulk_profile_id, log_date, weight_kg, note)
  VALUES (_profile, _log_date, _weight_kg, _note)
  ON CONFLICT (bulk_profile_id, log_date)
  DO UPDATE SET weight_kg = EXCLUDED.weight_kg, note = EXCLUDED.note;
END;
$function$;

REVOKE ALL ON FUNCTION public.save_bulk_weight_for_local_day(uuid,date,numeric,text,text)
  FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.save_bulk_weight_for_local_day(uuid,date,numeric,text,text)
  TO authenticated;
