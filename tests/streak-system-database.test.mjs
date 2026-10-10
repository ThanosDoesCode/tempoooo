import { test } from "node:test";
import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { PGlite } from "@electric-sql/pglite";

const migrations = new URL("../supabase/migrations/", import.meta.url);

const platformSchema = `SET TIME ZONE 'UTC';
  CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role BYPASSRLS;
  CREATE SCHEMA auth; CREATE SCHEMA storage; CREATE SCHEMA extensions;
  CREATE TABLE auth.users(id uuid PRIMARY KEY);
  CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
  CREATE FUNCTION auth.jwt() RETURNS jsonb LANGUAGE sql STABLE AS $$ SELECT '{}'::jsonb $$;
  CREATE TABLE storage.buckets(
    id text PRIMARY KEY, public boolean NOT NULL DEFAULT false,
    file_size_limit bigint, allowed_mime_types text[]);
  INSERT INTO storage.buckets(id, public) VALUES
    ('challenge-evidence', true),('bulk-progress-photos', true),('payment-evidence', true);
  CREATE TABLE storage.objects(id uuid PRIMARY KEY, bucket_id text, name text);
  ALTER TABLE storage.objects ENABLE ROW LEVEL SECURITY;
  CREATE FUNCTION storage.foldername(text) RETURNS text[] LANGUAGE sql AS $$ SELECT string_to_array($1, '/') $$;
  GRANT SELECT, INSERT, UPDATE, DELETE ON storage.objects TO authenticated, service_role;
  GRANT USAGE ON SCHEMA auth, public, storage TO authenticated, anon, service_role;
  GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA auth TO authenticated, anon, service_role;`;

async function freshDatabase() {
  const database = new PGlite();
  await database.exec(platformSchema);
  const files = (await readdir(migrations)).filter((f) => f.endsWith(".sql")).sort();
  for (const file of files) {
    const sql = await readFile(new URL(file, migrations), "utf8");
    try {
      await database.exec(sql);
    } catch (error) {
      throw new Error(`migration ${file} failed: ${error.message}`);
    }
  }
  return database;
}

const asUser = async (db, uid) => {
  await db.exec("RESET ROLE");
  await db.query("SELECT set_config('request.jwt.claim.sub',$1,false)", [uid]);
  await db.exec("SET ROLE authenticated");
};
const asService = async (db) => {
  await db.exec("RESET ROLE");
  await db.query("SELECT set_config('request.jwt.claim.sub','',false)");
};
const recompute = async (db, uid, tz = "Europe/Athens") => {
  await asUser(db, uid);
  const { rows } = await db.query("SELECT public.recompute_streak($1) AS r", [tz]);
  await asService(db);
  return rows[0].r;
};

async function makeUser(db, { fitness = false } = {}) {
  const uid = randomUUID();
  await asService(db);
  await db.query("INSERT INTO auth.users(id) VALUES($1)", [uid]);
  await db.query("INSERT INTO public.profiles(id,display_name) VALUES($1,'Athlete')", [uid]);
  if (fitness) {
    await asUser(db, uid);
    await db.query(
      `SELECT public.complete_goal_onboarding(
        'gain',70,78,0.25,'intermediate',4,
        ARRAY['dumbbells','cables','bench'],'custom',2900,140,360,90)`,
    );
    await asService(db);
  }
  return uid;
}
const profileOf = async (db, uid) =>
  (await db.query("SELECT id FROM public.bulk_profiles WHERE owner_id=$1", [uid])).rows[0]?.id;

async function createChallenge(db, { createdBy, tz = "Europe/Athens", startDate, duration = 12 }) {
  await asService(db);
  const id = randomUUID();
  await db.query(
    `INSERT INTO public.challenges(id,created_by,name,start_date,timezone,duration_weeks)
     VALUES($1,$2,'Duel',$3::date,$4,$5)`,
    [id, createdBy, startDate, tz, duration],
  );
  return id;
}
async function addMember(db, cid, uid, role = "member", joinedAt = null) {
  await asService(db);
  await db.query(
    `INSERT INTO public.challenge_members(challenge_id,user_id,role,joined_at)
     VALUES($1,$2,$3,COALESCE($4::timestamptz, now()))`,
    [cid, uid, role, joinedAt],
  );
}
async function settleWeek(
  db,
  { cid, uid, week, eq = 20, target = 15, completed = true, paused = false },
) {
  await asService(db);
  await db.query(
    `INSERT INTO public.challenge_weeks(
       challenge_id,user_id,week_number,week_start,week_end,
       running_km,cycling_km,equivalent_km,target_km,completed,penalty_eur,paused)
     SELECT $1,$2,$3, start_date+($3-1)*7, start_date+($3-1)*7+6,
            0,0,$4,$5,$6,0,$7 FROM public.challenges WHERE id=$1`,
    [cid, uid, week, eq, target, completed, paused],
  );
}
const weeksOf = async (db, uid) =>
  (
    await db.query(
      "SELECT week_start::text, week_end::text, run_active, train_active, eat_active, run_state, train_state, eat_state, result, free_miss_used, locked_at, train_target_workouts, eat_target_kcal FROM public.streak_weeks WHERE user_id=$1 ORDER BY week_start",
      [uid],
    )
  ).rows;
const legsOf = async (db, uid) =>
  (
    await db.query(
      "SELECT week_start::text, challenge_week_number, settlement_state, challenge_id, source_challenge_id, source_week_id FROM public.streak_week_run_legs WHERE user_id=$1 ORDER BY challenge_week_number",
      [uid],
    )
  ).rows;

// ----------------------------------------------------------------- smoke / shape
test("migration applies; recompute returns a zero shape for a bare account", async () => {
  const db = await freshDatabase();
  const uid = await makeUser(db);
  const r = await recompute(db, uid);
  assert.equal(r.current, 0);
  assert.equal(r.best, 0);
  assert.deepEqual(r.recent_weeks, []);
  assert.deepEqual(await weeksOf(db, uid), []);
});

// ----------------------------------------------------------------- core / Run activation
test("no Challenge => no Run requirement (no streak weeks created)", async () => {
  const db = await freshDatabase();
  const uid = await makeUser(db);
  await recompute(db, uid);
  assert.deepEqual(await weeksOf(db, uid), []);
});

test("core user with an active Challenge gets Run only; Train/Eat never active", async () => {
  const db = await freshDatabase();
  const owner = await makeUser(db);
  const uid = await makeUser(db);
  const cid = await createChallenge(db, { createdBy: owner, startDate: "2026-09-28", duration: 4 });
  await addMember(db, cid, owner, "owner");
  await addMember(db, cid, uid, "member", "2026-09-28T00:00:00+03");
  await settleWeek(db, { cid, uid, week: 1, completed: true });
  await recompute(db, uid);
  const weeks = await weeksOf(db, uid);
  assert.ok(weeks.length >= 1);
  for (const w of weeks) {
    assert.equal(w.train_active, false);
    assert.equal(w.eat_active, false);
  }
  assert.ok(weeks.some((w) => w.run_active === true));
});

// ----------------------------------------------------------------- settlement outcomes
test("canonical settled completed leg => Run closed => week kept and locked", async () => {
  const db = await freshDatabase();
  const owner = await makeUser(db);
  const uid = await makeUser(db);
  const cid = await createChallenge(db, { createdBy: owner, startDate: "2026-09-28", duration: 4 });
  await addMember(db, cid, owner, "owner");
  await addMember(db, cid, uid, "member", "2026-09-28T00:00:00+03");
  await settleWeek(db, { cid, uid, week: 1, eq: 20, target: 15, completed: true });
  const r = await recompute(db, uid);
  const past = (await weeksOf(db, uid)).find((w) => w.week_start === "2026-09-28");
  assert.equal(past.result, "kept");
  assert.equal(past.run_state, "closed");
  assert.ok(past.locked_at);
  assert.equal(r.current, 1);
  assert.equal(r.best, 1);
  const leg = (await legsOf(db, uid)).find((l) => l.challenge_week_number === 1);
  assert.equal(leg.settlement_state, "completed");
  assert.ok(leg.source_week_id);
});

test("canonical paused leg => Run skipped => week paused (streak preserved)", async () => {
  const db = await freshDatabase();
  const owner = await makeUser(db);
  const uid = await makeUser(db);
  const cid = await createChallenge(db, { createdBy: owner, startDate: "2026-09-28", duration: 4 });
  await addMember(db, cid, owner, "owner");
  await addMember(db, cid, uid, "member", "2026-09-28T00:00:00+03");
  await settleWeek(db, { cid, uid, week: 1, eq: 0, target: 0, completed: true, paused: true });
  const r = await recompute(db, uid);
  const past = (await weeksOf(db, uid)).find((w) => w.week_start === "2026-09-28");
  assert.equal(past.result, "paused");
  assert.equal(past.run_state, "skipped");
  assert.equal(r.current, 0);
  const leg = (await legsOf(db, uid)).find((l) => l.challenge_week_number === 1);
  assert.equal(leg.settlement_state, "paused");
});

test("recompute triggers canonical settlement when a member has no challenge_weeks row yet", async () => {
  const db = await freshDatabase();
  const owner = await makeUser(db);
  const uid = await makeUser(db);
  const cid = await createChallenge(db, { createdBy: owner, startDate: "2026-09-28", duration: 4 });
  await addMember(db, cid, owner, "owner");
  await addMember(db, cid, uid, "member", "2026-09-28T00:00:00+03");
  // No settleWeek: recompute must call finalize_challenge and resolve week 1 (no activity => missed).
  await recompute(db, uid);
  const leg = (await legsOf(db, uid)).find((l) => l.challenge_week_number === 1);
  assert.notEqual(leg.settlement_state, "pending");
  assert.ok(["missed", "completed", "paused"].includes(leg.settlement_state));
});

// ----------------------------------------------------------------- membership timing
test("membership present at Monday is included; join mid-week is excluded", async () => {
  const db = await freshDatabase();
  const owner = await makeUser(db);
  const included = await makeUser(db);
  const excluded = await makeUser(db);
  // 1v1 challenges (cap 2), so each tester gets their own duel vs the owner.
  const cIncluded = await createChallenge(db, {
    createdBy: owner,
    startDate: "2026-09-28",
    duration: 4,
  });
  const cExcluded = await createChallenge(db, {
    createdBy: owner,
    startDate: "2026-09-28",
    duration: 4,
  });
  await addMember(db, cIncluded, owner, "owner");
  await addMember(db, cExcluded, owner, "owner");
  await addMember(db, cIncluded, included, "member", "2026-09-28T00:00:00+03"); // at Monday start
  await addMember(db, cExcluded, excluded, "member", "2026-10-01T10:00:00+03"); // mid-week
  await settleWeek(db, { cid: cIncluded, uid: included, week: 1, completed: true });
  await settleWeek(db, { cid: cExcluded, uid: excluded, week: 1, completed: true });
  await recompute(db, included);
  await recompute(db, excluded);
  assert.ok((await legsOf(db, included)).some((l) => l.week_start === "2026-09-28"));
  assert.ok(!(await legsOf(db, excluded)).some((l) => l.week_start === "2026-09-28"));
});

// ----------------------------------------------------------------- leave semantics
test("leaving a Challenge keeps the already-frozen Run obligation (leg survives membership delete)", async () => {
  const db = await freshDatabase();
  const owner = await makeUser(db);
  const uid = await makeUser(db);
  // Current in-progress week so recompute freezes a pending leg for the live account week.
  const cid = await createChallenge(db, { createdBy: owner, startDate: "2026-10-05", duration: 4 });
  await addMember(db, cid, owner, "owner");
  await addMember(db, cid, uid, "member", "2026-10-05T00:00:00+03");
  await recompute(db, uid);
  const before = await legsOf(db, uid);
  assert.ok(before.length >= 1);
  // Voluntary leave (non-owner) -> BEFORE DELETE trigger must keep the frozen leg.
  await asUser(db, uid);
  await db.query("DELETE FROM public.challenge_members WHERE challenge_id=$1 AND user_id=$2", [
    cid,
    uid,
  ]);
  await asService(db);
  const after = await legsOf(db, uid);
  assert.equal(after.length, before.length, "frozen leg must remain after leaving");
});

test("voluntary leave => a required leg with no canonical settlement after cutoff resolves missed", async () => {
  const db = await freshDatabase();
  const owner = await makeUser(db);
  const uid = await makeUser(db);
  const cid = randomUUID();
  // Build a PAST streak week + a pending leg directly, with the user NOT a member (already left).
  await asService(db);
  await db.query(
    "INSERT INTO public.challenges(id,created_by,name,start_date,timezone,duration_weeks) VALUES($1,$2,'Gone','2026-09-21'::date,'Europe/Athens',4)",
    [cid, owner],
  );
  await db.query(
    `INSERT INTO public.streak_weeks(user_id,week_start,week_end,timezone,run_active,run_state)
     VALUES($1,'2026-09-21','2026-09-27','Europe/Athens',true,'open')`,
    [uid],
  );
  await db.query(
    `INSERT INTO public.streak_week_run_legs(user_id,week_start,source_challenge_id,challenge_id,
       challenge_week_number,challenge_timezone,challenge_week_start,challenge_week_end,challenge_end_instant)
     VALUES($1,'2026-09-21',$2,$2,1,'Europe/Athens','2026-09-21','2026-09-27','2026-09-27T23:59:59+03')`,
    [uid, cid],
  );
  await recompute(db, uid);
  const leg = (await legsOf(db, uid)).find((l) => l.challenge_week_number === 1);
  assert.equal(leg.settlement_state, "missed");
  const week = (await weeksOf(db, uid)).find((w) => w.week_start === "2026-09-21");
  assert.ok(["missed", "free"].includes(week.result)); // first miss of the month may take the free miss
  assert.ok(week.locked_at);
});

// ----------------------------------------------------------------- concurrent challenges / timezones
test("two concurrent Challenges in different timezones both map deterministically; a shared account week aggregates both", async () => {
  const db = await freshDatabase();
  const owner = await makeUser(db);
  const uid = await makeUser(db);
  const athens = await createChallenge(db, {
    createdBy: owner,
    tz: "Europe/Athens",
    startDate: "2026-09-14",
    duration: 12,
  });
  const stockholm = await createChallenge(db, {
    createdBy: owner,
    tz: "Europe/Stockholm",
    startDate: "2026-09-16",
    duration: 12,
  });
  await addMember(db, athens, owner, "owner");
  await addMember(db, stockholm, owner, "owner");
  await addMember(db, athens, uid, "member", "2026-09-14T00:00:00+03");
  await addMember(db, stockholm, uid, "member", "2026-09-16T00:00:00+02");
  // Pre-settle the weeks so recompute does not need to run finalize across many weeks.
  for (const w of [1, 2, 3]) await settleWeek(db, { cid: athens, uid, week: w, completed: true });
  for (const w of [1, 2, 3])
    await settleWeek(db, { cid: stockholm, uid, week: w, completed: true });
  await recompute(db, uid);
  const legs = await legsOf(db, uid);
  const athensW1 = legs.find(
    (l) => l.source_challenge_id === athens && l.challenge_week_number === 1,
  );
  const stockW1 = legs.find(
    (l) => l.source_challenge_id === stockholm && l.challenge_week_number === 1,
  );
  assert.equal(athensW1.week_start, "2026-09-14");
  assert.equal(stockW1.week_start, "2026-09-21"); // Tue-end in Stockholm = Wed 00:59 Athens -> account week 09-21
  // Athens w2 (ends 09-27 -> 09-21) + Stockholm w1 both land in 2026-09-21.
  const shared = legs.filter((l) => l.week_start === "2026-09-21");
  assert.ok(shared.length >= 2, "concurrent challenges aggregate into one account week");
});

test("end-instant mapping is exact across local midnight (not a timezone-less date)", async () => {
  const db = await freshDatabase();
  await asService(db);
  const q = async (sql) => (await db.query(sql)).rows[0];
  // Athens Sunday end stays in its own Monday week.
  let r = await q(
    "SELECT private.streak_account_week(private.streak_end_instant('2026-10-11','Europe/Athens'),'Europe/Athens')::text AS w",
  );
  assert.equal(r.w, "2026-10-05");
  // Stockholm Tuesday end viewed from Athens crosses into Wednesday -> that Monday week.
  r = await q(
    "SELECT private.streak_account_week(private.streak_end_instant('2026-10-13','Europe/Stockholm'),'Europe/Athens')::text AS w",
  );
  assert.equal(r.w, "2026-10-12");
  // New York Sunday end viewed from Athens crosses local midnight into Monday (not the naive 10-05 week).
  r = await q(
    "SELECT private.streak_account_week(private.streak_end_instant('2026-10-11','America/New_York'),'Europe/Athens')::text AS w",
  );
  assert.equal(r.w, "2026-10-12");
});

// ----------------------------------------------------------------- idempotency / immutability
test("recompute and legs are idempotent; locked rows are never rewritten", async () => {
  const db = await freshDatabase();
  const owner = await makeUser(db);
  const uid = await makeUser(db);
  const cid = await createChallenge(db, { createdBy: owner, startDate: "2026-09-28", duration: 4 });
  await addMember(db, cid, owner, "owner");
  await addMember(db, cid, uid, "member", "2026-09-28T00:00:00+03");
  await settleWeek(db, { cid, uid, week: 1, completed: true });
  await recompute(db, uid);
  const legs1 = await legsOf(db, uid);
  const locked1 = (await weeksOf(db, uid)).find((w) => w.week_start === "2026-09-28").locked_at;
  await recompute(db, uid);
  const legs2 = await legsOf(db, uid);
  const locked2 = (await weeksOf(db, uid)).find((w) => w.week_start === "2026-09-28").locked_at;
  assert.equal(legs2.length, legs1.length);
  assert.equal(String(locked2), String(locked1), "locked_at must be stable across recompute");
});

// ----------------------------------------------------------------- security / RLS
test("owner isolation: a user cannot read another user's streak weeks", async () => {
  const db = await freshDatabase();
  const a = await makeUser(db);
  const b = await makeUser(db);
  await asService(db);
  await db.query(
    "INSERT INTO public.streak_weeks(user_id,week_start,week_end,timezone,result,locked_at) VALUES($1,'2026-02-02','2026-02-08','Europe/Athens','kept',now())",
    [b],
  );
  await asUser(db, a);
  const seen = await db.query(
    "SELECT count(*)::int AS n FROM public.streak_weeks WHERE user_id=$1",
    [b],
  );
  await asService(db);
  assert.equal(seen.rows[0].n, 0);
});

test("clients cannot directly write streak rows (no INSERT/UPDATE/DELETE policy)", async () => {
  const db = await freshDatabase();
  const uid = await makeUser(db);
  await asUser(db, uid);
  await assert.rejects(
    db.query(
      "INSERT INTO public.streak_weeks(user_id,week_start,week_end,timezone) VALUES($1,'2026-02-02','2026-02-08','Europe/Athens')",
      [uid],
    ),
  );
  await asService(db);
});

test("recompute_streak rejects an invalid timezone", async () => {
  const db = await freshDatabase();
  const uid = await makeUser(db);
  await asUser(db, uid);
  await assert.rejects(db.query("SELECT public.recompute_streak('Mars/Olympus')"));
  await asService(db);
});

// ----------------------------------------------------------------- free miss
test("first otherwise-missed week in a month => free; second => missed", async () => {
  const db = await freshDatabase();
  const uid = await makeUser(db);
  await asService(db);
  const mkMissed = async (ws, we) => {
    const cid = randomUUID();
    await db.query(
      "INSERT INTO public.challenges(id,created_by,name,start_date,timezone,duration_weeks) VALUES($1,$2,'C',$3::date,'Europe/Athens',12)",
      [cid, uid, ws],
    );
    await db.query(
      "INSERT INTO public.streak_weeks(user_id,week_start,week_end,timezone,run_active,run_state) VALUES($1,$2,$3,'Europe/Athens',true,'open')",
      [uid, ws, we],
    );
    await db.query(
      `INSERT INTO public.streak_week_run_legs(user_id,week_start,source_challenge_id,challenge_id,
        challenge_week_number,challenge_timezone,challenge_week_start,challenge_week_end,challenge_end_instant,
        settlement_state,settled_at)
       VALUES($1,$2::date,$3,$3,1,'Europe/Athens',$2::date,$4::date,$5::timestamptz,
              'missed'::public.streak_leg_state, now())`,
      [uid, ws, cid, we, `${we}T23:59:59+03`],
    );
  };
  await mkMissed("2026-02-02", "2026-02-08");
  await mkMissed("2026-02-09", "2026-02-15");
  await recompute(db, uid);
  const weeks = await weeksOf(db, uid);
  assert.equal(weeks.find((w) => w.week_start === "2026-02-02").result, "free");
  assert.equal(weeks.find((w) => w.week_start === "2026-02-02").free_miss_used, true);
  assert.equal(weeks.find((w) => w.week_start === "2026-02-09").result, "missed");
  // Idempotent: a second recompute does not consume another free miss.
  await recompute(db, uid);
  const after = await weeksOf(db, uid);
  assert.equal(after.filter((w) => w.free_miss_used).length, 1);
});

// ----------------------------------------------------------------- derived current/best
test("current/best derive correctly from a mixed locked sequence", async () => {
  const db = await freshDatabase();
  const uid = await makeUser(db);
  await asService(db);
  const seq = [
    ["2026-01-05", "kept"],
    ["2026-01-12", "kept"],
    ["2026-01-19", "none"],
    ["2026-01-26", "kept"],
    ["2026-02-02", "missed"],
    ["2026-02-09", "kept"],
    ["2026-02-16", "paused"],
    ["2026-02-23", "free"],
    ["2026-03-02", "kept"],
  ];
  for (const [ws, result] of seq) {
    await db.query(
      `INSERT INTO public.streak_weeks(user_id,week_start,week_end,timezone,result,free_miss_used,locked_at)
       VALUES($1,$2,($2::date+6),'Europe/Athens',$3,$4,now())`,
      [uid, ws, result, result === "free"],
    );
  }
  const r = await recompute(db, uid);
  assert.equal(r.current, 2); // W6 kept + (paused,free preserve) + W9 kept, after W5 reset
  assert.equal(r.best, 3); // W1..W4 (none preserves) => 3
});

// ----------------------------------------------------------------- goal-event history
test("baseline goal event is not backdated to Monday (effective_at ~ now)", async () => {
  const db = await freshDatabase();
  const uid = await makeUser(db, { fitness: true });
  const profile = await profileOf(db, uid);
  const { rows } = await db.query(
    `SELECT (effective_at > date_trunc('week', now())) AS after_monday,
            (effective_at >= now() - interval '5 minutes') AS recent
     FROM public.bulk_streak_goal_events WHERE bulk_profile_id=$1`,
    [profile],
  );
  assert.equal(rows[0].after_monday, true);
  assert.equal(rows[0].recent, true);
});

test("same-day goal and calorie changes keep exact effective-time history; Monday-start value is frozen", async () => {
  const db = await freshDatabase();
  const uid = await makeUser(db, { fitness: true });
  const profile = await profileOf(db, uid);
  await asService(db);
  // Two distinct same-day versions effective before/at a past Monday and mid-day.
  await db.query(
    `INSERT INTO public.bulk_streak_goal_events(bulk_profile_id,effective_at,weekly_workout_goal,calorie_target_kcal)
     VALUES ($1,'2026-09-07T00:00:00+03',5,2800),
            ($1,'2026-09-07T14:00:00+03',4,3000)`,
    [profile],
  );
  const count = await db.query(
    "SELECT count(*)::int AS n FROM public.bulk_streak_goal_events WHERE bulk_profile_id=$1 AND effective_at >= '2026-09-07T00:00:00+03' AND effective_at < '2026-09-08T00:00:00+03'",
    [profile],
  );
  assert.equal(count.rows[0].n, 2, "same-day versions are both preserved (append-only)");
  await recompute(db, uid);
  const wk = (await weeksOf(db, uid)).find((w) => w.week_start === "2026-09-07");
  assert.equal(
    Number(wk.train_target_workouts),
    5,
    "freezes the Monday-00:00 value, not the mid-day change",
  );
  assert.equal(Number(wk.eat_target_kcal), 2800);
});

test("an unrelated target edit does not append a goal event", async () => {
  const db = await freshDatabase();
  const uid = await makeUser(db, { fitness: true });
  const profile = await profileOf(db, uid);
  const before = await db.query(
    "SELECT count(*)::int AS n FROM public.bulk_streak_goal_events WHERE bulk_profile_id=$1",
    [profile],
  );
  await asService(db);
  // Change only a macro split; resolved goal(4) and calories(2900) unchanged.
  await db.query(
    "UPDATE public.bulk_targets SET payload = payload || jsonb_build_object('protein', 999) WHERE bulk_profile_id=$1",
    [profile],
  );
  const after = await db.query(
    "SELECT count(*)::int AS n FROM public.bulk_streak_goal_events WHERE bulk_profile_id=$1",
    [profile],
  );
  assert.equal(after.rows[0].n, before.rows[0].n, "no new event for an unrelated payload change");
});

// ----------------------------------------------------------------- T0 / no fabrication
test("Train/Eat begin only when an authoritative event exists before the week start (no history fabrication)", async () => {
  const db = await freshDatabase();
  const uid = await makeUser(db, { fitness: true });
  const profile = await profileOf(db, uid);
  await asService(db);
  // A single event effective mid-day on 2026-09-07. The 09-07 week has no event before its start;
  // the 09-14 week does.
  await db.query("DELETE FROM public.bulk_streak_goal_events WHERE bulk_profile_id=$1", [profile]);
  await db.query(
    "INSERT INTO public.bulk_streak_goal_events(bulk_profile_id,effective_at,weekly_workout_goal,calorie_target_kcal) VALUES($1,'2026-09-07T12:00:00+03',4,2900)",
    [profile],
  );
  await recompute(db, uid);
  const weeks = await weeksOf(db, uid);
  const early = weeks.find((w) => w.week_start === "2026-09-07");
  const later = weeks.find((w) => w.week_start === "2026-09-14");
  // 09-07 may not exist at all (no Run, no pre-start event) -> treated as no Train/Eat requirement.
  if (early) {
    assert.equal(early.train_active, false);
    assert.equal(early.eat_active, false);
  }
  assert.ok(later, "a week after the first event exists");
  assert.equal(later.train_active, true);
  assert.equal(later.eat_active, true);
});

test("a mid-week goal/calorie change affects the next streak week, not the current one", async () => {
  const db = await freshDatabase();
  const uid = await makeUser(db, { fitness: true });
  const profile = await profileOf(db, uid);
  await asService(db);
  await db.query("DELETE FROM public.bulk_streak_goal_events WHERE bulk_profile_id=$1", [profile]);
  await db.query(
    `INSERT INTO public.bulk_streak_goal_events(bulk_profile_id,effective_at,weekly_workout_goal,calorie_target_kcal)
     VALUES ($1,'2026-09-07T00:00:00+03',3,2600),
            ($1,'2026-09-09T10:00:00+03',6,3200)`,
    [profile],
  );
  await recompute(db, uid);
  const weeks = await weeksOf(db, uid);
  assert.equal(Number(weeks.find((w) => w.week_start === "2026-09-07").eat_target_kcal), 2600);
  assert.equal(Number(weeks.find((w) => w.week_start === "2026-09-14").eat_target_kcal), 3200);
});

// ----------------------------------------------------------------- Train/Eat evaluation
test("Train closes when completed workouts >= frozen goal; Eat needs 5 adherent days within tolerance", async () => {
  const db = await freshDatabase();
  const uid = await makeUser(db, { fitness: true });
  const profile = await profileOf(db, uid);
  await asService(db);
  await db.query("DELETE FROM public.bulk_streak_goal_events WHERE bulk_profile_id=$1", [profile]);
  await db.query(
    "INSERT INTO public.bulk_streak_goal_events(bulk_profile_id,effective_at,weekly_workout_goal,calorie_target_kcal) VALUES($1,'2026-09-06T00:00:00+03',3,2000)",
    [profile],
  );
  // Week 2026-09-07..13: 3 completed workouts, and 5 adherent days (2000 +/-10%).
  for (const d of ["2026-09-07", "2026-09-08", "2026-09-09"]) {
    await db.query(
      `INSERT INTO public.bulk_training_sessions(bulk_profile_id,plan_name_snapshot,workout_day_name_snapshot,workout_day_order_snapshot,status,completed_at,workout_date)
       VALUES($1,'Plan','Day',1,'completed',now(),$2::date)`,
      [profile, d],
    );
  }
  for (const d of ["2026-09-07", "2026-09-08", "2026-09-09", "2026-09-10", "2026-09-11"]) {
    const dayId = randomUUID();
    await db.query(
      "INSERT INTO public.bulk_nutrition_days(id,bulk_profile_id,log_date,target_calories,target_protein_g,target_carbs_g,target_fat_g) VALUES($1,$2,$3::date,2000,150,200,60)",
      [dayId, profile, d],
    );
    await db.query(
      "INSERT INTO public.bulk_nutrition_entries(id,nutrition_day_id,source_type,name_snapshot,calories,protein_g,carbs_g,fat_g,sort_order,request_id) VALUES($1,$2,'custom','meal',2000,150,200,60,1,$3)",
      [randomUUID(), dayId, randomUUID()],
    );
  }
  await recompute(db, uid);
  const wk = (await weeksOf(db, uid)).find((w) => w.week_start === "2026-09-07");
  assert.equal(wk.train_state, "closed");
  assert.equal(wk.eat_state, "closed");
});

// ----------------------------------------------------------------- challenge deletion stability
test("admin-simulated Challenge deletion nulls the FK but keeps the frozen source identity + leg", async () => {
  const db = await freshDatabase();
  const owner = await makeUser(db);
  const uid = await makeUser(db);
  // A live frozen leg referencing a challenge with no finalized challenge_weeks (so the
  // "finalized results are immutable" guard does not block an administrative challenge delete).
  const cid = await createChallenge(db, { createdBy: owner, startDate: "2026-09-28", duration: 4 });
  await addMember(db, cid, owner, "owner");
  await addMember(db, cid, uid, "member", "2026-09-28T00:00:00+03");
  await asService(db);
  await db.query(
    "INSERT INTO public.streak_weeks(user_id,week_start,week_end,timezone,run_active,run_state) VALUES($1,'2026-10-05','2026-10-11','Europe/Athens',true,'open'::public.streak_ring_state)",
    [uid],
  );
  await db.query(
    `INSERT INTO public.streak_week_run_legs(user_id,week_start,source_challenge_id,challenge_id,
       challenge_week_number,challenge_timezone,challenge_week_start,challenge_week_end,challenge_end_instant)
     VALUES($1,'2026-10-05',$2,$2,2,'Europe/Athens','2026-10-05','2026-10-11','2026-10-11T23:59:59+03')`,
    [uid, cid],
  );
  await db.query("DELETE FROM public.challenges WHERE id=$1", [cid]);
  const leg = (await legsOf(db, uid)).find((l) => l.challenge_week_number === 2);
  assert.ok(leg, "leg survives challenge deletion");
  assert.equal(leg.challenge_id, null, "live FK is nulled");
  assert.equal(leg.source_challenge_id, cid, "frozen source identity is retained");
});
