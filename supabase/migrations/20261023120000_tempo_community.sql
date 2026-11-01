-- Private Community graph. No historical friendships, notification events or Challenge changes.
CREATE TABLE public.community_relationships (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  requester_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  recipient_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  pair_low uuid GENERATED ALWAYS AS (least(requester_id, recipient_id)) STORED,
  pair_high uuid GENERATED ALWAYS AS (greatest(requester_id, recipient_id)) STORED,
  request_id uuid NOT NULL,
  status text NOT NULL CHECK (status IN ('pending', 'accepted', 'declined', 'cancelled', 'removed')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  responded_at timestamptz,
  CONSTRAINT community_no_self CHECK (requester_id <> recipient_id),
  CONSTRAINT community_pair_unique UNIQUE (pair_low, pair_high)
);
CREATE INDEX community_incoming_idx ON public.community_relationships(recipient_id, requester_id) WHERE status = 'pending';
CREATE INDEX community_outgoing_idx ON public.community_relationships(requester_id, recipient_id) WHERE status = 'pending';
CREATE INDEX community_friends_requester_idx ON public.community_relationships(requester_id, recipient_id) WHERE status = 'accepted';
CREATE INDEX community_friends_recipient_idx ON public.community_relationships(recipient_id, requester_id) WHERE status = 'accepted';
CREATE TABLE public.community_blocks (
  blocker_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  blocked_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (blocker_id, blocked_id),
  CONSTRAINT community_block_no_self CHECK (blocker_id <> blocked_id)
);
CREATE INDEX community_blocks_reverse_idx ON public.community_blocks(blocked_id, blocker_id);
-- Retain send receipts across relationship lifecycles: a delayed retry must never resurrect
-- a declined/cancelled/removed request, including after another request has replaced it.
CREATE TABLE private.community_send_receipts (
  actor_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  request_id uuid NOT NULL,
  target_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  PRIMARY KEY (actor_id, request_id)
);
REVOKE ALL ON public.community_relationships, public.community_blocks FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.community_relationships, public.community_blocks TO authenticated;
GRANT ALL ON public.community_relationships, public.community_blocks, private.community_send_receipts TO service_role;
REVOKE ALL ON private.community_send_receipts FROM PUBLIC, anon, authenticated;
ALTER TABLE public.community_relationships ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.community_blocks ENABLE ROW LEVEL SECURITY;
ALTER TABLE private.community_send_receipts ENABLE ROW LEVEL SECURITY;
CREATE POLICY community_participant_read ON public.community_relationships FOR SELECT TO authenticated
  USING (auth.uid() IN (requester_id, recipient_id));
CREATE POLICY community_own_blocks_read ON public.community_blocks FOR SELECT TO authenticated
  USING (blocker_id = auth.uid());
-- Existing unique lower(username) index stays intact; this pattern index supports bounded prefix search.
CREATE INDEX community_username_prefix_idx ON public.profiles(lower(username) text_pattern_ops) WHERE username IS NOT NULL;

CREATE FUNCTION private.community_lock_pair(_other uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE caller uuid := auth.uid();
BEGIN
  IF caller IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  IF _other IS NULL OR _other = caller OR NOT EXISTS (
    SELECT 1 FROM public.profiles WHERE id = _other AND username IS NOT NULL
  ) THEN RAISE EXCEPTION 'Person unavailable'; END IF;
  -- Every relationship and block write takes this same transaction-scoped pair lock.
  -- Hash collisions only serialize unrelated pairs; they cannot change authorization.
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
    least(caller, _other)::text || ':' || greatest(caller, _other)::text, 0));
END;
$$;
CREATE FUNCTION private.community_is_blocked(_a uuid, _b uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT EXISTS (SELECT 1 FROM public.community_blocks
    WHERE (blocker_id = _a AND blocked_id = _b) OR (blocker_id = _b AND blocked_id = _a));
$$;

CREATE FUNCTION public.send_community_friend_request(_user uuid, _request_id uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE caller uuid := auth.uid(); receipt_target uuid;
BEGIN
  PERFORM private.community_lock_pair(_user);
  IF _request_id IS NULL THEN RAISE EXCEPTION 'Request ID required'; END IF;
  -- Serialize re-use of one token even if it targets two different pairs concurrently.
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(caller::text || ':' || _request_id::text, 1));
  SELECT target_id INTO receipt_target FROM private.community_send_receipts
    WHERE actor_id = caller AND request_id = _request_id;
  IF FOUND THEN
    IF receipt_target <> _user THEN RAISE EXCEPTION 'Request ID already used'; END IF;
    RETURN;
  END IF;
  IF private.community_is_blocked(caller, _user) THEN RAISE EXCEPTION 'Person unavailable'; END IF;
  INSERT INTO public.community_relationships(requester_id, recipient_id, request_id, status)
    VALUES(caller, _user, _request_id, 'pending')
    ON CONFLICT (pair_low, pair_high) DO UPDATE
    SET requester_id = EXCLUDED.requester_id, recipient_id = EXCLUDED.recipient_id,
      request_id = EXCLUDED.request_id, status = 'pending', updated_at = now(), responded_at = NULL
    WHERE public.community_relationships.status IN ('declined', 'cancelled', 'removed');
  -- A reciprocal send leaves the incoming request pending: consent is always explicit.
  INSERT INTO private.community_send_receipts(actor_id, request_id, target_id) VALUES(caller, _request_id, _user);
END;
$$;

CREATE FUNCTION private.community_transition(_user uuid, _request_id uuid, _action text) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE caller uuid := auth.uid(); relationship public.community_relationships; desired text;
BEGIN
  PERFORM private.community_lock_pair(_user);
  SELECT * INTO relationship FROM public.community_relationships
    WHERE pair_low = least(caller, _user) AND pair_high = greatest(caller, _user) FOR UPDATE;
  IF NOT FOUND OR _request_id IS DISTINCT FROM relationship.request_id
    OR private.community_is_blocked(caller, _user) THEN
    RAISE EXCEPTION 'Request changed. Refresh and try again.';
  END IF;
  IF _action IN ('accept', 'decline') AND relationship.recipient_id = caller THEN
    desired := CASE WHEN _action = 'accept' THEN 'accepted' ELSE 'declined' END;
    IF relationship.status = desired THEN RETURN; END IF;
    IF relationship.status <> 'pending' THEN RAISE EXCEPTION 'Request is no longer pending'; END IF;
  ELSIF _action = 'cancel' AND relationship.requester_id = caller THEN
    desired := 'cancelled';
    IF relationship.status = desired THEN RETURN; END IF;
    IF relationship.status <> 'pending' THEN RAISE EXCEPTION 'Request is no longer pending'; END IF;
  ELSIF _action = 'remove' THEN
    desired := 'removed';
    IF relationship.status = desired THEN RETURN; END IF;
    IF relationship.status <> 'accepted' THEN RAISE EXCEPTION 'Friendship is no longer active'; END IF;
  ELSE RAISE EXCEPTION 'Not authorized';
  END IF;
  UPDATE public.community_relationships SET status = desired, updated_at = now(), responded_at = now()
    WHERE id = relationship.id;
END;
$$;
CREATE FUNCTION public.accept_community_friend_request(_user uuid, _request_id uuid) RETURNS void
LANGUAGE sql SECURITY DEFINER SET search_path = '' AS $$
  SELECT private.community_transition(_user, _request_id, 'accept');
$$;
CREATE FUNCTION public.decline_community_friend_request(_user uuid, _request_id uuid) RETURNS void
LANGUAGE sql SECURITY DEFINER SET search_path = '' AS $$
  SELECT private.community_transition(_user, _request_id, 'decline');
$$;
CREATE FUNCTION public.cancel_community_friend_request(_user uuid, _request_id uuid) RETURNS void
LANGUAGE sql SECURITY DEFINER SET search_path = '' AS $$
  SELECT private.community_transition(_user, _request_id, 'cancel');
$$;
CREATE FUNCTION public.remove_community_friend(_user uuid, _request_id uuid) RETURNS void
LANGUAGE sql SECURITY DEFINER SET search_path = '' AS $$
  SELECT private.community_transition(_user, _request_id, 'remove');
$$;
CREATE FUNCTION public.block_community_user(_user uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE caller uuid := auth.uid();
BEGIN
  PERFORM private.community_lock_pair(_user);
  INSERT INTO public.community_blocks(blocker_id, blocked_id) VALUES(caller, _user) ON CONFLICT DO NOTHING;
  -- Neither pending requests nor friendships are restored by unblock.
  UPDATE public.community_relationships SET status = 'removed', updated_at = now(), responded_at = now()
    WHERE pair_low = least(caller, _user) AND pair_high = greatest(caller, _user)
      AND status IN ('pending', 'accepted');
END;
$$;
CREATE FUNCTION public.unblock_community_user(_user uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  PERFORM private.community_lock_pair(_user);
  DELETE FROM public.community_blocks WHERE blocker_id = auth.uid() AND blocked_id = _user;
END;
$$;

-- Projection contains only the public handle plus the caller's actionable relationship token.
CREATE FUNCTION private.community_person(_user uuid)
RETURNS TABLE(user_id uuid, username text, relationship_state text, request_id uuid)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT p.id, p.username,
    CASE WHEN r.status = 'accepted' THEN 'friends'
      WHEN r.status = 'pending' AND r.requester_id = auth.uid() THEN 'outgoing_pending'
      WHEN r.status = 'pending' THEN 'incoming_pending' ELSE 'none' END,
    CASE WHEN r.status IN ('pending', 'accepted') THEN r.request_id ELSE NULL END
  FROM public.profiles p LEFT JOIN public.community_relationships r
    ON r.pair_low = least(auth.uid(), p.id) AND r.pair_high = greatest(auth.uid(), p.id)
  WHERE auth.uid() IS NOT NULL AND p.id = _user AND p.id <> auth.uid()
    AND p.username IS NOT NULL AND NOT private.community_is_blocked(auth.uid(), p.id);
$$;
CREATE FUNCTION public.get_community_profile(_user uuid)
RETURNS TABLE(user_id uuid, username text, relationship_state text, request_id uuid)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  RETURN QUERY SELECT * FROM private.community_person(_user);
END;
$$;
CREATE FUNCTION public.search_community_people(_query text)
RETURNS TABLE(user_id uuid, username text, relationship_state text, request_id uuid)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE term text := lower(btrim(coalesce(_query, ''))); pattern text;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  IF char_length(term) < 2 OR char_length(term) > 20 OR term !~ '^[a-z0-9_]+$' THEN RETURN; END IF;
  -- Underscores are legal username characters, never LIKE wildcards. % and backslash are rejected.
  pattern := replace(term, '_', E'\\_') || '%';
  RETURN QUERY SELECT person.* FROM public.profiles p
    CROSS JOIN LATERAL private.community_person(p.id) person
    WHERE p.username IS NOT NULL AND lower(p.username) LIKE pattern ESCAPE E'\\'
    ORDER BY (p.username = term) DESC, p.username, p.id LIMIT 20;
END;
$$;
CREATE FUNCTION public.list_community_people(_kind text, _after uuid DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE caller uuid := auth.uid(); result jsonb;
BEGIN
  IF caller IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  IF _kind NOT IN ('blocked', 'incoming', 'outgoing', 'friends') OR _kind IS NULL THEN
    RAISE EXCEPTION 'Invalid list';
  END IF;
  -- One bounded lookahead supplies an honest cursor. A single JSON page also avoids
  -- PostgREST row caps silently truncating a SETOF response or a useless empty-page click.
  WITH candidates AS MATERIALIZED (
    SELECT p.id AS user_id, p.username, 'none'::text AS relationship_state, NULL::uuid AS request_id
    FROM public.community_blocks b JOIN public.profiles p ON p.id = b.blocked_id
    WHERE _kind = 'blocked' AND b.blocker_id = caller AND p.username IS NOT NULL
      AND (_after IS NULL OR p.id > _after)
    UNION ALL
    SELECT person.* FROM public.community_relationships r
      CROSS JOIN LATERAL private.community_person(
        CASE WHEN r.requester_id = caller THEN r.recipient_id ELSE r.requester_id END) person
    WHERE ((_kind = 'incoming' AND r.recipient_id = caller AND r.status = 'pending')
      OR (_kind = 'outgoing' AND r.requester_id = caller AND r.status = 'pending')
      OR (_kind = 'friends' AND caller IN (r.requester_id, r.recipient_id) AND r.status = 'accepted'))
      AND (_after IS NULL OR person.user_id > _after)
    ORDER BY user_id LIMIT 21
  ), page AS MATERIALIZED (SELECT * FROM candidates ORDER BY user_id LIMIT 20)
  SELECT jsonb_build_object(
    'people', coalesce((SELECT jsonb_agg(to_jsonb(p) ORDER BY p.user_id) FROM page p), '[]'::jsonb),
    'next_cursor', CASE WHEN (SELECT count(*) FROM candidates) > 20
      THEN (SELECT user_id FROM page ORDER BY user_id DESC LIMIT 1) ELSE NULL END
  ) INTO result;
  RETURN result;
END;
$$;
CREATE FUNCTION public.community_incoming_count() RETURNS integer
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  RETURN (SELECT count(*)::integer FROM (
    SELECT 1 FROM public.community_relationships r
    WHERE r.recipient_id = auth.uid() AND r.status = 'pending' LIMIT 10
  ) incoming);
END;
$$;

REVOKE ALL ON FUNCTION private.community_lock_pair(uuid), private.community_is_blocked(uuid,uuid),
  private.community_transition(uuid,uuid,text), private.community_person(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.send_community_friend_request(uuid,uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.send_community_friend_request(uuid,uuid) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.accept_community_friend_request(uuid,uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.accept_community_friend_request(uuid,uuid) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.decline_community_friend_request(uuid,uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.decline_community_friend_request(uuid,uuid) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.cancel_community_friend_request(uuid,uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.cancel_community_friend_request(uuid,uuid) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.remove_community_friend(uuid,uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.remove_community_friend(uuid,uuid) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.block_community_user(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.block_community_user(uuid) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.unblock_community_user(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.unblock_community_user(uuid) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.get_community_profile(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_community_profile(uuid) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.search_community_people(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.search_community_people(text) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.list_community_people(text,uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.list_community_people(text,uuid) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.community_incoming_count() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.community_incoming_count() TO authenticated, service_role;
