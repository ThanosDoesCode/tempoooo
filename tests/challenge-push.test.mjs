import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { presentationComponent } from "./presentation-component-fixture.mjs";
import * as pushModule from "../supabase/functions/_shared/challenge-push.ts";
import {
  authorizedDispatcher,
  deliverEvent,
  notificationText,
  OneSignal,
} from "../supabase/functions/_shared/challenge-push.ts";

const a = randomUUID(),
  b = randomUUID(),
  c = randomUUID(),
  challenge = randomUUID();
const memberA = { id: randomUUID(), user_id: a, challenge_id: challenge };
const memberB = { id: randomUUID(), user_id: b, challenge_id: challenge };
const deviceA = { user_id: a, subscription_id: randomUUID(), is_active: true };
const deviceB = { user_id: b, subscription_id: randomUUID(), is_active: true };
function event(overrides = {}) {
  return {
    id: randomUUID(),
    challenge_id: challenge,
    actor_id: a,
    actor_membership_id: memberA.id,
    opponent_membership_id: memberB.id,
    kind: "activity_posted",
    facts: { activity_type: "run", distance_km: 7.4, total_km: 12.4, target_km: 15 },
    attempts: 1,
    lease_token: randomUUID(),
    subscription_ids: null,
    ...overrides,
  };
}
function fixture(overrides = {}, options = {}) {
  let reads = 0;
  const sent = [],
    finished = [],
    frozen = [],
    preferences = [];
  const audience = {
    members: [memberA, memberB],
    user: { user_id: b, external_id: "private-capability", enabled: true },
    devices: [deviceB],
    name: "Alex Smith",
    ...overrides,
  };
  const store = {
    async audience() {
      reads++;
      return reads > 1 && options.fresh ? options.fresh(audience) : audience;
    },
    async freezeDevices(_event, ids) {
      frozen.push(ids);
    },
    async preferenceEnabled(userId, category) {
      preferences.push([userId, category]);
      return options.preference ? options.preference(category) : true;
    },
    async finish(_event, status, code, messageId) {
      finished.push({ status, code, messageId });
    },
  };
  const request = async (url, init) => {
    if (url.includes("/users/by/"))
      return Response.json({
        identity: { external_id: audience.user?.external_id },
        subscriptions: (options.verified ?? audience.devices.map((d) => d.subscription_id)).map(
          (id) => ({ id, type: "ChromePush", enabled: true }),
        ),
      });
    sent.push(JSON.parse(init.body));
    if (options.fail) return new Response("private provider details", { status: options.fail });
    return Response.json({ id: options.empty ? "" : randomUUID() });
  };
  return {
    store,
    provider: new OneSignal(randomUUID(), "server-only-key", "https://example.com", request),
    sent,
    finished,
    frozen,
    preferences,
  };
}

for (const [kind, category] of [
  ["week_penalty", "week_penalties"],
  ["payment_paid", "payments"],
]) {
  test(`${kind} honors only the recipient's ${category} preference`, async () => {
    const payload = event({
      kind,
      facts: { amount_eur: 10, evidence_path: "private/receipt.png", note: "private note" },
    });
    for (const enabled of [true, false]) {
      const f = fixture({}, { preference: (key) => key === category && enabled });
      assert.equal(await deliverEvent(payload, f.store, f.provider), enabled ? "sent" : "skipped");
      assert.deepEqual(f.preferences, [[b, category]]);
      assert.equal(f.sent.length, Number(enabled));
      assert.doesNotMatch(JSON.stringify(f.sent), /receipt\.png|private note|evidence_path/);
      if (!enabled) assert.equal(f.finished[0].code, "category_disabled");
    }
  });

  test(`${kind} stays off when the Challenge master is off`, async () => {
    const f = fixture({ user: { user_id: b, external_id: "private", enabled: false } });
    assert.equal(await deliverEvent(event({ kind }), f.store, f.provider), "skipped");
    assert.deepEqual(f.preferences, []);
    assert.deepEqual(f.sent, []);
  });
}

test("delivery rechecks category on each retry and never sends on a preference read error", async () => {
  let enabled = true;
  const f = fixture({}, { fail: 503, preference: () => enabled });
  const payment = event({ kind: "payment_paid", facts: { amount_eur: 15 } });
  assert.equal(await deliverEvent(payment, f.store, f.provider), "pending");
  enabled = false;
  assert.equal(await deliverEvent({ ...payment, attempts: 2 }, f.store, f.provider), "skipped");
  assert.deepEqual(f.preferences, [
    [b, "payments"],
    [b, "payments"],
  ]);
  assert.equal(f.sent.length, 1);

  const unavailable = fixture(
    {},
    {
      preference: () => {
        throw new Error("database_failed");
      },
    },
  );
  assert.equal(await deliverEvent(payment, unavailable.store, unavailable.provider), "pending");
  assert.equal(unavailable.sent.length, 0);
});

test("opponent activity and target milestones never consult category preferences", async () => {
  const f = fixture({}, { preference: () => false });
  assert.equal(await deliverEvent(event(), f.store, f.provider), "sent");
  assert.equal(await deliverEvent(event({ kind: "target_reached" }), f.store, f.provider), "sent");
  assert.deepEqual(f.preferences, []);
});

test("A's activity targets only B with a minimal payload", async () => {
  const f = fixture();
  const e = event();
  assert.equal(await deliverEvent(e, f.store, f.provider), "sent");
  assert.deepEqual(f.sent[0].include_subscription_ids, [deviceB.subscription_id]);
  assert.equal(
    f.sent[0].contents.en,
    "Alex logged a 7.4 km run and is now at 12.4 / 15 km this week.",
  );
  assert.equal(f.sent[0].idempotency_key, e.id);
  assert.equal(f.sent[0].data, undefined);
  assert.equal(f.sent[0].include_aliases, undefined);
  assert.equal(f.sent[0].included_segments, undefined);
  // Explicitly marked, so it is never mistaken for the legacy bare "/challenge" start_url.
  assert.equal(f.sent[0].url, "https://example.com/challenge?from=notification");
});
test("B's activity targets only A", async () => {
  const f = fixture({
    user: { user_id: a, external_id: "other-private-capability", enabled: true },
    devices: [deviceA],
  });
  await deliverEvent(
    event({ actor_id: b, actor_membership_id: memberB.id, opponent_membership_id: memberA.id }),
    f.store,
    f.provider,
  );
  assert.deepEqual(f.sent[0].include_subscription_ids, [deviceA.subscription_id]);
});
for (const [name, change] of Object.entries({
  "third party actor": { actor_id: c },
  "different challenge": { challenge_id: randomUUID() },
  "revoked and rejoined actor": { actor_membership_id: randomUUID() },
  "revoked and replaced opponent": { opponent_membership_id: randomUUID() },
}))
  test(name + " never sends", async () => {
    const f = fixture();
    assert.equal(await deliverEvent(event(change), f.store, f.provider), "skipped");
    assert.equal(f.sent.length, 0);
  });
for (const [name, audience] of Object.entries({
  "account disabled": { user: { user_id: b, external_id: "private", enabled: false } },
  "device disabled": { devices: [{ ...deviceB, is_active: false }] },
  "wrong device owner": { devices: [deviceA] },
  "wrong identity owner": { user: { user_id: c, external_id: "private", enabled: true } },
  "revoked recipient": { members: [memberA] },
  "oversized challenge": {
    members: [memberA, memberB, { ...memberB, id: randomUUID(), user_id: c }],
  },
}))
  test(name + " never sends", async () => {
    const f = fixture(audience);
    await deliverEvent(event(), f.store, f.provider);
    assert.equal(f.sent.length, 0);
  });
test("device moved to another OneSignal identity is excluded", async () => {
  const f = fixture({}, { verified: [] });
  await deliverEvent(event(), f.store, f.provider);
  assert.equal(f.sent.length, 0);
});
test("membership and opt-out are checked again after provider verification", async () => {
  for (const fresh of [
    (value) => ({ ...value, members: [memberA] }),
    (value) => ({ ...value, devices: [] }),
  ]) {
    const f = fixture({}, { fresh });
    await deliverEvent(event(), f.store, f.provider);
    assert.equal(f.sent.length, 0);
  }
});
test("retries reuse the event key and original devices; no new devices receive old events", async () => {
  const e = event({ subscription_ids: [deviceB.subscription_id] });
  const f = fixture(
    { devices: [deviceB, { ...deviceB, subscription_id: randomUUID() }] },
    { fail: 503 },
  );
  assert.equal(await deliverEvent(e, f.store, f.provider), "pending");
  await deliverEvent({ ...e, attempts: 2 }, f.store, f.provider);
  assert.equal(f.sent[0].idempotency_key, f.sent[1].idempotency_key);
  assert.deepEqual(f.sent[0].include_subscription_ids, [deviceB.subscription_id]);
  assert.equal(f.finished[0].code, "provider_http_503");
});
test("permanent provider failure is terminal; HTTP 200 without ID is not success", async () => {
  const denied = fixture({}, { fail: 403 });
  assert.equal(await deliverEvent(event(), denied.store, denied.provider), "failed");
  const empty = fixture({}, { empty: true });
  assert.equal(await deliverEvent(event(), empty.store, empty.provider), "skipped");
});
test("event-specific copy uses stored equivalent km and monetary amounts", () => {
  assert.equal(
    notificationText(
      event({ facts: { activity_type: "cycle", distance_km: 21, equivalent_km: 7 } }),
      "Sam",
    ).body,
    "Sam logged a 21 km ride, worth 7 equivalent km.",
  );
  assert.equal(
    notificationText(event({ kind: "target_reached", facts: { target_km: 15 } }), "Sam").body,
    "Sam reached 15 km for this week.",
  );
  assert.equal(
    notificationText(event({ kind: "week_penalty", facts: { amount_eur: 5 } }), "Sam").body,
    "Sam finished the week with a €5 penalty.",
  );
  assert.equal(
    notificationText(event({ kind: "payment_paid", facts: { amount_eur: 5 } }), "Sam").body,
    "Sam marked a €5 payment as paid.",
  );
});
test("worker rejects user bearer tokens and missing/wrong dispatch secrets", async () => {
  const secret = "x".repeat(64);
  assert.equal(
    await authorizedDispatcher(
      new Request("https://example.com", { headers: { Authorization: "Bearer user-token" } }),
      secret,
    ),
    false,
  );
  assert.equal(
    await authorizedDispatcher(
      new Request("https://example.com", { headers: { "x-challenge-push-secret": "wrong" } }),
      secret,
    ),
    false,
  );
  assert.equal(
    await authorizedDispatcher(
      new Request("https://example.com", { headers: { "x-challenge-push-secret": secret } }),
      secret,
    ),
    true,
  );
  assert.equal(await authorizedDispatcher(new Request("https://example.com"), ""), false);
});

function invitationEventFixture(kind = "challenge_invitation_accepted") {
  const id = randomUUID(),
    invitationId = randomUUID();
  const e = event({
    kind,
    facts: {},
    actor_membership_id: null,
    opponent_membership_id: null,
    account_notification_id: id,
    recipient_user_id: b,
  });
  const received = kind === "challenge_invitation_received";
  const timestamp = new Date().toISOString();
  const snapshot = {
    notification: {
      id,
      event_type: kind,
      actor_user_id: a,
      recipient_user_id: b,
      challenge_id: challenge,
      invitation_id: invitationId,
      created_at: timestamp,
      actor_username: "tempo_user",
    },
    invitation: {
      id: invitationId,
      challenge_id: challenge,
      created_by: received ? a : b,
      invited_user_id: received ? b : a,
      expires_at: new Date(Date.now() + 60_000).toISOString(),
      accepted_at: kind === "challenge_invitation_accepted" ? timestamp : null,
      revoked_at: kind === "challenge_invitation_declined" ? timestamp : null,
    },
  };
  return { e, snapshot };
}
for (const kind of [
  "challenge_invitation_received",
  "challenge_invitation_accepted",
  "challenge_invitation_declined",
]) {
  test(`${kind} validates stored relationship without requiring two Challenge members`, async () => {
    const { e, snapshot } = invitationEventFixture(kind);
    const f = fixture(
      { members: [], invitation: snapshot, name: "tempo_user" },
      { preference: () => false },
    );
    assert.equal(await deliverEvent(e, f.store, f.provider), "sent");
    assert.deepEqual(f.preferences, []);
    assert.deepEqual(f.sent[0].include_subscription_ids, [deviceB.subscription_id]);
    assert.equal(f.sent[0].idempotency_key, e.id);
    assert.match(f.sent[0].contents.en, /@tempo_user/);
    assert.equal(
      f.sent[0].url,
      kind === "challenge_invitation_received"
        ? "https://example.com/notifications?from=notification"
        : `https://example.com/challenge?challenge=${challenge}&from=notification`,
    );
  });
}

test("invitation pushes reject forged actor, recipient, event, outcome and Challenge context", async () => {
  const { e, snapshot } = invitationEventFixture();
  for (const corrupt of [
    { actor_id: c },
    { recipient_user_id: c },
    { account_notification_id: randomUUID() },
    { challenge_id: randomUUID() },
    { kind: "challenge_invitation_declined" },
    { actor_membership_id: memberA.id },
  ]) {
    const f = fixture({ members: [memberA, memberB], invitation: snapshot });
    assert.equal(await deliverEvent({ ...e, ...corrupt }, f.store, f.provider), "skipped");
    assert.equal(f.sent.length, 0);
  }
  for (const corrupt of [
    { created_by: c },
    { invited_user_id: c },
    { accepted_at: null },
    { challenge_id: randomUUID() },
  ]) {
    const f = fixture({
      invitation: { ...snapshot, invitation: { ...snapshot.invitation, ...corrupt } },
    });
    assert.equal(await deliverEvent(e, f.store, f.provider), "skipped");
    assert.equal(f.sent.length, 0);
  }
});

test("invitation pushes obey account/device opt-out and provider ownership", async () => {
  const { e, snapshot } = invitationEventFixture();
  for (const change of [
    { user: { user_id: b, external_id: "private", enabled: false } },
    { devices: [{ ...deviceB, is_active: false }] },
    { devices: [deviceA] },
    { user: { user_id: c, external_id: "private", enabled: true } },
    { invitation: null },
  ]) {
    const f = fixture({ invitation: snapshot, ...change });
    assert.equal(await deliverEvent(e, f.store, f.provider), "skipped");
    assert.equal(f.sent.length, 0);
  }
  const f = fixture({ invitation: snapshot }, { verified: [] });
  assert.equal(await deliverEvent(e, f.store, f.provider), "skipped");
});

test("expired or withdrawn incoming invitations are not pushed; valid historical responses may deliver", async () => {
  const { e, snapshot } = invitationEventFixture("challenge_invitation_received");
  for (const change of [
    { expires_at: new Date(Date.now() - 1000).toISOString() },
    { revoked_at: new Date().toISOString() },
    { accepted_at: new Date().toISOString() },
  ]) {
    const f = fixture({
      invitation: { ...snapshot, invitation: { ...snapshot.invitation, ...change } },
    });
    assert.equal(await deliverEvent(e, f.store, f.provider), "skipped");
  }
  const declined = invitationEventFixture("challenge_invitation_declined");
  declined.snapshot.notification.created_at = new Date(Date.now() - 10_000).toISOString();
  declined.snapshot.invitation.revoked_at = declined.snapshot.notification.created_at;
  declined.snapshot.invitation.expires_at = new Date(Date.now() - 1000).toISOString();
  const f = fixture({ invitation: declined.snapshot });
  assert.equal(await deliverEvent(declined.e, f.store, f.provider), "sent");
  declined.snapshot.notification.created_at = new Date().toISOString();
  const invalid = fixture({ invitation: declined.snapshot });
  assert.equal(await deliverEvent(declined.e, invalid.store, invalid.provider), "skipped");
});

test("invitation audience is revalidated just before send and retries reuse the frozen recipient", async () => {
  const { e, snapshot } = invitationEventFixture();
  const f = fixture(
    { invitation: snapshot },
    { fresh: (value) => ({ ...value, user: { ...value.user, enabled: false } }) },
  );
  assert.equal(await deliverEvent(e, f.store, f.provider), "skipped");
  assert.equal(f.sent.length, 0);
  const retry = fixture({ invitation: snapshot }, { fail: 503 });
  assert.equal(await deliverEvent(e, retry.store, retry.provider), "pending");
  assert.deepEqual(retry.frozen[0], [deviceB.subscription_id]);
  assert.equal(retry.sent[0].idempotency_key, e.id);
});

function persistedPushStore(e, snapshot) {
  const calls = [];
  const tables = {
    account_notification_events: [snapshot.notification],
    challenge_invitations: [snapshot.invitation],
    challenge_push_users: [{ user_id: b, external_id: "private", enabled: true }],
    push_subscriptions: [{ ...deviceB, provider: "onesignal" }],
  };
  const db = {
    from(table) {
      const filters = [],
        builder = {
          select(fields) {
            calls.push([table, fields, filters]);
            return builder;
          },
          eq(key, value) {
            filters.push([key, value]);
            return builder;
          },
          async maybeSingle() {
            return {
              data:
                (tables[table] ?? []).find((row) =>
                  filters.every(([key, value]) => row[key] === value),
                ) ?? null,
              error: null,
            };
          },
          then(resolve) {
            return Promise.resolve({
              data: (tables[table] ?? []).filter((row) =>
                filters.every(([key, value]) => row[key] === value),
              ),
              error: null,
            }).then(resolve);
          },
        };
      return builder;
    },
  };
  const { databaseStore } = presentationComponent("supabase/functions/_shared/push-store.ts", {
    "npm:@supabase/supabase-js@2.112.3": { createClient() {} },
    "./challenge-push.ts": pushModule,
  });
  return { store: databaseStore(db), calls, tables };
}

test("real push store validates both persisted invitation/event before looking up recipient devices", async () => {
  const { e, snapshot } = invitationEventFixture();
  const f = persistedPushStore(e, snapshot);
  const audience = await f.store.audience(e);
  assert.equal(audience.user.user_id, b);
  assert.equal(audience.name, "tempo_user");
  assert.deepEqual([...audience.members], []);
  assert.ok(
    f.calls
      .filter(([table]) => table === "challenge_push_users" || table === "push_subscriptions")
      .every(([, , filters]) => filters.some(([key, value]) => key === "user_id" && value === b)),
  );
  assert.ok(f.calls.every(([, fields]) => !/token_hash|email/.test(fields)));
  assert.equal(
    f.calls.some(([table]) => table === "challenge_members"),
    false,
  );
});

test("real push store refuses a forged queue recipient before any private device lookup", async () => {
  const { e, snapshot } = invitationEventFixture();
  const f = persistedPushStore(e, snapshot);
  const audience = await f.store.audience({ ...e, recipient_user_id: c });
  assert.equal(audience.user, null);
  assert.deepEqual([...audience.devices], []);
  assert.ok(
    f.calls.every(([table]) => !["challenge_push_users", "push_subscriptions"].includes(table)),
  );
});

test("real push store defaults missing preferences on and selects only the recipient's row", async () => {
  const { e, snapshot } = invitationEventFixture();
  const f = persistedPushStore(e, snapshot);
  f.tables.account_notification_preferences = [
    { user_id: a, week_penalties: false, payments: false },
  ];
  assert.equal(await f.store.preferenceEnabled(b, "payments"), true);
  f.tables.account_notification_preferences.push({
    user_id: b,
    week_penalties: false,
    payments: true,
  });
  assert.equal(await f.store.preferenceEnabled(b, "week_penalties"), false);
  assert.equal(await f.store.preferenceEnabled(b, "payments"), true);
  assert.equal(f.calls.length, 3);
  for (const [table, columns, filter] of f.calls) {
    assert.equal(table, "account_notification_preferences");
    assert.equal(columns, "week_penalties,payments");
    assert.deepEqual(JSON.parse(JSON.stringify(filter)), [["user_id", b]]);
  }
});

function subscriptionEndpoint({
  member = true,
  verified = [deviceB.subscription_id],
  beforeVerification,
} = {}) {
  const writes = [];
  const lookups = [];
  let handler;
  const identity = "existing-provider-identity";
  let generation = randomUUID();
  let accountEnabled = false;
  let deviceActive = false;
  const db = {
    auth: { getUser: async () => ({ data: { user: { id: b } } }) },
    from(table) {
      return {
        select() {
          return this;
        },
        eq() {
          return this;
        },
        limit() {
          return { data: member ? [memberB] : [] };
        },
        single() {
          return {
            data: {
              external_id: identity,
              enabled: accountEnabled,
              registration_generation: generation,
            },
          };
        },
        maybeSingle() {
          return {
            data:
              table === "push_subscriptions" && deviceActive
                ? { user_id: b, is_active: true }
                : null,
          };
        },
        upsert() {
          return {};
        },
      };
    },
    async rpc(name, args) {
      writes.push([name, args]);
      if (name === "detach_challenge_push_device") {
        generation = randomUUID();
        deviceActive = false;
        return { data: null };
      }
      if (args._generation !== generation) return { data: "stale" };
      if (args._mode === "activate") accountEnabled = true;
      deviceActive = true;
      return { data: "registered" };
    },
  };
  presentationComponent(
    "supabase/functions/challenge-push-subscription/index.ts",
    {
      "../_shared/challenge-push.ts": pushModule,
      "../_shared/push-store.ts": {
        adminClient: () => db,
        oneSignal: () => ({
          subscriptions: async (externalId) => {
            lookups.push(externalId);
            await beforeVerification?.();
            return verified;
          },
        }),
      },
      "../_shared/observability.ts": {
        operationalLog() {},
        safeOperationalCode: () => "safe_code",
      },
    },
    {
      Deno: {
        env: { get: () => "https://tempo.test" },
        serve: (fn) => {
          handler = fn;
        },
      },
      Response,
    },
  );
  const send = (body) =>
    handler(
      new Request("https://edge.test", {
        method: "POST",
        headers: { authorization: "Bearer fixture-token" },
        body: JSON.stringify({ subscription_id: deviceB.subscription_id, ...body }),
      }),
    );
  const register = (expectedUser = b, expectedGeneration = generation) =>
    send({
      action: "register_device",
      expected_user: expectedUser,
      expected_generation: expectedGeneration,
      activate: true,
    });
  return {
    register,
    send,
    lookups,
    writes,
    identity,
    generation: () => generation,
    deviceActive: () => deviceActive,
    disable: () => {
      generation = randomUUID();
      deviceActive = false;
      accountEnabled = false;
    },
    accountEnabled: () => accountEnabled,
  };
}

test("device-only endpoint enforces session, membership and provider ownership and ignores an activation flag", async () => {
  const valid = subscriptionEndpoint();
  const response = await valid.register();
  assert.deepEqual(await response.json(), { registered: true });
  assert.deepEqual(valid.lookups, [valid.identity]);
  assert.deepEqual(JSON.parse(JSON.stringify(valid.writes)), [
    [
      "register_challenge_push_device_fenced",
      {
        _user: b,
        _subscription: deviceB.subscription_id,
        _external_id: valid.identity,
        _generation: valid.generation(),
        _observed_owner: null,
        _mode: "device",
      },
    ],
  ]);
  for (const [f, uid, status] of [
    [subscriptionEndpoint(), a, 403],
    [subscriptionEndpoint({ member: false }), b, 403],
    [subscriptionEndpoint({ verified: [deviceA.subscription_id] }), b, 409],
  ]) {
    assert.equal((await f.register(uid)).status, status);
    assert.deepEqual(f.writes, []);
    if (status === 403) assert.deepEqual(f.lookups, []);
  }
});

test("the Edge Function passes its original fence after a detach during provider verification", async () => {
  let release, started;
  const verified = new Promise((resolve) => {
    release = resolve;
  });
  const verifying = new Promise((resolve) => {
    started = resolve;
  });
  const f = subscriptionEndpoint({
    beforeVerification: () => {
      started();
      return verified;
    },
  });
  const original = f.generation();
  const pending = f.register();
  await verifying;
  assert.deepEqual(await (await f.send({ action: "detach" })).json(), { ok: true });
  release();
  assert.deepEqual(await (await pending).json(), {
    enabled: false,
    registered: false,
    stale: true,
  });
  assert.equal(f.writes[1][1]._generation, original);
  assert.equal(f.deviceActive(), false);
  assert.notEqual(f.generation(), original);
  const reads = f.lookups.length;
  assert.equal((await (await f.register(b, original)).json()).stale, true);
  assert.equal(f.lookups.length, reads);
  assert.deepEqual(await (await f.register()).json(), { registered: true });
});

for (const invalidate of ["disable", "detach"]) {
  test(`pre-V2 activation retries remain fail-closed after ${invalidate} without a client refresh`, async () => {
    const f = subscriptionEndpoint();
    // Model the pre-V2 request shape and retry loop, not the upgraded adapter.
    const legacy = () => f.send({ action: "register", activate: true });
    const first = await legacy();
    assert.equal(first.status, 200);
    assert.deepEqual(await first.json(), {
      enabled: false,
      registered: false,
      code: "notification_upgrade_required",
    });
    if (invalidate === "disable") f.disable();
    else await f.send({ action: "detach" });
    const writes = f.writes.length;
    for (let attempt = 0; attempt < 16; attempt++) {
      const response = await legacy();
      assert.equal(response.status, 200); // non-auth failure
      assert.equal((await response.json()).code, "notification_upgrade_required");
    }
    assert.equal(f.lookups.length, 0);
    assert.equal(f.writes.length, writes);
    assert.equal(f.accountEnabled(), false);
    assert.equal(f.deviceActive(), false);
    assert.equal((await f.send({ action: "identity" })).status, 200);
    assert.equal((await f.send({ action: "status" })).status, 200);
  });
}

test("V2 activation reuses a valid original precondition, rejects forged/stale ones and permits a new explicit Enable", async () => {
  const f = subscriptionEndpoint();
  const original = f.generation();
  const activate = (expected = original) =>
    f.send({ action: "register", activate: true, expected_user: b, expected_generation: expected });
  assert.deepEqual(await (await activate()).json(), { enabled: true });
  assert.deepEqual(await (await activate()).json(), { enabled: true });
  assert.equal(f.accountEnabled(), true);
  // A signed-in user's other device disables the account without signing this browser out.
  f.disable();
  const reads = f.lookups.length;
  for (const invalid of [original, randomUUID()]) {
    assert.equal((await (await activate(invalid)).json()).stale, true);
  }
  assert.equal(f.lookups.length, reads);
  assert.equal(f.accountEnabled(), false);
  assert.equal(f.deviceActive(), false);
  assert.deepEqual(await (await activate(f.generation())).json(), { enabled: true });
  // Legacy background traffic can read current status, but cannot reconnect a detached device.
  const status = await (await f.send({ action: "register", activate: false })).json();
  assert.equal(status.enabled, true);
  const writes = f.writes.length;
  await f.send({ action: "detach" });
  const off = await (await f.send({ action: "register", activate: false })).json();
  assert.equal(off.enabled, false);
  assert.equal(f.writes.length, writes + 1);
});
