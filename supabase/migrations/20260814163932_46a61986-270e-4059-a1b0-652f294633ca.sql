DROP POLICY IF EXISTS "ci read creator" ON public.challenge_invitations;
DROP POLICY IF EXISTS "ci insert creator" ON public.challenge_invitations;
DROP POLICY IF EXISTS "ci update creator" ON public.challenge_invitations;

CREATE POLICY "ci read member" ON public.challenge_invitations
FOR SELECT TO authenticated
USING (private.is_challenge_member(challenge_id));

CREATE POLICY "ci insert member" ON public.challenge_invitations
FOR INSERT TO authenticated
WITH CHECK (created_by = auth.uid() AND private.is_challenge_member(challenge_id));

CREATE POLICY "ci update member" ON public.challenge_invitations
FOR UPDATE TO authenticated
USING (private.is_challenge_member(challenge_id))
WITH CHECK (private.is_challenge_member(challenge_id));