import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";
import * as pagination from "../src/lib/query-pagination.ts";

// Execute the real server function; only its Supabase transport is simulated.
const server = ts.transpileModule(readFileSync("src/lib/privileged-rpcs.server.ts", "utf8"), {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
}).outputText;
const id = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const owner = id(1);
const other = id(2);
const profile = id(3);
const otherProfile = id(4);
const photoBucket = "bulk-progress-photos";
const objectKey = (bucket, path) => `${bucket}:${path}`;

function fixture({ normalized = 0, legacy = 0, apiCap = 1000, ...options } = {}) {
  const tables = {
    bulk_profiles: [
      { id: profile, owner_id: owner },
      { id: otherProfile, owner_id: other },
    ],
    bulk_progress_photos: Array.from({ length: normalized }, (_, n) => ({
      id: id(100 + n),
      bulk_profile_id: profile,
      storage_path: `${profile}/public/${n}/photo.webp`,
    })),
    bulk_photos: Array.from({ length: legacy }, (_, n) => ({
      id: id(100 + n),
      bulk_profile_id: profile,
      front_path: `${profile}/${n}/front.jpg`,
      side_path: `${profile}/${n}/side.jpg`,
      back_path: `${profile}/${n}/back.jpg`,
    })),
  };
  tables.bulk_progress_photos.push({
    id: id(99),
    bulk_profile_id: otherProfile,
    storage_path: `${otherProfile}/public/other/photo.webp`,
  });
  tables.bulk_photos.push({
    id: id(99),
    bulk_profile_id: otherProfile,
    front_path: `${otherProfile}/other/front.jpg`,
    side_path: null,
    back_path: null,
  });
  const pathsInRows = (profileId) => [
    ...tables.bulk_progress_photos
      .filter((row) => row.bulk_profile_id === profileId)
      .map((row) => row.storage_path),
    ...tables.bulk_photos
      .filter((row) => row.bulk_profile_id === profileId)
      .flatMap((row) => [row.front_path, row.side_path, row.back_path])
      .filter(Boolean),
  ];
  const objects = new Set(
    [...pathsInRows(profile), ...pathsInRows(otherProfile)].map((path) =>
      objectKey(photoBucket, path),
    ),
  );
  objects.add(objectKey("challenge-evidence", "shared-challenge/evidence.webp"));
  objects.add(objectKey("payment-evidence", "shared-payment/evidence.webp"));
  const authUsers = new Set([owner, other]);
  const challenges = [{ id: "shared-challenge", created_by: other }];
  const calls = [],
    removals = [],
    events = [],
    authDeletes = [];
  const pageCalls = new Map();
  let activeRemovals = 0,
    maxActiveRemovals = 0;
  const admin = {
    from(table) {
      // The deletion function must not read or mutate other tables here.
      assert.ok(Object.hasOwn(tables, table), table);
      const filters = [];
      let fields,
        ordering,
        limit = Infinity;
      const query = {
        select(value) {
          fields = value;
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
        order(column, value) {
          ordering = [column, value.ascending];
          return query;
        },
        limit(value) {
          limit = value;
          return query;
        },
        async maybeSingle() {
          assert.equal(table, "bulk_profiles");
          assert.equal(fields, "id");
          assert.deepEqual(filters, [["eq", "owner_id", owner]]);
          return {
            data: options.profileError
              ? null
              : tables.bulk_profiles.find((p) => p.owner_id === owner),
            error: options.profileError ? new Error("Profile unavailable") : null,
          };
        },
        then(resolve, reject) {
          const count = (pageCalls.get(table) ?? 0) + 1;
          pageCalls.set(table, count);
          const cursor = filters.find(([op]) => op === "gt")?.[2] ?? null;
          calls.push({ table, fields, filters, ordering, limit, cursor });
          if (table === options.failTable && count === (options.failPage ?? 1))
            return Promise.resolve({ data: null, error: new Error("Read failed") }).then(
              resolve,
              reject,
            );
          let rows = tables[table].filter((row) =>
            filters.every(([op, key, value]) =>
              op === "eq" ? row[key] === value : row[key] > value,
            ),
          );
          rows.sort((a, b) => a.id.localeCompare(b.id));
          if (options.overlap && cursor && rows.length) {
            const previous = tables[table].find((row) => row.id === cursor);
            if (previous) rows.unshift(previous);
          }
          rows = rows.slice(0, Math.min(limit, apiCap));
          if (options.stalled === table)
            rows = tables[table].filter((row) => row.bulk_profile_id === profile).slice(0, 1);
          if (options.runaway === table)
            rows = [{ id: id(100 + count), storage_path: `${profile}/public/runaway.webp` }];
          events.push({ kind: "page", table, count: rows.length });
          return Promise.resolve({ data: rows, error: null }).then(resolve, reject);
        },
      };
      return query;
    },
    storage: {
      from(bucket) {
        assert.equal(bucket, photoBucket);
        return {
          async remove(paths) {
            removals.push({ bucket, paths: [...paths] });
            activeRemovals++;
            maxActiveRemovals = Math.max(maxActiveRemovals, activeRemovals);
            try {
              await new Promise((resolve) => setImmediate(resolve));
              if (removals.length === options.failBatch) {
                if (options.throwStorage) throw new Error("Storage network failure");
                return { error: new Error("Storage deletion failure") };
              }
              const removed = paths.filter((path) => objects.delete(objectKey(bucket, path)));
              events.push({ kind: "removed", count: removed.length });
              // Missing objects succeed with an empty result, as on a deletion retry.
              return { data: removed.map((name) => ({ name })), error: null };
            } finally {
              activeRemovals--;
            }
          },
        };
      },
    },
    auth: {
      admin: {
        async deleteUser(user) {
          authDeletes.push(user);
          if (options.authError) return { error: new Error("Auth unavailable") };
          assert.equal(user, owner);
          authUsers.delete(user);
          for (const table of Object.keys(tables))
            tables[table] = tables[table].filter((row) =>
              table === "bulk_profiles" ? row.owner_id !== user : row.bulk_profile_id !== profile,
            );
          events.push({ kind: "auth-deleted" });
          return { error: null };
        },
      },
    },
  };
  const context = {
    exports: {},
    require(module) {
      if (module === "@/integrations/supabase/client.server") return { supabaseAdmin: admin };
      if (module === "./query-pagination") return pagination;
      throw new Error(`Unexpected dependency: ${module}`);
    },
  };
  vm.runInNewContext(server, context);
  return {
    tables,
    options,
    objects,
    authUsers,
    calls,
    removals,
    events,
    authDeletes,
    challenges,
    pathsInRows,
    maxActiveRemovals: () => maxActiveRemovals,
    run: () => context.exports.deleteTempoAccountFor(owner),
  };
}

function assertSafeReads(f) {
  for (const call of f.calls) {
    assert.ok(call.limit <= 200 && call.limit > 0, "bounded photo queries");
    assert.deepEqual(Array.from(call.ordering), ["id", true]);
    assert.ok(
      call.filters.some(
        ([op, field, value]) => op === "eq" && field === "bulk_profile_id" && value === profile,
      ),
      "every page remains scoped to the authenticated owner's profile",
    );
    assert.match(call.fields, /^id,/);
  }
  for (const table of ["bulk_photos", "bulk_progress_photos"]) {
    const pages = f.calls.filter((call) => call.table === table);
    const last = f.events.filter((event) => event.kind === "page" && event.table === table).at(-1);
    assert.equal(last.count, 0, "completion requires an empty page");
    for (let i = 1; i < pages.length; i++)
      assert.ok(pages[i].cursor > (pages[i - 1].cursor ?? ""), "cursor progresses");
  }
}

for (const count of [0, 1, 199, 200, 201, 999, 1000, 1001, 2405]) {
  test(`account deletion exhausts ${count} normalized photos with a simulated 1000-row cap`, async () => {
    const f = fixture({ normalized: count });
    const expected = new Set(f.pathsInRows(profile));
    await f.run();
    const removed = f.removals.flatMap(({ paths }) => paths);
    assert.deepEqual(new Set(removed), expected);
    assert.equal(removed.length, count);
    assert.ok(f.removals.every(({ paths }) => paths.length > 0 && paths.length <= 100));
    assert.ok(f.maxActiveRemovals() <= 1, "storage batches are sequential");
    assert.equal(f.authUsers.has(owner), false);
    assert.equal(f.events.at(-1).kind, "auth-deleted");
    assert.equal(f.objects.size, 4, "other-owner and shared evidence files survive");
    assertSafeReads(f);
  });
}

test("more than 1000 retained legacy records clean all three slots, including short capped pages", async () => {
  const f = fixture({ legacy: 1001, apiCap: 73 });
  const expected = new Set(f.pathsInRows(profile));
  await f.run();
  assert.equal(expected.size, 3003);
  assert.deepEqual(new Set(f.removals.flatMap(({ paths }) => paths)), expected);
  assert.equal(f.authUsers.has(owner), false);
  assert.equal(f.objects.size, 4);
  assertSafeReads(f);
});

test("combined legacy and normalized records dedupe shared paths and overlapping pages", async () => {
  const f = fixture({ normalized: 1001, legacy: 1001, apiCap: 73, overlap: true });
  const common = f.tables.bulk_progress_photos[0].storage_path;
  for (const path of [
    f.tables.bulk_photos[0].front_path,
    f.tables.bulk_photos[0].side_path,
    f.tables.bulk_photos[1].back_path,
  ])
    f.objects.delete(objectKey(photoBucket, path));
  f.tables.bulk_photos[0].front_path = common;
  f.tables.bulk_photos[0].side_path = common;
  f.tables.bulk_photos[1].back_path = common;
  const expected = new Set(f.pathsInRows(profile));
  await f.run();
  const removed = f.removals.flatMap(({ paths }) => paths);
  assert.equal(removed.length, expected.size);
  assert.deepEqual(new Set(removed), expected);
  assert.deepEqual(removed, [...expected].sort(), "deterministic Storage batch ordering");
  assert.equal(removed.filter((path) => path === common).length, 1);
  assert.equal(f.objects.size, 4);
  assertSafeReads(f);
});

for (const failBatch of [1, 3]) {
  for (const throwStorage of [false, true]) {
    test(`Storage batch ${failBatch} ${throwStorage ? "throws" : "returns an error"}: preserves auth/rows, then retries safely`, async () => {
      const f = fixture({ normalized: 1001, legacy: 20, failBatch, throwStorage });
      const beforeRows = JSON.stringify(f.tables);
      const originalPaths = f.pathsInRows(profile);
      await assert.rejects(
        f.run(),
        /account_deletion_photo_cleanup_failed.*account has not been deleted/,
      );
      assert.equal(f.authUsers.has(owner), true);
      assert.equal(f.authDeletes.length, 0);
      assert.equal(JSON.stringify(f.tables), beforeRows, "no database mutation on cleanup failure");
      assert.equal(f.removals.length, failBatch, "stop at the first failure");
      assert.equal(
        originalPaths.filter((path) => !f.objects.has(objectKey(photoBucket, path))).length,
        (failBatch - 1) * 100,
        "completed batches are not unsafely recreated",
      );
      f.options.failBatch = null;
      await f.run();
      assert.equal(f.authDeletes.length, 1);
      assert.equal(f.authUsers.has(owner), false);
      assert.ok(originalPaths.every((path) => !f.objects.has(objectKey(photoBucket, path))));
      assert.equal(f.objects.size, 4);
    });
  }
}

for (const table of ["bulk_photos", "bulk_progress_photos"]) {
  test(`a later ${table} discovery failure prevents any Storage/auth/database deletion`, async () => {
    const f = fixture({ normalized: 501, legacy: 501, failTable: table, failPage: 3 });
    const beforeRows = JSON.stringify(f.tables);
    const beforeObjects = new Set(f.objects);
    await assert.rejects(f.run(), /account_deletion_photo_discovery_failed/);
    assert.equal(f.removals.length, 0);
    assert.equal(f.authDeletes.length, 0);
    assert.equal(f.authUsers.has(owner), true);
    assert.equal(JSON.stringify(f.tables), beforeRows);
    assert.deepEqual(f.objects, beforeObjects);
  });

  test(`stalled ${table} pagination aborts rather than accepting partial discovery`, async () => {
    const f = fixture({ normalized: 1001, legacy: 1001, stalled: table });
    await assert.rejects(f.run(), /account_deletion_photo_discovery_failed/);
    assert.equal(f.calls.filter((call) => call.table === table).length, 2);
    assert.equal(f.removals.length, 0);
    assert.equal(f.authDeletes.length, 0);
  });
}

test("a continually advancing but broken source terminates at the shared pagination safety bound", async () => {
  const f = fixture({ runaway: "bulk_progress_photos" });
  await assert.rejects(f.run(), /account_deletion_photo_discovery_failed/);
  assert.equal(f.calls.filter((call) => call.table === "bulk_progress_photos").length, 10_000);
  assert.equal(f.removals.length, 0);
  assert.equal(f.authDeletes.length, 0);
});

test("owned legacy rows cannot direct the service-role cleanup into someone else's folder", async () => {
  for (const invalidPath of [
    `${otherProfile}/private.jpg`,
    `${profile}/../${otherProfile}/private.jpg`,
    `${profile}/folder\\private.jpg`,
    `${profile}/`,
  ]) {
    const f = fixture({ normalized: 1, legacy: 1 });
    f.tables.bulk_photos[0].front_path = invalidPath;
    const beforeObjects = new Set(f.objects);
    await assert.rejects(f.run(), /account_deletion_photo_discovery_failed/);
    assert.equal(f.removals.length, 0);
    assert.equal(f.authDeletes.length, 0);
    assert.deepEqual(f.objects, beforeObjects);
  }
});

test("other account files/rows and shared Challenge/payment evidence are never touched", async () => {
  const f = fixture({ normalized: 1001, legacy: 1001 });
  const otherPaths = f.pathsInRows(otherProfile);
  const otherRows = Object.fromEntries(
    Object.entries(f.tables).map(([table, rows]) => [
      table,
      rows.filter((row) => row.id === otherProfile || row.bulk_profile_id === otherProfile),
    ]),
  );
  await f.run();
  assert.equal(f.authUsers.has(other), true);
  for (const path of otherPaths) assert.equal(f.objects.has(objectKey(photoBucket, path)), true);
  for (const [table, rows] of Object.entries(otherRows)) assert.deepEqual(f.tables[table], rows);
  assert.equal(
    f.objects.has(objectKey("challenge-evidence", "shared-challenge/evidence.webp")),
    true,
  );
  assert.equal(f.objects.has(objectKey("payment-evidence", "shared-payment/evidence.webp")), true);
  assert.deepEqual(f.challenges, [{ id: "shared-challenge", created_by: other }]);
  assert.deepEqual(f.authDeletes, [owner]);
});

test("an auth deletion failure keeps DB references and retry tolerates photos already removed", async () => {
  const f = fixture({ normalized: 201, authError: true });
  const beforeRows = JSON.stringify(f.tables);
  await assert.rejects(f.run(), /account_deletion_failed/);
  assert.equal(f.authUsers.has(owner), true);
  assert.equal(JSON.stringify(f.tables), beforeRows);
  assert.equal(f.objects.size, 4);
  f.options.authError = false;
  await f.run();
  assert.equal(f.authUsers.has(owner), false);
});

test("a failed owner-profile lookup cannot trigger cleanup or auth deletion", async () => {
  const f = fixture({ normalized: 1001, profileError: true });
  await assert.rejects(f.run(), /account_deletion_failed/);
  assert.equal(f.calls.length, 0);
  assert.equal(f.removals.length, 0);
  assert.equal(f.authDeletes.length, 0);
});

test("a Core account with no Goal profile can still delete its account without touching other photos", async () => {
  const f = fixture();
  f.tables.bulk_profiles = f.tables.bulk_profiles.filter((row) => row.owner_id !== owner);
  const beforeObjects = new Set(f.objects);
  await f.run();
  assert.equal(f.authUsers.has(owner), false);
  assert.equal(f.authUsers.has(other), true);
  assert.equal(f.calls.length, 0);
  assert.equal(f.removals.length, 0);
  assert.deepEqual(f.objects, beforeObjects);
});
