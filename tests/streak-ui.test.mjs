import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  parseStreakResponse,
  nextMilestone,
  isFreeMissUsedThisMonth,
  STREAK_MILESTONES,
} from "../src/lib/streak-model.ts";
import { isFocusScreen, mainTabForPath } from "../src/lib/main-navigation.ts";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

const sample = (over = {}) => ({
  current: 6,
  best: 6,
  this_week: {
    week_start: "2026-10-05",
    week_end: "2026-10-11",
    result: "open",
    run_active: true,
    train_active: true,
    eat_active: false,
    run_state: "open",
    train_state: "closed",
    eat_state: "inactive",
  },
  recent_weeks: [
    {
      week_start: "2026-10-05",
      week_end: "2026-10-11",
      result: "open",
      free_miss_used: false,
      locked_at: null,
    },
    {
      week_start: "2026-09-28",
      week_end: "2026-10-04",
      result: "kept",
      free_miss_used: false,
      locked_at: "2026-10-05T00:00:00Z",
    },
    {
      week_start: "2026-09-07",
      week_end: "2026-09-13",
      result: "free",
      free_miss_used: true,
      locked_at: "2026-09-14T00:00:00Z",
    },
  ],
  ...over,
});

// ----------------------------------------------------------------- RPC parsing
test("parseStreakResponse maps the RPC Json into the typed model", () => {
  const data = parseStreakResponse(sample());
  assert.equal(data.current, 6);
  assert.equal(data.best, 6);
  assert.equal(data.isBest, true);
  assert.equal(data.thisWeek.weekStart, "2026-10-05");
  assert.equal(data.thisWeek.rings.length, 3);
  assert.equal(data.recentWeeks.length, 3);
  assert.equal(data.recentWeeks[0].locked, false); // open current week
  assert.equal(data.recentWeeks[1].locked, true);
});

test("current/best come from locked weeks; the open week never increments the headline", () => {
  // current=6 while this week is still open and only partly met -> headline stays 6 (not 7).
  const data = parseStreakResponse(sample({ current: 6 }));
  assert.equal(data.current, 6);
  assert.equal(data.thisWeek.result, "open");
});

test("a malformed / empty RPC response degrades to a safe zero model (no throw, no raw error)", () => {
  const data = parseStreakResponse(null);
  assert.equal(data.current, 0);
  assert.equal(data.best, 0);
  assert.equal(data.thisWeek, null);
  assert.deepEqual(data.activeRings, []);
  assert.deepEqual(data.recentWeeks, []);
});

// ----------------------------------------------------------------- active rings
test("core shows Run only; inactive rings are never active", () => {
  const data = parseStreakResponse(
    sample({
      this_week: {
        week_start: "2026-10-05",
        week_end: "2026-10-11",
        result: "open",
        run_active: true,
        train_active: false,
        eat_active: false,
        run_state: "open",
        train_state: "inactive",
        eat_state: "inactive",
      },
    }),
  );
  assert.deepEqual(
    data.activeRings.map((r) => r.key),
    ["run"],
  );
});

test("fitness shows only the active rings (a subset)", () => {
  const data = parseStreakResponse(
    sample({
      this_week: {
        week_start: "2026-10-05",
        week_end: "2026-10-11",
        result: "open",
        run_active: true,
        train_active: false,
        eat_active: true,
        run_state: "open",
        train_state: "inactive",
        eat_state: "open",
      },
    }),
  );
  assert.deepEqual(
    data.activeRings.map((r) => r.key),
    ["run", "eat"],
  );
});

test("no active rings yields a neutral empty set (handled as a neutral line by the UI)", async () => {
  const data = parseStreakResponse(
    sample({
      this_week: {
        week_start: "2026-10-05",
        week_end: "2026-10-11",
        result: "none",
        run_active: false,
        train_active: false,
        eat_active: false,
        run_state: "inactive",
        train_state: "inactive",
        eat_state: "inactive",
      },
    }),
  );
  assert.deepEqual(data.activeRings, []);
  const screen = await read("src/components/StreakRings.tsx");
  assert.match(screen, /No streak requirements this week/);
});

// ----------------------------------------------------------------- milestones
test("milestones are 4/8/12/26/52 with no 6-week milestone", () => {
  assert.deepEqual([...STREAK_MILESTONES], [4, 8, 12, 26, 52]);
  assert.equal(nextMilestone(6), 8);
  assert.equal(nextMilestone(3), 4);
  assert.equal(nextMilestone(52), null);
});

// ----------------------------------------------------------------- free miss
test("the free-miss helper matches a free week by its week_start month", () => {
  const weeks = parseStreakResponse(sample()).recentWeeks;
  assert.equal(isFreeMissUsedThisMonth(weeks, "2026-09"), true); // the free week is in September
  assert.equal(isFreeMissUsedThisMonth(weeks, "2026-10"), false);
});

test("free miss is scoped to the streak month of week_start, never the device timezone", () => {
  // Current week is October; the free week is September -> not this streak month.
  assert.equal(parseStreakResponse(sample()).freeMissUsedThisMonth, false);

  // A free miss earlier in the SAME streak month as the current week renders as used, regardless
  // of where the device is. Current week moved to September; a September week has free_miss_used.
  const septThisWeek = {
    week_start: "2026-09-28",
    week_end: "2026-10-04",
    result: "open",
    run_active: true,
    train_active: false,
    eat_active: false,
    run_state: "open",
    train_state: "inactive",
    eat_state: "inactive",
  };
  assert.equal(
    parseStreakResponse(sample({ this_week: septThisWeek })).freeMissUsedThisMonth,
    true,
  );
});

test("parseStreakResponse takes no device month argument (month comes only from stored dates)", async () => {
  const model = await read("src/lib/streak-model.ts");
  assert.match(model, /export function parseStreakResponse\(json: unknown\): StreakData/);
  assert.match(model, /thisWeek\?\.weekStart[\s\S]*slice\(0, 7\)/); // month from week_start
  const lib = await read("src/lib/streak.ts");
  assert.doesNotMatch(lib, /localMonthKey/); // no device-timezone month inference
});

test("the streak screen shows both free-miss states as compact copy", async () => {
  const screen = await read("src/routes/_authenticated/streak.tsx");
  assert.match(screen, /Free miss used this month/);
  assert.match(screen, /Free miss available/);
});

// ----------------------------------------------------------------- weekly tiles: distinct states, none != failure
test("recent-week tiles give kept/free/paused/none/missed/open distinct treatments; none is not failure", async () => {
  const screen = await read("src/routes/_authenticated/streak.tsx");
  // A per-result TILE map (weekly tiles, not a daily contribution grid).
  for (const result of ["kept", "free", "paused", "none", "missed", "open"]) {
    assert.match(screen, new RegExp(`${result}:\\s*\\{`));
  }
  // none must be neutral (dashed/Minus), missed must be the failure (destructive/X) — never equal.
  // [^}]* stays inside each tile object so matches cannot leak across entries.
  assert.match(screen, /none:\s*\{[^}]*border-dashed[^}]*\}/);
  assert.match(screen, /missed:\s*\{[^}]*destructive[^}]*\}/);
  assert.doesNotMatch(screen, /none:\s*\{[^}]*destructive[^}]*\}/);
  // Weekly tiles, not a GitHub-style grid.
  assert.doesNotMatch(screen, /grid-cols-7|contribution|13.*weeks.*ago/i);
  assert.match(screen, /flex flex-wrap/); // tiles wrap, no horizontal overflow
});

// ----------------------------------------------------------------- Run progress sourcing
test("one Run leg shows numeric km; multiple legs show kept-count, never a combined km target", async () => {
  const rings = await read("src/components/StreakRings.tsx");
  // Single leg -> numeric "X / Y km" from the count branch.
  assert.match(rings, /\$\{progress\.current\} \/ \$\{progress\.target\}\$\{progress\.unit/);
  // Multiple legs -> "X of N challenges complete"; no km value and no summed target.
  assert.match(rings, /\$\{progress\.completed\} of \$\{progress\.legCount\} challenges complete/);
  assert.match(rings, /multiLeg[\s\S]*value: null/);
  assert.doesNotMatch(rings, /challenge weeks count this week/); // superseded by the kept-count line
});

test("Run progress is sourced from the frozen legs of THIS account week, not the most-recent Challenge", async () => {
  const lib = await read("src/lib/streak.ts");
  // Reads the account week's legs (correct challenge + canonical week), not a convention pick.
  assert.match(lib, /from\("streak_week_run_legs"\)/);
  assert.match(lib, /useMyChallenge\(singleLeg\?\.source_challenge_id\)/);
  assert.doesNotMatch(lib, /useMyChallenge\(\)/); // never the most-recently-joined Challenge
  // Uses the leg's own canonical week bounds + number, never the Challenge's currently-visible week.
  assert.match(lib, /start: singleLeg\.challenge_week_start, end: singleLeg\.challenge_week_end/);
  assert.match(lib, /singleLeg\.challenge_week_number/);
  assert.doesNotMatch(lib, /weekNumberOf|weekBounds|todayIn/);
});

test("two concurrent Run legs never sum kilometres; completed count comes from settled legs", async () => {
  const lib = await read("src/lib/streak.ts");
  assert.match(lib, /legs\.length > 1/);
  assert.match(
    lib,
    /completed: legs\.filter\(\(l\) => l\.settlement_state === "completed"\)\.length/,
  );
  // The multi-leg branch carries no km target/unit (no cross-challenge aggregation).
  assert.doesNotMatch(lib, /kind: "multiLeg",\s*legCount:[^}]*unit:/);
});

// ----------------------------------------------------------------- entry points + routing
test("the fitness Today screen shows a flame entry and this-week rings linking to /streak", async () => {
  const [today, flame] = await Promise.all([
    read("src/routes/_authenticated/bulk/index.tsx"),
    read("src/components/StreakFlame.tsx"),
  ]);
  // Flame + week count live in a content card (header stays self-closing per the main-tab contract).
  assert.match(today, /<StreakRings/);
  assert.match(today, /to="\/streak"/);
  assert.match(today, /<Flame /);
  assert.match(flame, /to="\/streak"/);
});

test("core users reach the streak from Challenge (flame gated to core), not from a Today tab", async () => {
  const challenge = await read("src/routes/_authenticated/challenge/index.tsx");
  assert.match(challenge, /accountProductMode\(useMemberships\(\)\.data\) === "core"/);
  assert.match(challenge, /\{core \? <StreakFlame \/> : null\}/);
});

test("/streak is account-level, keeps the bottom nav, and uses contextual Back by mode", async () => {
  const screen = await read("src/routes/_authenticated/streak.tsx");
  assert.match(screen, /createFileRoute\("\/_authenticated\/streak"\)/);
  assert.match(screen, /backTo=\{core \? "\/challenge" : "\/bulk"\}/);
  assert.match(screen, /backLabel=\{core \? "Challenge" : "Today"\}/);
  // Not a focus screen: the bottom nav stays, and no wrong tab is force-highlighted.
  assert.equal(isFocusScreen("/streak"), false);
  assert.equal(mainTabForPath("/streak"), null);
});

// ----------------------------------------------------------------- states handled, no raw errors
test("the screen handles loading / error without exposing raw Supabase errors", async () => {
  const screen = await read("src/routes/_authenticated/streak.tsx");
  assert.match(screen, /isLoading \? \(/);
  assert.match(screen, /Could not load your streak\. Your data is unchanged\./);
  assert.doesNotMatch(screen, /error\.message|JSON\.stringify\(.*error/);
});
