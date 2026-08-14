DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'profiles','bulk_profiles','bulk_members','bulk_invitations','bulk_targets','bulk_days',
    'bulk_workouts','bulk_week_notes','bulk_photos','challenges','challenge_members',
    'challenge_invitations','challenge_activities','challenge_weeks','challenge_payments',
    'challenge_activity_audit'
  ] LOOP
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON public.%I TO authenticated', t);
    EXECUTE format('GRANT ALL ON public.%I TO service_role', t);
  END LOOP;
END $$;