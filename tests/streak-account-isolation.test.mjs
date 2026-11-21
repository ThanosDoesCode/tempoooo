import { test } from "node:test";
import assert from "node:assert/strict";
import { setImmediate } from "node:timers/promises";
import * as query from "@tanstack/react-query";
import * as network from "../src/lib/network-errors.ts";
import * as streakModel from "../src/lib/streak-model.ts";
import { authenticatedUserChanged, resetUserScopedQueries } from "../src/lib/query-cancellation.ts";
import { presentationComponent } from "./presentation-component-fixture.mjs";

const roots = ["streak", "streak-frozen", "streak-run-legs"];
const weekStart = "2026-11-16";
const thisWeek = {
  weekStart,
  weekEnd: "2026-11-22",
  rings: ["run", "train", "eat"].map((key) => ({ key, active: true, state: "open" })),
};

function deferred() {
  let resolve;
  const promise = new Promise((yes) => (resolve = yes));
  return { promise, resolve };
}

async function until(condition) {
  for (let i = 0; i < 50 && !condition(); i++) await setImmediate();
  assert.ok(condition(), "expected query/observer transition did not complete");
}

// Execute the authored hooks/queryFns and auth identity fence with a real QueryClient and
// QueryObservers. Only the network and surrounding ring-progress dependencies are substituted.
function fixture(t) {
  let userId = null;
  let options = [];
  let respond = (request) => ({ data: payload(request.kind, request.userId), error: null });
  const requests = [];
  const client = new query.QueryClient({
    defaultOptions: { queries: { retry: network.shouldRetryRead, gcTime: Infinity } },
  });
  t.after(() => client.clear());

  function payload(kind, owner) {
    const value = owner === "owner-a" ? 17 : 2;
    if (kind === "recompute_streak")
      return { current: value, best: value, this_week: null, recent_weeks: [] };
    if (kind === "streak_weeks") return { train_target_workouts: value, eat_required_days: 5 };
    return [{ source_challenge_id: `${owner}-challenge`, settlement_state: "open" }];
  }

  function request(kind, args) {
    const entry = { kind, args, filters: [], signal: null, userId: null };
    let result;
    return {
      select() {
        return this;
      },
      eq(column, value) {
        entry.filters.push([column, value]);
        return this;
      },
      maybeSingle() {
        return this;
      },
      abortSignal(signal) {
        entry.signal = signal;
        return this;
      },
      then(resolve, reject) {
        if (!result) {
          entry.userId = userId;
          requests.push(entry);
          // Deliberately ignore AbortSignal at the transport layer: late responses must still
          // be unable to publish, even if the request already reached the server.
          result = Promise.resolve(respond(entry));
        }
        return result.then(resolve, reject);
      },
    };
  }

  const supabase = { rpc: request, from: request };
  const auth = presentationComponent("src/lib/auth.ts", {
    react: {},
    "@tanstack/react-query": query,
    "@/integrations/supabase/client": { supabase },
    "@/lib/browser-data": {},
    "@/lib/network-errors": network,
    "./in-app-back": { observeNavigationIdentity() {} },
  });
  const hooks = presentationComponent("src/lib/streak.ts", {
    "@tanstack/react-query": {
      ...query,
      useQuery(option) {
        options.push(option);
        return { data: undefined };
      },
    },
    "@/integrations/supabase/client": { supabase },
    "./auth": { ...auth, useAuth: () => ({ user: userId ? { id: userId } : null }) },
    "./store": { useBulkMeta: () => ({ bulkId: null }) },
    "./bulk-training-sessions": { useCompletedSessionDates: () => ({}) },
    "./bulk-progress-query": { useBulkProgressNutrition: () => ({}) },
    "./bulk-progress": {},
    "./challenge": {
      useMyChallenge: () => ({}),
      useWeekTargets: () => ({}),
      useTravelPauses: () => ({}),
      useActivitySummary: () => ({}),
    },
    "./streak-model": streakModel,
  });

  return {
    client,
    requests,
    auth,
    payload,
    setResponse(fn) {
      respond = fn;
    },
    observe(nextUserId) {
      userId = nextUserId;
      auth.observeAuthIdentity(nextUserId);
    },
    options(root) {
      options = [];
      hooks.useStreak();
      hooks.useThisWeekRingProgress(thisWeek);
      return options.find((option) => option.queryKey[0] === root);
    },
  };
}

test("streak hooks wait for session restoration and use distinct account keys for every query", (t) => {
  const f = fixture(t);
  for (const root of roots) assert.equal(f.options(root).enabled, false);
  f.observe("owner-a");
  const oldOptions = roots.map((root) => f.options(root));
  f.observe("owner-b");
  for (const [i, root] of roots.entries()) {
    const next = f.options(root);
    assert.equal(next.enabled, true);
    assert.notEqual(JSON.stringify(oldOptions[i].queryKey), JSON.stringify(next.queryKey));
  }
  f.observe(null);
  for (const root of roots) assert.equal(f.options(root).enabled, false);
  assert.equal(f.requests.length, 0);
});

for (const root of roots) {
  test(`${root}: B never sees A's cached data, including before asynchronous cleanup finishes`, async (t) => {
    const f = fixture(t);
    f.observe("owner-a");
    const old = f.options(root);
    const oldData = await f.client.fetchQuery(old);
    f.observe("owner-b");
    const next = f.options(root);
    const observer = new query.QueryObserver(f.client, next);
    assert.equal(observer.getCurrentResult().data, undefined);
    const seen = [];
    const unsubscribe = observer.subscribe((result) => seen.push(result.data));
    t.after(unsubscribe);

    await resetUserScopedQueries(f.client);
    await until(() => observer.getCurrentResult().isSuccess);

    assert.equal(f.client.getQueryData(old.queryKey), undefined);
    const newData = observer.getCurrentResult().data;
    assert.notDeepEqual(newData, oldData);
    for (const data of seen) if (data !== undefined) assert.deepEqual(data, newData);
  });

  test(`${root}: a still-active A observer is cleared and cannot refetch under B or after logout`, async (t) => {
    const f = fixture(t);
    f.observe("owner-a");
    const old = f.options(root);
    await f.client.fetchQuery(old);
    const observer = new query.QueryObserver(f.client, old);
    const unsubscribe = observer.subscribe(() => {});
    t.after(unsubscribe);
    const retainedQuery = f.client.getQueryCache().find({ queryKey: old.queryKey });

    for (const nextUserId of ["owner-b", null]) {
      f.observe(nextUserId);
      await resetUserScopedQueries(f.client);
      assert.equal(observer.getCurrentResult().data, undefined);
      assert.equal(f.client.getQueryData(old.queryKey), undefined);
      assert.equal(f.client.getQueryCache().find({ queryKey: old.queryKey }), retainedQuery);
      assert.equal(f.requests.length, 1, "old observer must not start another authenticated read");
    }
  });

  test(`${root}: cancelled in-flight A response cannot refill the cache after B loads`, async (t) => {
    const f = fixture(t);
    const late = deferred();
    f.observe("owner-a");
    f.setResponse((request) =>
      request.userId === "owner-a"
        ? late.promise
        : { data: f.payload(request.kind, request.userId), error: null },
    );
    const old = f.options(root);
    const pending = f.client.fetchQuery(old);
    const rejected = assert.rejects(pending, query.isCancelledError);
    await until(() => f.requests.length === 1);
    f.observe("owner-b");
    await resetUserScopedQueries(f.client);
    assert.equal(f.requests[0].signal?.aborted, true);
    const next = f.options(root);
    const nextData = await f.client.fetchQuery(next);
    late.resolve({ data: f.payload(f.requests[0].kind, "owner-a"), error: null });
    await rejected;
    await setImmediate();
    assert.equal(f.client.getQueryData(old.queryKey), undefined);
    assert.deepEqual(f.client.getQueryData(next.queryKey), nextData);
  });

  test(`${root}: identity fence rejects a late response even before cache cleanup`, async (t) => {
    const f = fixture(t);
    const late = deferred();
    f.observe("owner-a");
    f.setResponse(() => late.promise);
    // Invoke the real queryFn directly so this verifies its fence independently of
    // QueryClient's cancellation and even if transport cancellation is ignored.
    const pending = f.options(root).queryFn({ signal: new AbortController().signal });
    const rejected = assert.rejects(pending, query.isCancelledError);
    await until(() => f.requests.length === 1);
    f.observe("owner-b");
    late.resolve({ data: f.payload(f.requests[0].kind, "owner-a"), error: null });
    await rejected;
  });

  test(`${root}: an active observer can switch accounts while A's response is still pending`, async (t) => {
    const f = fixture(t);
    const late = deferred();
    f.observe("owner-a");
    f.setResponse((request) =>
      request.userId === "owner-a"
        ? late.promise
        : { data: f.payload(request.kind, request.userId), error: null },
    );
    const old = f.options(root);
    const observer = new query.QueryObserver(f.client, old);
    const seen = [];
    const unsubscribe = observer.subscribe((result) => seen.push(result.data));
    t.after(unsubscribe);
    await until(() => f.requests.length === 1);

    f.observe("owner-b");
    const cleanup = resetUserScopedQueries(f.client);
    observer.setOptions(f.options(root));
    assert.equal(observer.getCurrentResult().data, undefined);
    await cleanup;
    await until(() => observer.getCurrentResult().isSuccess);
    const nextData = observer.getCurrentResult().data;
    late.resolve({ data: f.payload(f.requests[0].kind, "owner-a"), error: null });
    await setImmediate();

    assert.equal(f.client.getQueryData(old.queryKey), undefined);
    assert.deepEqual(observer.getCurrentResult().data, nextData);
    for (const data of seen) if (data !== undefined) assert.deepEqual(data, nextData);
    assert.equal(f.requests.filter((request) => request.userId === "owner-a").length, 1);
  });
}

test("frozen targets and run legs retain week filtering and explicitly filter the expected owner", async (t) => {
  const f = fixture(t);
  f.observe("owner-a");
  for (const root of roots) await f.client.fetchQuery(f.options(root));
  const [headline, ...reads] = f.requests;
  assert.equal(headline.kind, "recompute_streak");
  assert.equal(headline.args._timezone, Intl.DateTimeFormat().resolvedOptions().timeZone);
  for (const read of reads) {
    assert.deepEqual(read.filters, [
      ["user_id", "owner-a"],
      ["week_start", weekStart],
    ]);
    assert.ok(read.signal instanceof AbortSignal);
  }
});

test("cold restoration and same-user refresh preserve cached and in-flight streak work", async (t) => {
  const f = fixture(t);
  assert.equal(authenticatedUserChanged(undefined, "owner-a"), false);
  f.observe("owner-a");
  const revision = f.auth.captureAuthIdentity();
  await f.client.fetchQuery(f.options("streak"));
  const late = deferred();
  f.setResponse(() => late.promise);
  const pending = f.client.fetchQuery(f.options("streak-frozen"));
  await until(() => f.requests.length === 2);

  // The unchanged root listener only resets on actual identity changes.
  f.observe("owner-a");
  if (authenticatedUserChanged("owner-a", "owner-a")) await resetUserScopedQueries(f.client);
  assert.equal(f.auth.captureAuthIdentity(), revision);
  assert.equal(f.requests[1].signal.aborted, false);
  late.resolve({ data: f.payload("streak_weeks", "owner-a"), error: null });
  assert.equal((await pending).trainTarget, 17);
  assert.equal((await f.client.fetchQuery(f.options("streak"))).current, 17);
  assert.equal(f.requests.length, 2, "fresh cached headline is reused after token refresh");
});
