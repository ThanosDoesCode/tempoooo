import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { ALL_EXERCISES, EXERCISES, exerciseLabel, splitLabel } from "../src/lib/types.ts";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("Bulk program keeps canonical history identifiers while presenting the v1 labels and order", () => {
  assert.deepEqual(
    EXERCISES["Chest & Back"].map((entry) => exerciseLabel(entry.name)),
    ["Dumbbell Incline Press", "Cable Low-to-High", "Pull-Ups", "Cable Rows", "Face Pulls"],
  );
  assert.deepEqual(
    EXERCISES.Legs.map((entry) => exerciseLabel(entry.name)),
    [
      "Leg Extensions",
      "Declined Leg Press",
      "Romanian Deadlifts",
      "Leg Curls",
      "Calf Raises",
      "Cable Crunches",
      "Hanging Leg Raises",
    ],
  );
  assert.deepEqual(
    EXERCISES["Arms & Shoulders"].map((entry) => exerciseLabel(entry.name)),
    [
      "Chin-Ups",
      "Incline Bicep Curls",
      "Tricep Pushdowns",
      "Overhead Tricep Extensions",
      "Lateral Raises",
      "Cable Crunches",
      "Hanging Leg Raises",
    ],
  );
  assert.equal(exerciseLabel("Incline Dumbbell Press"), "Dumbbell Incline Press");
  assert.equal(exerciseLabel("Cable Low-to-High Fly"), "Cable Low-to-High");
  assert.equal(splitLabel("Arms & Shoulders"), "Arms");
  assert.deepEqual(
    EXERCISES.Legs.slice(-2).map(({ min, max }) => [min, max]),
    [
      [10, 15],
      [8, 15],
    ],
  );
  assert.equal(new Set(ALL_EXERCISES.map((entry) => entry.name)).size, ALL_EXERCISES.length);
});

test("Bulk History exposes stored workout detail and honest nutrition provenance", async () => {
  const history = await read("src/routes/_authenticated/bulk/history.tsx");
  for (const label of [
    "Body weight",
    "Calories",
    "Protein",
    "Carbs",
    "Fat",
    "Performed",
    "Workout",
    "Duration",
    "Total volume",
    "Working sets",
    "Load",
    "Bodyweight",
    "Extra weight",
    "Assistance",
    "RPE",
    "Notes:",
    "Daily note:",
  ]) {
    assert.match(history, new RegExp(label));
  }
  assert.match(history, /Legacy day:/);
  assert.match(history, /foods configured for the selected plan/);
  assert.match(history, /Stored totals \(authoritative\)/);
  assert.match(history, /Saved plan snapshot for this date/);
  assert.match(history, /Custom foods and quantities were not stored/);
});

test("Same updates local state without autosaving or starting the rest timer", async () => {
  const source = await read("src/components/TrainingSession.tsx");
  const localChange = source.match(
    /const changeWithoutSaving = \(next: Workout\) => \{[\s\S]*?\n  \};/,
  )?.[0];
  assert.ok(localChange);
  assert.doesNotMatch(localChange, /persist\(|startRest\(|updateExercise\(/);
  assert.match(localChange, /setSync\("unsaved"\)/);
  assert.match(source, /sync === "unsaved"[\s\S]*?Save draft/);
  const shortcut = source.match(
    /aria-label=\{`Copy Set[\s\S]*?changeWithoutSaving\(repeated\);[\s\S]*?<\/button>/,
  )?.[0];
  assert.ok(shortcut);
  assert.doesNotMatch(shortcut, /persist\(|startRest\(|update\(/);
});

test("Sharing is absent while owner-only Bulk guards remain", async () => {
  const shell = await read("src/components/AppShell.tsx");
  const guard = await read("src/routes/_authenticated/bulk/route.tsx");
  assert.doesNotMatch(shell, /Sharing|\/bulk\/sharing|\/bulk\/invite/);
  assert.match(shell, /"\/bulk\/history", label: "History"/);
  assert.match(guard, /bulkOwnerQueryOptions/);
  assert.match(guard, /bulk-access-denied/);
});
