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
  CREATE TABLE storage.buckets(id text PRIMARY KEY, public boolean NOT NULL DEFAULT false, file_size_limit bigint, allowed_mime_types text[]);
  INSERT INTO storage.buckets(id, public) VALUES ('challenge-evidence', true),('bulk-progress-photos', true),('payment-evidence', true);
  CREATE TABLE storage.objects(id uuid PRIMARY KEY, bucket_id text, name text);
  ALTER TABLE storage.objects ENABLE ROW LEVEL SECURITY;
  CREATE FUNCTION storage.foldername(text) RETURNS text[] LANGUAGE sql AS $$ SELECT string_to_array($1, '/') $$;
  GRANT SELECT, INSERT, UPDATE, DELETE ON storage.objects TO authenticated, service_role;
  GRANT USAGE ON SCHEMA auth, public, storage TO authenticated, anon, service_role;
  GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA auth TO authenticated, anon, service_role;`;

async function freshDatabase() {
  const db = new PGlite();
  await db.exec(platformSchema);
  for (const file of (await readdir(migrations)).filter((f) => f.endsWith(".sql")).sort()) {
    try {
      await db.exec(await readFile(new URL(file, migrations), "utf8"));
    } catch (error) {
      throw new Error(`migration ${file} failed: ${error.message}`);
    }
  }
  return db;
}

const asService = async (db) => {
  await db.exec("RESET ROLE");
  await db.query("SELECT set_config('request.jwt.claim.sub','',false)");
};
const asUser = async (db, uid) => {
  await db.exec("RESET ROLE");
  await db.query("SELECT set_config('request.jwt.claim.sub',$1,false)", [uid]);
  await db.exec("SET ROLE authenticated");
};

// A 2-member challenge (A = subject/payer, B = counterparty/recipient), start 2 weeks ago.
async function seedChallenge(db, { legacyPhotos = false } = {}) {
  const a = randomUUID();
  const b = randomUUID();
  const outsider = randomUUID();
  await asService(db);
  for (const id of [a, b, outsider]) {
    await db.query("INSERT INTO auth.users(id) VALUES($1)", [id]);
    await db.query("INSERT INTO public.profiles(id) VALUES($1)", [id]);
  }
  const challenge = (
    await db.query(
      "INSERT INTO public.challenges(created_by,name,start_date,legacy_photo_owed) VALUES($1,'Duel',CURRENT_DATE-14,$2) RETURNING id",
      [a, legacyPhotos],
    )
  ).rows[0].id;
  await db.query(
    "INSERT INTO public.challenge_members(challenge_id,user_id,role) VALUES($1,$2,'owner'),($1,$3,'member')",
    [challenge, a, b],
  );
  return { a, b, outsider, challenge };
}

// A finalized "missed" week for A (week 6), plus the generated payment A->B at the given status.
async function seedFinalizedMissed(
  db,
  { a, b, challenge },
  { week = 6, paymentStatus = "unpaid" } = {},
) {
  await asService(db);
  const wk = (
    await db.query(
      `INSERT INTO public.challenge_weeks(challenge_id,user_id,week_number,week_start,week_end,equivalent_km,target_km,completed,penalty_eur)
       VALUES($1,$2,$3,CURRENT_DATE-14,CURRENT_DATE-8,0,15,false,15) RETURNING id`,
      [challenge, a, week],
    )
  ).rows[0].id;
  let payment = null;
  if (paymentStatus) {
    payment = (
      await db.query(
        `INSERT INTO public.challenge_payments(challenge_id,week_id,payer_id,recipient_id,amount_eur,status,payment_evidence_path,marked_paid_at,confirmed_at,settled_by)
         VALUES($1,$2,$3,$4::uuid,15,$5::public.payment_status,'payment-evidence/x.jpg',
                CASE WHEN $5 IN ('marked_paid','confirmed_paid') THEN now() END,
                CASE WHEN $5 = 'confirmed_paid' THEN now() END,
                CASE WHEN $5 = 'confirmed_paid' THEN $4::uuid END)
         RETURNING id`,
        [challenge, wk, a, b, paymentStatus],
      )
    ).rows[0].id;
  }
  return { wk, payment };
}

const request = async (db, uid, challenge, week, kind, reqId) => {
  await asUser(db, uid);
  try {
    const sql = reqId
      ? "SELECT public.request_challenge_week_exception($1,$2,$3,NULL,NULL,$4) AS id"
      : "SELECT public.request_challenge_week_exception($1,$2,$3) AS id";
    const { rows } = await db.query(
      sql,
      reqId ? [challenge, week, kind, reqId] : [challenge, week, kind],
    );
    return rows[0].id;
  } finally {
    await asService(db);
  }
};
const review = async (db, uid, adjustment, approve) => {
  await asUser(db, uid);
  try {
    const { rows } = await db.query("SELECT public.review_challenge_week_exception($1,$2) AS r", [
      adjustment,
      approve,
    ]);
    return rows[0].r;
  } finally {
    await asService(db);
  }
};
const cancel = async (db, uid, adjustment) => {
  await asUser(db, uid);
  try {
    return (await db.query("SELECT public.cancel_challenge_week_exception($1) AS ok", [adjustment]))
      .rows[0].ok;
  } finally {
    await asService(db);
  }
};
const weekRow = async (db, wk) =>
  (
    await db.query(
      "SELECT completed, penalty_eur::text AS penalty, paused, excuse_reason, corrected_at FROM public.challenge_weeks WHERE id=$1",
      [wk],
    )
  ).rows[0];
const payRow = async (db, id) =>
  (
    await db.query(
      "SELECT status, cancelled_at, cancelled_reason, confirmed_at, settled_by, amount_eur::text AS amount, payment_evidence_path FROM public.challenge_payments WHERE id=$1",
      [id],
    )
  ).rows[0];
const adjRow = async (db, id) =>
  (
    await db.query(
      "SELECT status, reviewed_by, original_completed, original_penalty_eur::text AS orig_pen FROM public.challenge_week_adjustments WHERE id=$1",
      [id],
    )
  ).rows[0];

// ------------------------------------------------------------- schema / grants
test("schema: adjustments table + RLS, authenticated has SELECT but no write grant; payment 'cancelled' exists", async () => {
  const db = await freshDatabase();
  await asService(db);
  assert.equal(
    (await db.query("SELECT to_regclass('public.challenge_week_adjustments') IS NOT NULL AS ok"))
      .rows[0].ok,
    true,
  );
  assert.equal(
    (
      await db.query(
        "SELECT relrowsecurity FROM pg_class WHERE oid='public.challenge_week_adjustments'::regclass",
      )
    ).rows[0].relrowsecurity,
    true,
  );
  const priv = async (p) =>
    (
      await db.query(
        "SELECT has_table_privilege('authenticated','public.challenge_week_adjustments',$1) AS ok",
        [p],
      )
    ).rows[0].ok;
  assert.equal(await priv("SELECT"), true);
  assert.equal(await priv("INSERT"), false);
  assert.equal(await priv("UPDATE"), false);
  assert.equal(await priv("DELETE"), false);
  assert.ok(
    (
      await db.query(
        "SELECT 1 FROM pg_enum e JOIN pg_type t ON t.oid=e.enumtypid WHERE t.typname='payment_status' AND e.enumlabel='cancelled'",
      )
    ).rows[0],
    "payment_status has 'cancelled'",
  );
});

// ------------------------------------------------------------- request authorization
test("request: subject-only; late_completion needs a finalized missed week; dedupes to one pending", async () => {
  const db = await freshDatabase();
  const c = await seedChallenge(db);
  await seedFinalizedMissed(db, c, { paymentStatus: null }); // finalized missed week 6, no payment
  // sick can be requested for an active (non-finalized) week:
  const sick = await request(db, c.a, c.challenge, 9, "sick");
  assert.ok(sick);
  // dedupe: a second pending sick for the same week returns the same row.
  assert.equal(await request(db, c.a, c.challenge, 9, "sick"), sick);
  // late_completion on a non-finalized week is rejected:
  await assert.rejects(request(db, c.a, c.challenge, 9, "late_completion"), /not been finalized/i);
  // late_completion on the finalized missed week 6 is allowed:
  assert.ok(await request(db, c.a, c.challenge, 6, "late_completion"));
  // a non-member cannot request:
  await assert.rejects(request(db, c.outsider, c.challenge, 9, "sick"), /Not a member/i);
});

// ------------------------------------------------------------- review authorization
test("review: only the counterparty may approve/reject; subject and outsiders cannot", async () => {
  const db = await freshDatabase();
  const c = await seedChallenge(db);
  await seedFinalizedMissed(db, c);
  const adj = await request(db, c.a, c.challenge, 6, "sick");
  await assert.rejects(review(db, c.a, adj, true), /cannot review your own/i); // subject self-approve blocked
  await assert.rejects(review(db, c.outsider, adj, true), /Not a member/i); // outsider blocked
  assert.equal((await adjRow(db, adj)).status, "pending", "still pending after blocked attempts");
});

// ------------------------------------------------------------- sick correction (unpaid payment)
test("approved sick correction excuses the week, cancels an unpaid obligation, and is audited", async () => {
  const db = await freshDatabase();
  const c = await seedChallenge(db, { legacyPhotos: true });
  const { wk, payment } = await seedFinalizedMissed(db, c, { paymentStatus: "unpaid" });
  const adj = await request(db, c.a, c.challenge, 6, "sick");
  const result = await review(db, c.b, adj, true);
  assert.equal(result.status, "approved");
  assert.equal(result.week_corrected, true);
  assert.equal(result.payment_action, "cancelled");
  assert.equal(result.payment_manual_resolution_required, false);
  assert.equal(result.photo_manual_resolution_required, false);

  const w = await weekRow(db, wk);
  assert.equal(w.completed, true);
  assert.equal(w.penalty, "0.00");
  assert.equal(w.paused, true);
  assert.equal(w.excuse_reason, "sick");
  assert.ok(w.corrected_at);

  const p = await payRow(db, payment);
  assert.equal(p.status, "cancelled");
  assert.ok(p.cancelled_at);
  assert.equal(p.cancelled_reason, "sick");
  assert.equal(p.amount, "15.00", "amount preserved");
  assert.equal(p.payment_evidence_path, "payment-evidence/x.jpg", "evidence preserved");

  const a = await adjRow(db, adj);
  assert.equal(a.status, "approved");
  assert.equal(a.reviewed_by, c.b);
  assert.equal(a.original_completed, false, "original result snapshotted");
  assert.equal(a.orig_pen, "15.00");
});

// ------------------------------------------------------------- confirmed_paid edge (correction 1)
test("approved correction preserves a confirmed_paid obligation and flags manual money + photo resolution", async () => {
  const db = await freshDatabase();
  const c = await seedChallenge(db, { legacyPhotos: true });
  const { wk, payment } = await seedFinalizedMissed(db, c, { paymentStatus: "confirmed_paid" });
  const adj = await request(db, c.a, c.challenge, 6, "sick");
  const result = await review(db, c.b, adj, true);
  assert.equal(result.week_corrected, true);
  assert.equal(result.payment_action, "already_settled");
  assert.equal(result.payment_manual_resolution_required, true);
  assert.equal(
    result.photo_manual_resolution_required,
    true,
    "legacy photos + settled money => manual",
  );

  // The result is corrected, but the settled money is untouched (historical truth).
  assert.equal((await weekRow(db, wk)).completed, true);
  const p = await payRow(db, payment);
  assert.equal(p.status, "confirmed_paid", "settled payment preserved");
  assert.equal(p.cancelled_at, null);
  assert.equal(p.settled_by, c.b);
});

test("confirmed_paid without legacy photos flags money-only manual resolution", async () => {
  const db = await freshDatabase();
  const c = await seedChallenge(db, { legacyPhotos: false });
  await seedFinalizedMissed(db, c, { paymentStatus: "confirmed_paid" });
  const adj = await request(db, c.a, c.challenge, 6, "late_completion");
  const result = await review(db, c.b, adj, true);
  assert.equal(result.payment_manual_resolution_required, true);
  assert.equal(result.photo_manual_resolution_required, false);
});

// ------------------------------------------------------------- late completion
test("approved late completion marks the week completed and cancels a marked_paid obligation", async () => {
  const db = await freshDatabase();
  const c = await seedChallenge(db);
  const { wk, payment } = await seedFinalizedMissed(db, c, { paymentStatus: "marked_paid" });
  const adj = await request(db, c.a, c.challenge, 6, "late_completion");
  const result = await review(db, c.b, adj, true);
  assert.equal(result.kind, "late_completion");
  assert.equal(result.payment_action, "cancelled");
  const w = await weekRow(db, wk);
  assert.equal(w.completed, true);
  assert.equal(w.penalty, "0.00");
  assert.equal(w.excuse_reason, null, "late completion is a real completion, not an excuse");
  assert.equal((await payRow(db, payment)).status, "cancelled");
});

// ------------------------------------------------------------- reject / cancel
test("reject leaves the week and payment untouched; requester can cancel a pending request", async () => {
  const db = await freshDatabase();
  const c = await seedChallenge(db);
  const { wk, payment } = await seedFinalizedMissed(db, c);
  const adj = await request(db, c.a, c.challenge, 6, "sick");
  const result = await review(db, c.b, adj, false);
  assert.equal(result.status, "rejected");
  assert.equal((await weekRow(db, wk)).completed, false, "week unchanged on reject");
  assert.equal((await payRow(db, payment)).status, "unpaid", "payment unchanged on reject");
  assert.equal((await adjRow(db, adj)).status, "rejected");

  const adj2 = await request(db, c.a, c.challenge, 6, "late_completion");
  assert.equal(await cancel(db, c.b, adj2), false, "non-requester cannot cancel");
  assert.equal(await cancel(db, c.a, adj2), true, "requester cancels own pending");
  assert.equal((await adjRow(db, adj2)).status, "cancelled");
});

// ------------------------------------------------------------- streak re-settlement
test("correction re-settles the subject's run leg (sick->paused) and flags a locked week", async () => {
  for (const [locked, kind, expected] of [
    [false, "sick", "paused"],
    [false, "late_completion", "completed"],
    [true, "sick", null],
  ]) {
    const db = await freshDatabase();
    const c = await seedChallenge(db);
    await seedFinalizedMissed(db, c);
    // A streak week + a missed run leg for A's week 6.
    await asService(db);
    // A locked streak week must have a non-'open' result ((locked_at IS NULL) = (result='open')).
    await db.query(
      `INSERT INTO public.streak_weeks(user_id,week_start,week_end,timezone,run_active,run_state,result,locked_at)
       VALUES($1,CURRENT_DATE-14,CURRENT_DATE-8,'UTC',true,'open',$2::public.streak_week_result,$3)`,
      [c.a, locked ? "missed" : "open", locked ? new Date().toISOString() : null],
    );
    await db.query(
      `INSERT INTO public.streak_week_run_legs(user_id,week_start,source_challenge_id,challenge_id,challenge_week_number,challenge_timezone,challenge_week_start,challenge_week_end,challenge_end_instant,settlement_state,settled_at)
       VALUES($1,CURRENT_DATE-14,$2,$2,6,'UTC',CURRENT_DATE-14,CURRENT_DATE-8,now()-interval '1 day','missed',now())`,
      [c.a, c.challenge],
    );
    const adj = await request(db, c.a, c.challenge, 6, kind);
    const result = await review(db, c.b, adj, true);
    assert.equal(result.streak_manual_resolution_required, locked);
    await asService(db);
    const leg = (
      await db.query(
        "SELECT settlement_state FROM public.streak_week_run_legs WHERE user_id=$1 AND source_challenge_id=$2 AND challenge_week_number=6",
        [c.a, c.challenge],
      )
    ).rows[0];
    assert.equal(leg.settlement_state, locked ? "missed" : expected, `${kind} locked=${locked}`);
  }
});

// ------------------------------------------------------------- finalize honors approved sick
test("finalize treats an approved sick request as excused: no penalty/payment for that participant only", async () => {
  const db = await freshDatabase();
  const c = await seedChallenge(db);
  // A has an approved sick request for week 1 (seeded directly; service_role may write).
  await asService(db);
  await db.query(
    `INSERT INTO public.challenge_week_adjustments(challenge_id,user_id,week_number,kind,status,requested_by,reviewed_by,reviewed_at)
     VALUES($1,$2,1,'sick','approved',$2,$3,now())`,
    [c.challenge, c.a, c.b],
  );
  await db.query("SELECT public.finalize_challenge($1,$2)", [c.a, c.challenge]);

  const aWeek = (
    await db.query(
      "SELECT completed,penalty_eur::text AS pen,paused,excuse_reason FROM public.challenge_weeks WHERE challenge_id=$1 AND user_id=$2 AND week_number=1",
      [c.challenge, c.a],
    )
  ).rows[0];
  assert.equal(aWeek.completed, true, "sick week excused as complete");
  assert.equal(aWeek.pen, "0.00");
  assert.equal(aWeek.paused, true);
  assert.equal(aWeek.excuse_reason, "sick");
  assert.equal(
    (
      await db.query(
        "SELECT count(*)::int AS n FROM public.challenge_payments p JOIN public.challenge_weeks w ON w.id=p.week_id WHERE w.user_id=$1 AND w.week_number=1",
        [c.a],
      )
    ).rows[0].n,
    0,
    "no payment generated for the excused participant",
  );
  // The opponent B was not sick: their missed week 1 still generates a penalty + payment.
  const bWeek = (
    await db.query(
      "SELECT penalty_eur::text AS pen, paused FROM public.challenge_weeks WHERE challenge_id=$1 AND user_id=$2 AND week_number=1",
      [c.challenge, c.b],
    )
  ).rows[0];
  assert.equal(bWeek.paused, false);
  assert.notEqual(bWeek.pen, "0.00", "opponent's own obligation is unchanged");
});

// ------------------------------------------------------------- immutability still holds for normal edits
test("finalized week and payment cancellation remain blocked outside an approved correction", async () => {
  const db = await freshDatabase();
  const c = await seedChallenge(db);
  const { wk, payment } = await seedFinalizedMissed(db, c);
  await asService(db);
  await assert.rejects(
    db.query("UPDATE public.challenge_weeks SET completed=true WHERE id=$1", [wk]),
    /Finalized results are immutable/i,
  );
  await assert.rejects(
    db.query("UPDATE public.challenge_payments SET status='cancelled' WHERE id=$1", [payment]),
    /approved week correction/i,
  );
});
