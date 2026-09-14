-- goal_status is the public Goal lifecycle marker. The pre-public owner
-- snapshot is the authoritative legacy cohort; empty profiles created outside
-- that cohort must enter public onboarding instead of receiving legacy UI.
UPDATE public.bulk_profiles AS profile
SET goal_status = 'inactive'
WHERE profile.goal_status IS NULL
  AND NOT EXISTS (
    SELECT 1
    FROM public.bulk_admins AS legacy_owner
    WHERE legacy_owner.user_id = profile.owner_id
  );

COMMENT ON COLUMN public.bulk_profiles.goal_status IS
  'Public Goal lifecycle. NULL is reserved for owners captured in the pre-public legacy cohort.';