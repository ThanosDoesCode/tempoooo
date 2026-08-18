-- 1) Per-week target overrides
CREATE TABLE public.challenge_week_targets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  challenge_id uuid NOT NULL REFERENCES public.challenges(id) ON DELETE CASCADE,
  week_number integer NOT NULL,
  target_km numeric NOT NULL CHECK (target_km >= 0 AND target_km <= 500),
  set_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (challenge_id, week_number)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.challenge_week_targets TO authenticated;
GRANT ALL ON public.challenge_week_targets TO service_role;

ALTER TABLE public.challenge_week_targets ENABLE ROW LEVEL SECURITY;

CREATE POLICY "cwt read members" ON public.challenge_week_targets
  FOR SELECT TO authenticated USING (private.is_challenge_member(challenge_id));

CREATE POLICY "cwt insert creator" ON public.challenge_week_targets
  FOR INSERT TO authenticated WITH CHECK (
    set_by = auth.uid()
    AND EXISTS (SELECT 1 FROM public.challenges c WHERE c.id = challenge_id AND c.created_by = auth.uid())
  );

CREATE POLICY "cwt update creator" ON public.challenge_week_targets
  FOR UPDATE TO authenticated
  USING (EXISTS (SELECT 1 FROM public.challenges c WHERE c.id = challenge_id AND c.created_by = auth.uid()))
  WITH CHECK (EXISTS (SELECT 1 FROM public.challenges c WHERE c.id = challenge_id AND c.created_by = auth.uid()));

CREATE POLICY "cwt delete creator" ON public.challenge_week_targets
  FOR DELETE TO authenticated
  USING (EXISTS (SELECT 1 FROM public.challenges c WHERE c.id = challenge_id AND c.created_by = auth.uid()));

CREATE OR REPLACE FUNCTION public.guard_week_target()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public', 'private'
AS $$
DECLARE cur integer; wk integer; ch record;
BEGIN
  wk := coalesce(new.week_number, old.week_number);
  SELECT * INTO ch FROM public.challenges WHERE id = coalesce(new.challenge_id, old.challenge_id);
  IF ch IS NULL THEN RAISE EXCEPTION 'Challenge not found'; END IF;
  IF wk < 1 OR wk > ch.duration_weeks THEN RAISE EXCEPTION 'That week is outside the challenge'; END IF;
  cur := private.challenge_week_of(ch.id, private.challenge_today(ch.id));
  IF wk <= cur THEN RAISE EXCEPTION 'Only future weeks can have their target changed'; END IF;
  IF tg_op = 'DELETE' THEN RETURN old; END IF;
  new.updated_at := now();
  RETURN new;
END;
$$;

CREATE TRIGGER challenge_week_targets_guard
BEFORE INSERT OR UPDATE OR DELETE ON public.challenge_week_targets
FOR EACH ROW EXECUTE FUNCTION public.guard_week_target();

-- 2) Proportional penalty tiers against an arbitrary target
CREATE OR REPLACE FUNCTION public.penalty_for(_km numeric, _target numeric)
RETURNS numeric
LANGUAGE sql
IMMUTABLE
SET search_path TO 'public'
AS $$
  SELECT CASE
    WHEN _target <= 0 OR _km >= _target THEN 0
    WHEN _km >= (_target * 2 / 3) THEN 5
    WHEN _km >= (_target / 3) THEN 10
    ELSE 15
  END::numeric
$$;

REVOKE ALL ON FUNCTION public.penalty_for(numeric, numeric) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.penalty_for(numeric, numeric) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION private.target_for_week(_c uuid, _w integer)
RETURNS numeric
LANGUAGE sql
STABLE
SET search_path TO 'public', 'private'
AS $$
  SELECT coalesce(
    (SELECT t.target_km FROM public.challenge_week_targets t WHERE t.challenge_id = _c AND t.week_number = _w),
    (SELECT c.weekly_target_km FROM public.challenges c WHERE c.id = _c)
  )
$$;

REVOKE ALL ON FUNCTION private.target_for_week(uuid, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION private.target_for_week(uuid, integer) TO authenticated, service_role;

-- 3) Finalization honours the per-week target
CREATE OR REPLACE FUNCTION public.finalize_challenge(_caller uuid, _c uuid)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'private'
AS $$
DECLARE ch record; cur int; w int; m record; other uuid;
  run_km numeric; cyc_km numeric; eq numeric; pen numeric; tgt numeric; wk_id uuid; inserted int := 0;
BEGIN
  IF _caller IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.challenge_members WHERE challenge_id = _c AND user_id = _caller
  ) THEN RAISE EXCEPTION 'Not a member of this challenge'; END IF;
  SELECT * INTO ch FROM public.challenges WHERE id = _c;
  IF ch IS NULL THEN RAISE EXCEPTION 'Challenge not found'; END IF;
  cur := public.challenge_week_of(_c, public.challenge_today(_c));
  FOR w IN 1 .. least(cur - 1, ch.duration_weeks) LOOP
    FOR m IN SELECT user_id FROM public.challenge_members WHERE challenge_id = _c LOOP
      IF EXISTS(SELECT 1 FROM public.challenge_weeks WHERE challenge_id = _c AND user_id = m.user_id AND week_number = w) THEN CONTINUE; END IF;
      SELECT coalesce(sum(CASE WHEN activity_type = 'run' THEN distance_km ELSE 0 END), 0),
             coalesce(sum(CASE WHEN activity_type = 'cycle' THEN distance_km ELSE 0 END), 0),
             coalesce(sum(equivalent_km), 0)
      INTO run_km, cyc_km, eq
      FROM public.challenge_activities
      WHERE challenge_id = _c AND user_id = m.user_id
        AND activity_date >= ch.start_date + ((w - 1) * 7)
        AND activity_date <= ch.start_date + ((w - 1) * 7) + 6;
      tgt := private.target_for_week(_c, w);
      pen := public.penalty_for(eq, tgt);
      INSERT INTO public.challenge_weeks(challenge_id, user_id, week_number, week_start, week_end, running_km, cycling_km, equivalent_km, target_km, completed, penalty_eur)
      VALUES (_c, m.user_id, w, ch.start_date + ((w - 1) * 7), ch.start_date + ((w - 1) * 7) + 6, run_km, cyc_km, round(eq, 2), tgt, eq >= tgt, pen)
      RETURNING id INTO wk_id;
      inserted := inserted + 1;
      IF pen > 0 THEN
        SELECT user_id INTO other FROM public.challenge_members
        WHERE challenge_id = _c AND user_id <> m.user_id LIMIT 1;
        IF other IS NOT NULL THEN
          INSERT INTO public.challenge_payments(challenge_id, week_id, payer_id, recipient_id, amount_eur)
          VALUES (_c, wk_id, m.user_id, other, pen) ON CONFLICT (week_id) DO NOTHING;
        END IF;
      END IF;
    END LOOP;
  END LOOP;
  RETURN inserted;
END;
$$;

-- 4) Settle up: the payer can clear what they owe, and undo their own settle
ALTER TABLE public.challenge_payments ADD COLUMN IF NOT EXISTS settled_by uuid;

CREATE OR REPLACE FUNCTION public.guard_payment()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $$
begin
  if new.challenge_id <> old.challenge_id or new.week_id <> old.week_id
     or new.payer_id <> old.payer_id or new.recipient_id <> old.recipient_id
     or new.amount_eur <> old.amount_eur then
    raise exception 'Payment obligation is immutable';
  end if;

  if new.status = old.status then
    return new;
  end if;

  if new.status = 'marked_paid' and old.status = 'unpaid' then
    if auth.uid() <> old.payer_id then raise exception 'Only the payer can mark a payment as paid'; end if;
    new.marked_paid_at := now();
    new.settled_by := null;
    return new;
  end if;

  if new.status = 'unpaid' and old.status = 'marked_paid' then
    if auth.uid() <> old.payer_id then raise exception 'Only the payer can undo this'; end if;
    new.marked_paid_at := null;
    new.settled_by := null;
    return new;
  end if;

  if new.status = 'confirmed_paid' and old.status <> 'confirmed_paid' then
    if auth.uid() = old.recipient_id and old.status = 'marked_paid' then
      new.confirmed_at := now();
      new.settled_by := null;
      return new;
    end if;
    if auth.uid() = old.payer_id then
      new.confirmed_at := now();
      new.marked_paid_at := coalesce(old.marked_paid_at, now());
      new.settled_by := old.payer_id;
      return new;
    end if;
    raise exception 'You cannot settle this payment';
  end if;

  if new.status = 'unpaid' and old.status = 'confirmed_paid' then
    if old.settled_by is null or auth.uid() <> old.settled_by then
      raise exception 'Only the person who settled this can reopen it';
    end if;
    new.confirmed_at := null;
    new.marked_paid_at := null;
    new.settled_by := null;
    return new;
  end if;

  raise exception 'Invalid payment transition';
end;
$$;

DROP POLICY IF EXISTS "cp payer update" ON public.challenge_payments;
CREATE POLICY "cp payer update" ON public.challenge_payments
  FOR UPDATE TO authenticated
  USING (payer_id = auth.uid())
  WITH CHECK (payer_id = auth.uid());