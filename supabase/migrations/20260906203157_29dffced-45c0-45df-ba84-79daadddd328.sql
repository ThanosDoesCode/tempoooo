CREATE OR REPLACE FUNCTION public.create_challenge_atomic(
  _caller uuid,
  _request_id uuid,
  _name text,
  _start_date date,
  _timezone text,
  _duration_weeks integer,
  _invited_email text,
  _token_hash text,
  _weekly_target_km numeric,
  _penalty_mode text,
  _penalty_high_eur numeric,
  _penalty_medium_eur numeric,
  _penalty_low_eur numeric,
  _penalty_high_custom text,
  _penalty_medium_custom text,
  _penalty_low_custom text,
  _travel_pause_enabled boolean,
  _travel_pause_home_countries text[]
)
RETURNS uuid
LANGUAGE sql
SECURITY DEFINER
SET search_path TO ''
AS $function$
  SELECT private.create_challenge_atomic(
    _caller, _request_id, _name, _start_date, _timezone, _duration_weeks, _invited_email,
    _token_hash, _weekly_target_km, _penalty_mode, _penalty_high_eur, _penalty_medium_eur,
    _penalty_low_eur, _penalty_high_custom, _penalty_medium_custom, _penalty_low_custom,
    _travel_pause_enabled, _travel_pause_home_countries
  );
$function$;

CREATE OR REPLACE FUNCTION public.disable_challenge_push(_caller uuid)
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path TO ''
AS $function$
  SELECT private.disable_challenge_push(_caller);
$function$;

REVOKE ALL ON FUNCTION public.create_challenge_atomic(
  uuid, uuid, text, date, text, integer, text, text, numeric, text,
  numeric, numeric, numeric, text, text, text, boolean, text[]
) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.disable_challenge_push(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.create_challenge_atomic(
  uuid, uuid, text, date, text, integer, text, text, numeric, text,
  numeric, numeric, numeric, text, text, text, boolean, text[]
) TO service_role;
GRANT EXECUTE ON FUNCTION public.disable_challenge_push(uuid) TO service_role;