import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { accountUI } from "./account-ui-fixture.mjs";
import { presentationComponent } from "./presentation-component-fixture.mjs";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

// ---------------------------------------------------------------- lib: query/rpc wiring
const lib = (rpc) =>
  presentationComponent("src/lib/challenge-adjustments.ts", {
    "@tanstack/react-query": { queryOptions: (x) => x, useQuery: () => ({}) },
    "@/integrations/supabase/client": { supabase: { rpc } },
  });

test("manualResolutionMessage maps each backend flag; null when nothing needs attention", () => {
  const { manualResolutionMessage } = lib(async () => ({ data: null, error: null }));
  assert.match(
    manualResolutionMessage({ payment_manual_resolution_required: true }),
    /payment was already settled and was not changed/,
  );
  assert.match(
    manualResolutionMessage({ photo_manual_resolution_required: true }),
    /photo obligation may need manual review/,
  );
  assert.match(
    manualResolutionMessage({ streak_manual_resolution_required: true }),
    /Streak history needs manual review/,
  );
  assert.equal(manualResolutionMessage({ week_corrected: true }), null);
});

test("request/cancel/review call the right RPCs; note is omitted when empty and the request id is passed", async () => {
  const calls = [];
  const { requestChallengeException, cancelChallengeException, reviewChallengeException } = lib(
    async (name, args) => {
      calls.push([name, args]);
      return { data: name === "cancel_challenge_week_exception" ? true : "x", error: null };
    },
  );
  await requestChallengeException("c", 3, "sick", null, "req-1");
  await requestChallengeException("c", 3, "late_completion", "hurt my knee", "req-2");
  await cancelChallengeException("adj-1");
  await reviewChallengeException("adj-2", true);

  const req1 = calls[0];
  assert.equal(req1[0], "request_challenge_week_exception");
  assert.equal(req1[1]._request_id, "req-1");
  assert.equal("_note" in req1[1], false, "empty note is omitted, not sent as undefined");
  assert.equal(calls[1][1]._note, "hurt my knee");
  assert.equal(calls[2][0], "cancel_challenge_week_exception");
  assert.equal(calls[2][1]._adjustment, "adj-1");
  assert.equal(calls[3][0], "review_challenge_week_exception");
  assert.equal(calls[3][1]._adjustment, "adj-2");
  assert.equal(calls[3][1]._approve, true);
});

// ---------------------------------------------------------------- component states
const MANUAL = {
  manualResolutionMessage: (r) =>
    r.payment_manual_resolution_required
      ? "Result corrected. The payment was already settled and was not changed."
      : null,
};

function fixture({
  adjustments = [],
  kind = "sick",
  eligible = true,
  review,
  cancel,
  request,
} = {}) {
  const calls = [];
  const ui = accountUI(
    "src/components/ChallengeWeekExceptions.tsx",
    "ChallengeWeekExceptions",
    {
      "@tanstack/react-query": { useQueryClient: () => ({ invalidateQueries: async () => {} }) },
      "@/lib/network-errors": { userFacingError: (_e, a) => `Could not ${a}.` },
      "@/lib/challenge-adjustments": {
        useChallengeAdjustments: () => ({ data: adjustments }),
        requestChallengeException:
          request ?? (async (...a) => (calls.push(["request", ...a]), "new")),
        cancelChallengeException: cancel ?? (async (...a) => (calls.push(["cancel", ...a]), true)),
        reviewChallengeException:
          review ?? (async (...a) => (calls.push(["review", ...a]), { week_corrected: true })),
        ...MANUAL,
      },
    },
    { challengeId: "c", week: 3, kind, userId: "me", opponentName: "Alex", eligible },
  );
  return { ui, calls };
}
const btn = (ui, label) =>
  ui.find("button").find((n) => {
    const kids = Array.isArray(n.props.children) ? n.props.children : [n.props.children];
    return kids.filter((c) => typeof c === "string").join("") === label;
  });

test("eligible with nothing pending offers the request action for each kind", () => {
  assert.ok(btn(fixture({ kind: "sick" }).ui, "Sick this week"));
  assert.ok(btn(fixture({ kind: "late_completion" }).ui, "Submit late completion"));
});

test("my pending request shows a cancel control and never an approve", () => {
  const { ui } = fixture({
    adjustments: [{ id: "a", week_number: 3, kind: "sick", user_id: "me", status: "pending" }],
  });
  assert.match(ui.text(), /Sick request pending/);
  assert.ok(btn(ui, "Cancel request"));
  assert.equal(btn(ui, "Approve"), undefined, "requester cannot approve their own request");
});

test("opponent's pending sick request shows a review card with Approve/Reject", () => {
  const { ui } = fixture({
    adjustments: [{ id: "a", week_number: 3, kind: "sick", user_id: "opp", status: "pending" }],
  });
  assert.match(ui.text(), /Alex requested a sick week/);
  assert.ok(btn(ui, "Approve"));
  assert.ok(btn(ui, "Reject"));
});

test("opponent's pending late completion shows Confirm completion for the correct week", () => {
  const { ui } = fixture({
    kind: "late_completion",
    adjustments: [
      {
        id: "a",
        week_number: 3,
        kind: "late_completion",
        user_id: "opp",
        status: "pending",
        note: "ran 16k",
      },
    ],
  });
  assert.match(ui.text(), /Alex submitted a late completion for Week 3/);
  assert.match(ui.text(), /ran 16k/);
  assert.ok(btn(ui, "Confirm completion"));
});

test("an approved adjustment hides the request/review controls (label shown on the week)", () => {
  const { ui } = fixture({
    adjustments: [{ id: "a", week_number: 3, kind: "sick", user_id: "me", status: "approved" }],
  });
  assert.equal(btn(ui, "Sick this week"), undefined);
  assert.equal(btn(ui, "Approve"), undefined);
});

test("approving surfaces the backend manual-resolution message, not a fake success", async () => {
  const { ui } = fixture({
    adjustments: [{ id: "a", week_number: 3, kind: "sick", user_id: "opp", status: "pending" }],
    review: async () => ({ payment_manual_resolution_required: true, week_corrected: true }),
  });
  btn(ui, "Approve").props.onClick();
  await ui.flush();
  assert.match(ui.text(), /payment was already settled and was not changed/);
});

// ---------------------------------------------------------------- money: cancelled handling
test("cancelled payments are excluded from totals and shown without settlement controls", async () => {
  const money = await read("src/routes/_authenticated/challenge/money.tsx");
  assert.match(money, /p\.status !== "confirmed_paid" && p\.status !== "cancelled"/);
  assert.match(money, /const cancelled = rows\.filter\(\(p\) => p\.status === "cancelled"\)/);
  assert.match(money, />Cancelled</);
  // The cancelled group renders no mark-paid/confirm/undo controls (no PaymentItem, no onConfirm there).
  const cancelledBlock = money.split("cancelled.length ?")[1]?.split("{error ?")[0] ?? "";
  assert.doesNotMatch(cancelledBlock, /PaymentItem|onMarkPaid|onConfirm|onReject/);
});

// ---------------------------------------------------------------- history labels
test("history shows Sick · excused for an approved sick week, not a plain failure", async () => {
  const history = await read("src/routes/_authenticated/challenge/history.tsx");
  assert.match(history, /excuse_reason === "sick"/);
  assert.match(history, /Sick · excused/);
  const detail = await read("src/routes/_authenticated/challenge/history_.week.$weekNumber.tsx");
  assert.match(detail, /Sick · excused/);
  assert.match(detail, /Late completion approved/);
});
