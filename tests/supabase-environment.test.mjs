import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  missingPublicSupabaseVariables,
  resolvePublicSupabaseConfiguration,
} from "../src/integrations/supabase/environment.ts";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("browser build uses canonical import.meta.env Supabase variables first", () => {
  assert.deepEqual(
    resolvePublicSupabaseConfiguration(
      {
        VITE_SUPABASE_URL: "https://browser.example",
        VITE_SUPABASE_PUBLISHABLE_KEY: "browser-key",
      },
      {
        VITE_SUPABASE_URL: "https://runtime.example",
        VITE_SUPABASE_PUBLISHABLE_KEY: "runtime-key",
        SUPABASE_URL: "https://legacy.example",
        SUPABASE_PUBLISHABLE_KEY: "legacy-key",
      },
    ),
    { url: "https://browser.example", publishableKey: "browser-key" },
  );
});

test("browser client uses direct Vite property reads instead of the whole env object", async () => {
  const browserClient = await read("src/integrations/supabase/client.ts");
  assert.match(browserClient, /import\.meta\.env\.VITE_SUPABASE_URL/);
  assert.match(browserClient, /import\.meta\.env\.VITE_SUPABASE_PUBLISHABLE_KEY/);
  assert.doesNotMatch(
    browserClient,
    /resolvePublicSupabaseConfiguration\(import\.meta\.env,\s*runtimeEnvironment\)/,
  );
});

test("SSR runtime uses process.env VITE_SUPABASE variables", () => {
  assert.deepEqual(
    resolvePublicSupabaseConfiguration(
      {},
      {
        VITE_SUPABASE_URL: "https://runtime.example",
        VITE_SUPABASE_PUBLISHABLE_KEY: "runtime-key",
      },
    ),
    { url: "https://runtime.example", publishableKey: "runtime-key" },
  );
});

test("unprefixed public Supabase variables remain the final SSR fallback", () => {
  assert.deepEqual(
    resolvePublicSupabaseConfiguration(
      {},
      {
        SUPABASE_URL: "https://legacy.example",
        SUPABASE_PUBLISHABLE_KEY: "legacy-key",
      },
    ),
    { url: "https://legacy.example", publishableKey: "legacy-key" },
  );
});

test("missing public configuration reports Lovable's canonical variable names", () => {
  assert.deepEqual(missingPublicSupabaseVariables({ url: undefined, publishableKey: undefined }), [
    "VITE_SUPABASE_URL",
    "VITE_SUPABASE_PUBLISHABLE_KEY",
  ]);
  assert.deepEqual(
    missingPublicSupabaseVariables({
      url: "https://configured.example",
      publishableKey: undefined,
    }),
    ["VITE_SUPABASE_PUBLISHABLE_KEY"],
  );
});

test("service-role credentials remain server-only and never use a VITE prefix", async () => {
  const [browserClient, serverClient, middleware] = await Promise.all([
    read("src/integrations/supabase/client.ts"),
    read("src/integrations/supabase/client.server.ts"),
    read("src/integrations/supabase/auth-middleware.ts"),
  ]);

  assert.doesNotMatch(browserClient, /SERVICE_ROLE/);
  assert.doesNotMatch(middleware, /SERVICE_ROLE/);
  assert.match(serverClient, /process\.env\["SUPABASE_SERVICE_ROLE_KEY"\]/);
  assert.doesNotMatch(serverClient, /VITE_SUPABASE_SERVICE_ROLE_KEY/);
  assert.match(
    serverClient,
    /process\.env\["VITE_SUPABASE_URL"\] \|\| process\.env\["SUPABASE_URL"\]/,
  );
});
