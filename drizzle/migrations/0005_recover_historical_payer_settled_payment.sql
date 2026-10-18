-- One-time recovery of a single legacy payer-self-settled payment into the
-- canonical recipient confirmation flow. Scoped to one exact payment id.
DO $recovery$
DECLARE
  v_row public.challenge_payments%ROWTYPE;
  v_count integer;
BEGIN
  SELECT * INTO v_row FROM public.challenge_payments
   WHERE id = '1f057efc-39cc-4058-a733-769f9822fb96'::uuid
   FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'recovery aborted: target payment not found';
  END IF;
  IF v_row.status IS DISTINCT FROM 'confirmed_paid'::public.payment_status THEN
    RAISE EXCEPTION 'recovery aborted: status is %, expected confirmed_paid', v_row.status;
  END IF;
  IF v_row.settled_by IS DISTINCT FROM v_row.payer_id THEN
    RAISE EXCEPTION 'recovery aborted: settled_by does not equal payer_id';
  END IF;

  ALTER TABLE public.challenge_payments DISABLE TRIGGER challenge_payments_guard;

  UPDATE public.challenge_payments
     SET status = 'marked_paid'::public.payment_status,
         marked_paid_at = COALESCE(v_row.marked_paid_at, v_row.confirmed_at),
         confirmed_at = NULL,
         settled_by = NULL
   WHERE id = '1f057efc-39cc-4058-a733-769f9822fb96'::uuid
     AND status = 'confirmed_paid'::public.payment_status
     AND settled_by = payer_id;
  GET DIAGNOSTICS v_count = ROW_COUNT;

  ALTER TABLE public.challenge_payments ENABLE TRIGGER challenge_payments_guard;

  IF v_count <> 1 THEN
    RAISE EXCEPTION 'recovery aborted: expected exactly 1 row, changed %', v_count;
  END IF;
END
$recovery$;
