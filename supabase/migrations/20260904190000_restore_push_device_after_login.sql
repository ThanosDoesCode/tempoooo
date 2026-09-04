-- A normal logout detaches a device without disabling the user's account-wide
-- notification preference. After OneSignal verifies the subscription under the
-- freshly authenticated external identity, background reconciliation may safely
-- reactivate or transfer that subscription. Explicit account opt-out remains
-- authoritative because challenge_push_users.enabled stays false.
CREATE OR REPLACE FUNCTION public.register_challenge_push_device(
  _user uuid,
  _subscription uuid,
  _external_id text,
  _activate boolean
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  push_user public.challenge_push_users;
BEGIN
  IF _user IS NULL
     OR _subscription IS NULL
     OR _external_id IS NULL
     OR btrim(_external_id) = ''
     OR _activate IS NULL THEN
    RETURN false;
  END IF;

  SELECT * INTO push_user
  FROM public.challenge_push_users
  WHERE user_id = _user
  FOR UPDATE;

  IF push_user IS NULL OR push_user.external_id IS DISTINCT FROM _external_id THEN
    RETURN false;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.challenge_members WHERE user_id = _user
  ) THEN
    RETURN false;
  END IF;
  IF NOT _activate AND NOT push_user.enabled THEN
    RETURN false;
  END IF;

  INSERT INTO public.push_subscriptions(user_id, subscription_id)
  VALUES (_user, _subscription)
  ON CONFLICT (provider, subscription_id) DO UPDATE
  SET user_id = _user,
      is_active = true,
      updated_at = now(),
      last_seen_at = now();

  IF _activate THEN
    UPDATE public.challenge_push_users
    SET enabled = true
    WHERE user_id = _user;
  END IF;

  RETURN true;
END;
$$;

REVOKE ALL ON FUNCTION public.register_challenge_push_device(uuid, uuid, text, boolean)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.register_challenge_push_device(uuid, uuid, text, boolean)
  TO service_role;
