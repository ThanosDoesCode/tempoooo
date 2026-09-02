import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { PGlite } from "@electric-sql/pglite";

const db = new PGlite();
const a = randomUUID(),
  b = randomUUID(),
  c = randomUUID(),
  d = randomUUID();
const x = randomUUID(),
  y = randomUUID();
const root = new URL("../supabase/migrations/", import.meta.url);
before(async () => {
  // Only Supabase's platform schemas are stubbed; every application migration,
  // trigger, calculation, table grant and RLS policy below is the real SQL.
  await db.exec(`CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role BYPASSRLS;
    CREATE SCHEMA auth; CREATE SCHEMA storage; CREATE SCHEMA extensions;
    CREATE TABLE auth.users(id uuid PRIMARY KEY);
    CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
    CREATE FUNCTION auth.jwt() RETURNS jsonb LANGUAGE sql STABLE AS $$ SELECT '{}'::jsonb $$;
    CREATE TABLE storage.objects(id uuid PRIMARY KEY, bucket_id text, name text);
    ALTER TABLE storage.objects ENABLE ROW LEVEL SECURITY;
    CREATE FUNCTION storage.foldername(text) RETURNS text[] LANGUAGE sql AS $$ SELECT string_to_array($1, '/') $$;
    GRANT SELECT, INSERT, UPDATE, DELETE ON storage.objects TO authenticated, service_role;
    GRANT USAGE ON SCHEMA auth, public, storage TO authenticated, anon, service_role;
    GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA auth TO authenticated, anon, service_role;`);
  for (const file of (await readdir(root)).filter((f) => f.endsWith(".sql")).sort()) {
    try {
      await db.exec(await readFile(new URL(file, root), "utf8"));
    } catch (error) {
      throw new Error(`Migration failed: ${file}`, { cause: error });
    }
  }
  for (const id of [a, b, c, d]) {
    await db.query("INSERT INTO auth.users VALUES ($1)", [id]);
    await db.query("INSERT INTO public.profiles(id, display_name) VALUES ($1, 'Test athlete')", [
      id,
    ]);
  }
  for (const [id, creator, other] of [
    [x, a, b],
    [y, c, d],
  ]) {
    await db.query(
      "INSERT INTO public.challenges(id,created_by,name,start_date,timezone) VALUES ($1,$2,'Private',CURRENT_DATE,'UTC')",
      [id, creator],
    );
    await db.query(
      "INSERT INTO public.challenge_members(challenge_id,user_id) VALUES ($1,$2),($1,$3)",
      [id, creator, other],
    );
  }
});
after(async () => {
  await db.close();
});
async function asUser(uid, action) {
  await db.query("SELECT set_config('request.jwt.claim.sub', $1, false)", [uid]);
  await db.exec("SET ROLE authenticated");
  try {
    return await action();
  } finally {
    await db.exec("RESET ROLE");
  }
}
async function count(kind) {
  return Number(
    (
      await db.query(
        "SELECT count(*) AS n FROM public.challenge_notification_events WHERE kind = $1 AND challenge_id = $2",
        [kind, x],
      )
    ).rows[0].n,
  );
}
async function activity(uid, km, challenge = x, type = "run") {
  const durationSeconds = Math.round(type === "run" ? km * 360 : (km / 20) * 3600);
  return asUser(uid, () =>
    db.query(
      "INSERT INTO public.challenge_activities(challenge_id,user_id,activity_type,distance_km,duration_seconds,activity_date,evidence_path) VALUES ($1,$2,$3,$4,$5,CURRENT_DATE,'private-test-evidence') RETURNING id",
      [challenge, uid, type, km, durationSeconds],
    ),
  );
}

async function freshChallenge(name) {
  const id = randomUUID();
  await db.query(
    "INSERT INTO public.challenges(id,created_by,name,start_date,timezone) VALUES ($1,$2,$3,CURRENT_DATE,'UTC')",
    [id, a, name],
  );
  await db.query(
    "INSERT INTO public.challenge_members(challenge_id,user_id) VALUES ($1,$2),($1,$3)",
    [id, a, b],
  );
  return id;
}

test("RLS permits A and B's own activities, rejects a third party, and isolates X/Y", async () => {
  await activity(a, 7);
  await activity(b, 3);
  assert.equal(await count("activity_posted"), 2);
  await assert.rejects(activity(c, 1), /row-level security|Not a member/);
  await assert.rejects(
    asUser(c, () => db.exec(`SELECT public.claim_challenge_push_events()`)),
    /permission denied/,
  );
  await assert.rejects(
    asUser(c, () => db.exec(`SELECT * FROM public.challenge_notification_events`)),
    /permission denied/,
  );
  await activity(c, 2, y);
  assert.equal(await count("activity_posted"), 2);
  assert.equal(
    (
      await db.query(
        "SELECT count(*) AS n FROM public.challenge_notification_events WHERE challenge_id = $1",
        [y],
      )
    ).rows[0].n,
    1,
  );
});
test("Bulk data is owner-only and normal users cannot bootstrap owner access", async () => {
  const bulk = randomUUID();
  await db.query("INSERT INTO public.bulk_profiles(id,owner_id) VALUES ($1,$2)", [bulk, a]);
  await db.query(
    "INSERT INTO public.bulk_members(bulk_profile_id,user_id,role,invited_by) VALUES ($1,$2,'owner',$2),($1,$3,'editor',$2),($1,$4,'viewer',$2)",
    [bulk, a, b, c],
  );
  await db.query(
    "INSERT INTO public.bulk_targets(bulk_profile_id,payload) VALUES ($1,'{\"calories\":2900}')",
    [bulk],
  );
  const objectId = randomUUID();
  await db.query(
    "INSERT INTO storage.objects(id,bucket_id,name) VALUES ($1,'bulk-progress-photos',$2)",
    [objectId, `${bulk}/private.jpg`],
  );

  const owner = await asUser(a, () =>
    db.query("SELECT payload FROM public.bulk_targets WHERE bulk_profile_id=$1", [bulk]),
  );
  assert.equal(owner.rows.length, 1);
  assert.equal(
    (await asUser(a, () => db.query("SELECT id FROM storage.objects WHERE id=$1", [objectId]))).rows
      .length,
    1,
  );
  const ownerWrite = await asUser(a, () =>
    db.query(
      "UPDATE public.bulk_targets SET payload='{\"calories\":3000}' WHERE bulk_profile_id=$1 RETURNING payload",
      [bulk],
    ),
  );
  assert.equal(ownerWrite.rows[0].payload.calories, 3000);

  for (const user of [b, c, d]) {
    assert.equal(
      (
        await asUser(user, () =>
          db.query("SELECT payload FROM public.bulk_targets WHERE bulk_profile_id=$1", [bulk]),
        )
      ).rows.length,
      0,
    );
    assert.equal(
      (await asUser(user, () => db.query("SELECT id FROM storage.objects WHERE id=$1", [objectId])))
        .rows.length,
      0,
    );
    assert.equal(
      (
        await asUser(user, () =>
          db.query(
            "UPDATE public.bulk_targets SET payload='{\"calories\":1}' WHERE bulk_profile_id=$1 RETURNING payload",
            [bulk],
          ),
        )
      ).rows.length,
      0,
    );
  }
  const formerViewerProfiles = await db.query("SELECT id FROM public.related_profiles($1)", [c]);
  assert.equal(
    formerViewerProfiles.rows.some((profile) => profile.id === a),
    false,
  );
  await assert.rejects(
    asUser(c, () => db.query("INSERT INTO public.bulk_profiles(owner_id) VALUES ($1)", [c])),
    /row-level security|permission denied/,
  );
  await assert.rejects(
    asUser(a, () =>
      db.query(
        "INSERT INTO public.bulk_members(bulk_profile_id,user_id,role,invited_by) VALUES ($1,$2,'viewer',$3)",
        [bulk, c, a],
      ),
    ),
    /row-level security|permission denied/,
  );
});
test("normal activity creation still works without forging audit history", async () => {
  const challenge = await freshChallenge("Activity creation");
  const created = await activity(a, 4, challenge);
  assert.equal(created.rows.length, 1);
  assert.equal(
    Number(
      (
        await db.query(
          "SELECT count(*) AS n FROM public.challenge_activity_audit WHERE activity_id=$1",
          [created.rows[0].id],
        )
      ).rows[0].n,
    ),
    0,
  );
});
test("activity owner can correct an open-week activity and the trigger records its old values", async () => {
  const challenge = await freshChallenge("Open correction");
  const created = await activity(a, 4, challenge);
  const id = created.rows[0].id;
  const beforeDate = (
    await db.query("SELECT activity_date FROM public.challenge_activities WHERE id=$1", [id])
  ).rows[0].activity_date;
  const corrected = await asUser(a, () =>
    db.query(
      "UPDATE public.challenge_activities SET activity_type='cycle',distance_km=12 WHERE id=$1 RETURNING edited,activity_type,distance_km",
      [id],
    ),
  );
  assert.equal(corrected.rows.length, 1);
  assert.equal(corrected.rows[0].edited, true);
  assert.equal(corrected.rows[0].activity_type, "cycle");
  assert.equal(Number(corrected.rows[0].distance_km), 12);
  const audit = await asUser(a, () =>
    db.query(
      "SELECT old_activity_type,old_distance_km,old_activity_date,old_duration_seconds,changed_by,changed_at,action FROM public.challenge_activity_audit WHERE activity_id=$1",
      [id],
    ),
  );
  assert.equal(audit.rows.length, 1);
  assert.equal(audit.rows[0].action, "update");
  assert.equal(audit.rows[0].old_activity_type, "run");
  assert.equal(Number(audit.rows[0].old_distance_km), 4);
  assert.deepEqual(audit.rows[0].old_activity_date, beforeDate);
  assert.equal(audit.rows[0].old_duration_seconds, 1440);
  assert.equal(audit.rows[0].changed_by, a);
  assert.ok(audit.rows[0].changed_at);
});
test("the other challenge member cannot edit an activity they do not own", async () => {
  const challenge = await freshChallenge("Opponent isolation");
  const id = (await activity(a, 5, challenge)).rows[0].id;
  const result = await asUser(b, () =>
    db.query("UPDATE public.challenge_activities SET distance_km=99 WHERE id=$1 RETURNING id", [
      id,
    ]),
  );
  assert.equal(result.rows.length, 0);
  assert.equal(
    Number(
      (await db.query("SELECT distance_km FROM public.challenge_activities WHERE id=$1", [id]))
        .rows[0].distance_km,
    ),
    5,
  );
});
test("a third party cannot edit the activity, inspect its audit, or forge audit rows", async () => {
  const challenge = await freshChallenge("Third-party isolation");
  const id = (await activity(a, 6, challenge)).rows[0].id;
  await asUser(a, () =>
    db.query("UPDATE public.challenge_activities SET distance_km=7 WHERE id=$1", [id]),
  );
  const update = await asUser(c, () =>
    db.query("UPDATE public.challenge_activities SET distance_km=100 WHERE id=$1 RETURNING id", [
      id,
    ]),
  );
  assert.equal(update.rows.length, 0);
  const protectedAudit = await asUser(c, () =>
    db.query("SELECT * FROM public.challenge_activity_audit WHERE activity_id=$1", [id]),
  );
  assert.equal(protectedAudit.rows.length, 0);
  const privileges = await asUser(c, () =>
    db.query(
      "SELECT has_table_privilege('public.challenge_activity_audit','INSERT') AS ins,has_table_privilege('public.challenge_activity_audit','UPDATE') AS upd,has_table_privilege('public.challenge_activity_audit','DELETE') AS del",
    ),
  );
  assert.deepEqual(privileges.rows[0], { ins: false, upd: false, del: false });
  await assert.rejects(
    asUser(c, () =>
      db.query(
        "INSERT INTO public.challenge_activity_audit(activity_id,challenge_id,changed_by,action) VALUES ($1,$2,$3,'forged')",
        [id, challenge, c],
      ),
    ),
    /permission denied/,
  );
});
test("deleting an owned open-week activity still creates protected audit history", async () => {
  const challenge = await freshChallenge("Delete audit");
  const id = (await activity(a, 9, challenge, "cycle")).rows[0].id;
  const removed = await asUser(a, () =>
    db.query("DELETE FROM public.challenge_activities WHERE id=$1 RETURNING id", [id]),
  );
  assert.equal(removed.rows.length, 1);
  const audit = await asUser(a, () =>
    db.query(
      "SELECT action,old_activity_type,old_distance_km,old_activity_date,changed_by,changed_at FROM public.challenge_activity_audit WHERE activity_id=$1",
      [id],
    ),
  );
  assert.equal(audit.rows.length, 1);
  assert.equal(audit.rows[0].action, "delete");
  assert.equal(audit.rows[0].old_activity_type, "cycle");
  assert.equal(Number(audit.rows[0].old_distance_km), 9);
  assert.equal(audit.rows[0].changed_by, a);
  assert.ok(audit.rows[0].old_activity_date);
  assert.ok(audit.rows[0].changed_at);
});
test("a member who has left the challenge cannot correct their former activity", async () => {
  const challenge = await freshChallenge("Former member");
  const id = (await activity(a, 6, challenge)).rows[0].id;
  await db.query("DELETE FROM public.challenge_members WHERE challenge_id=$1 AND user_id=$2", [
    challenge,
    a,
  ]);
  const update = await asUser(a, () =>
    db.query("UPDATE public.challenge_activities SET distance_km=8 WHERE id=$1 RETURNING id", [id]),
  );
  assert.equal(update.rows.length, 0);
  assert.equal(
    Number(
      (await db.query("SELECT distance_km FROM public.challenge_activities WHERE id=$1", [id]))
        .rows[0].distance_km,
    ),
    6,
  );
});
test("a closed-week activity cannot be changed", async () => {
  const challenge = await freshChallenge("Closed correction");
  const id = (await activity(a, 6, challenge)).rows[0].id;
  await db.query("UPDATE public.challenges SET start_date=CURRENT_DATE-7 WHERE id=$1", [challenge]);
  await db.exec(
    "ALTER TABLE public.challenge_activities DISABLE TRIGGER challenge_activities_guard",
  );
  try {
    await db.query(
      "UPDATE public.challenge_activities SET activity_date=CURRENT_DATE-7 WHERE id=$1",
      [id],
    );
  } finally {
    await db.exec(
      "ALTER TABLE public.challenge_activities ENABLE TRIGGER challenge_activities_guard",
    );
  }
  assert.equal(
    (
      await db.query(
        "SELECT private.challenge_week_open(challenge_id,activity_date) AS open FROM public.challenge_activities WHERE id=$1",
        [id],
      )
    ).rows[0].open,
    false,
  );
  const update = await asUser(a, () =>
    db.query("UPDATE public.challenge_activities SET distance_km=8 WHERE id=$1 RETURNING id", [id]),
  );
  assert.equal(update.rows.length, 0);
  assert.equal(
    Number(
      (await db.query("SELECT distance_km FROM public.challenge_activities WHERE id=$1", [id]))
        .rows[0].distance_km,
    ),
    6,
  );
});
test("an explicitly finalized activity cannot be changed even while its dates are current", async () => {
  const challenge = await freshChallenge("Finalized correction");
  const id = (await activity(a, 6, challenge)).rows[0].id;
  await db.query(
    "INSERT INTO public.challenge_weeks(challenge_id,user_id,week_number,week_start,week_end) VALUES ($1,$2,1,CURRENT_DATE,CURRENT_DATE+6)",
    [challenge, a],
  );
  await assert.rejects(
    asUser(a, () =>
      db.query("UPDATE public.challenge_activities SET distance_km=8 WHERE id=$1", [id]),
    ),
    /Finalized activity cannot be changed/,
  );
  assert.equal(
    Number(
      (await db.query("SELECT distance_km FROM public.challenge_activities WHERE id=$1", [id]))
        .rows[0].distance_km,
    ),
    6,
  );
});
test("crossing 15 creates one completion; later posts, edits and recrossings cannot duplicate it", async () => {
  const row = await activity(a, 24, x, "cycle"); // 7 + 24/3 = 15
  assert.equal(await count("target_reached"), 1);
  await activity(a, 1);
  await asUser(a, () =>
    db.query("UPDATE public.challenge_activities SET distance_km=3 WHERE id=$1", [row.rows[0].id]),
  );
  await asUser(a, () =>
    db.query("UPDATE public.challenge_activities SET distance_km=24 WHERE id=$1", [row.rows[0].id]),
  );
  assert.equal(await count("target_reached"), 1);
  assert.equal(await count("activity_posted"), 4);
});
test("pace and speed thresholds are authoritative and duration changes are audited", async () => {
  const challenge = await freshChallenge("Qualification thresholds");
  const insert = (type, km, seconds) =>
    asUser(a, () =>
      db.query(
        "INSERT INTO public.challenge_activities(challenge_id,user_id,activity_type,distance_km,duration_seconds,activity_date,evidence_path) VALUES ($1,$2,$3,$4,$5,CURRENT_DATE,'test') RETURNING id,is_qualified,qualifying_equivalent_km,average_speed_kmh,average_pace_seconds_per_km",
        [challenge, a, type, km, seconds],
      ),
    );
  const fastRun = (await insert("run", 7, 2939)).rows[0];
  const sevenMinuteRun = (await insert("run", 7, 2940)).rows[0];
  const thresholdRide = (await insert("cycle", 18, 3600)).rows[0];
  const slowRide = (await insert("cycle", 18, 3601)).rows[0];
  assert.equal(fastRun.is_qualified, true);
  assert.equal(Number(fastRun.qualifying_equivalent_km), 7);
  assert.equal(sevenMinuteRun.is_qualified, false);
  assert.equal(Number(sevenMinuteRun.qualifying_equivalent_km), 0);
  assert.equal(thresholdRide.is_qualified, true);
  assert.equal(Number(thresholdRide.qualifying_equivalent_km), 6);
  assert.equal(slowRide.is_qualified, false);
  assert.equal(Number(slowRide.qualifying_equivalent_km), 0);
  await asUser(a, () =>
    db.query("UPDATE public.challenge_activities SET duration_seconds=2800 WHERE id=$1", [
      sevenMinuteRun.id,
    ]),
  );
  const audit = await db.query(
    "SELECT old_duration_seconds FROM public.challenge_activity_audit WHERE activity_id=$1",
    [sevenMinuteRun.id],
  );
  assert.equal(audit.rows[0].old_duration_seconds, 2940);
  await assert.rejects(
    asUser(a, () =>
      db.query(
        "INSERT INTO public.challenge_activities(challenge_id,user_id,activity_type,distance_km,activity_date,evidence_path) VALUES ($1,$2,'run',5,CURRENT_DATE,'test')",
        [challenge, a],
      ),
    ),
    /Duration is required/,
  );
});
test("fixed weekly penalty tiers use only the published 15, 10 and 5 km boundaries", async () => {
  const result = await db.query(
    "SELECT public.penalty_for(15,15) AS full,public.penalty_for(14.99,15) AS five,public.penalty_for(10,15) AS ten_boundary,public.penalty_for(9.99,15) AS ten,public.penalty_for(5,15) AS five_boundary,public.penalty_for(4.99,15) AS fifteen,public.penalty_for(0,0) AS paused",
  );
  assert.deepEqual(
    Object.fromEntries(Object.entries(result.rows[0]).map(([key, value]) => [key, Number(value)])),
    {
      full: 0,
      five: 5,
      ten_boundary: 5,
      ten: 10,
      five_boundary: 10,
      fifteen: 15,
      paused: 0,
    },
  );
});
test("unrelated edits and bulk tracker writes create no events", async () => {
  const before = (await db.query("SELECT count(*) AS n FROM public.challenge_notification_events"))
    .rows[0].n;
  await asUser(a, () =>
    db.query(
      "UPDATE public.challenge_activities SET note='not a notification' WHERE user_id=$1 AND challenge_id=$2",
      [a, x],
    ),
  );
  await asUser(a, () =>
    db.query("UPDATE public.profiles SET display_name='Renamed' WHERE id=$1", [a]),
  );
  const ownedBulk = (
    await db.query("SELECT id FROM public.bulk_profiles WHERE owner_id=$1 LIMIT 1", [a])
  ).rows[0].id;
  await asUser(a, () =>
    db.query("UPDATE public.bulk_profiles SET allow_editor=false WHERE id=$1", [ownedBulk]),
  );
  assert.equal(
    (await db.query("SELECT count(*) AS n FROM public.challenge_notification_events")).rows[0].n,
    before,
  );
});
let payment;
test("real finalization creates exactly one €5 penalty event, including repeated calls", async () => {
  // Fixture a closed week through the service role without altering production guards.
  const past = randomUUID();
  await db.query(
    "INSERT INTO public.challenges(id,created_by,name,start_date,timezone) VALUES ($1,$2,'Closed week',CURRENT_DATE-7,'UTC')",
    [past, a],
  );
  await db.query(
    "INSERT INTO public.challenge_members(challenge_id,user_id) VALUES ($1,$2),($1,$3)",
    [past, a, b],
  );
  // Insert while that week is open, then advance the challenge's start date.
  await db.query("UPDATE public.challenges SET start_date=CURRENT_DATE WHERE id=$1", [past]);
  await activity(a, 10, past);
  await db.query("UPDATE public.challenges SET start_date=CURRENT_DATE-7 WHERE id=$1", [past]);
  await db.exec(
    "ALTER TABLE public.challenge_activities DISABLE TRIGGER challenge_activities_guard",
  );
  await db.query(
    "UPDATE public.challenge_activities SET activity_date=CURRENT_DATE-7 WHERE challenge_id=$1",
    [past],
  );
  await db.exec(
    "ALTER TABLE public.challenge_activities ENABLE TRIGGER challenge_activities_guard",
  );
  await db.query("SELECT public.finalize_challenge($1,$2)", [a, past]);
  await db.query("SELECT public.finalize_challenge($1,$2)", [b, past]);
  const penalties = await db.query(
    "SELECT facts FROM public.challenge_notification_events WHERE challenge_id=$1 AND actor_id=$2 AND kind='week_penalty'",
    [past, a],
  );
  assert.equal(penalties.rows.length, 1);
  assert.equal(penalties.rows[0].facts.amount_eur, 5);
  payment = (
    await db.query(
      "SELECT id FROM public.challenge_payments WHERE challenge_id=$1 AND payer_id=$2",
      [past, a],
    )
  ).rows[0].id;
});
test("only unpaid → marked_paid notifies, once per obligation despite toggle/retry", async () => {
  await asUser(a, () =>
    db.query("UPDATE public.challenge_payments SET status='marked_paid' WHERE id=$1", [payment]),
  );
  await asUser(a, () =>
    db.query("UPDATE public.challenge_payments SET status='marked_paid' WHERE id=$1", [payment]),
  );
  await asUser(a, () =>
    db.query("UPDATE public.challenge_payments SET status='unpaid' WHERE id=$1", [payment]),
  );
  await asUser(a, () =>
    db.query("UPDATE public.challenge_payments SET status='marked_paid' WHERE id=$1", [payment]),
  );
  await asUser(b, () =>
    db.query("UPDATE public.challenge_payments SET status='confirmed_paid' WHERE id=$1", [payment]),
  );
  assert.equal(
    (
      await db.query(
        "SELECT count(*) AS n FROM public.challenge_notification_events WHERE dedupe_key=$1",
        [`payment:${payment}`],
      )
    ).rows[0].n,
    1,
  );
});
test("own subscription reads/deletes only; device forgery/identity edits/outbox injection denied", async () => {
  for (const uid of [a, b]) {
    await db.query("INSERT INTO public.challenge_push_users(user_id,enabled) VALUES ($1,true)", [
      uid,
    ]);
    await db.query(
      "INSERT INTO public.push_subscriptions(user_id,subscription_id) VALUES ($1,$2)",
      [uid, randomUUID()],
    );
  }
  assert.equal(
    (await asUser(a, () => db.exec("SELECT * FROM public.push_subscriptions")))[0].rows.length,
    1,
  );
  assert.equal(
    (await asUser(a, () => db.exec("SELECT * FROM public.challenge_push_users")))[0].rows.length,
    1,
  );
  await assert.rejects(
    asUser(a, () =>
      db.query("INSERT INTO public.push_subscriptions(user_id,subscription_id) VALUES ($1,$2)", [
        a,
        randomUUID(),
      ]),
    ),
    /permission denied/,
  );
  await assert.rejects(
    asUser(a, () => db.exec("UPDATE public.challenge_push_users SET external_id='forged'")),
    /permission denied/,
  );
  await assert.rejects(
    asUser(a, () => db.exec("INSERT INTO public.challenge_notification_events DEFAULT VALUES")),
    /permission denied/,
  );
  await asUser(a, () => db.exec("SELECT public.disable_challenge_push()"));
  assert.equal(
    (await db.query("SELECT enabled FROM public.challenge_push_users WHERE user_id=$1", [a]))
      .rows[0].enabled,
    false,
  );
  assert.equal(
    (await db.query("SELECT enabled FROM public.challenge_push_users WHERE user_id=$1", [b]))
      .rows[0].enabled,
    true,
  );
  await asUser(a, () => db.query("DELETE FROM public.push_subscriptions WHERE user_id=$1", [b]));
  assert.equal(
    (await db.query("SELECT count(*) AS n FROM public.push_subscriptions WHERE user_id=$1", [b]))
      .rows[0].n,
    1,
  );
});
test("server registration respects account opt-out, rejects forged identity, and cannot be invoked by clients", async () => {
  const external = (
    await db.query("SELECT external_id FROM public.challenge_push_users WHERE user_id=$1", [a])
  ).rows[0].external_id;
  const id = randomUUID();
  const register = (active, identity = external) =>
    db.query("SELECT public.register_challenge_push_device($1,$2,$3,$4) AS enabled", [
      a,
      id,
      identity,
      active,
    ]);
  await assert.rejects(
    asUser(a, () => register(true)),
    /permission denied/,
  );
  assert.equal((await register(true, "forged")).rows[0].enabled, false);
  assert.equal((await register(false)).rows[0].enabled, false);
  assert.equal((await register(true)).rows[0].enabled, true);
  await asUser(a, () => db.exec("SELECT public.disable_challenge_push()"));
  assert.equal((await register(false)).rows[0].enabled, false);
  assert.equal(
    (
      await db.query("SELECT is_active FROM public.push_subscriptions WHERE subscription_id=$1", [
        id,
      ])
    ).rows[0].is_active,
    false,
  );
});
test("rollback leaves no event and the 15 km weekly target cannot be overridden", async () => {
  const beforeCount = (
    await db.query("SELECT count(*) AS n FROM public.challenge_notification_events")
  ).rows[0].n;
  await asUser(a, async () => {
    await db.exec("BEGIN");
    try {
      await db.query(
        "INSERT INTO public.challenge_activities(challenge_id,user_id,activity_type,distance_km,duration_seconds,activity_date,evidence_path) VALUES ($1,$2,'run',1,360,CURRENT_DATE,'test')",
        [x, a],
      );
    } finally {
      await db.exec("ROLLBACK");
    }
  });
  assert.equal(
    (await db.query("SELECT count(*) AS n FROM public.challenge_notification_events")).rows[0].n,
    beforeCount,
  );
  const custom = randomUUID();
  await db.query(
    "INSERT INTO public.challenges(id,created_by,name,start_date,timezone) VALUES ($1,$2,'Override',CURRENT_DATE,'UTC')",
    [custom, a],
  );
  await db.query(
    "INSERT INTO public.challenge_members(challenge_id,user_id) VALUES ($1,$2),($1,$3)",
    [custom, a, b],
  );
  await assert.rejects(
    asUser(a, () =>
      db.query(
        "INSERT INTO public.challenge_week_targets(challenge_id,week_number,target_km,set_by) VALUES ($1,2,30,$2)",
        [custom, a],
      ),
    ),
    /permission denied/,
  );
  await db.query("UPDATE public.challenges SET start_date=CURRENT_DATE-7 WHERE id=$1", [custom]);
  await activity(a, 15, custom);
  const result = (
    await db.query(
      "SELECT facts FROM public.challenge_notification_events WHERE challenge_id=$1 AND kind='target_reached'",
      [custom],
    )
  ).rows;
  assert.equal(result.length, 1);
  assert.equal(result[0].facts.target_km, 15);
});
test("a multi-row insert crossing the target emits exactly one completion", async () => {
  const batch = randomUUID();
  await db.query(
    "INSERT INTO public.challenges(id,created_by,name,start_date,timezone) VALUES ($1,$2,'Batch',CURRENT_DATE,'UTC')",
    [batch, a],
  );
  await db.query(
    "INSERT INTO public.challenge_members(challenge_id,user_id) VALUES ($1,$2),($1,$3)",
    [batch, a, b],
  );
  await asUser(a, () =>
    db.query(
      "INSERT INTO public.challenge_activities(challenge_id,user_id,activity_type,distance_km,duration_seconds,activity_date,evidence_path) VALUES ($1,$2,'run',15,5400,CURRENT_DATE,'test'),($1,$2,'run',15,5400,CURRENT_DATE,'test')",
      [batch, a],
    ),
  );
  const kinds = (
    await db.query("SELECT kind FROM public.challenge_notification_events WHERE challenge_id=$1", [
      batch,
    ])
  ).rows.map((r) => r.kind);
  assert.equal(kinds.filter((k) => k === "activity_posted").length, 2);
  assert.equal(kinds.filter((k) => k === "target_reached").length, 1);
});
test("an outside-country pause is private to its owner and makes only their week penalty-free", async () => {
  const challenge = await freshChallenge("Travel pause");
  await activity(a, 1, challenge);
  const pause = await asUser(a, () =>
    db.query(
      "INSERT INTO public.challenge_travel_pauses(challenge_id,user_id,week_number,country) VALUES ($1,$2,1,'Italy') RETURNING id",
      [challenge, a],
    ),
  );
  assert.equal(pause.rows.length, 1);
  await assert.rejects(
    asUser(b, () =>
      db.query(
        "INSERT INTO public.challenge_travel_pauses(challenge_id,user_id,week_number,country) VALUES ($1,$2,1,'France')",
        [challenge, a],
      ),
    ),
    /row-level security|manage your own/,
  );
  assert.equal(
    (
      await asUser(b, () =>
        db.query("SELECT count(*) AS n FROM public.challenge_travel_pauses WHERE challenge_id=$1", [
          challenge,
        ]),
      )
    ).rows[0].n,
    1,
  );
  assert.equal(
    (
      await asUser(c, () =>
        db.query("SELECT count(*) AS n FROM public.challenge_travel_pauses WHERE challenge_id=$1", [
          challenge,
        ]),
      )
    ).rows[0].n,
    0,
  );
  await assert.rejects(
    asUser(a, () =>
      db.query(
        "INSERT INTO public.challenge_travel_pauses(challenge_id,user_id,week_number,country) VALUES ($1,$2,2,'Sweden')",
        [challenge, a],
      ),
    ),
    /stays active/,
  );
  await db.query("UPDATE public.challenges SET start_date=CURRENT_DATE-7 WHERE id=$1", [challenge]);
  await db.exec(
    "ALTER TABLE public.challenge_activities DISABLE TRIGGER challenge_activities_guard",
  );
  await db.query(
    "UPDATE public.challenge_activities SET activity_date=CURRENT_DATE-7 WHERE challenge_id=$1",
    [challenge],
  );
  await db.exec(
    "ALTER TABLE public.challenge_activities ENABLE TRIGGER challenge_activities_guard",
  );
  await db.query("SELECT public.finalize_challenge($1,$2)", [a, challenge]);
  const finalized = await db.query(
    "SELECT user_id,paused,pause_country,target_km,penalty_eur FROM public.challenge_weeks WHERE challenge_id=$1 ORDER BY user_id",
    [challenge],
  );
  const mine = finalized.rows.find((row) => row.user_id === a);
  const opponent = finalized.rows.find((row) => row.user_id === b);
  assert.deepEqual(
    {
      paused: mine.paused,
      country: mine.pause_country,
      target: Number(mine.target_km),
      penalty: Number(mine.penalty_eur),
    },
    { paused: true, country: "Italy", target: 0, penalty: 0 },
  );
  assert.deepEqual(
    {
      paused: opponent.paused,
      target: Number(opponent.target_km),
      penalty: Number(opponent.penalty_eur),
    },
    { paused: false, target: 15, penalty: 15 },
  );
});
test("outbox claim leases prevent duplicate workers; expired leases retry, stale events expire", async () => {
  const first = (await db.query("SELECT * FROM public.claim_challenge_push_events()")).rows;
  const second = (await db.query("SELECT * FROM public.claim_challenge_push_events()")).rows;
  assert.ok(first.length > 0);
  assert.ok(first.every((e) => !second.some((other) => other.id === e.id)));
  const chosen = first[0];
  await db.query(
    "UPDATE public.challenge_notification_events SET lease_until=now()-interval '1 minute' WHERE id=$1",
    [chosen.id],
  );
  const retry = (await db.query("SELECT * FROM public.claim_challenge_push_events()")).rows.find(
    (e) => e.id === chosen.id,
  );
  assert.equal(retry.attempts, 2);
  assert.notEqual(retry.lease_token, chosen.lease_token);
  await db.query(
    "UPDATE public.challenge_notification_events SET lease_until=NULL,created_at=now()-interval '2 days' WHERE id=$1",
    [chosen.id],
  );
  await db.query("SELECT * FROM public.claim_challenge_push_events()");
  assert.equal(
    (
      await db.query("SELECT status FROM public.challenge_notification_events WHERE id=$1", [
        chosen.id,
      ])
    ).rows[0].status,
    "failed",
  );
});
