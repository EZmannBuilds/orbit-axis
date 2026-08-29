// Orbit Axis :: post-deletion verification grants (Dev Update 1.2).
//
// A regression guard for a failure that was invisible in every other test.
//
// Account deletion verifies its own cascade by counting rows still carrying the
// deleted user's id, using the service-role key. `service_role` bypasses
// row-level security but NOT table-level GRANTs, and it had never been granted
// anything — so every verification query failed with 42501, findSurvivingRows
// reported all sixteen tables as `unknown`, and a completely successful
// deletion returned DELETION_INCOMPLETE telling the person to contact support.
//
// Unit tests could not catch it: they inject a fetch double, so the grant is
// never exercised. It only appeared against a real database.
//
// What CAN be checked cheaply, and is checked here, is the invariant that made
// it possible: the list of tables the code verifies must match the list of
// tables the migration grants. Adding a table to one without the other is the
// exact mistake that produced this bug.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

import { USER_OWNED_TABLES } from "../lib/account/deletion.js";

const MIGRATIONS = new URL("../supabase/migrations/", import.meta.url).pathname;

/**
 * Every migration that grants a verification read.
 *
 * Originally there was exactly one, and this file assumed so. That stopped
 * being true the moment a table was added to USER_OWNED_TABLES in a later
 * update: its grant belongs in the migration that CREATES it, not bolted onto
 * a historical migration that has already been applied to production. So the
 * invariant is now enforced across every migration that grants, which is what
 * it always meant.
 */
function grantSources() {
  const sources = readdirSync(MIGRATIONS)
    .filter((f) => f.endsWith(".sql"))
    .map((file) => ({ file, sql: readFileSync(join(MIGRATIONS, file), "utf8") }))
    // grantStatements() rather than GRANT.test(): a global regex advances
    // lastIndex on .test(), so testing several files in a row would answer
    // true/false alternately and silently drop half of them.
    .filter(({ sql }) => grantStatements(sql).length > 0);
  assert.ok(sources.length >= 1, "at least one service-role verification grant must exist");
  return sources;
}

// Anchored so a statement cannot swallow the one before it: `[^;]*` stops at
// the first semicolon, which is what kept an unrelated `grant ... to
// authenticated` in the same file from being read as part of a service_role
// grant.
const GRANT = /grant\s+select\s+on\s+[^;]*?to\s+service_role\s*;/gi;

/** Only the executable grant statements — never the commented revocation below them. */
function grantStatements(sql) {
  return (sql.match(GRANT) || []).join("\n");
}

/** Every table granted a verification read, across all migrations. */
function grantedTables() {
  const tables = new Set();
  for (const { sql } of grantSources()) {
    for (const match of grantStatements(sql).matchAll(/public\.([a-z_]+)/g)) tables.add(match[1]);
  }
  return tables;
}

test("every table the deletion path verifies is granted to service_role", () => {
  const granted = grantedTables();
  const missing = USER_OWNED_TABLES
    .map(({ table }) => table)
    .filter((table) => !granted.has(table));
  assert.deepEqual(missing, [],
    "a verified table with no service_role grant makes deletion report "
    + "DELETION_INCOMPLETE even when the cascade fully succeeded");
});

test("the grant is read-only", () => {
  const grantLine = grantSources().map(({ sql }) => grantStatements(sql)).join("\n");
  // The verification counts rows with HEAD; it never reads contents and never
  // writes. Deletion itself goes through the Auth Admin API and the database
  // cascade, neither of which needs a REST grant.
  for (const privilege of ["insert", "update", "delete", "truncate", "all privileges"]) {
    assert.ok(!new RegExp(`\\b${privilege}\\b`, "i").test(grantLine),
      `service_role must not be granted ${privilege} — the verification only counts`);
  }
});

test("the grant names service_role and nothing broader", () => {
  for (const { file, sql } of grantSources()) {
    const statements = grantStatements(sql);
    assert.match(statements, /to service_role;/, `${file}: the grant must target service_role explicitly`);
    assert.ok(!/to\s+(public|anon)\b/i.test(statements),
      `${file}: verification reads must never be granted to anon or PUBLIC`);
  }
});

test("every grant migration documents a narrow manual revocation", () => {
  for (const { file, sql } of grantSources()) {
    assert.match(sql, /revoke select on public\.[a-z_]+[\s\S]*?from service_role;/i,
      `${file}: rollback must document how to revoke the verification reads it adds`);
    assert.ok(!/revoke\s+(usage|all)\b/i.test(sql),
      `${file}: rollback must not remove broader pre-existing service_role privileges`);
  }
});

test("a table cannot be granted without appearing in the verified list", () => {
  // Stated from the other direction so the pairing is enforced both ways. A
  // count comparison used to stand here; it broke the moment the grants were
  // spread across more than one migration, and a set comparison says what was
  // actually meant — these two lists describe the same tables.
  const granted = [...grantedTables()].sort();
  const verified = USER_OWNED_TABLES.map(({ table }) => table).sort();
  assert.deepEqual(granted, verified,
    "USER_OWNED_TABLES and the service_role grants must describe the same tables");
});
