-- Bulk activation is represented by an owned bulk profile. Existing owners keep
-- their plans, while new users may create exactly one personal plan atomically.
-- Operational administrators are snapshotted before self-service activation so
-- personal plan ownership cannot grant access to global diagnostics.
CREATE TABLE public.bulk_admins (
  user_id uuid PRIMARY KEY,
  created_at timestamptz NOT NULL DEFAULT now()
);

INSERT INTO public.bulk_admins(user_id)
SELECT DISTINCT user_id
FROM public.bulk_members
WHERE role = 'owner'
ON CONFLICT (user_id) DO NOTHING;

ALTER TABLE public.bulk_admins ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.bulk_admins FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.bulk_admins TO service_role;

CREATE FUNCTION public.is_bulk_admin()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
  SELECT (SELECT auth.uid()) IS NOT NULL
    AND EXISTS (
      SELECT 1
      FROM public.bulk_admins
      WHERE user_id = (SELECT auth.uid())
    )
$function$;

REVOKE ALL ON FUNCTION public.is_bulk_admin() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.is_bulk_admin() TO authenticated, service_role;

CREATE FUNCTION public.activate_my_bulk()
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  caller uuid := (SELECT auth.uid());
  plan_id uuid;
BEGIN
  IF caller IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  INSERT INTO public.bulk_profiles(owner_id)
  VALUES (caller)
  ON CONFLICT (owner_id) DO UPDATE
    SET owner_id = EXCLUDED.owner_id
  RETURNING id INTO plan_id;

  INSERT INTO public.bulk_members(bulk_profile_id, user_id, role, invited_by)
  VALUES (plan_id, caller, 'owner', caller)
  ON CONFLICT (bulk_profile_id, user_id) DO NOTHING;

  IF NOT EXISTS (
    SELECT 1
    FROM public.bulk_members
    WHERE bulk_profile_id = plan_id
      AND user_id = caller
      AND role = 'owner'
  ) THEN
    RAISE EXCEPTION 'Bulk ownership is inconsistent';
  END IF;

  INSERT INTO public.bulk_targets(bulk_profile_id, payload)
  VALUES (plan_id, '{}'::jsonb)
  ON CONFLICT (bulk_profile_id) DO NOTHING;

  RETURN plan_id;
END;
$function$;

REVOKE ALL ON FUNCTION public.activate_my_bulk() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.activate_my_bulk() TO authenticated;
