import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { isNetworkError, shouldRetryRead, userFacingError } from "../src/lib/network-errors.ts";
import { safeOperationalCode } from "../supabase/functions/_shared/observability.ts";
import { CancelledError, QueryClient, QueryObserver } from "@tanstack/react-query";
import {
  authenticatedUserChanged,
  isExpectedQueryCancellation,
  recoverChallengeRoute,
  resetUserScopedQueries,
} from "../src/lib/query-cancellation.ts";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("read retries are bounded and limited to transient failures", () => {
  assert.equal(shouldRetryRead(0, new TypeError("Failed to fetch")), true);
  assert.equal(shouldRetryRead(1, new Response(null, { status: 503 })), true);
  assert.equal(shouldRetryRead(0, new Response(null, { status: 429 })), true);
  assert.equal(shouldRetryRead(0, new Response(null, { status: 403 })), false);
  assert.equal(shouldRetryRead(2, new TypeError("Failed to fetch")), false);
  assert.equal(isNetworkError(new TypeError("Load failed")), true);
});

test("startup profile and membership failures stop after the bounded read retries", async () => {
  for (const queryName of ["account-profile", "bulk-memberships"]) {
    let attempts = 0;
    const client = new QueryClient();
    await assert.rejects(
      client.fetchQuery({
        queryKey: [queryName, "user-a"],
        queryFn: () => {
          attempts += 1;
          throw new TypeError("Failed to fetch");
        },
        retry: shouldRetryRead,
        retryDelay: 0,
      }),
      /Failed to fetch/,
    );
    assert.equal(attempts, 3);
  }
});

test("write-facing network errors say that entered data is preserved", () => {
  const message = userFacingError(new TypeError("Failed to fetch"), "save the activity", {
    inputPreserved: true,
  });
  assert.match(message, /couldn't reach the server/i);
  assert.match(message, /entered data is still here/i);
  assert.doesNotMatch(message, /Failed to fetch/);
});

test("operational error codes cannot echo arbitrary provider or personal data", () => {
  assert.equal(safeOperationalCode(new Error("database_failed"), "fallback"), "database_failed");
  assert.equal(
    safeOperationalCode(
      new Error("request failed for person@example.com token=secret"),
      "fallback",
    ),
    "fallback",
  );
});

test("app and Bulk routes have independent recovery boundaries", async () => {
  const [root, boundary, bulk] = await Promise.all([
    read("src/routes/__root.tsx"),
    read("src/components/AppCrashBoundary.tsx"),
    read("src/routes/_authenticated/bulk/route.tsx"),
  ]);
  assert.match(root, /errorComponent: ErrorComponent/);
  assert.match(root, /<AppCrashBoundary/);
  assert.match(boundary, /componentDidCatch/);
  assert.match(boundary, /Try again/);
  assert.match(bulk, /errorComponent: BulkRouteError/);
  assert.match(bulk, /router\.invalidate\(\)/);
});

test("opening or refreshing Bulk seeds auth identity without cancelling its queries", () => {
  assert.equal(authenticatedUserChanged(undefined, "owner-a"), false);
});

test("authenticated cold start retries transient identity/profile reads without crashing", async () => {
  const [auth, profile, route, root] = await Promise.all([
    read("src/lib/auth.ts"),
    read("src/lib/account-profile.ts"),
    read("src/routes/_authenticated/route.tsx"),
    read("src/routes/__root.tsx"),
  ]);
  assert.match(auth, /shouldRetryRead\(0, error\)\) throw error/);
  assert.match(auth, /signOut\(\{ scope: "local" \}\)/);
  assert.match(auth, /retry: shouldRetryRead/);
  assert.match(profile, /\.maybeSingle\(\)/);
  assert.match(profile, /retry: shouldRetryRead/);
  assert.match(route, /errorComponent: AuthenticatedRouteError/);
  assert.match(route, /restore your Tempo session/);
  assert.match(route, /Promise\.all\(\[/);
  assert.match(route, /bulkOwnerQueryOptions\(\)/);
  assert.match(route, /withStartupDeadline\(/);
  assert.match(route, /cancelQueries\(\{ queryKey: \["bulk-memberships"\], exact: true \}\)/);
  assert.match(route, /if \(!profile\)[\s\S]*syncProfile\(user\)/);
  assert.match(profile, /abortSignal\(signal\)/);
  assert.match(route, /startupDiagnostic\("profile_resolved"/);
  assert.match(route, /startupDiagnostic\("memberships_resolved"/);
  assert.match(root, /routePending/);
  assert.match(root, /resolveStartupPhase/);
  assert.match(root, /Tempo startup timed out/);
  assert.match(root, /startupPhase === "recoverable-error"/);
});

test("same-user token refresh does not reset active queries", () => {
  assert.equal(authenticatedUserChanged("owner-a", "owner-a"), false);
});

test("actual account changes are recognized for private cache clearing", () => {
  assert.equal(authenticatedUserChanged("owner-a", "owner-b"), true);
  assert.equal(authenticatedUserChanged("owner-a", null), true);
  assert.equal(authenticatedUserChanged(null, "owner-a"), true);
});

test("account changes clear private query data without removing active queries", async () => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  client.setQueryData(["authenticated-user"], { id: "owner-a" });
  client.setQueryData(["account-profile", "owner-a"], { username: "owner_a" });
  client.setQueryData(["bulk-memberships"], [{ bulk_profile_id: "private-a" }]);
  client.setQueryData(["bulk-admin"], true);
  client.setQueryData(["challenge-activities", "challenge-a"], [{ id: "activity-a" }]);
  client.setQueryData(["public-unrelated"], "keep");
  const observer = new QueryObserver(client, {
    queryKey: ["bulk-memberships"],
    queryFn: async () => [{ bulk_profile_id: "private-b" }],
    staleTime: Infinity,
  });
  const unsubscribe = observer.subscribe(() => undefined);

  await resetUserScopedQueries(client);

  assert.equal(client.getQueryData(["authenticated-user"]), undefined);
  assert.equal(client.getQueryData(["account-profile", "owner-a"]), undefined);
  assert.deepEqual(client.getQueryData(["bulk-memberships"]), [{ bulk_profile_id: "private-b" }]);
  assert.equal(client.getQueryData(["bulk-admin"]), undefined);
  assert.equal(client.getQueryData(["challenge-activities", "challenge-a"]), undefined);
  assert.equal(client.getQueryData(["public-unrelated"]), "keep");
  unsubscribe();
});

test("TanStack cancellations recover while unexpected errors still reach crash UI", async () => {
  const [boundary, root, bulk] = await Promise.all([
    read("src/components/AppCrashBoundary.tsx"),
    read("src/routes/__root.tsx"),
    read("src/routes/_authenticated/bulk/route.tsx"),
  ]);

  assert.equal(isExpectedQueryCancellation(new CancelledError({ silent: true })), true);
  assert.equal(isExpectedQueryCancellation(new Error("CancelledError")), false);
  assert.equal(isExpectedQueryCancellation(new Error("database failed")), false);
  assert.match(boundary, /isExpectedQueryCancellation\(this\.state\.error\)/);
  assert.match(boundary, /return <QueryCancellationRecovery/);
  assert.match(boundary, /reportLovableError\(error/);
  assert.match(root, /if \(cancelled\)[\s\S]*QueryCancellationRecovery/);
  assert.match(bulk, /isExpectedQueryCancellation\(error\)[\s\S]*QueryCancellationRecovery/);
});

test("crash recovery navigates to Challenge, clears the boundary and never reloads", async () => {
  const [boundary, root] = await Promise.all([
    read("src/components/AppCrashBoundary.tsx"),
    read("src/routes/__root.tsx"),
  ]);

  assert.match(boundary, /onClick=\{this\.goToChallenge\}/);
  assert.match(boundary, /this\.props\.onChallengeHome\(\)\.then/);
  assert.match(boundary, /this\.setState\(\{ error: null \}\)/);
  assert.match(boundary, /window\.location\.assign\("\/challenge"\)/);
  let destination = null;
  let invalidated = false;
  await recoverChallengeRoute(
    async (options) => {
      destination = options;
    },
    async () => {
      invalidated = true;
    },
  );
  assert.deepEqual(destination, { to: "/challenge", replace: true });
  assert.equal(invalidated, true);
  assert.match(root, /recoverChallengeRoute\(/);
  assert.doesNotMatch(boundary, /window\.location\.reload|<Link/);
});

test("Bulk activation revocation still clears local data and redirects", async () => {
  const bulk = await read("src/routes/_authenticated/bulk/route.tsx");
  assert.match(bulk, /if \(!preferred\) \{[\s\S]*clearBulk\(\)/);
  assert.match(bulk, /navigate\(\{ to: "\/bulk-onboarding", replace: true \}\)/);
});

test("admin diagnostics are server-authorized and return no private notification payload", async () => {
  const [functions, server, route, pushMigration, bulkMigration, access, progress] =
    await Promise.all([
      read("src/lib/privileged-rpcs.functions.ts"),
      read("src/lib/privileged-rpcs.server.ts"),
      read("src/routes/_authenticated/bulk/diagnostics.tsx"),
      read("supabase/migrations/20260831120000_challenge_push_notifications.sql"),
      read("supabase/migrations/20260905120000_public_bulk_activation.sql"),
      read("src/lib/bulk-access.ts"),
      read("src/routes/_authenticated/bulk/progress.tsx"),
    ]);
  assert.match(functions, /getAdminDiagnostics[\s\S]*requireSupabaseAuth/);
  assert.match(server, /\.from\("bulk_admins"\)[\s\S]*\.eq\("user_id", caller\)/);
  assert.match(
    server,
    /id,kind,status,attempts,last_error,created_at,next_attempt_at,lease_until,finished_at/,
  );
  assert.doesNotMatch(
    server.match(/const DIAGNOSTIC_FIELDS[\s\S]*?as const/)?.[0] ?? "",
    /facts|actor_id|subscription_ids/,
  );
  assert.match(route, /Private operational status/);
  assert.match(route, /bulkAdminQueryOptions/);
  assert.match(access, /supabase\.rpc\("is_bulk_admin"\)/);
  assert.match(progress, /\{isAdmin \? \([\s\S]*Production diagnostics/);
  assert.match(
    bulkMigration,
    /INSERT INTO public\.bulk_admins\(user_id\)[\s\S]*FROM public\.bulk_members[\s\S]*WHERE role = 'owner'/,
  );
  assert.match(bulkMigration, /REVOKE ALL ON public\.bulk_admins FROM PUBLIC, anon, authenticated/);
  assert.match(
    pushMigration,
    /REVOKE ALL ON public\.challenge_notification_events FROM PUBLIC, anon, authenticated/,
  );
});

test("Bulk personal backup remains exact stored JSON and carries Tempo branding", async () => {
  const progress = await read("src/routes/_authenticated/bulk/progress.tsx");
  assert.match(progress, /JSON\.stringify\(data\)/);
  assert.match(progress, /tempo-bulk-backup-/);
  assert.match(progress, /Restore backup/);
  assert.match(progress, /to="\/bulk\/diagnostics"/);
});

test("push observability stays structured while dedupe and sync retry remain intact", async () => {
  const [delivery, worker, subscription, browser] = await Promise.all([
    read("supabase/functions/_shared/challenge-push.ts"),
    read("supabase/functions/challenge-push/index.ts"),
    read("supabase/functions/challenge-push-subscription/index.ts"),
    read("src/lib/challenge-push.ts"),
  ]);
  assert.match(delivery, /idempotency_key: event\.id/);
  assert.match(delivery, /operationalLog/);
  assert.match(worker, /safeOperationalCode/);
  assert.match(subscription, /phase = "provider_verification"/);
  const providerVerification = subscription.indexOf(
    "oneSignal().subscriptions(identity.data.external_id)",
  );
  const registrationRpc = subscription.indexOf('db.rpc("register_challenge_push_device"');
  assert.ok(providerVerification >= 0 && providerVerification < registrationRpc);
  assert.match(subscription, /if \(!verified\.includes\(id as string\)\)/);
  assert.match(browser, /Device registration is still pending/);
  assert.doesNotMatch(subscription, /console\.(?:error|warn)\([^\n]*uid/);
});

test("push restoration RPC rejects null identity input and keeps its hardened execution boundary", async () => {
  const migration = await read(
    "supabase/migrations/20260904190000_restore_push_device_after_login.sql",
  );
  assert.match(migration, /external_id IS DISTINCT FROM _external_id/);
  assert.match(migration, /_external_id IS NULL/);
  assert.match(migration, /btrim\(_external_id\) = ''/);
  assert.match(migration, /_activate IS NULL/);
  assert.match(migration, /SECURITY DEFINER/);
  assert.match(migration, /SET search_path = ''/);
  assert.match(
    migration,
    /REVOKE ALL ON FUNCTION public\.register_challenge_push_device[\s\S]*FROM PUBLIC, anon, authenticated/,
  );
  assert.match(
    migration,
    /GRANT EXECUTE ON FUNCTION public\.register_challenge_push_device[\s\S]*TO service_role/,
  );
});
