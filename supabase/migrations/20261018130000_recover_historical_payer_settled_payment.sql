-- Source-control parity ONLY. This one-row recovery has ALREADY been applied to the managed
-- production database via Lovable (drizzle/migrations/0005_recover_historical_payer_settled_payment.sql).
-- It is committed here so the repo history matches production; it is not meant to re-run against
-- production and must behave as a safe no-op on any database where the target row is absent.
--
-- Context: before 20261018120000, guard_payment() let a payer self-settle (status='confirmed_paid'
-- with settled_by = payer_id). Exactly one historical row was settled that way. Recovery returns it to
-- 'marked_paid' (AWAITING) so the recipient must explicitly confirm; the payer's "I paid" signal
-- (marked_paid_at) is preserved, the bogus confirmation is cleared, and nothing else is touched.

DO $$
DECLARE
  target uuid := '1f057efc-39cc-4058-a733-769f9822fb96';
  rec public.challenge_payments;
  changed integer;
BEGIN
  SELECT * INTO rec FROM public.challenge_payments WHERE id = target;

  -- Absent row (a fresh / non-production database): nothing to recover.
  IF NOT FOUND THEN
    RETURN;
  END IF;

  -- Only a genuine payer self-settlement is eligible; abort on anything else.
  IF rec.status <> 'confirmed_paid' OR rec.settled_by IS DISTINCT FROM rec.payer_id THEN
    RAISE EXCEPTION 'Recovery aborted for %: expected a payer-self-settled confirmed_paid row (status=%, settled_by=%, payer_id=%)',
      target, rec.status, rec.settled_by, rec.payer_id;
  END IF;

  -- Bypass only the settlement state-machine guard for this single, authorized recovery.
  ALTER TABLE public.challenge_payments DISABLE TRIGGER challenge_payments_guard;

  UPDATE public.challenge_payments
  SET status = 'marked_paid',
      confirmed_at = NULL,
      settled_by = NULL
      -- marked_paid_at and every other field are preserved.
  WHERE id = target;
  GET DIAGNOSTICS changed = ROW_COUNT;

  -- Restore the guard before completing, regardless of the row-count assertion below.
  ALTER TABLE public.challenge_payments ENABLE TRIGGER challenge_payments_guard;

  IF changed <> 1 THEN
    RAISE EXCEPTION 'Recovery expected exactly one changed row, changed %', changed;
  END IF;
END $$;
