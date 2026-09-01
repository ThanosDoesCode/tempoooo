import { readdir, readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { spawnSync } from "node:child_process";

// Build with known test-only secrets, then inspect only browser-delivered assets.
// Never print real environment values or scan/server-report the server bundle.
const secrets = [
  "ONESIGNAL_REST_API_KEY",
  "CHALLENGE_PUSH_DISPATCH_SECRET",
  "SUPABASE_SERVICE_ROLE_KEY",
];
const canaries = Object.fromEntries(
  secrets.map((key) => [key, `private-bundle-canary-${key.toLowerCase()}`]),
);
if (process.argv.includes("--build")) {
  const build = spawnSync("npm", ["run", "build"], {
    stdio: "inherit",
    env: { ...process.env, ...canaries },
  });
  if (build.status !== 0) process.exit(build.status ?? 1);
}
const directories = ["dist/client", ".output/public", "dist/public"].filter(existsSync);
if (!directories.length) throw new Error("No client build found; run with --build first.");
let scanned = 0;
async function scan(dir) {
  for (const item of await readdir(dir, { withFileTypes: true })) {
    const path = `${dir}/${item.name}`;
    if (item.isDirectory()) {
      await scan(path);
      continue;
    }
    if (!/\.(js|mjs|json|html|map)$/.test(item.name)) continue;
    const content = await readFile(path, "utf8");
    for (const key of secrets) {
      if (
        content.includes(key) ||
        content.includes(canaries[key]) ||
        (process.env[key] && content.includes(process.env[key]))
      ) {
        throw new Error(`Server secret reference found in browser asset: ${path}`);
      }
    }
    scanned++;
  }
}
for (const directory of directories) await scan(directory);
console.log(
  `PASS: ${scanned} client assets contain no push/server secret references or test canaries.`,
);
