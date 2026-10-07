import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import {
  notificationBadgeCount,
  notificationMessage,
} from "../src/lib/account-notification-model.ts";
import { accountUI } from "./account-ui-fixture.mjs";
import { presentationComponent } from "./presentation-component-fixture.mjs";
import { QUERY_PAGE_SIZE, readAllByKey } from "../src/lib/query-pagination.ts";

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const event = (type = "challenge_invitation_accepted", changes = {}) => ({
  id: randomUUID(),
  recipient_user_id: randomUUID(),
  actor_user_id: randomUUID(),
  actor_username: "tempo_user",
  event_type: type,
  challenge_id: randomUUID(),
  invitation_id: randomUUID(),
  created_at: new Date().toISOString(),
  read_at: null,
  invitation_expires_at: new Date(Date.now() + 60_000).toISOString(),
  invitation_pending: true,
  ...changes,
});

test("badge counts unread events plus actionable incoming invitations exactly once", () => {
  const received = event("challenge_invitation_received"),
    accepted = event(),
    declined = event("challenge_invitation_declined");
  const invitations = [{ invitation_id: received.invitation_id }];
  assert.equal(notificationBadgeCount([received, accepted, declined], invitations), 3);
  assert.equal(
    notificationBadgeCount(
      [received, received, accepted, accepted],
      [...invitations, ...invitations],
    ),
    2,
  );
  assert.equal(
    notificationBadgeCount(
      [
        { ...received, read_at: "read" },
        { ...accepted, read_at: "read" },
      ],
      invitations,
    ),
    1,
  );
  assert.equal(notificationBadgeCount([{ ...received, invitation_pending: false }], []), 1);
  assert.equal(
    notificationBadgeCount(
      [{ ...received, invitation_expires_at: new Date(Date.now() - 1000).toISOString() }],
      [],
    ),
    1,
  );
  assert.equal(notificationBadgeCount([], invitations), 1); // Existing invitations have no fabricated event.
});

for (const [type, expected] of [
  ["challenge_invitation_received", "@tempo_user invited you to a Challenge."],
  ["challenge_invitation_accepted", "@tempo_user accepted your challenge invitation."],
  ["challenge_invitation_declined", "@tempo_user declined your challenge invitation."],
]) {
  test(`inbox copy renders ${type} and never falls back to email`, () => {
    assert.equal(notificationMessage(event(type)), expected);
    assert.ok(
      notificationMessage(event(type, { actor_username: "private@example.com" })).startsWith(
        "A Tempo user",
      ),
    );
  });
}

function fixture({ rows = [event()], invitations = [], failure = false } = {}) {
  const calls = [];
  const events = { data: rows, isLoading: false, isError: false, refetch: async () => {} };
  const invitationQuery = { data: invitations, isLoading: false, isError: false };
  const ui = accountUI("src/components/AccountNotificationInbox.tsx", "AccountNotificationInbox", {
    "./ChallengeInvitations": { ChallengeInvitations: "ChallengeInvitations" },
    "@/lib/account-notifications": {
      useNotificationInbox: () => ({ events, invitations: invitationQuery }),
    },
    "@/lib/account-notification-model": { notificationMessage },
    "@/integrations/supabase/client": {
      supabase: {
        rpc: async (name, args) => {
          calls.push(["rpc", name, args]);
          return { data: !failure, error: failure ? new Error("denied") : null };
        },
      },
    },
    "@tanstack/react-query": {
      useQueryClient: () => ({
        invalidateQueries: async ({ queryKey }) => {
          calls.push(["invalidate", queryKey]);
          events.data = events.data.map((item) => ({ ...item, read_at: new Date().toISOString() }));
        },
      }),
    },
    "@tanstack/react-router": {
      useNavigate: () => async (options) => calls.push(["navigate", options]),
    },
  });
  return { ui, events, invitationQuery, calls };
}

test("inbox renders all event kinds without duplicating actionable invitation cards", () => {
  const incoming = event("challenge_invitation_received");
  const { ui } = fixture({
    rows: [incoming, event(), event("challenge_invitation_declined")],
    invitations: [{ invitation_id: incoming.invitation_id }],
  });
  assert.equal(ui.find("ChallengeInvitations").length, 1);
  assert.equal(ui.find("article").length, 2);
  assert.match(ui.text(), /accepted your challenge invitation/);
  assert.match(ui.text(), /declined your challenge invitation/);
  assert.equal(fixture({ rows: [incoming] }).ui.find("article").length, 1);
});

test("opening a response marks only its ID read and navigates to its stored Challenge context", async () => {
  const row = event(),
    f = fixture({ rows: [row] });
  f.ui.button("Open Challenge").props.onClick();
  await f.ui.flush();
  assert.deepEqual(JSON.parse(JSON.stringify(f.calls)), [
    ["rpc", "mark_account_notification_read", { _notification: row.id }],
    ["invalidate", ["account-notifications"]],
    ["navigate", { to: "/challenge", search: { challenge: row.challenge_id } }],
  ]);
  assert.equal(
    f.ui.find("button").filter((node) => f.ui.text(node).includes("Mark as read")).length,
    0,
  );
});

test("read receipt failure remains local; empty and retry states do not alter session or navigate", async () => {
  const f = fixture({ failure: true });
  f.ui.button("Mark as read").props.onClick();
  await f.ui.flush();
  assert.match(f.ui.text(), /Could not update this notification/);
  assert.equal(f.calls.filter(([name]) => name === "navigate").length, 0);
  assert.match(fixture({ rows: [] }).ui.text(), /You're all caught up/);
  f.events.isError = true;
  assert.ok(f.ui.button("Retry notifications"));
});

test("server functions ignore forged client actor/recipient and use authenticated context", async () => {
  const caller = randomUUID(),
    other = randomUUID(),
    invitation = randomUUID();
  const calls = [],
    guard = {};
  const server = {
    acceptChallengeInvitationByIdFor: async (...args) => calls.push(["accept", ...args]),
    declineChallengeInvitationFor: async (...args) => calls.push(["decline", ...args]),
    listAccountNotificationsFor: async (...args) => calls.push(["list", ...args]),
  };
  const exports = presentationComponent("src/lib/privileged-rpcs.functions.ts", {
    "@/integrations/supabase/auth-middleware": { requireSupabaseAuth: guard },
    "./privileged-rpcs.server": server,
    "@tanstack/react-start": {
      createServerFn: () => {
        let validate = (value) => value,
          middleware;
        const builder = {
          middleware(value) {
            middleware = value;
            return builder;
          },
          inputValidator(value) {
            validate = value;
            return builder;
          },
          handler(fn) {
            return async (input) => {
              assert.equal(middleware.length, 1);
              assert.equal(middleware[0], guard);
              return fn({ data: validate(input?.data), context: { userId: caller } });
            };
          },
        };
        return builder;
      },
    },
  });
  for (const name of ["acceptChallengeInvitationById", "declineChallengeInvitation"]) {
    await exports[name]({
      data: {
        invitationId: invitation,
        caller: other,
        actor: other,
        recipient: other,
        username: "forged",
      },
    });
  }
  await exports.listAccountNotifications({ data: { userId: other } });
  assert.deepEqual(calls, [
    ["accept", caller, invitation],
    ["decline", caller, invitation],
    ["list", caller],
  ]);
});

test("notification listing drains capped pages with recipient scoping and only safe event fields", async () => {
  const caller = randomUUID(),
    rows = Array.from({ length: 3 }, (_, i) => ({
      ...event(),
      id: `id-${i}`,
      recipient_user_id: caller,
      challenge_invitations: {
        expires_at: new Date(Date.now() + 1000).toISOString(),
        accepted_at: null,
        revoked_at: null,
      },
    }));
  const calls = [];
  const admin = {
    from(table) {
      const state = { table };
      const builder = {
        select(fields) {
          state.fields = fields;
          return builder;
        },
        eq(field, value) {
          state.filter = [field, value];
          return builder;
        },
        order(field, value) {
          state.order = [field, value];
          return builder;
        },
        limit(value) {
          state.limit = value;
          return builder;
        },
        gt(field, value) {
          state.cursor = [field, value];
          return builder;
        },
        then(resolve) {
          calls.push(state);
          return Promise.resolve({
            data: rows.filter((row) => !state.cursor || row.id > state.cursor[1]).slice(0, 1),
            error: null,
          }).then(resolve);
        },
      };
      return builder;
    },
  };
  const server = presentationComponent("src/lib/privileged-rpcs.server.ts", {
    "@/integrations/supabase/client.server": { supabaseAdmin: admin },
    "./query-pagination": { QUERY_PAGE_SIZE, readAllByKey },
  });
  const result = await server.listAccountNotificationsFor(caller);
  assert.equal(result.length, 3);
  assert.equal(calls.length, 4);
  assert.ok(
    calls.every(
      (q) =>
        q.table === "account_notification_events" &&
        q.filter[0] === "recipient_user_id" &&
        q.filter[1] === caller &&
        q.limit === 200 &&
        q.order[0] === "id",
    ),
  );
  assert.ok(calls.every((q) => !/token_hash|email|dedupe_key|select\(\*\)/.test(q.fields)));
  assert.ok(result.every((row) => row.invitation_pending && !row.challenge_invitations));
});

test("notification cache is account-specific and cleared on logout/account switching", () => {
  const { accountNotificationsQueryOptions } = presentationComponent(
    "src/lib/account-notifications.ts",
    {
      "./auth": {},
      "./challenge-invitations": {},
      "./network-errors": { readRetryDelay: () => 0, shouldRetryRead: () => false },
      "./privileged-rpcs.functions": { listAccountNotifications: async () => [] },
      "./account-notification-model": { notificationBadgeCount },
    },
  );
  assert.deepEqual(
    [...accountNotificationsQueryOptions("user-a").queryKey],
    ["account-notifications", "user-a"],
  );
  assert.notDeepEqual(
    accountNotificationsQueryOptions("user-a").queryKey,
    accountNotificationsQueryOptions("user-b").queryKey,
  );
  assert.equal(accountNotificationsQueryOptions(undefined).enabled, false);
  assert.match(read("src/lib/query-cancellation.ts"), /"account-notifications"/);
});

test("notification Challenge deep link remains member-scoped and leaves default routing unchanged", () => {
  const source = read("src/lib/challenge.ts");
  assert.match(source, /challengeId \? \["challenge", challengeId\] : \["challenge"\]/);
  assert.match(source, /\.eq\("user_id", uid\)/);
  assert.match(source, /if \(challengeId\) query = query\.eq\("challenge_id", challengeId\)/);
  assert.match(read("src/routes/_authenticated/challenge/index.tsx"), /Route\.useSearch\(\)/);
});
