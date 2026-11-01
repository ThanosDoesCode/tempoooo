import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";

const root = new URL("../supabase/migrations/", import.meta.url);

test("migration history has unique ordered versions and no conflict markers", async () => {
  const files = (await readdir(root)).filter((file) => file.endsWith(".sql")).sort();
  const versions = files.map((file) => file.split("_")[0]);
  assert.equal(
    new Set(versions).size,
    versions.length,
    "migration version timestamps must be unique",
  );
  for (const file of files) {
    assert.match(file, /^\d{14}_.+\.sql$/);
    const sql = await readFile(new URL(file, root), "utf8");
    assert.ok(sql.trim(), `${file} must not be empty`);
    assert.doesNotMatch(sql, /^(?:<<<<<<<|=======|>>>>>>>)/m, `${file} has a merge marker`);
  }
});

test("a table is introduced by only one forward migration", async () => {
  const files = (await readdir(root)).filter((file) => file.endsWith(".sql")).sort();
  const creators = new Map();
  for (const file of files) {
    const sql = await readFile(new URL(file, root), "utf8");
    for (const table of createdTables(sql)) {
      const previous = creators.get(table);
      assert.equal(previous, undefined, `${table} is created in both ${previous} and ${file}`);
      creators.set(table, file);
    }
  }
});

// Include the schema: otherwise CREATE TABLE private.foo is incorrectly parsed as a
// table named "private", and a second, different private table fails this guard.
function createdTables(sql) {
  return [
    ...sql.matchAll(
      /\bCREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?(?:([a-z_][a-z0-9_]*)\.)?([a-z_][a-z0-9_]*)/gi,
    ),
  ].map((match) => `${match[1] ?? "public"}.${match[2]}`.toLowerCase());
}
test("migration table guard distinguishes qualified private tables and unqualified public tables", () => {
  assert.deepEqual(
    createdTables(
      "CREATE TABLE private.one (); CREATE TABLE IF NOT EXISTS private.two (); CREATE TABLE public.one (); CREATE TABLE one ();",
    ),
    ["private.one", "private.two", "public.one", "public.one"],
  );
});
