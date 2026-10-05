import { test } from "node:test";
import assert from "node:assert/strict";
import { presentationComponent } from "./presentation-component-fixture.mjs";

function fixture({ failSets = false } = {}) {
  const tables = {
    bulk_training_sessions: [],
    bulk_training_session_exercises: [],
    bulk_training_session_sets: [],
  };
  const calls = [];
  for (let i = 0; i < 206; i++) {
    const id = `session-${String(i).padStart(4, "0")}`;
    const timestamp = new Date(Date.UTC(2026, 0, i + 1, 10)).toISOString();
    tables.bulk_training_sessions.push({
      id,
      bulk_profile_id: i === 205 ? "other-owner" : "owner",
      training_plan_id: "plan",
      plan_name_snapshot: "Saved program",
      workout_day_name_snapshot: "Upper A",
      workout_day_order_snapshot: 1,
      status: "completed",
      started_at: timestamp,
      completed_at: timestamp,
      updated_at: timestamp,
      workout_date: timestamp.slice(0, 10),
      bodyweight_kg: 70,
    });
    for (let e = 1; e <= 2; e++) {
      const exerciseId = id + ":" + e;
      tables.bulk_training_session_exercises.push({
        id: exerciseId,
        session_id: id,
        exercise_name_snapshot: "Exercise " + e,
        exercise_order: e,
        execution_mode: "bilateral",
        is_bodyweight: false,
        target_sets: 8,
        target_rep_min: 8,
        target_rep_max: 12,
        notes_snapshot: null,
      });
      for (let s = 1; s <= 8; s++)
        tables.bulk_training_session_sets.push({
          id: exerciseId + ":" + s,
          session_exercise_id: exerciseId,
          set_order: s,
          is_extra: false,
          is_complete: true,
          set_type: "normal",
          rpe: 8,
          bilateral_weight: 20,
          bilateral_reps: 10,
          left_weight: null,
          left_reps: null,
          right_weight: null,
          right_reps: null,
        });
    }
  }
  const supabase = {
    from(table) {
      const filters = [];
      let limit = 1000,
        ascending = true,
        order = "id";
      const query = {
        select() {
          return query;
        },
        eq(column, value) {
          filters.push((row) => row[column] === value);
          return query;
        },
        gt(column, value) {
          filters.push((row) => row[column] > value);
          return query;
        },
        gte(column, value) {
          filters.push((row) => row[column] >= value);
          return query;
        },
        lt(column, value) {
          filters.push((row) => row[column] < value);
          return query;
        },
        lte(column, value) {
          filters.push((row) => row[column] <= value);
          return query;
        },
        in(column, values) {
          calls.push({ table, inSize: values.length });
          filters.push((row) => values.includes(row[column]));
          return query;
        },
        order(column, options) {
          order = column;
          ascending = options?.ascending !== false;
          return query;
        },
        limit(value) {
          limit = value;
          return query;
        },
        then(resolve, reject) {
          calls.push({ table, limit });
          const rows = tables[table]
            .filter((row) => filters.every((filter) => filter(row)))
            .sort((a, b) => (ascending ? 1 : -1) * String(a[order]).localeCompare(String(b[order])))
            .slice(0, Math.min(limit, 1000));
          return Promise.resolve(
            failSets && table === "bulk_training_session_sets"
              ? { data: null, error: new Error("Snapshot read failed") }
              : { data: rows, error: null },
          ).then(resolve, reject);
        },
      };
      return query;
    },
  };
  const api = presentationComponent("src/lib/bulk-training-sessions.ts", {
    "@tanstack/react-query": { queryOptions: (options) => options, useQuery() {} },
    "@/integrations/supabase/client": { supabase },
    "./network-errors": { readRetryDelay: () => 0, shouldRetryRead: () => false },
  });
  return { api, calls };
}

test("completed history hydrates every snapshot beyond the response cap with bounded owner-scoped cursor pages", async () => {
  const { api, calls } = fixture();
  const rows = await api
    .completedBulkTrainingSessionsQueryOptions("owner", "2000-01-01", "2999-12-31")
    .queryFn();
  assert.equal(rows.length, 205);
  assert.equal(new Set(rows.map((s) => s.id)).size, 205);
  assert.equal(rows[0].id, "session-0204");
  assert.ok(
    rows.every(
      (s) =>
        s.bulkProfileId === "owner" &&
        s.exercises.length === 2 &&
        s.exercises.every((e) => e.sets.length === 8),
    ),
  );
  assert.equal(
    rows.reduce((sum, s) => sum + s.exercises.reduce((n, e) => n + e.sets.length, 0), 0),
    3280,
  );
  assert.deepEqual(
    Array.from(rows[0].exercises[0].sets, (s) => s.order),
    [1, 2, 3, 4, 5, 6, 7, 8],
  );
  assert.ok(calls.filter((c) => c.limit != null).every((c) => c.limit === 200));
  assert.ok(calls.filter((c) => c.inSize != null).every((c) => c.inSize <= 50));
  assert.ok(
    calls.filter((c) => c.table === "bulk_training_sessions" && c.limit != null).length >= 2,
  );
});

test("history reads propagate snapshot errors instead of silently returning incomplete totals; date counts keep user isolation", async () => {
  const failing = fixture({ failSets: true });
  await assert.rejects(
    failing.api
      .completedBulkTrainingSessionsQueryOptions("owner", "2000-01-01", "2999-12-31")
      .queryFn(),
    /Snapshot read failed/,
  );
  const { api } = fixture();
  const counts = await api
    .completedSessionDatesQueryOptions("owner", "2000-01-01", "2999-12-31")
    .queryFn();
  assert.equal(counts.length, 205);
  assert.equal(new Set(counts.map((s) => s.id)).size, 205);
  assert.ok(counts.every((s) => s.id !== "session-0205"));
  const other = await api
    .completedBulkTrainingSessionsQueryOptions("other-owner", "2000-01-01", "2999-12-31")
    .queryFn();
  assert.equal(other.length, 1);
  assert.equal(other[0].bulkProfileId, "other-owner");
});
