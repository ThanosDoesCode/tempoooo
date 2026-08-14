CREATE SCHEMA IF NOT EXISTS private;
REVOKE ALL ON SCHEMA private FROM PUBLIC, anon;
GRANT USAGE ON SCHEMA private TO authenticated, service_role;

ALTER FUNCTION public.bulk_role_of(uuid) SET SCHEMA private;
ALTER FUNCTION public.can_read_bulk(uuid) SET SCHEMA private;
ALTER FUNCTION public.can_write_bulk(uuid) SET SCHEMA private;
ALTER FUNCTION public.is_bulk_owner(uuid) SET SCHEMA private;
ALTER FUNCTION public.is_challenge_member(uuid) SET SCHEMA private;
ALTER FUNCTION public.challenge_today(uuid) SET SCHEMA private;
ALTER FUNCTION public.challenge_week_of(uuid, date) SET SCHEMA private;
ALTER FUNCTION public.challenge_week_open(uuid, date) SET SCHEMA private;

REVOKE ALL ON FUNCTION private.bulk_role_of(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION private.can_read_bulk(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION private.can_write_bulk(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION private.is_bulk_owner(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION private.is_challenge_member(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION private.challenge_today(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION private.challenge_week_of(uuid, date) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION private.challenge_week_open(uuid, date) FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION private.bulk_role_of(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION private.can_read_bulk(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION private.can_write_bulk(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION private.is_bulk_owner(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION private.is_challenge_member(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION private.challenge_today(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION private.challenge_week_of(uuid, date) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION private.challenge_week_open(uuid, date) TO authenticated, service_role;

CREATE FUNCTION public.challenge_today(_c uuid)
RETURNS date
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public, private
AS $function$
  SELECT private.challenge_today(_c)
$function$;

CREATE FUNCTION public.challenge_week_of(_c uuid, _d date)
RETURNS integer
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public, private
AS $function$
  SELECT private.challenge_week_of(_c, _d)
$function$;

CREATE FUNCTION public.challenge_week_open(_c uuid, _d date)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public, private
AS $function$
  SELECT private.challenge_week_open(_c, _d)
$function$;

REVOKE ALL ON FUNCTION public.challenge_today(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.challenge_week_of(uuid, date) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.challenge_week_open(uuid, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.challenge_today(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.challenge_week_of(uuid, date) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.challenge_week_open(uuid, date) TO authenticated, service_role;