import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
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
