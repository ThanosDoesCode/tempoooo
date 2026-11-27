import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import { queryOptions } from "@tanstack/react-query";
import { presentationComponent } from "./presentation-component-fixture.mjs";
import { calorieReviewState } from "../src/lib/weekly-progress-coach.ts";

const db = new PGlite();
const root = new URL("../supabase/migrations/", import.meta.url);
const signature = "public.apply_bulk_calorie_recommendation(numeric,numeric,text)";
const legacySignature = "public.apply_bulk_calorie_recommendation(numeric,numeric)";
const migrationName = "20261122120000_calorie_recommendation_local_day.sql";
let beforeMigration;
before(async () => {
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
    if (file === migrationName) {
      const f = await fixture();
      await meal(f);
      beforeMigration = {
        f,
        data: await snapshot(f),
        legacyContract: await rpcContract(legacySignature),
      };
    }
    try {
      await db.exec(await readFile(new URL(file, root), "utf8"));
    } catch (cause) {
      throw new Error(`Migration failed: ${file}`, { cause });
    }
  }
});
after(() => db.close());

test("authoritative calorie events block a reopened review, including after a same-day target reset", async () => {
  const f = await fixture();
  const week = await seedReviewBaseline(f);
  const api = historyApi();
  const read = () =>
    asUser(f.user, () => api.bulkCalorieReviewHistoryQueryOptions(f.profile, week).queryFn());
  assert.equal(calorieReviewState(await read(), 2400), "eligible");
  await apply(f);
  assert.equal(calorieReviewState(await read(), 2550), "changed");
  // A fresh query/API instance represents another visit/device; no React or localStorage state.
  const anotherVisit = await asUser(f.user, () =>
    historyApi().bulkCalorieReviewHistoryQueryOptions(f.profile, week).queryFn(),
  );
  assert.equal(calorieReviewState(anotherVisit, 2550), "changed");
  const payload = (
    await db.query("SELECT payload FROM public.bulk_targets WHERE bulk_profile_id=$1", [f.profile])
  ).rows[0].payload;
  await asUser(f.user, () =>
    db.query("SELECT public.save_bulk_targets_for_local_day($1,$2::jsonb,$3)", [
      f.profile,
      { ...payload, calories: 2400 },
      "Europe/Stockholm",
    ]),
  );
  assert.equal(
    calorieReviewState(await read(), 2400),
    "changed",
    "append-only events retain the earlier adjustment even after reset",
  );
});

test("goal-only events remain eligible, missing history fails closed, and history reads preserve owner RLS", async () => {
  const f = await fixture();
  const week = await seedReviewBaseline(f);
  const api = historyApi();
  const payload = (
    await db.query("SELECT payload FROM public.bulk_targets WHERE bulk_profile_id=$1", [f.profile])
  ).rows[0].payload;
  await asUser(f.user, () =>
    db.query("SELECT public.save_bulk_targets_for_local_day($1,$2::jsonb,$3)", [
      f.profile,
      { ...payload, weeklyWorkoutGoal: 5 },
      "Europe/Stockholm",
    ]),
  );
  const read = () => api.bulkCalorieReviewHistoryQueryOptions(f.profile, week).queryFn();
  assert.equal(calorieReviewState(await asUser(f.user, read), 2400), "eligible");
  const other = await fixture();
  assert.equal(calorieReviewState(await asUser(other.user, read), 2400), "unknown");
  await assert.rejects(asUser(f.user, read, "anon"), /permission denied/);
  const missing = await asUser(other.user, () =>
    api.bulkCalorieReviewHistoryQueryOptions(other.profile, week).queryFn(),
  );
  assert.equal(calorieReviewState(missing, 2400), "unknown");
});

test("history pagination finds a calorie change beyond a simulated server row cap", async () => {
  const f = await fixture();
  const week = await seedReviewBaseline(f);
  await db.query(
    `INSERT INTO public.bulk_streak_goal_events(id,bulk_profile_id,effective_at,weekly_workout_goal,calorie_target_kcal)
    SELECT ('00000000-0000-0000-0000-' || lpad(i::text,12,'0'))::uuid,$1,now(),4,
      CASE WHEN i=1001 THEN 2550 ELSE 2400 END FROM generate_series(1,1001) AS i`,
    [f.profile],
  );
  const result = await asUser(f.user, () =>
    historyApi(17).bulkCalorieReviewHistoryQueryOptions(f.profile, week).queryFn(),
  );
  assert.equal(calorieReviewState(result, 2550), "changed");
});

async function asUser(user, action, role = "authenticated") {
  await db.query("SELECT set_config('request.jwt.claim.sub',$1,false)", [user]);
  await db.exec(`SET ROLE ${role}`);
  try {
    return await action();
  } finally {
    await db.exec("RESET ROLE");
  }
}
async function fixture() {
  const user = randomUUID();
  await db.query("INSERT INTO auth.users VALUES ($1)", [user]);
  await db.query("INSERT INTO public.profiles(id) VALUES ($1)", [user]);
  const profile = (
    await asUser(user, () =>
      db.query(`SELECT public.complete_goal_onboarding(
    'gain',70,78,0.25,'intermediate',4,ARRAY['dumbbells'],'custom',2400,140,300,80
  ) AS id`),
    )
  ).rows[0].id;
  const dates = (
    await db.query(`SELECT
    (now() AT TIME ZONE 'Europe/Stockholm')::date::text AS today,
    ((now() AT TIME ZONE 'Europe/Stockholm')::date-1)::text AS yesterday`)
  ).rows[0];
  return { user, profile, ...dates };
}
const apply = (f, expected = 2400, next = 2550, zone = "Europe/Stockholm") =>
  asUser(f.user, () =>
    db.query("SELECT public.apply_bulk_calorie_recommendation($1,$2,$3)::text AS day", [
      expected,
      next,
      zone,
    ]),
  );

// Exercise the actual frontend history query against the migrated database and its real RLS.
function historyApi(pageCap = 200) {
  const allowed = new Set([
    "bulk_profile_id",
    "effective_at",
    "recorded_at",
    "id",
    "calorie_target_kcal",
  ]);
  const supabase = {
    from(table) {
      assert.equal(table, "bulk_streak_goal_events");
      const filters = [];
      const orders = [];
      let fields;
      let limit = pageCap;
      const filter = (column, op, value) => {
        assert.ok(allowed.has(column));
        filters.push([column, op, value]);
        return query;
      };
      const query = {
        select(value) {
          fields = value;
          for (const field of fields.split(",")) assert.ok(allowed.has(field));
          return this;
        },
        eq: (column, value) => filter(column, "=", value),
        lt: (column, value) => filter(column, "<", value),
        gte: (column, value) => filter(column, ">=", value),
        gt: (column, value) => filter(column, ">", value),
        order(column, options) {
          assert.ok(allowed.has(column));
          orders.push(`${column} ${options?.ascending === false ? "DESC" : "ASC"}`);
          return this;
        },
        limit(value) {
          limit = Math.min(value, pageCap);
          return this;
        },
        then(resolve, reject) {
          const sql = `SELECT ${fields} FROM public.bulk_streak_goal_events WHERE ${filters.map(([column, op], i) => `${column} ${op} $${i + 1}`).join(" AND ")} ORDER BY ${orders.join(",")} LIMIT ${limit}`;
          return db
            .query(
              sql,
              filters.map(([, , value]) => value),
            )
            .then((result) => ({ data: result.rows, error: null }))
            .then(resolve, reject);
        },
      };
      return query;
    },
  };
  return presentationComponent("src/lib/bulk-progress-query.ts", {
    "@tanstack/react-query": { queryOptions },
    "@/integrations/supabase/client": { supabase },
    "./network-errors": {},
    "./private-image-upload": {},
    "./bulk-training-sessions": {},
  });
}

async function seedReviewBaseline(f) {
  const week = (
    await db.query(
      "SELECT date_trunc('week',now() AT TIME ZONE 'Europe/Stockholm')::date::text AS day",
    )
  ).rows[0].day;
  await db.query(
    `INSERT INTO public.bulk_streak_goal_events(bulk_profile_id,effective_at,weekly_workout_goal,calorie_target_kcal)
    VALUES ($1,($2::date::timestamp AT TIME ZONE 'Europe/Stockholm') - interval '1 second',4,2400)`,
    [f.profile, week],
  );
  return week;
}
const mealQuery = (f, date = f.today) =>
  db.query(
    `SELECT public.create_bulk_nutrition_entry(
  $1,$2,'Preserved lunch',600,40,70,20,$3,'Keep note','lunch','Europe/Stockholm'
) AS id`,
    [date, randomUUID(), f.today],
  );
const meal = (f, date) => asUser(f.user, () => mealQuery(f, date));
async function snapshot(f) {
  const read = async (sql) => (await db.query(sql, [f.profile])).rows;
  return {
    targets: (await read("SELECT payload FROM public.bulk_targets WHERE bulk_profile_id=$1"))[0]
      .payload,
    days: await read(
      "SELECT * FROM public.bulk_nutrition_days WHERE bulk_profile_id=$1 ORDER BY log_date",
    ),
    entries: await read(
      `SELECT e.* FROM public.bulk_nutrition_entries e JOIN public.bulk_nutrition_days d ON d.id=e.nutrition_day_id WHERE d.bulk_profile_id=$1 ORDER BY e.id`,
    ),
    history: await read(
      "SELECT * FROM public.bulk_nutrition_target_history WHERE bulk_profile_id=$1 ORDER BY effective_from",
    ),
    frozen: await read(
      "SELECT * FROM public.streak_weeks WHERE bulk_profile_id=$1 ORDER BY week_start",
    ),
    events: await read(
      "SELECT * FROM public.bulk_streak_goal_events WHERE bulk_profile_id=$1 ORDER BY effective_at,recorded_at",
    ),
    legacy: await read("SELECT * FROM public.bulk_days WHERE bulk_profile_id=$1 ORDER BY day"),
  };
}
const targetQuartet = (day) =>
  [day.target_calories, day.target_protein_g, day.target_carbs_g, day.target_fat_g].map(Number);

async function rpcContract(name) {
  return (
    await db.query(
      `SELECT pg_get_functiondef(p.oid) AS definition, p.proowner, p.proacl,
        p.prosecdef, p.proconfig,
        has_function_privilege('anon',p.oid,'EXECUTE') AS anon,
        has_function_privilege('authenticated',p.oid,'EXECUTE') AS authenticated,
        has_function_privilege('service_role',p.oid,'EXECUTE') AS service
      FROM pg_proc p WHERE p.oid=$1::regprocedure`,
      [name],
    )
  ).rows[0];
}

test("migration applies over prior schema without changing existing nutrition or backfilling", async () => {
  assert.deepEqual(await snapshot(beforeMigration.f), beforeMigration.data);
  assert.deepEqual(await rpcContract(legacySignature), beforeMigration.legacyContract);
});

test("RPC overloads have distinct required named argument sets for PostgreSQL and PostgREST", async () => {
  const functions = (
    await db.query(`SELECT proargnames,pronargs,pronargdefaults,pg_get_function_result(oid) AS result
      FROM pg_proc WHERE pronamespace='public'::regnamespace
      AND proname='apply_bulk_calorie_recommendation' ORDER BY pronargs`)
  ).rows;
  assert.equal(functions.length, 2);
  for (const [index, names] of [
    ["_expected_current_calories", "_new_calories"],
    ["_expected_current_calories", "_new_calories", "_timezone"],
  ].entries()) {
    const matches = functions.filter(
      (fn) =>
        fn.pronargdefaults === 0 &&
        fn.proargnames.length === names.length &&
        names.every((name) => fn.proargnames.includes(name)),
    );
    assert.equal(matches.length, 1, "Each PostgREST JSON argument set has exactly one candidate");
    assert.equal(matches[0].result, index === 0 ? "boolean" : "date");
  }
  const f = await fixture();
  const result = await asUser(f.user, () =>
    db.query(`SELECT public.apply_bulk_calorie_recommendation(
    _timezone => 'Europe/Stockholm', _new_calories => 2550,
    _expected_current_calories => 2400)::text AS day`),
  );
  assert.equal(result.rows[0].day, f.today);
});

test("old PWA calls still succeed with their original snapshot behavior; the new signature repairs it", async () => {
  const f = await fixture();
  await meal(f);
  const before = await snapshot(f);
  const oldCall = () =>
    asUser(f.user, () =>
      db.query(`SELECT public.apply_bulk_calorie_recommendation(
    _new_calories => 2550, _expected_current_calories => 2400) AS ok`),
    );
  assert.equal((await oldCall()).rows[0].ok, true);
  const oldSaved = await snapshot(f);
  assert.deepEqual(oldSaved.targets, { ...before.targets, calories: 2550 });
  assert.deepEqual(
    oldSaved.days,
    before.days,
    "Compatibility callers retain the existing snapshot limitation",
  );
  assert.deepEqual(oldSaved.entries, before.entries);
  assert.equal((await oldCall()).rows[0].ok, true);
  assert.deepEqual(await snapshot(f), oldSaved);
  assert.equal((await apply(f)).rows[0].day, f.today);
  assert.deepEqual(targetQuartet((await snapshot(f)).days[0]), [2550, 140, 300, 80]);
  await assert.rejects(
    asUser(
      "",
      () => db.query("SELECT public.apply_bulk_calorie_recommendation(2400,2550)"),
      "anon",
    ),
    /permission denied/,
  );
});

test("recommendation before first meal records today's effective target without manufacturing a day", async () => {
  const f = await fixture();
  const before = await snapshot(f);
  assert.equal((await apply(f)).rows[0].day, f.today);
  const saved = await snapshot(f);
  assert.deepEqual(saved.targets, { ...before.targets, calories: 2550 });
  assert.deepEqual(saved.days, []);
  assert.equal(Number(saved.history.at(-1).calories), 2550);
  await meal(f);
  assert.deepEqual(targetQuartet((await snapshot(f)).days[0]), [2550, 140, 300, 80]);
});

test("recommendation after meals updates only today's calories, preserving macros, meals, past targets and frozen streaks", async () => {
  const f = await fixture();
  await meal(f, f.yesterday);
  await meal(f);
  await db.query(
    `INSERT INTO public.streak_weeks(user_id,week_start,week_end,timezone,bulk_profile_id,train_active,eat_active,train_target_workouts,eat_target_kcal,eat_required_days,eat_tolerance_pct)
    VALUES ($1,current_date-14,current_date-8,'Europe/Stockholm',$2,true,true,4,2400,4,0.1)`,
    [f.user, f.profile],
  );
  await db.query(
    "INSERT INTO public.bulk_days(bulk_profile_id,day,payload) VALUES ($1,$2,$3::jsonb)",
    [
      f.profile,
      f.yesterday,
      JSON.stringify({
        date: f.yesterday,
        calories: 2100,
        protein: 120,
        mealSnapshot: { name: "Old meal" },
      }),
    ],
  );
  const before = await snapshot(f);
  await apply(f);
  const after = await snapshot(f);
  assert.deepEqual(after.targets, { ...before.targets, calories: 2550 });
  assert.deepEqual(after.days[0], before.days[0]);
  assert.deepEqual(targetQuartet(after.days[1]), [2550, 140, 300, 80]);
  assert.equal(after.days[1].id, before.days[1].id);
  assert.deepEqual(after.entries, before.entries);
  assert.deepEqual(after.frozen, before.frozen);
  assert.deepEqual(after.legacy, before.legacy);
  assert.equal(after.events.at(-1).weekly_workout_goal, before.events.at(-1).weekly_workout_goal);
  assert.equal(Number(after.events.at(-1).calorie_target_kcal), 2550);
  assert.deepEqual(after.events.slice(0, -1), before.events);
});

test("exact retry is idempotent and reconciles an older successful call's stale daily snapshot", async () => {
  const f = await fixture();
  await meal(f);
  await apply(f);
  const before = await snapshot(f);
  await apply(f);
  assert.deepEqual(await snapshot(f), before);
  await db.query(
    "UPDATE public.bulk_nutrition_days SET target_calories=2400 WHERE bulk_profile_id=$1",
    [f.profile],
  );
  await apply(f);
  assert.deepEqual(targetQuartet((await snapshot(f)).days[0]), [2550, 140, 300, 80]);
});

test("stale/invalid recommendations and invalid timezones cannot partially mutate any data", async () => {
  const f = await fixture();
  await meal(f);
  await apply(f);
  const before = await snapshot(f);
  await assert.rejects(apply(f, 2400, 2600), /changed on another device/);
  for (const next of [2800, 2525, 950, null])
    await assert.rejects(apply(f, 2550, next), /recommendation/);
  for (const zone of [null, "invalid/zone"])
    await assert.rejects(apply(f, 2550, 2700, zone), /Invalid device timezone/);
  assert.deepEqual(await snapshot(f), before);
});

test("unknown today's snapshot becomes a complete quartet; known macro snapshots are preserved", async () => {
  const f = await fixture();
  await db.query(
    "INSERT INTO public.bulk_nutrition_days(bulk_profile_id,log_date) VALUES ($1,$2)",
    [f.profile, f.today],
  );
  await apply(f);
  assert.deepEqual(targetQuartet((await snapshot(f)).days[0]), [2550, 140, 300, 80]);
  await db.query(
    "UPDATE public.bulk_nutrition_days SET target_protein_g=130,target_carbs_g=290,target_fat_g=75 WHERE bulk_profile_id=$1",
    [f.profile],
  );
  await apply(f, 2550, 2700);
  assert.deepEqual(targetQuartet((await snapshot(f)).days[0]), [2700, 130, 290, 75]);
});

test("missing/null current macro targets reject rather than write a partial snapshot", async () => {
  for (const protein of [undefined, null]) {
    const f = await fixture();
    await db.query(
      "UPDATE public.bulk_targets SET payload=payload-'protein' WHERE bulk_profile_id=$1",
      [f.profile],
    );
    if (protein === null) {
      // JSON null is rejected by the existing target constraint, independently of the RPC.
      await assert.rejects(
        db.query(
          "UPDATE public.bulk_targets SET payload=jsonb_set(payload,'{protein}','null') WHERE bulk_profile_id=$1",
          [f.profile],
        ),
      );
    }
    const before = await snapshot(f);
    await assert.rejects(apply(f), /targets are unavailable/);
    assert.deepEqual(await snapshot(f), before);
  }
});

test("timezone uses local calendar day across UTC midnight and DST, independent of database timezone", async (t) => {
  const functions = [signature, "private.record_bulk_nutrition_targets(uuid,text,date)"];
  for (const [instant, zone, day] of [
    ["2025-01-01T00:05:00Z", "America/Los_Angeles", "2024-12-31"],
    ["2024-12-31T23:05:00Z", "Europe/Stockholm", "2025-01-01"],
    ["2025-06-30T22:05:00Z", "Europe/Stockholm", "2025-07-01"],
    ["2025-01-31T10:05:00Z", "Pacific/Kiritimati", "2025-02-01"],
  ])
    await t.test(zone + instant, async () => {
      const f = await fixture();
      await db.query(
        "INSERT INTO public.bulk_nutrition_days(bulk_profile_id,log_date,target_calories,target_protein_g,target_carbs_g,target_fat_g) VALUES ($1,$2,2400,140,300,80)",
        [f.profile, day],
      );
      const originals = [];
      try {
        await db.exec("SET TIME ZONE 'Etc/GMT+12'");
        for (const name of functions) {
          const definition = (
            await db.query("SELECT pg_get_functiondef($1::regprocedure) AS sql", [name])
          ).rows[0].sql;
          originals.push(definition);
          // Test clock only: exercise the real SQL body with its clock frozen, never a caller clock.
          await db.exec(definition.replaceAll("pg_catalog.now()", `'${instant}'::timestamptz`));
        }
        assert.equal((await apply(f, 2400, 2550, zone)).rows[0].day, day);
        const after = await snapshot(f);
        assert.deepEqual(targetQuartet(after.days[0]), [2550, 140, 300, 80]);
        assert.equal(after.history[0].effective_from.toISOString().slice(0, 10), day);
      } finally {
        for (const original of originals) await db.exec(original);
        await db.exec("SET TIME ZONE 'UTC'");
      }
    });
});

test("meal logging and recommendation acceptances converge in both queued operation orders", async () => {
  // PGlite serializes its single connection. Exercise both orderings of real RPCs queued
  // concurrently; the production profile row lock provides the cross-connection serialization.
  for (const mealFirst of [true, false]) {
    const f = await fixture();
    await asUser(f.user, async () => {
      const recommendation = () =>
        db.query("SELECT public.apply_bulk_calorie_recommendation(2400,2550,'Europe/Stockholm')");
      const operations = mealFirst
        ? [() => mealQuery(f), recommendation]
        : [recommendation, () => mealQuery(f)];
      await Promise.all(operations.map((operation) => operation()));
    });
    const after = await snapshot(f);
    assert.deepEqual(targetQuartet(after.days[0]), [2550, 140, 300, 80]);
    assert.equal(after.entries.length, 1);
    assert.equal(Number(after.entries[0].calories), 600);
  }
  const definition = (
    await db.query("SELECT pg_get_functiondef($1::regprocedure) AS sql", [signature])
  ).rows[0].sql;
  assert.ok(
    definition.indexOf("FOR UPDATE OF profile, member") <
      definition.indexOf("SELECT payload INTO targets"),
  );
  const ensure = (
    await db.query(
      "SELECT pg_get_functiondef('private.ensure_bulk_nutrition_day(uuid,date)'::regprocedure) AS sql",
    )
  ).rows[0].sql;
  assert.match(ensure, /bulk_profiles WHERE id=_profile FOR UPDATE/);
});

test("constraint failure rolls back targets, effective history and streak events atomically", async () => {
  const f = await fixture();
  await meal(f);
  await db.exec(`CREATE FUNCTION public.reject_calorie_test() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'Simulated day failure'; END $$;
    CREATE TRIGGER reject_calorie_test BEFORE UPDATE ON public.bulk_nutrition_days FOR EACH ROW EXECUTE FUNCTION public.reject_calorie_test()`);
  const before = await snapshot(f);
  try {
    await assert.rejects(apply(f), /Simulated day failure/);
    assert.deepEqual(await snapshot(f), before);
  } finally {
    await db.exec(
      "DROP TRIGGER reject_calorie_test ON public.bulk_nutrition_days; DROP FUNCTION public.reject_calorie_test()",
    );
  }
});

test("ownership, anon denial, locked search path and RLS remain intact; Legacy targets are unchanged", async () => {
  const f = await fixture();
  const other = await fixture();
  const before = await snapshot(other);
  await apply(f);
  assert.deepEqual(await snapshot(other), before);
  await assert.rejects(apply({ ...f, user: "" }), /Goal profile not found/);
  await assert.rejects(
    asUser(
      "",
      () => db.query("SELECT public.apply_bulk_calorie_recommendation(2400,2550,'UTC')"),
      "anon",
    ),
    /permission denied/,
  );
  const contract = (
    await db.query(
      `SELECT p.prosecdef,p.proconfig,
    has_function_privilege('anon',p.oid,'EXECUTE') AS anon,
    has_function_privilege('authenticated',p.oid,'EXECUTE') AS authenticated,
    has_function_privilege('service_role',p.oid,'EXECUTE') AS service
    FROM pg_proc p WHERE p.oid=$1::regprocedure`,
      [signature],
    )
  ).rows[0];
  assert.deepEqual(
    [contract.prosecdef, contract.anon, contract.authenticated, contract.service],
    [true, false, true, true],
  );
  assert.ok(contract.proconfig.includes('search_path=""'));
  assert.ok(
    (
      await db.query(
        "SELECT relrowsecurity FROM pg_class WHERE oid='public.bulk_nutrition_days'::regclass",
      )
    ).rows[0].relrowsecurity,
  );
  await db.query(
    "UPDATE public.bulk_targets SET payload=payload-'trainingSetupPreference' WHERE bulk_profile_id=$1",
    [f.profile],
  );
  const legacy = await snapshot(f);
  await assert.rejects(apply(f, 2550, 2700), /Public Bulk targets are unavailable/);
  assert.deepEqual(await snapshot(f), legacy);
});
