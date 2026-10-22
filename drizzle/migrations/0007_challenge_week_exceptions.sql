-- Reconciliation of already-live supabase/migrations/20261021120000_challenge_week_exceptions.sql.
-- The original schema, functions, and policies are already present and are not rerun here.
-- This managed entry applies only the approved table privilege correction.
REVOKE ALL PRIVILEGES ON TABLE public.challenge_week_adjustments FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.challenge_week_adjustments TO authenticated;
GRANT ALL PRIVILEGES ON TABLE public.challenge_week_adjustments TO service_role;