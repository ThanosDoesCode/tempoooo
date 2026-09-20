-- Secure account lifecycle and username-based, in-app Challenge invitations.
-- Existing token invitations remain valid for backwards compatibility.

ALTER TABLE public.profiles
  ADD CONSTRAINT profiles_auth_user_fkey
  FOREIGN KEY (id) REFERENCES auth.users(id) ON DELETE CASCADE NOT VALID;

ALTER TABLE public.bulk_profiles
  ADD CONSTRAINT bulk_profiles_owner_profile_fkey
  FOREIGN KEY (owner_id) REFERENCES public.profiles(id) ON DELETE CASCADE NOT VALID;

ALTER TABLE public.bulk_members
  ADD CONSTRAINT bulk_members_user_profile_fkey
  FOREIGN KEY (user_id) REFERENCES public.profiles(id) ON DELETE CASCADE NOT VALID;

ALTER TABLE public.challenge_members
  ADD CONSTRAINT challenge_members_user_profile_fkey
  FOREIGN KEY (user_id) REFERENCES public.profiles(id) ON DELETE CASCADE NOT VALID;

ALTER TABLE public.bulk_admins
  ADD CONSTRAINT bulk_admins_user_profile_fkey
  FOREIGN KEY (user_id) REFERENCES public.profiles(id) ON DELETE CASCADE NOT VALID;

ALTER TABLE public.challenge_invitations
  DROP CONSTRAINT challenge_invitations_invited_user_id_fkey,
  ADD CONSTRAINT challenge_invitations_invited_user_id_fkey
    FOREIGN KEY (invited_user_id) REFERENCES public.profiles(id) ON DELETE CASCADE NOT VALID;

ALTER TABLE public.challenge_invitations
  ADD CONSTRAINT challenge_invitations_creator_profile_fkey
  FOREIGN KEY (created_by) REFERENCES public.profiles(id) ON DELETE CASCADE NOT VALID;

-- Owner memberships may only disappear as part of deleting their parent profile.
CREATE OR REPLACE FUNCTION public.protect_bulk_owner()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $function$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.role = 'owner' AND EXISTS (
      SELECT 1 FROM public.bulk_profiles WHERE id = OLD.bulk_profile_id
    ) THEN
      RAISE EXCEPTION 'The owner cannot be removed';
    END IF;
    RETURN OLD;
  END IF;
  IF OLD.role = 'owner' AND NEW.role <> 'owner' THEN
    RAISE EXCEPTION 'The owner role cannot be changed';
  END IF;
  IF NEW.role = 'owner' AND OLD.role <> 'owner' THEN
    RAISE EXCEPTION 'Ownership cannot be transferred';
  END IF;
  IF NEW.user_id <> OLD.user_id OR NEW.bulk_profile_id <> OLD.bulk_profile_id THEN
    RAISE EXCEPTION 'Immutable membership identity';
  END IF;
  RETURN NEW;
END;
$function$;

CREATE FUNCTION public.search_challenge_invite_users(
  _caller uuid,
  _challenge uuid,
  _query text
)
RETURNS TABLE(username text)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE normalized text := lower(btrim(coalesce(_query, '')));
BEGIN
  IF _caller IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  IF char_length(normalized) < 2 OR char_length(normalized) > 20
    OR normalized !~ '^[a-z0-9_]+$' THEN
    RETURN;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.challenges c
    JOIN public.challenge_members member ON member.challenge_id = c.id
    WHERE c.id = _challenge AND c.created_by = _caller AND member.user_id = _caller
  ) THEN RAISE EXCEPTION 'Only the Challenge creator can invite'; END IF;

  RETURN QUERY
  SELECT profile.username
  FROM public.profiles profile
  WHERE profile.username IS NOT NULL
    AND profile.id <> _caller
    AND profile.username LIKE normalized || '%'
    AND NOT EXISTS (
      SELECT 1 FROM public.challenge_members member
      WHERE member.challenge_id = _challenge AND member.user_id = profile.id
    )
  ORDER BY (profile.username = normalized) DESC, profile.username
  LIMIT 12;
END;
$function$;

CREATE FUNCTION public.send_challenge_username_invitation(
  _caller uuid,
  _challenge uuid,
  _invited_username text
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  normalized text := lower(btrim(coalesce(_invited_username, '')));
  target_user uuid;
  invitation_id uuid;
  generated_hash text;
BEGIN
  IF _caller IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  IF NOT private.valid_tempo_username(normalized) THEN RAISE EXCEPTION 'Invalid username'; END IF;
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(_challenge::text, 0));
  IF NOT EXISTS (
    SELECT 1 FROM public.challenges c
    JOIN public.challenge_members member ON member.challenge_id = c.id
    WHERE c.id = _challenge AND c.created_by = _caller AND member.user_id = _caller
  ) THEN RAISE EXCEPTION 'Only the Challenge creator can invite'; END IF;
  IF (SELECT count(*) FROM public.challenge_members WHERE challenge_id = _challenge) >= 2 THEN
    RAISE EXCEPTION 'This Challenge is already full';
  END IF;
  SELECT id INTO target_user FROM public.profiles WHERE username = normalized;
  IF target_user IS NULL THEN RAISE EXCEPTION 'Username not found'; END IF;
  IF target_user = _caller THEN RAISE EXCEPTION 'You cannot invite yourself'; END IF;
  IF EXISTS (
    SELECT 1 FROM public.challenge_members
    WHERE challenge_id = _challenge AND user_id = target_user
  ) THEN RAISE EXCEPTION 'This person is already part of the Challenge'; END IF;
  IF EXISTS (
    SELECT 1 FROM public.challenge_invitations
    WHERE challenge_id = _challenge AND invited_user_id = target_user
      AND accepted_at IS NULL AND revoked_at IS NULL AND expires_at > now()
  ) THEN RAISE EXCEPTION 'An invitation has already been sent to this username'; END IF;

  UPDATE public.challenge_invitations SET revoked_at = now()
  WHERE challenge_id = _challenge AND accepted_at IS NULL AND revoked_at IS NULL;
  generated_hash := pg_catalog.encode(
    pg_catalog.sha256((gen_random_uuid()::text || clock_timestamp()::text)::bytea), 'hex'
  );
  INSERT INTO public.challenge_invitations(
    challenge_id, invited_user_id, invited_username_snapshot,
    token_hash, expires_at, created_by
  ) VALUES (
    _challenge, target_user, normalized, generated_hash, now() + interval '14 days', _caller
  ) RETURNING id INTO invitation_id;
  RETURN invitation_id;
END;
$function$;

CREATE FUNCTION public.list_my_challenge_invitations(_caller uuid)
RETURNS TABLE(
  invitation_id uuid,
  challenge_id uuid,
  challenge_name text,
  inviter_username text,
  weekly_target_km numeric,
  expires_at timestamptz
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
BEGIN
  IF _caller IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  RETURN QUERY
  SELECT invitation.id, challenge.id, challenge.name,
    coalesce(inviter.username, 'Tempo user'), challenge.weekly_target_km, invitation.expires_at
  FROM public.challenge_invitations invitation
  JOIN public.challenges challenge ON challenge.id = invitation.challenge_id
  LEFT JOIN public.profiles inviter ON inviter.id = invitation.created_by
  WHERE invitation.invited_user_id = _caller
    AND invitation.accepted_at IS NULL
    AND invitation.revoked_at IS NULL
    AND invitation.expires_at > now()
  ORDER BY invitation.created_at DESC;
END;
$function$;

CREATE FUNCTION public.accept_challenge_invitation_by_id(_caller uuid, _invitation uuid)
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
  RETURN invitation.challenge_id;
END;
$function$;

CREATE FUNCTION public.decline_challenge_invitation(_caller uuid, _invitation uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
BEGIN
  IF _caller IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  UPDATE public.challenge_invitations SET revoked_at = now()
  WHERE id = _invitation AND invited_user_id = _caller
    AND accepted_at IS NULL AND revoked_at IS NULL;
  IF NOT FOUND THEN RAISE EXCEPTION 'Invitation not found'; END IF;
  RETURN true;
END;
$function$;

REVOKE ALL ON FUNCTION public.search_challenge_invite_users(uuid,uuid,text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.send_challenge_username_invitation(uuid,uuid,text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.list_my_challenge_invitations(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.accept_challenge_invitation_by_id(uuid,uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.decline_challenge_invitation(uuid,uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.search_challenge_invite_users(uuid,uuid,text) TO service_role;
GRANT EXECUTE ON FUNCTION public.send_challenge_username_invitation(uuid,uuid,text) TO service_role;
GRANT EXECUTE ON FUNCTION public.list_my_challenge_invitations(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.accept_challenge_invitation_by_id(uuid,uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.decline_challenge_invitation(uuid,uuid) TO service_role;