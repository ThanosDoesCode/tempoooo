-- New events only: never backfill outcomes from historical accepted_at/revoked_at.
CREATE TABLE public.account_notification_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  recipient_user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  actor_user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  actor_username text,
  event_type text NOT NULL CHECK (event_type IN (
    'challenge_invitation_received', 'challenge_invitation_accepted', 'challenge_invitation_declined'
  )),
  challenge_id uuid NOT NULL REFERENCES public.challenges(id) ON DELETE CASCADE,
  invitation_id uuid NOT NULL REFERENCES public.challenge_invitations(id) ON DELETE CASCADE,
  dedupe_key text NOT NULL UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now(),
  read_at timestamptz,
  CHECK (recipient_user_id <> actor_user_id)
);
CREATE INDEX account_notification_recipient_idx
  ON public.account_notification_events(recipient_user_id, created_at DESC, id DESC);
ALTER TABLE public.account_notification_events ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.account_notification_events FROM PUBLIC, anon, authenticated;
GRANT SELECT, UPDATE (read_at) ON public.account_notification_events TO authenticated;
GRANT ALL ON public.account_notification_events TO service_role;
CREATE POLICY notification_recipient_read ON public.account_notification_events
  FOR SELECT TO authenticated USING (recipient_user_id = (SELECT auth.uid()));
CREATE POLICY notification_recipient_read_receipt ON public.account_notification_events
  FOR UPDATE TO authenticated USING (recipient_user_id = (SELECT auth.uid()))
  WITH CHECK (recipient_user_id = (SELECT auth.uid()));

CREATE FUNCTION public.mark_account_notification_read(_notification uuid)
RETURNS boolean LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  UPDATE public.account_notification_events SET read_at = coalesce(read_at, now())
  WHERE id = _notification AND recipient_user_id = auth.uid();
  RETURN FOUND;
END;
$$;
REVOKE ALL ON FUNCTION public.mark_account_notification_read(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.mark_account_notification_read(uuid) TO authenticated;

-- Invitation delivery is separate from the existing two-member activity/payment audience.
ALTER TABLE public.challenge_notification_events
  ADD COLUMN account_notification_id uuid REFERENCES public.account_notification_events(id) ON DELETE CASCADE,
  ADD COLUMN recipient_user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE,
  ALTER COLUMN actor_membership_id DROP NOT NULL,
  ALTER COLUMN opponent_membership_id DROP NOT NULL;
ALTER TABLE public.challenge_notification_events DROP CONSTRAINT challenge_notification_events_kind_check;
ALTER TABLE public.challenge_notification_events ADD CONSTRAINT challenge_notification_events_kind_check
  CHECK (kind IN ('activity_posted','target_reached','week_penalty','payment_paid',
    'challenge_invitation_received','challenge_invitation_accepted','challenge_invitation_declined'));
ALTER TABLE public.challenge_notification_events ADD CONSTRAINT challenge_notification_audience_ck CHECK (
  (kind IN ('activity_posted','target_reached','week_penalty','payment_paid')
    AND actor_membership_id IS NOT NULL AND opponent_membership_id IS NOT NULL
    AND account_notification_id IS NULL AND recipient_user_id IS NULL)
  OR
  (kind IN ('challenge_invitation_received','challenge_invitation_accepted','challenge_invitation_declined')
    AND actor_membership_id IS NULL AND opponent_membership_id IS NULL
    AND account_notification_id IS NOT NULL AND recipient_user_id IS NOT NULL)
);
CREATE UNIQUE INDEX challenge_notification_account_event_uidx
  ON public.challenge_notification_events(account_notification_id) WHERE account_notification_id IS NOT NULL;

CREATE FUNCTION private.enqueue_invitation_notification(_invitation uuid, _actor uuid, _kind text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE invitation public.challenge_invitations%ROWTYPE; recipient uuid; notification uuid; actor_name text;
BEGIN
  SELECT * INTO invitation FROM public.challenge_invitations WHERE id = _invitation;
  IF invitation.id IS NULL OR invitation.invited_user_id IS NULL THEN
    RAISE EXCEPTION 'Invalid invitation event';
  END IF;
  IF _kind = 'challenge_invitation_received' THEN
    IF _actor IS DISTINCT FROM invitation.created_by OR invitation.accepted_at IS NOT NULL
      OR invitation.revoked_at IS NOT NULL OR invitation.expires_at <= now() THEN
      RAISE EXCEPTION 'Invalid invitation event';
    END IF;
    recipient := invitation.invited_user_id;
  ELSIF _kind IN ('challenge_invitation_accepted','challenge_invitation_declined') THEN
    IF _actor IS DISTINCT FROM invitation.invited_user_id OR invitation.expires_at <= now()
      OR (_kind = 'challenge_invitation_accepted' AND invitation.accepted_at IS NULL)
      OR (_kind = 'challenge_invitation_declined' AND (invitation.revoked_at IS NULL OR invitation.accepted_at IS NOT NULL)) THEN
      RAISE EXCEPTION 'Invalid invitation event';
    END IF;
    recipient := invitation.created_by;
  ELSE RAISE EXCEPTION 'Invalid invitation event'; END IF;
  SELECT username INTO actor_name FROM public.profiles WHERE id = _actor;
  INSERT INTO public.account_notification_events
    (recipient_user_id, actor_user_id, actor_username, event_type, challenge_id, invitation_id, dedupe_key)
  VALUES (recipient, _actor, actor_name, _kind, invitation.challenge_id, invitation.id,
    'invitation:' || invitation.id::text || ':' || _kind)
  ON CONFLICT (dedupe_key) DO NOTHING RETURNING id INTO notification;
  IF notification IS NOT NULL THEN
    INSERT INTO public.challenge_notification_events
      (challenge_id, actor_id, kind, dedupe_key, facts, account_notification_id, recipient_user_id)
    VALUES (invitation.challenge_id, _actor, _kind,
      'invitation:' || invitation.id::text || ':' || _kind, '{}'::jsonb, notification, recipient)
    ON CONFLICT (dedupe_key) DO NOTHING;
  END IF;
END;
$$;
REVOKE ALL ON FUNCTION private.enqueue_invitation_notification(uuid,uuid,text) FROM PUBLIC, anon, authenticated, service_role;

CREATE FUNCTION private.notify_new_challenge_invitation()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF NEW.invited_user_id IS NOT NULL AND NEW.accepted_at IS NULL AND NEW.revoked_at IS NULL
    AND NEW.expires_at > now() THEN
    PERFORM private.enqueue_invitation_notification(NEW.id, NEW.created_by, 'challenge_invitation_received');
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION private.notify_new_challenge_invitation() FROM PUBLIC, anon, authenticated, service_role;
CREATE TRIGGER notify_new_challenge_invitation AFTER INSERT ON public.challenge_invitations
  FOR EACH ROW EXECUTE FUNCTION private.notify_new_challenge_invitation();

CREATE OR REPLACE FUNCTION public.accept_challenge_invitation_by_id(_caller uuid, _invitation uuid)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE invitation public.challenge_invitations%ROWTYPE; member_count integer;
BEGIN
  IF _caller IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  SELECT * INTO invitation FROM public.challenge_invitations
  WHERE id = _invitation FOR UPDATE;
  IF invitation.id IS NULL OR invitation.invited_user_id IS DISTINCT FROM _caller THEN
    RAISE EXCEPTION 'Invitation not found';
  END IF;
  IF invitation.accepted_at IS NOT NULL OR invitation.revoked_at IS NOT NULL
    OR invitation.expires_at <= now() THEN
    RAISE EXCEPTION 'This invitation is no longer valid';
  END IF;
  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(invitation.challenge_id::text, 0)
  );
  IF EXISTS (
    SELECT 1 FROM public.challenge_members
    WHERE challenge_id = invitation.challenge_id AND user_id = _caller
  ) THEN RAISE EXCEPTION 'You are already part of this Challenge'; END IF;
  SELECT count(*) INTO member_count FROM public.challenge_members
  WHERE challenge_id = invitation.challenge_id;
  IF member_count >= 2 THEN RAISE EXCEPTION 'This Challenge is already full'; END IF;
  INSERT INTO public.challenge_members(challenge_id, user_id)
  VALUES (invitation.challenge_id, _caller);
  UPDATE public.challenge_invitations SET accepted_at = now() WHERE id = invitation.id;
  UPDATE public.challenge_invitations SET revoked_at = now()
  WHERE challenge_id = invitation.challenge_id AND id <> invitation.id
    AND accepted_at IS NULL AND revoked_at IS NULL;
  PERFORM private.enqueue_invitation_notification(invitation.id, _caller, 'challenge_invitation_accepted');
  UPDATE public.account_notification_events SET read_at = coalesce(read_at, now())
  WHERE invitation_id = invitation.id AND recipient_user_id = _caller
    AND event_type = 'challenge_invitation_received';
  RETURN invitation.challenge_id;
END;
$function$;

-- Keep the existing expired-decline revocation behavior, but do not emit a response event.
CREATE OR REPLACE FUNCTION public.decline_challenge_invitation(_caller uuid, _invitation uuid)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE invitation public.challenge_invitations%ROWTYPE;
BEGIN
  IF _caller IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  SELECT * INTO invitation FROM public.challenge_invitations WHERE id = _invitation FOR UPDATE;
  IF invitation.id IS NULL OR invitation.invited_user_id IS DISTINCT FROM _caller
    OR invitation.accepted_at IS NOT NULL OR invitation.revoked_at IS NOT NULL THEN
    RAISE EXCEPTION 'Invitation not found';
  END IF;
  UPDATE public.challenge_invitations SET revoked_at = now() WHERE id = invitation.id;
  IF invitation.expires_at > now() THEN
    PERFORM private.enqueue_invitation_notification(invitation.id, _caller, 'challenge_invitation_declined');
  END IF;
  UPDATE public.account_notification_events SET read_at = coalesce(read_at, now())
  WHERE invitation_id = invitation.id AND recipient_user_id = _caller
    AND event_type = 'challenge_invitation_received';
  RETURN true;
END;
$$;
REVOKE ALL ON FUNCTION public.accept_challenge_invitation_by_id(uuid,uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.decline_challenge_invitation(uuid,uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.accept_challenge_invitation_by_id(uuid,uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.decline_challenge_invitation(uuid,uuid) TO service_role;
