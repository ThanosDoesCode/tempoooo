import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import vm from "node:vm";
import ts from "typescript";
import { QueryClient } from "@tanstack/react-query";
import { challengeParticipation } from "../src/lib/challenge-participation.ts";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");
const require = createRequire(import.meta.url);
const jsx = (type, props) => ({ type, props });
const q = (data) => ({ data, isLoading: false, error: null, refetch: async () => {} });
const challenge = {
  id: "challenge",
  created_by: "me",
  start_date: "2026-10-12",
  timezone: "Europe/Stockholm",
  duration_weeks: 12,
  weekly_target_km: 15,
  max_members: 2,
};
const invitation = {
  id: "invite",
  invited_username: "alex",
  invited_user_id: "opponent",
  expires_at: "2026-10-18T12:00:00Z",
  accepted_at: null,
};
const members = q([{ userId: "me", name: "Me" }]);
const outgoing = q(invitation);
const summary = q([
  { userId: "me", equivalent: 6.5 },
  { userId: "opponent", equivalent: 9.2 },
]);
function nodes(tree, predicate) {
  if (tree == null || typeof tree !== "object") return [];
  if (Array.isArray(tree)) return tree.flatMap((child) => nodes(child, predicate));
  return [...(predicate(tree) ? [tree] : []), ...nodes(tree.props?.children, predicate)];
}
function text(tree) {
  if (tree == null || typeof tree === "boolean") return "";
  if (Array.isArray(tree)) return tree.map(text).join(" ");
  if (typeof tree === "object") return text(tree.props?.children);
  return String(tree);
}
function load(source, modules = {}, globals = {}) {
  const slots = [],
    effects = [];
  let index = 0;
  const context = {
    exports: {},
    Date,
    DOMException,
    require(name) {
      if (name in modules) return modules[name];
      if (name === "react/jsx-runtime") return { jsx, jsxs: jsx, Fragment: "fragment" };
      if (name === "react")
        return {
          useState(initial) {
            const slot = index++;
            slots[slot] ??= { value: typeof initial === "function" ? initial() : initial };
            return [
              slots[slot].value,
              (value) => {
                slots[slot].value = value;
              },
            ];
          },
          useRef(value) {
            return (slots[index++] ??= { current: value });
          },
          useEffect(fn) {
            effects.push(fn);
          },
          useMemo(fn) {
            return fn();
          },
        };
      if (name === "date-fns") return require(name);
      if (name === "@/components/NotificationBell" || name === "./NotificationBell")
        return { NotificationBell: "NotificationBell" };
      if (name === "@/components/ChallengeInvitations")
        return { ChallengeInvitations: "ChallengeInvitations" };
      if (name.includes("ui-kit") || name === "lucide-react")
        return new Proxy({}, { get: (_, key) => String(key) });
      throw new Error(`Unexpected import: ${name}`);
    },
    ...globals,
  };
  vm.runInNewContext(
    ts.transpileModule(source, {
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2022,
        jsx: ts.JsxEmit.ReactJSX,
      },
    }).outputText,
    context,
  );
  return {
    exports: context.exports,
    effects,
    render(name, props) {
      index = 0;
      return name === "Route" ? context.exports.Route.component() : context.exports[name](props);
    },
  };
}
const lib = {
  useMyChallenge: () => q(challenge),
  useChallengeMembers: () => members,
  useOutgoingInvitation: () => outgoing,
  useActivitySummary: () => summary,
  useWeekTargets: () => q([]),
  useTravelPauses: () => q([]),
  weekNumberOf: () => 1,
  todayIn: () => "2026-10-13",
  weekBounds: () => ({ start: "2026-10-12", end: "2026-10-18" }),
  resolvedTargetForWeek: () => 15,
  hoursLeft: () => 48,
  weekPenaltyMessage: () => ({ atRisk: true, line: "€10 if the week ended now" }),
};
const baseModules = {
  "@/lib/auth": { useAuth: () => ({ user: { id: "me" } }) },
  "@/lib/challenge": lib,
  "@/lib/challenge-participation": {
    challengeParticipation,
    usePendingChallengeRefresh: () => Date.parse("2026-10-05"),
  },
  "@tanstack/react-router": {
    Link: "Link",
    useNavigate: () => async () => {},
    createFileRoute: () => (config) => ({ ...config, useSearch: () => ({}) }),
  },
  "./ChallengeShareInvite": { ChallengeShareInvite: "ChallengeShareInvite" },
};
function reset() {
  members.data = [{ userId: "me", name: "Me" }];
  members.isLoading = false;
  members.error = null;
  outgoing.data = { ...invitation };
  outgoing.isLoading = false;
  outgoing.error = null;
}

test("participation derives pending/expired/accepted from membership and stored invitation, not progress", () => {
  const now = Date.parse("2026-10-05");
  assert.equal(challengeParticipation(null, "me", [], null, now), "none");
  assert.equal(challengeParticipation(challenge, "me", members.data, null, now), "uninvited");
  assert.equal(challengeParticipation(challenge, "me", members.data, invitation, now), "pending");
  assert.equal(
    challengeParticipation(
      challenge,
      "me",
      members.data,
      invitation,
      Date.parse(invitation.expires_at),
    ),
    "expired",
  );
  assert.equal(
    challengeParticipation(
      challenge,
      "me",
      [...members.data, { userId: "opponent" }],
      invitation,
      now,
    ),
    "accepted",
  );
  assert.equal(
    challengeParticipation(
      challenge,
      "me",
      members.data,
      { ...invitation, accepted_at: "2026-10-06" },
      now,
    ),
    "accepted",
  );
  // A recipient who is already a member is not an outgoing creator.
  assert.equal(
    challengeParticipation(challenge, "opponent", [{ userId: "opponent" }], null, now),
    "accepted",
  );
});

test("Today pending card shows username, target, actual start date, Share and Challenge link without active metrics", async () => {
  reset();
  const f = load(await read("src/components/TodayChallenge.tsx"), baseModules);
  const tree = f.render("TodayChallenge", {});
  assert.match(text(tree), /Challenge with @alex.*Pending.*Waiting for them to accept/s);
  assert.match(text(tree), /15\s+km \/ week.*12\s+weeks.*Starts\s+12 Oct 2026/s);
  assert.doesNotMatch(text(tree), /days left|week ended|\/ 15 km|Starts when accepted/);
  assert.equal(nodes(tree, (n) => n.props?.role === "progressbar").length, 0);
  assert.equal(nodes(tree, (n) => n.type === "Link")[0].props.to, "/challenge");
  const share = nodes(tree, (n) => n.type === "ChallengeShareInvite")[0];
  assert.equal(share.props.username, "alex");
  assert.equal(share.props.compact, true);
  // The child is not an interactive control nested inside the card's link.
  assert.equal(
    nodes(nodes(tree, (n) => n.type === "Link")[0], (n) => n.type === "ChallengeShareInvite")
      .length,
    0,
  );
});

test("pending Today becomes active from refreshed membership; real opponent progress, days left and risk render", async () => {
  reset();
  const f = load(await read("src/components/TodayChallenge.tsx"), baseModules);
  assert.match(text(f.render("TodayChallenge", {})), /Pending/);
  members.data.push({ userId: "opponent", name: "Alex" });
  outgoing.data.accepted_at = "2026-10-05";
  const tree = f.render("TodayChallenge", {});
  assert.doesNotMatch(text(tree), /Pending|Waiting for them to accept/);
  assert.match(
    text(tree),
    /Challenge with @alex.*2\s+days left.*6.5\s+\/\s+15\s+km.*€10.*@alex\s+9.2\s+km/s,
  );
  assert.equal(nodes(tree, (n) => n.props?.role === "progressbar")[0].props["aria-valuenow"], 6.5);
});

test("pending status loading/error cannot flash active zero-progress or penalties", async () => {
  reset();
  const f = load(await read("src/components/TodayChallenge.tsx"), baseModules);
  outgoing.isLoading = true;
  assert.equal(f.render("TodayChallenge", {}).props.label, "Loading challenge status");
  outgoing.isLoading = false;
  outgoing.error = new Error("network");
  assert.equal(f.render("TodayChallenge", {}).type, "DataError");
  reset();
});

test("expired Today invite offers renewal without active metrics or Share", async () => {
  reset();
  outgoing.data.expires_at = "2026-10-01";
  const f = load(await read("src/components/TodayChallenge.tsx"), baseModules);
  const tree = f.render("TodayChallenge", {});
  assert.match(text(tree), /Expired.*Send a fresh invitation/s);
  assert.equal(nodes(tree, (n) => n.type === "ChallengeShareInvite").length, 0);
  assert.equal(nodes(tree, (n) => n.props?.role === "progressbar").length, 0);
});

test("Waiting screen shows real terms/expiry, neutral pending, share and confirmed cancel; expiry offers fresh invite", async () => {
  const calls = [];
  const f = load(await read("src/components/ChallengeWaiting.tsx"), {
    ...baseModules,
    "./ChallengeInvite": { ChallengeInviteCard: "ChallengeInviteCard" },
    "@tanstack/react-query": {
      useQueryClient: () => ({ invalidateQueries: async () => calls.push("invalidate") }),
    },
    "@/lib/privileged-rpcs.functions": { cancelPendingChallenge: async () => calls.push("cancel") },
    "@/lib/network-errors": { userFacingError: () => "Try again" },
    "@/lib/challenge": { km: (km) => `${km} km` },
  });
  let tree = f.render("ChallengeWaiting", { challenge, invitation });
  assert.match(
    text(tree),
    /12\s*-week challenge.*Waiting for\s+@alex.*Invite sent.*Pending.*Expires in.*18 Oct/s,
  );
  assert.match(text(tree), /Starts.*12 Oct.*15 km\s+a week.*12.*weeks/s);
  assert.equal(nodes(tree, (n) => n.type === "ChallengeShareInvite").length, 1);
  assert.doesNotMatch(text(tree), /week ended|penalty|0.0|opponent km/);
  assert.doesNotMatch(await read("src/components/ChallengeWaiting.tsx"), /bg-warn/);
  const cancel = nodes(tree, (n) => n.type === "button" && text(n) === "Cancel this challenge")[0];
  await cancel.props.onClick();
  assert.deepEqual(calls, []);
  tree = f.render("ChallengeWaiting", { challenge, invitation });
  await nodes(tree, (n) => n.type === "button" && /Tap again/.test(text(n)))[0].props.onClick();
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(calls, ["cancel", "invalidate"]);
  tree = f.render("ChallengeWaiting", { challenge, invitation, expired: true });
  assert.match(text(tree), /Invite expired.*Expired/s);
  assert.equal(
    nodes(tree, (n) => n.type === "ChallengeInviteCard")[0].props.challengeId,
    challenge.id,
  );
});

test("Share uses authenticated invitation entry point, guards double taps and ignores native cancellation", async () => {
  let resolve;
  const shares = [],
    copied = [];
  const f = load(
    await read("src/components/ChallengeShareInvite.tsx"),
    {},
    {
      window: { location: { origin: "https://tempo.test" } },
      navigator: {
        share: (value) => {
          shares.push(value);
          return new Promise((done) => {
            resolve = done;
          });
        },
        clipboard: { writeText: async (value) => copied.push(value) },
      },
    },
  );
  const tap = nodes(
    f.render("ChallengeShareInvite", { username: "alex", compact: true }),
    (n) => n.type === "button",
  )[0].props.onClick;
  tap();
  tap();
  assert.equal(shares.length, 1);
  assert.equal(shares[0].url, "https://tempo.test");
  assert.match(text(f.render("ChallengeShareInvite", { username: "alex" })), /Sharing/);
  resolve();
  await new Promise((r) => setImmediate(r));
  assert.match(
    text(f.render("ChallengeShareInvite", { username: "alex", compact: true })),
    /Share invite/,
  );
  assert.deepEqual(copied, []);
  const abort = load(
    await read("src/components/ChallengeShareInvite.tsx"),
    {},
    {
      window: { location: { origin: "https://tempo.test" } },
      navigator: {
        share: async () => {
          throw new DOMException("Cancelled", "AbortError");
        },
        clipboard: { writeText: async () => copied.push("wrong") },
      },
    },
  );
  nodes(
    abort.render("ChallengeShareInvite", { username: "alex" }),
    (n) => n.type === "button",
  )[0].props.onClick();
  await new Promise((r) => setImmediate(r));
  assert.deepEqual(copied, []);
});

test("waiting refresh updates actual shared query caches, foreground/expiry triggers and acceptance invalidates progress", async () => {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const calls = [],
    timers = new Map(),
    listeners = new Map();
  let serverMembers = [{ userId: "me" }];
  for (const [key, value] of [
    [["challenge"], () => challenge],
    [["challenge-members", "challenge"], () => serverMembers],
    [["challenge-outgoing-invitation", "challenge"], () => invitation],
  ])
    await qc.fetchQuery({
      queryKey: key,
      queryFn: async () => {
        calls.push(key[0]);
        return value();
      },
    });
  await qc.fetchQuery({
    queryKey: ["challenge-activities", "challenge", "summary"],
    queryFn: async () => [],
  });
  const document = {
    visibilityState: "visible",
    addEventListener: (event, fn) => listeners.set(event, fn),
    removeEventListener: (event) => listeners.delete(event),
  };
  const f = load(
    await read("src/lib/challenge-participation.ts"),
    {
      "@tanstack/react-query": {
        useQueryClient: () => ({
          // These test caches have no mounted React observers; exercise the real QueryClient without the observer filter.
          refetchQueries: ({ type: _type, ...filter }) => qc.refetchQueries(filter),
          getQueryData: (...args) => qc.getQueryData(...args),
          invalidateQueries: (...args) => qc.invalidateQueries(...args),
        }),
      },
    },
    {
      document,
      window: {
        setInterval: (fn, ms) => {
          timers.set("poll", { fn, ms });
          return 1;
        },
        clearInterval: () => timers.delete("poll"),
        setTimeout: (fn, ms) => {
          timers.set("expiry", { fn, ms });
          return 2;
        },
        clearTimeout: () => timers.delete("expiry"),
        addEventListener: (event, fn) => listeners.set(event, fn),
        removeEventListener: (event) => listeners.delete(event),
      },
    },
  );
  f.exports.usePendingChallengeRefresh(
    "challenge",
    true,
    new Date(Date.now() + 5000).toISOString(),
  );
  const stop = f.effects[0]();
  assert.equal(timers.get("poll").ms, 15000);
  assert.ok(timers.get("expiry").ms > 0 && timers.get("expiry").ms <= 5000);
  calls.length = 0;
  document.visibilityState = "hidden";
  timers.get("poll").fn();
  assert.deepEqual(calls, []);
  document.visibilityState = "visible";
  serverMembers = [{ userId: "me" }, { userId: "opponent" }];
  listeners.get("visibilitychange")();
  await new Promise((r) => setImmediate(r));
  assert.equal(
    challengeParticipation(
      challenge,
      "me",
      qc.getQueryData(["challenge-members", "challenge"]),
      invitation,
    ),
    "accepted",
  );
  assert.equal(
    qc.getQueryState(["challenge-activities", "challenge", "summary"]).isInvalidated,
    true,
  );
  assert.deepEqual(
    new Set(calls),
    new Set(["challenge", "challenge-members", "challenge-outgoing-invitation"]),
  );
  stop();
  assert.equal(timers.size, 0);
  assert.equal(listeners.size, 0);
  qc.clear();
});

test("Challenge route waiting guard precedes active/pre-start metrics; invitation resend invalidates correct cache", async () => {
  const [route, send, receiver] = await Promise.all([
    read("src/routes/_authenticated/challenge/index.tsx"),
    read("src/components/ChallengeInvite.tsx"),
    read("src/components/ChallengeInvitations.tsx"),
  ]);
  assert.ok(route.indexOf('participation !== "accepted"') < route.indexOf("if (preStart)"));
  assert.match(route, /expired=\{participation === "expired"\}/);
  assert.match(
    send,
    /await sendChallengeUsernameInvitation[\s\S]*await qc.invalidateQueries\(\{ queryKey: \["challenge-outgoing-invitation", challengeId\]/,
  );
  assert.match(
    receiver,
    /await acceptChallengeInvitationById[\s\S]*await refresh\(\)[\s\S]*navigate\(\{ to: "\/challenge"/,
  );
  assert.match(receiver, /declineChallengeInvitation/);
  assert.doesNotMatch(route + send, /location.reload|setQueryData\(\["challenge-members"/);
});

test("actual Challenge route transitions Waiting to active after acceptance without remount/reload, and cancellation to discovery", async () => {
  reset();
  const challengeQuery = q(challenge);
  const f = load(await read("src/routes/_authenticated/challenge/index.tsx"), {
    ...baseModules,
    "@tanstack/react-query": {
      useQueryClient: () => ({ invalidateQueries: async () => {}, prefetchQuery: async () => {} }),
    },
    "@/components/AppShell": { AppShell: "AppShell" },
    "@/components/PageSkeleton": {
      PageSkeleton: "PageSkeleton",
      ActivityFeedSkeleton: "ActivityFeedSkeleton",
    },
    "@/components/ChallengeWaiting": { ChallengeWaiting: "ChallengeWaiting" },
    "@/components/ChallengeInvite": { ChallengeInviteCard: "ChallengeInviteCard" },
    "@/lib/privileged-rpcs.functions": { finalizeChallenge: async () => {} },
    "@/lib/challenge": {
      ...lib,
      useMyChallenge: () => challengeQuery,
      useWeeks: () => q([]),
      usePayments: () => q([]),
      useActivities: () => ({ activities: [], isLoading: false }),
      weekPaused: () => false,
      targetOverrideForWeek: () => 15,
      owedText: () => "",
      km: (n) => `${n} km`,
    },
  });
  let tree = f.render("Route");
  assert.equal(nodes(tree, (n) => n.type === "ChallengeWaiting").length, 1);
  assert.doesNotMatch(text(tree), /This week|All square|Add run or ride/);
  members.data.push({ userId: "opponent", name: "Alex" });
  outgoing.data.accepted_at = "2026-10-05";
  tree = f.render("Route");
  assert.equal(nodes(tree, (n) => n.type === "ChallengeWaiting").length, 0);
  assert.match(text(tree), /This week/);
  assert.equal(nodes(tree, (n) => n.type?.name === "ParticipantBar").length, 2);
  challengeQuery.data = null;
  assert.match(text(f.render("Route")), /Create a challenge/);
});
