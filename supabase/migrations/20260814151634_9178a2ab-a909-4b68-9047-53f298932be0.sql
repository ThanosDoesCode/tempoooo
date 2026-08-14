REVOKE ALL ON FUNCTION public.bulk_role_of(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.can_read_bulk(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.can_write_bulk(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.is_bulk_owner(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.is_challenge_member(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.challenge_today(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.challenge_week_of(uuid, date) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.challenge_week_open(uuid, date) FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.bulk_role_of(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.can_read_bulk(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.can_write_bulk(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_bulk_owner(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_challenge_member(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.challenge_today(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.challenge_week_of(uuid, date) TO authenticated;
GRANT EXECUTE ON FUNCTION public.challenge_week_open(uuid, date) TO authenticated;