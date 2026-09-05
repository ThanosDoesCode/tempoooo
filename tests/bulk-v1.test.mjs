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

test("exercise progress history uses labeled, readable summaries", async () => {
  const source = await read("src/components/TrainingSession.tsx");
  for (const copy of [
    "View progress",
    "Hide progress",
    "Best set · last 90 days",
    "Past sessions",
    "Sets",
    "Total volume",
    "1 session logged. Complete this exercise once more to unlock the progress chart.",
    "choose its date at the top of Training",
  ]) {
    assert.match(source, new RegExp(copy.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  }
  assert.doesNotMatch(source, /Best set \(last 90 days\)|Log at least two sessions/);
  assert.match(source, /const history = exerciseHistory[\s\S]*?<ExerciseGraph history=\{history\}/);
});

test("Sharing is absent while personal Bulk activation guards remain", async () => {
  const shell = await read("src/components/AppShell.tsx");
  const guard = await read("src/routes/_authenticated/bulk/route.tsx");
  const profile = await read("src/routes/_authenticated/profile.tsx");
  const migration = await read("supabase/migrations/20260905120000_public_bulk_activation.sql");
  const onboardingMigration = await read(
    "supabase/migrations/20260905150000_complete_bulk_onboarding.sql",
  );
  assert.doesNotMatch(shell, /Sharing|\/bulk\/sharing|\/bulk\/invite/);
  assert.match(shell, /"\/bulk\/history", label: "History"/);
  assert.match(guard, /bulkOwnerQueryOptions/);
  assert.match(guard, /bulk-onboarding/);
  assert.match(profile, /Get My Bulk Plan/);
  assert.match(profile, /Start My Bulk/);
  assert.match(profile, /My Bulk Plan/);
  assert.match(profile, /Open My Bulk/);
  assert.match(profile, /bulkAccessLoading/);
  assert.match(profile, /Loading Bulk plan/);
  assert.match(migration, /CREATE FUNCTION public\.activate_my_bulk\(\)/);
  assert.match(migration, /caller uuid := \(SELECT auth\.uid\(\)\)/);
  assert.match(migration, /ON CONFLICT \(owner_id\) DO UPDATE/);
  assert.match(migration, /REVOKE ALL ON FUNCTION public\.activate_my_bulk\(\) FROM PUBLIC, anon/);
  assert.match(
    migration,
    /GRANT EXECUTE ON FUNCTION public\.activate_my_bulk\(\) TO authenticated/,
  );
  assert.match(onboardingMigration, /CREATE FUNCTION public\.complete_bulk_onboarding/);
  assert.match(onboardingMigration, /caller uuid := \(SELECT auth\.uid\(\)\)/);
  assert.match(onboardingMigration, /SET search_path = ''/);
  assert.match(
    onboardingMigration,
    /REVOKE EXECUTE ON FUNCTION public\.activate_my_bulk\(\) FROM authenticated/,
  );
});
