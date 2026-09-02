-- Challenge-only transactional outbox. No bulk tables, policies or calculations change.
CREATE TABLE public.challenge_push_users (
  user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  -- Web SDK login IDs are capabilities, NOT the publicly visible profile UUID.
  external_id text NOT NULL UNIQUE DEFAULT replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', ''),
  enabled boolean NOT NULL DEFAULT false
);
CREATE TABLE public.push_subscriptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  provider text NOT NULL DEFAULT 'onesignal' CHECK (provider = 'onesignal'),
  subscription_id uuid NOT NULL,
  platform text NOT NULL DEFAULT 'web' CHECK (platform = 'web'),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  is_active boolean NOT NULL DEFAULT true,
  UNIQUE (provider, subscription_id)
);
CREATE INDEX push_subscriptions_user_active_idx ON public.push_subscriptions(user_id) WHERE is_active;
ALTER TABLE public.challenge_push_users ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.push_subscriptions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.challenge_push_users, public.push_subscriptions FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.challenge_push_users, public.push_subscriptions TO authenticated;
GRANT DELETE ON public.push_subscriptions TO authenticated;
GRANT ALL ON public.challenge_push_users, public.push_subscriptions TO service_role;
CREATE POLICY "push identity read own" ON public.challenge_push_users FOR SELECT TO authenticated USING (user_id = auth.uid());
CREATE POLICY "push subscriptions read own" ON public.push_subscriptions FOR SELECT TO authenticated USING (user_id = auth.uid());
CREATE POLICY "push subscriptions delete own" ON public.push_subscriptions FOR DELETE TO authenticated USING (user_id = auth.uid());
-- Registration/enabling is through an authenticated Edge Function which verifies
-- OneSignal ownership first. Direct client INSERT/UPDATE would permit ID forgery.
CREATE FUNCTION public.disable_challenge_push()
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  UPDATE public.challenge_push_users SET enabled = false WHERE user_id = auth.uid();
  UPDATE public.push_subscriptions SET is_active = false, updated_at = now() WHERE user_id = auth.uid();
END;
$$;
REVOKE ALL ON FUNCTION public.disable_challenge_push() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.disable_challenge_push() TO authenticated;

-- Serialize registration with account-wide opt-out. A background sync must
-- never reactivate a device which was explicitly disabled or signed out.
CREATE FUNCTION public.register_challenge_push_device(_user uuid, _subscription uuid, _external_id text, _activate boolean)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE push_user public.challenge_push_users;
BEGIN
  SELECT * INTO push_user FROM public.challenge_push_users WHERE user_id = _user FOR UPDATE;
  IF push_user IS NULL OR push_user.external_id <> _external_id THEN RETURN false; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.challenge_members WHERE user_id = _user) THEN RETURN false; END IF;
  IF NOT _activate AND (NOT push_user.enabled OR EXISTS (
    SELECT 1 FROM public.push_subscriptions WHERE provider = 'onesignal' AND subscription_id = _subscription
      AND (NOT is_active OR user_id <> _user)
  )) THEN RETURN false; END IF;
  INSERT INTO public.push_subscriptions(user_id, subscription_id)
    VALUES (_user, _subscription)
    ON CONFLICT (provider, subscription_id) DO UPDATE SET user_id = _user, is_active = true, updated_at = now(), last_seen_at = now();
  IF _activate THEN UPDATE public.challenge_push_users SET enabled = true WHERE user_id = _user; END IF;
  RETURN true;
END;
$$;
REVOKE ALL ON FUNCTION public.register_challenge_push_device(uuid, uuid, text, boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.register_challenge_push_device(uuid, uuid, text, boolean) TO service_role;

CREATE TABLE public.challenge_notification_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  challenge_id uuid NOT NULL REFERENCES public.challenges(id) ON DELETE CASCADE,
  actor_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  -- Snapshot membership IDs prevent delivery to replacements or leave/rejoin users.
  actor_membership_id uuid NOT NULL,
  opponent_membership_id uuid NOT NULL,
  kind text NOT NULL CHECK (kind IN ('activity_posted', 'target_reached', 'week_penalty', 'payment_paid')),
  dedupe_key text NOT NULL UNIQUE,
  facts jsonb NOT NULL,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'processing', 'sent', 'skipped', 'failed')),
  attempts integer NOT NULL DEFAULT 0,
  next_attempt_at timestamptz NOT NULL DEFAULT now(),
  lease_until timestamptz,
  lease_token uuid,
  subscription_ids uuid[],
  provider_message_id uuid,
  last_error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz
);
CREATE INDEX challenge_notification_pending_idx ON public.challenge_notification_events(next_attempt_at)
  WHERE status IN ('pending', 'processing');
ALTER TABLE public.challenge_notification_events ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.challenge_notification_events FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.challenge_notification_events TO service_role;

CREATE FUNCTION private.enqueue_challenge_push(_challenge uuid, _actor uuid, _kind text, _key text, _facts jsonb)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE actor_member uuid; opponent_member uuid;
BEGIN
  IF (SELECT count(*) FROM public.challenge_members WHERE challenge_id = _challenge) <> 2 THEN RETURN; END IF;
  SELECT id INTO actor_member FROM public.challenge_members WHERE challenge_id = _challenge AND user_id = _actor;
  SELECT cm.id INTO opponent_member FROM public.challenge_members cm
    JOIN auth.users u ON u.id = cm.user_id WHERE cm.challenge_id = _challenge AND cm.user_id <> _actor;
  IF actor_member IS NULL OR opponent_member IS NULL THEN RETURN; END IF;
  INSERT INTO public.challenge_notification_events(challenge_id, actor_id, actor_membership_id, opponent_membership_id, kind, dedupe_key, facts)
  VALUES (_challenge, _actor, actor_member, opponent_member, _kind, _key, _facts)
  ON CONFLICT (dedupe_key) DO NOTHING;
END;
$$;

-- Serialize activity writers before their mutation, so concurrent crossings use
-- the committed total. Generated equivalent_km remains the source of truth.
CREATE FUNCTION private.lock_challenge_push_activity()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  PERFORM 1 FROM public.challenges WHERE id = CASE WHEN TG_OP = 'DELETE' THEN OLD.challenge_id ELSE NEW.challenge_id END FOR UPDATE;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER challenge_activities_00_push_lock BEFORE INSERT OR UPDATE OR DELETE ON public.challenge_activities
FOR EACH ROW EXECUTE FUNCTION private.lock_challenge_push_activity();

CREATE FUNCTION private.capture_challenge_activity_push()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE batch record; activity record; week_start date; total numeric; previous_total numeric; old_total numeric; target numeric;
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF NOT EXISTS (SELECT 1 FROM new_activities n JOIN old_activities o USING (id)
      WHERE n.distance_km IS DISTINCT FROM o.distance_km OR n.activity_type IS DISTINCT FROM o.activity_type
        OR n.activity_date IS DISTINCT FROM o.activity_date) THEN RETURN NULL; END IF;
  END IF;
  -- Transition tables handle a whole multi-row mutation. Row-level AFTER
  -- triggers see the whole batch and cannot reconstruct its previous total.
  FOR batch IN SELECT n.challenge_id, n.user_id,
      private.challenge_week_of(n.challenge_id, n.activity_date) AS week_no, sum(n.equivalent_km) AS new_total
    FROM new_activities n
    WHERE private.challenge_week_open(n.challenge_id, n.activity_date)
    GROUP BY n.challenge_id, n.user_id, private.challenge_week_of(n.challenge_id, n.activity_date)
  LOOP
    SELECT start_date + (batch.week_no - 1) * 7 INTO week_start FROM public.challenges WHERE id = batch.challenge_id;
    SELECT coalesce(sum(equivalent_km), 0) INTO total FROM public.challenge_activities
      WHERE challenge_id = batch.challenge_id AND user_id = batch.user_id AND activity_date BETWEEN week_start AND week_start + 6;
    target := private.target_for_week(batch.challenge_id, batch.week_no);
    previous_total := total - batch.new_total;
    IF TG_OP = 'UPDATE' THEN
      SELECT coalesce(sum(equivalent_km), 0) INTO old_total FROM old_activities
        WHERE challenge_id = batch.challenge_id AND user_id = batch.user_id AND activity_date BETWEEN week_start AND week_start + 6;
      previous_total := previous_total + old_total;
    ELSE
      FOR activity IN SELECT * FROM new_activities WHERE challenge_id = batch.challenge_id AND user_id = batch.user_id
        AND activity_date BETWEEN week_start AND week_start + 6
      LOOP
        PERFORM private.enqueue_challenge_push(activity.challenge_id, activity.user_id, 'activity_posted', 'activity:' || activity.id,
          jsonb_build_object('activity_type', activity.activity_type, 'distance_km', activity.distance_km,
            'equivalent_km', activity.equivalent_km, 'total_km', total, 'target_km', target));
      END LOOP;
    END IF;
    IF target > 0 AND previous_total < target AND total >= target THEN
      PERFORM private.enqueue_challenge_push(batch.challenge_id, batch.user_id, 'target_reached',
        'target:' || batch.challenge_id || ':' || batch.user_id || ':' || batch.week_no,
        jsonb_build_object('target_km', target));
    END IF;
  END LOOP;
  RETURN NULL;
END;
$$;
CREATE TRIGGER challenge_activity_insert_push AFTER INSERT ON public.challenge_activities
REFERENCING NEW TABLE AS new_activities FOR EACH STATEMENT EXECUTE FUNCTION private.capture_challenge_activity_push();
CREATE TRIGGER challenge_activity_update_push AFTER UPDATE ON public.challenge_activities
REFERENCING NEW TABLE AS new_activities OLD TABLE AS old_activities FOR EACH STATEMENT EXECUTE FUNCTION private.capture_challenge_activity_push();

-- Only a committed penalty obligation counts as finalization; no frontend event.
CREATE FUNCTION private.capture_challenge_payment_push()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.challenge_members WHERE challenge_id = NEW.challenge_id AND user_id = NEW.recipient_id) THEN RETURN NEW; END IF;
  IF TG_OP = 'INSERT' THEN
    IF EXISTS (SELECT 1 FROM public.challenge_weeks w WHERE w.id = NEW.week_id
      AND w.challenge_id = NEW.challenge_id AND w.user_id = NEW.payer_id AND w.penalty_eur = NEW.amount_eur) THEN
      PERFORM private.enqueue_challenge_push(NEW.challenge_id, NEW.payer_id, 'week_penalty', 'penalty:' || NEW.week_id,
        jsonb_build_object('amount_eur', NEW.amount_eur));
    END IF;
  ELSIF OLD.status = 'unpaid' AND NEW.status = 'marked_paid' AND auth.uid() = NEW.payer_id THEN
    PERFORM private.enqueue_challenge_push(NEW.challenge_id, NEW.payer_id, 'payment_paid', 'payment:' || NEW.id,
      jsonb_build_object('amount_eur', NEW.amount_eur));
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER challenge_payment_push AFTER INSERT OR UPDATE OF status ON public.challenge_payments
FOR EACH ROW EXECUTE FUNCTION private.capture_challenge_payment_push();

CREATE FUNCTION public.claim_challenge_push_events()
RETURNS SETOF public.challenge_notification_events LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  UPDATE public.challenge_notification_events SET status = 'failed', last_error = 'expired_or_retry_limit', finished_at = now()
    WHERE status IN ('pending', 'processing') AND (lease_until IS NULL OR lease_until < now())
      AND (created_at < now() - interval '24 hours' OR attempts >= 8);
  RETURN QUERY
  UPDATE public.challenge_notification_events e SET status = 'processing', attempts = e.attempts + 1,
    lease_until = now() + interval '5 minutes', lease_token = gen_random_uuid()
  WHERE e.id IN (
    SELECT q.id FROM public.challenge_notification_events q
    WHERE ((q.status = 'pending' AND q.next_attempt_at <= now()) OR (q.status = 'processing' AND q.lease_until < now()))
      AND q.created_at >= now() - interval '24 hours' AND q.attempts < 8
    ORDER BY q.created_at, q.id FOR UPDATE SKIP LOCKED LIMIT 5
  ) RETURNING e.*;
END;
$$;
REVOKE ALL ON FUNCTION public.claim_challenge_push_events() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_challenge_push_events() TO service_role;
REVOKE ALL ON FUNCTION private.enqueue_challenge_push(uuid, uuid, text, text, jsonb),
  private.lock_challenge_push_activity(), private.capture_challenge_activity_push(), private.capture_challenge_payment_push()
  FROM PUBLIC, anon, authenticated;

-- Seed already-completed current weeks without sending historical notifications.
DO $$
DECLARE row record;
BEGIN
  FOR row IN
    SELECT a.challenge_id, a.user_id, private.challenge_week_of(a.challenge_id, a.activity_date) AS week_no
    FROM public.challenge_activities a
    WHERE private.challenge_week_open(a.challenge_id, a.activity_date)
    GROUP BY a.challenge_id, a.user_id, private.challenge_week_of(a.challenge_id, a.activity_date)
    HAVING sum(a.equivalent_km) >= private.target_for_week(a.challenge_id, private.challenge_week_of(a.challenge_id, a.activity_date))
  LOOP
    PERFORM private.enqueue_challenge_push(row.challenge_id, row.user_id, 'target_reached',
      'target:' || row.challenge_id || ':' || row.user_id || ':' || row.week_no, '{}'::jsonb);
  END LOOP;
  UPDATE public.challenge_notification_events SET status = 'skipped', last_error = 'before_push_rollout', finished_at = now();
END;
$$;
