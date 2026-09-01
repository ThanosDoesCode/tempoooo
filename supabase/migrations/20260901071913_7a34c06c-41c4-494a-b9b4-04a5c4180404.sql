CREATE OR REPLACE FUNCTION public.guard_activity()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if tg_op = 'INSERT' then
    if new.user_id <> auth.uid() then raise exception 'You can only log your own activities'; end if;
    if not public.challenge_week_open(new.challenge_id, new.activity_date) then
      raise exception 'That week is closed or the date is invalid';
    end if;
    return new;
  end if;
  if tg_op = 'UPDATE' then
    if old.user_id <> auth.uid() then raise exception 'You can only edit your own activities'; end if;
    if not public.challenge_week_open(old.challenge_id, old.activity_date)
       or not public.challenge_week_open(new.challenge_id, new.activity_date) then
      raise exception 'That week is closed';
    end if;
    if new.user_id <> old.user_id or new.challenge_id <> old.challenge_id then raise exception 'Immutable activity identity'; end if;
    if new.activity_type is distinct from old.activity_type
       or new.distance_km is distinct from old.distance_km
       or new.activity_date is distinct from old.activity_date then
      new.edited := true;
      insert into public.challenge_activity_audit(activity_id, challenge_id, changed_by, action, old_activity_type, old_distance_km, old_activity_date)
      values (old.id, old.challenge_id, auth.uid(), 'update', old.activity_type, old.distance_km, old.activity_date);
    end if;
    return new;
  end if;
  if old.user_id <> auth.uid() then raise exception 'You can only delete your own activities'; end if;
  if not public.challenge_week_open(old.challenge_id, old.activity_date) then raise exception 'That week is closed'; end if;
  insert into public.challenge_activity_audit(activity_id, challenge_id, changed_by, action, old_activity_type, old_distance_km, old_activity_date)
  values (old.id, old.challenge_id, auth.uid(), 'delete', old.activity_type, old.distance_km, old.activity_date);
  return old;
end; $function$;

REVOKE EXECUTE ON FUNCTION public.guard_activity() FROM PUBLIC, anon, authenticated;