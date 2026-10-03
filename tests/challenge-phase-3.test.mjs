import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import vm from "node:vm";
import ts from "typescript";
import * as dateFns from "date-fns";
import { PGlite } from "@electric-sql/pglite";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

// --- challenge.ts business helpers (same VM-load pattern as the Phase 2 suite) -------------------
const compiled = ts.transpileModule(await read("src/lib/challenge.ts"), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
const context = {
  exports: {},
  require(name) {
    if (name === "date-fns") return dateFns;
    return {};
  },
};
vm.runInNewContext(compiled, context);
const C = context.exports;

test("4, 12 and 52 week challenges each have the right week bounds and max week", () => {
  for (const duration of [4, 12, 52]) {
    const challenge = { start_date: "2026-01-05", duration_weeks: duration, timezone: "UTC" };
    assert.equal(C.weekNumberOf(challenge, "2026-01-05"), 1, `week 1 for ${duration}`);
    const last = C.weekBounds(challenge, duration).end; // last day of the final week
    assert.equal(C.weekNumberOf(challenge, last), duration, `max week ${duration}`);
    // A full week past the final week is out of range (completion boundary).
    const after = dateFns.format(dateFns.addDays(dateFns.parseISO(last), 7), "yyyy-MM-dd");
    assert.equal(C.weekNumberOf(challenge, after), duration + 1, `past end for ${duration}`);
    // Week 1 starts on the Monday start date.
    assert.equal(C.weekBounds(challenge, 1).start, "2026-01-05");
  }
});

// --- Migration: variable lengths + cancel + richer invitation reads -----------------------------
const migration = await read("supabase/migrations/20261003220000_variable_challenge_lengths.sql");

test("migration pins the length constraint and enforces exactly 4/12/52 in create", () => {
  assert.match(
    migration,
    /ADD CONSTRAINT challenge_duration_ck CHECK \(duration_weeks IN \(4, 12, 52\)\)/,
  );
  assert.match(migration, /_duration_weeks NOT IN \(4, 12, 52\)/);
  assert.doesNotMatch(migration, /_duration_weeks < 52/);
  // Cancel is creator-only and blocks an accepted (2-member) challenge.
  assert.match(migration, /CREATE OR REPLACE FUNCTION public\.cancel_pending_challenge/);
  assert.match(migration, /Only the Challenge creator can cancel it/);
  assert.match(migration, /member_count > 1 THEN/);
  assert.match(migration, /DELETE FROM public\.challenges WHERE id = _challenge/);
  assert.match(migration, /GRANT EXECUTE ON FUNCTION public\.cancel_pending_challenge/);
  // The invitation list now exposes the full terms the invited user reviews before accepting.
  assert.match(migration, /duration_weeks integer,\s*\n\s*start_date date/);
  assert.match(migration, /travel_pause_home_countries text\[\]/);
});

test("migration behaviour in Postgres: length constraint + cancel semantics", async () => {
  const db = new PGlite();
  try {
    await db.exec(`
      CREATE TABLE public_profiles(id uuid PRIMARY KEY);
      CREATE TABLE challenges(
        id uuid PRIMARY KEY,
        created_by uuid NOT NULL,
        duration_weeks integer NOT NULL,
        CONSTRAINT challenge_duration_ck CHECK (duration_weeks IN (4, 12, 52))
      );
      CREATE TABLE challenge_members(
        challenge_id uuid NOT NULL REFERENCES challenges(id) ON DELETE CASCADE,
        user_id uuid NOT NULL
      );
      CREATE TABLE challenge_invitations(
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        challenge_id uuid NOT NULL REFERENCES challenges(id) ON DELETE CASCADE
      );
    `);

    // A minimal, schema-matching copy of the migration's cancel function (public schema only).
    await db.exec(`
      CREATE FUNCTION cancel_pending_challenge(_caller uuid, _challenge uuid)
      RETURNS boolean LANGUAGE plpgsql AS $fn$
      DECLARE creator uuid; member_count integer;
      BEGIN
        IF _caller IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
        SELECT created_by INTO creator FROM challenges WHERE id = _challenge FOR UPDATE;
        IF creator IS NULL THEN RAISE EXCEPTION 'Challenge not found'; END IF;
        IF creator <> _caller THEN RAISE EXCEPTION 'Only the Challenge creator can cancel it'; END IF;
        SELECT count(*) INTO member_count FROM challenge_members WHERE challenge_id = _challenge;
        IF member_count > 1 THEN RAISE EXCEPTION 'This Challenge has been accepted'; END IF;
        DELETE FROM challenges WHERE id = _challenge;
        RETURN true;
      END; $fn$;
    `);

    const creator = randomUUID();
    const opponent = randomUUID();

    // Length constraint: exactly 4/12/52 accepted; everything else rejected.
    for (const weeks of [4, 12, 52]) {
      const id = randomUUID();
      await db.query("INSERT INTO challenges(id, created_by, duration_weeks) VALUES ($1,$2,$3)", [
        id,
        creator,
        weeks,
      ]);
    }
    for (const weeks of [3, 8, 20, 53]) {
      await assert.rejects(
        db.query("INSERT INTO challenges(id, created_by, duration_weeks) VALUES ($1,$2,$3)", [
          randomUUID(),
          creator,
          weeks,
        ]),
        /challenge_duration_ck/,
        `duration ${weeks} must be rejected`,
      );
    }

    // Pending challenge: creator + 1 member + an invitation. Cancel deletes it and cascades.
    const pending = randomUUID();
    await db.query("INSERT INTO challenges(id, created_by, duration_weeks) VALUES ($1,$2,12)", [
      pending,
      creator,
    ]);
    await db.query("INSERT INTO challenge_members(challenge_id, user_id) VALUES ($1,$2)", [
      pending,
      creator,
    ]);
    await db.query("INSERT INTO challenge_invitations(challenge_id) VALUES ($1)", [pending]);

    // Non-creator cannot cancel.
    await assert.rejects(
      db.query("SELECT cancel_pending_challenge($1,$2)", [opponent, pending]),
      /Only the Challenge creator/,
    );

    // Creator cancels: challenge + invitation gone.
    await db.query("SELECT cancel_pending_challenge($1,$2)", [creator, pending]);
    const left = await db.query("SELECT count(*)::int AS n FROM challenges WHERE id = $1", [
      pending,
    ]);
    assert.equal(left.rows[0].n, 0);
    const invs = await db.query(
      "SELECT count(*)::int AS n FROM challenge_invitations WHERE challenge_id = $1",
      [pending],
    );
    assert.equal(invs.rows[0].n, 0);

    // An accepted (2-member) challenge cannot be cancelled this way.
    const accepted = randomUUID();
    await db.query("INSERT INTO challenges(id, created_by, duration_weeks) VALUES ($1,$2,4)", [
      accepted,
      creator,
    ]);
    await db.query("INSERT INTO challenge_members(challenge_id, user_id) VALUES ($1,$2),($1,$3)", [
      accepted,
      creator,
      opponent,
    ]);
    await assert.rejects(
      db.query("SELECT cancel_pending_challenge($1,$2)", [creator, accepted]),
      /has been accepted/,
    );
  } finally {
    await db.close();
  }
});

// --- Server boundary -----------------------------------------------------------------------------
test("server validates 4/12/52 and exposes a creator-only cancel RPC", async () => {
  const [functions, server] = await Promise.all([
    read("src/lib/privileged-rpcs.functions.ts"),
    read("src/lib/privileged-rpcs.server.ts"),
  ]);
  assert.match(
    functions,
    /durationWeeks: z\.union\(\[z\.literal\(4\), z\.literal\(12\), z\.literal\(52\)\]\)/,
  );
  assert.match(functions, /cancelPendingChallenge = createServerFn[\s\S]*requireSupabaseAuth/);
  assert.match(functions, /cancelPendingChallengeFor\(context\.userId, data\.challenge\)/);
  assert.match(server, /cancel_pending_challenge/);
  // The invitation read type carries the full terms.
  assert.match(server, /duration_weeks: number;[\s\S]*travel_pause_home_countries: string\[\]/);
});

// --- Create flow ---------------------------------------------------------------------------------
test("Create is a focus-screen, 3-step flow that defers creation to the final step", async () => {
  const [create, nav] = await Promise.all([
    read("src/routes/_authenticated/challenge/new.tsx"),
    read("src/lib/main-navigation.ts"),
  ]);
  assert.match(create, /LENGTHS = \[4, 12, 52\]/);
  assert.match(create, /validateSearch/);
  assert.match(create, /Step \{step\} of 3/);
  assert.match(create, /durationWeeks: length/);
  // Exactly one create call, inside the final send handler — no premature/db-side creation.
  assert.equal((create.match(/await createChallenge\(/g) ?? []).length, 1);
  assert.doesNotMatch(create, /type="date"|Math\.max\(52/);
  // /challenge/new is a focus screen (no bottom bar), including its step sub-states.
  assert.match(nav, /pathname === "\/challenge\/new"/);
  assert.match(nav, /pathname\.startsWith\("\/challenge\/new\/"\)/);
});

// --- Waiting (creator) ---------------------------------------------------------------------------
test("Waiting replaces Week 0 and offers share + creator-only cancel", async () => {
  const [waiting, index] = await Promise.all([
    read("src/components/ChallengeWaiting.tsx"),
    read("src/routes/_authenticated/challenge/index.tsx"),
  ]);
  assert.match(waiting, /Waiting for \{atUser\}/);
  assert.match(waiting, /navigator\.share/);
  assert.match(waiting, /navigator\.clipboard\.writeText/);
  assert.match(waiting, /name === "AbortError"/); // cancelled native share is not an error
  assert.match(waiting, /Invite link copied/);
  assert.match(waiting, /cancelPendingChallenge\(\{ data: \{ challenge: challenge\.id \} \}\)/);
  assert.match(waiting, /Cancel this challenge/);
  assert.match(waiting, /expires in \{daysLeft\}/);
  // The week screen renders Waiting for a pending creator and a pre-start card otherwise — never "Week 0".
  assert.match(index, /needsOpponent && isCreator && outgoingQuery\.data/);
  assert.match(
    index,
    /<ChallengeWaiting challenge=\{challenge\} invitation=\{outgoingQuery\.data\}/,
  );
  assert.match(index, /preStart = !!week && week\.n < 1/);
});

// --- Invite (receiver) + Accept/Decline ----------------------------------------------------------
test("Received invitation shows real terms on Today with Accept/Decline and read-only terms", async () => {
  const [card, today, terms] = await Promise.all([
    read("src/components/ChallengeInviteReceiver.tsx"),
    read("src/routes/_authenticated/bulk/index.tsx"),
    read("src/components/challenge-terms-view.tsx"),
  ]);
  assert.match(card, /New invitation/);
  assert.match(card, /@\{invitation\.inviter_username\} wants a challenge/);
  assert.match(card, /invitation\.duration_weeks/);
  assert.match(card, /invitation\.start_date/);
  assert.match(card, /Runs 1:1 · rides 3:1/);
  assert.match(card, /Read the full terms/);
  assert.match(card, /<TermsCards terms=\{terms\} timezone=\{invitation\.timezone\}/); // read-only (no manage)
  assert.match(card, /Expires \{format\(parseISO\(invitation\.expires_at\)/);
  assert.match(card, /acceptChallengeInvitationById\(\{ data: \{ invitationId: id \} \}\)/);
  assert.match(card, /declineChallengeInvitation\(\{ data: \{ invitationId: id \} \}\)/);
  assert.match(today, /<ChallengeInviteReceiver \/>/);
  // The shared Terms view hides manage controls unless manage is set.
  assert.match(terms, /manage \? \(/);
});
