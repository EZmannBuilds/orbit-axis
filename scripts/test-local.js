#!/usr/bin/env node
// Orbit Axis :: safe test runner (Update 4.0.2).
//
// Pins the test run to the LOCAL Supabase stack before any test process starts,
// so `.env.local` (which holds the hosted project URL) can never pull the suite
// onto production. Unit tests need no database at all; the integration tests
// pick up the same local URL and skip when the stack isn't running.

import { spawnSync } from "node:child_process";
import { readdirSync } from "node:fs";
import { localSupabaseUrl, LOCAL_ANON_KEY, resolveEnvironment } from "../lib/env/environment.js";
import { assertNonProductionTarget, EnvironmentSafetyError } from "../lib/env/guard.js";

const localUrl = localSupabaseUrl();
const env = {
  ...process.env,
  ORBIT_ENVIRONMENT: "test",
  SUPABASE_URL: localUrl,
  SUPABASE_ANON_KEY: LOCAL_ANON_KEY,
  ORBIT_TEST_SUPABASE_URL: process.env.ORBIT_TEST_SUPABASE_URL || localUrl,
};
// A service-role key is never needed by the suite.
delete env.SUPABASE_SERVICE_ROLE_KEY;

try {
  assertNonProductionTarget("The test suite", resolveEnvironment({ env, loadEnvFiles: false }));
} catch (error) {
  if (error instanceof EnvironmentSafetyError) {
    console.error(`\n${error.message}\n`);
    process.exit(1);
  }
  throw error;
}

// ── Why this runs in two passes ─────────────────────────────────────────────
//
// `node --test` runs FILES in parallel, one per core. Most of this suite is
// pure computation and is happy that way. Seven files are not: they sign users
// up and push objects through the local Supabase stack, which is a single small
// set of containers, not a cluster. Ten of those at once saturates it, and the
// symptoms are worse than slowness — the tests use bare `fetch`, which has no
// timeout, so a wedged storage service does not fail, it simply never answers
// and the whole run hangs with no result at all.
//
// That produced two hangs and one run reporting 46 failures that were entirely
// environmental, which is precisely the condition under which a real regression
// gets waved through as "the flaky thing again".
//
// So: everything else keeps full parallelism, and the integration files run one
// at a time against the stack they share. `--test-timeout` is the backstop —
// with it a hang becomes a failed test with a name, rather than silence.
const INTEGRATION_FILES = [
  "test/account-deletion.test.js",
  "test/ask-supabase-integration.test.js",
  "test/auth-database.test.js",
  "test/avatar-cleanup.test.js",
  "test/avatar-endpoint-security.test.js",
  "test/avatar-storage-policies.test.js",
  "test/compatibility-endpoint.test.js",
];

// Generous: these genuinely talk to containers over HTTP. The point is not to
// police slowness, it is that nothing may wait forever.
const TEST_TIMEOUT_MS = process.env.ORBIT_TEST_TIMEOUT_MS || "120000";

function run(extraArgs) {
  return spawnSync(
    process.execPath,
    ["--test", `--test-timeout=${TEST_TIMEOUT_MS}`, ...extraArgs],
    { stdio: "inherit", env },
  ).status ?? 1;
}

const args = process.argv.slice(2);

// An explicit file list is the caller's business — run exactly what was asked,
// in one pass, so `npm run test:local -- test/one.test.js` stays predictable.
if (args.length > 0) {
  process.exit(run(args));
}

const all = readdirSync("test")
  .filter((name) => name.endsWith(".test.js"))
  .map((name) => `test/${name}`);
const integration = all.filter((file) => INTEGRATION_FILES.includes(file));
const parallel = all.filter((file) => !INTEGRATION_FILES.includes(file));

// Both passes always run: a failure in the first must not hide a failure in the
// second, or a green integration run could mask a broken unit test and vice
// versa. The exit code reports the first non-zero.
const parallelStatus = parallel.length ? run(parallel) : 0;
const serialStatus = integration.length ? run(["--test-concurrency=1", ...integration]) : 0;

process.exit(parallelStatus || serialStatus);
