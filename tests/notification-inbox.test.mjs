import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { queryOptions } from "@tanstack/react-query";
import { accountUI, deferred } from "./account-ui-fixture.mjs";
import { presentationComponent } from "./presentation-component-fixture.mjs";

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const plain = (value) => JSON.parse(JSON.stringify(value));
const invitation = {
  invitation_id: "invite",
  challenge_id: "challenge",
  challenge_name: "12-week challenge",
  inviter_username: "tempo_test_acc",
  weekly_target_km: 15,
  duration_weeks: 12,
  start_date: "2026-10-12",
  expires_at: "2026-10-18T12:00:00Z",
  timezone: "Europe/Stockholm",
  penalty_mode: "money",
  penalty_low_eur: 5,
  penalty_medium_eur: 10,
  penalty_high_eur: 15,
  penalty_low_custom: null,
  penalty_medium_custom: null,
  penalty_high_custom: null,
  legacy_photo_owed: false,
  travel_pause_enabled: true,
  travel_pause_home_countries: ["SE"],
};

function inboxFixture({ fail = false, pending = null } = {}) {
  const query = { data: [invitation], isLoading: false, isError: false, refetch: async () => {} };
  const calls = [];
  const ui = accountUI(
    "src/components/ChallengeInvitations.tsx",
    "ChallengeInvitations",
    {
      "@/lib/challenge-invitations": { useChallengeInvitations: () => query },
      "@/components/ChallengeInvitationDetails": {
        ChallengeInvitationDetails: "InvitationDetails",
      },
      "@tanstack/react-query": {
        useQueryClient: () => ({
          invalidateQueries: async ({ queryKey }) => {
            calls.push(["invalidate", queryKey]);
            if (queryKey[0] === "challenge-invitations") query.data = [];
          },
        }),
      },
      "@tanstack/react-router": { useNavigate: () => async (to) => calls.push(["navigate", to]) },
      "@/lib/privileged-rpcs.functions": {
        acceptChallengeInvitationById: async (args) => {
          calls.push(["accept", args]);
          await pending;
          if (fail) throw new Error("expired");
        },
        declineChallengeInvitation: async (args) => {
          calls.push(["decline", args]);
          if (fail) throw new Error("network");
        },
      },
    },
    { inbox: true },
  );
  return { ui, query, calls };
}

function bellFixture(pathname, query) {
  return accountUI("src/components/NotificationBell.tsx", "NotificationBell", {
    "@tanstack/react-router": { Link: "Link", useLocation: () => ({ pathname }) },
    "@/lib/account-notifications": {
      useNotificationInbox: () => ({ badgeCount: query.data?.length ?? 0 }),
    },
  });
}

for (const path of ["/bulk", "/challenge", "/bulk/progress", "/profile"]) {
  test(`global bell on ${path} opens inbox with a 44px target and accessible count`, () => {
    const ui = bellFixture(path, { data: [invitation] });
    const bell = ui.find("Link")[0];
    assert.equal(bell.props.to, "/notifications");
    assert.equal(bell.props.preload, "intent");
    assert.equal(bell.props["aria-label"], "Notifications, 1 unread");
    assert.match(bell.props.className, /h-11 w-11 shrink-0/);
    assert.match(bell.props.className, /focus-visible:ring-2/);
    const badge = ui.find("span")[0];
    assert.equal(badge.props["aria-hidden"], "true");
    assert.match(badge.props.className, /bg-danger/);
  });
}

test("bell is absent on focus/subscreens and notification settings, with no duplicate inbox bell", () => {
  for (const path of [
    "/bulk/workout/session",
    "/onboarding",
    "/bulk-onboarding",
    "/challenge/new",
    "/profile/notifications",
    "/notifications",
    "/bulk/meals/add",
  ]) {
    assert.equal(bellFixture(path, { data: [invitation] }).render(), null, path);
  }
});

test("bell counts actionable items, caps the visual badge, and clears immediately after resolution", () => {
  const query = { data: Array.from({ length: 101 }, () => invitation) };
  const ui = bellFixture("/bulk", query);
  assert.equal(ui.text(), "99+");
  assert.equal(ui.find("Link")[0].props["aria-label"], "Notifications, 101 unread");
  query.data = [];
  assert.equal(ui.find("span").length, 0);
  assert.equal(ui.find("Link")[0].props["aria-label"], "Notifications");
});

test("inbox shows compact incoming invitations and read-only full details behind a dialog", () => {
  const { ui } = inboxFixture();
  assert.match(ui.text(), /New12-week challenge/);
  assert.match(ui.text(), /@tempo_test_acc invited you · 15 km weekly target/);
  assert.match(ui.text(), /12 weeks · Expires/);
  assert.doesNotMatch(ui.text(), /wants a challenge|New invitation/);
  assert.equal(ui.find("Dialog.Root").length, 1);
  assert.equal(ui.find("InvitationDetails")[0].props.invitation, invitation);
  for (const label of ["Accept", "Decline"]) {
    const button = ui.button(label);
    assert.match(button.props.className, /min-h-11/);
    assert.ok(button.props["aria-label"].includes("tempo_test_acc"));
  }
});

test("Accept preserves RPC -> cache refresh -> Challenge navigation and clears the bell", async () => {
  const { ui, query, calls } = inboxFixture();
  const bell = bellFixture("/bulk", query);
  ui.button("Accept").props.onClick();
  await ui.flush();
  assert.deepEqual(plain(calls[0]), ["accept", { data: { invitationId: "invite" } }]);
  assert.deepEqual(plain(calls.filter(([name]) => name === "invalidate").map(([, key]) => key)), [
    ["challenge-invitations", "mine"],
    ["challenge"],
    ["challenge-members"],
    ["account-notifications"],
  ]);
  assert.deepEqual(plain(calls.at(-1)), ["navigate", { to: "/challenge" }]);
  assert.equal(bell.find("span").length, 0);
  assert.match(ui.text(), /You're all caught up\.No new notifications\./);
});

test("Decline uses the existing RPC, clears actionable count, and stays in the inbox", async () => {
  const { ui, query, calls } = inboxFixture();
  ui.button("Decline").props.onClick();
  await ui.flush();
  assert.deepEqual(plain(calls[0]), ["decline", { data: { invitationId: "invite" } }]);
  assert.equal(
    calls.some(([name]) => name === "navigate"),
    false,
  );
  assert.equal(query.data.length, 0);
  assert.equal(bellFixture("/challenge", query).find("span").length, 0);
});

test("pending/error handling stays local to invitations and restores actionable buttons on failure", async () => {
  const waiting = deferred();
  const { ui, query, calls } = inboxFixture({ fail: true, pending: waiting.promise });
  ui.button("Accept").props.onClick();
  assert.equal(ui.button("Decline").props.disabled, true);
  waiting.resolve();
  await ui.flush();
  assert.equal(ui.button("Accept").props.disabled, false);
  assert.match(ui.text(), /could not be accepted/);
  assert.equal(query.data.length, 1);
  assert.equal(calls.length, 1);
});

test("inbox query loading and retry errors stay local instead of showing false empty state", () => {
  const { ui, query } = inboxFixture();
  query.isLoading = true;
  assert.ok(ui.find("div").some((node) => node.props["aria-label"] === "Loading invitations"));
  assert.doesNotMatch(ui.text(), /caught up/);
  query.isLoading = false;
  query.isError = true;
  let retries = 0;
  query.refetch = () => {
    retries++;
  };
  ui.button("Retry invitations").props.onClick();
  assert.equal(retries, 1);
  assert.doesNotMatch(ui.text(), /caught up/);
});

test("cached invitations expire independently without polling, read receipts or infinite effects", () => {
  let now = Date.parse("2026-10-07T12:00:00Z");
  class Clock extends Date {
    static now() {
      return now;
    }
  }
  const timers = new Map();
  let id = 0;
  const query = {
    data: [
      { ...invitation, invitation_id: "expired", expires_at: new Date(now - 1).toISOString() },
      { ...invitation, invitation_id: "first", expires_at: new Date(now + 1000).toISOString() },
      { ...invitation, invitation_id: "second", expires_at: new Date(now + 2000).toISOString() },
    ],
  };
  const ui = accountUI(
    "src/lib/challenge-invitations.ts",
    "useChallengeInvitations",
    {
      "@tanstack/react-query": { queryOptions, useQuery: () => query },
      "./privileged-rpcs.functions": { listMyChallengeInvitations: async () => [] },
      "./network-errors": {},
    },
    {},
    {
      Date: Clock,
      setTimeout: (run, delay) => {
        timers.set(++id, { run, delay });
        return id;
      },
      clearTimeout: (key) => timers.delete(key),
    },
  );
  assert.deepEqual(
    Array.from(ui.render().data, (item) => item.invitation_id),
    ["first", "second"],
  );
  assert.equal(timers.size, 1);
  assert.equal([...timers.values()][0].delay, 1001);
  now += 1001;
  [...timers.values()][0].run();
  assert.deepEqual(
    Array.from(ui.render().data, (item) => item.invitation_id),
    ["second"],
  );
  now += 1000;
  [...timers.values()][0].run();
  assert.equal(ui.render().data.length, 0);
  assert.equal(timers.size, 0);
  ui.dispose();
});

test("invitation details preserve the real immutable terms and expose no management actions", () => {
  const ui = accountUI(
    "src/components/ChallengeInvitationDetails.tsx",
    "ChallengeInvitationDetails",
    {
      "@/components/challenge-terms-view": { TermsCards: "TermsCards" },
    },
    { invitation },
  );
  const terms = ui.find("TermsCards")[0].props;
  assert.equal(terms.timezone, "Europe/Stockholm");
  assert.equal(terms.terms.weekly_target_km, 15);
  assert.equal(terms.terms.penalty_high_eur, 15);
  assert.equal(terms.terms.travel_pause_enabled, true);
  assert.equal(terms.manage, undefined);
  assert.match(ui.text(), /Runs 1:1 · rides 3:1/);
});

test("inbox uses shared contextual Back, while Profile retains a separate push-settings route", () => {
  const ui = accountUI("src/routes/_authenticated/notifications.tsx", "Route", {
    "@/components/AccountNotificationInbox": {
      AccountNotificationInbox: "AccountNotificationInbox",
    },
  });
  assert.deepEqual(plain(ui.find("PageHeader")[0].props), {
    title: "Notifications",
    backTo: "/bulk",
    backLabel: "Today",
  });
  assert.equal(ui.find("AccountNotificationInbox").length, 1);
  const profile = read("src/routes/_authenticated/profile.tsx");
  assert.doesNotMatch(profile, /ChallengeInvitations|Compatibility tools/);
  assert.match(profile, /to: "\/profile\/notifications"[\s\S]*label: "Notification settings"/);
  const settings = read("src/routes/_authenticated/profile_.notifications.tsx");
  assert.match(settings, /title="Notification settings"/);
  assert.match(settings, /<ChallengeNotifications userId=\{user\.id\} expanded/);
  assert.doesNotMatch(settings, /ChallengeInvitations/);
});

test("Today has no incoming takeover and keeps habits/current Challenge; Challenge retains direct acceptance", () => {
  const today = read("src/routes/_authenticated/bulk/index.tsx");
  assert.doesNotMatch(today, /ChallengeInviteReceiver|New invitation|wants a challenge/);
  assert.match(today, /<NotificationBell \/>/);
  for (const label of ["Morning check-in", "Workout", "Meals"]) assert.ok(today.includes(label));
  assert.match(today, /<TodayChallenge/);
  assert.match(read("src/routes/_authenticated/challenge/index.tsx"), /<ChallengeInvitations \/>/);
  assert.match(read("src/components/AppShell.tsx"), /<NotificationBell \/>/);
  assert.match(read("src/components/ProgressChrome.tsx"), /<NotificationBell \/>/);
});

for (const width of [320, 375, 390]) {
  test(`compact invitation fixture at ${width}px keeps shrinkable text and balanced touch targets`, () => {
    const { ui, query } = inboxFixture();
    query.data = [
      { ...invitation, inviter_username: "very_long_username_that_must_wrap_without_clipping" },
    ];
    assert.match(ui.find("Card")[0].props.className, /min-w-0/);
    assert.ok(
      ui.find("p").some((node) => node.props.className.includes("[overflow-wrap:anywhere]")),
    );
    assert.ok(
      ui.find("div").some((node) => node.props.className === "mt-3 grid grid-cols-2 gap-2"),
    );
    for (const name of ["Accept", "Decline"])
      assert.match(ui.button(name).props.className, /min-h-11/);
  });
}
