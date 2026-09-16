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

test("Go to challenge only navigates the creator", async () => {
  const source = await read("src/routes/_authenticated/challenge/new.tsx");
  const block = source.match(/Go to challenge/);
  assert.ok(block);
  const button = source.match(/onClick=\{\(\) => void navigate\(\{ to: "\/challenge" \}\)\}/);
  assert.ok(button, "Go to challenge performs navigation only");
  // The invitation is persisted by createChallenge, before the link is displayed.
  assert.match(source, /const challengeId = await createChallenge\(/);
  assert.match(source, /setLink\(`\$\{window\.location\.origin\}\/invite\/challenge\/\$\{request\.token\}`\)/);
});
