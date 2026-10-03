import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { weeklyTargetHelper } from "../src/lib/challenge-target-copy.ts";

test("weekly-target helper estimates 5 km runs from the selected target", () => {
  for (const [target, runs] of [
    [5, 1],
    [10, 2],
    [15, 3],
    [20, 4],
    [7, 1.4],
    [12, 2.4],
    [17.5, 3.5],
    [1, 0.2],
  ]) {
    assert.equal(
      weeklyTargetHelper(target),
      `About ${runs} easy 5 km ${runs === 1 ? "run" : "runs"} a week. Rides count at a third.`,
    );
  }
});

test("creation helper reads current stepper value during render, not fixed or separately cached copy", async () => {
  const source = await readFile(
    new URL("../src/routes/_authenticated/challenge/new.tsx", import.meta.url),
    "utf8",
  );
  assert.match(source, /const targetKm = Number\(target\)/);
  assert.match(source, /targetValid \? weeklyTargetHelper\(targetKm\)/);
  assert.doesNotMatch(source, /About 3 easy runs a week/);
});
