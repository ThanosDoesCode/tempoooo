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

// Minimal real rows: a 2-member challenge with one finalized week and one open payment (A owes B €15).
async function seedPayment(db, { evidence = null } = {}) {
  const payer = randomUUID();
  const recipient = randomUUID();
  const outsider = randomUUID();
  await asService(db);
  for (const id of [payer, recipient, outsider]) {
    await db.query("INSERT INTO auth.users(id) VALUES($1)", [id]);
    await db.query("INSERT INTO public.profiles(id) VALUES($1)", [id]);
  }
  const challenge = (
    await db.query(
      "INSERT INTO public.challenges(created_by,name,start_date) VALUES($1,'Duel',CURRENT_DATE) RETURNING id",
      [payer],
    )
  ).rows[0].id;
  await db.query(
    "INSERT INTO public.challenge_members(challenge_id,user_id,role) VALUES($1,$2,'owner'),($1,$3,'member')",
    [challenge, payer, recipient],
  );
  const week = (
    await db.query(
      "INSERT INTO public.challenge_weeks(challenge_id,user_id,week_number,week_start,week_end,penalty_eur) VALUES($1,$2,1,CURRENT_DATE-7,CURRENT_DATE-1,0) RETURNING id",
      [challenge, payer],
    )
  ).rows[0].id;
  const payment = (
    await db.query(
      "INSERT INTO public.challenge_payments(challenge_id,week_id,payer_id,recipient_id,amount_eur,status,payment_evidence_path) VALUES($1,$2,$3,$4,15,'unpaid',$5) RETURNING id",
      [challenge, week, payer, recipient, evidence],
    )
  ).rows[0].id;
  return { payer, recipient, outsider, challenge, payment };
}

// Mirrors the frontend mutation: UPDATE challenge_payments SET status=... as the given user.
const setStatus = async (db, uid, payment, status) => {
  await asUser(db, uid);
  try {
    const result = await db.query("UPDATE public.challenge_payments SET status=$2 WHERE id=$1", [
      payment,
      status,
    ]);
    return result.affectedRows ?? 0;
  } finally {
    await asService(db);
  }
};
// Force columns into an intentionally-dirty state that the public API could never produce, by briefly
// disabling the guard trigger. Used to prove each transition normalizes regardless of prior row state.
const forceColumns = async (db, payment, cols) => {
  await asService(db);
  await db.exec("ALTER TABLE public.challenge_payments DISABLE TRIGGER challenge_payments_guard");
  const keys = Object.keys(cols);
  const sets = keys.map((k, i) => `${k}=$${i + 2}`).join(", ");
  await db.query(`UPDATE public.challenge_payments SET ${sets} WHERE id=$1`, [
    payment,
    ...keys.map((k) => cols[k]),
  ]);
  await db.exec("ALTER TABLE public.challenge_payments ENABLE TRIGGER challenge_payments_guard");
};
const row = async (db, payment) =>
  (
    await db.query(
      "SELECT status, amount_eur::text AS amount, payment_evidence_path, settled_by, marked_paid_at, confirmed_at FROM public.challenge_payments WHERE id=$1",
      [payment],
    )
  ).rows[0];
const count = async (db, payment) =>
  Number(
    (
      await db.query("SELECT count(*)::int AS n FROM public.challenge_payments WHERE id=$1", [
        payment,
      ])
    ).rows[0].n,
  );

// ------------------------------------------------------------- payer marks paid (no settle)
test("payer mark-paid moves to awaiting confirmation, never to settled, and persists", async () => {
  const db = await freshDatabase();
  const { payer, payment } = await seedPayment(db);
  await setStatus(db, payer, payment, "marked_paid");
  const r = await row(db, payment);
  assert.equal(r.status, "marked_paid", "awaiting confirmation, not settled");
  assert.ok(r.marked_paid_at, "marked_paid_at stamped");
  assert.equal(r.confirmed_at, null);
  assert.equal(r.settled_by, null);
  // Survives a reload: it is a stored column, still marked_paid on a fresh read.
  assert.equal((await row(db, payment)).status, "marked_paid");
});

test("payer CANNOT self-settle from unpaid or from marked_paid", async () => {
  const db = await freshDatabase();
  const { payer, payment } = await seedPayment(db);
  await assert.rejects(
    setStatus(db, payer, payment, "confirmed_paid"),
    /recipient can confirm|row-level security/i,
  );
  await setStatus(db, payer, payment, "marked_paid");
  await assert.rejects(
    setStatus(db, payer, payment, "confirmed_paid"),
    /recipient can confirm|row-level security/i,
  );
  assert.equal((await row(db, payment)).status, "marked_paid");
});

// ------------------------------------------------------------- recipient confirm / reject
test("only the recipient can confirm; confirming settles exactly once and records them as settler", async () => {
  const db = await freshDatabase();
  const { payer, recipient, payment } = await seedPayment(db);
  await setStatus(db, payer, payment, "marked_paid");
  await setStatus(db, recipient, payment, "confirmed_paid");
  let r = await row(db, payment);
  assert.equal(r.status, "confirmed_paid");
  assert.ok(r.confirmed_at);
  assert.equal(r.settled_by, recipient, "recipient is the settler");
  // Idempotent: confirming again is a no-op single row.
  await setStatus(db, recipient, payment, "confirmed_paid");
  assert.equal(await count(db, payment), 1);
  assert.equal((await row(db, payment)).status, "confirmed_paid");
});

test("recipient 'Not received' reopens to OPEN without duplicating or changing the obligation", async () => {
  const db = await freshDatabase();
  const { payer, recipient, payment } = await seedPayment(db);
  await setStatus(db, payer, payment, "marked_paid");
  await setStatus(db, recipient, payment, "unpaid"); // Not received
  const r = await row(db, payment);
  assert.equal(r.status, "unpaid");
  assert.equal(r.marked_paid_at, null, "current-state mark-paid timestamp is cleared on reopen");
  assert.equal(r.confirmed_at, null, "never confirmed, so no confirmed_at");
  assert.equal(r.settled_by, null);
  assert.equal(r.amount, "15.00", "amount unchanged");
  assert.equal(await count(db, payment), 1, "no duplicate obligation");
});

test("marked_paid -> unpaid (payer undo or recipient reject) clears marked_paid_at", async () => {
  for (const actor of ["payer", "recipient"]) {
    const db = await freshDatabase();
    const seeded = await seedPayment(db);
    await setStatus(db, seeded.payer, seeded.payment, "marked_paid");
    assert.ok((await row(db, seeded.payment)).marked_paid_at, "stamped on mark-paid");
    await setStatus(db, seeded[actor], seeded.payment, "unpaid");
    const r = await row(db, seeded.payment);
    assert.equal(r.status, "unpaid");
    assert.equal(r.marked_paid_at, null, `${actor} reopen clears marked_paid_at`);
    assert.equal(r.confirmed_at, null);
  }
});

test("payer can undo their own mark-paid back to OPEN", async () => {
  const db = await freshDatabase();
  const { payer, payment } = await seedPayment(db);
  await setStatus(db, payer, payment, "marked_paid");
  await setStatus(db, payer, payment, "unpaid");
  assert.equal((await row(db, payment)).status, "unpaid");
});

// ------------------------------------------------------------- authorization
test("payer cannot self-confirm; an unrelated user cannot mutate the obligation", async () => {
  const db = await freshDatabase();
  const { payer, recipient, outsider, payment } = await seedPayment(db);
  await setStatus(db, payer, payment, "marked_paid");
  // Outsider: RLS makes the row invisible for update -> 0 rows affected, nothing changes.
  assert.equal(await setStatus(db, outsider, payment, "confirmed_paid"), 0);
  assert.equal(await setStatus(db, outsider, payment, "unpaid"), 0);
  assert.equal((await row(db, payment)).status, "marked_paid");
  // The payer still cannot confirm their own payment.
  await assert.rejects(
    setStatus(db, payer, payment, "confirmed_paid"),
    /recipient can confirm|row-level security/i,
  );
});

test("neither party can alter the amount during a transition", async () => {
  const db = await freshDatabase();
  const { payer, recipient, payment } = await seedPayment(db);
  // Payer cannot change the amount (policy gate compares the stored amount).
  await asUser(db, payer);
  await assert.rejects(
    db.query("UPDATE public.challenge_payments SET amount_eur=1 WHERE id=$1", [payment]),
    /row-level security|immutable/i,
  );
  await asService(db);
  await setStatus(db, payer, payment, "marked_paid");
  // Recipient cannot lower the amount while confirming.
  await asUser(db, recipient);
  await assert.rejects(
    db.query(
      "UPDATE public.challenge_payments SET amount_eur=1, status='confirmed_paid' WHERE id=$1",
      [payment],
    ),
    /row-level security|immutable/i,
  );
  await asService(db);
  assert.equal((await row(db, payment)).amount, "15.00");
});

// ------------------------------------------------------------- evidence / history
test("payment evidence survives mark-paid and a 'Not received' rejection", async () => {
  const db = await freshDatabase();
  const { payer, recipient, payment } = await seedPayment(db, {
    evidence: "payment-evidence/receipt.jpg",
  });
  await setStatus(db, payer, payment, "marked_paid");
  await setStatus(db, recipient, payment, "unpaid");
  assert.equal((await row(db, payment)).payment_evidence_path, "payment-evidence/receipt.jpg");
});

// ------------------------------------------------------------- timestamp normalization (dirty state)
test("unpaid -> marked_paid normalizes stale confirmed_at/settled_by and preserves the obligation", async () => {
  const db = await freshDatabase();
  const { payer, outsider, payment } = await seedPayment(db, {
    evidence: "payment-evidence/receipt.jpg",
  });
  // An impossible-through-API dirty unpaid row: a leftover confirmed_at and settled_by.
  await forceColumns(db, payment, { confirmed_at: new Date().toISOString(), settled_by: outsider });
  await setStatus(db, payer, payment, "marked_paid");
  const r = await row(db, payment);
  assert.equal(r.status, "marked_paid");
  assert.ok(r.marked_paid_at, "marked_paid_at set");
  assert.equal(r.confirmed_at, null, "stale confirmed_at cleared");
  assert.equal(r.settled_by, null, "stale settled_by cleared");
  assert.equal(r.amount, "15.00");
  assert.equal(r.payment_evidence_path, "payment-evidence/receipt.jpg");
});

test("marked_paid -> unpaid normalizes stale confirmed_at/settled_by for both payer and recipient", async () => {
  for (const actor of ["payer", "recipient"]) {
    const db = await freshDatabase();
    const seeded = await seedPayment(db, { evidence: "payment-evidence/receipt.jpg" });
    await setStatus(db, seeded.payer, seeded.payment, "marked_paid");
    // Dirty the awaiting row with a leftover settlement.
    await forceColumns(db, seeded.payment, {
      confirmed_at: new Date().toISOString(),
      settled_by: seeded.outsider,
    });
    await setStatus(db, seeded[actor], seeded.payment, "unpaid");
    const r = await row(db, seeded.payment);
    assert.equal(r.status, "unpaid");
    assert.equal(r.marked_paid_at, null, `${actor} reopen clears marked_paid_at`);
    assert.equal(r.confirmed_at, null, `${actor} reopen clears confirmed_at`);
    assert.equal(r.settled_by, null, `${actor} reopen clears settled_by`);
    assert.equal(r.amount, "15.00");
    assert.equal(r.payment_evidence_path, "payment-evidence/receipt.jpg");
  }
});

test("confirmed_paid -> unpaid clears every settlement field and preserves amount/evidence", async () => {
  const db = await freshDatabase();
  const { payer, recipient, payment } = await seedPayment(db, {
    evidence: "payment-evidence/receipt.jpg",
  });
  await setStatus(db, payer, payment, "marked_paid");
  await setStatus(db, recipient, payment, "confirmed_paid");
  await setStatus(db, recipient, payment, "unpaid");
  const r = await row(db, payment);
  assert.equal(r.status, "unpaid");
  assert.equal(r.marked_paid_at, null);
  assert.equal(r.confirmed_at, null);
  assert.equal(r.settled_by, null);
  assert.equal(r.amount, "15.00");
  assert.equal(r.payment_evidence_path, "payment-evidence/receipt.jpg");
});

test("marked_paid -> confirmed_paid keeps marked_paid_at and records the recipient as settler", async () => {
  const db = await freshDatabase();
  const { payer, recipient, payment } = await seedPayment(db);
  await setStatus(db, payer, payment, "marked_paid");
  const sent = (await row(db, payment)).marked_paid_at;
  await setStatus(db, recipient, payment, "confirmed_paid");
  const r = await row(db, payment);
  assert.equal(r.status, "confirmed_paid");
  assert.ok(r.confirmed_at, "confirmed_at set");
  assert.equal(String(r.marked_paid_at), String(sent), "marked_paid_at preserved through confirm");
  assert.equal(r.settled_by, recipient);
});

// ------------------------------------------------------------- reopen a settle (recipient only)
test("a settled payment can be reopened only by the recipient who settled it", async () => {
  const db = await freshDatabase();
  const { payer, recipient, payment } = await seedPayment(db);
  await setStatus(db, payer, payment, "marked_paid");
  await setStatus(db, recipient, payment, "confirmed_paid");
  // Payer cannot reopen someone else's settle.
  await assert.rejects(
    setStatus(db, payer, payment, "unpaid"),
    /person who settled this can reopen|row-level security/i,
  );
  assert.equal((await row(db, payment)).status, "confirmed_paid");
  // The recipient (settled_by) can reopen it, leaving no stale current-state timestamps.
  await setStatus(db, recipient, payment, "unpaid");
  const r = await row(db, payment);
  assert.equal(r.status, "unpaid");
  assert.equal(r.confirmed_at, null, "no stale confirmed_at on a reopened obligation");
  assert.equal(r.marked_paid_at, null);
  assert.equal(r.settled_by, null);
});
