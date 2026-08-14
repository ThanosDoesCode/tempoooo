DROP FUNCTION IF EXISTS public.accept_bulk_invitation(text);
DROP FUNCTION IF EXISTS public.accept_challenge_invitation(text);
DROP FUNCTION IF EXISTS public.ensure_bulk_profile();
DROP FUNCTION IF EXISTS public.set_bulk_editor(uuid, uuid, boolean);
DROP FUNCTION IF EXISTS public.finalize_challenge(uuid);
DROP FUNCTION IF EXISTS public.related_profiles();

CREATE FUNCTION public.ensure_bulk_profile(_caller uuid)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE bid uuid;
BEGIN
  IF _caller IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  SELECT bulk_profile_id INTO bid
  FROM public.bulk_members
  WHERE user_id = _caller AND role = 'owner'
  LIMIT 1;
  IF bid IS NOT NULL THEN RETURN bid; END IF;

  INSERT INTO public.bulk_profiles(owner_id) VALUES (_caller) RETURNING id INTO bid;
  INSERT INTO public.bulk_members(bulk_profile_id, user_id, role, invited_by)
  VALUES (bid, _caller, 'owner', _caller);
  INSERT INTO public.bulk_targets(bulk_profile_id, payload)
  VALUES (bid, '{}'::jsonb) ON CONFLICT DO NOTHING;
  RETURN bid;
END;
$function$;

CREATE FUNCTION public.set_bulk_editor(_caller uuid, _bulk uuid, _user uuid, _editor boolean)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
BEGIN
  IF _caller IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.bulk_members
    WHERE bulk_profile_id = _bulk AND user_id = _caller AND role = 'owner'
  ) THEN RAISE EXCEPTION 'Only the owner can change roles'; END IF;

  UPDATE public.bulk_members
  SET role = CASE WHEN _editor THEN 'editor'::public.bulk_role ELSE 'viewer'::public.bulk_role END
  WHERE bulk_profile_id = _bulk AND user_id = _user AND role <> 'owner';
END;
$function$;

CREATE FUNCTION public.accept_bulk_invitation(_caller uuid, _email text, _token text)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE inv record;
BEGIN
  IF _caller IS NULL OR coalesce(_email, '') = '' THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  SELECT * INTO inv
  FROM public.bulk_invitations
  WHERE token_hash = encode(sha256(_token::bytea), 'hex')
  FOR UPDATE
  LIMIT 1;
  IF inv IS NULL THEN RAISE EXCEPTION 'Invalid invitation'; END IF;
  IF inv.accepted_at IS NOT NULL OR inv.revoked_at IS NOT NULL THEN RAISE EXCEPTION 'This invitation is no longer valid'; END IF;
  IF inv.expires_at < now() THEN RAISE EXCEPTION 'This invitation has expired'; END IF;
  IF lower(inv.invited_email) <> lower(_email) THEN RAISE EXCEPTION 'This invitation was sent to a different email address'; END IF;

  INSERT INTO public.bulk_members(bulk_profile_id, user_id, role, invited_by)
  VALUES (inv.bulk_profile_id, _caller, inv.role, inv.created_by)
  ON CONFLICT (bulk_profile_id, user_id) DO NOTHING;
  UPDATE public.bulk_invitations SET accepted_at = now() WHERE id = inv.id;
  RETURN inv.bulk_profile_id;
END;
$function$;

CREATE FUNCTION public.accept_challenge_invitation(_caller uuid, _email text, _token text)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE inv record; n int;
BEGIN
  IF _caller IS NULL OR coalesce(_email, '') = '' THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  SELECT * INTO inv
  FROM public.challenge_invitations
  WHERE token_hash = encode(sha256(_token::bytea), 'hex')
  FOR UPDATE
  LIMIT 1;
  IF inv IS NULL THEN RAISE EXCEPTION 'Invalid invitation'; END IF;
  IF inv.accepted_at IS NOT NULL OR inv.revoked_at IS NOT NULL THEN RAISE EXCEPTION 'This invitation is no longer valid'; END IF;
  IF inv.expires_at < now() THEN RAISE EXCEPTION 'This invitation has expired'; END IF;
  IF lower(inv.invited_email) <> lower(_email) THEN RAISE EXCEPTION 'This invitation was sent to a different email address'; END IF;

  SELECT count(*) INTO n FROM public.challenge_members WHERE challenge_id = inv.challenge_id;
  IF n >= 2 THEN RAISE EXCEPTION 'This challenge is already full'; END IF;
  INSERT INTO public.challenge_members(challenge_id, user_id)
  VALUES (inv.challenge_id, _caller)
  ON CONFLICT (challenge_id, user_id) DO NOTHING;
  UPDATE public.challenge_invitations SET accepted_at = now() WHERE id = inv.id;
  UPDATE public.challenge_invitations SET revoked_at = now()
  WHERE challenge_id = inv.challenge_id AND accepted_at IS NULL AND revoked_at IS NULL;
  RETURN inv.challenge_id;
END;
$function$;

CREATE FUNCTION public.finalize_challenge(_caller uuid, _c uuid)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE ch record; cur int; w int; m record; other uuid;
  run_km numeric; cyc_km numeric; eq numeric; pen numeric; wk_id uuid; inserted int := 0;
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
      pen := public.penalty_for(eq);
      INSERT INTO public.challenge_weeks(challenge_id, user_id, week_number, week_start, week_end, running_km, cycling_km, equivalent_km, target_km, completed, penalty_eur)
      VALUES (_c, m.user_id, w, ch.start_date + ((w - 1) * 7), ch.start_date + ((w - 1) * 7) + 6, run_km, cyc_km, round(eq, 2), ch.weekly_target_km, eq >= ch.weekly_target_km, pen)
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
$function$;

CREATE FUNCTION public.related_profiles(_caller uuid)
RETURNS TABLE(id uuid, display_name text, email text)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $function$
  SELECT p.id, p.display_name, p.email
  FROM public.profiles p
  WHERE _caller IS NOT NULL
    AND (
      p.id = _caller
      OR p.id IN (
        SELECT bm.user_id FROM public.bulk_members bm
        WHERE bm.bulk_profile_id IN (
          SELECT bulk_profile_id FROM public.bulk_members WHERE user_id = _caller
        )
      )
      OR p.id IN (
        SELECT cm.user_id FROM public.challenge_members cm
        WHERE cm.challenge_id IN (
          SELECT challenge_id FROM public.challenge_members WHERE user_id = _caller
        )
      )
    )
$function$;

REVOKE ALL ON FUNCTION public.ensure_bulk_profile(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.set_bulk_editor(uuid, uuid, uuid, boolean) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.accept_bulk_invitation(uuid, text, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.accept_challenge_invitation(uuid, text, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.finalize_challenge(uuid, uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.related_profiles(uuid) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.ensure_bulk_profile(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.set_bulk_editor(uuid, uuid, uuid, boolean) TO service_role;
GRANT EXECUTE ON FUNCTION public.accept_bulk_invitation(uuid, text, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.accept_challenge_invitation(uuid, text, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.finalize_challenge(uuid, uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.related_profiles(uuid) TO service_role;