import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("the app never persists a password and leaves saving to the browser", async () => {
  const auth = await read("src/routes/auth.tsx");

  assert.doesNotMatch(auth, /localStorage\.setItem/);
  assert.doesNotMatch(auth, /sessionStorage\.setItem/);
  assert.doesNotMatch(auth, /\bbtoa\b|\batob\b|navigator\.credentials|PasswordCredential/);
  assert.doesNotMatch(auth, /Save password|readSaved|offerToSaveCredentials/);
  assert.match(auth, /autoComplete="username"/);
  assert.match(auth, /autoComplete=\{mode === "signin" \? "current-password" : "new-password"\}/);
});

test("email login and signup keep their Supabase flows and explain email verification", async () => {
  const auth = await read("src/routes/auth.tsx");

  assert.match(auth, /supabase\.auth\.signInWithPassword\(\{ email, password \}\)/);
  assert.match(auth, /supabase\.auth\.signUp\(\{[\s\S]*email,[\s\S]*password,/);
  assert.match(auth, /emailRedirectTo: `\$\{window\.location\.origin\}\/auth`/);
  assert.match(auth, /Check your email to finish signing up/);
  assert.match(auth, /Open it to verify your email/);
  assert.match(auth, /kind: "success"/);
});

test("Google login uses the existing authorized wrapper and returns to Challenge", async () => {
  const [auth, oauth] = await Promise.all([
    read("src/routes/auth.tsx"),
    read("src/integrations/lovable/index.ts"),
  ]);

  assert.match(auth, /Continue with Google/);
  assert.match(auth, /lovable\.auth\.signInWithOAuth\("google",/);
  assert.match(auth, /extraParams: \{ prompt: "select_account" \}/);
  assert.match(auth, /redirect_uri: `\$\{window\.location\.origin\}\/auth`/);
  assert.match(auth, /supabase\.auth\.getUser\(\)/);
  assert.match(auth, /navigate\(\{ to: "\/challenge", replace: true \}\)/);
  assert.match(auth, /continue with Google/);
  assert.match(oauth, /createLovableAuth\(\)/);
  assert.match(oauth, /await supabase\.auth\.setSession\(result\.tokens\)/);
});

test("authentication does not implicitly activate optional Bulk", async () => {
  const [auth, access, guard, onboarding] = await Promise.all([
    read("src/routes/auth.tsx"),
    read("src/lib/bulk-access.ts"),
    read("src/routes/_authenticated/bulk/route.tsx"),
    read("src/routes/_authenticated/bulk-onboarding.tsx"),
  ]);

  assert.doesNotMatch(auth, /bulk_members|bulk_profile_id|role.*owner/);
  assert.match(access, /\.from\("bulk_members"\)/);
  assert.match(access, /\.filter\(\(r\) => r\.role === "owner"\)/);
  assert.match(guard, /bulkOwnerQueryOptions\(\)/);
  assert.match(guard, /bulk-onboarding/);
  assert.match(onboarding, /complete_bulk_onboarding/);
  assert.doesNotMatch(onboarding, /activate_my_bulk/);
});

test("auth controls expose mobile touch targets and public Challenge copy", async () => {
  const auth = await read("src/routes/auth.tsx");

  assert.match(auth, /Continue with Google[\s\S]*?min-h-11|min-h-11[\s\S]*?Continue with Google/);
  assert.match(auth, /min-h-11 w-full items-center justify-center rounded-xl/);
  assert.doesNotMatch(auth, /Private bulk|lean bulk tracker/);
});

test("generated Supabase types have a narrow formatting and lint exclusion", async () => {
  const [eslint, prettier] = await Promise.all([read("eslint.config.js"), read(".prettierignore")]);

  assert.match(eslint, /src\/integrations\/supabase\/types\.ts/);
  assert.match(prettier, /^src\/integrations\/supabase\/types\.ts$/m);
  assert.doesNotMatch(eslint, /src\/integrations\/supabase\/\*|src\/integrations\/\*\*/);
});
