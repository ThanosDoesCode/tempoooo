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
  client.setQueryData(["bulk-memberships"], [{ bulk_profile_id: "private-a" }]);
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
  assert.deepEqual(client.getQueryData(["bulk-memberships"]), [{ bulk_profile_id: "private-b" }]);
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

test("Bulk owner revocation still clears local data and redirects", async () => {
  const bulk = await read("src/routes/_authenticated/bulk/route.tsx");
  assert.match(bulk, /memberships\.length === 0[\s\S]*clearBulk\(\)/);
  assert.match(bulk, /navigate\(\{ to: "\/bulk-access-denied", replace: true \}\)/);
});

test("admin diagnostics are server-authorized and return no private notification payload", async () => {
  const [functions, server, route, migration] = await Promise.all([
    read("src/lib/privileged-rpcs.functions.ts"),
    read("src/lib/privileged-rpcs.server.ts"),
    read("src/routes/_authenticated/bulk/diagnostics.tsx"),
    read("supabase/migrations/20260831120000_challenge_push_notifications.sql"),
  ]);
  assert.match(functions, /getAdminDiagnostics[\s\S]*requireSupabaseAuth/);
  assert.match(server, /\.eq\("user_id", caller\)[\s\S]*\.eq\("role", "owner"\)/);
  assert.match(
    server,
    /id,kind,status,attempts,last_error,created_at,next_attempt_at,lease_until,finished_at/,
  );
  assert.doesNotMatch(
    server.match(/const DIAGNOSTIC_FIELDS[\s\S]*?as const/)?.[0] ?? "",
    /facts|actor_id|subscription_ids/,
  );
  assert.match(route, /Private operational status/);
  assert.match(
    migration,
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
  assert.match(browser, /Device registration is still pending/);
  assert.doesNotMatch(subscription, /console\.(?:error|warn)\([^\n]*uid/);
});
