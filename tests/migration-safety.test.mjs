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
    for (const match of sql.matchAll(
      /\bCREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?(?:public\.)?([a-z_][a-z0-9_]*)/gi,
    )) {
      const table = match[1].toLowerCase();
      const previous = creators.get(table);
      assert.equal(previous, undefined, `${table} is created in both ${previous} and ${file}`);
      creators.set(table, file);
    }
  }
});
