-- Leaving after a Challenge ended walked one week past duration_weeks and froze a phantom Run leg.
-- Bound the loop the same way recompute_streak does; everything else is unchanged.
CREATE OR REPLACE FUNCTION private.freeze_run_legs_on_leave(_challenge uuid, _user uuid)
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
  FOR w IN 1 .. least(public.challenge_week_of(_challenge, (now() AT TIME ZONE ch.timezone)::date), ch.duration_weeks) LOOP
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
