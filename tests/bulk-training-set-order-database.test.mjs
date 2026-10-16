import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";

const db = new PGlite();
const root = new URL("../supabase/migrations/", import.meta.url);

before(async () => {
  // Stub only Supabase platform schemas; run every real application migration
  // sequentially in this suite's isolated, in-memory PostgreSQL database.
  await db.exec(`
    SET TIME ZONE 'UTC';
    CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role BYPASSRLS;
    CREATE SCHEMA auth; CREATE SCHEMA storage; CREATE SCHEMA extensions;
    CREATE TABLE auth.users(id uuid PRIMARY KEY);
    CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$
      SELECT nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
    $$;
    CREATE FUNCTION auth.jwt() RETURNS jsonb LANGUAGE sql STABLE AS $$ SELECT '{}'::jsonb $$;
    CREATE TABLE storage.buckets(
      id text PRIMARY KEY,
      public boolean NOT NULL DEFAULT false,
      file_size_limit bigint,
      allowed_mime_types text[]
    );
    INSERT INTO storage.buckets(id, public) VALUES
      ('challenge-evidence', true),('bulk-progress-photos', true),('payment-evidence', true);
    CREATE TABLE storage.objects(id uuid PRIMARY KEY, bucket_id text, name text);
    ALTER TABLE storage.objects ENABLE ROW LEVEL SECURITY;
    CREATE FUNCTION storage.foldername(text) RETURNS text[] LANGUAGE sql AS $$
      SELECT string_to_array($1, '/')
    $$;
    GRANT SELECT, INSERT, UPDATE, DELETE ON storage.objects TO authenticated, service_role;
    GRANT USAGE ON SCHEMA auth, public, storage TO authenticated, anon, service_role;
    GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA auth TO authenticated, anon, service_role;
  `);
  for (const file of (await readdir(root)).filter((name) => name.endsWith(".sql")).sort()) {
    try {
      await db.exec(await readFile(new URL(file, root), "utf8"));
    } catch (error) {
      throw new Error(`Migration failed: ${file}`, { cause: error });
    }
  }
});

after(() => db.close());

async function asUser(id, action) {
  await db.query("SELECT set_config('request.jwt.claim.sub',$1,false)", [id]);
  await db.exec("SET ROLE authenticated");
  try {
    return await action();
  } finally {
    await db.exec("RESET ROLE");
  }
}

async function asAnon(action) {
  await db.query("SELECT set_config('request.jwt.claim.sub','',false)");
  await db.exec("SET ROLE anon");
  try {
    return await action();
  } finally {
    await db.exec("RESET ROLE");
  }
}

async function completedSessionFixture() {
  const user = randomUUID();
  await db.query("INSERT INTO auth.users VALUES ($1)", [user]);
  await db.query("INSERT INTO public.profiles(id) VALUES ($1)", [user]);
  const profile = (
    await asUser(user, () =>
      db.query(
        `SELECT public.complete_goal_onboarding('gain',70,78,0.25,'intermediate',4,ARRAY['full_gym'],'custom',2900,140,360,90) AS id`,
      ),
    )
  ).rows[0].id;
  const session = randomUUID(),
    exercise = randomUUID();
  await db.query(
    `INSERT INTO public.bulk_training_sessions(id,bulk_profile_id,plan_name_snapshot,workout_day_name_snapshot,workout_day_order_snapshot,started_at,workout_date,bodyweight_kg) VALUES ($1,$2,'Preserved plan','Upper A',1,'2026-09-28T12:00:00Z','2026-09-28',70)`,
    [session, profile],
  );
  await db.query(
    `INSERT INTO public.bulk_training_session_exercises(id,session_id,exercise_name_snapshot,exercise_order,execution_mode,is_bodyweight,target_sets,target_rep_min,target_rep_max,notes_snapshot) VALUES ($1,$2,'Incline press',1,'bilateral',false,3,8,12,'Bench 3')`,
    [exercise, session],
  );
  const sets = [];
  for (const [index, type] of ["warmup", "normal", "failure", "drop"].entries()) {
    const id = randomUUID();
    sets.push(id);
    await db.query(
      `INSERT INTO public.bulk_training_session_sets(id,session_exercise_id,set_order,set_type,bilateral_weight,bilateral_reps,rpe) VALUES ($1,$2,$3,$4,24,10,8)`,
      [id, exercise, index + 1, type],
    );
  }
  await db.query(
    `UPDATE public.bulk_training_sessions SET status='completed',completed_at='2026-09-28T13:00:00Z' WHERE id=$1`,
    [session],
  );
  return { user, profile, session, exercise, sets };
}

// Exercise the real accumulated-schema RPCs and the authored session reader,
// rather than repairing order in a test/UI-only projection.
async function activeSetOrderFixture({ unilateral = false, orders = [1, 2, 3] } = {}) {
  const f = await completedSessionFixture();
  const session = randomUUID();
  const exercise = randomUUID();
  await db.query(
    `INSERT INTO public.bulk_training_sessions(id,bulk_profile_id,plan_name_snapshot,workout_day_name_snapshot,workout_day_order_snapshot,workout_date)
     VALUES ($1,$2,'Preserved plan','Active workout',1,CURRENT_DATE)`,
    [session, f.profile],
  );
  await db.query(
    `INSERT INTO public.bulk_training_session_exercises(id,session_id,exercise_name_snapshot,exercise_order,execution_mode,is_bodyweight,target_sets,target_rep_min,target_rep_max)
     VALUES ($1,$2,'Ordered exercise',1,$3,false,3,8,12)`,
    [exercise, session, unilateral ? "unilateral" : "bilateral"],
  );
  const ids = [];
  for (const [i, order] of orders.entries()) {
    const id = randomUUID();
    ids.push(id);
    await db.query(
      `INSERT INTO public.bulk_training_session_sets(id,session_exercise_id,set_order,is_extra,set_type,rpe,
       bilateral_weight,bilateral_reps,left_weight,left_reps,right_weight,right_reps)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
      [
        id,
        exercise,
        order,
        i % 2 === 0,
        ["warmup", "failure", "drop"][i % 3],
        7 + (i % 4) * 0.5,
        unilateral ? null : 20 + i,
        unilateral || i === 1 ? null : 10 + i,
        unilateral ? 10 + i : null,
        unilateral ? 12 + i : null,
        unilateral ? 15 + i : null,
        unilateral && i !== 1 ? 9 + i : null,
      ],
    );
  }
  return { ...f, completed: f.session, session, exercise, ids };
}
const orderedSets = async (exercise) =>
  (
    await db.query(
      "SELECT * FROM public.bulk_training_session_sets WHERE session_exercise_id=$1 ORDER BY set_order",
      [exercise],
    )
  ).rows;
const setIdentityAndValues = ({ set_order, updated_at, ...row }) => row;
const contiguous = (rows) => {
  assert.deepEqual(
    rows.map((row) => row.set_order),
    rows.map((_, index) => index + 1),
  );
  assert.equal(new Set(rows.map((row) => row.set_order)).size, rows.length);
};

async function setOrderApi(f) {
  const { presentationComponent } = await import("./presentation-component-fixture.mjs");
  // These are real owner/RLS-scoped reads. The transport adapter supplies only
  // PostgREST's filtering/response shape; hydration/sorting is application code.
  const tables = await asUser(f.user, async () => ({
    bulk_training_sessions: (
      await db.query("SELECT * FROM public.bulk_training_sessions WHERE id=$1", [f.session])
    ).rows,
    bulk_training_session_exercises: (
      await db.query("SELECT * FROM public.bulk_training_session_exercises WHERE session_id=$1", [
        f.session,
      ])
    ).rows,
    bulk_training_session_sets: (
      await db.query(
        "SELECT * FROM public.bulk_training_session_sets WHERE session_exercise_id=$1",
        [f.exercise],
      )
    ).rows,
  }));
  const supabase = {
    from(table) {
      let rows = tables[table];
      const query = {
        select() {
          return query;
        },
        eq(key, value) {
          rows = rows.filter((row) => row[key] === value);
          return query;
        },
        in(key, values) {
          rows = rows.filter((row) => values.includes(row[key]));
          return query;
        },
        gt(key, value) {
          rows = rows.filter((row) => row[key] > value);
          return query;
        },
        order(key) {
          rows = [...rows].sort((a, b) => String(a[key]).localeCompare(String(b[key])));
          return query;
        },
        limit(count) {
          rows = rows.slice(0, count);
          return query;
        },
        maybeSingle() {
          return Promise.resolve({ data: rows[0] ?? null, error: null });
        },
        then(resolve, reject) {
          return Promise.resolve({ data: rows, error: null }).then(resolve, reject);
        },
      };
      return query;
    },
    async rpc(name, args) {
      const sql = {
        add_bulk_training_session_set:
          "SELECT public.add_bulk_training_session_set($1,$2) AS result",
        remove_bulk_training_session_set:
          "SELECT public.remove_bulk_training_session_set($1,$2) AS result",
      }[name];
      assert.ok(sql, `Unexpected RPC ${name}`);
      const result = await asUser(f.user, () =>
        db.query(sql, [args._session, args._set ?? args._exercise]),
      );
      return { data: result.rows[0].result, error: null };
    },
  };
  return presentationComponent("src/lib/bulk-training-sessions.ts", {
    "@tanstack/react-query": { queryOptions: (options) => options, useQuery() {} },
    "@/integrations/supabase/client": { supabase },
    "./network-errors": { readRetryDelay: () => 0, shouldRetryRead: () => false },
  });
}

for (const [label, deleted, unilateral] of [
  ["first", [0], false],
  ["middle", [1], true],
  ["last", [2], false],
  ["first and last", [0, 2], true],
]) {
  test(`active set deletion: ${label} compacts persisted/display order and add appends N+1 without transferring metadata`, async () => {
    const f = await activeSetOrderFixture({ unilateral });
    const before = await orderedSets(f.exercise);
    const completed = (
      await db.query(
        "SELECT * FROM public.bulk_training_session_sets WHERE session_exercise_id IN (SELECT id FROM public.bulk_training_session_exercises WHERE session_id=$1) ORDER BY id",
        [f.completed],
      )
    ).rows;
    const api = await setOrderApi(f);
    for (const index of deleted) {
      await api.removeBulkTrainingSet(f.session, f.ids[index]);
      contiguous(await orderedSets(f.exercise));
    }
    const survivors = before.filter((row) => !deleted.includes(f.ids.indexOf(row.id)));
    const after = await orderedSets(f.exercise);
    assert.deepEqual(after.map(setIdentityAndValues), survivors.map(setIdentityAndValues));

    // Fresh transport/reader = refresh/reopen/resume, with no optimistic cache.
    const reloaded = await setOrderApi(f);
    const restored = await reloaded.activeBulkTrainingSessionQueryOptions(f.profile).queryFn();
    assert.deepEqual(
      Array.from(restored.exercises[0].sets, (set) => set.order),
      after.map((row) => row.set_order),
    );
    assert.deepEqual(
      Array.from(restored.exercises[0].sets, (set) => set.id),
      survivors.map((row) => row.id),
    );
    for (const [i, set] of restored.exercises[0].sets.entries()) {
      assert.equal(set.setType, survivors[i].set_type);
      assert.equal(set.rpe, Number(survivors[i].rpe));
      assert.equal(set.isComplete, survivors[i].is_complete);
      assert.equal(
        set.leftWeight,
        survivors[i].left_weight == null ? null : Number(survivors[i].left_weight),
      );
      assert.equal(set.rightReps, survivors[i].right_reps);
    }
    const added = await reloaded.addBulkTrainingSet(f.session, f.exercise);
    const withAdded = await orderedSets(f.exercise);
    contiguous(withAdded);
    assert.equal(withAdded.at(-1).id, added);
    assert.equal(withAdded.at(-1).set_order, survivors.length + 1);
    assert.equal(withAdded.at(-1).set_type, "normal");
    assert.equal(withAdded.at(-1).is_complete, false);
    assert.deepEqual(
      withAdded.slice(0, -1).map(setIdentityAndValues),
      survivors.map(setIdentityAndValues),
    );
    const resumedApi = await setOrderApi(f);
    const resumed = await resumedApi.bulkTrainingSessionQueryOptions(f.session).queryFn();
    assert.deepEqual(
      Array.from(resumed.exercises[0].sets, (set) => set.order),
      withAdded.map((row) => row.set_order),
    );
    assert.deepEqual(
      (
        await db.query(
          "SELECT * FROM public.bulk_training_session_sets WHERE session_exercise_id IN (SELECT id FROM public.bulk_training_session_exercises WHERE session_id=$1) ORDER BY id",
          [f.completed],
        )
      ).rows,
      completed,
    );
  });
}

test("add repairs pre-existing sparse order, counts actual rows and safely reuses freed capacity through 20 sets", async () => {
  const f = await activeSetOrderFixture({ orders: [2, 19, 20] });
  const before = await orderedSets(f.exercise);
  const api = await setOrderApi(f);
  await api.addBulkTrainingSet(f.session, f.exercise);
  contiguous(await orderedSets(f.exercise));
  assert.deepEqual(
    (await orderedSets(f.exercise)).slice(0, 3).map(setIdentityAndValues),
    before.map(setIdentityAndValues),
  );
  for (let i = 4; i < 20; i++) await api.addBulkTrainingSet(f.session, f.exercise);
  contiguous(await orderedSets(f.exercise));
  await assert.rejects(api.addBulkTrainingSet(f.session, f.exercise), /up to 20 sets/);
  await api.removeBulkTrainingSet(f.session, f.ids[1]);
  await api.addBulkTrainingSet(f.session, f.exercise);
  const final = await orderedSets(f.exercise);
  contiguous(final);
  assert.equal(final.length, 20);
});

test("set order mutations retain authorization, completed immutability, cross-exercise isolation and last-set protection", async () => {
  const f = await activeSetOrderFixture();
  const other = await activeSetOrderFixture();
  const before = await orderedSets(f.exercise);
  const otherBefore = await orderedSets(other.exercise);
  for (const action of [
    () =>
      asUser(other.user, () =>
        db.query("SELECT public.remove_bulk_training_session_set($1,$2)", [f.session, f.ids[0]]),
      ),
    () =>
      asUser(other.user, () =>
        db.query("SELECT public.add_bulk_training_session_set($1,$2)", [f.session, f.exercise]),
      ),
    () =>
      asUser(f.user, () =>
        db.query("SELECT public.remove_bulk_training_session_set($1,$2)", [
          f.session,
          other.ids[0],
        ]),
      ),
    () =>
      asUser(f.user, () =>
        db.query("SELECT public.add_bulk_training_session_set($1,$2)", [f.session, other.exercise]),
      ),
    () =>
      asUser(f.user, () =>
        db.query("SELECT public.remove_bulk_training_session_set($1,$2)", [f.completed, f.sets[0]]),
      ),
    () =>
      asUser(f.user, () =>
        db.query("SELECT public.add_bulk_training_session_set($1,$2)", [f.completed, f.exercise]),
      ),
    () =>
      asAnon(() =>
        db.query("SELECT public.remove_bulk_training_session_set($1,$2)", [f.session, f.ids[0]]),
      ),
    () =>
      asAnon(() =>
        db.query("SELECT public.add_bulk_training_session_set($1,$2)", [f.session, f.exercise]),
      ),
    () =>
      asUser(f.user, () =>
        db.query("UPDATE public.bulk_training_session_sets SET set_order=10 WHERE id=$1", [
          f.ids[0],
        ]),
      ),
  ])
    await assert.rejects(action(), /not found|permission denied/i);
  assert.deepEqual(await orderedSets(f.exercise), before);
  assert.deepEqual(await orderedSets(other.exercise), otherBefore);
  const api = await setOrderApi(f);
  await api.removeBulkTrainingSet(f.session, f.ids[0]);
  await api.removeBulkTrainingSet(f.session, f.ids[2]);
  const last = await orderedSets(f.exercise);
  await assert.rejects(api.removeBulkTrainingSet(f.session, f.ids[1]), /at least one set/);
  await assert.rejects(api.removeBulkTrainingSet(f.session, f.ids[0]), /not found/);
  assert.deepEqual(await orderedSets(f.exercise), last);
});

test("contiguous set-order migration is retry safe without rewriting existing snapshots", async () => {
  const f = await activeSetOrderFixture({ orders: [2, 7, 20] });
  const before = await orderedSets(f.exercise);
  const migration = await readFile(
    new URL("20261016120000_contiguous_active_workout_sets.sql", root),
    "utf8",
  );
  await db.exec(migration);
  assert.deepEqual(await orderedSets(f.exercise), before);
  for (const name of ["add_bulk_training_session_set", "remove_bulk_training_session_set"]) {
    const fn = (
      await db.query(
        "SELECT prosecdef,proconfig FROM pg_proc WHERE oid=($1 || '(uuid,uuid)')::regprocedure",
        [`public.${name}`],
      )
    ).rows[0];
    assert.equal(fn.prosecdef, true);
    assert.ok(fn.proconfig.some((config) => config.startsWith("search_path=")));
  }
});
