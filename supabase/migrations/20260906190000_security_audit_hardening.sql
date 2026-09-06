-- Security Audit 1: narrow legacy grants, hide peer email, constrain external
-- links, and explicitly keep user-upload buckets private.

ALTER FUNCTION private.bulk_role_of(uuid) SET search_path = '';
ALTER FUNCTION private.is_bulk_owner(uuid) SET search_path = '';
ALTER FUNCTION private.is_challenge_member(uuid) SET search_path = '';
ALTER FUNCTION private.challenge_today(uuid) SET search_path = '';
ALTER FUNCTION private.challenge_week_of(uuid, date) SET search_path = '';
ALTER FUNCTION private.challenge_week_open(uuid, date) SET search_path = '';
ALTER FUNCTION private.payment_update_ok(uuid, uuid, uuid, uuid, uuid, numeric, public.payment_status)
  SET search_path = '';

ALTER FUNCTION public.accept_bulk_invitation(uuid, text, text) SET search_path = '';
ALTER FUNCTION public.accept_challenge_invitation(uuid, text, text) SET search_path = '';
ALTER FUNCTION public.ensure_bulk_profile(uuid) SET search_path = '';
ALTER FUNCTION public.set_bulk_editor(uuid, uuid, uuid, boolean) SET search_path = '';

-- These compatibility wrappers are unused by the application. Internal policies
-- call the private helpers directly, so clients do not need a PostgREST endpoint.
REVOKE ALL ON FUNCTION public.challenge_today(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.challenge_week_of(uuid, date) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.challenge_week_open(uuid, date) FROM PUBLIC, anon, authenticated;

-- Trigger functions execute through their triggers and should not be callable as
-- ordinary public/authenticated functions.
REVOKE ALL ON FUNCTION public.block_change() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.enforce_challenge_capacity() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.guard_payment() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.guard_week_target() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.protect_bulk_owner() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.touch_updated_at() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION private.guard_bulk_training_session_set_delete()
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION private.guard_bulk_training_session_snapshot()
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION private.validate_bulk_training_session_set()
  FROM PUBLIC, anon, authenticated;

DROP POLICY IF EXISTS "ci update member" ON public.challenge_invitations;
CREATE POLICY "ci update own" ON public.challenge_invitations
FOR UPDATE TO authenticated
USING (
  created_by = (SELECT auth.uid())
  AND private.is_challenge_member(challenge_id)
)
WITH CHECK (
  created_by = (SELECT auth.uid())
  AND private.is_challenge_member(challenge_id)
);

-- Participant names are required by Challenge UI; peer email addresses are not.
CREATE OR REPLACE FUNCTION public.related_profiles(_caller uuid)
RETURNS TABLE(id uuid, display_name text, email text)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
  SELECT p.id, p.display_name, NULL::text
  FROM public.profiles p
  WHERE _caller IS NOT NULL
    AND (
      p.id = _caller
      OR p.id IN (
        SELECT cm.user_id
        FROM public.challenge_members cm
        WHERE cm.challenge_id IN (
          SELECT mine.challenge_id
          FROM public.challenge_members mine
          WHERE mine.user_id = _caller
        )
      )
    )
$function$;

REVOKE ALL ON FUNCTION public.related_profiles(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.related_profiles(uuid) TO service_role;

-- Existing malformed historical values remain stored, but new/changed values must
-- be bounded HTTPS URLs. The UI separately refuses to render unsafe legacy values.
ALTER TABLE public.challenge_activities
  ADD CONSTRAINT challenge_activities_external_url_security_ck
  CHECK (
    external_activity_url IS NULL
    OR (
      char_length(external_activity_url) <= 2048
      AND (
        external_activity_url ~* '^https://([a-z0-9-]+\.)*strava\.com([/:?#]|$)'
        OR external_activity_url ~* '^https://strava\.app\.link([/:?#]|$)'
      )
    )
  ) NOT VALID;

-- Supabase Storage object RLS is necessary but a public bucket would bypass it.
-- Keep existing bucket configuration and only force the public flag off.
DO $block$
BEGIN
  IF to_regclass('storage.buckets') IS NOT NULL THEN
    UPDATE storage.buckets
    SET public = false
    WHERE id IN ('challenge-evidence', 'bulk-progress-photos', 'payment-evidence');
  END IF;
END
$block$;
