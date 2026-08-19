
CREATE OR REPLACE FUNCTION private.payment_update_ok(
  _id uuid, _challenge uuid, _week uuid, _payer uuid, _recipient uuid, _amount numeric, _status public.payment_status
) RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, private
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
        (o.status = 'unpaid' AND _status IN ('unpaid', 'marked_paid', 'confirmed_paid'))
        OR (o.status = 'marked_paid' AND _status IN ('marked_paid', 'unpaid', 'confirmed_paid'))
        OR (o.status = 'confirmed_paid' AND _status = 'confirmed_paid')
        OR (o.status = 'confirmed_paid' AND _status = 'unpaid' AND o.settled_by = auth.uid())
      )
  )
$$;

REVOKE ALL ON FUNCTION private.payment_update_ok(uuid, uuid, uuid, uuid, uuid, numeric, public.payment_status) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION private.payment_update_ok(uuid, uuid, uuid, uuid, uuid, numeric, public.payment_status) TO authenticated;

DROP POLICY IF EXISTS "cp payer update" ON public.challenge_payments;
CREATE POLICY "cp payer update" ON public.challenge_payments
FOR UPDATE TO authenticated
USING (payer_id = auth.uid())
WITH CHECK (
  payer_id = auth.uid()
  AND private.payment_update_ok(id, challenge_id, week_id, payer_id, recipient_id, amount_eur, status)
);
