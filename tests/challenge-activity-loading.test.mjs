import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";
import ts from "typescript";
import * as paging from "../src/lib/challenge-activity-data.ts";

const source = await readFile(new URL("../src/lib/challenge.ts", import.meta.url), "utf8");
function fixture(rows) {
  const calls = [];
  let options;
  const supabase = {
    from(table) {
      const call = { table, orders: [], limit: 0, cursor: null };
      calls.push(call);
      const query = {
        select(fields) {
          call.fields = fields;
          return query;
        },
        eq(field, value) {
          call[field] = value;
          return query;
        },
        order(field, config) {
          call.orders.push([field, config.ascending]);
          return query;
        },
        limit(value) {
          call.limit = value;
          return query;
        },
        gte(field, value) {
          call.start = value;
          return query;
        },
        lte(field, value) {
          call.end = value;
          return query;
        },
        or(filter) {
          call.cursor = filter;
          return query;
        },
        then(resolve) {
          let result = rows.filter(
            (row) =>
              row.challenge_id === call.challenge_id &&
              (!call.start || (row.activity_date >= call.start && row.activity_date <= call.end)),
          );
          result.sort(
            (a, b) =>
              b.activity_date.localeCompare(a.activity_date) ||
              b.created_at.localeCompare(a.created_at) ||
              a.id.localeCompare(b.id),
          );
          if (call.cursor) {
            const match = call.cursor.match(
              /activity_date.lt.([^,]+),and\(activity_date.eq.[^,]+,created_at.lt.([^\)]+)\),and\(.*id.gt.([^\)]+)\)/,
            );
            assert.ok(match, "valid PostgREST keyset expression");
            result = result.filter(
              (row) =>
                row.activity_date < match[1] ||
                (row.activity_date === match[1] &&
                  (row.created_at < match[2] ||
                    (row.created_at === match[2] && row.id > match[3]))),
            );
          }
          return Promise.resolve({ data: result.slice(0, call.limit), error: null }).then(resolve);
        },
      };
      return query;
    },
  };
  const context = {
    exports: {},
    require(name) {
      if (name.includes("challenge-activity-data")) return paging;
      if (name.includes("supabase/client")) return { supabase };
      if (name === "@tanstack/react-query")
        return {
          queryOptions: (x) => x,
          useInfiniteQuery: (x) => {
            options = x;
            return { data: { pages: [] } };
          },
          useQuery: (x) => {
            options = x;
            return {};
          },
        };
      return {};
    },
  };
  vm.runInNewContext(
    ts.transpileModule(source, {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    }).outputText,
    context,
  );
  return { api: context.exports, calls, options: () => options };
}
const rows = Array.from({ length: 1207 }, (_, i) => ({
  id: `00000000-0000-0000-0000-${String(i).padStart(12, "0")}`,
  challenge_id: "challenge",
  user_id: "owner",
  activity_date: i < 600 ? "2026-10-02" : "2026-10-01",
  created_at: "2026-10-02T12:00:00.000000+00:00",
  distance_km: 5,
  duration_seconds: 1800,
  evidence_path: "private/path",
  extra_evidence_paths: ["private/extra"],
  edited: true,
}));

test("recent feed is bounded, explicitly projected and deterministically ordered; older pages have no duplicates", async () => {
  const { api, calls } = fixture(rows);
  const first = await api.fetchActivityPage("challenge");
  assert.equal(first.rows.length, 20);
  assert.equal(calls[0].limit, 21);
  assert.deepEqual(JSON.parse(JSON.stringify(calls[0].orders)), [
    ["activity_date", false],
    ["created_at", false],
    ["id", true],
  ]);
  for (const field of [
    "evidence_path",
    "extra_evidence_paths",
    "edited",
    "external_activity_url",
    "duration_seconds",
    "note",
  ])
    assert.ok(calls[0].fields.split(",").includes(field));
  assert.ok(!calls[0].fields.includes("*"));
  assert.ok(!calls[0].fields.split(",").includes("evidence_expired_at"));
  const second = await api.fetchActivityPage("challenge", first.next);
  assert.equal(second.rows.length, 20);
  assert.equal(paging.uniqueActivityPages([first, second]).length, 40);
  assert.equal(paging.uniqueActivityPages([first, first, second]).length, 40);
});

test("export explicitly traverses complete history beyond API row limits and timestamp/date ties", async () => {
  const { api, calls } = fixture(rows);
  const result = await api.fetchActivitiesForExport("challenge");
  assert.equal(result.length, 1207);
  assert.equal(new Set(result.map((row) => row.id)).size, 1207);
  assert.equal(calls.length, 3);
  assert.ok(calls.every((call) => call.limit === 501));
  assert.equal(result[0].evidence_path, "private/path");
});

test("finalized detail reads only its week, cache keys separate feed/range/summary but share mutation invalidation root", async () => {
  const { api, calls, options } = fixture(rows);
  await api.fetchActivityPage("challenge", null, { start: "2026-10-01", end: "2026-10-01" });
  assert.equal(calls[0].start, "2026-10-01");
  assert.equal(calls[0].end, "2026-10-01");
  api.useActivities("challenge");
  assert.equal(options().queryKey[0], "challenge-activities");
  assert.equal(options().queryKey[2], "feed");
  assert.equal(options().staleTime, 30000);
  api.useActivitySummary("challenge");
  assert.equal(options().queryKey[0], "challenge-activities");
  assert.equal(options().queryKey[2], "summary");
  api.useActivities("challenge", { start: "", end: "" });
  assert.equal(options().enabled, false);
});

test("malformed cursors cannot inject filters; overview uses server totals, payments export remains on-demand", async () => {
  assert.throws(() => paging.activityCursorFilter({ ...rows[0], id: "bad),user_id.eq.other" }));
  const home = await readFile(
    new URL("../src/routes/_authenticated/challenge/index.tsx", import.meta.url),
    "utf8",
  );
  const payments = await readFile(
    new URL("../src/routes/_authenticated/challenge/payments.tsx", import.meta.url),
    "utf8",
  );
  const log = await readFile(
    new URL("../src/routes/_authenticated/challenge/log.tsx", import.meta.url),
    "utf8",
  );
  assert.match(home, /useActivitySummary/);
  assert.doesNotMatch(home, /sumWeek\(/);
  assert.match(
    home,
    /row.userId === opponent.userId\) \?\? \{\s*running: 0,\s*cycling: 0,\s*equivalent: 0/,
  );
  assert.match(home, /fetchNextPage/);
  assert.match(payments, /useActivitySummary/);
  assert.match(payments, /await fetchActivitiesForExport/);
  assert.doesNotMatch(payments, /useActivities\(/);
  assert.match(home, /invalidateQueries\(\{ queryKey: \["challenge-activities"\]/);
  assert.match(log, /invalidateQueries\(\{ queryKey: \["challenge-activities"\]/);
});

test("dashboard initially fetches 5 plus sentinel, then 10 plus sentinel without skipping records", async () => {
  const { api, calls, options } = fixture(rows);
  api.useActivities("challenge");
  const query = options();
  const first = await query.queryFn({ pageParam: null });
  assert.equal(first.rows.length, 5);
  assert.equal(calls[0].limit, 6);
  const second = await query.queryFn({ pageParam: query.getNextPageParam(first) });
  assert.equal(second.rows.length, 10);
  assert.equal(calls[1].limit, 11);
  const third = await query.queryFn({ pageParam: query.getNextPageParam(second) });
  assert.equal(third.rows.length, 10);
  const merged = paging.uniqueActivityPages([first, second, third]);
  assert.equal(merged.length, 25);
  assert.deepEqual(
    merged.map((row) => row.id),
    rows.slice(0, 25).map((row) => row.id),
  );
  const small = fixture(rows.slice(0, 4));
  small.api.useActivities("challenge");
  const page = await small.options().queryFn({ pageParam: null });
  assert.equal(page.rows.length, 4);
  assert.equal(small.options().getNextPageParam(page), undefined);
});
