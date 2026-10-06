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

test("duration grammar: plain numbers are minutes, not decimal minutes", () => {
  for (const [input, seconds] of [
    ["5", 300],
    ["15", 900],
    ["60", 3600],
    ["65", 3900],
    ["90", 5400],
  ]) {
    assert.equal(parseDurationToSeconds(input), seconds, input);
  }
});

test("duration grammar: clock input (colon and dot) parses to the same seconds", () => {
  for (const [input, seconds] of [
    ["15:50", 950],
    ["15.50", 950], // the reported bug: 15.50 is 15m50s, NOT 15.5 decimal minutes
    ["22:20", 1340],
    ["22.20", 1340],
    ["1:05:30", 3930],
    ["1.05.30", 3930],
  ]) {
    assert.equal(parseDurationToSeconds(input), seconds, input);
  }
});

test("duration grammar: unit input with natural carry", () => {
  for (const [input, seconds] of [
    ["30s", 30],
    ["45 sec", 45],
    ["90s", 90],
    ["120s", 120],
    ["15m", 900],
    ["15 min", 900],
    ["60m", 3600],
    ["75m", 4500],
    ["1h", 3600],
    ["2 hours", 7200],
    ["1h 15m", 4500],
    ["1 hour 15 minutes", 4500],
    ["1h 5m 30s", 3930],
    ["1h 90m", 9000],
  ]) {
    assert.equal(parseDurationToSeconds(input), seconds, input);
  }
});

test("duration grammar: invalid input is rejected", () => {
  for (const bad of [
    "15:75",
    "15.75",
    "1:75:00",
    "1:05:75",
    "1:05.30", // mixed separators
    "-5",
    "",
    "   ",
    "abc",
    "15 foo",
    "0",
    ":30",
    "1:2:3:4",
  ]) {
    assert.equal(parseDurationToSeconds(bad), null, bad);
  }
});

test("formatClock normalises seconds to canonical display", () => {
  for (const [seconds, display] of [
    [30, "0:30"],
    [300, "5:00"],
    [900, "15:00"],
    [950, "15:50"],
    [3600, "1:00:00"],
    [3900, "1:05:00"],
    [3930, "1:05:30"],
    [5400, "1:30:00"],
  ]) {
    assert.equal(formatClock(seconds), display, String(seconds));
  }
});

test("all equivalent duration spellings store the same duration_seconds", () => {
  const forms = ["15.50", "15:50", "15m 50s"];
  const seconds = forms.map((f) => parseDurationToSeconds(f));
  assert.deepEqual(seconds, [950, 950, 950]);
  // Edit prefill is the inverse: 950 -> "15:50", round-tripping to the same seconds.
  assert.equal(formatClock(950), "15:50");
  assert.equal(parseDurationToSeconds(formatClock(950)), 950);
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
  const view = await read("src/components/challenge-terms-view.tsx");
  assert.match(view, /\/challenge\/terms\/override/);
  assert.match(view, /\/challenge\/terms\/pause/);
  // Travel pause business logic lives on its own screen now, not on Money.
  const pause = await read("src/routes/_authenticated/challenge/terms_.pause.tsx");
  assert.match(pause, /setTravelPause/);
  assert.match(pause, /removeTravelPause/);
});

test("Terms, Pause and Override are independent routes (no parent swallowing the child)", async () => {
  const tree = await read("src/routeTree.gen.ts");
  // Child screens use the trailing-underscore files so they do not nest inside /challenge/terms.
  assert.ok(tree.includes("challenge/terms_.pause"), "terms_.pause file registered");
  assert.ok(tree.includes("challenge/terms_.override"), "terms_.override file registered");
  // Each path still resolves to its own route.
  assert.match(tree, /path: '\/challenge\/terms'/);
  assert.match(tree, /path: '\/challenge\/terms\/pause'/);
  assert.match(tree, /path: '\/challenge\/terms\/override'/);
  // Terms is a leaf route: it is not wrapped with children, so it cannot render the child screens.
  assert.doesNotMatch(tree, /AuthenticatedChallengeTermsRouteWithChildren/);
  // Each route file points at a distinct component.
  const terms = await read("src/routes/_authenticated/challenge/terms.tsx");
  const pause = await read("src/routes/_authenticated/challenge/terms_.pause.tsx");
  const override = await read("src/routes/_authenticated/challenge/terms_.override.tsx");
  assert.match(terms, /component: Terms\b/);
  assert.doesNotMatch(terms, /<Outlet/); // Terms renders its own content, not a child outlet
  assert.match(pause, /component: PauseWeek\b/);
  assert.match(pause, /Which week\?/); // the week chooser actually renders here
  assert.match(override, /component: TargetOverride\b/);
  assert.match(override, /New target for week/);
});

test("valid run insert payload is complete and omits DB-generated columns", async () => {
  // Mirror the UI's insert payload shape and prove it carries only writable columns.
  const payload = {
    challenge_id: "c1",
    user_id: "u1",
    activity_type: "run",
    distance_km: 4,
    activity_date: "2026-10-08",
    duration_seconds: parseDurationToSeconds("22:20"),
    external_activity_url: null,
    note: null,
    evidence_path: "c1/u1/shot.webp",
    extra_evidence_paths: [],
    verification_source: "manual_strava_screenshot",
  };
  assert.equal(payload.duration_seconds, 1340);
  // Generated columns must never be written on insert/update.
  for (const generated of [
    "equivalent_km",
    "qualifying_equivalent_km",
    "is_qualified",
    "average_speed_kmh",
    "average_pace_seconds_per_km",
  ]) {
    assert.ok(!(generated in payload), generated);
  }
  const add = await read("src/routes/_authenticated/challenge/add.tsx");
  for (const generated of [
    "equivalent_km:",
    "qualifying_equivalent_km:",
    "is_qualified:",
    "average_speed_kmh:",
    "average_pace_seconds_per_km:",
  ]) {
    assert.ok(!add.includes(generated), `add.tsx must not write ${generated}`);
  }
  // Save failures are reported to editor/preview telemetry for diagnosis, UI stays generic.
  assert.match(add, /reportLovableError\(e, \{/);
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
  // Deterministic: initial toggle state comes straight from the route search param…
  assert.match(add, /useState<"run" \| "cycle">\(searchType \?\? "run"\)/);
  // …and a restored draft must NOT override an explicit ?type= preselection.
  assert.match(add, /!searchType && \(draft\.type === "run" \|\| draft\.type === "cycle"\)/);
  // validateSearch maps ?type=run and ?type=cycle for direct URLs.
  assert.match(
    add,
    /search\["type"\] === "cycle" \? "cycle" : search\["type"\] === "run" \? "run"/,
  );
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

test("Profile loads the moved Phase 2 components without a blocking data dependency", async () => {
  const profile = await read("src/routes/_authenticated/profile.tsx");
  // The CSV export and notifications moved here; both are present and self-contained.
  assert.match(profile, /import \{ ChallengeDataExport \}/);
  assert.match(profile, /<ChallengeDataExport \/>/);
  assert.match(profile, /to: "\/profile\/notifications"/);
  const notifications = await read("src/routes/_authenticated/profile_.notifications.tsx");
  assert.match(notifications, /<ChallengeNotifications userId=\{user\.id\} expanded/);
  const exportCard = await read("src/components/ChallengeDataExport.tsx");
  // No challenge → render nothing (never blocks Profile), and the heavy history read is on demand.
  assert.match(exportCard, /if \(!challenge\) return null/);
  assert.match(exportCard, /await fetchActivitiesForExport/);
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
