-- Run AFTER the migration, Edge Function deployment and Vault secret setup.
-- Supabase SQL editor, administrator only. No literal secrets in this file.
CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net WITH SCHEMA extensions;

CREATE OR REPLACE FUNCTION private.dispatch_challenge_push()
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE worker_url text; dispatch_secret text;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.challenge_notification_events
    WHERE (status = 'pending' AND next_attempt_at <= now()) OR (status = 'processing' AND lease_until < now())) THEN RETURN; END IF;
  SELECT decrypted_secret INTO worker_url FROM vault.decrypted_secrets WHERE name = 'challenge_push_worker_url';
  SELECT decrypted_secret INTO dispatch_secret FROM vault.decrypted_secrets WHERE name = 'challenge_push_dispatch_secret';
  IF worker_url IS NULL OR dispatch_secret IS NULL OR length(dispatch_secret) < 32 THEN
    RAISE WARNING 'Challenge push dispatch secrets are missing';
    RETURN;
  END IF;
  PERFORM net.http_post(url := worker_url,
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-challenge-push-secret', dispatch_secret),
    body := '{}'::jsonb, timeout_milliseconds := 120000);
END;
$$;
REVOKE ALL ON FUNCTION private.dispatch_challenge_push() FROM PUBLIC, anon, authenticated;

-- Event-triggered wake-up; pg_net dispatches only after commit. Transport outages
-- must not roll back the user's activity. The minute job recovers missed wakes.
CREATE OR REPLACE FUNCTION private.wake_challenge_push()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  BEGIN
    PERFORM private.dispatch_challenge_push();
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'Challenge push wake-up failed; scheduled retry will recover';
  END;
  RETURN NULL;
END;
$$;
REVOKE ALL ON FUNCTION private.wake_challenge_push() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS challenge_push_wake ON public.challenge_notification_events;
CREATE TRIGGER challenge_push_wake AFTER INSERT ON public.challenge_notification_events
  FOR EACH STATEMENT EXECUTE FUNCTION private.wake_challenge_push();
SELECT cron.schedule('challenge-push-retry', '* * * * *', 'SELECT private.dispatch_challenge_push();');

-- Finalization attempts evidence cleanup immediately. This scheduled dispatcher
-- recovers failed attempts and any work missed because that request was interrupted.
CREATE OR REPLACE FUNCTION private.dispatch_challenge_evidence_cleanup()
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE worker_url text; dispatch_secret text;
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM public.challenge_evidence_cleanup
    WHERE (status IN ('pending', 'failed') AND next_attempt_at <= now())
       OR (status = 'processing' AND lease_until < now())
  ) THEN RETURN; END IF;
  SELECT decrypted_secret INTO worker_url FROM vault.decrypted_secrets
    WHERE name = 'challenge_evidence_cleanup_worker_url';
  SELECT decrypted_secret INTO dispatch_secret FROM vault.decrypted_secrets
    WHERE name = 'challenge_push_dispatch_secret';
  IF worker_url IS NULL OR dispatch_secret IS NULL OR length(dispatch_secret) < 32 THEN
    RAISE WARNING 'Challenge evidence cleanup dispatch configuration is missing';
    RETURN;
  END IF;
  PERFORM net.http_post(url := worker_url,
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-challenge-push-secret', dispatch_secret),
    body := '{}'::jsonb, timeout_milliseconds := 120000);
END;
$$;
REVOKE ALL ON FUNCTION private.dispatch_challenge_evidence_cleanup()
  FROM PUBLIC, anon, authenticated;

-- Bounded worker batches keep an hourly invocation predictable. If more than one
-- batch is due, later hourly runs continue draining it without client involvement.
SELECT cron.schedule(
  'challenge-evidence-cleanup-retry',
  '7 * * * *',
  'SELECT private.dispatch_challenge_evidence_cleanup();'
);
