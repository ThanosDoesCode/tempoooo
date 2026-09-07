import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";
import ts from "typescript";

const compiled = ts.transpileModule(
  await readFile(new URL("../src/lib/challenge-export.ts", import.meta.url), "utf8"),
  {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
    },
  },
).outputText;

const calculations = {
  activityMetrics(activity) {
    const speed = (activity.distance_km * 3600) / activity.duration_seconds;
    const pace = activity.duration_seconds / activity.distance_km;
    const qualified = activity.activity_type === "run" ? pace < 420 : speed >= 18;
    return {
      averageSpeed: speed,
      averagePace: pace,
      qualified,
      equivalent: qualified
        ? activity.activity_type === "run"
          ? activity.distance_km
          : activity.distance_km / 3
        : 0,
    };
  },
  formatPace(seconds) {
    const rounded = Math.round(seconds);
    return `${Math.floor(rounded / 60)}:${String(rounded % 60).padStart(2, "0")} min/km`;
  },
  qualifiedEquivalentKm(activity) {
    return activity.qualifying_equivalent_km;
  },
  summarizeActivities(activities, userId) {
    const rows = activities.filter((activity) => activity.user_id === userId);
    const totalKm = rows.reduce((sum, activity) => sum + activity.distance_km, 0);
    const seconds = rows.reduce((sum, activity) => sum + activity.duration_seconds, 0);
    const runs = rows.filter((activity) => activity.activity_type === "run");
    const runKm = runs.reduce((sum, activity) => sum + activity.distance_km, 0);
    const runSeconds = runs.reduce((sum, activity) => sum + activity.duration_seconds, 0);
    return {
      totalKm,
      challengeKm: rows.reduce((sum, activity) => sum + activity.qualifying_equivalent_km, 0),
      averageSpeedKmh: seconds ? (totalKm * 3600) / seconds : null,
      runningPaceSecondsPerKm: runKm ? runSeconds / runKm : null,
      qualifiedActivities: rows.filter((activity) => activity.is_qualified).length,
      activities: rows.length,
    };
  },
  weekNumberOf() {
    return 1;
  },
};

const context = {
  exports: {},
  Blob,
  URL,
  require(name) {
    if (name === "./challenge") return calculations;
    return {};
  },
};
vm.runInNewContext(compiled, context);

test("challenge CSV preserves summary, activity, finalized-week and travel-pause records", () => {
  const csv = context.exports.challengeCsv(
    {
      name: "52 week",
      start_date: "2026-08-31",
      weekly_target_km: 30,
      penalty_mode: "custom",
      penalty_high_eur: 60,
      penalty_medium_eur: 35,
      penalty_low_eur: 10,
      penalty_high_custom: "Send 3 photos",
      penalty_medium_custom: "Buy dinner",
      penalty_low_custom: "Make breakfast",
      legacy_photo_owed: false,
      travel_pause_enabled: true,
      travel_pause_home_countries: ["GR", "SE"],
    },
    [
      { userId: "a", name: "=Alex" },
      { userId: "b", name: "Sam" },
    ],
    [
      {
        id: "activity-1",
        user_id: "a",
        activity_date: "2026-08-31",
        activity_type: "cycle",
        distance_km: 21,
        duration_seconds: 3600,
        is_qualified: true,
        qualifying_equivalent_km: 7,
      },
    ],
    [
      {
        user_id: "a",
        week_number: 1,
        week_start: "2026-08-31",
        week_end: "2026-09-06",
        running_km: 0,
        cycling_km: 21,
        equivalent_km: 7,
        target_km: 0,
        completed: true,
        penalty_eur: 0,
        penalty_mode: "custom",
        penalty_band: "medium",
        penalty_consequence: "Buy dinner",
        paused: true,
        pause_country: "Italy",
      },
    ],
    [
      {
        id: "pause-1",
        user_id: "a",
        week_number: 1,
        country: "Italy",
      },
    ],
  );

  assert.match(csv, /"player_summary"/);
  assert.match(csv, /"activity"/);
  assert.match(csv, /"finalized_week"/);
  assert.match(csv, /"travel_pause"/);
  assert.match(csv, /"'=Alex"/);
  assert.match(csv, /"21"/);
  assert.match(csv, /"7"/);
  assert.match(csv, /"Italy"/);
  assert.match(csv, /"weekly_target_km"/);
  assert.match(csv, /"penalty_high_eur"/);
  assert.match(csv, /"travel_pause_enabled"/);
  assert.match(csv, /"travel_pause_home_countries"/);
  assert.match(csv, /"GR\|SE"/);
  assert.match(csv, /"applied_penalty_consequence"/);
  assert.match(csv, /"Buy dinner"/);
  assert.match(csv, /"30"/);
  assert.match(csv, /"60"/);
  assert.match(csv, /"35"/);
  assert.match(csv, /"10"/);
});

test("challenge CSV resolves open activity targets and exports future overrides", () => {
  const csv = context.exports.challengeCsv(
    {
      name: "Variable target",
      start_date: "2026-08-31",
      weekly_target_km: 15,
      penalty_mode: "money",
      penalty_high_eur: 15,
      penalty_medium_eur: 10,
      penalty_low_eur: 5,
      penalty_high_custom: null,
      penalty_medium_custom: null,
      penalty_low_custom: null,
      legacy_photo_owed: false,
      travel_pause_enabled: false,
      travel_pause_home_countries: [],
    },
    [{ userId: "a", name: "Alex" }],
    [
      {
        id: "activity-open",
        user_id: "a",
        activity_date: "2026-08-31",
        activity_type: "run",
        distance_km: 5,
        duration_seconds: 1500,
        is_qualified: true,
        qualifying_equivalent_km: 5,
      },
    ],
    [],
    [],
    [{ challenge_id: "challenge", week_number: 1, target_km: 22.5, set_by: "a" }],
  );

  const rows = csv.split("\n");
  const activityRow = rows.find((row) => row.includes('"activity"'));
  const overrideRow = rows.find((row) => row.includes('"week_target_override"'));
  assert.ok(activityRow?.includes('"22.5"'));
  assert.ok(overrideRow?.includes('"22.5"'));
  assert.ok(overrideRow?.includes('"All active participants"'));
});
