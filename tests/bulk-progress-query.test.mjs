import { test } from "node:test";
import assert from "node:assert/strict";
import { QueryClient, queryOptions } from "@tanstack/react-query";
import { presentationComponent } from "./presentation-component-fixture.mjs";
import * as pagination from "../src/lib/query-pagination.ts";

const rows = [
  { id: "earlier", bulk_profile_id: "owner", log_date: "2026-10-01", weight_kg: 70 },
  { id: "today", bulk_profile_id: "owner", log_date: "2026-10-06", weight_kg: 71 },
  { id: "other", bulk_profile_id: "other-owner", log_date: "2026-10-06", weight_kg: 90 },
];

function fixture() {
  const calls = [];
  const supabase = {
    from() {
      let profile, from, cursor, to;
      const query = {
        select() {
          return query;
        },
        eq(_, value) {
          profile = value;
          return query;
        },
        gte(_, value) {
          from = value;
          return query;
        },
        gt(_, value) {
          cursor = value;
          return query;
        },
        lte(_, value) {
          to = value;
          return query;
        },
        order() {
          return query;
        },
        limit() {
          return query;
        },
        then(resolve, reject) {
          calls.push({ profile, from });
          return Promise.resolve({
            data: rows.filter(
              (row) =>
                row.bulk_profile_id === profile &&
                row.log_date >= from &&
                (!cursor || row.log_date > cursor) &&
                (!to || row.log_date <= to),
            ),
            error: null,
          }).then(resolve, reject);
        },
      };
      return query;
    },
  };
  const queries = presentationComponent("src/lib/bulk-progress-query.ts", {
    "@tanstack/react-query": { queryOptions },
    "@/integrations/supabase/client": { supabase },
    "./network-errors": { shouldRetryRead: () => false, readRetryDelay: () => 0 },
    "./private-image-upload": {},
    "./bulk-training-sessions": {},
    "./query-pagination": pagination,
  });
  return { calls, queries, client: new QueryClient() };
}

test("Today weight cache cannot truncate Progress or Weekly Review, and profiles stay isolated", async () => {
  const { calls, queries, client } = fixture();
  try {
    const today = await client.ensureQueryData(
      queries.bulkWeightQueryOptions("owner", "2026-10-06"),
    );
    const progress = await client.ensureQueryData(
      queries.bulkWeightQueryOptions("owner", "2026-10-01"),
    );
    const other = await client.ensureQueryData(
      queries.bulkWeightQueryOptions("other-owner", "2026-10-01"),
    );
    assert.deepEqual(
      today.map((row) => row.id),
      ["today"],
    );
    assert.deepEqual(
      progress.map((row) => row.id),
      ["today", "earlier"],
    );
    assert.deepEqual(
      other.map((row) => row.id),
      ["other"],
    );
    assert.equal(calls.length, 6, "each nonempty range also checks the terminal empty page");
  } finally {
    client.clear();
  }
});

test("weight writes invalidate every date range for that profile without invalidating another user", async () => {
  const { calls, queries, client } = fixture();
  try {
    const ranges = ["2026-10-06", "2026-10-01"];
    for (const from of ranges)
      await client.ensureQueryData(queries.bulkWeightQueryOptions("owner", from));
    const otherOptions = queries.bulkWeightQueryOptions("other-owner", "2026-10-01");
    await client.ensureQueryData(otherOptions);
    await client.invalidateQueries({ queryKey: queries.bulkWeightQueryKey("owner") });
    for (const from of ranges)
      assert.equal(
        client.getQueryState(queries.bulkWeightQueryOptions("owner", from).queryKey).isInvalidated,
        true,
      );
    assert.equal(client.getQueryState(otherOptions.queryKey).isInvalidated, false);
    await client.ensureQueryData(queries.bulkWeightQueryOptions("owner", ranges[0]));
    assert.equal(calls.length, 6, "cached range reads remain deduplicated");
  } finally {
    client.clear();
  }
});
