-- Challenge money settlement is recipient-confirmed.
--
-- Before: the payer could reach 'confirmed_paid' themselves (unpaid/marked_paid -> confirmed_paid,
-- recording settled_by = payer), i.e. unilateral self-settlement, and the recipient had no way to
-- reject a false "paid". This tightens the state machine so:
--   OPEN (unpaid) --payer--> AWAITING (marked_paid)
--   AWAITING --recipient "Got it"--> SETTLED (confirmed_paid)
--   AWAITING --recipient "Not received" / payer undo--> OPEN (unpaid)
-- Only the recipient may settle. No schema/columns change; amounts, evidence (payment_evidence_path),
-- weeks and the existing unpaid->marked_paid 'payment_paid' push trigger are untouched.

-- Payer-side policy gate: the payer may only toggle unpaid <-> marked_paid; never reach a settled state.
CREATE OR REPLACE FUNCTION private.payment_update_ok(
  _id uuid, _challenge uuid, _week uuid, _payer uuid, _recipient uuid, _amount numeric, _status public.payment_status
) RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.challenge_payments o
    WHERE o.id = _id
      AND o.challenge_id = _challenge
      AND o.week_id = _week
      AND o.payer_id = _payer
      AND o.recipient_id = _recipient
      AND o.amount_eur = _amount
      AND (
        (o.status = 'unpaid' AND _status IN ('unpaid', 'marked_paid'))
        OR (o.status = 'marked_paid' AND _status IN ('marked_paid', 'unpaid'))
      )
  )
$$;

-- Recipient-side policy gate: confirm (marked_paid -> confirmed_paid), reject (marked_paid -> unpaid),
-- or reopen a settle they made (confirmed_paid -> unpaid). The trigger enforces the exact transitions.
DROP POLICY IF EXISTS "cp recipient confirm" ON public.challenge_payments;
CREATE POLICY "cp recipient confirm" ON public.challenge_payments
FOR UPDATE TO authenticated
USING (recipient_id = auth.uid() AND status IN ('marked_paid','confirmed_paid'))
WITH CHECK (recipient_id = auth.uid() AND status IN ('confirmed_paid','unpaid'));

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

  -- Each transition fully normalizes the settlement timestamps/settler for the TARGET status; it never
  -- relies on the previous row already being clean. Canonical invariant:
  --   unpaid         -> marked_paid_at NULL, confirmed_at NULL, settled_by NULL
  --   marked_paid    -> marked_paid_at NOT NULL, confirmed_at NULL, settled_by NULL
  --   confirmed_paid -> confirmed_at NOT NULL, settled_by = recipient

  -- Payer marks their own obligation as sent; it now awaits recipient confirmation.
  if new.status = 'marked_paid' and old.status = 'unpaid' then
    if auth.uid() <> old.payer_id then raise exception 'Only the payer can mark a payment as paid'; end if;
    new.marked_paid_at := now();
    new.confirmed_at := null;
    new.settled_by := null;
    return new;
  end if;

  -- Reopen an awaiting-confirmation obligation back to OPEN: the payer may undo, or the recipient may
  -- reject it ("Not received"). Amount and evidence are preserved either way.
  if new.status = 'unpaid' and old.status = 'marked_paid' then
    if auth.uid() <> old.payer_id and auth.uid() <> old.recipient_id then
      raise exception 'Only the payer or recipient can reopen this';
    end if;
    new.marked_paid_at := null;
    new.confirmed_at := null;
    new.settled_by := null;
    return new;
  end if;

  -- ONLY the recipient may settle, and only from marked_paid. marked_paid_at is preserved (it records
  -- when the payer sent it); settled_by records the recipient so they alone can reopen a mistake.
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