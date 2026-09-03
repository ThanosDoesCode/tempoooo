import { test } from "node:test";
import assert from "node:assert/strict";
import { parseDecimal, normalizeDecimal, decimalError } from "../src/lib/numeric.ts";
import { DEFAULT_DATA, EXERCISES } from "../src/lib/types.ts";
import {
  bodyweightOn,
  createWorkout,
  updateExercise,
  effectiveLoad,
  exerciseMetrics,
  workoutMetrics,
  completeWorkout,
  workoutDuration,
  trainingTotals,
  bestRecentSet,
  notesPreview,
  volumeMultiplier,
  bodyweightMode,
  repeatPreviousSet,
  repeatPreviousWorkoutSet,
  restSecondsRemaining,
  setSessionBodyweight,
} from "../src/lib/training.ts";
import { progressionFor, exerciseHistory, previousEntry } from "../src/lib/calc.ts";
import { createSaveQueue } from "../src/lib/workout-save.ts";
import {
  cacheWorkoutDraft,
  clearWorkoutDraft,
  readWorkoutDraft,
} from "../src/lib/workout-draft.ts";

const data = (workouts = [], days = {}) => ({
  ...structuredClone(DEFAULT_DATA),
  days,
  workouts: Object.fromEntries(workouts.map((w) => [w.date, w])),
});
const entry = (exercise = "Cable Rows", weight = 20, reps = [10, 8, 7]) => ({
  exercise,
  weight,
  reps,
});
const bw = (bodyweight = 62, reps = [10, 8, 7], exercise = "Pull-Ups", addedWeight = 0) => ({
  exercise,
  bodyweight,
  addedWeight,
  reps,
});
const workout = (date, entries, extra = {}) => ({ date, type: "Chest & Back", entries, ...extra });
const compare = (previous, current) =>
  progressionFor(data([workout("2026-08-20", [previous])]), current, "2026-08-31");

for (const [raw, value] of [
  ["61,5", 61.5],
  ["61.5", 61.5],
  [" 7,25 ", 7.25],
  ["7.25", 7.25],
  ["61,", 61],
  ["0", 0],
  [" ,5 ", 0.5],
]) {
  test(`decimal parses ${JSON.stringify(raw)} as ${value}`, () => {
    assert.deepEqual(parseDecimal(raw), { kind: "value", value });
    assert.equal(normalizeDecimal(raw), String(value));
  });
}
test("invalid and empty decimals never silently become zero", () => {
  for (const raw of [
    "abc",
    "1,2,3",
    "61kg",
    "Infinity",
    "NaN",
    "1e4",
    "0x10",
    "--2",
    "1.2,3",
    "1 000",
    "-",
    ".",
  ]) {
    assert.equal(parseDecimal(raw).kind, "invalid");
    assert.equal(normalizeDecimal(raw), raw);
  }
  assert.deepEqual(parseDecimal("  "), { kind: "empty" });
  assert.match(decimalError(parseDecimal("1,5"), { integer: true }), /whole/);
  assert.match(decimalError(parseDecimal("-1"), { min: 0 }), /or more/);
});
test("bodyweight lookup excludes future, nonfinite, zero and negative readings", () => {
  const d = data(
    [],
    Object.fromEntries(
      [
        ["2026-08-18", 62],
        ["2026-08-20", 63],
        ["2026-08-21", NaN],
        ["2026-08-22", 0],
        ["2026-08-23", -5],
        ["2026-09-01", 65],
      ].map(([date, weight]) => [date, { date, weight }]),
    ),
  );
  assert.equal(bodyweightOn(d, "2026-08-31"), 63);
  assert.equal(bodyweightOn(d, "2026-08-18"), 62);
  assert.equal(bodyweightOn(d, "2026-08-17"), undefined);
});
test("new session bodyweight is snapshotted and survives changed daily weights and JSON reload", () => {
  const d = data([], { "2026-08-31": { date: "2026-08-31", weight: 62 } });
  const w = createWorkout(d, "2026-08-31", "Chest & Back");
  d.days["2026-08-31"].weight = 65;
  const restored = JSON.parse(JSON.stringify(w));
  assert.equal(restored.entries.find((e) => e.exercise === "Pull-Ups").bodyweight, 62);
  const overridden = updateExercise(restored, "Pull-Ups", { bodyweight: 64.5, addedWeight: 2.5 });
  assert.equal(effectiveLoad(overridden.entries.find((e) => e.exercise === "Pull-Ups")), 67);
});
test("new programs append abs after every original Legs and Arms exercise", () => {
  assert.deepEqual(
    EXERCISES.Legs.slice(-2).map((e) => e.name),
    ["Cable Crunches", "Hanging Leg Raises"],
  );
  assert.deepEqual(
    EXERCISES["Arms & Shoulders"].slice(-2).map((e) => e.name),
    ["Cable Crunches", "Hanging Leg Raises"],
  );
  for (const required of ["Leg Curls", "Calf Raises"])
    assert.ok(EXERCISES.Legs.some((e) => e.name === required));
  assert.ok(EXERCISES["Arms & Shoulders"].some((e) => e.name === "Lateral Raises"));
  const old = workout("2026-08-20", [entry("Calf Raises")], { status: "completed", type: "Legs" });
  assert.deepEqual(
    JSON.parse(JSON.stringify(old)).entries.map((e) => e.exercise),
    ["Calf Raises"],
  );
});
test("bodyweight modes preserve effective load without double counting", () => {
  const base = { ...bw(62), loadMode: "bodyweight" };
  assert.equal(bodyweightMode(base), "bodyweight");
  assert.equal(effectiveLoad({ ...base, addedWeight: 10, assistance: 15 }), 62);
  assert.equal(effectiveLoad({ ...base, loadMode: "added", addedWeight: 5 }), 67);
  assert.equal(effectiveLoad({ ...base, loadMode: "assisted", assistance: 15 }), 47);
  const hanging = createWorkout(
    data([], { "2026-08-31": { date: "2026-08-31", weight: 62 } }),
    "2026-08-31",
    "Legs",
  ).entries.find((e) => e.exercise === "Hanging Leg Raises");
  assert.equal(hanging.loadMode, "bodyweight");
  assert.equal(effectiveLoad(hanging), 62);
  assert.equal(effectiveLoad({ ...hanging, loadMode: "added", addedWeight: 3 }), 65);
});
test("session bodyweight updates every bodyweight exercise snapshot", () => {
  const w = setSessionBodyweight(createWorkout(data(), "2026-08-31", "Legs"), 63.5);
  assert.equal(w.sessionBodyweight, 63.5);
  assert.ok(
    w.entries
      .filter((e) => ["Hanging Leg Raises"].includes(e.exercise))
      .every((e) => e.bodyweight === 63.5),
  );
});
test("Same copies only the previous current-session set and never overwrites", () => {
  const original = {
    ...bw(62, [10, undefined, undefined]),
    loadMode: "added",
    addedWeight: 5,
    rpe: 9,
    notes: "keep",
  };
  const second = repeatPreviousSet(original, 1);
  assert.deepEqual(second.reps, [10, 10, undefined]);
  assert.equal(second.loadMode, "added");
  assert.equal(second.addedWeight, 5);
  assert.equal(second.rpe, 9);
  assert.equal(second.notes, "keep");
  const third = repeatPreviousSet(second, 2);
  assert.deepEqual(third.reps, [10, 10, 10]);
  assert.equal(repeatPreviousSet({ ...third, reps: [10, 8, 7] }, 2).reps[2], 7);
  assert.equal(repeatPreviousSet(original, 0), original);
  const assisted = repeatPreviousSet(
    { ...original, loadMode: "assisted", addedWeight: 0, assistance: 15 },
    1,
  );
  assert.equal(assisted.assistance, 15);
});
test("Same changes only local set data and preserves workout timing and exercise metadata", () => {
  const original = workout(
    "2026-08-31",
    [
      {
        ...bw(62, [10, undefined, undefined]),
        loadMode: "added",
        addedWeight: 5,
        notes: "Neutral grip",
        rpe: 8,
      },
    ],
    { status: "draft", sessionBodyweight: 62 },
  );
  const repeated = repeatPreviousWorkoutSet(original, "Pull-Ups", 1);
  assert.deepEqual(repeated.entries[0].reps, [10, 10, undefined]);
  assert.equal(repeated.entries[0].loadMode, "added");
  assert.equal(repeated.entries[0].addedWeight, 5);
  assert.equal(repeated.entries[0].bodyweight, 62);
  assert.equal(repeated.entries[0].notes, "Neutral grip");
  assert.equal(repeated.entries[0].rpe, 8);
  assert.equal(repeated.startedAt, undefined);
  assert.equal(repeated.durationSeconds, undefined);
  assert.equal(repeated.status, "draft");
  assert.equal(repeatPreviousWorkoutSet(repeated, "Pull-Ups", 1), repeated);
});
test("rest timer derives remaining time from its deadline after background gaps", () => {
  assert.equal(restSecondsRemaining(120_000, 0), 120);
  assert.equal(restSecondsRemaining(120_000, 91_500), 29);
  assert.equal(restSecondsRemaining(120_000, 130_000), 0);
});
for (const exercise of ["Pull-Ups", "Chin-Ups"]) {
  test(`${exercise} maintained reps at 62→65 kg progress with load PRs`, () => {
    const r = compare(bw(62, [10, 8, 7], exercise), bw(65, [10, 8, 7], exercise));
    assert.equal(r.state, "progressed");
    assert.match(r.explanation, /Same reps at \+3 kg bodyweight/);
    assert.deepEqual(r.prs, ["🏆 Weight PR", "🏆 Volume PR"]);
  });
}
test("added weight and optional assistance affect effective load and volume", () => {
  const e = { ...bw(62, [10, 8, 7], "Pull-Ups", 10), assistance: 5 };
  assert.equal(effectiveLoad(e), 67);
  assert.equal(exerciseMetrics(e).volume, 1675);
  assert.equal(effectiveLoad({ ...e, assistance: 100 }), null);
});
test("bodyweight higher load with a reasonable rep drop rebuilds; a severe drop is not progress", () => {
  const p = bw(62, [10, 8, 7]);
  const r = compare(p, bw(62, [8, 7, 5], "Pull-Ups", 2.5));
  assert.equal(r.state, "progressed");
  assert.match(r.hint, /Rebuild reps from 5/);
  assert.equal(compare(p, bw(62, [5, 5, 5], "Pull-Ups", 2.5)).state, "regressed");
  assert.equal(compare(p, bw(62, [10, undefined, undefined], "Pull-Ups", 2.5)).state, "baseline");
});
test("bodyweight same-load thresholds and set completion are preserved", () => {
  assert.equal(compare(bw(), bw(62, [10, 9, 8])).state, "progressed");
  assert.equal(compare(bw(), bw(62, [10, 8, 8])).state, "same");
  assert.equal(compare(bw(), bw(62, [9, 7, 6])).state, "regressed");
  assert.equal(compare(bw(), bw(62, [10, 10, 10])).readyForWeight, true);
});
test("legacy bodyweight stays unknown and does not invent volume or a load comparison", () => {
  const legacy = entry("Pull-Ups", 0);
  assert.equal(effectiveLoad(legacy), null);
  assert.equal(exerciseMetrics(legacy).volume, null);
  assert.equal(compare(legacy, bw()).state, "baseline");
  const d = data([workout("2026-08-20", [legacy])], {
    "2026-08-31": { date: "2026-08-31", weight: 65 },
  });
  assert.equal(exerciseHistory(d, "Pull-Ups")[0].weight, null);
  assert.equal(bestRecentSet(d, "Pull-Ups", "2026-08-31"), null);
});
test("two dumbbells: 16kg × 10 = 320kg; three sets and workout volumes add correctly", () => {
  assert.equal(exerciseMetrics(entry("Incline Dumbbell Press", 16, [10])).volume, 320);
  const press = entry("Incline Dumbbell Press", 16, [10, 9, 8]);
  assert.deepEqual(exerciseMetrics(press), { workingSets: 3, totalReps: 27, volume: 864 });
  assert.deepEqual(
    workoutMetrics(workout("2026-08-31", [press, entry("Cable Rows", 20, [10, 10, 10]), bw()])),
    { workingSets: 9, totalReps: 82, volume: 3014 },
  );
});
test("only confirmed dumbbell pair exercises multiply load; machines use displayed load", () => {
  for (const e of Object.values(EXERCISES).flat())
    assert.equal(
      volumeMultiplier(e.name),
      ["Incline Dumbbell Press", "Incline Dumbbell Curls"].includes(e.name) ? 2 : 1,
    );
  assert.equal(exerciseMetrics(entry("Incline Dumbbell Curls", 7.25, [10])).volume, 145);
  assert.equal(exerciseMetrics(entry("Cable Rows", 7.25, [10])).volume, 72.5);
});
test("unlogged/invalid sets do not count; missing loads leave volume unavailable", () => {
  assert.deepEqual(exerciseMetrics(entry("Cable Rows", undefined, [0, undefined, -1, NaN, 2.5])), {
    workingSets: 0,
    totalReps: 0,
    volume: 0,
  });
  assert.equal(exerciseMetrics({ exercise: "Cable Rows", reps: [10] }).volume, null);
});
test("completed aggregates respect Monday, month/year boundaries and exclude future/draft/legacy/empty", () => {
  const done = (date, extra = {}) =>
    workout(date, [entry("Cable Rows", 20, [10])], { status: "completed", ...extra });
  const d = data([
    done("2025-12-31"),
    done("2026-08-01"),
    done("2026-08-30"),
    done("2026-08-31"),
    done("2026-09-01"),
    done("2026-08-29", { status: "draft" }),
    done("2026-08-28", { status: undefined }),
    workout("2026-08-27", [], { status: "completed" }),
  ]);
  const t = trainingTotals(d, new Date(2026, 7, 31));
  assert.equal(t.week.count, 1);
  assert.equal(t.week.volume, 200);
  assert.equal(t.month.count, 3);
  assert.equal(t.month.volume, 600);
  assert.equal(t.allTime.count, 4);
  assert.equal(t.allTime.volume, 800);
  assert.equal(t.legacyCount, 1);
  const sep = trainingTotals(d, new Date(2026, 8, 1));
  assert.equal(sep.week.count, 2);
  assert.equal(sep.month.count, 1);
});
test("unknown volume is not reported as a full total", () => {
  assert.equal(
    trainingTotals(
      data([workout("2026-08-31", [entry("Pull-Ups", 0)], { status: "completed" })]),
      new Date(2026, 7, 31),
    ).allTime.volume,
    null,
  );
});
test("notes preserve text, multiple tags and optional RPE through JSON", () => {
  const original = workout("2026-08-31", [{ ...bw(), notes: "Old note\nSecond line" }], {
    sessionNote: "Low energy",
  });
  const edited = updateExercise(original, "Pull-Ups", {
    noteTags: ["Good form", "Hard", "Pain/discomfort"],
    rpe: undefined,
  });
  const restored = JSON.parse(JSON.stringify(edited));
  assert.equal(restored.entries[0].notes, "Old note\nSecond line");
  assert.equal(restored.sessionNote, "Low energy");
  assert.match(notesPreview(restored.entries[0]), /Good form · Hard · Pain\/discomfort · Old note/);
  assert.equal(notesPreview(restored.entries[0]).includes("RPE"), false);
});
test("duration starts on first working set, survives reload/background, stops on completion", () => {
  const start = new Date("2026-08-31T10:00:00Z");
  let w = createWorkout(data(), "2026-08-31", "Chest & Back");
  w = updateExercise(w, "Incline Dumbbell Press", { weight: 16, notes: "Ready" }, start);
  assert.equal(workoutDuration(w, start), null);
  w = updateExercise(w, "Incline Dumbbell Press", { reps: [10, undefined, undefined] }, start);
  w = JSON.parse(JSON.stringify(w));
  const end = new Date("2026-08-31T10:42:00Z");
  assert.equal(workoutDuration(w, end), 2520);
  w = completeWorkout(w, end);
  assert.equal(w.durationSeconds, 2520);
  assert.equal(workoutDuration(w, new Date("2026-09-02")), 2520);
  assert.equal(
    updateExercise(w, "Incline Dumbbell Press", { notes: "After" }, new Date()).startedAt,
    start.toISOString(),
  );
});
test("duration corrections are separate; clearing restores timestamp duration; legacy duration unknown", () => {
  const w = workout("2026-08-31", [entry()], {
    status: "draft",
    startedAt: "2026-08-31T10:00:00Z",
    durationOverrideSeconds: 1800,
  });
  const done = completeWorkout(w, new Date("2026-08-31T11:00:00Z"));
  assert.equal(workoutDuration(done), 1800);
  assert.equal(workoutDuration({ ...done, durationOverrideSeconds: undefined }), 3600);
  const legacy = completeWorkout(workout("2026-08-20", [entry()]));
  assert.equal(legacy.durationSeconds, undefined);
  assert.equal(workoutDuration(legacy), null);
  assert.throws(() => completeWorkout(createWorkout(data(), "2026-08-31", "Legs")), /at least one/);
});
test("average duration uses known completed sessions only", () => {
  const t = trainingTotals(
    data([
      workout("2026-08-20", [entry()], { status: "completed", durationSeconds: 3600 }),
      workout("2026-08-21", [entry()], { status: "completed", durationOverrideSeconds: 1800 }),
      workout("2026-08-22", [entry()], { status: "completed" }),
      workout("2026-08-23", [entry()], { status: "draft", durationSeconds: 5 }),
    ]),
    new Date(2026, 7, 31),
  );
  assert.equal(t.allTime.averageDuration, 2700);
  assert.equal(t.allTime.timedCount, 2);
});
test("standard progression and Weight/Rep/Volume PRs retain original thresholds", () => {
  const p = entry();
  assert.equal(compare(p, entry("Cable Rows", 20, [10, 9, 8])).state, "progressed");
  assert.equal(compare(p, entry("Cable Rows", 20, [10, 8, 8])).state, "same");
  assert.equal(compare(p, entry("Cable Rows", 20, [9, 7, 6])).state, "regressed");
  assert.equal(compare(p, entry("Cable Rows", 19)).state, "regressed");
  assert.deepEqual(compare(p, entry("Cable Rows", 22)).prs, ["🏆 Weight PR", "🏆 Volume PR"]);
  assert.deepEqual(compare(p, entry("Cable Rows", 20, [11, 8, 7])).prs, [
    "🏆 Rep PR",
    "🏆 Volume PR",
  ]);
  assert.match(
    compare(p, entry("Cable Rows", 20, [10, 10, 8])).explanation,
    /\+3 total reps at the same load/,
  );
  assert.match(compare(p, entry("Cable Rows", 22)).explanation, /Same reps at \+2 kg/);
  assert.equal(compare(p, entry("Cable Rows", 20, [12, 12, 12])).readyForWeight, true);
});
test("legacy history still derives known volume and remains previous session; drafts do not", () => {
  const d = data([
    workout("2026-08-20", [entry("Incline Dumbbell Press", 16, [10, 9, 8])]),
    workout("2026-08-25", [entry("Incline Dumbbell Press", 50)], { status: "draft" }),
  ]);
  assert.equal(exerciseHistory(d, "Incline Dumbbell Press")[0].volume, 864);
  assert.equal(exerciseHistory(d, "Incline Dumbbell Press").length, 1);
  assert.equal(previousEntry(d, "Incline Dumbbell Press", "2026-08-31").date, "2026-08-20");
});
test("best recent set favors comparable reps and actual load, excluding drafts and old sessions", () => {
  const d = data([
    workout("2026-01-01", [entry("Incline Dumbbell Press", 100, [10])]),
    workout("2026-08-20", [entry("Incline Dumbbell Press", 16, [10])]),
    workout("2026-08-21", [entry("Incline Dumbbell Press", 18, [9])]),
    workout("2026-08-22", [entry("Incline Dumbbell Press", 30, [1])]),
    workout("2026-08-23", [entry("Incline Dumbbell Press", 25, [10])], { status: "draft" }),
  ]);
  const best = bestRecentSet(d, "Incline Dumbbell Press", "2026-08-31");
  assert.equal(best.load, 18);
  assert.equal(best.reps, 9);
  assert.equal(best.date, "2026-08-21");
});
test("save queue preserves draft/completion order even across failed writes", async () => {
  const queue = createSaveQueue();
  const order = [];
  let release;
  const first = queue(
    () =>
      new Promise((resolve) => {
        release = () => {
          order.push("draft");
          resolve();
        };
      }),
  );
  const fail = queue(async () => {
    order.push("failed");
    throw new Error("offline");
  });
  const rejected = assert.rejects(fail, /offline/);
  const last = queue(async () => {
    order.push("complete");
  });
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(order, []);
  release();
  await Promise.all([first, rejected, last]);
  assert.deepEqual(order, ["draft", "failed", "complete"]);
});
test("late saves cannot delete a newer device draft", () => {
  const storage = new Map();
  globalThis.localStorage = {
    getItem: (key) => storage.get(key) ?? null,
    setItem: (key, value) => storage.set(key, value),
    removeItem: (key) => storage.delete(key),
  };
  const old = workout("2026-08-31", [entry()], { status: "draft" });
  const newer = updateExercise(old, "Cable Rows", { reps: [11, 8, 7] });
  cacheWorkoutDraft("user-a:plan-a:date", old);
  cacheWorkoutDraft("user-a:plan-a:date", newer);
  clearWorkoutDraft("user-a:plan-a:date", old);
  assert.equal(readWorkoutDraft("user-a:plan-a:date", "2026-08-31").entries[0].reps[0], 11);
  clearWorkoutDraft("user-a:plan-a:date", newer);
  assert.equal(readWorkoutDraft("user-a:plan-a:date", "2026-08-31"), null);
  delete globalThis.localStorage;
});
