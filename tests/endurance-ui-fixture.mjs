import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";
import { accountUI } from "./account-ui-fixture.mjs";
import {
  runningPeriodStats,
  cyclingPeriodStats,
  rawWeeklyDistance,
} from "../src/lib/endurance-progress.ts";
import { fmt, fmt0 } from "../src/lib/calc.ts";

// Actual shared pace formatter, including its unit, so duplicate units cannot hide in a mock.
const context = { exports: {} };
const formatter = readFileSync(new URL("../src/lib/challenge.ts", import.meta.url), "utf8").match(
  /export function formatPace[\s\S]*?\n}/,
)[0];
vm.runInNewContext(
  ts.transpileModule(formatter, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText,
  context,
);
export const { formatPace } = context.exports;
export function enduranceUI({
  values = [],
  range = { start: "2026-09-01", end: "2026-09-30" },
  previous = null,
} = {}) {
  return accountUI(
    "src/routes/_authenticated/bulk/progress_.endurance.tsx",
    "EnduranceBody",
    {
      recharts: Object.fromEntries(
        ["Line", "LineChart", "ResponsiveContainer", "Tooltip", "XAxis", "YAxis"].map((n) => [
          n,
          n,
        ]),
      ),
      "@/components/ProgressChrome": {},
      "@/lib/progress-view": { chartAxis: {} },
      "@/lib/calc": { fmt, fmt0 },
      "@/lib/auth": {},
      "@/lib/challenge": { formatPace },
      "@/lib/endurance-progress": {},
      "@/lib/progress-period": {},
    },
    {
      runs: runningPeriodStats(values, "me", range, previous),
      rides: cyclingPeriodStats(values, "me", range, previous),
      weekly: {
        run: rawWeeklyDistance(values, "me", range, "run"),
        ride: rawWeeklyDistance(values, "me", range, "cycle"),
      },
    },
  );
}
export const activityButton = (ui, prefix) =>
  ui.find("button").find((node) => node.props["aria-label"]?.startsWith(prefix));
