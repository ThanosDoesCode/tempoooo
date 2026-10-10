-- Account-level weekly streak system (Run / Train / Eat rings).
--
-- One Monday–Sunday timeline per account, in a frozen account timezone. Run requirements are
-- frozen per week from canonical Challenge membership/schedule and settled from canonical
-- `challenge_weeks` (never re-deriving run/ride conversion here). Train/Eat requirements are
-- frozen from an append-only effective-instant goal history. Everything is server-authoritative:
-- clients may only SELECT their own rows; all writes happen inside `public.recompute_streak`.

-- ---------------------------------------------------------------- enums
CREATE TYPE public.streak_ring_state  AS ENUM ('inactive','open','closed','skipped');
CREATE TYPE public.streak_week_result AS ENUM ('open','kept','missed','paused','free','none');
CREATE TYPE public.streak_leg_state   AS ENUM ('pending','completed','missed','paused');

-- ---------------------------------------------------------------- append-only goal history
-- Effective-instant snapshots so a lazily-created streak week can recover the value that was
-- effective at its exact Monday-start instant. Append-only: multiple same-day changes keep every
-- version. Normal nutrition analytics keep using bulk_nutrition_target_history (unchanged).
CREATE TABLE public.bulk_streak_goal_events (
  id                  uuid primary key default gen_random_uuid(),
  bulk_profile_id     uuid not null references public.bulk_profiles(id) on delete cascade,
  effective_at        timestamptz not null default now(),
  weekly_workout_goal integer     check (weekly_workout_goal is null or weekly_workout_goal between 1 and 14),
  calorie_target_kcal numeric(8,2) check (calorie_target_kcal is null or calorie_target_kcal between 0 and 20000),
  timezone            text,
  recorded_at         timestamptz not null default now()
);
CREATE INDEX bulk_streak_goal_events_lookup
  ON public.bulk_streak_goal_events (bulk_profile_id, effective_at DESC);

ALTER TABLE public.bulk_streak_goal_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY "streak goal events read owner" ON public.bulk_streak_goal_events
  FOR SELECT TO authenticated USING (EXISTS (
    SELECT 1 FROM public.bulk_profiles p
    WHERE p.id = bulk_profile_id AND p.owner_id = (SELECT auth.uid())));
REVOKE ALL ON public.bulk_streak_goal_events FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.bulk_streak_goal_events TO authenticated;
GRANT ALL ON public.bulk_streak_goal_events TO service_role;

-- ---------------------------------------------------------------- streak weeks (parent)
CREATE TABLE public.streak_weeks (
  user_id      uuid not null references auth.users(id) on delete cascade,
  week_start   date not null,                 -- Monday, in frozen account timezone
  week_end     date not null,                 -- Sunday
  timezone     text not null,                 -- one frozen account tz for the whole row

  run_active   boolean not null default false,
  train_active boolean not null default false,
  eat_active   boolean not null default false,

  bulk_profile_id       uuid references public.bulk_profiles(id) on delete set null,
  train_target_workouts integer,
  eat_target_kcal       numeric(8,2),
  eat_required_days     integer,
  eat_tolerance_pct     numeric(4,3),

  run_state   public.streak_ring_state not null default 'inactive',
  train_state public.streak_ring_state not null default 'inactive',
  eat_state   public.streak_ring_state not null default 'inactive',

  result         public.streak_week_result not null default 'open',
  free_miss_used boolean     not null default false,
  locked_at      timestamptz,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),

  primary key (user_id, week_start),
  constraint streak_weeks_bounds_ck       check (week_end > week_start),
  constraint streak_weeks_open_lock_ck    check ((locked_at is null) = (result = 'open')),
  constraint streak_weeks_free_ck         check (free_miss_used = (result = 'free')),
  constraint streak_weeks_run_active_ck   check (run_active   or run_state   = 'inactive'),
  constraint streak_weeks_train_active_ck check (train_active or train_state = 'inactive'),
  constraint streak_weeks_eat_active_ck   check (eat_active   or eat_state   = 'inactive'),
  constraint streak_weeks_train_input_ck  check (train_active or train_target_workouts is null),
  constraint streak_weeks_eat_input_ck    check (eat_active   or eat_target_kcal is null),
  constraint streak_weeks_eat_tol_ck      check (eat_tolerance_pct is null or eat_tolerance_pct between 0 and 1),
  constraint streak_weeks_eat_days_ck     check (eat_required_days is null or eat_required_days between 1 and 7)
);
CREATE INDEX streak_weeks_user_week_idx ON public.streak_weeks (user_id, week_start);

ALTER TABLE public.streak_weeks ENABLE ROW LEVEL SECURITY;
CREATE POLICY "streak weeks read owner" ON public.streak_weeks
  FOR SELECT TO authenticated USING (user_id = (SELECT auth.uid()));
REVOKE ALL ON public.streak_weeks FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.streak_weeks TO authenticated;
GRANT ALL ON public.streak_weeks TO service_role;

-- ---------------------------------------------------------------- Run legs (two-phase)
CREATE TABLE public.streak_week_run_legs (
  id                    uuid primary key default gen_random_uuid(),
  user_id               uuid not null,
  week_start            date not null,
  source_challenge_id   uuid not null,                               -- frozen snapshot (survives deletion)
  challenge_id          uuid references public.challenges(id) on delete set null,
  challenge_week_number integer not null,
  challenge_timezone    text not null,
  challenge_week_start  date not null,
  challenge_week_end    date not null,
  challenge_end_instant timestamptz not null,                        -- inclusive final instant (mapping anchor)
  source_week_id        uuid,                                        -- challenge_weeks.id, set at settlement
  target_km             numeric(8,2),
  settlement_state      public.streak_leg_state not null default 'pending',
  settled_at            timestamptz,

  foreign key (user_id, week_start)
    references public.streak_weeks(user_id, week_start) on delete cascade,
  constraint streak_run_legs_identity_uq unique (user_id, source_challenge_id, challenge_week_number),
  constraint streak_run_legs_settled_ck  check ((settlement_state = 'pending') = (settled_at is null))
);
CREATE INDEX streak_run_legs_parent_idx ON public.streak_week_run_legs (user_id, week_start);

ALTER TABLE public.streak_week_run_legs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "streak run legs read owner" ON public.streak_week_run_legs
  FOR SELECT TO authenticated USING (user_id = (SELECT auth.uid()));
REVOKE ALL ON public.streak_week_run_legs FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.streak_week_run_legs TO authenticated;
GRANT ALL ON public.streak_week_run_legs TO service_role;

-- ---------------------------------------------------------------- goal-event helpers
-- Resolved weekly workout goal, mirroring src/lib/goal-metrics.ts resolveWeeklyWorkoutTarget:
-- explicit weeklyWorkoutGoal wins, else targets.trainingDaysPerWeek, else active plan days.
CREATE FUNCTION private.resolve_streak_goal(_profile uuid)
RETURNS integer
LANGUAGE sql
SECURITY DEFINER
SET search_path = ''
AS $$
  WITH t AS (SELECT payload FROM public.bulk_targets WHERE bulk_profile_id = _profile),
       candidates AS (
         SELECT 1 AS rank, nullif((SELECT payload->>'weeklyWorkoutGoal' FROM t), '')::int AS v
         UNION ALL
         SELECT 2, nullif((SELECT payload->>'trainingDaysPerWeek' FROM t), '')::int
         UNION ALL
         SELECT 3, (SELECT training_days_per_week FROM public.bulk_training_plans
                    WHERE bulk_profile_id = _profile AND active)
       )
  SELECT v FROM candidates WHERE v IS NOT NULL AND v > 0 ORDER BY rank LIMIT 1;
$$;

CREATE FUNCTION private.resolve_streak_calories(_profile uuid)
RETURNS numeric
LANGUAGE sql
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT v FROM (
    SELECT nullif(payload->>'calories', '')::numeric AS v
    FROM public.bulk_targets WHERE bulk_profile_id = _profile
  ) s WHERE v IS NOT NULL AND v > 0;
$$;

-- Append a goal event only when the resolved (goal, calorie) pair actually changes. Unrelated
-- bulk_targets payload edits (e.g. a macro split) never produce a row.
CREATE FUNCTION private.record_streak_goal_event(_profile uuid, _timezone text DEFAULT NULL, _effective_at timestamptz DEFAULT now())
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE new_goal integer; new_kcal numeric; last_goal integer; last_kcal numeric; has_last boolean;
BEGIN
  new_goal := private.resolve_streak_goal(_profile);
  new_kcal := private.resolve_streak_calories(_profile);
  IF new_goal IS NULL AND new_kcal IS NULL THEN RETURN; END IF;

  SELECT weekly_workout_goal, calorie_target_kcal, true
    INTO last_goal, last_kcal, has_last
    FROM public.bulk_streak_goal_events
   WHERE bulk_profile_id = _profile
   ORDER BY effective_at DESC, recorded_at DESC
   LIMIT 1;

  IF has_last AND last_goal IS NOT DISTINCT FROM new_goal AND last_kcal IS NOT DISTINCT FROM new_kcal THEN
    RETURN;
  END IF;

  INSERT INTO public.bulk_streak_goal_events(bulk_profile_id, effective_at, weekly_workout_goal, calorie_target_kcal, timezone)
  VALUES (_profile, _effective_at, new_goal, new_kcal, _timezone);
END;
$$;

-- Trigger capture: fires on any writer of the resolved goal/calorie (targets payload or the
-- active training plan fallback). Dedup lives in record_streak_goal_event.
CREATE FUNCTION private.capture_streak_goal_event()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE _profile uuid;
BEGIN
  _profile := CASE TG_TABLE_NAME
    WHEN 'bulk_targets' THEN COALESCE(NEW.bulk_profile_id, OLD.bulk_profile_id)
    WHEN 'bulk_training_plans' THEN COALESCE(NEW.bulk_profile_id, OLD.bulk_profile_id)
  END;
  IF _profile IS NOT NULL THEN
    PERFORM private.record_streak_goal_event(_profile);
  END IF;
  RETURN NULL;
END;
$$;

CREATE TRIGGER capture_streak_goal_from_targets
  AFTER INSERT OR UPDATE ON public.bulk_targets
  FOR EACH ROW EXECUTE FUNCTION private.capture_streak_goal_event();
-- INSERT/UPDATE only: a plan DELETE during profile/account cascade must not try to append an
-- event for a profile that is being removed (would violate the FK). Plan switches/deactivations
-- arrive as INSERT/UPDATE and still capture.
CREATE TRIGGER capture_streak_goal_from_plans
  AFTER INSERT OR UPDATE ON public.bulk_training_plans
  FOR EACH ROW EXECUTE FUNCTION private.capture_streak_goal_event();

-- ---------------------------------------------------------------- time mapping helpers
-- Inclusive final instant of a challenge-week end date, in that challenge's timezone.
CREATE FUNCTION private.streak_end_instant(_week_end date, _tz text)
RETURNS timestamptz
LANGUAGE sql IMMUTABLE
SET search_path = ''
AS $$
  SELECT (((_week_end + 1)::timestamp AT TIME ZONE _tz) - interval '1 microsecond');
$$;

-- The Monday of the account streak week (in the frozen account tz) containing an instant.
CREATE FUNCTION private.streak_account_week(_instant timestamptz, _tz text)
RETURNS date
LANGUAGE sql IMMUTABLE
SET search_path = ''
AS $$
  SELECT date_trunc('week', (_instant AT TIME ZONE _tz)::date)::date;
$$;

-- ---------------------------------------------------------------- leave-time freeze
-- Membership deletion has no durable history, so freeze a required Run leg before the row
-- disappears. Uses the current week's frozen tz when it exists, else the challenge timezone.
CREATE FUNCTION private.freeze_run_legs_on_leave(_challenge uuid, _user uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE ch record; tz text; today date; wk date; wk_end date; joined timestamptz;
        w integer; cs date; ce date; ei timestamptz; aw date;
BEGIN
  -- Bail out of any cascade delete (challenge removed, or the account being deleted): freezing is
  -- only meaningful for a voluntary leave, and must never block a delete with an FK error.
  SELECT * INTO ch FROM public.challenges WHERE id = _challenge;
  IF ch IS NULL THEN RETURN; END IF;
  IF NOT EXISTS (SELECT 1 FROM auth.users WHERE id = _user) THEN RETURN; END IF;
  SELECT joined_at INTO joined FROM public.challenge_members
    WHERE challenge_id = _challenge AND user_id = _user;
  IF joined IS NULL THEN RETURN; END IF;

  -- Account tz for the current week: existing frozen row, else the challenge's own tz.
  today := (now() AT TIME ZONE ch.timezone)::date;
  wk := date_trunc('week', today)::date;
  SELECT timezone INTO tz FROM public.streak_weeks WHERE user_id = _user AND week_start = wk;
  IF tz IS NULL THEN tz := ch.timezone; END IF;
  today := (now() AT TIME ZONE tz)::date;
  wk := date_trunc('week', today)::date;
  wk_end := wk + 6;

  -- Walk the challenge weeks whose end instant could map into the current account week.
  FOR w IN 1 .. public.challenge_week_of(_challenge, (now() AT TIME ZONE ch.timezone)::date) LOOP
    cs := ch.start_date + ((w - 1) * 7);
    ce := cs + 6;
    ei := private.streak_end_instant(ce, ch.timezone);
    aw := private.streak_account_week(ei, tz);
    IF aw <> wk THEN CONTINUE; END IF;
    IF joined > (aw::timestamp AT TIME ZONE tz) THEN CONTINUE; END IF;  -- joined mid-week: excluded

    INSERT INTO public.streak_weeks(user_id, week_start, week_end, timezone, run_active, run_state)
    VALUES (_user, wk, wk_end, tz, true, 'open'::public.streak_ring_state)
    ON CONFLICT (user_id, week_start) DO UPDATE SET run_active = true, updated_at = now();

    INSERT INTO public.streak_week_run_legs(
      user_id, week_start, source_challenge_id, challenge_id, challenge_week_number,
      challenge_timezone, challenge_week_start, challenge_week_end, challenge_end_instant)
    VALUES (_user, wk, _challenge, _challenge, w, ch.timezone, cs, ce, ei)
    ON CONFLICT (user_id, source_challenge_id, challenge_week_number) DO NOTHING;
  END LOOP;
END;
$$;

CREATE FUNCTION private.before_challenge_member_delete()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF OLD.role <> 'owner' THEN
    PERFORM private.freeze_run_legs_on_leave(OLD.challenge_id, OLD.user_id);
  END IF;
  RETURN OLD;
END;
$$;

CREATE TRIGGER freeze_streak_on_challenge_leave
  BEFORE DELETE ON public.challenge_members
  FOR EACH ROW EXECUTE FUNCTION private.before_challenge_member_delete();

-- ---------------------------------------------------------------- recompute (authoritative)
CREATE FUNCTION public.recompute_streak(_timezone text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_user uuid := (SELECT auth.uid());
  v_profile uuid;
  today date;
  cur_week date;
  floor_week date;
  mem record;
  ch record;
  w integer;
  cs date; ce date; ei timestamptz; aw date; wk_end date;
  leg record;
  cw record;
  sw record;
  run_leg_count integer;
  pending_count integer;
  closed_nonpaused integer;
  paused_count integer;
  missed_count integer;
  new_run public.streak_ring_state;
  goal_val integer;
  kcal_val numeric;
  done_count integer;
  adherent integer;
  base_result public.streak_week_result;
  cur_streak integer := 0;
  best_streak integer := 0;
  month_used jsonb := '{}'::jsonb;    -- 'YYYY-MM' -> true once a free miss is consumed
  mk text;
  recent jsonb;
BEGIN
  IF v_user IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  IF _timezone IS NULL OR NOT EXISTS (SELECT 1 FROM pg_catalog.pg_timezone_names WHERE name = _timezone) THEN
    RAISE EXCEPTION 'Invalid timezone' USING ERRCODE = '22023';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtext('streak:' || v_user::text));

  SELECT id INTO v_profile FROM public.bulk_profiles WHERE owner_id = v_user ORDER BY created_at LIMIT 1;
  today := (now() AT TIME ZONE _timezone)::date;
  cur_week := date_trunc('week', today)::date;
  floor_week := cur_week - (53 * 7);  -- shortcut: cap backfill to ~1 year; raise if challenges exceed it

  ----------------------------------------------------------------- Phase A: freeze Run legs
  FOR mem IN
    SELECT cm.challenge_id, cm.joined_at, c.start_date, c.timezone AS ctz, c.duration_weeks
    FROM public.challenge_members cm
    JOIN public.challenges c ON c.id = cm.challenge_id
    WHERE cm.user_id = v_user
  LOOP
    FOR w IN 1 .. least(public.challenge_week_of(mem.challenge_id, (now() AT TIME ZONE mem.ctz)::date), mem.duration_weeks) LOOP
      cs := mem.start_date + ((w - 1) * 7);
      ce := cs + 6;
      ei := private.streak_end_instant(ce, mem.ctz);
      aw := private.streak_account_week(ei, _timezone);
      IF aw < floor_week OR aw > cur_week THEN CONTINUE; END IF;
      IF mem.joined_at > (aw::timestamp AT TIME ZONE _timezone) THEN CONTINUE; END IF;  -- joined after week start
      wk_end := aw + 6;

      INSERT INTO public.streak_weeks(user_id, week_start, week_end, timezone, run_active, run_state)
      VALUES (v_user, aw, wk_end, _timezone, true, 'open'::public.streak_ring_state)
      ON CONFLICT (user_id, week_start) DO UPDATE
        SET run_active = true,
            run_state = CASE WHEN public.streak_weeks.run_state = 'inactive' THEN 'open'::public.streak_ring_state
                             ELSE public.streak_weeks.run_state END,
            updated_at = now()
      WHERE public.streak_weeks.locked_at IS NULL;

      INSERT INTO public.streak_week_run_legs(
        user_id, week_start, source_challenge_id, challenge_id, challenge_week_number,
        challenge_timezone, challenge_week_start, challenge_week_end, challenge_end_instant)
      SELECT v_user, aw, mem.challenge_id, mem.challenge_id, w, mem.ctz, cs, ce, ei
      WHERE EXISTS (SELECT 1 FROM public.streak_weeks
                    WHERE user_id = v_user AND week_start = aw AND locked_at IS NULL)
      ON CONFLICT (user_id, source_challenge_id, challenge_week_number) DO NOTHING;
    END LOOP;
  END LOOP;

  ----------------------------------------------------------------- Phase B: settle pending legs
  FOR leg IN
    SELECT l.* FROM public.streak_week_run_legs l
    JOIN public.streak_weeks s ON s.user_id = l.user_id AND s.week_start = l.week_start
    WHERE l.user_id = v_user AND l.settlement_state = 'pending' AND s.locked_at IS NULL
  LOOP
    IF leg.challenge_end_instant >= now() THEN CONTINUE; END IF;  -- cutoff not passed

    SELECT id, target_km, completed, paused INTO cw
      FROM public.challenge_weeks
      WHERE challenge_id = leg.source_challenge_id AND user_id = v_user
        AND week_number = leg.challenge_week_number;

    IF cw.id IS NULL AND EXISTS (
      SELECT 1 FROM public.challenge_members WHERE challenge_id = leg.source_challenge_id AND user_id = v_user
    ) THEN
      PERFORM public.finalize_challenge(v_user, leg.source_challenge_id);  -- canonical settlement path
      SELECT id, target_km, completed, paused INTO cw
        FROM public.challenge_weeks
        WHERE challenge_id = leg.source_challenge_id AND user_id = v_user
          AND week_number = leg.challenge_week_number;
    END IF;

    IF cw.id IS NOT NULL THEN
      UPDATE public.streak_week_run_legs
        SET source_week_id = cw.id,
            target_km = cw.target_km,
            settlement_state = CASE WHEN cw.paused THEN 'paused'::public.streak_leg_state
                                    WHEN cw.completed THEN 'completed'::public.streak_leg_state
                                    ELSE 'missed'::public.streak_leg_state END,
            settled_at = now()
        WHERE id = leg.id;
    ELSE
      -- No canonical row and the user is no longer a member: terminal miss (leaving never saves a streak).
      UPDATE public.streak_week_run_legs
        SET settlement_state = 'missed'::public.streak_leg_state, settled_at = now()
        WHERE id = leg.id;
    END IF;
  END LOOP;

  ----------------------------------------------------------------- Phase C: freeze Train/Eat activation
  -- Only for weeks that already exist (Run) or that have an authoritative goal event before start.
  IF v_profile IS NOT NULL THEN
    FOR w IN 0 .. 53 LOOP
      aw := cur_week - (w * 7);
      IF aw < floor_week THEN EXIT; END IF;
      SELECT weekly_workout_goal, calorie_target_kcal INTO goal_val, kcal_val
        FROM public.bulk_streak_goal_events
        WHERE bulk_profile_id = v_profile
          AND effective_at <= (aw::timestamp AT TIME ZONE _timezone)
        ORDER BY effective_at DESC, recorded_at DESC
        LIMIT 1;
      IF goal_val IS NULL AND kcal_val IS NULL THEN CONTINUE; END IF;  -- before T0 for this week

      INSERT INTO public.streak_weeks(
        user_id, week_start, week_end, timezone, bulk_profile_id,
        train_active, train_target_workouts, train_state,
        eat_active, eat_target_kcal, eat_required_days, eat_tolerance_pct, eat_state)
      VALUES (
        v_user, aw, aw + 6, _timezone, v_profile,
        goal_val IS NOT NULL, goal_val, CASE WHEN goal_val IS NOT NULL THEN 'open' ELSE 'inactive' END::public.streak_ring_state,
        kcal_val IS NOT NULL, kcal_val, CASE WHEN kcal_val IS NOT NULL THEN 5 END, CASE WHEN kcal_val IS NOT NULL THEN 0.100 END,
        CASE WHEN kcal_val IS NOT NULL THEN 'open' ELSE 'inactive' END::public.streak_ring_state)
      ON CONFLICT (user_id, week_start) DO UPDATE
        SET bulk_profile_id = EXCLUDED.bulk_profile_id,
            train_active = EXCLUDED.train_active,
            train_target_workouts = EXCLUDED.train_target_workouts,
            train_state = CASE WHEN public.streak_weeks.train_state = 'inactive' THEN EXCLUDED.train_state
                               ELSE public.streak_weeks.train_state END,
            eat_active = EXCLUDED.eat_active,
            eat_target_kcal = EXCLUDED.eat_target_kcal,
            eat_required_days = EXCLUDED.eat_required_days,
            eat_tolerance_pct = EXCLUDED.eat_tolerance_pct,
            eat_state = CASE WHEN public.streak_weeks.eat_state = 'inactive' THEN EXCLUDED.eat_state
                             ELSE public.streak_weeks.eat_state END,
            updated_at = now()
        WHERE public.streak_weeks.locked_at IS NULL;
    END LOOP;
  END IF;

  ----------------------------------------------------------------- Phase D: ring states + finalize + free miss
  FOR sw IN
    SELECT * FROM public.streak_weeks WHERE user_id = v_user AND locked_at IS NULL
    ORDER BY week_start
  LOOP
    -- Run aggregate from legs.
    SELECT count(*),
           count(*) FILTER (WHERE settlement_state = 'pending'),
           count(*) FILTER (WHERE settlement_state = 'completed'),
           count(*) FILTER (WHERE settlement_state = 'paused'),
           count(*) FILTER (WHERE settlement_state = 'missed')
      INTO run_leg_count, pending_count, closed_nonpaused, paused_count, missed_count
      FROM public.streak_week_run_legs
      WHERE user_id = v_user AND week_start = sw.week_start;

    IF run_leg_count = 0 THEN new_run := 'inactive';
    ELSIF pending_count > 0 THEN new_run := 'open';
    ELSIF paused_count = run_leg_count THEN new_run := 'skipped';
    ELSIF missed_count = 0 THEN new_run := 'closed';
    ELSE new_run := 'open';  -- a terminal miss leaves Run unmet -> week will miss at finalize
    END IF;

    -- Train.
    IF sw.train_active THEN
      SELECT count(*) INTO done_count FROM public.bulk_training_sessions
        WHERE bulk_profile_id = sw.bulk_profile_id AND status = 'completed'
          AND workout_date BETWEEN sw.week_start AND sw.week_end;
      UPDATE public.streak_weeks SET train_state =
        CASE WHEN done_count >= sw.train_target_workouts THEN 'closed'::public.streak_ring_state
             ELSE 'open'::public.streak_ring_state END
        WHERE user_id = v_user AND week_start = sw.week_start;
    END IF;

    -- Eat: adherent days = consumed within frozen target +/- tolerance, consumed > 0.
    IF sw.eat_active THEN
      SELECT count(*) INTO adherent FROM (
        SELECT d.log_date, coalesce(sum(e.calories), 0) AS consumed
        FROM public.bulk_nutrition_days d
        LEFT JOIN public.bulk_nutrition_entries e ON e.nutrition_day_id = d.id
        WHERE d.bulk_profile_id = sw.bulk_profile_id
          AND d.log_date BETWEEN sw.week_start AND sw.week_end
        GROUP BY d.log_date
      ) days
      WHERE consumed > 0
        AND consumed BETWEEN sw.eat_target_kcal * (1 - sw.eat_tolerance_pct)
                         AND sw.eat_target_kcal * (1 + sw.eat_tolerance_pct);
      UPDATE public.streak_weeks SET eat_state =
        CASE WHEN adherent >= sw.eat_required_days THEN 'closed'::public.streak_ring_state
             ELSE 'open'::public.streak_ring_state END
        WHERE user_id = v_user AND week_start = sw.week_start;
    END IF;

    UPDATE public.streak_weeks SET run_state = new_run, updated_at = now()
      WHERE user_id = v_user AND week_start = sw.week_start;

    -- Re-read the row with fresh ring states.
    SELECT * INTO sw FROM public.streak_weeks WHERE user_id = v_user AND week_start = sw.week_start;

    -- Finalize only once the account week has fully passed and no Run leg is still pending.
    IF sw.week_end < today AND pending_count = 0 THEN
      IF NOT (sw.run_active OR sw.train_active OR sw.eat_active) THEN
        base_result := 'none';
      ELSIF (NOT sw.run_active   OR sw.run_state   IN ('skipped'))
        AND (NOT sw.train_active OR sw.train_state IN ('skipped'))
        AND (NOT sw.eat_active   OR sw.eat_state   IN ('skipped'))
        AND (sw.run_state = 'skipped' OR sw.train_state = 'skipped' OR sw.eat_state = 'skipped')
      THEN
        base_result := 'paused';
      ELSIF (NOT sw.run_active   OR sw.run_state   IN ('closed','skipped'))
        AND (NOT sw.train_active OR sw.train_state IN ('closed','skipped'))
        AND (NOT sw.eat_active   OR sw.eat_state   IN ('closed','skipped'))
      THEN
        base_result := 'kept';
      ELSE
        base_result := 'missed';
      END IF;

      -- Monthly free miss: first otherwise-missed week in the calendar month of week_start.
      mk := to_char(sw.week_start, 'YYYY-MM');
      IF base_result = 'missed' AND NOT (month_used ? mk)
         AND NOT EXISTS (
           SELECT 1 FROM public.streak_weeks
           WHERE user_id = v_user AND free_miss_used
             AND to_char(week_start, 'YYYY-MM') = mk)
      THEN
        base_result := 'free';
      END IF;

      UPDATE public.streak_weeks
        SET result = base_result, free_miss_used = (base_result = 'free'),
            locked_at = now(), updated_at = now()
        WHERE user_id = v_user AND week_start = sw.week_start;
      IF base_result = 'free' THEN month_used := month_used || jsonb_build_object(mk, true); END IF;
    END IF;
  END LOOP;

  ----------------------------------------------------------------- Phase E: derive current/best
  FOR sw IN
    SELECT result FROM public.streak_weeks
    WHERE user_id = v_user AND locked_at IS NOT NULL ORDER BY week_start
  LOOP
    IF sw.result = 'kept' THEN cur_streak := cur_streak + 1;
    ELSIF sw.result = 'missed' THEN cur_streak := 0;
    END IF;  -- free/paused/none preserve
    IF cur_streak > best_streak THEN best_streak := cur_streak; END IF;
  END LOOP;

  SELECT jsonb_agg(row_to_json(r)) INTO recent FROM (
    SELECT week_start, week_end, result, run_state, train_state, eat_state,
           run_active, train_active, eat_active, free_miss_used, locked_at
    FROM public.streak_weeks WHERE user_id = v_user
    ORDER BY week_start DESC LIMIT 8
  ) r;

  RETURN jsonb_build_object(
    'current', cur_streak,
    'best', best_streak,
    'this_week', (
      SELECT row_to_json(s) FROM (
        SELECT week_start, week_end, run_active, train_active, eat_active,
               run_state, train_state, eat_state, result
        FROM public.streak_weeks WHERE user_id = v_user AND week_start = cur_week
      ) s),
    'recent_weeks', coalesce(recent, '[]'::jsonb)
  );
END;
$$;

REVOKE ALL ON FUNCTION public.recompute_streak(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.recompute_streak(text) TO authenticated;

-- ---------------------------------------------------------------- data step: baseline goal events
-- One snapshot per current fitness profile at migration time. Never backdated: current users'
-- Train/Eat streak requirements therefore begin next Monday (T0), not this week.
DO $$
DECLARE p uuid;
BEGIN
  FOR p IN SELECT id FROM public.bulk_profiles LOOP
    PERFORM private.record_streak_goal_event(p, NULL, now());
  END LOOP;
END;
$$;
