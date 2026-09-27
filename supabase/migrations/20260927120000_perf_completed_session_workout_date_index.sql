-- Performance: index completed training sessions by (bulk_profile_id, workout_date).
--
-- Rationale
--   The Goal Today screen, weekly Training overview, Check-In and Goal Progress all read
--   completed sessions filtered by workout_date (see completedSessionDatesQueryOptions in
--   src/lib/bulk-training-sessions.ts): profile + status = 'completed' + workout_date range,
--   including a single-day lookup (today) on the hot home path.
--
--   The existing partial index bulk_training_sessions_completed_idx is keyed on
--   (bulk_profile_id, completed_at DESC) WHERE status = 'completed', so those workout_date
--   queries can narrow to the profile's completed rows but must then filter workout_date
--   without index support. This partial index serves the workout_date predicate directly.
--
-- Safety
--   Additive only. No column, constraint, RLS policy or relationship is changed. IF NOT EXISTS
--   guards against duplication. Indexes never affect row-level security evaluation.
CREATE INDEX IF NOT EXISTS bulk_training_sessions_profile_workout_date_idx
  ON public.bulk_training_sessions (bulk_profile_id, workout_date DESC)
  WHERE status = 'completed';
