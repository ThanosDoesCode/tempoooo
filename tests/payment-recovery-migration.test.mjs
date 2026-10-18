import { test } from "node:test";
import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { PGlite } from "@electric-sql/pglite";

const migrations = new URL("../supabase/migrations/", import.meta.url);
const TARGET = "1f057efc-39cc-4058-a733-769f9822fb96";
const RECOVERY = "20261018130000_recover_historical_payer_settled_payment.sql";

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

const recoverySql = () => readFile(new URL(RECOVERY, migrations), "utf8");

// Insert the target row directly (INSERT does not fire the BEFORE UPDATE guard) in the given shape.
async function seedTarget(db, { status, selfSettled }) {
  const payer = randomUUID();
  const recipient = randomUUID();
  for (const id of [payer, recipient]) {
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
  await db.query(
    `INSERT INTO public.challenge_payments
       (id,challenge_id,week_id,payer_id,recipient_id,amount_eur,status,marked_paid_at,confirmed_at,settled_by,payment_evidence_path)
     VALUES ($1,$2,$3,$4,$5,15,$6, now() - interval '2 days', now() - interval '1 day', $7, 'payment-evidence/receipt.jpg')`,
    [TARGET, challenge, week, payer, recipient, status, selfSettled ? payer : recipient],
  );
  return { payer, recipient };
}

const target = async (db) =>
  (
    await db.query(
      "SELECT status, amount_eur::text AS amount, marked_paid_at, confirmed_at, settled_by, payment_evidence_path FROM public.challenge_payments WHERE id=$1",
      [TARGET],
    )
  ).rows[0];

// ------------------------------------------------------------- applies cleanly when the row is absent
test("recovery migration is a safe no-op on a fresh database (target row absent)", async () => {
  const db = await freshDatabase(); // applies all migrations, including the recovery, with no target row
  // Re-running it is still a clean no-op.
  await assert.doesNotReject(db.exec(await recoverySql()));
  assert.equal(
    (await db.query("SELECT count(*)::int AS n FROM public.challenge_payments")).rows[0].n,
    0,
  );
});

// ------------------------------------------------------------- recovers a genuine payer self-settlement
test("recovery returns the payer-self-settled row to marked_paid, preserving marked_paid_at and evidence", async () => {
  const db = await freshDatabase();
  const { payer } = await seedTarget(db, { status: "confirmed_paid", selfSettled: true });
  const before = await target(db);
  await db.exec(await recoverySql());
  const after = await target(db);
  assert.equal(after.status, "marked_paid", "returned to awaiting confirmation");
  assert.equal(after.confirmed_at, null, "bogus confirmation cleared");
  assert.equal(after.settled_by, null, "payer self-settler cleared");
  assert.equal(
    String(after.marked_paid_at),
    String(before.marked_paid_at),
    "marked_paid_at preserved",
  );
  assert.equal(after.amount, "15.00", "amount preserved");
  assert.equal(after.payment_evidence_path, "payment-evidence/receipt.jpg", "evidence preserved");
  // Exactly the one target row; nothing else exists to touch.
  assert.equal(
    (
      await db.query(
        "SELECT count(*)::int AS n FROM public.challenge_payments WHERE status='marked_paid'",
      )
    ).rows[0].n,
    1,
  );
  // The guard trigger is re-enabled afterwards: a payer self-settle is now rejected again.
  await db.query("SELECT set_config('request.jwt.claim.sub',$1,false)", [payer]);
  await db.exec("SET ROLE authenticated");
  await assert.rejects(
    db.query("UPDATE public.challenge_payments SET status='confirmed_paid' WHERE id=$1", [TARGET]),
    /recipient can confirm|row-level security/i,
  );
  await db.exec("RESET ROLE");
});

// ------------------------------------------------------------- aborts on a non-matching row
test("recovery aborts (and changes nothing) if the target row is not a payer self-settlement", async () => {
  const db = await freshDatabase();
  await seedTarget(db, { status: "confirmed_paid", selfSettled: false }); // settled_by = recipient
  await assert.rejects(db.exec(await recoverySql()), /Recovery aborted/);
  assert.equal((await target(db)).status, "confirmed_paid", "non-matching row is left untouched");
});

test("recovery aborts if the target row is not confirmed_paid", async () => {
  const db = await freshDatabase();
  await seedTarget(db, { status: "unpaid", selfSettled: true });
  await assert.rejects(db.exec(await recoverySql()), /Recovery aborted/);
  assert.equal((await target(db)).status, "unpaid");
});
