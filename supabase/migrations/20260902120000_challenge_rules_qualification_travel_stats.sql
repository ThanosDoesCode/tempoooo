-- Make the published Challenge rules authoritative without rewriting finalized weeks.
-- Existing activity distance remains available for lifetime statistics; only qualified
-- equivalent kilometres count toward current/future weekly results.

ALTER TABLE public.challenge_activities
  ADD COLUMN average_speed_kmh numeric(10,2) GENERATED ALWAYS AS (
    CASE
      WHEN duration_seconds IS NULL THEN NULL
      ELSE round((distance_km * 3600) / duration_seconds, 2)
    END
  ) STORED,
  ADD COLUMN average_pace_seconds_per_km numeric(10,2) GENERATED ALWAYS AS (
    CASE
      WHEN duration_seconds IS NULL THEN NULL
      ELSE round(duration_seconds::numeric / distance_km, 2)
    END
  ) STORED,
  ADD COLUMN is_qualified boolean GENERATED ALWAYS AS (
    CASE
      WHEN duration_seconds IS NULL THEN false
      WHEN activity_type = 'run' THEN duration_seconds::numeric / distance_km < 420
      WHEN activity_type = 'cycle' THEN (distance_km * 3600) / duration_seconds >= 18
      ELSE false
    END
  ) STORED,
  ADD COLUMN qualifying_equivalent_km numeric(8,4) GENERATED ALWAYS AS (
    CASE
      WHEN duration_seconds IS NULL THEN 0
      WHEN activity_type = 'run' AND duration_seconds::numeric / distance_km < 420
        THEN distance_km
      WHEN activity_type = 'cycle' AND (distance_km * 3600) / duration_seconds >= 18
        THEN distance_km / 3
      ELSE 0
    END
  ) STORED;

ALTER TABLE public.challenge_activity_audit
  ADD COLUMN old_duration_seconds integer;

-- A pause is intentionally week-based because targets and penalties are finalized by week.
-- No row means the participant chose to continue normally while travelling.
CREATE TABLE public.challenge_travel_pauses (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  challenge_id uuid NOT NULL REFERENCES public.challenges(id) ON DELETE CASCADE,
  user_id uuid NOT NULL,
  week_number integer NOT NULL,
  country text NOT NULL CHECK (length(btrim(country)) BETWEEN 2 AND 80),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (challenge_id, user_id, week_number)
);

CREATE INDEX challenge_travel_pauses_challenge_week_idx
  ON public.challenge_travel_pauses(challenge_id, week_number);

ALTER TABLE public.challenge_travel_pauses ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.challenge_travel_pauses FROM PUBLIC, anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.challenge_travel_pauses TO authenticated;
GRANT ALL ON public.challenge_travel_pauses TO service_role;

CREATE POLICY "travel pauses read members" ON public.challenge_travel_pauses
  FOR SELECT TO authenticated
  USING (private.is_challenge_member(challenge_id));

CREATE POLICY "travel pauses insert own" ON public.challenge_travel_pauses
  FOR INSERT TO authenticated
  WITH CHECK (user_id = auth.uid() AND private.is_challenge_member(challenge_id));

CREATE POLICY "travel pauses update own" ON public.challenge_travel_pauses
  FOR UPDATE TO authenticated
  USING (user_id = auth.uid() AND private.is_challenge_member(challenge_id))
  WITH CHECK (user_id = auth.uid() AND private.is_challenge_member(challenge_id));

CREATE POLICY "travel pauses delete own" ON public.challenge_travel_pauses
  FOR DELETE TO authenticated
  USING (user_id = auth.uid() AND private.is_challenge_member(challenge_id));

CREATE FUNCTION public.guard_challenge_travel_pause()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
  actor uuid := auth.uid();
  row_challenge uuid := CASE WHEN TG_OP = 'DELETE' THEN OLD.challenge_id ELSE NEW.challenge_id END;
  row_user uuid := CASE WHEN TG_OP = 'DELETE' THEN OLD.user_id ELSE NEW.user_id END;
  row_week integer := CASE WHEN TG_OP = 'DELETE' THEN OLD.week_number ELSE NEW.week_number END;
  current_week integer;
  duration integer;
BEGIN
  IF actor IS NULL OR row_user <> actor THEN
    RAISE EXCEPTION 'You can only manage your own travel pauses';
  END IF;
  IF NOT private.is_challenge_member(row_challenge) THEN
    RAISE EXCEPTION 'Not a member of this challenge';
  END IF;
  IF TG_OP = 'UPDATE' AND (
    NEW.challenge_id IS DISTINCT FROM OLD.challenge_id
    OR NEW.user_id IS DISTINCT FROM OLD.user_id
    OR NEW.week_number IS DISTINCT FROM OLD.week_number
  ) THEN
    RAISE EXCEPTION 'Travel pause identity is immutable';
  END IF;

  SELECT c.duration_weeks INTO duration FROM public.challenges c WHERE c.id = row_challenge;
  IF duration IS NULL OR row_week < 1 OR row_week > duration THEN
    RAISE EXCEPTION 'That week is outside the challenge';
  END IF;
  current_week := private.challenge_week_of(row_challenge, private.challenge_today(row_challenge));
  IF row_week < current_week THEN
    RAISE EXCEPTION 'Past travel pauses cannot be changed';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.challenge_weeks w
    WHERE w.challenge_id = row_challenge
      AND w.user_id = row_user
      AND w.week_number = row_week
  ) THEN
    RAISE EXCEPTION 'Finalized travel pauses cannot be changed';
  END IF;

  IF TG_OP <> 'DELETE' THEN
    NEW.country := btrim(NEW.country);
    IF lower(NEW.country) IN ('greece', 'sweden', 'gr', 'se') THEN
      RAISE EXCEPTION 'The challenge stays active in Greece and Sweden';
    END IF;
    NEW.updated_at := now();
    RETURN NEW;
  END IF;
  RETURN OLD;
END;
$$;

REVOKE ALL ON FUNCTION public.guard_challenge_travel_pause() FROM PUBLIC, anon, authenticated;

CREATE TRIGGER challenge_travel_pauses_guard
BEFORE INSERT OR UPDATE OR DELETE ON public.challenge_travel_pauses
FOR EACH ROW EXECUTE FUNCTION public.guard_challenge_travel_pause();

CREATE FUNCTION private.challenge_week_paused(_c uuid, _u uuid, _w integer)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.challenge_travel_pauses p
    WHERE p.challenge_id = _c AND p.user_id = _u AND p.week_number = _w
  )
$$;

REVOKE ALL ON FUNCTION private.challenge_week_paused(uuid, uuid, integer)
  FROM PUBLIC, anon, authenticated;

-- The challenge target and penalty thresholds are fixed. A travel pause is the only
-- reason the effective target becomes zero.
CREATE OR REPLACE FUNCTION public.penalty_for(_km numeric, _target numeric)
RETURNS numeric
LANGUAGE sql
IMMUTABLE
SET search_path = ''
AS $$
  SELECT CASE
    WHEN _target <= 0 THEN 0
    WHEN _km >= 15 THEN 0
    WHEN _km >= 10 THEN 5
    WHEN _km >= 5 THEN 10
    ELSE 15
  END::numeric
$$;

CREATE OR REPLACE FUNCTION private.target_for_week(_c uuid, _w integer)
RETURNS numeric
LANGUAGE sql
STABLE
SET search_path = ''
AS $$
  SELECT 15::numeric
$$;

CREATE FUNCTION private.target_for_week(_c uuid, _w integer, _u uuid)
RETURNS numeric
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT CASE WHEN private.challenge_week_paused(_c, _u, _w) THEN 0 ELSE 15 END::numeric
$$;

REVOKE ALL ON FUNCTION private.target_for_week(uuid, integer, uuid)
  FROM PUBLIC, anon, authenticated;

-- Keep old override rows for historical traceability, but stop accepting new target
-- changes because the published rules fix the maximum and weekly target at 15 km.
REVOKE INSERT, UPDATE, DELETE ON public.challenge_week_targets FROM authenticated;

ALTER TABLE public.challenge_weeks
  ADD COLUMN paused boolean NOT NULL DEFAULT false,
  ADD COLUMN pause_country text;

CREATE OR REPLACE FUNCTION public.finalize_challenge(_caller uuid, _c uuid)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  ch record;
  cur integer;
  w integer;
  m record;
  other uuid;
  run_km numeric;
  cyc_km numeric;
  eq numeric;
  pen numeric;
  tgt numeric;
  is_paused boolean;
  paused_country text;
  wk_id uuid;
  inserted integer := 0;
BEGIN
  IF _caller IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.challenge_members WHERE challenge_id = _c AND user_id = _caller
  ) THEN RAISE EXCEPTION 'Not a member of this challenge'; END IF;
  SELECT * INTO ch FROM public.challenges WHERE id = _c;
  IF ch IS NULL THEN RAISE EXCEPTION 'Challenge not found'; END IF;

  cur := private.challenge_week_of(_c, private.challenge_today(_c));
  FOR w IN 1 .. least(cur - 1, ch.duration_weeks) LOOP
    FOR m IN SELECT user_id FROM public.challenge_members WHERE challenge_id = _c LOOP
      IF EXISTS (
        SELECT 1 FROM public.challenge_weeks
        WHERE challenge_id = _c AND user_id = m.user_id AND week_number = w
      ) THEN CONTINUE; END IF;

      SELECT
        coalesce(sum(CASE WHEN activity_type = 'run' THEN distance_km ELSE 0 END), 0),
        coalesce(sum(CASE WHEN activity_type = 'cycle' THEN distance_km ELSE 0 END), 0),
        coalesce(sum(qualifying_equivalent_km), 0)
      INTO run_km, cyc_km, eq
      FROM public.challenge_activities
      WHERE challenge_id = _c AND user_id = m.user_id
        AND activity_date >= ch.start_date + ((w - 1) * 7)
        AND activity_date <= ch.start_date + ((w - 1) * 7) + 6;

      is_paused := private.challenge_week_paused(_c, m.user_id, w);
      SELECT p.country INTO paused_country
      FROM public.challenge_travel_pauses p
      WHERE p.challenge_id = _c AND p.user_id = m.user_id AND p.week_number = w;
      tgt := private.target_for_week(_c, w, m.user_id);
      pen := public.penalty_for(eq, tgt);

      INSERT INTO public.challenge_weeks(
        challenge_id, user_id, week_number, week_start, week_end,
        running_km, cycling_km, equivalent_km, target_km, completed,
        penalty_eur, paused, pause_country
      ) VALUES (
        _c, m.user_id, w, ch.start_date + ((w - 1) * 7),
        ch.start_date + ((w - 1) * 7) + 6, run_km, cyc_km, round(eq, 2),
        tgt, is_paused OR eq >= tgt, pen, is_paused, paused_country
      ) RETURNING id INTO wk_id;
      inserted := inserted + 1;

      IF pen > 0 THEN
        SELECT user_id INTO other FROM public.challenge_members
        WHERE challenge_id = _c AND user_id <> m.user_id LIMIT 1;
        IF other IS NOT NULL THEN
          INSERT INTO public.challenge_payments(
            challenge_id, week_id, payer_id, recipient_id, amount_eur
          ) VALUES (_c, wk_id, m.user_id, other, pen)
          ON CONFLICT (week_id) DO NOTHING;
        END IF;
      END IF;
    END LOOP;
  END LOOP;
  RETURN inserted;
END;
$$;

-- Duration now decides whether distance counts, so it is part of both the edit guard
-- and protected audit history. Legacy rows remain readable; any new entry needs it.
CREATE OR REPLACE FUNCTION public.guard_activity()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
  actor uuid := auth.uid();
  row_challenge uuid := CASE WHEN TG_OP = 'INSERT' THEN NEW.challenge_id ELSE OLD.challenge_id END;
  activity_user uuid := CASE WHEN TG_OP = 'INSERT' THEN NEW.user_id ELSE OLD.user_id END;
  qualification_changed boolean;
BEGIN
  IF actor IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  IF activity_user <> actor THEN
    IF TG_OP = 'INSERT' THEN RAISE EXCEPTION 'You can only log your own activities'; END IF;
    IF TG_OP = 'UPDATE' THEN RAISE EXCEPTION 'You can only edit your own activities'; END IF;
    RAISE EXCEPTION 'You can only delete your own activities';
  END IF;
  IF NOT private.is_challenge_member(row_challenge) THEN
    RAISE EXCEPTION 'Not a member of this challenge';
  END IF;

  IF TG_OP = 'INSERT' THEN
    IF NEW.duration_seconds IS NULL THEN
      RAISE EXCEPTION 'Duration is required to verify pace or speed';
    END IF;
    IF NOT private.challenge_week_open(NEW.challenge_id, NEW.activity_date) THEN
      RAISE EXCEPTION 'That week is closed or the date is invalid';
    END IF;
    IF EXISTS (
      SELECT 1 FROM public.challenge_weeks w
      WHERE w.challenge_id = NEW.challenge_id
        AND w.user_id = NEW.user_id
        AND w.week_number = private.challenge_week_of(NEW.challenge_id, NEW.activity_date)
    ) THEN RAISE EXCEPTION 'Finalized activity cannot be changed'; END IF;
    RETURN NEW;
  END IF;

  IF TG_OP = 'UPDATE' THEN
    IF NEW.user_id IS DISTINCT FROM OLD.user_id
       OR NEW.challenge_id IS DISTINCT FROM OLD.challenge_id THEN
      RAISE EXCEPTION 'Immutable activity identity';
    END IF;
    IF NOT private.challenge_week_open(OLD.challenge_id, OLD.activity_date)
       OR NOT private.challenge_week_open(NEW.challenge_id, NEW.activity_date) THEN
      RAISE EXCEPTION 'That week is closed';
    END IF;
    IF EXISTS (
      SELECT 1 FROM public.challenge_weeks w
      WHERE w.challenge_id = OLD.challenge_id
        AND w.user_id = OLD.user_id
        AND w.week_number = private.challenge_week_of(OLD.challenge_id, OLD.activity_date)
    ) THEN RAISE EXCEPTION 'Finalized activity cannot be changed'; END IF;

    qualification_changed :=
      NEW.activity_type IS DISTINCT FROM OLD.activity_type
      OR NEW.distance_km IS DISTINCT FROM OLD.distance_km
      OR NEW.activity_date IS DISTINCT FROM OLD.activity_date
      OR NEW.duration_seconds IS DISTINCT FROM OLD.duration_seconds;
    IF qualification_changed AND NEW.duration_seconds IS NULL THEN
      RAISE EXCEPTION 'Duration is required to verify pace or speed';
    END IF;
    IF qualification_changed THEN NEW.edited := true; END IF;
    RETURN NEW;
  END IF;

  IF NOT private.challenge_week_open(OLD.challenge_id, OLD.activity_date) THEN
    RAISE EXCEPTION 'That week is closed';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.challenge_weeks w
    WHERE w.challenge_id = OLD.challenge_id
      AND w.user_id = OLD.user_id
      AND w.week_number = private.challenge_week_of(OLD.challenge_id, OLD.activity_date)
  ) THEN RAISE EXCEPTION 'Finalized activity cannot be changed'; END IF;
  RETURN OLD;
END;
$$;

CREATE OR REPLACE FUNCTION private.capture_challenge_activity_audit()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF NEW.activity_type IS DISTINCT FROM OLD.activity_type
       OR NEW.distance_km IS DISTINCT FROM OLD.distance_km
       OR NEW.activity_date IS DISTINCT FROM OLD.activity_date
       OR NEW.duration_seconds IS DISTINCT FROM OLD.duration_seconds THEN
      INSERT INTO public.challenge_activity_audit(
        activity_id, challenge_id, changed_by, action,
        old_activity_type, old_distance_km, old_activity_date, old_duration_seconds
      ) VALUES (
        OLD.id, OLD.challenge_id, auth.uid(), 'update', OLD.activity_type,
        OLD.distance_km, OLD.activity_date, OLD.duration_seconds
      );
    END IF;
    RETURN NULL;
  END IF;

  INSERT INTO public.challenge_activity_audit(
    activity_id, challenge_id, changed_by, action,
    old_activity_type, old_distance_km, old_activity_date, old_duration_seconds
  ) VALUES (
    OLD.id, OLD.challenge_id, auth.uid(), 'delete', OLD.activity_type,
    OLD.distance_km, OLD.activity_date, OLD.duration_seconds
  );
  RETURN NULL;
END;
$$;

-- Keep the transactional outbox and dedupe keys unchanged. Only the authoritative
-- counted distance changes from theoretical conversion to qualified conversion.
CREATE OR REPLACE FUNCTION private.capture_challenge_activity_push()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  batch record;
  activity record;
  week_start date;
  total numeric;
  previous_total numeric;
  old_total numeric;
  target numeric;
  paused boolean;
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF NOT EXISTS (
      SELECT 1 FROM new_activities n JOIN old_activities o USING (id)
      WHERE n.distance_km IS DISTINCT FROM o.distance_km
        OR n.activity_type IS DISTINCT FROM o.activity_type
        OR n.activity_date IS DISTINCT FROM o.activity_date
        OR n.duration_seconds IS DISTINCT FROM o.duration_seconds
    ) THEN RETURN NULL; END IF;
  END IF;

  FOR batch IN
    SELECT n.challenge_id, n.user_id,
      private.challenge_week_of(n.challenge_id, n.activity_date) AS week_no,
      sum(n.qualifying_equivalent_km) AS new_total
    FROM new_activities n
    WHERE private.challenge_week_open(n.challenge_id, n.activity_date)
    GROUP BY n.challenge_id, n.user_id,
      private.challenge_week_of(n.challenge_id, n.activity_date)
  LOOP
    SELECT start_date + (batch.week_no - 1) * 7 INTO week_start
    FROM public.challenges WHERE id = batch.challenge_id;
    SELECT coalesce(sum(qualifying_equivalent_km), 0) INTO total
    FROM public.challenge_activities
    WHERE challenge_id = batch.challenge_id AND user_id = batch.user_id
      AND activity_date BETWEEN week_start AND week_start + 6;

    paused := private.challenge_week_paused(batch.challenge_id, batch.user_id, batch.week_no);
    target := CASE WHEN paused THEN 0 ELSE 15 END;
    previous_total := total - batch.new_total;
    IF TG_OP = 'UPDATE' THEN
      SELECT coalesce(sum(qualifying_equivalent_km), 0) INTO old_total
      FROM old_activities
      WHERE challenge_id = batch.challenge_id AND user_id = batch.user_id
        AND activity_date BETWEEN week_start AND week_start + 6;
      previous_total := previous_total + old_total;
    ELSE
      FOR activity IN
        SELECT * FROM new_activities
        WHERE challenge_id = batch.challenge_id AND user_id = batch.user_id
          AND activity_date BETWEEN week_start AND week_start + 6
      LOOP
        PERFORM private.enqueue_challenge_push(
          activity.challenge_id, activity.user_id, 'activity_posted',
          'activity:' || activity.id,
          jsonb_build_object(
            'activity_type', activity.activity_type,
            'distance_km', activity.distance_km,
            'equivalent_km', activity.qualifying_equivalent_km,
            'qualified', activity.is_qualified,
            'total_km', total,
            'target_km', 15,
            'paused', paused
          )
        );
      END LOOP;
    END IF;

    IF NOT paused AND previous_total < target AND total >= target THEN
      PERFORM private.enqueue_challenge_push(
        batch.challenge_id, batch.user_id, 'target_reached',
        'target:' || batch.challenge_id || ':' || batch.user_id || ':' || batch.week_no,
        jsonb_build_object('target_km', target)
      );
    END IF;
  END LOOP;
  RETURN NULL;
END;
$$;

REVOKE ALL ON FUNCTION public.guard_activity(),
  private.capture_challenge_activity_audit(),
  private.capture_challenge_activity_push()
  FROM PUBLIC, anon, authenticated;

