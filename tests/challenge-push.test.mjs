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
    frozen = [];
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
  };
}

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
  assert.equal(f.sent[0].url, "https://example.com/challenge");
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
    const f = fixture({ members: [], invitation: snapshot, name: "tempo_user" });
    assert.equal(await deliverEvent(e, f.store, f.provider), "sent");
    assert.deepEqual(f.sent[0].include_subscription_ids, [deviceB.subscription_id]);
    assert.equal(f.sent[0].idempotency_key, e.id);
    assert.match(f.sent[0].contents.en, /@tempo_user/);
    assert.equal(
      f.sent[0].url,
      kind === "challenge_invitation_received"
        ? "https://example.com/notifications"
        : `https://example.com/challenge?challenge=${challenge}`,
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
