-- In-app Community events only. No historical backfill and no push-queue writes.
ALTER TABLE public.account_notification_events
  ALTER COLUMN challenge_id DROP NOT NULL,
  ALTER COLUMN invitation_id DROP NOT NULL,
  ADD COLUMN community_relationship_id uuid REFERENCES public.community_relationships(id) ON DELETE CASCADE,
  -- Snapshot of a request lifecycle: NOT a FK to the mutable current request_id.
  ADD COLUMN community_request_id uuid;

ALTER TABLE public.account_notification_events
  DROP CONSTRAINT account_notification_events_event_type_check;
ALTER TABLE public.account_notification_events
  ADD CONSTRAINT account_notification_events_event_type_check CHECK (event_type IN (
    'challenge_invitation_received', 'challenge_invitation_accepted', 'challenge_invitation_declined',
    'friend_request_received', 'friend_request_accepted'
  )),
  ADD CONSTRAINT account_notification_context_ck CHECK (
    (event_type IN ('challenge_invitation_received', 'challenge_invitation_accepted', 'challenge_invitation_declined')
      AND challenge_id IS NOT NULL AND invitation_id IS NOT NULL
      AND community_relationship_id IS NULL AND community_request_id IS NULL)
    OR
    (event_type IN ('friend_request_received', 'friend_request_accepted')
      AND challenge_id IS NULL AND invitation_id IS NULL
      AND community_relationship_id IS NOT NULL AND community_request_id IS NOT NULL)
  );
CREATE UNIQUE INDEX account_notification_community_event_uidx
  ON public.account_notification_events(community_relationship_id, community_request_id, event_type)
  WHERE event_type IN ('friend_request_received', 'friend_request_accepted');

-- Community writes already run under the canonical pair's transaction-scoped lock.
-- The AFTER trigger shares the successful RPC transaction: later failures roll back
-- the relationship, notification, read receipt, and send receipt together.
CREATE FUNCTION private.notify_community_relationship_change()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE caller uuid := auth.uid(); kind text; recipient uuid; actor_name text;
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF OLD.status = 'pending' AND (
      NEW.status <> 'pending' OR NEW.request_id IS DISTINCT FROM OLD.request_id
    ) THEN
      UPDATE public.account_notification_events SET read_at = coalesce(read_at, now())
      WHERE event_type = 'friend_request_received'
        AND community_relationship_id = OLD.id AND community_request_id = OLD.request_id
        AND recipient_user_id = OLD.recipient_id AND actor_user_id = OLD.requester_id;
    END IF;
  END IF;

  -- Privileged maintenance without an authenticated actor must not manufacture events.
  IF caller IS NULL THEN RETURN NEW; END IF;
  IF NEW.status = 'pending' THEN
    IF TG_OP = 'UPDATE' THEN
      IF NEW.request_id = OLD.request_id THEN RETURN NEW; END IF;
    END IF;
    IF caller IS DISTINCT FROM NEW.requester_id THEN RAISE EXCEPTION 'Invalid friend request actor'; END IF;
    IF private.community_is_blocked(NEW.requester_id, NEW.recipient_id) THEN
      RAISE EXCEPTION 'Person unavailable';
    END IF;
    kind := 'friend_request_received';
    recipient := NEW.recipient_id;
  ELSIF TG_OP = 'UPDATE' THEN
    IF OLD.status <> 'pending' OR NEW.status <> 'accepted'
      OR NEW.request_id IS DISTINCT FROM OLD.request_id THEN RETURN NEW; END IF;
    IF caller IS DISTINCT FROM NEW.recipient_id THEN RAISE EXCEPTION 'Invalid friend request actor'; END IF;
    kind := 'friend_request_accepted';
    recipient := NEW.requester_id;
  ELSE RETURN NEW;
  END IF;

  SELECT username INTO actor_name FROM public.profiles WHERE id = caller;
  INSERT INTO public.account_notification_events(
    recipient_user_id, actor_user_id, actor_username, event_type,
    community_relationship_id, community_request_id, dedupe_key
  ) VALUES (
    recipient, caller, actor_name, kind, NEW.id, NEW.request_id,
    'community:' || NEW.id::text || ':' || NEW.request_id::text || ':' || kind
  ) ON CONFLICT DO NOTHING;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION private.notify_community_relationship_change()
  FROM PUBLIC, anon, authenticated, service_role;
CREATE TRIGGER notify_community_relationship_change
  AFTER INSERT OR UPDATE ON public.community_relationships
  FOR EACH ROW EXECUTE FUNCTION private.notify_community_relationship_change();

-- Existing recipient-only RLS, SELECT/read_at column grants, owner-scoped SECURITY
-- INVOKER mark-read RPC, service-role access and all Challenge notification functions
-- and queue constraints are deliberately unchanged.
