-- Read-only live summaries; finalized snapshots and qualification storage are untouched.
CREATE FUNCTION public.challenge_activity_summary(_challenge uuid, _start date DEFAULT NULL, _end date DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path = ''
AS $function$
DECLARE result jsonb;
BEGIN
  IF auth.uid() IS NULL OR NOT EXISTS (
    SELECT 1 FROM public.challenge_members WHERE challenge_id = _challenge AND user_id = auth.uid()
  ) THEN RAISE EXCEPTION 'Challenge membership required' USING ERRCODE = '42501'; END IF;
  IF (_start IS NULL) <> (_end IS NULL) OR _start > _end THEN
    RAISE EXCEPTION 'Invalid activity date range' USING ERRCODE = '22023';
  END IF;
  SELECT coalesce(jsonb_agg(jsonb_build_object(
    'userId', user_id, 'running', running, 'cycling', cycling, 'equivalent', equivalent,
    'stats', jsonb_build_object(
      'totalKm', total_km, 'challengeKm', equivalent,
      'runningKm', running, 'cyclingKm', cycling,
      'averageSpeedKmh', timed_km * 3600 / nullif(timed_seconds, 0),
      'runningPaceSecondsPerKm', run_seconds / nullif(timed_run_km, 0),
      'cyclingSpeedKmh', timed_cycle_km * 3600 / nullif(cycle_seconds, 0),
      'activities', activities, 'qualifiedActivities', qualified
    )
  ) ORDER BY user_id), '[]'::jsonb) INTO result FROM (
    SELECT user_id, sum(distance_km) AS total_km,
      coalesce(sum(distance_km) FILTER (WHERE activity_type = 'run'), 0) AS running,
      coalesce(sum(distance_km) FILTER (WHERE activity_type = 'cycle'), 0) AS cycling,
      coalesce(sum(qualifying_equivalent_km), 0) AS equivalent,
      coalesce(sum(distance_km) FILTER (WHERE duration_seconds > 0), 0) AS timed_km,
      coalesce(sum(duration_seconds) FILTER (WHERE duration_seconds > 0), 0) AS timed_seconds,
      coalesce(sum(distance_km) FILTER (WHERE duration_seconds > 0 AND activity_type = 'run'), 0) AS timed_run_km,
      coalesce(sum(duration_seconds) FILTER (WHERE duration_seconds > 0 AND activity_type = 'run'), 0) AS run_seconds,
      coalesce(sum(distance_km) FILTER (WHERE duration_seconds > 0 AND activity_type = 'cycle'), 0) AS timed_cycle_km,
      coalesce(sum(duration_seconds) FILTER (WHERE duration_seconds > 0 AND activity_type = 'cycle'), 0) AS cycle_seconds,
      count(*) AS activities,
      count(*) FILTER (WHERE is_qualified) AS qualified
    FROM public.challenge_activities
    WHERE challenge_id = _challenge
      AND (_start IS NULL OR activity_date BETWEEN _start AND _end)
    GROUP BY user_id
  ) totals;
  RETURN result;
END;
$function$;
REVOKE ALL ON FUNCTION public.challenge_activity_summary(uuid, date, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.challenge_activity_summary(uuid, date, date) TO authenticated;
