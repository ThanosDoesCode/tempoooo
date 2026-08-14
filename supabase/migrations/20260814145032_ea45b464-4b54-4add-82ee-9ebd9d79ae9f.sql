-- Harden SECURITY DEFINER functions that must remain callable by signed-in users.
-- 1) Remove implicit PUBLIC/anon execute rights, grant only to authenticated.
REVOKE ALL ON FUNCTION public.accept_bulk_invitation(text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.accept_challenge_invitation(text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.ensure_bulk_profile() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.set_bulk_editor(uuid, uuid, boolean) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.finalize_challenge(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.related_profiles() FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.accept_bulk_invitation(text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.accept_challenge_invitation(text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.ensure_bulk_profile() TO authenticated;
GRANT EXECUTE ON FUNCTION public.set_bulk_editor(uuid, uuid, boolean) TO authenticated;
GRANT EXECUTE ON FUNCTION public.finalize_challenge(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.related_profiles() TO authenticated;

-- 2) Add explicit in-function caller checks so a definer function cannot act without a session.
CREATE OR REPLACE FUNCTION public.set_bulk_editor(_bulk uuid, _user uuid, _editor boolean)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
begin
  if auth.uid() is null then raise exception 'Not authenticated'; end if;
  if not public.is_bulk_owner(_bulk) then raise exception 'Only the owner can change roles'; end if;
  update public.bulk_members set role = case when _editor then 'editor'::public.bulk_role else 'viewer'::public.bulk_role end
   where bulk_profile_id=_bulk and user_id=_user and role <> 'owner';
  update public.bulk_profiles set allow_editor = _editor where id = _bulk;
end; $function$;

CREATE OR REPLACE FUNCTION public.finalize_challenge(_c uuid)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
declare ch record; cur int; w int; m record; other uuid;
  run_km numeric; cyc_km numeric; eq numeric; pen numeric; wk_id uuid; inserted int := 0;
begin
  if auth.uid() is null then raise exception 'Not authenticated'; end if;
  if not public.is_challenge_member(_c) then raise exception 'Not a member of this challenge'; end if;
  select * into ch from public.challenges where id=_c;
  cur := public.challenge_week_of(_c, public.challenge_today(_c));
  for w in 1 .. least(cur - 1, ch.duration_weeks) loop
    for m in select user_id from public.challenge_members where challenge_id=_c loop
      if exists(select 1 from public.challenge_weeks where challenge_id=_c and user_id=m.user_id and week_number=w) then continue; end if;
      select coalesce(sum(case when activity_type='run' then distance_km else 0 end),0),
             coalesce(sum(case when activity_type='cycle' then distance_km else 0 end),0),
             coalesce(sum(equivalent_km),0)
        into run_km, cyc_km, eq
        from public.challenge_activities
       where challenge_id=_c and user_id=m.user_id
         and activity_date >= ch.start_date + ((w-1)*7)
         and activity_date <= ch.start_date + ((w-1)*7) + 6;
      pen := public.penalty_for(eq);
      insert into public.challenge_weeks(challenge_id,user_id,week_number,week_start,week_end,running_km,cycling_km,equivalent_km,target_km,completed,penalty_eur)
      values (_c,m.user_id,w, ch.start_date + ((w-1)*7), ch.start_date + ((w-1)*7) + 6, run_km, cyc_km, round(eq,2), ch.weekly_target_km, eq >= ch.weekly_target_km, pen)
      returning id into wk_id;
      inserted := inserted + 1;
      if pen > 0 then
        select cm.user_id into other from public.challenge_members cm where cm.challenge_id=_c and cm.user_id <> m.user_id limit 1;
        if other is not null then
          insert into public.challenge_payments(challenge_id, week_id, payer_id, recipient_id, amount_eur)
          values (_c, wk_id, m.user_id, other, pen) on conflict (week_id) do nothing;
        end if;
      end if;
    end loop;
  end loop;
  return inserted;
end; $function$;

CREATE OR REPLACE FUNCTION public.related_profiles()
RETURNS TABLE(id uuid, display_name text, email text)
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  select p.id, p.display_name, p.email from public.profiles p
  where auth.uid() is not null
    and (p.id = auth.uid()
     or p.id in (select bm.user_id from public.bulk_members bm
                 where bm.bulk_profile_id in (select bulk_profile_id from public.bulk_members where user_id = auth.uid()))
     or p.id in (select cm.user_id from public.challenge_members cm
                 where cm.challenge_id in (select challenge_id from public.challenge_members where user_id = auth.uid())))
$function$;

REVOKE ALL ON FUNCTION public.set_bulk_editor(uuid, uuid, boolean) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.finalize_challenge(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.related_profiles() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_bulk_editor(uuid, uuid, boolean) TO authenticated;
GRANT EXECUTE ON FUNCTION public.finalize_challenge(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.related_profiles() TO authenticated;