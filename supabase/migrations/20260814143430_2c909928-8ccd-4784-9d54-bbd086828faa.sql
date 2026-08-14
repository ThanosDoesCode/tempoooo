DROP POLICY IF EXISTS "cp members update" ON public.challenge_payments;

CREATE POLICY "cp payer update" ON public.challenge_payments
FOR UPDATE TO authenticated
USING (payer_id = auth.uid() AND status <> 'confirmed_paid'::public.payment_status)
WITH CHECK (payer_id = auth.uid() AND status IN ('unpaid'::public.payment_status,'marked_paid'::public.payment_status));

CREATE POLICY "cp recipient confirm" ON public.challenge_payments
FOR UPDATE TO authenticated
USING (recipient_id = auth.uid() AND status = 'marked_paid'::public.payment_status)
WITH CHECK (recipient_id = auth.uid() AND status = 'confirmed_paid'::public.payment_status);

REVOKE EXECUTE ON FUNCTION public.bulk_role_of(uuid) FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.can_read_bulk(uuid) FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.can_write_bulk(uuid) FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.is_bulk_owner(uuid) FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.is_challenge_member(uuid) FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.challenge_today(uuid) FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.challenge_week_of(uuid, date) FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.challenge_week_open(uuid, date) FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.accept_bulk_invitation(text) FROM anon;
REVOKE EXECUTE ON FUNCTION public.accept_challenge_invitation(text) FROM anon;
REVOKE EXECUTE ON FUNCTION public.ensure_bulk_profile() FROM anon;
REVOKE EXECUTE ON FUNCTION public.set_bulk_editor(uuid, uuid, boolean) FROM anon;
REVOKE EXECUTE ON FUNCTION public.finalize_challenge(uuid) FROM anon;
REVOKE EXECUTE ON FUNCTION public.related_profiles() FROM anon;