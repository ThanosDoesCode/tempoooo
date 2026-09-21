import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("the auth gate preserves the page a signed-out visitor opened", async () => {
  const source = await read("src/routes/_authenticated/route.tsx");
  assert.match(source, /rememberDestination, sanitizeDestination/);
  assert.match(source, /throw redirect\(\{ to: "\/auth", search: destination/);
  assert.match(source, /rememberDestination\(location\.href\);\s*\n\s*throw redirect\(\{ to: "\/onboarding" \}\)/);
});

test("sign-in returns the visitor to the invitation instead of the challenge", async () => {
  const source = await read("src/routes/auth.tsx");
  assert.match(source, /const goAfterAuth = async \(\) => \{/);
  assert.match(source, /takeDestination\(search\.redirect \?\? null\)/);
  assert.match(source, /rememberDestination\(search\.redirect\)/);
  // No authenticated path may hard-code the challenge as the only destination.
  assert.equal(source.match(/navigate\(\{ to: "\/challenge", replace: true \}\)/g)?.length ?? 0, 1);
  assert.equal(source.match(/await goAfterAuth\(\);/g).length, 3);
});

test("account onboarding hands the visitor back to the invitation", async () => {
  const source = await read("src/routes/_authenticated/onboarding.tsx");
  assert.match(source, /import \{ takeDestination \} from "@\/lib\/pending-destination"/);
  assert.equal(source.match(/takeDestination\(\)/g).length, 2);
  assert.match(source, /navigate\(\{ href: destination, replace: true \}\)/);
});

test("only same-origin app paths are ever restored after authentication", async () => {
  const source = await read("src/lib/pending-destination.ts");
  assert.match(source, /if \(!value\.startsWith\("\/"\) \|\| value\.startsWith\("\/\/"\)\) return null;/);
  assert.match(source, /startsWith\("\/auth"\)/);
  assert.match(source, /startsWith\("\/onboarding"\)/);
  assert.match(source, /MAX_AGE_MS/);
  assert.match(source, /localStorage/);
});

test("username invitations let both creator and recipient open the Challenge", async () => {
  const [createRoute, invitations, invitationQuery, migration] = await Promise.all([
    read("src/routes/_authenticated/challenge/new.tsx"),
    read("src/components/ChallengeInvitations.tsx"),
    read("src/lib/challenge-invitations.ts"),
    read("supabase/migrations/20260919120000_account_deletion_and_in_app_challenge_invites.sql"),
  ]);

  // The creator identifies the recipient by username and creates the invitation atomically.
  assert.match(createRoute, /placeholder="Search username"/);
  assert.match(createRoute, /invitedUsername: normalizeUsername\(username\)/);
  assert.match(createRoute, /const challengeId = await createChallenge\(/);
  assert.doesNotMatch(createRoute, /Copy link|navigator\.clipboard|setLink\(/);

  // The creator can open the newly created Challenge.
  assert.match(createRoute, /Go to challenge/);
  assert.match(createRoute, /onClick=\{\(\) => void navigate\(\{ to: "\/challenge" \}\)\}/);

  // The recipient sees their pending invitation and accepts it through the authenticated boundary.
  assert.match(invitationQuery, /listMyChallengeInvitations\(\)/);
  assert.match(invitations, /invitations\.data\?\.map/);
  assert.match(
    invitations,
    /await acceptChallengeInvitationById\(\{ data: \{ invitationId \} \}\)/,
  );

  // Acceptance creates the recipient membership before taking them to the Challenge.
  const acceptance =
    migration.match(
      /CREATE FUNCTION public\.accept_challenge_invitation_by_id[\s\S]*?END;\n\$function\$;/,
    )?.[0] ?? "";
  assert.match(acceptance, /invitation\.invited_user_id IS DISTINCT FROM _caller/);
  assert.match(
    acceptance,
    /INSERT INTO public\.challenge_members\(challenge_id, user_id\)[\s\S]*invitation\.challenge_id, _caller/,
  );
  assert.match(
    invitations,
    /await acceptChallengeInvitationById[\s\S]*await refresh\(\);[\s\S]*await navigate\(\{ to: "\/challenge" \}\)/,
  );
});
