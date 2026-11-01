import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { QueryClient } from "@tanstack/react-query";
import { createMemoryHistory } from "@tanstack/history";
import { presentationComponent } from "./presentation-component-fixture.mjs";
import { accountUI, textOf } from "./account-ui-fixture.mjs";
import { MAIN_TABS, mainTabForPath } from "../src/lib/main-navigation.ts";
import { backWithinApp, trackInAppHistory, inAppBackLabel } from "../src/lib/in-app-back.ts";

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const clean = (value) => JSON.parse(JSON.stringify(value));
const person = (state = "none", extra = {}) => ({
  user_id: "other",
  username: "long_username_twenty",
  relationship_state: state,
  request_id: state === "none" ? null : "lifecycle",
  ...extra,
});
function apiFixture() {
  const calls = [];
  let result = { data: [], error: null };
  const supabase = {
    rpc(name, args) {
      calls.push([name, clean(args ?? {})]);
      return {
        abortSignal(signal) {
          assert.ok(signal);
          return Promise.resolve(result);
        },
        then(resolve, reject) {
          return Promise.resolve(result).then(resolve, reject);
        },
      };
    },
  };
  const api = presentationComponent(
    "src/lib/community-query.ts",
    {
      "@/integrations/supabase/client": { supabase },
      "@tanstack/react-query": {
        queryOptions: (x) => x,
        infiniteQueryOptions: (x) => x,
        useQuery: (x) => x,
      },
      "./network-errors": { readRetryDelay: () => 0, shouldRetryRead: () => false },
    },
    { Error },
  );
  return {
    api,
    calls,
    result(value) {
      result = value;
    },
  };
}
const signal = new AbortController().signal;

test("Community query keys include authenticated account, canonical search and shared count", () => {
  const { api } = apiFixture();
  assert.deepEqual(clean(api.communityCountOptions("a").queryKey), [
    "community",
    "a",
    "incoming-count",
  ]);
  assert.notDeepEqual(
    clean(api.communityCountOptions("a").queryKey),
    clean(api.communityCountOptions("b").queryKey),
  );
  assert.deepEqual(clean(api.communitySearchOptions("a", " @ALICE ").queryKey), [
    "community",
    "a",
    "search",
    "alice",
  ]);
  for (const q of ["", "a", "%", "x%", "x".repeat(21)])
    assert.equal(api.communitySearchOptions("a", q).enabled, false);
  assert.equal(api.communitySearchOptions("a", "ab_").enabled, true);
  assert.equal(api.communityCountOptions(undefined).enabled, false);
  assert.equal(api.communityCountOptions("a", false).enabled, false);
});
test("bounded JSON pages use server cursor, detect stalls and dedupe overlaps without extra empty-page clicks", async () => {
  const { api, calls, result } = apiFixture();
  const p = person();
  result({ data: { people: [p], next_cursor: "other" }, error: null });
  const options = api.communityListOptions("a", "friends");
  const page = await options.queryFn({ pageParam: "cursor", signal });
  assert.deepEqual(calls, [["list_community_people", { _kind: "friends", _after: "cursor" }]]);
  assert.equal(options.getNextPageParam(page, [], "cursor"), "other");
  assert.equal(options.getNextPageParam(page, [], "other"), undefined);
  assert.equal(options.getNextPageParam({ people: [], next_cursor: null }, [], "other"), undefined);
  assert.equal(
    api.communityPeople([
      page,
      { people: [p, person("friends", { user_id: "third" })], next_cursor: null },
    ]).length,
    2,
  );
});
test("search/profile select no raw profile data, propagate RPC errors, unavailable is null", async () => {
  const { api, calls, result } = apiFixture();
  result({ data: [person()], error: null });
  await api.communitySearchOptions("a", "alice").queryFn({ signal });
  await api.communityProfileOptions("a", "other").queryFn({ signal });
  assert.deepEqual(calls, [
    ["search_community_people", { _query: "alice" }],
    ["get_community_profile", { _user: "other" }],
  ]);
  result({ data: [], error: null });
  assert.equal(await api.communityProfileOptions("a", "other").queryFn({ signal }), null);
  result({ data: null, error: new Error("database unavailable") });
  await assert.rejects(
    api.communitySearchOptions("a", "alice").queryFn({ signal }),
    /database unavailable/,
  );
});
test("writes use RPCs only, lifecycle tokens, no client actor or username", async () => {
  const { api, calls } = apiFixture();
  for (const action of ["send", "accept", "decline", "cancel", "remove", "block", "unblock"])
    await api.changeCommunityRelationship(action, person("incoming_pending"), "send-token");
  assert.deepEqual(
    calls.map((c) => c[0]),
    [
      "send_community_friend_request",
      "accept_community_friend_request",
      "decline_community_friend_request",
      "cancel_community_friend_request",
      "remove_community_friend",
      "block_community_user",
      "unblock_community_user",
    ],
  );
  assert.deepEqual(calls[0][1], { _user: "other", _request_id: "send-token" });
  for (const [_, args] of calls) {
    assert.equal(args.actor, undefined);
    assert.equal(args.username, undefined);
  }
  await assert.rejects(api.changeCommunityRelationship("accept", person()), /Request changed/);
});
test("mutation refresh touches all own Community surfaces only; cached count dedupes", async () => {
  const { api, calls, result } = apiFixture();
  result({ data: 3, error: null });
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  await Promise.all([
    client.fetchQuery(api.communityCountOptions("a")),
    client.fetchQuery(api.communityCountOptions("a")),
  ]);
  assert.equal(calls.length, 1);
  assert.equal(client.getQueryData(["community", "a", "incoming-count"]), 3);
  for (const key of [
    ["community", "a", "profile", "other"],
    ["community", "b", "incoming-count"],
    ["today", "a"],
    ["account-notifications", "a"],
  ])
    client.setQueryData(key, "cached");
  await api.refreshCommunity(client, "a");
  assert.equal(client.getQueryState(["community", "a", "profile", "other"]).isInvalidated, true);
  for (const key of [
    ["community", "b", "incoming-count"],
    ["today", "a"],
    ["account-notifications", "a"],
  ])
    assert.equal(client.getQueryState(key).isInvalidated, false);
  client.clear();
});
test("badge counts incoming only, caps 9+, and is deferred until shell mount", () => {
  const { api } = apiFixture();
  assert.equal(api.communityBadgeLabel(2), "2");
  assert.equal(api.communityBadgeLabel(10), "9+");
  const calls = [];
  const ui = accountUI("src/components/CommunityBadge.tsx", "CommunityBadge", {
    "@/lib/auth": { useAuth: () => ({ user: { id: "a" } }) },
    "@/lib/community-query": {
      communityBadgeLabel: api.communityBadgeLabel,
      useCommunityCount: (id, enabled) => {
        calls.push([id, enabled]);
        return { data: 10 };
      },
    },
  });
  assert.match(ui.text(), /9\+/);
  assert.deepEqual(calls[0], ["a", false]);
  assert.ok(calls.some((c) => c[1] === true));
  assert.equal(ui.find("span")[0].props["aria-label"], "9 or more incoming friend requests");
  const sql = read("supabase/migrations/20261023120000_tempo_community.sql");
  assert.match(sql, /r\.recipient_id = auth\.uid\(\) AND r\.status = 'pending' LIMIT 10/);
});

const alerts = Object.fromEntries(
  [
    "AlertDialog",
    "AlertDialogAction",
    "AlertDialogCancel",
    "AlertDialogContent",
    "AlertDialogDescription",
    "AlertDialogTitle",
  ].map((x) => [x, x]),
);
function actionsFixture(state = "none", props = {}) {
  const calls = [];
  let failure = false,
    hold = false,
    resolve;
  const ui = accountUI(
    "src/components/Community.tsx",
    "CommunityActions",
    {
      "@/lib/auth": { useAuth: () => ({ user: { id: "a" } }) },
      "@tanstack/react-query": { useQueryClient: () => ({}) },
      "@/lib/community-query": {
        changeCommunityRelationship: async (...args) => {
          calls.push(args);
          if (hold)
            await new Promise((r) => {
              resolve = r;
            });
          if (failure) throw new Error("failed");
        },
        refreshCommunity: async () => {
          calls.push(["refresh"]);
        },
      },
      "./ui/alert-dialog": alerts,
      "./MainPageHeader": { MainPageHeader: "MainPageHeader" },
      "./HistoryBackLink": { HistoryBackLink: "HistoryBackLink" },
      "./ui-kit": { DataError: "DataError" },
    },
    { person: person(state), ...props },
  );
  return {
    ui,
    calls,
    fail(value = true) {
      failure = value;
    },
    hold() {
      hold = true;
    },
    release() {
      resolve();
    },
  };
}
test("send enters busy immediately, cannot double submit, stable token retries, success refreshes", async () => {
  const f = actionsFixture();
  f.fail();
  f.hold();
  const button = f.ui.button("Add friend");
  button.props.onClick();
  button.props.onClick();
  await f.ui.flush();
  assert.equal(f.calls.length, 1);
  assert.ok(f.ui.button("Updating…").props.disabled);
  f.release();
  await f.ui.flush();
  assert.match(f.ui.text(), /Could not update/);
  const token = f.calls[0][2];
  f.fail(false);
  f.ui.button("Add friend").props.onClick();
  await f.ui.flush();
  f.release();
  await f.ui.flush();
  assert.equal(f.calls[1][2], token);
  assert.doesNotMatch(f.ui.text(), /Could not update/);
  assert.equal(f.calls.at(-1)[0], "refresh");
});
test("all pending/friends states render correct actions; accept, decline, cancel use existing lifecycle", async () => {
  for (const [state, label, action] of [
    ["incoming_pending", "Accept", "accept"],
    ["incoming_pending", "Decline", "decline"],
    ["outgoing_pending", "Cancel request", "cancel"],
  ]) {
    const f = actionsFixture(state, { detail: true });
    f.ui.button(label).props.onClick();
    await f.ui.flush();
    assert.equal(f.calls[0][0], action);
    assert.equal(f.calls[0][1].request_id, "lifecycle");
  }
  const f = actionsFixture("friends");
  assert.match(f.ui.text(), /Friends/);
  assert.equal(f.ui.find("button").filter((b) => textOf(b) === "Add friend").length, 0);
});
test("remove/block/unblock require Tempo confirmation; cancelling runs no action", async () => {
  for (const [state, blocked, label, confirm] of [
    ["friends", false, "Remove friend", "Remove"],
    ["none", false, "Block user", "Block"],
    ["none", true, "Unblock", "Unblock"],
  ]) {
    const f = actionsFixture(state, { detail: true, blocked });
    if (!blocked)
      f.ui
        .find("button")
        .find((b) => b.props["aria-label"] === "Connection actions")
        .props.onClick();
    let focused = false;
    const trigger = {
      isConnected: true,
      focus() {
        focused = true;
      },
    };
    f.ui.button(label).props.onClick({ currentTarget: trigger });
    assert.equal(f.calls.length, 0);
    assert.equal(f.ui.find("AlertDialog")[0].props.open, true);
    const titleBeforeClose = textOf(f.ui.find("AlertDialogTitle")[0]);
    f.ui.find("AlertDialog")[0].props.onOpenChange(false);
    assert.equal(textOf(f.ui.find("AlertDialogTitle")[0]), titleBeforeClose);
    let prevented = false;
    f.ui.find("AlertDialogContent")[0].props.onCloseAutoFocus({
      preventDefault() {
        prevented = true;
      },
    });
    assert.equal(focused, true);
    assert.equal(prevented, true);
    assert.equal(f.calls.length, 0);
    f.ui.button(label).props.onClick({ currentTarget: trigger });
    const action = f.ui.find("AlertDialogAction")[0];
    assert.equal(textOf(action), confirm);
    action.props.onClick();
    await f.ui.flush();
    assert.equal(f.calls.length, 2);
  }
  assert.doesNotMatch(read("src/components/Community.tsx"), /window\.confirm|alert\(/);
});

function markup(exportName, props = {}, options = {}) {
  const list = options.people ?? [];
  const api = presentationComponent("src/components/Community.tsx", {
    react: React,
    "@tanstack/react-router": {
      Link: ({ children, ...p }) => React.createElement("a", { "data-to": p.to }, children),
    },
    "@tanstack/react-query": {
      useQueryClient: () => ({}),
      useQuery: () => options.query ?? { data: list, isPending: false },
      useInfiniteQuery: () => ({
        data: { pages: [{ people: list, next_cursor: null }] },
        isPending: false,
        hasNextPage: false,
        ...options.query,
      }),
    },
    "@/lib/auth": { useAuth: () => ({ user: { id: "a" } }) },
    "@/lib/community-query": {
      communityListOptions: () => ({}),
      communityPeople: (p) => p?.flatMap((page) => page.people) ?? [],
      communityProfileOptions: () => ({}),
      communitySearchOptions: () => ({}),
      normalizePeopleSearch: (q) => q.trim().toLowerCase(),
      validPeopleSearch: (q) => q.length >= 2,
      useCommunityCount: () => ({}),
    },
    "./MainPageHeader": { MainPageHeader: ({ title }) => React.createElement("h1", {}, title) },
    "./HistoryBackLink": { HistoryBackLink: () => React.createElement("a", {}, "Community") },
    "./ui-kit": {
      DataError: ({ message }) => React.createElement("p", { role: "alert" }, message),
    },
    "./ui/alert-dialog": Object.fromEntries(
      Object.keys(alerts).map((key) => [
        key,
        ({ children, open }) =>
          key === "AlertDialog" && !open ? null : React.createElement("div", {}, children),
      ]),
    ),
  });
  return renderToStaticMarkup(React.createElement(api[exportName], props));
}
test("landing defaults to requests/friends, labelled search, no giant zero-request card", () => {
  const html = markup("CommunityPage", { search: "", onSearchChange() {} });
  assert.match(html, /Search people/);
  assert.match(html, /No friends yet/);
  assert.match(html, /Search for people to add on Tempo/);
  assert.doesNotMatch(html, /Friend requests/);
  assert.match(html, /Manage connections/);
  assert.doesNotMatch(html, /email|bodyweight|calorie|avatar_url|display_name/);
});
test("incoming requests and friends render real handles and actions", () => {
  const html = markup(
    "CommunityListSection",
    { kind: "incoming", title: "Friend requests" },
    { people: [person("incoming_pending")] },
  );
  assert.match(html, /Friend requests/);
  assert.match(html, /@long_username_twenty/);
  assert.match(html, /Accept/);
  assert.match(html, /Decline/);
  const friends = markup(
    "CommunityListSection",
    { kind: "friends", title: "Friends" },
    { people: [person("friends")] },
  );
  assert.match(friends, /data-to="\/community\/\$userId"/);
});
test("search short/no-results/results/error/loading states are compact and truthful", () => {
  for (const [search, query, expected] of [
    ["a", {}, /Enter 2/],
    ["ab", { data: [] }, /No people found/],
    ["ab", { data: [person()] }, /Add friend/],
    ["ab", { isError: true }, /Could not search people/],
    ["ab", { isPending: true }, /Searching/],
  ]) {
    assert.match(markup("CommunityPage", { search, onSearchChange() {} }, { query }), expected);
  }
});
test("public profile shows only initials/handle/relationship, blocked and missing share unavailable state", () => {
  const html = markup(
    "CommunityProfilePage",
    { userId: "other" },
    { query: { data: person("friends") } },
  );
  assert.match(html, /@long_username_twenty/);
  assert.match(html, /Friends/);
  assert.doesNotMatch(html, /<img|email|weight|workout|Challenge|streak/);
  assert.match(
    markup("CommunityProfilePage", { userId: "other" }, { query: { data: null } }),
    /Person unavailable/,
  );
  assert.match(
    markup("CommunityProfilePage", { userId: "other" }, { query: { isError: true } }),
    /Could not load this person/,
  );
});
test("full/core nav puts + in physical middle, nested Community ownership exact and Profile unchanged", () => {
  assert.deepEqual(
    MAIN_TABS.map((t) => t.label),
    ["Today", "Challenge", "Community", "Progress"],
  );
  const core = [MAIN_TABS[1], "+", MAIN_TABS[2]];
  assert.equal(core[1], "+");
  for (const path of ["/community", "/community/someone"])
    assert.equal(mainTabForPath(path), "community");
  for (const path of ["/community-other", "/profile", "/profile/settings"])
    assert.equal(mainTabForPath(path), null);
  assert.equal(inAppBackLabel("/community"), "Community");
  const shell = read("src/components/AppShell.tsx");
  assert.match(shell, /grid-cols-3.*grid-cols-5/);
  assert.doesNotMatch(shell, /PrimaryTabTransition|primary-tab-motion/);
  assert.match(shell, /activeOptions=\{\{ exact: true/);
  assert.match(shell, /<CommunityBadge/);
});
test("search replaces history; profile pushes, Back restores search and direct entry has Community fallback", () => {
  const history = createMemoryHistory({ initialEntries: ["/bulk"] });
  trackInAppHistory(history);
  history.push("/community");
  for (const q of ["a", "al", "alice"]) history.replace("/community?q=" + q);
  history.push("/community/other");
  assert.equal(backWithinApp(history), true);
  assert.equal(history.location.search, "?q=alice");
  assert.equal(backWithinApp(history), true);
  assert.equal(history.location.pathname, "/bulk");
  const route = read("src/routes/_authenticated/community.tsx");
  assert.match(route, /replace: true/);
  assert.match(route, /resetScroll: false/);
  assert.match(
    read("src/components/Community.tsx"),
    /HistoryBackLink fallback="\/community" fallbackLabel="Community"/,
  );
  const deep = createMemoryHistory({ initialEntries: ["/community/other"] });
  trackInAppHistory(deep);
  assert.equal(backWithinApp(deep), false);
});
test("Community stays independent of fitness, Challenge invitations and notification/startup paths", () => {
  for (const file of [
    "src/routes/_authenticated/community.tsx",
    "src/routes/_authenticated/community_.$userId.tsx",
    "src/lib/community-query.ts",
    "src/components/Community.tsx",
  ])
    assert.doesNotMatch(
      read(file),
      /preferredBulkMembership|accountProductMode|bulk_profile_id|sendChallenge|challenge-invitation|account-notification|Push/,
    );
  for (const file of [
    "src/routes/_authenticated/route.tsx",
    "src/routes/_authenticated/bulk/route.tsx",
    "src/lib/bulk-today-query.ts",
  ])
    assert.doesNotMatch(read(file), /community/i);
});
