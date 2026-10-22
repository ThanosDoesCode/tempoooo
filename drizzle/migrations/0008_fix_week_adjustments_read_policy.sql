-- Fix a cross-challenge privacy leak in the challenge_week_adjustments SELECT policy.
--
-- The original USING clause read `WHERE m.challenge_id = challenge_id`. The unqualified `challenge_id`
-- binds to the nearest scope — the subquery's own challenge_members row — so it evaluated as the
-- tautology `m.challenge_id = m.challenge_id`. That made the EXISTS true for anyone who is a member of
-- ANY challenge, letting a member of one challenge read another challenge's adjustment rows.
--
-- The corrected clause correlates explicitly to the outer row's challenge via the fully-qualified
-- public.challenge_week_adjustments.challenge_id, so a user may read an adjustment only when they are a
-- member of THAT adjustment's challenge. Nothing else changes; RLS stays enabled.
DROP POLICY IF EXISTS "week adjustments read members" ON public.challenge_week_adjustments;
CREATE POLICY "week adjustments read members" ON public.challenge_week_adjustments
FOR SELECT TO authenticated
USING (EXISTS (
  SELECT 1 FROM public.challenge_members m
  WHERE m.challenge_id = public.challenge_week_adjustments.challenge_id
    AND m.user_id = auth.uid()
));