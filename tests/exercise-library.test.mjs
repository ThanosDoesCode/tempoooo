import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  EXERCISE_EQUIPMENT,
  EXERCISE_LIBRARY_PAGE_SIZE,
  MOVEMENT_PATTERNS,
  MUSCLE_GROUPS,
  exerciseById,
  exerciseSlug,
  filterExerciseLibrary,
  mergeExerciseLibrary,
} from "../src/lib/exercise-library.ts";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");
const now = "2026-09-05T00:00:00Z";
const exercise = (overrides = {}) => ({
  id: "system:incline-dumbbell-bench-press",
  owner_id: null,
  slug: "incline-dumbbell-bench-press",
  name: "Incline Dumbbell Bench Press",
  primary_muscle: "chest",
  secondary_muscles: ["triceps", "front_delts"],
  equipment: ["dumbbell", "bench"],
  movement_pattern: "horizontal_push",
  category: "strength",
  supports_unilateral: true,
  default_unilateral_mode: "bilateral",
  is_bodyweight: false,
  is_system: true,
  active: true,
  min_experience: "beginner",
  created_at: now,
  updated_at: now,
  ...overrides,
});

test("system exercise seed is large, deterministic, unique and covers every muscle group", async () => {
  const migration = await read("supabase/migrations/20260905170000_bulk_exercise_library.sql");
  const seedBlock = migration.slice(
    migration.indexOf("INSERT INTO bulk_exercise_seed VALUES"),
    migration.indexOf("INSERT INTO public.bulk_exercises"),
  );
  const seedRowCount = [...seedBlock.matchAll(/^  \('/gm)].length;
  const seedRows = [...seedBlock.matchAll(/^  \('([^']+)', '([^']+)', '([^']+)',/gm)];
  assert.equal(seedRowCount, 390);
  assert.equal(new Set(seedRows.map((match) => match[1])).size, seedRows.length);
  for (const muscle of MUSCLE_GROUPS) {
    assert.ok(
      seedRows.some((match) => match[3] === muscle),
      `${muscle} needs a primary exercise`,
    );
  }
  for (const name of [
    "Flat Barbell Bench Press",
    "Pull-Up",
    "Single-Arm Cable Row",
    "Cable Lateral Raise",
    "Incline Dumbbell Curl",
    "Rope Triceps Pushdown",
    "Bulgarian Split Squat",
    "Barbell Hip Thrust",
    "Hanging Leg Raise",
    "Pallof Press",
    "Farmer Carry",
  ]) {
    assert.ok(
      seedRows.some((match) => match[2] === name),
      `${name} is missing`,
    );
  }
  assert.match(migration, /ON CONFLICT \(id\) DO UPDATE/);
  assert.match(migration, /bulk_exercises_system_slug_uidx/);
});

test("exercise taxonomy is centralized and includes the required structured values", () => {
  assert.deepEqual(MUSCLE_GROUPS, [
    "chest",
    "lats",
    "upper_back",
    "traps",
    "front_delts",
    "side_delts",
    "rear_delts",
    "biceps",
    "triceps",
    "forearms",
    "quads",
    "hamstrings",
    "glutes",
    "calves",
    "adductors",
    "abductors",
    "abs",
    "obliques",
    "lower_back",
  ]);
  for (const item of ["barbell", "dumbbell", "cable", "machine", "bodyweight", "ez_bar"])
    assert.ok(EXERCISE_EQUIPMENT.includes(item));
  for (const item of ["horizontal_push", "vertical_pull", "squat", "hinge", "anti_rotation"])
    assert.ok(MOVEMENT_PATTERNS.includes(item));
});

test("search, muscle, equipment, unilateral and experience filters compose", () => {
  const rows = [
    exercise(),
    exercise({
      id: "system:cable-fly",
      slug: "cable-fly",
      name: "Cable Fly",
      equipment: ["cable"],
      supports_unilateral: true,
    }),
    exercise({
      id: "system:barbell-row",
      slug: "barbell-row",
      name: "Barbell Row",
      primary_muscle: "upper_back",
      equipment: ["barbell"],
      movement_pattern: "horizontal_pull",
      supports_unilateral: false,
      min_experience: "intermediate",
    }),
  ];
  assert.deepEqual(
    filterExerciseLibrary(rows, { search: "cable" }).map((row) => row.id),
    ["system:cable-fly"],
  );
  assert.equal(filterExerciseLibrary(rows, { primaryMuscle: "chest" }).length, 2);
  assert.equal(filterExerciseLibrary(rows, { equipment: "barbell" }).length, 1);
  assert.equal(filterExerciseLibrary(rows, { unilateralOnly: true }).length, 2);
  assert.equal(filterExerciseLibrary(rows, { origin: "system" }).length, 3);
  assert.deepEqual(
    filterExerciseLibrary(rows, {
      primaryMuscle: "chest",
      equipment: "cable",
      unilateralOnly: true,
      experienceLevel: "beginner",
    }).map((row) => row.name),
    ["Cable Fly"],
  );
  assert.equal(filterExerciseLibrary(rows, { experienceLevel: "beginner" }).length, 2);
});

test("library merging and lookup preserve stable system and custom identities", () => {
  const system = exercise();
  const custom = exercise({
    id: "custom:one",
    owner_id: "owner",
    slug: "my-press",
    name: "My Press",
    is_system: false,
  });
  const merged = mergeExerciseLibrary([system], [custom]);
  assert.equal(merged.length, 2);
  assert.equal(exerciseById(merged, "custom:one"), custom);
  assert.equal(exerciseSlug("  My Ünique Cable Fly  "), "my-unique-cable-fly");
});

test("library API pages server results and custom writes cannot target system rows", async () => {
  const [client, browser, training, migration, legacyTypes, cancellation] = await Promise.all([
    read("src/lib/exercise-library-query.ts"),
    read("src/routes/_authenticated/bulk/exercises.tsx"),
    read("src/routes/_authenticated/bulk/training_.more.tsx"),
    read("supabase/migrations/20260905170000_bulk_exercise_library.sql"),
    read("src/lib/types.ts"),
    read("src/lib/query-cancellation.ts"),
  ]);
  assert.equal(EXERCISE_LIBRARY_PAGE_SIZE, 40);
  assert.match(client, /\.range\(from, from \+ EXERCISE_LIBRARY_PAGE_SIZE\)/);
  assert.match(client, /\.ilike\("name"/);
  assert.match(client, /\.eq\("primary_muscle"/);
  assert.match(client, /\.contains\("equipment"/);
  assert.match(client, /\.eq\("supports_unilateral", true\)/);
  assert.match(client, /systemExerciseQueryOptions/);
  assert.match(client, /customExerciseQueryOptions/);
  assert.match(client, /\.eq\("is_system", false\)/);
  assert.match(client, /system_exercise_is_read_only/);
  assert.match(browser, /Search exercises/);
  assert.match(browser, /Filter by primary muscle/);
  assert.match(browser, /Filter by equipment/);
  assert.match(browser, /Filter by experience level/);
  assert.match(browser, /Unilateral/);
  assert.match(browser, /Add custom exercise/);
  assert.match(browser, /Secondary muscles \(optional\)/);
  assert.match(browser, /Saving exercise/);
  assert.match(browser, /Delete this custom exercise\?/);
  assert.match(browser, /Page \{page \+ 1\}/);
  assert.match(training, /Exercise library/);
  assert.match(migration, /owner_id = \(SELECT auth\.uid\(\)\)/);
  assert.match(migration, /NOT is_system/);
  assert.match(migration, /private\.has_active_bulk\(\)/);
  assert.match(migration, /ENABLE ROW LEVEL SECURITY/);
  assert.match(legacyTypes, /workouts: Record<string, Workout>/);
  assert.match(legacyTypes, /exercise: string/);
  assert.doesNotMatch(migration, /UPDATE public\.bulk_workouts/);
  assert.match(cancellation, /"bulk-exercise-library"/);
});

test("add-to-workout results use compact accessible cards with scoped mutation feedback", async () => {
  const browser = await read("src/routes/_authenticated/bulk/exercises.tsx");

  assert.match(browser, /const addingToWorkout = !!addTo && !!date/);
  assert.match(browser, /addingToWorkout \? \([\s\S]*?<button/);
  assert.match(browser, /aria-label=\{[\s\S]*?`Add \$\{item\.name\} to workout`/);
  assert.match(browser, /onClick=\{\(\) =>[\s\S]*?addToLegacyWorkout\(item\)/);
  assert.match(browser, /active:scale-\[0\.98\][\s\S]*active:bg-elevated/);
  assert.match(browser, /min-h-16/);
  assert.doesNotMatch(browser, />\s*Add to workout\s*</);

  assert.match(browser, /const pending = exerciseMutation\?\.id === item\.id/);
  assert.match(browser, /exerciseMutation\.action === "add" \? "Adding\.\.\." : "Removing\.\.\."/);
  assert.match(browser, /disabled=\{pending \|\|/);
  assert.match(browser, /Wait for the current exercise change to finish/);
  assert.match(
    browser,
    /if \(!addTo \|\| !date \|\| !data \|\| !user \|\| exerciseMutation\) return/,
  );
  assert.match(
    browser,
    /catch \(error\)[\s\S]*inputPreserved: true[\s\S]*finally[\s\S]*setExerciseMutation\(null\)/,
  );

  assert.match(browser, /addedByLibrary[\s\S]*removeFromLegacyWorkout\(item\)/);
  assert.match(browser, /`Remove \$\{item\.name\} from workout`/);
  assert.match(browser, /entries: existing\.entries\.filter/);
  assert.match(browser, /legacyExerciseDefinitions:[\s\S]*\.filter/);
  assert.match(browser, /Remove \$\{item\.name\} and its entered workout data\?/);

  assert.match(browser, /:\s*\(\s*<div key=\{item\.id\} className="card-surface p-3">/);
  assert.match(browser, /!item\.is_system \? \([\s\S]*Deleting\.\.\./);
});
