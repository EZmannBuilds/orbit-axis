// Orbit Axis :: narrow service-role authorization (Dev Update 1.2).
//
// The property under test is not "deletion works". It is that every single
// condition, alone, is enough to refuse — because an authorization that only
// fails when several things are wrong at once is an authorization that will
// eventually be granted by accident.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

import {
  serviceRoleVerdict, serviceRoleWarnings,
  SERVICE_ROLE_PURPOSES, PURPOSE_VAR, PROJECT_VAR,
} from "../lib/env/service-role.js";
import { sharedPreviewVerdict, sharedProductionVerdict } from "../lib/env/shared-preview.js";
import { PRODUCTION_PROJECT_REF } from "../lib/env/known-targets.js";
import { deleteAccount, AccountDeletionError } from "../lib/account/deletion.js";

const PURPOSE = "account-deletion";
const PROD_URL = `https://${PRODUCTION_PROJECT_REF}.supabase.co`;

/** Every condition satisfied. Individual tests break exactly one of them. */
function authorizedEnv(overrides = {}) {
  return {
    ORBIT_ENVIRONMENT: "production",
    [PURPOSE_VAR]: PURPOSE,
    [PROJECT_VAR]: PRODUCTION_PROJECT_REF,
    SUPABASE_URL: PROD_URL,
    SUPABASE_ANON_KEY: "anon",
    SUPABASE_SERVICE_ROLE_KEY: "service",
    ...overrides,
  };
}

const prodContext = { environment: "production", isVercel: true, vercelEnv: "production", isDeployed: true };

test("the fully authorized configuration is accepted", () => {
  const verdict = serviceRoleVerdict(PURPOSE, authorizedEnv(), prodContext);
  assert.equal(verdict.authorized, true, verdict.reason || "");
  assert.equal(verdict.projectRef, PRODUCTION_PROJECT_REF);
});

test("each condition alone is enough to refuse", () => {
  const broken = {
    "no purpose declared": { [PURPOSE_VAR]: "" },
    "a different purpose": { [PURPOSE_VAR]: "read-everything" },
    "a near-miss purpose": { [PURPOSE_VAR]: "account_deletion" },
    "a capitalised purpose": { [PURPOSE_VAR]: "Account-Deletion" },
    "no project pin": { [PROJECT_VAR]: "" },
    "a project pin that disagrees with the URL": { [PROJECT_VAR]: "someotherprojectref00" },
    "no Supabase URL": { SUPABASE_URL: "" },
    "a localhost URL": { SUPABASE_URL: "http://127.0.0.1:54321" },
    "an unparsable URL": { SUPABASE_URL: "not-a-url" },
    "a lookalike host": { SUPABASE_URL: `https://${PRODUCTION_PROJECT_REF}.supabase.co.evil.example` },
    "no service-role key": { SUPABASE_SERVICE_ROLE_KEY: "" },
  };
  for (const [label, override] of Object.entries(broken)) {
    const verdict = serviceRoleVerdict(PURPOSE, authorizedEnv(override), prodContext);
    assert.equal(verdict.authorized, false, `${label} should refuse`);
    assert.ok(verdict.reason, `${label} should say why`);
  }
});

test("a project pin naming some other real project is refused", () => {
  // Both values agree with each other but name a project that is not Orbit's.
  const other = "someotherprojectref00";
  const verdict = serviceRoleVerdict(PURPOSE, authorizedEnv({
    [PROJECT_VAR]: other,
    SUPABASE_URL: `https://${other}.supabase.co`,
  }), prodContext);
  assert.equal(verdict.authorized, false);
  assert.match(verdict.reason, /production project only/);
});

test("authorization is refused outside production", () => {
  for (const environment of ["local", "test", "preview", "", "unknown"]) {
    const verdict = serviceRoleVerdict(PURPOSE, authorizedEnv(), { environment });
    assert.equal(verdict.authorized, false, `${environment} must not be authorized`);
    assert.match(verdict.reason, /production only/);
  }
});

test("a Preview claiming to be production is refused", () => {
  // ORBIT_ENVIRONMENT can be set to anything; Vercel's own report cannot.
  const verdict = serviceRoleVerdict(PURPOSE, authorizedEnv(), {
    environment: "production", isVercel: true, vercelEnv: "preview",
  });
  assert.equal(verdict.authorized, false);
  assert.match(verdict.reason, /Vercel reports/);
});

test("an unknown purpose is never authorized, however configured", () => {
  const verdict = serviceRoleVerdict("read-every-users-birth-data",
    authorizedEnv({ [PURPOSE_VAR]: "read-every-users-birth-data" }), prodContext);
  assert.equal(verdict.authorized, false);
  // Two, since Dev Update 3.10 added "stripe-billing" for webhook writes.
  // This assertion is the tripwire that makes each widening a reviewed
  // decision, and it fired for that one exactly as intended.
  assert.deepEqual([...SERVICE_ROLE_PURPOSES], ["account-deletion", "stripe-billing"],
    "widening this set must be a deliberate change");
});

test("no refusal reason ever contains key material", () => {
  const secret = "super-secret-service-role-value";
  for (const override of [{}, { [PROJECT_VAR]: "wrong" }, { [PURPOSE_VAR]: "nope" }]) {
    const verdict = serviceRoleVerdict(PURPOSE,
      authorizedEnv({ ...override, SUPABASE_SERVICE_ROLE_KEY: secret }), prodContext);
    if (verdict.reason) assert.ok(!verdict.reason.includes(secret));
  }
  assert.ok(!serviceRoleWarnings(PURPOSE).join(" ").includes(secret));
});

// ── interaction with the shared-database guard ──────────────────────────────

test("Preview still refuses a service-role key absolutely", () => {
  // No authorization exists that lets a Preview hold this key. The variables
  // below are the production ones, set in full, and Preview ignores them.
  const verdict = sharedPreviewVerdict({
    ORBIT_ENVIRONMENT: "preview",
    ORBIT_PREVIEW_DATABASE_MODE: "shared-orbit",
    ORBIT_PREVIEW_PROJECT_REFS: PRODUCTION_PROJECT_REF,
    SUPABASE_URL: PROD_URL,
    SUPABASE_ANON_KEY: "anon",
    SUPABASE_SERVICE_ROLE_KEY: "service",
    [PURPOSE_VAR]: PURPOSE,
    [PROJECT_VAR]: PRODUCTION_PROJECT_REF,
  }, { environment: "preview", isVercel: true, vercelEnv: "preview" });
  assert.equal(verdict.approved, false);
  assert.match(verdict.reason, /service-role key must not be configured/);
});

test("Production accepts a shared database once the key is authorized", () => {
  const verdict = sharedProductionVerdict({
    ORBIT_ENVIRONMENT: "production",
    ORBIT_PRODUCTION_DATABASE_MODE: "shared-orbit",
    ORBIT_PRODUCTION_PROJECT_REFS: PRODUCTION_PROJECT_REF,
    SUPABASE_URL: PROD_URL,
    SUPABASE_ANON_KEY: "anon",
    SUPABASE_SERVICE_ROLE_KEY: "service",
    [PURPOSE_VAR]: PURPOSE,
    [PROJECT_VAR]: PRODUCTION_PROJECT_REF,
  }, prodContext);
  assert.equal(verdict.approved, true, verdict.reason || "");
});

test("Production still refuses an UNauthorized key, and says which condition failed", () => {
  const verdict = sharedProductionVerdict({
    ORBIT_ENVIRONMENT: "production",
    ORBIT_PRODUCTION_DATABASE_MODE: "shared-orbit",
    ORBIT_PRODUCTION_PROJECT_REFS: PRODUCTION_PROJECT_REF,
    SUPABASE_URL: PROD_URL,
    SUPABASE_ANON_KEY: "anon",
    SUPABASE_SERVICE_ROLE_KEY: "service",
    // No purpose, no pin.
  }, prodContext);
  assert.equal(verdict.approved, false);
  assert.match(verdict.reason, new RegExp(PURPOSE_VAR));
});

// ── the deletion path checks at the point of use ────────────────────────────

function withEnv(vars, run) {
  const saved = {};
  for (const [k, v] of Object.entries(vars)) {
    saved[k] = process.env[k];
    if (v === undefined) delete process.env[k]; else process.env[k] = v;
  }
  return Promise.resolve(run()).finally(() => {
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) delete process.env[k]; else process.env[k] = v;
    }
  });
}

test("production deletion refuses when the key is present but unauthorized", async () => {
  // The startup guard would normally have refused to boot at all. This proves
  // the operation does not rely on that having happened.
  await withEnv({
    ORBIT_ENVIRONMENT: "production",
    VERCEL: "1",
    VERCEL_ENV: "production",
    SUPABASE_URL: PROD_URL,
    SUPABASE_ANON_KEY: "anon",
    SUPABASE_SERVICE_ROLE_KEY: "service",
    [PURPOSE_VAR]: undefined,
    [PROJECT_VAR]: undefined,
  }, async () => {
    await assert.rejects(
      () => deleteAccount({
        accessToken: "token",
        confirmation: "DELETE",
        verifyUser: async () => ({ ok: true, user: { id: "u-1" } }),
        fetchImpl: async () => { throw new Error("must not be reached"); },
      }),
      (error) => {
        assert.ok(error instanceof AccountDeletionError);
        assert.equal(error.stage, "configuration");
        // The response must not describe the deployment's security posture.
        assert.doesNotMatch(error.message, new RegExp(PURPOSE_VAR));
        assert.doesNotMatch(error.message, /SUPABASE_/);
        return true;
      },
    );
  });
});

test("an unauthorized production deletion never reaches the network", async () => {
  let called = false;
  await withEnv({
    ORBIT_ENVIRONMENT: "production",
    VERCEL: "1",
    VERCEL_ENV: "production",
    SUPABASE_URL: PROD_URL,
    SUPABASE_ANON_KEY: "anon",
    SUPABASE_SERVICE_ROLE_KEY: "service",
    [PURPOSE_VAR]: undefined,
    [PROJECT_VAR]: undefined,
  }, async () => {
    await assert.rejects(() => deleteAccount({
      accessToken: "token",
      confirmation: "DELETE",
      verifyUser: async () => ({ ok: true, user: { id: "u-1" } }),
      fetchImpl: async () => { called = true; return { ok: true, status: 200, headers: { get: () => "0-0/0" } }; },
    }));
  });
  assert.equal(called, false, "no admin request may be issued without authorization");
});

// ── the key must never reach a browser ──────────────────────────────────────

test("no client-served file references the service-role key", () => {
  // The scan is over what is actually SERVED, not over a build artifact that
  // may not exist on this machine. public/ is copied verbatim to the CDN.
  const offenders = [];
  const walk = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) { walk(path); continue; }
      if (!/\.(js|html|css|json|webmanifest)$/.test(entry.name)) continue;
      const source = readFileSync(path, "utf8");
      if (/SUPABASE_SERVICE_ROLE_KEY|service_role/.test(source)) offenders.push(path);
    }
  };
  walk(new URL("../public", import.meta.url).pathname);
  assert.deepEqual(offenders, [],
    "a service-role key reference in a served file is one deploy away from a browser");
});

test("the export path holds no service-role reference either", () => {
  const source = readFileSync(new URL("../lib/account/export.js", import.meta.url), "utf8");
  assert.ok(!source.includes("SUPABASE_SERVICE_ROLE_KEY"));
});
