import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import {
  isCommunityNotification,
  notificationBadgeCount,
  notificationMessage,
} from "../src/lib/account-notification-model.ts";
import { accountUI } from "./account-ui-fixture.mjs";
import { presentationComponent } from "./presentation-component-fixture.mjs";
import { QUERY_PAGE_SIZE, readAllByKey } from "../src/lib/query-pagination.ts";

const event = (event_type = "friend_request_received", extra = {}) => ({
  id: randomUUID(),
  recipient_user_id: randomUUID(),
  actor_user_id: randomUUID(),
  actor_username: "tempo_user",
  event_type,
  challenge_id: null,
  invitation_id: null,
  community_relationship_id: randomUUID(),
  community_request_id: randomUUID(),
  created_at: "2026-11-01T12:00:00Z",
  read_at: null,
  invitation_expires_at: "",
  invitation_pending: false,
  ...extra,
});
const clean = (value) => JSON.parse(JSON.stringify(value));
function inbox(rows) {
  const calls = [];
  const query = { data: rows, isLoading: false, isError: false };
  const ui = accountUI("src/components/AccountNotificationInbox.tsx", "AccountNotificationInbox", {
    "./ChallengeInvitations": { ChallengeInvitations: "ChallengeInvitations" },
    "@/lib/account-notifications": {
      useNotificationInbox: () => ({
        events: query,
        invitations: { data: [], isLoading: false, isError: false },
      }),
    },
    "@/lib/account-notification-model": { notificationMessage, isCommunityNotification },
    "@/integrations/supabase/client": {
      supabase: {
        rpc: async (name, args) => {
          calls.push(["rpc", name, clean(args)]);
          return { data: true, error: null };
        },
      },
    },
    "@tanstack/react-query": {
      useQueryClient: () => ({
        invalidateQueries: async ({ queryKey }) => {
          calls.push(["invalidate", clean(queryKey)]);
          query.data = query.data.map((e) => ({ ...e, read_at: "read" }));
        },
      }),
    },
    "@tanstack/react-router": {
      useNavigate: () => async (options) => calls.push(["navigate", clean(options)]),
    },
  });
  return { ui, calls, query };
}
for (const [kind, copy] of [
  ["friend_request_received", "@tempo_user sent you a friend request"],
  ["friend_request_accepted", "@tempo_user accepted your friend request"],
]) {
  test(
    kind + " has concise public-handle copy and opens the actor's Community profile",
    async () => {
      const row = event(kind),
        f = inbox([row]);
      assert.match(f.ui.text(), new RegExp(copy));
      assert.doesNotMatch(f.ui.text(), /Open Challenge|invitation is no longer/);
      f.ui.button("Open profile").props.onClick();
      await f.ui.flush();
      assert.deepEqual(f.calls, [
        ["rpc", "mark_account_notification_read", { _notification: row.id }],
        ["invalidate", ["account-notifications"]],
        ["navigate", { to: "/community/$userId", params: { userId: row.actor_user_id } }],
      ]);
      assert.equal(notificationBadgeCount(f.query.data, []), 0);
      assert.ok(
        notificationMessage(event(kind, { actor_username: "private@example.test" })).startsWith(
          "A Tempo user",
        ),
      );
    },
  );
}
test("generic unread count includes friend events once, respects transactional read state, keeps Challenge actionable semantics", () => {
  const received = event(),
    accepted = event("friend_request_accepted"),
    challenge = event("challenge_invitation_received", {
      invitation_id: "invitation",
      challenge_id: "challenge",
      community_relationship_id: null,
      community_request_id: null,
    });
  const invitations = [{ invitation_id: "invitation" }];
  assert.equal(notificationBadgeCount([received, received, accepted, challenge], invitations), 3);
  assert.equal(
    notificationBadgeCount(
      [{ ...received, read_at: "resolved" }, accepted, challenge],
      invitations,
    ),
    2,
  );
  assert.equal(
    notificationBadgeCount(
      [{ ...received, read_at: "resolved" }, { ...accepted, read_at: "read" }, challenge],
      invitations,
    ),
    1,
  );
});
test("already-read friend event opens without an unnecessary read write", async () => {
  const row = event("friend_request_accepted", { read_at: "read" }),
    f = inbox([row]);
  f.ui.button("Open profile").props.onClick();
  await f.ui.flush();
  assert.deepEqual(f.calls, [
    ["navigate", { to: "/community/$userId", params: { userId: row.actor_user_id } }],
  ]);
});
test("server listing returns nullable contexts and safe actor snapshots, remains recipient-scoped and exhaustive", async () => {
  const caller = randomUUID();
  const rows = [
    { ...event(), id: "01", recipient_user_id: caller, challenge_invitations: null },
    {
      ...event("friend_request_accepted"),
      id: "02",
      recipient_user_id: caller,
      challenge_invitations: null,
    },
    {
      ...event("challenge_invitation_received"),
      id: "03",
      recipient_user_id: caller,
      challenge_id: randomUUID(),
      invitation_id: randomUUID(),
      community_relationship_id: null,
      community_request_id: null,
      challenge_invitations: {
        expires_at: "2099-01-01T00:00:00Z",
        accepted_at: null,
        revoked_at: null,
      },
    },
  ];
  const calls = [];
  const admin = {
    from(table) {
      const state = { table };
      const q = {
        select(fields) {
          state.fields = fields;
          return q;
        },
        eq(key, value) {
          state.filter = [key, value];
          return q;
        },
        order(key) {
          state.order = key;
          return q;
        },
        limit(value) {
          state.limit = value;
          return q;
        },
        gt(key, value) {
          state.cursor = value;
          return q;
        },
        then(resolve) {
          calls.push(state);
          return Promise.resolve({
            data: rows.filter((e) => !state.cursor || e.id > state.cursor).slice(0, 1),
            error: null,
          }).then(resolve);
        },
      };
      return q;
    },
  };
  const server = presentationComponent("src/lib/privileged-rpcs.server.ts", {
    "@/integrations/supabase/client.server": { supabaseAdmin: admin },
    "./query-pagination": { QUERY_PAGE_SIZE, readAllByKey },
  });
  const data = await server.listAccountNotificationsFor(caller);
  assert.equal(data.length, 3);
  assert.equal(calls.length, 4);
  for (const q of calls) {
    assert.deepEqual(q.filter, ["recipient_user_id", caller]);
    assert.match(q.fields, /community_relationship_id,community_request_id/);
    assert.doesNotMatch(q.fields, /email|display_name|avatar|fitness|token|dedupe_key|\*/);
  }
  for (const row of data.filter(isCommunityNotification)) {
    assert.equal(row.challenge_id, null);
    assert.equal(row.invitation_id, null);
    assert.ok(row.community_relationship_id);
    assert.ok(row.community_request_id);
    assert.equal(row.invitation_pending, false);
    assert.equal(row.invitation_expires_at, "");
  }
  assert.equal(
    data.find((e) => e.event_type === "challenge_invitation_received").invitation_pending,
    true,
  );
});
test("Community events remain in-app only; the nav has no separate notification indicator", () => {
  const migration = readFileSync(
    new URL(
      "../supabase/migrations/20261024120000_community_account_notifications.sql",
      import.meta.url,
    ),
    "utf8",
  );
  assert.doesNotMatch(
    migration,
    /challenge_notification_events\s*\(|OneSignal|CREATE POLICY|GRANT.*INSERT/,
  );
  assert.doesNotMatch(
    readFileSync(new URL("../src/components/AppShell.tsx", import.meta.url), "utf8"),
    /CommunityBadge|community-request-count/,
  );
});

test("generated schema has one declaration per Community object and preserves nullable lifecycle/computed column contracts", () => {
  const types = readFileSync(
    new URL("../src/integrations/supabase/types.ts", import.meta.url),
    "utf8",
  );
  for (const key of [
    "community_relationships",
    "community_blocks",
    "send_community_friend_request",
    "accept_community_friend_request",
    "decline_community_friend_request",
    "cancel_community_friend_request",
    "remove_community_friend",
    "block_community_user",
    "unblock_community_user",
    "get_community_profile",
    "search_community_people",
    "list_community_people",
    "community_incoming_count",
  ])
    assert.equal([...types.matchAll(new RegExp("^      " + key + ":", "gm"))].length, 1, key);
  assert.match(types, /pair_low\?: never/);
  assert.match(types, /get_community_profile:[\s\S]*?request_id: string \| null/);
  assert.match(types, /search_community_people:[\s\S]*?request_id: string \| null/);
});
