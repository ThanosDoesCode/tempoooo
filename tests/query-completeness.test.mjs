import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  QueryClient,
  InfiniteQueryObserver,
  queryOptions,
  infiniteQueryOptions,
} from "@tanstack/react-query";
import { presentationComponent } from "./presentation-component-fixture.mjs";
import * as pagination from "../src/lib/query-pagination.ts";
import { DEFAULT_DATA } from "../src/lib/types.ts";
import { createSaveQueue } from "../src/lib/workout-save.ts";
import { goalWeightStatus } from "../src/lib/goal-metrics.ts";

const id = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const day = (n) => new Date(Date.UTC(2025, 0, n + 1)).toISOString().slice(0, 10);

// Model a PostgREST cap smaller than the requested page, so short pages cannot hide truncation.
function fixture(tables, { apiCap = 73 } = {}) {
  const calls = [],
    signed = [];
  let failingTable = null;
  const supabase = {
    from(table) {
      const filters = [],
        orders = [];
      let limit = 1000,
        options = {},
        fields,
        expression;
      const query = {
        select(value, opts = {}) {
          fields = value;
          options = opts;
          return query;
        },
        eq(column, value) {
          filters.push(["eq", column, value]);
          return query;
        },
        gt(column, value) {
          filters.push(["gt", column, value]);
          return query;
        },
        gte(column, value) {
          filters.push(["gte", column, value]);
          return query;
        },
        lte(column, value) {
          filters.push(["lte", column, value]);
          return query;
        },
        in(column, values) {
          filters.push(["in", column, values]);
          return query;
        },
        order(column, opts = {}) {
          orders.push([column, opts.ascending !== false]);
          return query;
        },
        limit(value) {
          limit = value;
          return query;
        },
        or(value) {
          expression = value;
          return query;
        },
        async maybeSingle() {
          return { data: (tables[table] ?? [])[0] ?? null, error: null };
        },
        then(resolve, reject) {
          calls.push({ table, limit, fields, options, filters, orders, expression });
          if (table === failingTable)
            return Promise.resolve({ data: null, error: new Error("offline") }).then(
              resolve,
              reject,
            );
          let rows = (tables[table] ?? []).filter((row) =>
            filters.every(([op, column, value]) =>
              op === "eq"
                ? row[column] === value
                : op === "gt"
                  ? row[column] > value
                  : op === "gte"
                    ? row[column] >= value
                    : op === "lte"
                      ? row[column] <= value
                      : value.includes(row[column]),
            ),
          );
          if (expression) {
            const date = expression.match(/log_date\.lt\.([^,]+)/)[1];
            const created = expression.match(/created_at\.lt\.([^,)]+)/)[1];
            const cursorId = expression.match(/id\.lt\.([0-9a-f-]+)/)[1];
            rows = rows.filter(
              (row) =>
                row.log_date < date ||
                (row.log_date === date &&
                  (row.created_at < created || (row.created_at === created && row.id < cursorId))),
            );
          }
          rows.sort((a, b) => {
            for (const [column, ascending] of orders) {
              const cmp =
                typeof a[column] === "number"
                  ? a[column] - b[column]
                  : String(a[column]).localeCompare(String(b[column]));
              if (cmp) return ascending ? cmp : -cmp;
            }
            return 0;
          });
          return Promise.resolve({
            data: options.head ? null : rows.slice(0, Math.min(limit, apiCap)),
            count: options.count === "exact" ? rows.length : null,
            error: null,
          }).then(resolve, reject);
        },
      };
      return query;
    },
    storage: {
      from(bucket) {
        return {
          async createSignedUrls(paths, seconds) {
            signed.push({ bucket, paths, seconds });
            return {
              data: paths.map((path) => ({ path, signedUrl: `private-signed:${path}` })),
              error: null,
            };
          },
          getPublicUrl() {
            throw new Error("Must not expose public URLs");
          },
          download() {
            throw new Error("Must not eagerly download blobs");
          },
        };
      },
    },
  };
  const modules = {
    "@tanstack/react-query": { queryOptions, infiniteQueryOptions },
    "@/integrations/supabase/client": { supabase },
    "./network-errors": { shouldRetryRead: () => false, readRetryDelay: () => 0 },
    "./private-image-upload": {},
    "./bulk-training-sessions": {},
    "./query-pagination": pagination,
  };
  return {
    calls,
    signed,
    supabase,
    modules,
    progress: presentationComponent("src/lib/bulk-progress-query.ts", modules),
    meals: presentationComponent("src/lib/bulk-meal-presets-query.ts", modules),
    fail: (table) => {
      failingTable = table;
    },
  };
}

test("shared pagination drains short pages, deduplicates overlaps and checks the empty final page", async () => {
  const pages = [[{ id: "a" }, { id: "b" }], [{ id: "b" }, { id: "c" }], []];
  const cursors = [];
  const rows = await pagination.readAllByKey(
    async (cursor) => {
      cursors.push(cursor);
      return { data: pages.shift(), error: null };
    },
    (row) => row.id,
  );
  assert.deepEqual(
    rows.map((row) => row.id),
    ["a", "b", "c"],
  );
  assert.deepEqual(cursors, [null, "b", "c"]);
});

test("pagination fails explicitly for a stuck cursor or request error, never returns partial success", async () => {
  let calls = 0;
  await assert.rejects(
    pagination.readAllByKey(
      async () => {
        calls++;
        return { data: [{ id: "a" }], error: null };
      },
      (row) => row.id,
    ),
    /did not advance/,
  );
  assert.equal(calls, 2);
  await assert.rejects(
    pagination.readAllByKey(
      async () => ({ data: null, error: new Error("offline") }),
      (row) => row.id,
    ),
    /offline/,
  );
  assert.deepEqual(
    await pagination.readAllByKey(
      async () => ({ data: [], error: null }),
      (row) => row.id,
    ),
    [],
  );
});

const photos = Array.from({ length: 81 }, (_, i) => ({
  id: id(i + 1),
  bulk_profile_id: "owner",
  log_date: day(i % 10),
  created_at: "2026-10-06T10:00:00.000Z",
  storage_path: `owner/photo-${i}.webp`,
  view_type: ["front", "side", "back"][i % 3],
  note: null,
}));

test("photo total is exact above 24, scoped to the owner and requires no signing/blobs", async () => {
  const f = fixture({
    bulk_progress_photos: [
      ...photos,
      { ...photos[0], id: id(999), bulk_profile_id: "other-owner" },
    ],
  });
  assert.equal(await f.progress.bulkPhotoCountQueryOptions("owner").queryFn(), 81);
  assert.equal(await f.progress.bulkPhotoCountQueryOptions("other-owner").queryFn(), 1);
  assert.equal(f.signed.length, 0);
  assert.ok(f.calls.every((call) => call.options.head && call.options.count === "exact"));
  assert.notDeepEqual(
    f.progress.bulkPhotoCountQueryOptions("owner").queryKey,
    f.progress.bulkPhotoQueryOptions("owner").queryKey,
  );
});

test("photo gallery reaches older angle-filtered pages in deterministic order with private signed URLs", async () => {
  const f = fixture({ bulk_progress_photos: photos });
  const client = new QueryClient();
  const opts = f.progress.bulkPhotoQueryOptions("owner", "front");
  const observer = new InfiniteQueryObserver(client, opts);
  const unsubscribe = observer.subscribe(() => {});
  try {
    await observer.refetch();
    assert.equal(observer.getCurrentResult().data.length, 24);
    assert.equal(observer.getCurrentResult().hasNextPage, true);
    await observer.fetchNextPage();
    const result = observer.getCurrentResult();
    assert.equal(result.data.length, 27);
    assert.equal(result.hasNextPage, false);
    const expected = photos
      .filter((row) => row.view_type === "front")
      .sort(
        (a, b) =>
          b.log_date.localeCompare(a.log_date) ||
          b.created_at.localeCompare(a.created_at) ||
          b.id.localeCompare(a.id),
      );
    assert.deepEqual(
      Array.from(result.data, (row) => row.id),
      expected.map((row) => row.id),
    );
    assert.equal(new Set(result.data.map((row) => row.id)).size, 27);
    assert.ok(
      result.data.every(
        (photo) =>
          photo.viewType === "front" && photo.signedUrl.startsWith("private-signed:owner/"),
      ),
    );
    assert.ok(
      f.signed.every(
        (call) =>
          call.bucket === "bulk-progress-photos" && call.paths.length <= 24 && call.seconds === 900,
      ),
    );
    assert.ok(
      f.calls.every(
        (call) =>
          call.limit === 24 &&
          call.filters.some(
            ([op, col, value]) => op === "eq" && col === "view_type" && value === "front",
          ),
      ),
    );
    const side = f.progress.bulkPhotoQueryOptions("owner", "side");
    assert.notDeepEqual(side.queryKey, opts.queryKey);
    const sidePage = await side.queryFn({ pageParam: null });
    assert.ok(sidePage.photos.every((row) => row.viewType === "side"));
  } finally {
    unsubscribe();
    client.clear();
  }
});

test("photo pagination tolerates a smaller API cap and failed older pages keep existing photos", async () => {
  const f = fixture({ bulk_progress_photos: photos }, { apiCap: 7 });
  const opts = f.progress.bulkPhotoQueryOptions("owner", "front");
  let cursor = null,
    loaded = [];
  do {
    const page = await opts.queryFn({ pageParam: cursor });
    loaded.push(...page.photos);
    cursor = opts.getNextPageParam(page);
  } while (cursor);
  assert.equal(loaded.length, 27);
  assert.equal(new Set(loaded.map((row) => row.id)).size, 27);
  assert.equal(f.calls.length, 4);
  const deduped = opts.select({
    pages: [{ photos: loaded.slice(0, 10) }, { photos: loaded.slice(8) }],
  });
  assert.equal(deduped.length, 27);
  f.fail("bulk_progress_photos");
  await assert.rejects(opts.queryFn({ pageParam: null }), /offline/);
  await assert.rejects(
    opts.queryFn({ pageParam: { log_date: "bad", created_at: "bad", id: "bad" } }),
    /Invalid photo cursor/,
  );
  f.fail(null);
  const client = new QueryClient();
  const observer = new InfiniteQueryObserver(client, opts);
  const unsubscribe = observer.subscribe(() => {});
  try {
    await observer.refetch();
    f.fail("bulk_progress_photos");
    await observer.fetchNextPage();
    assert.equal(observer.getCurrentResult().isFetchNextPageError, true);
    assert.equal(observer.getCurrentResult().data.length, 7, "loaded photos stay visible");
    f.fail(null);
    await observer.fetchNextPage();
    assert.equal(observer.getCurrentResult().data.length, 14);
    assert.equal(observer.getCurrentResult().isFetchNextPageError, false);
  } finally {
    unsubscribe();
    client.clear();
  }
});

test("photo writes invalidate the exact total and every angle page for only that profile", async () => {
  const f = fixture({ bulk_progress_photos: photos });
  const client = new QueryClient();
  try {
    const count = f.progress.bulkPhotoCountQueryOptions("owner");
    const front = f.progress.bulkPhotoQueryOptions("owner", "front");
    const side = f.progress.bulkPhotoQueryOptions("owner", "side");
    const other = f.progress.bulkPhotoCountQueryOptions("other-owner");
    await client.fetchQuery(count);
    await client.fetchInfiniteQuery(front);
    await client.fetchInfiniteQuery(side);
    await client.fetchQuery(other);
    await client.invalidateQueries({ queryKey: f.progress.bulkPhotoQueryKey("owner") });
    for (const options of [count, front, side])
      assert.equal(client.getQueryState(options.queryKey).isInvalidated, true);
    assert.equal(client.getQueryState(other.queryKey).isInvalidated, false);
  } finally {
    client.clear();
  }
});

test("legacy days, workouts, notes and photos load completely and preserve payload/history", async () => {
  const tables = {
    bulk_targets: [],
    bulk_days: [],
    bulk_workouts: [],
    bulk_week_notes: [],
    bulk_photos: [],
  };
  for (let i = 0; i < 405; i++) {
    tables.bulk_days.push({
      id: id(i),
      bulk_profile_id: "owner",
      day: day(i),
      payload: { weight: 70, notes: `note-${i}`, mealPlan: "custom" },
    });
    tables.bulk_workouts.push({
      id: id(i),
      bulk_profile_id: "owner",
      day: day(i),
      payload: {
        date: day(i),
        status: "completed",
        entries: [{ exercise: "Rows", weight: 20, reps: [10], rpe: 8 }],
      },
    });
    tables.bulk_week_notes.push({
      id: id(i),
      bulk_profile_id: "owner",
      week_start: day(i * 7),
      note: `week-${i}`,
    });
    tables.bulk_photos.push({
      id: id(i),
      bulk_profile_id: "owner",
      taken_on: day(i),
      weight: 70,
      front_path: `owner/${i}.jpg`,
      side_path: null,
      back_path: null,
    });
  }
  for (const table of Object.keys(tables).filter((key) => key !== "bulk_targets"))
    tables[table].push({ ...tables[table][0], id: id(9999), bulk_profile_id: "other-owner" });
  const before = JSON.stringify(tables);
  const f = fixture(tables);
  const store = presentationComponent("src/lib/store.ts", {
    ...f.modules,
    react: { useCallback: (fn) => fn, useSyncExternalStore: (_, get) => get() },
    "@/lib/private-image-upload": {},
    "./workout-save": { createSaveQueue },
    "./types": { DEFAULT_DATA },
  });
  await store.loadBulk("owner", "owner");
  const data = store.useAppData();
  assert.equal(Object.keys(data.days).length, 405);
  assert.equal(Object.keys(data.workouts).length, 405);
  assert.equal(Object.keys(data.weekNotes).length, 405);
  assert.equal(data.photos.length, 405);
  assert.equal(data.workouts[day(404)].entries[0].rpe, 8);
  assert.equal(data.days[day(404)].mealPlan, "custom");
  assert.equal(data.photos[0].date, day(0));
  assert.equal(data.photos.at(-1).date, day(404));
  assert.equal(JSON.stringify(tables), before, "source rows are never rewritten");
  assert.ok(f.calls.every((call) => call.limit <= pagination.QUERY_PAGE_SIZE));
  assert.ok(f.signed.every((call) => call.paths.length <= pagination.QUERY_PAGE_SIZE));
});

test("nutrition totals drain more than a page of child entries and keep date/target snapshots", async () => {
  const days = Array.from({ length: 105 }, (_, i) => ({
    id: id(i),
    bulk_profile_id: "owner",
    log_date: day(i),
    target_calories: 2000 + i,
  }));
  const entries = days.flatMap((d, i) =>
    Array.from({ length: 12 }, (_, j) => ({
      id: id(1000 + i * 12 + j),
      nutrition_day_id: d.id,
      calories: 100 + j,
      protein_g: 5,
    })),
  );
  entries.push({
    id: id(9999),
    nutrition_day_id: "unrelated-day",
    calories: 9999,
    protein_g: 9999,
  });
  const f = fixture({ bulk_nutrition_days: days, bulk_nutrition_entries: entries });
  const result = await f.progress
    .bulkProgressNutritionQueryOptions("owner", day(0), day(104))
    .queryFn();
  assert.equal(result.length, 105);
  assert.ok(result.every((row) => row.calories === 1266 && row.protein === 60));
  assert.equal(result[0].targetCalories, 2000);
  assert.equal(result.at(-1).targetCalories, 2104);
  const childCalls = f.calls.filter((call) => call.table === "bulk_nutrition_entries");
  assert.ok(
    childCalls.every(
      (call) =>
        call.filters.find(([op]) => op === "in")[2].length <= pagination.QUERY_ID_BATCH_SIZE,
    ),
  );
  assert.ok(childCalls.length < days.length, "batched, not a request per day");
  const narrow = await f.progress
    .bulkProgressNutritionQueryOptions("owner", day(10), day(11))
    .queryFn();
  assert.deepEqual(
    Array.from(narrow, (row) => row.logDate),
    [day(10), day(11)],
  );
});

test("presets and ingredients are exhaustive, ordered, hidden-aware and limited to requested profile", async () => {
  const presets = Array.from({ length: 205 }, (_, i) => ({
    id: id(i),
    bulk_profile_id: "owner",
    name: `Meal ${i}`,
    sort_order: i % 4,
    calories: 100,
    protein_g: 10,
    carbs_g: 10,
    fat_g: 5,
    source_key: i === 0 ? "legacy:salmon" : null,
    show_in_quick_add: i % 2 === 0,
  }));
  presets.push({
    ...presets[0],
    id: id(999),
    bulk_profile_id: "other-owner",
    name: "Other owner's meal",
  });
  const ingredients = presets.flatMap((preset, i) =>
    Array.from({ length: 6 }, (_, j) => ({
      id: id(2000 + i * 6 + j),
      meal_preset_id: preset.id,
      name: `Ingredient ${j}`,
      quantity: 125,
      unit: "g",
      sort_order: 5 - j,
    })),
  );
  const f = fixture({ bulk_meal_presets: presets, bulk_meal_preset_ingredients: ingredients });
  const result = await f.meals.bulkMealPresetsQueryOptions("owner").queryFn();
  assert.equal(result.length, 205);
  assert.ok(
    result.every((meal) => meal.bulkProfileId === "owner" && meal.ingredients.length === 6),
  );
  assert.ok(
    result.every((meal) => meal.ingredients.map((i) => i.sortOrder).join() === "0,1,2,3,4,5"),
  );
  const expected = presets
    .filter((meal) => meal.bulk_profile_id === "owner")
    .sort((a, b) => a.sort_order - b.sort_order || a.id.localeCompare(b.id));
  assert.deepEqual(
    Array.from(result, (meal) => meal.id),
    expected.map((meal) => meal.id),
  );
  assert.equal(result.filter((meal) => meal.showInQuickAdd).length, 103);
  assert.equal(
    result.filter((meal) => !meal.showInQuickAdd).length,
    102,
    "hidden rows remain manageable",
  );
  assert.equal(result.find((meal) => meal.id === id(0)).sourceKey, "legacy:salmon");
  const childCalls = f.calls.filter((call) => call.table === "bulk_meal_preset_ingredients");
  assert.ok(
    childCalls.every((call) => {
      const ids = call.filters.find(([op]) => op === "in")[2];
      return ids.length <= pagination.QUERY_ID_BATCH_SIZE && !ids.includes(id(999));
    }),
  );
  assert.ok(childCalls.length < presets.length);
});

test("weights exceed the old 180 cap; narrow historical review produces the same goal status", async () => {
  const weights = Array.from({ length: 405 }, (_, i) => ({
    id: id(i),
    bulk_profile_id: "owner",
    log_date: day(i),
    weight_kg: 70 + i / 100,
  }));
  weights.push({ id: id(999), bulk_profile_id: "other-owner", log_date: day(0), weight_kg: 999 });
  const f = fixture({ bulk_weight_entries: weights });
  const all = await f.progress.bulkWeightQueryOptions("owner", day(0), day(404)).queryFn();
  assert.equal(all.length, 405);
  assert.equal(all.at(-1).logDate, day(0));
  // A historical Weekly Review ends on Sunday, just like the actual route.
  const historical = await f.progress.bulkWeightQueryOptions("owner", day(5), day(25)).queryFn();
  assert.equal(historical.length, 21);
  assert.deepEqual(
    goalWeightStatus({ weights: historical, today: day(25), goal: "gain" }),
    goalWeightStatus({ weights: all, today: day(25), goal: "gain" }),
  );
  const today = await f.progress.bulkWeightQueryOptions("owner", day(404), day(404)).queryFn();
  assert.equal(today.length, 1);
  const progress = await f.progress.bulkWeightQueryOptions("owner", day(315), day(404)).queryFn();
  assert.equal(progress.length, 90);
  assert.ok(progress.every((w) => w.logDate >= day(315) && w.logDate <= day(404)));
});

test("weight cache includes both bounds and profile-prefix invalidation covers all ranges only for that owner", async () => {
  const f = fixture({
    bulk_weight_entries: [{ id: id(1), bulk_profile_id: "owner", log_date: day(1), weight_kg: 70 }],
  });
  const client = new QueryClient();
  try {
    const a = f.progress.bulkWeightQueryOptions("owner", day(0), day(0));
    const b = f.progress.bulkWeightQueryOptions("owner", day(0), day(1));
    const other = f.progress.bulkWeightQueryOptions("other-owner", day(0), day(1));
    assert.equal((await client.ensureQueryData(a)).length, 0);
    assert.equal((await client.ensureQueryData(b)).length, 1);
    await client.ensureQueryData(other);
    await client.invalidateQueries({ queryKey: f.progress.bulkWeightQueryKey("owner") });
    assert.equal(client.getQueryState(a.queryKey).isInvalidated, true);
    assert.equal(client.getQueryState(b.queryKey).isInvalidated, true);
    assert.equal(client.getQueryState(other.queryKey).isInvalidated, false);
  } finally {
    client.clear();
  }
});

test("Weekly Review uses selected-week bounds, while existing photo comparison and private access remain", () => {
  const review = readFileSync("src/routes/_authenticated/bulk/check-in.tsx", "utf8");
  assert.match(review, /mode === "weekly" \? weekStart : weekStartOf\(new Date\(\)\)/);
  assert.match(review, /useBulkWeights\(\s*publicId,\s*iso\(addDays\(weightWeek, -14\)\)/);
  const photosRoute = readFileSync("src/routes/_authenticated/bulk/progress_.photos.tsx", "utf8");
  assert.match(photosRoute, /useBulkProgressPhotos\(profileId, angle\)/);
  assert.match(photosRoute, /photosQuery\.fetchNextPage\(\)/);
  assert.match(photosRoute, /Load older photos/);
  assert.match(photosRoute, /Compare other dates/);
  assert.match(photosRoute, /const owner = role === "owner"/);
  assert.doesNotMatch(photosRoute, /getPublicUrl/);
});

test("All-time nutrition and weight omit a made-up start and exhaust capped owner-scoped reads", async () => {
  const weights = Array.from({ length: 1001 }, (_, i) => ({
    id: id(i),
    bulk_profile_id: "owner",
    log_date: day(i),
    weight_kg: 70,
    note: null,
  }));
  const days = weights.map((w, i) => ({
    id: id(i),
    bulk_profile_id: "owner",
    log_date: w.log_date,
    target_calories: 2000 + i,
  }));
  const entries = days.map((d, i) => ({
    id: id(2000 + i),
    nutrition_day_id: d.id,
    calories: 2000 + i,
    protein_g: 100,
  }));
  weights.push({ ...weights[0], id: id(9999), bulk_profile_id: "other-owner" });
  days.push({ ...days[0], id: id(9999), bulk_profile_id: "other-owner" });
  const f = fixture({
    bulk_weight_entries: weights,
    bulk_nutrition_days: days,
    bulk_nutrition_entries: entries,
  });
  const allWeights = await f.progress.bulkWeightQueryOptions("owner", null, day(1000)).queryFn();
  const allFood = await f.progress
    .bulkProgressNutritionQueryOptions("owner", null, day(1000))
    .queryFn();
  assert.equal(allWeights.length, 1001);
  assert.equal(allFood.length, 1001);
  assert.equal(allFood[0].targetCalories, 2000);
  assert.equal(allFood.at(-1).targetCalories, 3000);
  assert.ok(allWeights.every((entry) => entry.bulkProfileId === "owner"));
  assert.ok(f.calls.every((call) => call.limit <= pagination.QUERY_PAGE_SIZE));
});
