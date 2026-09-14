import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync, execFile } from "node:child_process";
import { readFileSync } from "node:fs";
import { randomBytes, randomUUID } from "node:crypto";
import { promisify } from "node:util";

test("billing transactions roll back failures, repair legacy receipts, and protect checkout coordination", {
  skip: process.env.ORBIT_ENVIRONMENT !== "test" ? "Run through npm run test:local against the local stack" : false,
}, () => {
  // Fixed local Docker container: never accepts a hosted connection string or
  // reads credentials. The SQL transaction rolls back every synthetic row.
  const sql = readFileSync(new URL("./fixtures/billing-transaction.sql", import.meta.url), "utf8");
  const result = spawnSync("docker", ["exec", "-i", "supabase_db_orbit", "psql", "-U", "postgres", "-d", "postgres", "-v", "ON_ERROR_STOP=1"],
    { input: sql, encoding: "utf8", timeout: 30000 });
  assert.equal(result.status, 0, result.stderr || result.error?.message || result.stdout);
});

test("separate database connections reserve only one checkout attempt", {
  skip: process.env.ORBIT_ENVIRONMENT !== "test" ? "Run through npm run test:local against the local stack" : false,
}, async () => {
  const owner = randomUUID();
  const exec = promisify(execFile);
  const query = async (sql) => (await exec("docker", ["exec", "supabase_db_orbit", "psql", "-U", "postgres", "-d", "postgres", "-At", "-v", "ON_ERROR_STOP=1", "-c", sql], { timeout: 30000 })).stdout.trim();
  await query(`insert into auth.users(id) values ('${owner}'); select public.billing_link_customer('${owner}', 'cus_${owner}');`);
  try {
    const sql = `set role service_role; select public.billing_reserve_checkout('${owner}', 'month', '{"customerId":"cus_${owner}"}'::jsonb)->>'id';`;
    const attempts = await Promise.all(Array.from({ length: 6 }, () => query(sql)));
    assert.equal(new Set(attempts).size, 1, "concurrent workers must share one attempt");
  } finally { await query(`delete from auth.users where id = '${owner}';`); }
});

test("the checked-in migration installs on a fresh billing schema with secure default privileges", {
  skip: process.env.ORBIT_ENVIRONMENT !== "test" ? "Run through npm run test:local against the local stack" : false,
}, () => {
  const db = `orbit_billing_test_${randomBytes(6).toString("hex")}`;
  const run = (args, input) => spawnSync("docker", ["exec", "-i", "supabase_db_orbit", ...args], { input, encoding: "utf8", timeout: 30000 });
  const created = run(["createdb", "-U", "postgres", db]);
  assert.equal(created.status, 0, created.stderr);
  try {
    const baseline = "create schema auth; create table auth.users(id uuid primary key); create function auth.uid() returns uuid language sql as 'select null::uuid';\n";
    const files = ["20260807230000_account_entitlements.sql", "20260819170000_stripe_billing.sql", "20260912153009_billing_reliability.sql"];
    const sql = baseline + files.map((file) => readFileSync(new URL(`../supabase/migrations/${file}`, import.meta.url), "utf8")).join("\n")
      + "\n" + readFileSync(new URL("./fixtures/billing-transaction.sql", import.meta.url), "utf8");
    const result = run(["psql", "-U", "postgres", "-d", db, "-v", "ON_ERROR_STOP=1"], sql);
    assert.equal(result.status, 0, result.stderr || result.stdout);
  } finally {
    const dropped = run(["dropdb", "-U", "postgres", db]);
    assert.equal(dropped.status, 0, dropped.stderr);
  }
});
