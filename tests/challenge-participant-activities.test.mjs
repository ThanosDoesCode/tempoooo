import { test } from "node:test";
import assert from "node:assert/strict";
import * as dateFns from "date-fns";
import { accountUI, textOf } from "./account-ui-fixture.mjs";
import { presentationComponent } from "./presentation-component-fixture.mjs";
import { evidenceWeekFinalized } from "../src/lib/challenge-evidence.ts";

const C = presentationComponent("src/lib/challenge.ts", {
  "date-fns": dateFns,
  "@tanstack/react-query": { queryOptions: (options) => options },
  "@/integrations/supabase/client": {},
  "./challenge-activity-data": {},
  "./privileged-rpcs.functions": {},
});
const q = (data) => ({ data, isLoading: false, error: null, refetch: async () => {} });
const challenge = {
  id: "challenge",
  created_by: "me",
  start_date: "2026-10-12",
  timezone: "UTC",
  duration_weeks: 12,
  weekly_target_km: 15,
  max_members: 2,
  penalty_mode: "money",
  penalty_high_eur: 15,
  penalty_medium_eur: 10,
  penalty_low_eur: 5,
  legacy_photo_owed: true,
};
const participants = [
  { userId: "opponent", name: "Alex with a long participant name" },
  { userId: "me", name: "Me" },
];
const activity = (user = "me", overrides = {}) => ({
  id: `${user}-run`,
  challenge_id: "challenge",
  user_id: user,
  activity_type: "run",
  distance_km: 3.1,
  duration_seconds: 930,
  qualifying_equivalent_km: 3.1,
  is_qualified: true,
  activity_date: "2026-10-13",
  created_at: "2026-10-13T12:00:00Z",
  evidence_path: `challenge/${user}/private.webp`,
  extra_evidence_paths: [],
  ...overrides,
});
const ride = activity("opponent", {
  id: "opponent-ride",
  activity_type: "cycle",
  distance_km: 9,
  duration_seconds: 1500,
  qualifying_equivalent_km: 3,
});

function screen({
  activities = [activity(), ride],
  history = false,
  hasMore = false,
  detail = null,
} = {}) {
  const calls = [];
  const feed = {
    activities,
    isLoading: false,
    error: null,
    hasNextPage: hasMore,
    isFetchingNextPage: false,
    refetch: async () => {},
    fetchNextPage: async () => calls.push("older"),
  };
  const weeks = participants.map((member) => ({
    id: `week-${member.userId}`,
    challenge_id: "challenge",
    user_id: member.userId,
    week_number: 1,
    week_start: "2026-10-12",
    week_end: "2026-10-18",
    finalized_at: "2026-10-19T00:00:00Z",
    target_km: 15,
    equivalent_km: 3,
    completed: false,
    paused: false,
    penalty_eur: 15,
  }));
  const lib = {
    ...C,
    useMyChallenge: () => q(challenge),
    useChallengeMembers: () => q(participants),
    useTravelPauses: () => q([]),
    useWeeks: () => q(weeks),
    useWeekTargets: () => q([]),
    usePayments: () => q([]),
    useOutgoingInvitation: () => q({ accepted_at: "2026-10-01" }),
    useActivitySummary: () => q([]),
    useActivities: (id, range) => {
      calls.push([id, range]);
      return feed;
    },
    useActivity: () => q(detail),
    todayIn: () => "2026-10-13",
    weekNumberOf: () => 1,
    hoursLeft: () => 48,
  };
  const file = detail
    ? "src/routes/_authenticated/challenge/activity.$activityId.tsx"
    : history
      ? "src/routes/_authenticated/challenge/history_.week.$weekNumber.tsx"
      : "src/routes/_authenticated/challenge/index.tsx";
  const ui = accountUI(file, "Route", {
    "@tanstack/react-router": {
      createFileRoute: () => (options) => ({
        options,
        useSearch: () => ({}),
        useParams: () => ({ weekNumber: "1", activityId: detail?.id }),
      }),
      Link: "Link",
      useNavigate: () => async () => {},
    },
    "@tanstack/react-query": {
      useQueryClient: () => ({ invalidateQueries: async () => {}, prefetchQuery: async () => {} }),
    },
    "@/lib/auth": { useAuth: () => ({ user: { id: "me" } }) },
    "@/lib/challenge": lib,
    "@/lib/privileged-rpcs.functions": { finalizeChallenge: async () => {} },
    "@/lib/challenge-participation": {
      challengeParticipation: () => "accepted",
      usePendingChallengeRefresh: () => 0,
    },
    "@/lib/bulk-access": { accountProductMode: () => "fitness", useMemberships: () => q([]) },
    "@/components/PageSkeleton": {
      PageSkeleton: "PageSkeleton",
      ActivityFeedSkeleton: "ActivityFeedSkeleton",
    },
    "@/components/ChallengeInvite": {},
    "@/components/ChallengeWaiting": {},
    "@/components/MainPageHeader": { MainPageHeader: "MainPageHeader" },
    "@/components/StreakFlame": {},
    "@/components/ChallengeParticipant": {
      ChallengeParticipantHeading: "ParticipantHeading",
      ChallengeStatus: "ChallengeStatus",
    },
    "@/components/ChallengeWeekExceptions": { ChallengeWeekExceptions: "ChallengeWeekExceptions" },
    "@/components/ChallengeInvitations": { ChallengeInvitations: "ChallengeInvitations" },
    "@/components/ChallengeEvidenceViewer": { ChallengeEvidenceViewer: "ChallengeEvidenceViewer" },
    "@/lib/countries": { countryName: (name) => name },
    "@/lib/challenge-evidence": { evidenceWeekFinalized },
    "@/lib/safe-url": { safeStravaUrl: () => null },
    "@/lib/network-errors": {},
    "@/integrations/supabase/client": {},
  });
  return { ui, calls };
}
const rows = (ui) =>
  ui.find("Link").filter((node) => node.props.to === "/challenge/activity/$activityId");
const groups = (ui) => ui.find("div").filter((node) => node.props.children?.[0]?.type === "h3");

test("active Challenge groups both participants with correct attribution, metrics and authoritative contributions", () => {
  const { ui } = screen();
  const sides = groups(ui);
  assert.equal(sides.length, 2);
  assert.match(textOf(sides[0]), /You.*Run · 3.1 km.*5:00 \/km.*\+3.1/s);
  assert.match(textOf(sides[1]), /Alex.*Ride · 9.0 km.*21.6 km\/h.*\+3.0/s);
  assert.equal(rows(ui).length, 2);
  assert.equal(
    ui.find("ChallengeEvidenceViewer").length,
    0,
    "listing never signs or displays evidence",
  );
});

test("the row uses stored contribution even when timing would produce another qualification", () => {
  const { ui } = screen({
    activities: [activity("opponent", { duration_seconds: 5000, qualifying_equivalent_km: 2.75 })],
  });
  assert.match(textOf(rows(ui)[0]), /\+2.8/);
});

for (const empty of ["me", "opponent"]) {
  test(`${empty} empty side stays visible while the other participant's entries render`, () => {
    const { ui } = screen({ activities: [activity(empty === "me" ? "opponent" : "me")] });
    assert.equal(groups(ui).length, 2);
    assert.equal(rows(ui).length, 1);
    assert.match(ui.text(), /No runs or rides yet this week/);
  });
}

test("unloaded pages do not produce a false empty-participant claim; pagination stays shared", async () => {
  const { ui, calls } = screen({ activities: [activity()], hasMore: true });
  assert.match(ui.text(), /Load older to see any remaining activities/);
  assert.doesNotMatch(ui.text(), /No runs or rides yet/);
  await ui.button("Load older").props.onClick();
  assert.equal(calls.filter((call) => call === "older").length, 1);
});

test("active list excludes other Challenges and non-participants without extra per-activity queries", () => {
  const { ui, calls } = screen({
    activities: [
      activity(),
      ride,
      activity("outsider"),
      activity("opponent", { id: "other-challenge", challenge_id: "other" }),
    ],
  });
  const links = rows(ui);
  assert.deepEqual(
    links.map((node) => node.props.params.activityId),
    ["me-run", "opponent-ride"],
  );
  assert.ok(
    calls.every(
      ([id, range]) =>
        id === "challenge" && range.start === "2026-10-12" && range.end === "2026-10-18",
    ),
  );
});

test("completed week keeps both participants' existing rows read-only with one shared week query", () => {
  const { ui, calls } = screen({ history: true });
  assert.match(ui.text(), /Finalized and read-only|Activities/);
  assert.equal(ui.find("article").length, 2);
  const cards = ui.find("Card").filter((node) => textOf(node).includes("Activities"));
  assert.equal(cards.length, 2);
  assert.match(textOf(cards[0]), /Alex.*9 km Cycle.*3.00 eq/s);
  assert.match(textOf(cards[1]), /Me.*3.1 km Run.*3.10 eq/s);
  assert.equal(ui.find("Link").filter((node) => node.props.to === "/challenge/add").length, 0);
  assert.equal(ui.find("button").filter((node) => /Edit|Delete/.test(textOf(node))).length, 0);
  assert.ok(
    calls.every(
      ([id, range]) =>
        id === "challenge" && range.start === "2026-10-12" && range.end === "2026-10-18",
    ),
  );
});

test("opponent detail reuses the authorized evidence flow and never offers edit/delete", () => {
  const { ui } = screen({ detail: ride });
  assert.equal(ui.find("ChallengeEvidenceViewer").length, 1);
  assert.equal(ui.find("Link").filter((node) => node.props.to === "/challenge/add").length, 0);
  assert.equal(ui.find("button").filter((node) => /Delete/.test(textOf(node))).length, 0);
  assert.match(ui.text(), /Only the person who logged this activity can edit it/);
});
