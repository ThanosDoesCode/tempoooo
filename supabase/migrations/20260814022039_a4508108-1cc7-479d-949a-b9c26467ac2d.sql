
revoke execute on function public.bulk_role_of(uuid) from anon, public;
revoke execute on function public.can_read_bulk(uuid) from anon, public;
revoke execute on function public.can_write_bulk(uuid) from anon, public;
revoke execute on function public.is_bulk_owner(uuid) from anon, public;
revoke execute on function public.is_challenge_member(uuid) from anon, public;
revoke execute on function public.challenge_today(uuid) from anon, public;
revoke execute on function public.challenge_week_of(uuid, date) from anon, public;
revoke execute on function public.challenge_week_open(uuid, date) from anon, public;
revoke execute on function public.safe_uuid(text) from anon, public;
grant execute on function public.bulk_role_of(uuid) to authenticated;
grant execute on function public.can_read_bulk(uuid) to authenticated;
grant execute on function public.can_write_bulk(uuid) to authenticated;
grant execute on function public.is_bulk_owner(uuid) to authenticated;
grant execute on function public.is_challenge_member(uuid) to authenticated;
grant execute on function public.challenge_today(uuid) to authenticated;
grant execute on function public.challenge_week_of(uuid, date) to authenticated;
grant execute on function public.challenge_week_open(uuid, date) to authenticated;
grant execute on function public.safe_uuid(text) to authenticated;
