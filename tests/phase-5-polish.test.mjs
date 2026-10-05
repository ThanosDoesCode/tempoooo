import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createMemoryHistory } from "@tanstack/history";
import { trackInAppHistory, backWithinApp } from "../src/lib/in-app-back.ts";
import { isFocusScreen } from "../src/lib/main-navigation.ts";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

for (const [origin, destination] of [
  ["/bulk/training", "/bulk/prs"],
  ["/bulk/progress", "/bulk/prs"],
  ["/bulk/training", "/bulk/training/history"],
  ["/bulk/training/more", "/bulk/exercises"],
]) {
  test(`Phase 5 Back returns ${destination} to its actual origin ${origin}`, () => {
    const history = createMemoryHistory({ initialEntries: [origin] });
    trackInAppHistory(history);
    trackInAppHistory(history); // Shared initialization is idempotent.
    history.push(destination);
    assert.ok(backWithinApp(history));
    assert.equal(history.location.pathname, origin);
    history.forward();
    assert.equal(history.location.pathname, destination);
  });
}

test("Phase 5 direct PR deep link cannot go back to an unobserved or external entry", () => {
  const history = createMemoryHistory({
    initialEntries: ["/unknown", "/bulk/prs"],
    initialIndex: 1,
  });
  trackInAppHistory(history);
  assert.equal(backWithinApp(history), false);
  assert.equal(history.location.pathname, "/bulk/prs");
});

test("Phase 5 Back follows replace, Back/Forward and branched history without stale parents", () => {
  const history = createMemoryHistory({ initialEntries: ["/bulk/training"] });
  trackInAppHistory(history);
  history.push("/bulk/prs");
  history.replace("/bulk/prs?exercise=press");
  assert.ok(backWithinApp(history));
  history.push("/bulk/training/more");
  history.push("/bulk/exercises");
  assert.ok(backWithinApp(history));
  assert.equal(history.location.pathname, "/bulk/training/more");
  assert.ok(backWithinApp(history));
  assert.equal(history.location.pathname, "/bulk/training");
});

test("Phase 5 Back after account setup uses its fallback instead of reopening onboarding", () => {
  const history = createMemoryHistory({ initialEntries: ["/onboarding"] });
  trackInAppHistory(history);
  history.push("/bulk/prs");
  assert.equal(backWithinApp(history), false);
});

test("Phase 5 PR/history/library use shared history-aware links with safe Training fallback", async () => {
  for (const route of ["prs", "training_.history", "exercises", "training_.more"]) {
    const source = await read(`src/routes/_authenticated/bulk/${route}.tsx`);
    assert.match(source, /historyBack/);
    assert.match(source, /backTo="\/bulk\/training"/);
    assert.doesNotMatch(source, /backTo="\/bulk\/progress"/);
  }
  const shell = await read("src/components/AppShell.tsx");
  const link = await read("src/components/HistoryBackLink.tsx");
  const router = await read("src/router.tsx");
  assert.match(shell, /HistoryBackLink\s+fallback=\{backTo\}/);
  assert.match(link, /backWithinApp\(router.history\)/);
  assert.match(link, /event\.metaKey.*event\.ctrlKey.*event\.shiftKey.*event\.altKey/);
  assert.match(link, /to=\{previous \?\? fallback\}/);
  assert.match(router, /trackInAppHistory\(router.history\)/);
  assert.doesNotMatch(link, /location\.(reload|href|assign)/);
});

test("Phase 5 workout polish keeps fields/drawers and constrains discard to a compact modal", async () => {
  const workout = await read("src/components/BulkWorkoutSession.tsx");
  assert.match(workout, /workout-set-grid/);
  for (const value of [
    "bilateralWeight",
    "bilateralReps",
    "leftWeight",
    "rightWeight",
    "rpeDraft",
    "SET_TYPES.map",
    "Previous:",
    "Next-session guidance",
    '"Finish"',
  ])
    assert.ok(workout.includes(value), value);
  assert.doesNotMatch(
    workout,
    /Done with set|Cycles normal|\(index \+ 1\) % SET_TYPES.length|100px\+env/,
  );
  assert.match(workout, /<Drawer open=\{typeOpen\} onOpenChange=\{setTypeOpen\} autoFocus/);
  assert.match(workout, /w-\[calc\(100%-2rem\)\] max-w-sm rounded-\[20px\]/);
  assert.match(workout, /Discard this workout\?/);
  assert.match(workout, /Keep workout/);
  assert.match(workout, /bg-danger text-white/);
  assert.match(workout, /sm:w-auto/);
  assert.ok(isFocusScreen("/bulk/workout/session"));
  assert.equal(isFocusScreen("/bulk/training"), false);
  assert.equal(isFocusScreen("/bulk/training/more"), false);
});

test("Phase 5 overview and plan management retain actions with compact expandable detail", async () => {
  const training = await read("src/routes/_authenticated/bulk/training.tsx");
  const more = await read("src/routes/_authenticated/bulk/training_.more.tsx");
  const setup = await read("src/components/TrainingPlanSetup.tsx");
  assert.match(training, /Workout in progress/);
  assert.match(training, /params=\{\{ sessionId: activeSession.data.id \}\}/);
  assert.match(training, /<NavRows/);
  for (const label of ["Plan and setup", "Past workouts", "Personal records"])
    assert.ok(training.includes(label));
  assert.match(more, /TrainingPlanEditor/);
  assert.match(more, /Workout days/);
  assert.match(more, /Muscle coverage/);
  assert.match(more, /showCurrentPlan=\{false\}/);
  assert.match(setup, /expanded \? <PlanDetail plan=\{plan\}/);
  assert.match(setup, /selectionDisabled \|\| mode !== "tempo_preset"\) return/);
  assert.match(setup, /Build my own plan/);
  assert.match(setup, /Setup options/);
});
