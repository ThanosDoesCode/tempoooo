-- Bulk is a private owner-only tool. Existing shared rows are intentionally retained.
CREATE OR REPLACE FUNCTION private.can_read_bulk(_bulk uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
  SELECT EXISTS (
    SELECT 1
    FROM public.bulk_members
    WHERE bulk_profile_id = _bulk
      AND user_id = (SELECT auth.uid())
      AND role = 'owner'
  )
$function$;

CREATE OR REPLACE FUNCTION private.can_write_bulk(_bulk uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
  SELECT private.can_read_bulk(_bulk)
$function$;

REVOKE ALL ON FUNCTION private.can_read_bulk(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION private.can_write_bulk(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION private.can_read_bulk(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION private.can_write_bulk(uuid) TO authenticated, service_role;

-- Remove public self-service creation and all user-facing sharing mutations.
DROP POLICY IF EXISTS "bulk_profiles insert self" ON public.bulk_profiles;
DROP POLICY IF EXISTS "bulk_members owner insert" ON public.bulk_members;
DROP POLICY IF EXISTS "bulk_members owner update" ON public.bulk_members;
DROP POLICY IF EXISTS "bulk_members owner delete" ON public.bulk_members;
DROP POLICY IF EXISTS "bulk_inv owner insert" ON public.bulk_invitations;
DROP POLICY IF EXISTS "bulk_inv owner update" ON public.bulk_invitations;

-- The privileged bootstrap/sharing functions remain available only to service_role.
REVOKE ALL ON FUNCTION public.ensure_bulk_profile(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.set_bulk_editor(uuid, uuid, uuid, boolean)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.accept_bulk_invitation(uuid, text, text)
  FROM PUBLIC, anon, authenticated;

-- Related profile lookup now serves Challenge only; retired Bulk shares confer no visibility.
CREATE OR REPLACE FUNCTION public.related_profiles(_caller uuid)
RETURNS TABLE(id uuid, display_name text, email text)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
  SELECT p.id, p.display_name, p.email
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
