-- Quick Add is a presentation preference; logged nutrition snapshots stay untouched.
ALTER TABLE public.bulk_meal_presets
  ADD COLUMN show_in_quick_add boolean NOT NULL DEFAULT true;

-- SECURITY INVOKER requires a write privilege. Grant only the new preference,
-- never table-wide UPDATE or access to existing preset/ownership fields.
GRANT UPDATE (show_in_quick_add) ON public.bulk_meal_presets TO authenticated;

CREATE POLICY "bulk meal presets update own visibility"
ON public.bulk_meal_presets FOR UPDATE TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM public.bulk_profiles profile
    JOIN public.bulk_members member ON member.bulk_profile_id = profile.id
    WHERE profile.id = bulk_meal_presets.bulk_profile_id
      AND profile.owner_id = (SELECT auth.uid())
      AND member.user_id = (SELECT auth.uid())
      AND member.role = 'owner'
  )
)
WITH CHECK (
  EXISTS (
    SELECT 1 FROM public.bulk_profiles profile
    JOIN public.bulk_members member ON member.bulk_profile_id = profile.id
    WHERE profile.id = bulk_meal_presets.bulk_profile_id
      AND profile.owner_id = (SELECT auth.uid())
      AND member.user_id = (SELECT auth.uid())
      AND member.role = 'owner'
  )
);

CREATE FUNCTION public.set_bulk_meal_preset_quick_add_visibility(_meal uuid, _visible boolean)
RETURNS boolean
LANGUAGE plpgsql SECURITY INVOKER
SET search_path = ''
AS $function$
DECLARE
  caller uuid := auth.uid();
BEGIN
  IF caller IS NULL THEN
    RAISE EXCEPTION 'Authentication required' USING ERRCODE = '42501';
  END IF;
  IF _meal IS NULL OR _visible IS NULL THEN
    RAISE EXCEPTION 'Meal and visibility are required' USING ERRCODE = '22023';
  END IF;

  UPDATE public.bulk_meal_presets meal
  SET show_in_quick_add = _visible
  WHERE meal.id = _meal
    AND EXISTS (
      SELECT 1 FROM public.bulk_profiles profile
      JOIN public.bulk_members member ON member.bulk_profile_id = profile.id
      WHERE profile.id = meal.bulk_profile_id
        AND profile.owner_id = caller
        AND member.user_id = caller
        AND member.role = 'owner'
    );
  RETURN FOUND;
END;
$function$;

REVOKE ALL ON FUNCTION public.set_bulk_meal_preset_quick_add_visibility(uuid,boolean)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.set_bulk_meal_preset_quick_add_visibility(uuid,boolean)
  TO authenticated;

COMMENT ON COLUMN public.bulk_meal_presets.show_in_quick_add IS
  'Owner-controlled Quick Add visibility; does not affect saved meal history or management.';
