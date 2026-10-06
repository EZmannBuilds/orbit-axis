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
 * The migrations that grant the verification reads, concatenated in order.
 *
 * There is more than one because the original grant is already applied in
 * Production and cannot be edited; a table created later gets its own grant
 * migration named with the same marker so it is counted here.
 */
function grantMigration() {
  const names = readdirSync(MIGRATIONS)
    .filter((f) => f.includes("service_role_deletion_verification_grants"))
    .sort();
  assert.ok(names.length > 0, "the service-role verification grant migration must exist");
  return names.map((name) => readFileSync(join(MIGRATIONS, name), "utf8")).join("\n");
}

test("every table the deletion path verifies is granted to service_role", () => {
  const sql = grantMigration();
  const granted = sql.slice(sql.indexOf("grant select on"));
  const missing = USER_OWNED_TABLES
    .map(({ table }) => table)
    .filter((table) => !granted.includes(`public.${table}`));
  assert.deepEqual(missing, [],
    "a verified table with no service_role grant makes deletion report "
    + "DELETION_INCOMPLETE even when the cascade fully succeeded");
});

test("the grant is read-only", () => {
  const sql = grantMigration();
  const grantLine = sql.slice(sql.indexOf("grant select on"));
  // The verification counts rows with HEAD; it never reads contents and never
  // writes. Deletion itself goes through the Auth Admin API and the database
  // cascade, neither of which needs a REST grant.
  for (const privilege of ["insert", "update", "delete", "truncate", "all privileges"]) {
    assert.ok(!new RegExp(`\\b${privilege}\\b`, "i").test(grantLine),
      `service_role must not be granted ${privilege} — the verification only counts`);
  }
});

test("the grant names service_role and nothing broader", () => {
  const sql = grantMigration();
  assert.match(sql, /to service_role;/,
    "the grant must target service_role explicitly");
  assert.ok(!/to\s+(public|anon)\b/i.test(sql.slice(sql.indexOf("grant select on"))),
    "these tables must never be readable by anon or PUBLIC");
});

test("the migration documents a narrow manual revocation", () => {
  const sql = grantMigration();
  assert.match(sql, /revoke select on public\.profiles,[\s\S]+from service_role;/i,
    "rollback must document how to revoke the verification reads");
  assert.ok(!/revoke\s+(usage|all)\b/i.test(sql),
    "rollback must not remove broader pre-existing service_role privileges");
});

test("a table cannot be verified without appearing in the grant list", () => {
  // Stated from the other direction so the pairing is enforced both ways: this
  // is the assertion that fails when someone adds a table to USER_OWNED_TABLES
  // six months from now and forgets the migration.
  const sql = grantMigration();
  assert.equal(
    USER_OWNED_TABLES.length,
    (sql.match(/^\s*public\.[a-z_]+,?$/gm) || []).length,
    "USER_OWNED_TABLES and the grant migration must list the same tables",
  );
});
