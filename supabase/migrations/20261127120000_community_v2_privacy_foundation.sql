-- Community V2 Phase 1. Additive, no backfill, no changes to Challenge access or writers.
-- The workout-only event scaffold is deliberately NOT populated by this migration.
-- Run/Ride feed capture is deferred: activity_date is not an occurrence timestamp.

CREATE FUNCTION private.community_v2_audience()
RETURNS TABLE(user_id uuid, accepted_at timestamptz)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT auth.uid(), NULL::timestamptz WHERE auth.uid() IS NOT NULL
  UNION ALL
  SELECT CASE WHEN r.requester_id = auth.uid() THEN r.recipient_id ELSE r.requester_id END,
    CASE WHEN isfinite(r.responded_at) THEN r.responded_at ELSE NULL END
  FROM public.community_relationships r
  WHERE auth.uid() IS NOT NULL AND r.status = 'accepted'
    AND auth.uid() IN (r.requester_id, r.recipient_id)
    AND NOT private.community_is_blocked(r.requester_id, r.recipient_id);
$$;
REVOKE ALL ON FUNCTION private.community_v2_audience() FROM PUBLIC, anon, authenticated, service_role;

CREATE FUNCTION private.community_week_bounds(_timezone text, _now timestamptz)
RETURNS TABLE(week_start date, week_end date, local_today date)
LANGUAGE plpgsql STABLE SET search_path = '' AS $$
BEGIN
  IF _now IS NULL OR NOT isfinite(_now) OR _timezone IS NULL OR NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_timezone_names WHERE name = _timezone
  ) THEN RAISE EXCEPTION 'Invalid timezone or instant' USING ERRCODE = '22023'; END IF;
  RETURN QUERY SELECT date_trunc('week', _now AT TIME ZONE _timezone)::date,
    date_trunc('week', _now AT TIME ZONE _timezone)::date + 6,
    (_now AT TIME ZONE _timezone)::date;
END;
$$;
REVOKE ALL ON FUNCTION private.community_week_bounds(text,timestamptz)
  FROM PUBLIC, anon, authenticated, service_role;

-- Local EXPLAIN review: existing challenge-leading index required multiple index searches;
-- this covering actor/type/day index supports the new cross-Challenge distance aggregation.
CREATE INDEX community_activity_actor_type_day_idx
  ON public.challenge_activities(user_id, activity_type, activity_date) INCLUDE (distance_km);

CREATE FUNCTION public.community_weekly_leaderboard(
  _activity_type text, _timezone text, _after_distance numeric DEFAULT NULL,
  _after_user uuid DEFAULT NULL, _limit integer DEFAULT 20
) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE caller uuid := auth.uid(); bounds record; result jsonb;
BEGIN
  IF caller IS NULL THEN RAISE EXCEPTION 'Not authenticated' USING ERRCODE = '42501'; END IF;
  IF _activity_type IS NULL OR _activity_type NOT IN ('run', 'ride')
    OR _limit IS NULL OR _limit NOT BETWEEN 1 AND 50
    OR (_after_distance IS NULL) <> (_after_user IS NULL)
    OR (_after_distance IS NOT NULL AND (_after_distance < 0 OR _after_distance::text IN ('NaN','Infinity','-Infinity')
      OR _after_distance <> round(_after_distance, 2))) THEN
    RAISE EXCEPTION 'Invalid leaderboard arguments' USING ERRCODE = '22023';
  END IF;
  SELECT * INTO bounds FROM private.community_week_bounds(_timezone, statement_timestamp());
  WITH audience AS MATERIALIZED (SELECT * FROM private.community_v2_audience()),
  distances AS MATERIALIZED (
    SELECT a.user_id, coalesce(sum(c.distance_km), 0)::numeric AS distance_km
    FROM audience a LEFT JOIN public.challenge_activities c ON c.user_id = a.user_id
      AND c.activity_type = (CASE _activity_type WHEN 'ride' THEN 'cycle' ELSE 'run' END)::public.activity_kind
      AND c.activity_date >= bounds.week_start AND c.activity_date <= bounds.local_today
    GROUP BY a.user_id
  ), ranked AS MATERIALIZED (
    SELECT d.user_id, p.username, d.distance_km,
      rank() OVER (ORDER BY d.distance_km DESC) AS rank,
      row_number() OVER (ORDER BY d.distance_km DESC, d.user_id) AS position
    FROM distances d LEFT JOIN public.profiles p ON p.id = d.user_id
  ), candidates AS MATERIALIZED (
    SELECT * FROM ranked WHERE _after_distance IS NULL
      OR distance_km < _after_distance OR (distance_km = _after_distance AND user_id > _after_user)
    ORDER BY distance_km DESC, user_id LIMIT _limit + 1
  ), page AS MATERIALIZED (
    SELECT * FROM candidates ORDER BY distance_km DESC, user_id LIMIT _limit
  )
  SELECT jsonb_build_object(
    'activity_type', _activity_type, 'timezone', _timezone,
    'week_start', bounds.week_start, 'week_end', bounds.week_end,
    'participants', (SELECT count(*) FROM ranked),
    'rows', coalesce((SELECT jsonb_agg(to_jsonb(p) ORDER BY p.distance_km DESC, p.user_id) FROM page p), '[]'::jsonb),
    'self', (SELECT to_jsonb(me) || jsonb_build_object(
      'distance_to_next_rank_km', (SELECT min(other.distance_km) - me.distance_km + 0.01
        FROM ranked other WHERE other.distance_km > me.distance_km),
      'distance_to_break_tie_km', CASE WHEN EXISTS (
        SELECT 1 FROM ranked other WHERE other.user_id <> me.user_id AND other.distance_km = me.distance_km
      ) THEN 0.01 ELSE NULL END
    ) FROM ranked me WHERE me.user_id = caller),
    'next_cursor', CASE WHEN (SELECT count(*) FROM candidates) > _limit THEN (
      SELECT jsonb_build_object('distance_km', p.distance_km, 'user_id', p.user_id)
      FROM page p ORDER BY p.distance_km, p.user_id DESC LIMIT 1
    ) ELSE NULL END
  ) INTO result;
  RETURN result;
END;
$$;
REVOKE ALL ON FUNCTION public.community_weekly_leaderboard(text,text,numeric,uuid,integer)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.community_weekly_leaderboard(text,text,numeric,uuid,integer)
  TO authenticated, service_role;

-- Stable event identity, not a copied workout. No client event publisher or completion trigger.
-- Additional source kinds require a separately reviewed occurrence-time contract.
CREATE TABLE private.community_activity_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workout_session_id uuid NOT NULL UNIQUE REFERENCES public.bulk_training_sessions(id) ON DELETE CASCADE,
  published_at timestamptz NOT NULL DEFAULT statement_timestamp() CHECK (isfinite(published_at))
);
CREATE TABLE private.community_flames (
  event_id uuid NOT NULL REFERENCES private.community_activity_events(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  PRIMARY KEY (event_id, user_id)
);
REVOKE ALL ON private.community_activity_events, private.community_flames FROM PUBLIC, anon, authenticated;
GRANT ALL ON private.community_activity_events, private.community_flames TO service_role;
ALTER TABLE private.community_activity_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE private.community_flames ENABLE ROW LEVEL SECURITY;

-- Deliberately exclude names, bodyweight, exercise/set metadata, notes and source IDs.
CREATE VIEW private.community_workout_event_details WITH (security_barrier = true) AS
  SELECT e.id, p.owner_id AS actor_user_id, u.username, 'workout'::text AS event_type,
    s.workout_date AS activity_date, s.completed_at AS occurred_at, e.published_at,
    extract(epoch FROM (s.completed_at - s.started_at))::bigint AS duration_seconds,
    least(s.started_at, s.completed_at, e.published_at) AS eligible_since
  FROM private.community_activity_events e
  JOIN public.bulk_training_sessions s ON s.id = e.workout_session_id
  JOIN public.bulk_profiles p ON p.id = s.bulk_profile_id
  JOIN public.profiles u ON u.id = p.owner_id
  WHERE s.status = 'completed' AND s.completed_at IS NOT NULL
    AND isfinite(s.started_at) AND isfinite(s.completed_at) AND s.completed_at > s.started_at
    AND s.completed_at <= e.published_at AND e.published_at <= statement_timestamp();
REVOKE ALL ON private.community_workout_event_details FROM PUBLIC, anon, authenticated, service_role;

CREATE FUNCTION private.community_can_read_event(_event uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT EXISTS (
    SELECT 1 FROM private.community_workout_event_details e
    JOIN private.community_v2_audience() a ON a.user_id = e.actor_user_id
    WHERE e.id = _event AND (a.user_id = auth.uid()
      OR (a.accepted_at IS NOT NULL AND a.accepted_at <= e.eligible_since))
  );
$$;
REVOKE ALL ON FUNCTION private.community_can_read_event(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION private.community_can_read_event(uuid) TO authenticated, service_role;
CREATE POLICY community_event_read ON private.community_activity_events
  FOR SELECT TO authenticated USING (private.community_can_read_event(id));
CREATE POLICY community_flame_read ON private.community_flames
  FOR SELECT TO authenticated USING (user_id = auth.uid() AND private.community_can_read_event(event_id));

CREATE FUNCTION public.get_community_activity_event(_event uuid)
RETURNS TABLE(id uuid, actor_user_id uuid, username text, event_type text, activity_date date,
  occurred_at timestamptz, published_at timestamptz, duration_seconds bigint, flame_count bigint, has_flame boolean)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Not authenticated' USING ERRCODE = '42501'; END IF;
  RETURN QUERY SELECT e.id, e.actor_user_id, e.username, e.event_type, e.activity_date,
    e.occurred_at, e.published_at, e.duration_seconds,
    (SELECT count(*) FROM private.community_flames f WHERE f.event_id = e.id),
    EXISTS (SELECT 1 FROM private.community_flames f WHERE f.event_id = e.id AND f.user_id = auth.uid())
  FROM private.community_workout_event_details e
  JOIN private.community_v2_audience() a ON a.user_id = e.actor_user_id
  WHERE e.id = _event AND (a.user_id = auth.uid()
    OR (a.accepted_at IS NOT NULL AND a.accepted_at <= e.eligible_since));
END;
$$;
REVOKE ALL ON FUNCTION public.get_community_activity_event(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_community_activity_event(uuid) TO authenticated, service_role;

CREATE FUNCTION public.list_community_activity_events(
  _before_published_at timestamptz DEFAULT NULL, _before_id uuid DEFAULT NULL, _limit integer DEFAULT 20
) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE result jsonb;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Not authenticated' USING ERRCODE = '42501'; END IF;
  IF _limit IS NULL OR _limit NOT BETWEEN 1 AND 50
    OR (_before_published_at IS NULL) <> (_before_id IS NULL)
    OR (_before_published_at IS NOT NULL AND NOT isfinite(_before_published_at)) THEN
    RAISE EXCEPTION 'Invalid feed arguments' USING ERRCODE = '22023';
  END IF;
  WITH candidates AS MATERIALIZED (
    SELECT e.* FROM private.community_workout_event_details e
    JOIN private.community_v2_audience() a ON a.user_id = e.actor_user_id
    WHERE (a.user_id = auth.uid() OR (a.accepted_at IS NOT NULL AND a.accepted_at <= e.eligible_since))
      AND (_before_published_at IS NULL OR (e.published_at, e.id) < (_before_published_at, _before_id))
    ORDER BY e.published_at DESC, e.id DESC LIMIT _limit + 1
  ), page AS MATERIALIZED (
    SELECT * FROM candidates ORDER BY published_at DESC, id DESC LIMIT _limit
  ), flames AS (
    SELECT f.event_id, count(*) AS flame_count, bool_or(f.user_id = auth.uid()) AS has_flame
    FROM private.community_flames f JOIN page p ON p.id = f.event_id GROUP BY f.event_id
  )
  SELECT jsonb_build_object(
    'events', coalesce((SELECT jsonb_agg(jsonb_build_object(
      'id', p.id, 'actor_user_id', p.actor_user_id, 'username', p.username, 'event_type', p.event_type,
      'activity_date', p.activity_date, 'occurred_at', p.occurred_at, 'published_at', p.published_at,
      'duration_seconds', p.duration_seconds,
      'flame_count', coalesce(f.flame_count, 0), 'has_flame', coalesce(f.has_flame, false)
    ) ORDER BY p.published_at DESC, p.id DESC) FROM page p LEFT JOIN flames f ON f.event_id = p.id), '[]'::jsonb),
    'next_cursor', CASE WHEN (SELECT count(*) FROM candidates) > _limit THEN (
      SELECT jsonb_build_object('published_at', p.published_at, 'id', p.id)
      FROM page p ORDER BY p.published_at, p.id LIMIT 1
    ) ELSE NULL END
  ) INTO result;
  RETURN result;
END;
$$;
REVOKE ALL ON FUNCTION public.list_community_activity_events(timestamptz,uuid,integer)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.list_community_activity_events(timestamptz,uuid,integer)
  TO authenticated, service_role;

CREATE FUNCTION public.set_community_flame(_event uuid, _enabled boolean) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE caller uuid := auth.uid(); actor uuid;
BEGIN
  IF caller IS NULL THEN RAISE EXCEPTION 'Not authenticated' USING ERRCODE = '42501'; END IF;
  IF _event IS NULL OR _enabled IS NULL THEN
    RAISE EXCEPTION 'Invalid flame arguments' USING ERRCODE = '22023'; END IF;
  SELECT e.actor_user_id INTO actor FROM private.community_workout_event_details e WHERE e.id = _event;
  IF actor IS NULL THEN RAISE EXCEPTION 'Event unavailable' USING ERRCODE = '42501'; END IF;
  -- Serialize with the existing remove/block writers, then recheck authorization.
  IF actor <> caller THEN PERFORM private.community_lock_pair(actor); END IF;
  IF NOT private.community_can_read_event(_event) THEN
    RAISE EXCEPTION 'Event unavailable' USING ERRCODE = '42501'; END IF;
  IF _enabled THEN
    INSERT INTO private.community_flames(event_id,user_id) VALUES (_event,caller) ON CONFLICT DO NOTHING;
  ELSE
    DELETE FROM private.community_flames WHERE event_id = _event AND user_id = caller;
  END IF;
  RETURN _enabled;
END;
$$;
REVOKE ALL ON FUNCTION public.set_community_flame(uuid,boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.set_community_flame(uuid,boolean) TO authenticated, service_role;
