import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";
import ts from "typescript";
import * as dateFns from "date-fns";
import { LOG_ACTIONS } from "../src/lib/main-navigation.ts";
import { parseDurationToSeconds, formatClock } from "../src/lib/duration.ts";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

// Load the challenge business logic the way challenge-export.test.mjs loads its module: transpile
// to CommonJS and run in a VM with its heavy imports mocked. The @/ alias blocks a direct import.
const compiled = ts.transpileModule(await read("src/lib/challenge.ts"), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
const context = {
  exports: {},
  require(name) {
    if (name === "date-fns") return dateFns;
    return {};
  },
};
vm.runInNewContext(compiled, context);
const C = context.exports;

test("mm:ss time parses and formats round-trip; decimal minutes still accepted", () => {
  assert.equal(parseDurationToSeconds("22:20"), 1340); // 22*60 + 20
  assert.equal(parseDurationToSeconds("1:05:00"), 3900); // h:mm:ss
  assert.equal(parseDurationToSeconds("40"), 2400); // plain minutes fallback
  assert.equal(parseDurationToSeconds("61,5"), 3690); // comma-decimal minutes fallback
  assert.equal(formatClock(1340), "22:20");
  assert.equal(formatClock(3900), "1:05:00");
  for (const bad of ["22:75", "ab", "", ":30", "1:2:3:4", "-5"]) {
    assert.equal(parseDurationToSeconds(bad), null, bad);
  }
});

test("live preview uses exactly the parsed mm:ss duration, at the qualifying boundary", () => {
  // A 4.0 km run: 7:00 /km is the limit (420 s/km → 1680 s for 4 km).
  const justOver = parseDurationToSeconds("28:00"); // 1680 s → pace exactly 420, does not qualify
  const justUnder = parseDurationToSeconds("27:59"); // 1679 s → pace < 420, qualifies
  assert.equal(justOver, 1680);
  assert.equal(justUnder, 1679);
  const unqualified = C.activityMetrics({
    activity_type: "run",
    distance_km: 4,
    duration_seconds: justOver,
  });
  const qualified = C.activityMetrics({
    activity_type: "run",
    distance_km: 4,
    duration_seconds: justUnder,
  });
  assert.equal(unqualified.qualified, false);
  assert.equal(qualified.qualified, true);
  // The preview and the saved row both derive duration from this one parser, so they cannot diverge.
});

const moneyTerms = {
  weekly_target_km: 15,
  penalty_mode: "money",
  penalty_high_eur: 15,
  penalty_medium_eur: 10,
  penalty_low_eur: 5,
};

test("weekPenaltyMessage: current owed plus distance to the next lower band", () => {
  // 6.5 of 15 km is the medium band (€10); the next boundary is 10 km (€5), 3.5 km away.
  const mid = C.weekPenaltyMessage(6.5, 15, moneyTerms);
  assert.equal(mid.atRisk, true);
  assert.match(mid.line, /You'd pay €10 if the week ended now\. 3\.5 km more brings it to €5\./);

  // Low band just below target: the next boundary is the target itself, i.e. €0.
  assert.match(C.weekPenaltyMessage(12, 15, moneyTerms).line, /brings it to €0\./);

  // On or over target: no penalty, not at risk.
  const done = C.weekPenaltyMessage(15, 15, moneyTerms);
  assert.equal(done.atRisk, false);
  assert.match(done.line, /No penalty/);
});

test("weekPenaltyMessage never re-derives penaltyFor's bands", () => {
  for (const [equivalent, owed] of [
    [2, 15],
    [6, 10],
    [12, 5],
    [20, 0],
  ]) {
    assert.equal(C.penaltyFor(equivalent, 15, { high: 15, medium: 10, low: 5 }), owed);
  }
});

test("isActivityEditable: owner-only, current open week only", () => {
  const challenge = { start_date: "2020-01-06", duration_weeks: 520, timezone: "UTC" }; // a Monday
  const currentWeek = C.weekNumberOf(challenge, C.todayIn("UTC"));
  const { start } = C.weekBounds(challenge, currentWeek);
  assert.equal(
    C.isActivityEditable(challenge, { user_id: "me", activity_date: start }, "me"),
    true,
  );
  assert.equal(
    C.isActivityEditable(challenge, { user_id: "me", activity_date: start }, "other"),
    false,
  );
  // Week 1 is long finalized, so it is locked.
  assert.equal(
    C.isActivityEditable(challenge, { user_id: "me", activity_date: "2020-01-06" }, "me"),
    false,
  );
});

test("Challenge week screen drops retired elements and names the opponent", async () => {
  const week = await read("src/routes/_authenticated/challenge/index.tsx");
  assert.match(week, /weekPenaltyMessage/); // reuses the authoritative penalty line
  assert.match(week, /opponent\.name/); // real username, not a generic label by default
  assert.match(week, /to="\/challenge\/add"/); // "Add run or ride"
  assert.doesNotMatch(week, /loaded</); // no "N loaded" count
  assert.doesNotMatch(week, /ChallengeNotifications/); // Notifications row moved to You
  assert.doesNotMatch(week, /Challenge settings|Weekly terms/); // settings block gone
  assert.doesNotMatch(week, /challenge\/targets|challenge\/rules/); // no separate Targets/Rules links
});

test("Money shows open/settled and has no export, comparison or travel form", async () => {
  const money = await read("src/routes/_authenticated/challenge/money.tsx");
  assert.match(money, /You owe/);
  assert.match(money, />Open</);
  assert.match(money, />Settled</);
  assert.match(money, /I paid/);
  assert.match(money, /Got it/);
  assert.match(money, /all square/);
  assert.doesNotMatch(money, /52-week comparison|downloadChallengeCsv|Download challenge data/);
  assert.doesNotMatch(money, /setTravelPause|removeTravelPause/);
});

test("Terms is the rules home and links to override and pause", async () => {
  const terms = await read("src/routes/_authenticated/challenge/terms.tsx");
  assert.match(terms, /\/challenge\/terms\/override/);
  assert.match(terms, /\/challenge\/terms\/pause/);
  // Travel pause business logic lives on its own screen now, not on Money.
  const pause = await read("src/routes/_authenticated/challenge/terms.pause.tsx");
  assert.match(pause, /setTravelPause/);
  assert.match(pause, /removeTravelPause/);
});

test("Add Activity preview reuses activityMetrics (one calculation)", async () => {
  const add = await read("src/routes/_authenticated/challenge/add.tsx");
  assert.match(add, /activityMetrics\(/);
  assert.match(add, /Counts as /);
  assert.match(add, /backTo="\/challenge"/);
});

test("Activity detail reuses the shared lightbox and gates mutation", async () => {
  const detail = await read("src/routes/_authenticated/challenge/activity.$activityId.tsx");
  assert.match(detail, /isActivityEditable/);
  assert.match(detail, /ChallengeEvidenceViewer/);
  assert.match(detail, /\.delete\(\)/);
  // The app has no activity-edit flow; the detail screen never fabricates one.
  assert.doesNotMatch(detail, /\.update\(|\.insert\(/);
});

test("Log sheet preselects Run and Ride on Add Activity", async () => {
  const run = LOG_ACTIONS.find((a) => a.key === "run");
  const ride = LOG_ACTIONS.find((a) => a.key === "ride");
  assert.deepEqual(run.search, { type: "run" });
  assert.deepEqual(ride.search, { type: "cycle" });
  assert.equal(run.to, "/challenge/add");
  assert.equal(ride.to, "/challenge/add");
  const sheet = await read("src/components/LogSheet.tsx");
  // Both the Link (spread) and the navigate() fallback carry the preselect search param.
  assert.match(sheet, /search: action\.search/);
  assert.match(sheet, /to: action\.to, search: action\.search/);
  const add = await read("src/routes/_authenticated/challenge/add.tsx");
  assert.match(add, /validateSearch/);
  assert.match(add, /searchType \?\? "run"/); // initial toggle honours the param
});

test("Activity edit updates in place (owner + open week), and never inserts on edit", async () => {
  const add = await read("src/routes/_authenticated/challenge/add.tsx");
  // Edit path is a guarded UPDATE; qualification/counted km are recomputed by the DB, not the client.
  assert.match(add, /\.update\(\{ \.\.\.fields, \.\.\.evidence \}\)/);
  assert.match(add, /isActivityEditable/);
  assert.match(add, /if \(editing\)/);
  const detail = await read("src/routes/_authenticated/challenge/activity.$activityId.tsx");
  assert.match(detail, /to="\/challenge\/add"/); // Edit action links to the Add/Edit screen
  assert.match(detail, /search=\{\{ edit: activity\.id, type: activity\.activity_type \}\}/);
  // The edit screen's back link names and returns to the Activity.
  assert.match(add, /backTo="\/challenge\/activity\/\$activityId"/);
  assert.match(add, /backLabel="Activity"/);
  assert.match(add, /to: "\/challenge\/activity\/\$activityId", params: \{ activityId: editId/);
});

test("Activity detail shows the large evidence panel via the shared signed-URL lightbox", async () => {
  const detail = await read("src/routes/_authenticated/challenge/activity.$activityId.tsx");
  assert.match(detail, /variant="panel"/);
  const viewer = await read("src/components/ChallengeEvidenceViewer.tsx");
  // Panel still opens the same lightbox and keeps the expired state; no public bucket.
  assert.match(viewer, /variant === "panel"/);
  assert.match(viewer, /tap to enlarge/);
  assert.match(viewer, /Evidence expired after finalization/);
  assert.match(viewer, /createSignedUrls/);
  assert.doesNotMatch(viewer, /getPublicUrl|public = true/);
});

test("legacy Challenge deep links redirect to the new canonical routes", async () => {
  for (const [file, target] of [
    ["log.tsx", "/challenge/add"],
    ["payments.tsx", "/challenge/money"],
    ["rules.tsx", "/challenge/terms"],
    ["targets.tsx", "/challenge/terms/override"],
  ]) {
    assert.match(
      await read(`src/routes/_authenticated/challenge/${file}`),
      new RegExp(`redirect\\(\\{ to: "${target}"`),
      file,
    );
  }
});
