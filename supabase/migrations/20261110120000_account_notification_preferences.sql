-- Missing rows preserve existing Challenge push behavior; this does not opt anyone in.
CREATE TABLE public.account_notification_preferences (
  user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  week_penalties boolean NOT NULL DEFAULT true,
  payments boolean NOT NULL DEFAULT true,
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.account_notification_preferences ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.account_notification_preferences FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.account_notification_preferences TO authenticated, service_role;
CREATE POLICY notification_preferences_read_own ON public.account_notification_preferences
  FOR SELECT TO authenticated USING (user_id = (SELECT auth.uid()));

-- The expected user guards stale UI after an account switch; only auth.uid() owns the write.
CREATE FUNCTION public.set_account_notification_preference(
  _expected_user uuid, _category text, _enabled boolean
)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE caller uuid := (SELECT auth.uid());
BEGIN
  IF caller IS NULL OR caller IS DISTINCT FROM _expected_user THEN
    RAISE EXCEPTION 'Account changed' USING ERRCODE = '42501';
  END IF;
  IF _category IS NULL OR _category NOT IN ('week_penalties', 'payments') OR _enabled IS NULL THEN
    RAISE EXCEPTION 'Invalid notification preference' USING ERRCODE = '22023';
  END IF;

  INSERT INTO public.account_notification_preferences AS preferences (user_id, week_penalties, payments)
  VALUES (caller, CASE WHEN _category = 'week_penalties' THEN _enabled ELSE true END,
    CASE WHEN _category = 'payments' THEN _enabled ELSE true END)
  ON CONFLICT (user_id) DO UPDATE SET
    week_penalties = CASE WHEN _category = 'week_penalties' THEN _enabled ELSE preferences.week_penalties END,
    payments = CASE WHEN _category = 'payments' THEN _enabled ELSE preferences.payments END,
    updated_at = now();
END;
$$;
REVOKE ALL ON FUNCTION public.set_account_notification_preference(uuid, text, boolean)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.set_account_notification_preference(uuid, text, boolean)
  TO authenticated;

-- Separate account consent from browser permission and device registration.
CREATE FUNCTION public.set_challenge_push_account_enabled(
  _expected_user uuid, _enabled boolean, _expected_generation uuid DEFAULT NULL
)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE caller uuid := (SELECT auth.uid()); current_generation uuid;
BEGIN
  IF caller IS NULL OR caller IS DISTINCT FROM _expected_user THEN
    RAISE EXCEPTION 'Account changed' USING ERRCODE = '42501';
  END IF;
  IF _enabled IS NULL THEN
    RAISE EXCEPTION 'Invalid notification setting' USING ERRCODE = '22023';
  END IF;
  IF NOT _enabled THEN
    PERFORM private.disable_challenge_push(caller);
    RETURN;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.challenge_members WHERE user_id = caller) THEN
    RAISE EXCEPTION 'Challenge membership required' USING ERRCODE = '42501';
  END IF;
  SELECT registration_generation INTO current_generation FROM public.challenge_push_users
    WHERE user_id = caller FOR UPDATE;
  IF _expected_generation IS NULL OR current_generation IS DISTINCT FROM _expected_generation THEN
    RAISE EXCEPTION 'Notification activation cancelled; start a new Enable action' USING ERRCODE = '22023';
  END IF;
  UPDATE public.challenge_push_users SET enabled = true WHERE user_id = caller;
END;
$$;
REVOKE ALL ON FUNCTION public.set_challenge_push_account_enabled(uuid, boolean, uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.set_challenge_push_account_enabled(uuid, boolean, uuid)
  TO authenticated;

-- Each existing/new account gets its own server-controlled initial version.
-- Initializing this column does not change opt-ins or subscription rows.
ALTER TABLE public.challenge_push_users ADD COLUMN registration_generation uuid NOT NULL
  DEFAULT gen_random_uuid();

-- With the account table already locked by ALTER, drain previously admitted
-- subscription writes in the same lock order as registration before cutover.
LOCK TABLE public.push_subscriptions IN ACCESS EXCLUSIVE MODE;

-- Cutover barrier: already-running old Edge handlers must not retain an
-- unfenced write primitive. Keep the signature/result for a safe legacy failure.
CREATE OR REPLACE FUNCTION public.register_challenge_push_device(
  _user uuid, _subscription uuid, _external_id text, _activate boolean
)
RETURNS boolean LANGUAGE sql SECURITY DEFINER SET search_path = '' AS $$
  SELECT _activate IS FALSE AND EXISTS (
    SELECT 1 FROM public.challenge_push_users account
    JOIN public.push_subscriptions device ON device.user_id = account.user_id
    WHERE account.user_id = _user AND account.external_id = _external_id AND account.enabled
      AND device.provider = 'onesignal' AND device.subscription_id = _subscription AND device.is_active
      AND EXISTS (SELECT 1 FROM public.challenge_members WHERE user_id = _user)
  );
$$;
REVOKE ALL ON FUNCTION public.register_challenge_push_device(uuid, uuid, text, boolean)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.register_challenge_push_device(uuid, uuid, text, boolean) TO service_role;

-- A legacy direct-table detach cannot invalidate a first, not-yet-inserted
-- registration. Fail that obsolete transport closed; the new detach RPC remains
-- available. Workers only SELECT this table and keep their existing access.
REVOKE UPDATE ON public.push_subscriptions FROM service_role;

-- Both the legacy and V2 account opt-out RPCs call this helper.
CREATE OR REPLACE FUNCTION private.disable_challenge_push(_caller uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF _caller IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  UPDATE public.challenge_push_users SET enabled = false, registration_generation = gen_random_uuid()
    WHERE user_id = _caller;
  UPDATE public.push_subscriptions SET is_active = false, updated_at = now() WHERE user_id = _caller;
END;
$$;

CREATE FUNCTION public.detach_challenge_push_device(_user uuid, _subscription uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  -- Invalidate even when the device has not been inserted yet. Other existing
  -- devices stay active; their in-flight requests can reconnect with a fresh fence.
  UPDATE public.challenge_push_users SET registration_generation = gen_random_uuid()
    WHERE user_id = _user;
  UPDATE public.push_subscriptions SET is_active = false, updated_at = now()
    WHERE user_id = _user AND provider = 'onesignal' AND subscription_id = _subscription AND is_active;
END;
$$;
REVOKE ALL ON FUNCTION public.detach_challenge_push_device(uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.detach_challenge_push_device(uuid, uuid) TO service_role;

-- The Edge Function takes the generation and owner snapshots before checking
-- OneSignal. Account invalidation and registration serialize on the same row.
CREATE FUNCTION public.register_challenge_push_device_fenced(
  _user uuid, _subscription uuid, _external_id text, _generation uuid, _observed_owner uuid, _mode text
)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE push_user public.challenge_push_users; current_owner uuid;
BEGIN
  IF _user IS NULL OR _subscription IS NULL OR _external_id IS NULL OR btrim(_external_id) = ''
    OR _generation IS NULL OR _mode IS NULL OR _mode NOT IN ('device', 'background', 'activate') THEN
    RETURN 'rejected';
  END IF;
  SELECT * INTO push_user FROM public.challenge_push_users WHERE user_id = _user FOR UPDATE;
  IF push_user IS NULL OR push_user.external_id IS DISTINCT FROM _external_id
    OR NOT EXISTS (SELECT 1 FROM public.challenge_members WHERE user_id = _user) THEN
    RETURN 'rejected';
  END IF;
  IF push_user.registration_generation IS DISTINCT FROM _generation THEN RETURN 'stale'; END IF;
  IF _mode = 'background' AND NOT push_user.enabled THEN RETURN 'rejected'; END IF;

  -- Do not let a delayed request overwrite a different account's newer ownership.
  SELECT user_id INTO current_owner FROM public.push_subscriptions
    WHERE provider = 'onesignal' AND subscription_id = _subscription FOR UPDATE;
  IF current_owner IS DISTINCT FROM _observed_owner THEN RETURN 'stale'; END IF;
  INSERT INTO public.push_subscriptions AS devices (user_id, subscription_id) VALUES (_user, _subscription)
    ON CONFLICT (provider, subscription_id) DO UPDATE
    SET user_id = _user, is_active = true, updated_at = now(), last_seen_at = now()
    WHERE devices.user_id IS NOT DISTINCT FROM _observed_owner;
  -- A different account may have inserted an initially absent row concurrently.
  IF NOT FOUND THEN RETURN 'stale'; END IF;
  IF _mode = 'activate' THEN
    UPDATE public.challenge_push_users SET enabled = true WHERE user_id = _user;
  END IF;
  RETURN 'registered';
END;
$$;
REVOKE ALL ON FUNCTION public.register_challenge_push_device_fenced(uuid, uuid, text, uuid, uuid, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.register_challenge_push_device_fenced(uuid, uuid, text, uuid, uuid, text)
  TO service_role;
