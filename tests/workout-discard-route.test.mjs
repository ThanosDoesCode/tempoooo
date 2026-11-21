import { test } from "node:test";
import assert from "node:assert/strict";
import { createMemoryHistory } from "@tanstack/history";
import { safeBack, trackInAppHistory } from "../src/lib/in-app-back.ts";
import { accountUI } from "./account-ui-fixture.mjs";

function fixture({
  history = createMemoryHistory({ initialEntries: ["/bulk/workout/session"] }),
  data = null,
} = {}) {
  trackInAppHistory(history);
  const queries = [];
  const ui = accountUI("src/routes/_authenticated/bulk/workout.$sessionId.tsx", "Route", {
    "@tanstack/react-router": {
      useRouter: () => ({ history }),
      createFileRoute: () => (options) => ({
        options,
        useParams: () => ({ sessionId: "session" }),
      }),
    },
    "@/components/BulkWorkoutSession": { BulkWorkoutSessionView: "BulkWorkoutSessionView" },
    "@/components/ui-kit": { DataError: "DataError" },
    "@/lib/bulk-training-sessions": {
      useBulkTrainingSession(id) {
        queries.push(id);
        return { data: id ? data : null, isLoading: false, error: null };
      },
    },
    "@/lib/store": { useBulkMeta: () => ({ bulkId: "profile" }) },
    "@/lib/bulk-progression-query": { useBulkProgressionTargets: () => ({}) },
    "@/lib/network-errors": {},
  });
  return { ui, queries, history };
}

test("a successful local discard renders a terminal state before the now-missing session can render unavailable", () => {
  const f = fixture({ data: { id: "session", exercises: [] } });
  try {
    const workout = f.ui.find("BulkWorkoutSessionView")[0];
    assert.ok(workout);
    workout.props.onDiscarded();
    assert.match(f.ui.text(), /Workout discarded/);
    assert.doesNotMatch(f.ui.text(), /Workout unavailable/);
    assert.equal(f.ui.find("BulkWorkoutSessionView").length, 0);
    assert.equal(f.queries.at(-1), null, "deleted session is no longer queried or resumable");
    assert.equal(f.ui.find("HistoryBackLink")[0].props.fallback, "/bulk/training");
  } finally {
    f.ui.dispose();
    f.history.destroy();
  }
});

test("revisiting a retired workout URL cannot fetch or resume deleted data", async () => {
  const history = createMemoryHistory({ initialEntries: ["/bulk/workout/session"] });
  trackInAppHistory(history);
  await safeBack(
    { history, navigate: async ({ href }) => history.replace(href) },
    "/bulk/training",
    { completed: true, terminalPath: "/bulk/workout/session" },
  );
  history.push("/bulk/workout/session");
  const f = fixture({ history, data: { id: "session", exercises: [] } });
  try {
    assert.match(f.ui.text(), /Workout discarded/);
    assert.doesNotMatch(f.ui.text(), /Workout unavailable/);
    assert.ok(f.queries.every((id) => id === null));
    assert.equal(f.ui.find("BulkWorkoutSessionView").length, 0);
  } finally {
    f.ui.dispose();
    history.destroy();
  }
});

test("a genuinely missing or unauthorized deep-linked session still renders its legitimate unavailable error", () => {
  const f = fixture();
  try {
    assert.match(f.ui.text(), /Workout unavailable/);
    assert.match(f.ui.text(), /does not exist or does not belong to your Goal/);
    assert.doesNotMatch(f.ui.text(), /Workout discarded/);
    assert.ok(f.queries.every((id) => id === "session"));
  } finally {
    f.ui.dispose();
    f.history.destroy();
  }
});
