import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  COVERAGE_THRESHOLDS,
  PRIMARY_SET_WEIGHT,
  SECONDARY_SET_WEIGHT,
  calculateMuscleCoverage,
  coverageStatus,
} from "../src/lib/bulk-muscle-coverage.ts";

const exercise = (id, primary, secondary = [], overrides = {}) => ({
  id,
  primary_muscle: primary,
  secondary_muscles: secondary,
  active: true,
  ...overrides,
});
const planned = (id, sets = 3, overrides = {}) => ({
  id: `plan:${id}`,
  exerciseId: id,
  name: id,
  sets,
  intendedUnilateralMode: "bilateral",
  ...overrides,
});
const plan = (days) => ({
  days: days.map((exercises, index) => ({ id: `day:${index}`, exercises })),
});
const row = (result, muscle) => result.muscles.find((item) => item.muscle === muscle);

test("primary and secondary contributions remain separate and weighted", () => {
  assert.equal(PRIMARY_SET_WEIGHT, 1);
  assert.equal(SECONDARY_SET_WEIGHT, 0.5);
  const result = calculateMuscleCoverage(plan([[planned("bench", 3)]]), [
    exercise("bench", "chest", ["triceps", "front_delts"]),
  ]);
  assert.deepEqual(
    [
      row(result, "chest").primarySets,
      row(result, "chest").secondarySets,
      row(result, "chest").effectiveSets,
    ],
    [3, 0, 3],
  );
  assert.deepEqual(
    [
      row(result, "triceps").primarySets,
      row(result, "triceps").secondarySets,
      row(result, "triceps").effectiveSets,
    ],
    [0, 3, 1.5],
  );
});

test("multiple exercises and days aggregate without multiplying plan frequency", () => {
  const result = calculateMuscleCoverage(
    plan([[planned("bench", 3), planned("fly", 2)], [planned("bench", 4)]]),
    [exercise("bench", "chest", ["triceps"]), exercise("fly", "chest")],
  );
  assert.equal(row(result, "chest").primarySets, 9);
  assert.equal(row(result, "chest").dayCount, 2);
  assert.equal(row(result, "chest").exerciseCount, 2);
});

test("unilateral and bodyweight prescriptions count plan sets once", () => {
  const result = calculateMuscleCoverage(
    plan([[planned("pullup", 3, { intendedUnilateralMode: "unilateral", isBodyweight: true })]]),
    [exercise("pullup", "lats", ["biceps"])],
  );
  assert.equal(row(result, "lats").effectiveSets, 3);
  assert.equal(row(result, "biceps").effectiveSets, 1.5);
});

test("coverage ignores workout history concepts and exercise order", () => {
  const metadata = [exercise("row", "upper_back", ["biceps"]), exercise("curl", "biceps")];
  const first = calculateMuscleCoverage(plan([[planned("row", 3), planned("curl", 2)]]), metadata);
  const reordered = calculateMuscleCoverage(
    plan([[planned("curl", 2), planned("row", 3)]]),
    metadata,
  );
  assert.deepEqual(first.muscles, reordered.muscles);
  assert.equal(row(first, "biceps").effectiveSets, 3.5);
});

test("set changes and replacements change only the represented distribution", () => {
  const metadata = [
    exercise("press", "chest", ["triceps"]),
    exercise("leg", "quads", ["glutes"]),
    exercise("custom", "hamstrings", ["glutes"]),
  ];
  assert.equal(
    row(calculateMuscleCoverage(plan([[planned("press", 2)]]), metadata), "chest").effectiveSets,
    2,
  );
  assert.equal(
    row(calculateMuscleCoverage(plan([[planned("press", 5)]]), metadata), "chest").effectiveSets,
    5,
  );
  const replaced = calculateMuscleCoverage(
    plan([[planned("leg", 3), planned("custom", 2)]]),
    metadata,
  );
  assert.equal(row(replaced, "quads").primarySets, 3);
  assert.equal(row(replaced, "hamstrings").primarySets, 2);
  assert.equal(row(replaced, "glutes").secondarySets, 5);
});

test("unknown custom metadata is neutral and never inferred from names", () => {
  const result = calculateMuscleCoverage(
    plan([[planned("custom:unknown", 5, { name: "Mega Chest Press" })]]),
    [],
  );
  assert.equal(result.dataStatus, "incomplete_metadata");
  assert.equal(row(result, "chest").effectiveSets, 0);
  assert.deepEqual(result.missingExerciseIds, ["custom:unknown"]);
});

test("coverage statuses use centralized transparent thresholds", () => {
  assert.deepEqual(COVERAGE_THRESHOLDS, { moderate: 4, high: 8, veryHigh: 16 });
  assert.deepEqual(
    [
      coverageStatus(0),
      coverageStatus(2),
      coverageStatus(4),
      coverageStatus(8),
      coverageStatus(16),
      coverageStatus(16.5),
    ],
    ["not_trained", "low", "moderate", "high", "high", "very_high"],
  );
});

test("major gap and high-volume advisories are deterministic", () => {
  const empty = calculateMuscleCoverage(plan([[planned("calves", 3)]]), [
    exercise("calves", "calves"),
  ]);
  for (const gap of ["gap:chest", "gap:back", "gap:quads", "gap:hamstrings", "gap:glutes"])
    assert.ok(empty.gaps.some((item) => item.id === gap));
  const high = calculateMuscleCoverage(plan([[planned("press-a", 10), planned("press-b", 8)]]), [
    exercise("press-a", "chest", ["triceps"]),
    exercise("press-b", "chest", ["triceps"]),
  ]);
  assert.ok(high.highVolume.some((item) => item.id === "high:chest"));
  assert.match(high.highVolume[0].message, /very high weekly volume/);
});

test("shoulder, back and core groups retain their detailed muscles", () => {
  const result = calculateMuscleCoverage(
    plan([[planned("press", 8), planned("pulldown", 5), planned("crunch", 4)]]),
    [exercise("press", "front_delts"), exercise("pulldown", "lats"), exercise("crunch", "abs")],
  );
  const shoulders = result.groups.find((group) => group.id === "shoulders");
  assert.deepEqual(shoulders.muscles, ["front_delts", "side_delts", "rear_delts"]);
  assert.ok(result.advisories.some((item) => item.id === "distribution:side_delts"));
  assert.ok(result.advisories.some((item) => item.id === "distribution:rear_delts"));
  assert.deepEqual(result.groups.find((group) => group.id === "back").muscles, [
    "lats",
    "upper_back",
  ]);
  assert.deepEqual(result.groups.find((group) => group.id === "core").muscles, [
    "abs",
    "obliques",
    "lower_back",
  ]);
});

test("analysis does not mutate plans or canonical metadata", () => {
  const sourcePlan = plan([[planned("bench", 3)]]);
  const metadata = [exercise("bench", "chest", ["triceps"])];
  const beforePlan = structuredClone(sourcePlan);
  const beforeMetadata = structuredClone(metadata);
  calculateMuscleCoverage(sourcePlan, metadata);
  assert.deepEqual(sourcePlan, beforePlan);
  assert.deepEqual(metadata, beforeMetadata);
});

test("coverage query is batched and public UI remains separate from legacy", async () => {
  const [query, component, route, cache] = await Promise.all([
    readFile(new URL("../src/lib/bulk-muscle-coverage-query.ts", import.meta.url), "utf8"),
    readFile(new URL("../src/components/BulkMuscleCoverage.tsx", import.meta.url), "utf8"),
    readFile(
      new URL("../src/routes/_authenticated/bulk/training_.more.tsx", import.meta.url),
      "utf8",
    ),
    readFile(new URL("../src/lib/query-cancellation.ts", import.meta.url), "utf8"),
  ]);
  assert.match(query, /new Set/);
  assert.match(query, /\.in\("id", ids\)/);
  assert.doesNotMatch(query, /for[\s\S]*supabase\.from/);
  assert.match(component, /Muscle Coverage/);
  assert.match(component, /Show detailed coverage/);
  assert.match(component, /direct.*indirect.*effective/);
  assert.match(route, /usesPlanSetup \? \(activePlan\.data/);
  assert.match(route, /bulk-muscle-coverage/);
  assert.match(cache, /bulk-muscle-coverage/);
});
