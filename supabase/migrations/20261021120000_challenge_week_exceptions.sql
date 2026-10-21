-- Challenge week exceptions: sick/excused weeks and late-completion review.
--
-- Neither participant can excuse themselves or reverse a result alone. A request is recorded and the
-- COUNTERPARTY approves or rejects it. Approval of a finalized week is applied through an authorized,
-- auditable correction that bypasses the finalized-result and payment guards for exactly that one
-- change (gated by a transaction-local GUC that only these RPCs set).
--
-- Money/photo truth is never silently rewritten:
--   * an unpaid / marked_paid obligation is cancelled (new terminal payment_status 'cancelled');
--   * a confirmed_paid obligation is PRESERVED and the result returns payment_manual_resolution_required;
--   * the challenge-level legacy_photo_owed flag is NEVER touched (photos are derived per-payment from
--     the money amount), and photo_manual_resolution_required is returned when a settled, photo-bearing
--     obligation remains.
-- Streak legs are re-settled (sick -> paused, late completion -> completed) unless the streak week is
-- already locked, in which case streak_manual_resolution_required is returned.
--
-- No UI, no notification kinds, and no production data are changed here.

-- ---------------------------------------------------------------- payment cancellation support
ALTER TYPE public.payment_status ADD VALUE IF NOT EXISTS 'cancelled';

ALTER TABLE public.challenge_payments
  ADD COLUMN IF NOT EXISTS cancelled_at timestamptz,
  ADD COLUMN IF NOT EXISTS cancelled_reason text;

-- ---------------------------------------------------------------- week result audit markers
ALTER TABLE public.challenge_weeks
  ADD COLUMN IF NOT EXISTS excuse_reason text
    CHECK (excuse_reason IS NULL OR excuse_reason IN ('travel','sick')),
  ADD COLUMN IF NOT EXISTS corrected_at timestamptz;

-- ---------------------------------------------------------------- request/approval record
CREATE TABLE public.challenge_week_adjustments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  challenge_id uuid NOT NULL REFERENCES public.challenges(id) ON DELETE CASCADE,
  user_id uuid NOT NULL,                       -- the subject participant (who is sick / completed late)
  week_number integer NOT NULL CHECK (week_number >= 1),
  kind text NOT NULL CHECK (kind IN ('sick','late_completion')),
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected','cancelled')),
  requested_by uuid NOT NULL,
  reviewed_by uuid,
  note text CHECK (note IS NULL OR char_length(note) <= 500),
  evidence_path text CHECK (evidence_path IS NULL OR char_length(evidence_path) <= 500),
  -- Snapshot of the finalized result at the moment a correction is applied (audit trail).
  original_completed boolean,
  original_penalty_eur numeric(6,2),
  created_at timestamptz NOT NULL DEFAULT now(),
  reviewed_at timestamptz,
  CONSTRAINT challenge_week_adjustments_subject_ck CHECK (requested_by = user_id)
);
-- At most one pending request per participant/week/kind; duplicates are prevented, not created.
CREATE UNIQUE INDEX challenge_week_adjustments_one_pending_uidx
  ON public.challenge_week_adjustments(challenge_id, user_id, week_number, kind)
  WHERE status = 'pending';
CREATE INDEX challenge_week_adjustments_lookup_idx
  ON public.challenge_week_adjustments(challenge_id, user_id, week_number);

ALTER TABLE public.challenge_week_adjustments ENABLE ROW LEVEL SECURITY;

-- Both participants can read the challenge's requests; all writes go through the RPCs below.
CREATE POLICY "week adjustments read members" ON public.challenge_week_adjustments
FOR SELECT TO authenticated
USING (EXISTS (
  SELECT 1 FROM public.challenge_members m
  WHERE m.challenge_id = challenge_id AND m.user_id = auth.uid()
));

GRANT SELECT ON public.challenge_week_adjustments TO authenticated;
GRANT ALL ON public.challenge_week_adjustments TO service_role;

-- ---------------------------------------------------------------- guards: allow one authorized correction
-- Finalized challenge_weeks stay immutable to normal edits; an approved correction sets the
-- transaction-local flag app.week_correction so block_change permits exactly that UPDATE.
CREATE OR REPLACE FUNCTION public.block_change()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
begin
  if tg_op = 'UPDATE' and current_setting('app.week_correction', true) = 'on' then
    return new;
  end if;
  raise exception 'Finalized results are immutable';
end;
$$;

-- Payment guard gains one authorized terminal transition: unpaid|marked_paid -> cancelled, only during
-- an approved week correction. Users can never reach 'cancelled' (RLS WITH CHECK forbids it), and a
-- confirmed_paid obligation is never cancelled here.
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

  -- Authorized cancellation of a still-open obligation during a week correction.
  if new.status = 'cancelled' and old.status in ('unpaid','marked_paid') then
    if current_setting('app.week_correction', true) is distinct from 'on' then
      raise exception 'Payments can only be cancelled through an approved week correction';
    end if;
    new.cancelled_at := now();
    new.confirmed_at := null;
    new.settled_by := null;
    -- marked_paid_at, amount and evidence are preserved as historical truth.
    return new;
  end if;

  -- Payer marks their own obligation as sent; it now awaits recipient confirmation.
  if new.status = 'marked_paid' and old.status = 'unpaid' then
    if auth.uid() <> old.payer_id then raise exception 'Only the payer can mark a payment as paid'; end if;
    new.marked_paid_at := now();
    new.confirmed_at := null;
    new.settled_by := null;
    return new;
  end if;

  -- Reopen an awaiting-confirmation obligation back to OPEN: payer undo or recipient "Not received".
  if new.status = 'unpaid' and old.status = 'marked_paid' then
    if auth.uid() <> old.payer_id and auth.uid() <> old.recipient_id then
      raise exception 'Only the payer or recipient can reopen this';
    end if;
    new.marked_paid_at := null;
    new.confirmed_at := null;
    new.settled_by := null;
    return new;
  end if;

  -- ONLY the recipient may settle, and only from marked_paid.
  if new.status = 'confirmed_paid' and old.status <> 'confirmed_paid' then
    if auth.uid() <> old.recipient_id then raise exception 'Only the recipient can confirm this payment'; end if;
    if old.status <> 'marked_paid' then raise exception 'Payment must be marked as paid first'; end if;
    new.marked_paid_at := coalesce(old.marked_paid_at, now());
    new.confirmed_at := now();
    new.settled_by := old.recipient_id;
    return new;
  end if;

  -- Reopen a settled payment (mistake recovery) only by the recipient who settled it.
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

-- ---------------------------------------------------------------- finalize honors approved sick
-- Identical to the prior finalize_challenge, plus: an APPROVED pre-finalization sick request for a
-- (participant, week) is treated like a pause — target 0, excused/complete, no penalty, no payment —
-- and excuse_reason records travel vs sick for an auditable history label.
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
  band text;
  consequence text;
  tgt numeric;
  is_paused boolean;
  is_sick boolean;
  is_excused boolean;
  paused_country text;
  reason text;
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
      -- An approved sick request excuses the week exactly like a travel pause (no penalty), but is
      -- recorded distinctly via excuse_reason for an auditable history label.
      is_sick := EXISTS (
        SELECT 1 FROM public.challenge_week_adjustments a
        WHERE a.challenge_id = _c AND a.user_id = m.user_id AND a.week_number = w
          AND a.kind = 'sick' AND a.status = 'approved'
      );
      is_excused := is_paused OR is_sick;
      SELECT pause.country INTO paused_country
      FROM public.challenge_travel_pauses pause
      WHERE pause.challenge_id = _c AND pause.user_id = m.user_id
        AND pause.week_number = w;
      reason := CASE WHEN is_sick THEN 'sick' WHEN is_paused THEN 'travel' ELSE NULL END;
      tgt := CASE WHEN is_excused THEN 0 ELSE private.target_for_week(_c, w, m.user_id) END;
      band := CASE WHEN is_excused THEN NULL ELSE private.penalty_band_for(eq, tgt) END;
      IF ch.penalty_mode = 'money' THEN
        pen := CASE WHEN is_excused THEN 0
                    ELSE public.penalty_for(eq, tgt, ch.penalty_high_eur, ch.penalty_medium_eur, ch.penalty_low_eur)
               END;
        consequence := NULL;
      ELSE
        pen := 0;
        consequence := CASE band
          WHEN 'high' THEN ch.penalty_high_custom
          WHEN 'medium' THEN ch.penalty_medium_custom
          WHEN 'low' THEN ch.penalty_low_custom
          ELSE NULL
        END;
      END IF;

      INSERT INTO public.challenge_weeks(
        challenge_id, user_id, week_number, week_start, week_end,
        running_km, cycling_km, equivalent_km, target_km, completed,
        penalty_eur, penalty_mode, penalty_band, penalty_consequence, paused, pause_country, excuse_reason
      ) VALUES (
        _c, m.user_id, w, ch.start_date + ((w - 1) * 7),
        ch.start_date + ((w - 1) * 7) + 6, run_km, cyc_km, round(eq, 2),
        tgt, is_excused OR eq >= tgt, pen, ch.penalty_mode, band, consequence,
        is_excused, paused_country, reason
      ) RETURNING id INTO wk_id;
      inserted := inserted + 1;

      IF ch.penalty_mode = 'money' AND pen > 0 THEN
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

-- ---------------------------------------------------------------- RPC: request an exception (subject)
CREATE FUNCTION public.request_challenge_week_exception(
  _challenge uuid,
  _week integer,
  _kind text,
  _note text DEFAULT NULL,
  _evidence_path text DEFAULT NULL,
  _request_id uuid DEFAULT gen_random_uuid()
)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  caller uuid := (SELECT auth.uid());
  result_id uuid;
  wk record;
BEGIN
  IF caller IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  IF _kind NOT IN ('sick','late_completion') THEN RAISE EXCEPTION 'Invalid exception kind'; END IF;
  IF _week IS NULL OR _week < 1 THEN RAISE EXCEPTION 'Invalid week'; END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.challenge_members WHERE challenge_id = _challenge AND user_id = caller
  ) THEN RAISE EXCEPTION 'Not a member of this challenge'; END IF;
  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(_challenge::text || ':' || caller::text || ':week-exception', 0));

  -- Idempotent replay by request id.
  SELECT id INTO result_id FROM public.challenge_week_adjustments WHERE id = _request_id;
  IF result_id IS NOT NULL THEN RETURN result_id; END IF;

  -- Late completion only applies to a finalized, not-completed week of the caller's own.
  IF _kind = 'late_completion' THEN
    SELECT completed INTO wk FROM public.challenge_weeks
    WHERE challenge_id = _challenge AND user_id = caller AND week_number = _week;
    IF NOT FOUND THEN RAISE EXCEPTION 'That week has not been finalized yet'; END IF;
    IF wk.completed THEN RAISE EXCEPTION 'That week is already completed'; END IF;
  END IF;

  -- Reuse an existing pending request rather than creating a duplicate.
  SELECT id INTO result_id FROM public.challenge_week_adjustments
  WHERE challenge_id = _challenge AND user_id = caller AND week_number = _week
    AND kind = _kind AND status = 'pending';
  IF result_id IS NOT NULL THEN RETURN result_id; END IF;

  INSERT INTO public.challenge_week_adjustments(
    id, challenge_id, user_id, week_number, kind, status, requested_by, note, evidence_path
  ) VALUES (
    _request_id, _challenge, caller, _week, _kind, 'pending', caller,
    nullif(btrim(_note), ''), nullif(btrim(_evidence_path), '')
  ) RETURNING id INTO result_id;
  RETURN result_id;
END;
$$;

-- ---------------------------------------------------------------- RPC: cancel own pending request
CREATE FUNCTION public.cancel_challenge_week_exception(_adjustment uuid)
RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  caller uuid := (SELECT auth.uid());
  adj public.challenge_week_adjustments;
BEGIN
  IF caller IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  SELECT * INTO adj FROM public.challenge_week_adjustments WHERE id = _adjustment FOR UPDATE;
  IF adj.id IS NULL OR adj.requested_by <> caller THEN RETURN false; END IF;  -- not found / not owner
  IF adj.status <> 'pending' THEN RETURN false; END IF;
  UPDATE public.challenge_week_adjustments
  SET status = 'cancelled', reviewed_at = now()
  WHERE id = _adjustment;
  RETURN true;
END;
$$;

-- ---------------------------------------------------------------- RPC: counterparty approve/reject
CREATE FUNCTION public.review_challenge_week_exception(_adjustment uuid, _approve boolean)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  caller uuid := (SELECT auth.uid());
  adj public.challenge_week_adjustments;
  ch record;
  wk record;
  pay record;
  leg record;
  payment_action text := 'none';
  payment_manual boolean := false;
  photo_manual boolean := false;
  streak_manual boolean := false;
BEGIN
  IF caller IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  SELECT * INTO adj FROM public.challenge_week_adjustments WHERE id = _adjustment FOR UPDATE;
  IF adj.id IS NULL THEN RAISE EXCEPTION 'Request not found'; END IF;
  IF adj.status <> 'pending' THEN RAISE EXCEPTION 'Request is no longer pending'; END IF;
  -- Reviewer must be the OTHER member; the subject can never approve/reject their own request.
  IF caller = adj.user_id THEN RAISE EXCEPTION 'You cannot review your own request'; END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.challenge_members WHERE challenge_id = adj.challenge_id AND user_id = caller
  ) THEN RAISE EXCEPTION 'Not a member of this challenge'; END IF;
  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(adj.challenge_id::text || ':week-exception-review', 0));

  IF NOT _approve THEN
    UPDATE public.challenge_week_adjustments
    SET status = 'rejected', reviewed_by = caller, reviewed_at = now()
    WHERE id = _adjustment;
    RETURN jsonb_build_object('status', 'rejected', 'kind', adj.kind);
  END IF;

  SELECT * INTO ch FROM public.challenges WHERE id = adj.challenge_id;

  -- Apply to the finalized week if one exists. (A sick request approved before finalization needs no
  -- correction now; finalize_challenge will honor the approved request.)
  SELECT * INTO wk FROM public.challenge_weeks
  WHERE challenge_id = adj.challenge_id AND user_id = adj.user_id AND week_number = adj.week_number;

  IF wk.id IS NULL THEN
    IF adj.kind = 'late_completion' THEN RAISE EXCEPTION 'That week has not been finalized yet'; END IF;
  ELSE
    IF adj.kind = 'late_completion' AND wk.completed THEN
      RAISE EXCEPTION 'That week is already completed';
    END IF;

    -- Authorize exactly the correction UPDATEs below.
    PERFORM set_config('app.week_correction', 'on', true);

    UPDATE public.challenge_weeks
    SET completed = true,
        penalty_eur = 0,
        paused = CASE WHEN adj.kind = 'sick' THEN true ELSE paused END,
        excuse_reason = CASE WHEN adj.kind = 'sick' THEN 'sick' ELSE excuse_reason END,
        corrected_at = now()
    WHERE id = wk.id;

    -- Settle the money obligation for this week, if any.
    SELECT * INTO pay FROM public.challenge_payments WHERE week_id = wk.id;
    IF pay.id IS NULL THEN
      payment_action := 'none';
    ELSIF pay.status = 'confirmed_paid' THEN
      payment_action := 'already_settled';   -- preserve settled money exactly; flag for manual handling
      payment_manual := true;
    ELSE
      UPDATE public.challenge_payments
      SET status = 'cancelled', cancelled_reason = adj.kind
      WHERE id = pay.id;
      payment_action := 'cancelled';
    END IF;

    PERFORM set_config('app.week_correction', 'off', true);

    -- Photos are derived from the money amount, gated by the challenge-level legacy_photo_owed flag,
    -- which is NEVER cleared here. If a settled, photo-bearing obligation remains, flag it.
    photo_manual := coalesce(ch.legacy_photo_owed, false) AND payment_action = 'already_settled';

    -- Re-settle the subject's streak run leg (sick -> paused, late completion -> completed) unless the
    -- streak week is already locked.
    SELECT l.id AS leg_id, s.locked_at AS locked_at INTO leg
    FROM public.streak_week_run_legs l
    LEFT JOIN public.streak_weeks s ON s.user_id = l.user_id AND s.week_start = l.week_start
    WHERE l.user_id = adj.user_id
      AND l.source_challenge_id = adj.challenge_id
      AND l.challenge_week_number = adj.week_number;
    IF leg.leg_id IS NOT NULL THEN
      IF leg.locked_at IS NOT NULL THEN
        streak_manual := true;
      ELSE
        UPDATE public.streak_week_run_legs
        SET source_week_id = wk.id,
            target_km = 0,
            settlement_state = CASE WHEN adj.kind = 'sick' THEN 'paused' ELSE 'completed' END::public.streak_leg_state,
            settled_at = now()
        WHERE id = leg.leg_id;
      END IF;
    END IF;

    UPDATE public.challenge_week_adjustments
    SET original_completed = wk.completed, original_penalty_eur = wk.penalty_eur
    WHERE id = _adjustment;
  END IF;

  UPDATE public.challenge_week_adjustments
  SET status = 'approved', reviewed_by = caller, reviewed_at = now()
  WHERE id = _adjustment;

  RETURN jsonb_build_object(
    'status', 'approved',
    'kind', adj.kind,
    'week_corrected', wk.id IS NOT NULL,
    'payment_action', payment_action,
    'payment_manual_resolution_required', payment_manual,
    'photo_manual_resolution_required', photo_manual,
    'streak_manual_resolution_required', streak_manual
  );
END;
$$;

-- ---------------------------------------------------------------- grants
REVOKE ALL ON FUNCTION public.request_challenge_week_exception(uuid, integer, text, text, text, uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.cancel_challenge_week_exception(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.review_challenge_week_exception(uuid, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.request_challenge_week_exception(uuid, integer, text, text, text, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.cancel_challenge_week_exception(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.review_challenge_week_exception(uuid, boolean) TO authenticated;
