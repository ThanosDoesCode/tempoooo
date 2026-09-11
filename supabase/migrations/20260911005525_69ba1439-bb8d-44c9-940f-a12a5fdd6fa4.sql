-- Hide invitation token hashes from challenge members (column-level privileges)
REVOKE SELECT ON public.challenge_invitations FROM authenticated;
GRANT SELECT (
  id, challenge_id, invited_email, expires_at, accepted_at, revoked_at,
  created_by, created_at, invited_user_id, invited_username_snapshot
) ON public.challenge_invitations TO authenticated;

REVOKE INSERT, UPDATE ON public.challenge_invitations FROM authenticated;
GRANT INSERT (
  id, challenge_id, invited_email, expires_at, created_by,
  invited_user_id, invited_username_snapshot
) ON public.challenge_invitations TO authenticated;
GRANT UPDATE (revoked_at) ON public.challenge_invitations TO authenticated;

GRANT ALL ON public.challenge_invitations TO service_role;

-- Defense in depth: no anonymous or PUBLIC execution of privileged routines
DO $$
DECLARE fn record;
BEGIN
  FOR fn IN
    SELECT p.oid::regprocedure AS sig
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname IN ('public', 'private') AND p.prosecdef
  LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon', fn.sig);
  END LOOP;
END $$;