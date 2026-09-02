-- Keep client authorization on challenge_activities. Move only the audit write
-- into a locked trigger function which can cross the audit table's RLS boundary.
-- Authenticated clients retain SELECT through the existing membership policy,
-- but cannot create, alter, or delete audit history themselves.
REVOKE INSERT, UPDATE, DELETE ON public.challenge_activity_audit FROM authenticated;

CREATE OR REPLACE FUNCTION public.guard_activity()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
  actor uuid := auth.uid();
  challenge_id uuid := CASE WHEN TG_OP = 'INSERT' THEN NEW.challenge_id ELSE OLD.challenge_id END;
  activity_user uuid := CASE WHEN TG_OP = 'INSERT' THEN NEW.user_id ELSE OLD.user_id END;
BEGIN
  IF actor IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  IF activity_user <> actor THEN
    IF TG_OP = 'INSERT' THEN RAISE EXCEPTION 'You can only log your own activities'; END IF;
    IF TG_OP = 'UPDATE' THEN RAISE EXCEPTION 'You can only edit your own activities'; END IF;
    RAISE EXCEPTION 'You can only delete your own activities';
  END IF;
  IF NOT private.is_challenge_member(challenge_id) THEN
    RAISE EXCEPTION 'Not a member of this challenge';
  END IF;

  IF TG_OP = 'INSERT' THEN
    IF NOT private.challenge_week_open(NEW.challenge_id, NEW.activity_date) THEN
      RAISE EXCEPTION 'That week is closed or the date is invalid';
    END IF;
    IF EXISTS (
      SELECT 1 FROM public.challenge_weeks w
      WHERE w.challenge_id = NEW.challenge_id
        AND w.user_id = NEW.user_id
        AND w.week_number = private.challenge_week_of(NEW.challenge_id, NEW.activity_date)
    ) THEN RAISE EXCEPTION 'Finalized activity cannot be changed'; END IF;
    RETURN NEW;
  END IF;

  IF TG_OP = 'UPDATE' THEN
    IF NEW.user_id IS DISTINCT FROM OLD.user_id
       OR NEW.challenge_id IS DISTINCT FROM OLD.challenge_id THEN
      RAISE EXCEPTION 'Immutable activity identity';
    END IF;
    IF NOT private.challenge_week_open(OLD.challenge_id, OLD.activity_date)
       OR NOT private.challenge_week_open(NEW.challenge_id, NEW.activity_date) THEN
      RAISE EXCEPTION 'That week is closed';
    END IF;
    IF EXISTS (
      SELECT 1 FROM public.challenge_weeks w
      WHERE w.challenge_id = OLD.challenge_id
        AND w.user_id = OLD.user_id
        AND w.week_number = private.challenge_week_of(OLD.challenge_id, OLD.activity_date)
    ) THEN RAISE EXCEPTION 'Finalized activity cannot be changed'; END IF;
    IF NEW.activity_type IS DISTINCT FROM OLD.activity_type
       OR NEW.distance_km IS DISTINCT FROM OLD.distance_km
       OR NEW.activity_date IS DISTINCT FROM OLD.activity_date THEN
      NEW.edited := true;
    END IF;
    RETURN NEW;
  END IF;

  IF NOT private.challenge_week_open(OLD.challenge_id, OLD.activity_date) THEN
    RAISE EXCEPTION 'That week is closed';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.challenge_weeks w
    WHERE w.challenge_id = OLD.challenge_id
      AND w.user_id = OLD.user_id
      AND w.week_number = private.challenge_week_of(OLD.challenge_id, OLD.activity_date)
  ) THEN RAISE EXCEPTION 'Finalized activity cannot be changed'; END IF;
  RETURN OLD;
END;
$$;

CREATE OR REPLACE FUNCTION private.capture_challenge_activity_audit()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF NEW.activity_type IS DISTINCT FROM OLD.activity_type
       OR NEW.distance_km IS DISTINCT FROM OLD.distance_km
       OR NEW.activity_date IS DISTINCT FROM OLD.activity_date THEN
      INSERT INTO public.challenge_activity_audit(
        activity_id, challenge_id, changed_by, action,
        old_activity_type, old_distance_km, old_activity_date
      ) VALUES (
        OLD.id, OLD.challenge_id, auth.uid(), 'update',
        OLD.activity_type, OLD.distance_km, OLD.activity_date
      );
    END IF;
    RETURN NULL;
  END IF;

  INSERT INTO public.challenge_activity_audit(
    activity_id, challenge_id, changed_by, action,
    old_activity_type, old_distance_km, old_activity_date
  ) VALUES (
    OLD.id, OLD.challenge_id, auth.uid(), 'delete',
    OLD.activity_type, OLD.distance_km, OLD.activity_date
  );
  RETURN NULL;
END;
$$;

REVOKE ALL ON FUNCTION private.capture_challenge_activity_audit() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS challenge_activities_audit ON public.challenge_activities;
CREATE TRIGGER challenge_activities_audit
AFTER UPDATE OR DELETE ON public.challenge_activities
FOR EACH ROW EXECUTE FUNCTION private.capture_challenge_activity_audit();