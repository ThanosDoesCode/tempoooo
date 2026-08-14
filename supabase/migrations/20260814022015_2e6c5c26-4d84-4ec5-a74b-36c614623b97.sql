
create type public.bulk_role as enum ('owner','viewer','editor');
create type public.activity_kind as enum ('run','cycle');
create type public.payment_status as enum ('unpaid','marked_paid','confirmed_paid');
create type public.challenge_status as enum ('draft','active','completed');

create or replace function public.touch_updated_at()
returns trigger language plpgsql set search_path = public as $$
begin new.updated_at = now(); return new; end; $$;

create or replace function public.safe_uuid(_t text)
returns uuid language plpgsql immutable set search_path = public as $$
begin return _t::uuid; exception when others then return null; end; $$;

-- ============ PROFILES ============
create table public.profiles (
  id uuid primary key,
  email text,
  display_name text,
  avatar_url text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
grant select, insert, update on public.profiles to authenticated;
grant all on public.profiles to service_role;
alter table public.profiles enable row level security;
create policy "profiles self insert" on public.profiles for insert to authenticated with check (id = auth.uid());
create policy "profiles self update" on public.profiles for update to authenticated using (id = auth.uid()) with check (id = auth.uid());
create policy "profiles self read" on public.profiles for select to authenticated using (id = auth.uid());
create trigger profiles_touch before update on public.profiles for each row execute function public.touch_updated_at();

-- ============ BULK CORE ============
create table public.bulk_profiles (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null,
  name text not null default 'My Bulk',
  allow_editor boolean not null default false,
  created_at timestamptz not null default now()
);
create unique index bulk_profiles_owner_unique on public.bulk_profiles(owner_id);

create table public.bulk_members (
  id uuid primary key default gen_random_uuid(),
  bulk_profile_id uuid not null references public.bulk_profiles(id) on delete cascade,
  user_id uuid not null,
  role public.bulk_role not null default 'viewer',
  invited_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (bulk_profile_id, user_id)
);
create unique index bulk_members_one_owner on public.bulk_members(bulk_profile_id) where role = 'owner';
create index bulk_members_user_idx on public.bulk_members(user_id);
create trigger bulk_members_touch before update on public.bulk_members for each row execute function public.touch_updated_at();

create table public.bulk_invitations (
  id uuid primary key default gen_random_uuid(),
  bulk_profile_id uuid not null references public.bulk_profiles(id) on delete cascade,
  invited_email text not null,
  role public.bulk_role not null default 'viewer',
  token_hash text not null unique,
  expires_at timestamptz not null,
  accepted_at timestamptz,
  revoked_at timestamptz,
  created_by uuid not null,
  created_at timestamptz not null default now(),
  constraint bulk_invitation_role_ck check (role in ('viewer','editor'))
);
create index bulk_invitations_email_idx on public.bulk_invitations(lower(invited_email));

create or replace function public.bulk_role_of(_bulk uuid)
returns public.bulk_role language sql stable security definer set search_path = public as $$
  select role from public.bulk_members where bulk_profile_id = _bulk and user_id = auth.uid()
$$;
create or replace function public.can_read_bulk(_bulk uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists(select 1 from public.bulk_members where bulk_profile_id=_bulk and user_id=auth.uid())
$$;
create or replace function public.can_write_bulk(_bulk uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists(select 1 from public.bulk_members where bulk_profile_id=_bulk and user_id=auth.uid() and role in ('owner','editor'))
$$;
create or replace function public.is_bulk_owner(_bulk uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists(select 1 from public.bulk_members where bulk_profile_id=_bulk and user_id=auth.uid() and role='owner')
$$;

create or replace function public.protect_bulk_owner()
returns trigger language plpgsql set search_path = public as $$
begin
  if tg_op = 'DELETE' then
    if old.role = 'owner' then raise exception 'The owner cannot be removed'; end if;
    return old;
  end if;
  if old.role = 'owner' and new.role <> 'owner' then raise exception 'The owner role cannot be changed'; end if;
  if new.role = 'owner' and old.role <> 'owner' then raise exception 'Ownership cannot be transferred'; end if;
  if new.user_id <> old.user_id or new.bulk_profile_id <> old.bulk_profile_id then raise exception 'Immutable membership identity'; end if;
  return new;
end; $$;
create trigger bulk_members_protect_owner before update or delete on public.bulk_members
  for each row execute function public.protect_bulk_owner();

grant select, insert, update, delete on public.bulk_profiles to authenticated;
grant all on public.bulk_profiles to service_role;
grant select, insert, update, delete on public.bulk_members to authenticated;
grant all on public.bulk_members to service_role;
grant select, insert, update, delete on public.bulk_invitations to authenticated;
grant all on public.bulk_invitations to service_role;

alter table public.bulk_profiles enable row level security;
alter table public.bulk_members enable row level security;
alter table public.bulk_invitations enable row level security;

create policy "bulk_profiles read members" on public.bulk_profiles for select to authenticated using (public.can_read_bulk(id));
create policy "bulk_profiles insert self" on public.bulk_profiles for insert to authenticated with check (owner_id = auth.uid());
create policy "bulk_profiles owner update" on public.bulk_profiles for update to authenticated using (public.is_bulk_owner(id)) with check (owner_id = auth.uid());
create policy "bulk_profiles owner delete" on public.bulk_profiles for delete to authenticated using (owner_id = auth.uid());

create policy "bulk_members read" on public.bulk_members for select to authenticated using (public.can_read_bulk(bulk_profile_id));
create policy "bulk_members owner insert" on public.bulk_members for insert to authenticated
  with check (public.is_bulk_owner(bulk_profile_id) or (role='owner' and user_id = auth.uid() and exists(select 1 from public.bulk_profiles p where p.id=bulk_profile_id and p.owner_id=auth.uid())));
create policy "bulk_members owner update" on public.bulk_members for update to authenticated using (public.is_bulk_owner(bulk_profile_id)) with check (public.is_bulk_owner(bulk_profile_id));
create policy "bulk_members owner delete" on public.bulk_members for delete to authenticated using (public.is_bulk_owner(bulk_profile_id));

create policy "bulk_inv owner read" on public.bulk_invitations for select to authenticated using (public.is_bulk_owner(bulk_profile_id));
create policy "bulk_inv owner insert" on public.bulk_invitations for insert to authenticated with check (public.is_bulk_owner(bulk_profile_id) and created_by = auth.uid());
create policy "bulk_inv owner update" on public.bulk_invitations for update to authenticated using (public.is_bulk_owner(bulk_profile_id)) with check (public.is_bulk_owner(bulk_profile_id));

-- ============ BULK DATA ============
create table public.bulk_targets (
  bulk_profile_id uuid primary key references public.bulk_profiles(id) on delete cascade,
  payload jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);
create table public.bulk_days (
  id uuid primary key default gen_random_uuid(),
  bulk_profile_id uuid not null references public.bulk_profiles(id) on delete cascade,
  day date not null,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (bulk_profile_id, day)
);
create table public.bulk_workouts (
  id uuid primary key default gen_random_uuid(),
  bulk_profile_id uuid not null references public.bulk_profiles(id) on delete cascade,
  day date not null,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (bulk_profile_id, day)
);
create table public.bulk_week_notes (
  id uuid primary key default gen_random_uuid(),
  bulk_profile_id uuid not null references public.bulk_profiles(id) on delete cascade,
  week_start date not null,
  note text not null default '',
  updated_at timestamptz not null default now(),
  unique (bulk_profile_id, week_start)
);
create table public.bulk_photos (
  id uuid primary key default gen_random_uuid(),
  bulk_profile_id uuid not null references public.bulk_profiles(id) on delete cascade,
  taken_on date not null,
  weight numeric(6,2),
  front_path text,
  side_path text,
  back_path text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index bulk_photos_profile_idx on public.bulk_photos(bulk_profile_id, taken_on);

create trigger bulk_targets_touch before update on public.bulk_targets for each row execute function public.touch_updated_at();
create trigger bulk_days_touch before update on public.bulk_days for each row execute function public.touch_updated_at();
create trigger bulk_workouts_touch before update on public.bulk_workouts for each row execute function public.touch_updated_at();
create trigger bulk_week_notes_touch before update on public.bulk_week_notes for each row execute function public.touch_updated_at();
create trigger bulk_photos_touch before update on public.bulk_photos for each row execute function public.touch_updated_at();

do $$
declare t text;
begin
  foreach t in array array['bulk_targets','bulk_days','bulk_workouts','bulk_week_notes','bulk_photos'] loop
    execute format('grant select, insert, update, delete on public.%I to authenticated', t);
    execute format('grant all on public.%I to service_role', t);
    execute format('alter table public.%I enable row level security', t);
    execute format('create policy "%1$s read" on public.%1$I for select to authenticated using (public.can_read_bulk(bulk_profile_id))', t);
    execute format('create policy "%1$s insert" on public.%1$I for insert to authenticated with check (public.can_write_bulk(bulk_profile_id))', t);
    execute format('create policy "%1$s update" on public.%1$I for update to authenticated using (public.can_write_bulk(bulk_profile_id)) with check (public.can_write_bulk(bulk_profile_id))', t);
    execute format('create policy "%1$s delete" on public.%1$I for delete to authenticated using (public.is_bulk_owner(bulk_profile_id))', t);
  end loop;
end $$;

-- ============ CHALLENGES ============
create table public.challenges (
  id uuid primary key default gen_random_uuid(),
  created_by uuid not null,
  name text not null,
  start_date date not null,
  duration_weeks integer not null default 52,
  timezone text not null default 'Europe/Athens',
  weekly_target_km numeric(6,2) not null default 15,
  running_ratio numeric(5,2) not null default 1,
  cycling_ratio numeric(5,2) not null default 3,
  max_members integer not null default 2,
  status public.challenge_status not null default 'active',
  rules_locked_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  constraint challenge_duration_ck check (duration_weeks >= 52),
  constraint challenge_max_members_ck check (max_members = 2),
  constraint challenge_ratio_ck check (cycling_ratio = 3 and running_ratio = 1),
  constraint challenge_target_ck check (weekly_target_km = 15)
);

create table public.challenge_members (
  id uuid primary key default gen_random_uuid(),
  challenge_id uuid not null references public.challenges(id) on delete cascade,
  user_id uuid not null,
  role text not null default 'member',
  joined_at timestamptz not null default now(),
  unique (challenge_id, user_id)
);
create index challenge_members_user_idx on public.challenge_members(user_id);

create or replace function public.enforce_challenge_capacity()
returns trigger language plpgsql set search_path = public as $$
declare n integer; cap integer;
begin
  select count(*) into n from public.challenge_members where challenge_id = new.challenge_id;
  select max_members into cap from public.challenges where id = new.challenge_id;
  if n >= cap then raise exception 'This challenge is full'; end if;
  return new;
end; $$;
create trigger challenge_members_capacity before insert on public.challenge_members
  for each row execute function public.enforce_challenge_capacity();

create or replace function public.is_challenge_member(_c uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists(select 1 from public.challenge_members where challenge_id=_c and user_id=auth.uid())
$$;

create table public.challenge_invitations (
  id uuid primary key default gen_random_uuid(),
  challenge_id uuid not null references public.challenges(id) on delete cascade,
  invited_email text not null,
  token_hash text not null unique,
  expires_at timestamptz not null,
  accepted_at timestamptz,
  revoked_at timestamptz,
  created_by uuid not null,
  created_at timestamptz not null default now()
);
create index challenge_inv_email_idx on public.challenge_invitations(lower(invited_email));

create table public.challenge_activities (
  id uuid primary key default gen_random_uuid(),
  challenge_id uuid not null references public.challenges(id) on delete cascade,
  user_id uuid not null,
  activity_type public.activity_kind not null,
  distance_km numeric(7,2) not null check (distance_km > 0 and distance_km <= 1000),
  equivalent_km numeric(8,4) generated always as (
    case when activity_type = 'run' then distance_km else distance_km / 3 end
  ) stored,
  activity_date date not null,
  duration_seconds integer check (duration_seconds is null or duration_seconds > 0),
  evidence_path text not null,
  external_activity_url text,
  verification_source text not null default 'manual_strava_screenshot',
  strava_activity_id text,
  strava_athlete_id text,
  note text,
  edited boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint verification_source_ck check (verification_source in ('manual_strava_screenshot','strava_api'))
);
create index challenge_activities_idx on public.challenge_activities(challenge_id, activity_date);
create index challenge_activities_user_idx on public.challenge_activities(challenge_id, user_id, activity_date);

create table public.challenge_activity_audit (
  id uuid primary key default gen_random_uuid(),
  activity_id uuid not null,
  challenge_id uuid not null references public.challenges(id) on delete cascade,
  changed_by uuid not null,
  action text not null,
  old_activity_type public.activity_kind,
  old_distance_km numeric(7,2),
  old_activity_date date,
  changed_at timestamptz not null default now()
);
create index challenge_audit_idx on public.challenge_activity_audit(activity_id);

create table public.challenge_weeks (
  id uuid primary key default gen_random_uuid(),
  challenge_id uuid not null references public.challenges(id) on delete cascade,
  user_id uuid not null,
  week_number integer not null,
  week_start date not null,
  week_end date not null,
  running_km numeric(8,2) not null default 0,
  cycling_km numeric(8,2) not null default 0,
  equivalent_km numeric(8,2) not null default 0,
  target_km numeric(6,2) not null default 15,
  completed boolean not null default false,
  penalty_eur numeric(6,2) not null default 0,
  finalized_at timestamptz not null default now(),
  unique (challenge_id, user_id, week_number)
);

create table public.challenge_payments (
  id uuid primary key default gen_random_uuid(),
  challenge_id uuid not null references public.challenges(id) on delete cascade,
  week_id uuid not null references public.challenge_weeks(id) on delete cascade,
  payer_id uuid not null,
  recipient_id uuid not null,
  amount_eur numeric(6,2) not null check (amount_eur > 0),
  status public.payment_status not null default 'unpaid',
  marked_paid_at timestamptz,
  confirmed_at timestamptz,
  payment_evidence_path text,
  created_at timestamptz not null default now(),
  unique (week_id)
);

create trigger challenge_activities_touch before update on public.challenge_activities for each row execute function public.touch_updated_at();

create or replace function public.penalty_for(_km numeric)
returns numeric language sql immutable set search_path = public as $$
  select case when _km >= 15 then 0 when _km >= 10 then 5 when _km >= 5 then 10 else 15 end::numeric
$$;

create or replace function public.challenge_today(_c uuid)
returns date language sql stable security definer set search_path = public as $$
  select (now() at time zone (select timezone from public.challenges where id=_c))::date
$$;

create or replace function public.challenge_week_of(_c uuid, _d date)
returns integer language sql stable security definer set search_path = public as $$
  select floor((_d - (select start_date from public.challenges where id=_c))::numeric / 7)::int + 1
$$;

create or replace function public.challenge_week_open(_c uuid, _d date)
returns boolean language plpgsql stable security definer set search_path = public as $$
declare w int; cur int; dur int;
begin
  select duration_weeks into dur from public.challenges where id=_c;
  if dur is null then return false; end if;
  w := public.challenge_week_of(_c, _d);
  cur := public.challenge_week_of(_c, public.challenge_today(_c));
  return w = cur and w >= 1 and w <= dur and _d <= public.challenge_today(_c);
end; $$;

create or replace function public.finalize_challenge(_c uuid)
returns integer language plpgsql security definer set search_path = public as $$
declare ch record; cur int; w int; m record; other uuid;
  run_km numeric; cyc_km numeric; eq numeric; pen numeric; wk_id uuid; inserted int := 0;
begin
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
end; $$;
revoke all on function public.finalize_challenge(uuid) from public, anon;
grant execute on function public.finalize_challenge(uuid) to authenticated;

create or replace function public.guard_activity()
returns trigger language plpgsql set search_path = public as $$
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
end; $$;
create trigger challenge_activities_guard before insert or update or delete on public.challenge_activities
  for each row execute function public.guard_activity();

create or replace function public.block_change()
returns trigger language plpgsql set search_path = public as $$
begin raise exception 'Finalized results are immutable'; end; $$;
create trigger challenge_weeks_immutable before update or delete on public.challenge_weeks
  for each row execute function public.block_change();

grant select, insert, update, delete on public.challenges to authenticated;
grant select, insert, update, delete on public.challenge_members to authenticated;
grant select, insert, update, delete on public.challenge_invitations to authenticated;
grant select, insert, update, delete on public.challenge_activities to authenticated;
grant select on public.challenge_activity_audit to authenticated;
grant select on public.challenge_weeks to authenticated;
grant select, update on public.challenge_payments to authenticated;
do $$
declare t text;
begin
  foreach t in array array['challenges','challenge_members','challenge_invitations','challenge_activities','challenge_activity_audit','challenge_weeks','challenge_payments'] loop
    execute format('grant all on public.%I to service_role', t);
    execute format('alter table public.%I enable row level security', t);
  end loop;
end $$;

create policy "challenges read members" on public.challenges for select to authenticated using (public.is_challenge_member(id));
create policy "challenges insert self" on public.challenges for insert to authenticated with check (created_by = auth.uid());

create policy "cm read" on public.challenge_members for select to authenticated using (public.is_challenge_member(challenge_id));
create policy "cm insert creator" on public.challenge_members for insert to authenticated
  with check (user_id = auth.uid() and exists(select 1 from public.challenges c where c.id=challenge_id and c.created_by=auth.uid()));

create policy "ci read creator" on public.challenge_invitations for select to authenticated
  using (exists(select 1 from public.challenges c where c.id=challenge_id and c.created_by=auth.uid()));
create policy "ci insert creator" on public.challenge_invitations for insert to authenticated
  with check (created_by = auth.uid() and exists(select 1 from public.challenges c where c.id=challenge_id and c.created_by=auth.uid()));
create policy "ci update creator" on public.challenge_invitations for update to authenticated
  using (exists(select 1 from public.challenges c where c.id=challenge_id and c.created_by=auth.uid()))
  with check (exists(select 1 from public.challenges c where c.id=challenge_id and c.created_by=auth.uid()));

create policy "ca read members" on public.challenge_activities for select to authenticated using (public.is_challenge_member(challenge_id));
create policy "ca insert own" on public.challenge_activities for insert to authenticated
  with check (user_id = auth.uid() and public.is_challenge_member(challenge_id) and public.challenge_week_open(challenge_id, activity_date));
create policy "ca update own" on public.challenge_activities for update to authenticated
  using (user_id = auth.uid() and public.challenge_week_open(challenge_id, activity_date))
  with check (user_id = auth.uid() and public.challenge_week_open(challenge_id, activity_date));
create policy "ca delete own" on public.challenge_activities for delete to authenticated
  using (user_id = auth.uid() and public.challenge_week_open(challenge_id, activity_date));

create policy "caa read members" on public.challenge_activity_audit for select to authenticated using (public.is_challenge_member(challenge_id));
create policy "cw read members" on public.challenge_weeks for select to authenticated using (public.is_challenge_member(challenge_id));

create policy "cp read members" on public.challenge_payments for select to authenticated using (public.is_challenge_member(challenge_id));
create policy "cp members update" on public.challenge_payments for update to authenticated
  using (payer_id = auth.uid() or recipient_id = auth.uid())
  with check (payer_id = auth.uid() or recipient_id = auth.uid());

create or replace function public.guard_payment()
returns trigger language plpgsql set search_path = public as $$
begin
  if new.challenge_id <> old.challenge_id or new.week_id <> old.week_id
     or new.payer_id <> old.payer_id or new.recipient_id <> old.recipient_id
     or new.amount_eur <> old.amount_eur then
    raise exception 'Payment obligation is immutable';
  end if;
  if new.status = 'marked_paid' and old.status = 'unpaid' then
    if auth.uid() <> old.payer_id then raise exception 'Only the payer can mark a payment as paid'; end if;
    new.marked_paid_at := now();
  elsif new.status = 'confirmed_paid' and old.status <> 'confirmed_paid' then
    if auth.uid() <> old.recipient_id then raise exception 'Only the recipient can confirm a payment'; end if;
    if old.status <> 'marked_paid' then raise exception 'Payment must be marked as paid first'; end if;
    new.confirmed_at := now();
  elsif new.status = 'unpaid' and old.status = 'marked_paid' then
    if auth.uid() <> old.payer_id then raise exception 'Only the payer can undo this'; end if;
    new.marked_paid_at := null;
  elsif new.status <> old.status then
    raise exception 'Invalid payment transition';
  end if;
  if old.status = 'confirmed_paid' then raise exception 'Confirmed payments are final'; end if;
  return new;
end; $$;
create trigger challenge_payments_guard before update on public.challenge_payments
  for each row execute function public.guard_payment();

-- ============ RPCs ============
create or replace function public.ensure_bulk_profile()
returns uuid language plpgsql security definer set search_path = public as $$
declare bid uuid;
begin
  if auth.uid() is null then raise exception 'Not authenticated'; end if;
  select bulk_profile_id into bid from public.bulk_members where user_id = auth.uid() and role='owner' limit 1;
  if bid is not null then return bid; end if;
  insert into public.bulk_profiles(owner_id) values (auth.uid()) returning id into bid;
  insert into public.bulk_members(bulk_profile_id, user_id, role, invited_by) values (bid, auth.uid(), 'owner', auth.uid());
  insert into public.bulk_targets(bulk_profile_id, payload) values (bid, '{}'::jsonb) on conflict do nothing;
  return bid;
end; $$;
revoke all on function public.ensure_bulk_profile() from public, anon;
grant execute on function public.ensure_bulk_profile() to authenticated;

create or replace function public.set_bulk_editor(_bulk uuid, _user uuid, _editor boolean)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.is_bulk_owner(_bulk) then raise exception 'Only the owner can change roles'; end if;
  update public.bulk_members set role = case when _editor then 'editor'::public.bulk_role else 'viewer'::public.bulk_role end
   where bulk_profile_id=_bulk and user_id=_user and role <> 'owner';
  update public.bulk_profiles set allow_editor = _editor where id = _bulk;
end; $$;
revoke all on function public.set_bulk_editor(uuid,uuid,boolean) from public, anon;
grant execute on function public.set_bulk_editor(uuid,uuid,boolean) to authenticated;

create or replace function public.accept_bulk_invitation(_token text)
returns uuid language plpgsql security definer set search_path = public as $$
declare inv record; em text;
begin
  if auth.uid() is null then raise exception 'Not authenticated'; end if;
  em := lower(coalesce(auth.jwt() ->> 'email',''));
  select * into inv from public.bulk_invitations where token_hash = encode(sha256(_token::bytea),'hex') limit 1;
  if inv is null then raise exception 'Invalid invitation'; end if;
  if inv.accepted_at is not null or inv.revoked_at is not null then raise exception 'This invitation is no longer valid'; end if;
  if inv.expires_at < now() then raise exception 'This invitation has expired'; end if;
  if lower(inv.invited_email) <> em then raise exception 'This invitation was sent to a different email address'; end if;
  insert into public.bulk_members(bulk_profile_id, user_id, role, invited_by)
  values (inv.bulk_profile_id, auth.uid(), inv.role, inv.created_by)
  on conflict (bulk_profile_id, user_id) do nothing;
  update public.bulk_invitations set accepted_at = now() where id = inv.id;
  return inv.bulk_profile_id;
end; $$;
revoke all on function public.accept_bulk_invitation(text) from public, anon;
grant execute on function public.accept_bulk_invitation(text) to authenticated;

create or replace function public.accept_challenge_invitation(_token text)
returns uuid language plpgsql security definer set search_path = public as $$
declare inv record; em text; n int;
begin
  if auth.uid() is null then raise exception 'Not authenticated'; end if;
  em := lower(coalesce(auth.jwt() ->> 'email',''));
  select * into inv from public.challenge_invitations where token_hash = encode(sha256(_token::bytea),'hex') limit 1;
  if inv is null then raise exception 'Invalid invitation'; end if;
  if inv.accepted_at is not null or inv.revoked_at is not null then raise exception 'This invitation is no longer valid'; end if;
  if inv.expires_at < now() then raise exception 'This invitation has expired'; end if;
  if lower(inv.invited_email) <> em then raise exception 'This invitation was sent to a different email address'; end if;
  select count(*) into n from public.challenge_members where challenge_id = inv.challenge_id;
  if n >= 2 then raise exception 'This challenge is already full'; end if;
  insert into public.challenge_members(challenge_id, user_id) values (inv.challenge_id, auth.uid())
  on conflict (challenge_id, user_id) do nothing;
  update public.challenge_invitations set accepted_at = now() where id = inv.id;
  update public.challenge_invitations set revoked_at = now()
   where challenge_id = inv.challenge_id and accepted_at is null and revoked_at is null;
  return inv.challenge_id;
end; $$;
revoke all on function public.accept_challenge_invitation(text) from public, anon;
grant execute on function public.accept_challenge_invitation(text) to authenticated;

create or replace function public.related_profiles()
returns table(id uuid, display_name text, email text) language sql stable security definer set search_path = public as $$
  select p.id, p.display_name, p.email from public.profiles p
  where p.id = auth.uid()
     or p.id in (select bm.user_id from public.bulk_members bm
                 where bm.bulk_profile_id in (select bulk_profile_id from public.bulk_members where user_id = auth.uid()))
     or p.id in (select cm.user_id from public.challenge_members cm
                 where cm.challenge_id in (select challenge_id from public.challenge_members where user_id = auth.uid()))
$$;
revoke all on function public.related_profiles() from public, anon;
grant execute on function public.related_profiles() to authenticated;

-- ============ STORAGE POLICIES ============
create policy "bulk photos read" on storage.objects for select to authenticated
  using (bucket_id='bulk-progress-photos' and public.can_read_bulk(public.safe_uuid((storage.foldername(name))[1])));
create policy "bulk photos write" on storage.objects for insert to authenticated
  with check (bucket_id='bulk-progress-photos' and public.can_write_bulk(public.safe_uuid((storage.foldername(name))[1])));
create policy "bulk photos delete" on storage.objects for delete to authenticated
  using (bucket_id='bulk-progress-photos' and public.is_bulk_owner(public.safe_uuid((storage.foldername(name))[1])));

create policy "challenge evidence read" on storage.objects for select to authenticated
  using (bucket_id='challenge-evidence' and public.is_challenge_member(public.safe_uuid((storage.foldername(name))[1])));
create policy "challenge evidence write" on storage.objects for insert to authenticated
  with check (bucket_id='challenge-evidence' and public.is_challenge_member(public.safe_uuid((storage.foldername(name))[1])) and (storage.foldername(name))[2] = auth.uid()::text);
create policy "challenge evidence delete" on storage.objects for delete to authenticated
  using (bucket_id='challenge-evidence' and (storage.foldername(name))[2] = auth.uid()::text);

create policy "payment evidence read" on storage.objects for select to authenticated
  using (bucket_id='payment-evidence' and public.is_challenge_member(public.safe_uuid((storage.foldername(name))[1])));
create policy "payment evidence write" on storage.objects for insert to authenticated
  with check (bucket_id='payment-evidence' and public.is_challenge_member(public.safe_uuid((storage.foldername(name))[1])) and (storage.foldername(name))[2] = auth.uid()::text);
