#!/usr/bin/env node
// Orbit Axis :: deployment readiness check (Update 4.0.3).
//
//   npm run deploy:check
//
// Read-only and offline. It does not deploy, push, migrate, create users,
// write to any database, contact production, or print a secret value. It only
// reads local files, resolves configuration, and asks git what it already
// knows. Every finding names what to do about it.
//
// Findings are graded:
//   BLOCKER       — a Preview or Production deploy will not work until fixed.
//   WARNING       — it will deploy, but something important is unverified.
//   INFORMATIONAL — context worth stating, no action required.
//
// Exit code 1 when any BLOCKER is present, so this can gate a workflow.
//
// Deliberate limitation: hosted Supabase is NEVER contacted. Anything about
// the hosted project is therefore reported as unverified rather than guessed.

import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { REPO_ROOT } from "../lib/local-llm/config.js";
import { resolveEnvironment, describeTarget } from "../lib/env/environment.js";
import { PRODUCTION_PROJECT_REF, APPROVED_PREVIEW_PROJECT_REFS, configuredPreviewRefs } from "../lib/env/known-targets.js";
import { sharedPreviewVerdict, sharedProductionVerdict, sharedPreviewWarnings } from "../lib/env/shared-preview.js";
import { ephemerisCapability } from "../lib/astro/ephemeris.js";
import { runtimeManifest, resolveRuntime } from "../lib/astro/runtime/resolve.js";
import { modelBundle } from "../lib/deploy/bundle.js";
import { checkoutPortability, inspectVercelLink, vercelArtifactsIgnored } from "../lib/deploy/vercel-link.js";
import { inspectVercelOutput, architectureWarning } from "../lib/deploy/vercel-output.js";
import { envFileStatus } from "../lib/local-llm/config.js";
import { auditSourcePosture } from "../lib/legal/source-posture.js";

const findings = [];
const add = (level, area, message, action = null) => findings.push({ level, area, message, action });
const blocker = (...a) => add("BLOCKER", ...a);
const warn = (...a) => add("WARNING", ...a);
const info = (...a) => add("INFORMATIONAL", ...a);

function git(args) {
  const r = spawnSync("git", args, { cwd: REPO_ROOT, encoding: "utf8" });
  return r.status === 0 ? String(r.stdout).trim() : null;
}

// ── 1. Environment and database classification ──────────────────────────────
const env = resolveEnvironment();
const envFiles = envFileStatus();
// Stated up front because Update 4.0.3 could not explain why this command
// behaved differently in a worktree. It is not a path bug: a worktree simply
// has no untracked .env.local, so it has no configuration to check.
info("environment", `Checkout root: ${envFiles.root}`);
info("environment", envFiles.loaded.length
  ? `Env file(s) loaded: ${envFiles.loaded.join(", ")}.`
  : `No env file found (looked for ${envFiles.searched.join(", ")}). Expected in a git worktree — .env.local is untracked and does not travel between checkouts.`);
if (!envFiles.loaded.length && (env.databaseTarget === "missing" || env.databaseTarget === "invalid")) {
  warn("environment", "This checkout has no database configuration at all.",
    "Nothing unsafe, but not a working setup either. Run `npm run env:check` for the full explanation, "
    + "or `npm run dev:local`, which pins the local Supabase stack without needing .env.local.");
}
info("environment", `Resolved environment: ${env.environment} (from ${env.environmentSource}).`);
info("environment", `Database target: ${describeTarget(env)}.`);
info("environment", env.isVercel
  ? `Running on Vercel (VERCEL_ENV=${env.vercelEnv || "unset"}).`
  : "Not running on Vercel — this is a local readiness check.");

if (!env.environmentValid) {
  blocker("environment", `Environment "${env.environment}" is not one Orbit recognises.`,
    "Set ORBIT_ENVIRONMENT to local, test, preview, or production.");
}

// Simulate the two deployed environments to prove how they would classify,
// without needing a deployment to exist. These are pure resolutions: nothing
// is contacted and no configuration is changed.
const simulated = {
  preview: resolveEnvironment({ overrides: { ORBIT_ENVIRONMENT: "preview", VERCEL: "1", VERCEL_ENV: "preview" } }),
  production: resolveEnvironment({ overrides: { ORBIT_ENVIRONMENT: "production", VERCEL: "1", VERCEL_ENV: "production" } }),
};
for (const [name, sim] of Object.entries(simulated)) {
  if (sim.allowsLocalLanguageProvider) {
    blocker("ollama", `Simulated ${name} still permits the local language provider.`,
      "This is an Orbit bug — a deployment must never be allowed to call Ollama.");
  }
  if (sim.allowsDisposableUsers || sim.allowsDevRoutes || sim.allowsSeedData || sim.allowsLocalMigrations) {
    blocker("safety", `Simulated ${name} still permits a development-only operation.`,
      "This is an Orbit bug — disposable users, seeds, migrations, and dev routes must be off on a deployment.");
  }
  if (!sim.requiresPersistentStorage) {
    blocker("persistence", `Simulated ${name} does not require durable storage.`,
      "This is an Orbit bug — a serverless instance must never treat memory as storage.");
  }
}
info("ollama", "Simulated Preview and Production both disable the Ollama provider before any network call.");
info("persistence", "Simulated Preview and Production both require durable Supabase storage.");

// ── 2. Preview Supabase project ─────────────────────────────────────────────
const approvedPreview = [...APPROVED_PREVIEW_PROJECT_REFS, ...configuredPreviewRefs()];

// The owner-approved shared-database Preview. Evaluated with a simulated
// Preview context, because this script runs locally: the question is whether
// the CONFIGURATION would be approved on Vercel, not whether it is approved
// here (it never is here — local is not preview).
const sharedVerdict = sharedPreviewVerdict(
  { ...process.env, ORBIT_ENVIRONMENT: "preview" },
  { environment: "preview", isVercel: true, vercelEnv: "preview" },
);

// Production has its own approval, read separately. A Preview being approved
// says nothing about Production, and reporting them together would hide exactly
// the confusion the split exists to prevent.
const productionVerdict = sharedProductionVerdict(
  { ...process.env, ORBIT_ENVIRONMENT: "production" },
  { environment: "production", isVercel: true, vercelEnv: "production" },
);

if (productionVerdict.approved) {
  info("supabase", `PRODUCTION is approved to share the Orbit database (project ${productionVerdict.projectRef}).`);
  warn("supabase", "The stable domain writes to the SAME database as Preview and local development.",
    "Anything created, edited, or deleted on https://orbit-axis-omega.vercel.app is real production data. "
    + "Do not test account deletion casually — it is permanent and there is no separate copy.");
  warn("supabase", "A dedicated staging database is required before any outside beta tester is invited.",
    "One project for every environment is acceptable while the owner is the only user, and stops being "
    + "acceptable the moment somebody else has an account.");
} else if (productionVerdict.requested && /service-role|database password/.test(productionVerdict.reason || "")
           && !process.env.VERCEL) {
  // Running locally, where .env.local legitimately holds a service-role key for
  // admin scripts. That key is NOT in the Vercel production environment, so this
  // is a property of the machine running the check rather than of the
  // deployment — and reporting it as a blocker would send someone hunting for a
  // problem that does not exist in production.
  info("supabase", "Production shared-database approval cannot be evaluated from this machine: "
    + "the local .env.local carries a service-role key, which production correctly refuses. "
    + "Verify production with https://orbit-axis-omega.vercel.app/api/v1/health instead.");
} else if (productionVerdict.requested) {
  blocker("supabase", `Production shared-database mode was requested but refused: ${productionVerdict.reason}.`,
    "Set ORBIT_ENVIRONMENT=production, ORBIT_PRODUCTION_DATABASE_MODE=shared-orbit, and "
    + "ORBIT_PRODUCTION_PROJECT_REFS=<the Orbit project reference> in the Vercel PRODUCTION environment.");
} else {
  info("supabase", "No production shared-database approval configured (production would refuse the Orbit project).");
}

// Preview approval variables must not be relied on by Production.
if (process.env.ORBIT_PREVIEW_DATABASE_MODE && !process.env.ORBIT_PRODUCTION_DATABASE_MODE) {
  info("supabase", "Preview approval is present without production approval — that is the intended separation.");
}

if (sharedVerdict.approved) {
  info("supabase", `Preview is approved to share the Orbit database (project ${sharedVerdict.projectRef}).`);
  // Approved is not the same as safe. This must never become a quiet "ok".
  for (const line of sharedPreviewWarnings()) warn("supabase", line);
  warn("supabase", "A dedicated staging database is required before any outside tester is invited.",
    "Sharing one project with Production is acceptable only for owner-controlled private Preview testing.");
} else if (sharedVerdict.requested) {
  blocker("supabase", `Shared-database Preview mode was requested but refused: ${sharedVerdict.reason}.`,
    "Set ORBIT_ENVIRONMENT=preview, ORBIT_PREVIEW_DATABASE_MODE=shared-orbit, "
    + "ORBIT_PREVIEW_PROJECT_REFS=<the Orbit project reference>, and a SUPABASE_URL whose "
    + "project reference matches. All four must agree.");
} else if (approvedPreview.length === 0) {
  blocker("supabase", "No approved Preview Supabase project exists.",
    "Create a separate, disposable Supabase project for Preview, then add its project reference to "
    + "ORBIT_PREVIEW_PROJECT_REFS (or to APPROVED_PREVIEW_PROJECT_REFS in lib/env/known-targets.js). "
    + "Preview must not share the production database unless you explicitly decide otherwise.");
} else {
  info("supabase", `Approved Preview project reference(s): ${approvedPreview.join(", ")}.`);
}
info("supabase", `Known production project reference: ${PRODUCTION_PROJECT_REF} (public identifier, not a secret).`);

// ── 3. Hosted migration status ──────────────────────────────────────────────
// The hosted project is never contacted, so this reports what exists locally
// and states plainly that the remote side is unverified.
const migrationsDir = join(REPO_ROOT, "supabase", "migrations");
const migrations = existsSync(migrationsDir)
  ? readdirSync(migrationsDir).filter((f) => f.endsWith(".sql")).sort()
  : [];
info("supabase", `${migrations.length} local migration file(s) found.`);
// This script never contacts the hosted project. Instead it reads a RECORD of
// verification that was actually performed — a claim with a date and a method,
// which is weaker than a live check and is reported as such. If the hosted
// schema drifts, the record becomes wrong, which is the cost of recording a
// verification rather than repeating it every run.
const verificationPath = join(REPO_ROOT, "docs", "deployment", "hosted-verification.json");
let hostedRecord = null;
if (existsSync(verificationPath)) {
  try { hostedRecord = JSON.parse(readFileSync(verificationPath, "utf8")); }
  catch { hostedRecord = null; }
}
const recordedMigrations = new Set((hostedRecord?.migrationsApplied || []).map((m) => m.file));

const askMigration = migrations.find((m) => m.includes("ask_orbit"));
if (askMigration && !recordedMigrations.has(askMigration)) {
  blocker("supabase", `The Ask Orbit migration (${askMigration}) is not known to be applied to hosted Supabase.`,
    "Ask Orbit conversation history depends on the ask_conversations and ask_messages tables. "
    + "Until the owner applies this migration to the hosted project, Ask Orbit answers will generate "
    + "but will not save. Review docs/deployment/hosted-migration-checklist.md and apply it with explicit approval.");
} else if (askMigration) {
  const record = hostedRecord.migrationsApplied.find((m) => m.file === askMigration);
  info("supabase", `${askMigration} recorded as applied on ${record.appliedAt} (${record.verifiedBy}).`);
}

const rls = hostedRecord?.rlsVerification;
if (rls && rls.checksPassed === rls.checksTotal && rls.checksTotal > 0) {
  info("supabase", `Hosted RLS verified ${rls.verifiedAt}: ${rls.checksPassed}/${rls.checksTotal} checks passed with two live users.`);
  warn("supabase", "Hosted schema and RLS status comes from a RECORDED verification, not a live check.",
    `Recorded ${rls.verifiedAt}. Re-verify after any hosted schema change — this file can become stale without anything failing.`);
} else {
  warn("supabase", "Hosted Supabase schema, RLS policies, indexes, and grants are UNVERIFIED.",
    "This check never contacts the hosted project. Verify them from the Supabase dashboard before Production.");
}

// ── 3b. Branch-scoped Preview variables ─────────────────────────────────────
// Vercel Preview variables can be scoped to a single git branch. That is the
// safer choice here — it stops a stray preview branch from reaching the shared
// production database — but it has a trap that has already cost one broken
// deployment: create a new branch, deploy it, and the function starts with NO
// configuration and refuses to boot with a 503 that says nothing useful in the
// browser.
//
// This cannot read Vercel's variable scoping (that needs the API and a token),
// so it does the next best thing: it reminds you, naming the branch, whenever
// the current branch is not one that has been recorded as configured.
const previewBranchesPath = join(REPO_ROOT, "docs", "deployment", "preview-branches.json");
let configuredBranches = [];
if (existsSync(previewBranchesPath)) {
  try { configuredBranches = JSON.parse(readFileSync(previewBranchesPath, "utf8")).branches || []; }
  catch { configuredBranches = []; }
}
const currentBranch = git(["rev-parse", "--abbrev-ref", "HEAD"]);
if (currentBranch && currentBranch !== "HEAD") {
  if (configuredBranches.includes(currentBranch)) {
    info("vercel", `Preview variables are recorded as configured for branch "${currentBranch}".`);
  } else {
    warn("vercel", `Branch "${currentBranch}" is not recorded as having Preview variables configured.`,
      "Vercel Preview variables here are scoped per branch. Deploying a branch without them starts the "
      + "function with no database configuration, and it answers 503 for every request. Add them with "
      + `\`vercel env add <NAME> preview ${currentBranch}\` and record the branch in `
      + "docs/deployment/preview-branches.json.");
  }
}

// ── 4. Environment variable names (names only — never values) ───────────────
const REQUIRED_ON_VERCEL = ["SUPABASE_URL", "SUPABASE_ANON_KEY", "ORBIT_ENVIRONMENT"];
const OPTIONAL_ON_VERCEL = ["GEOAPIFY_API_KEY", "ORBIT_PREVIEW_PROJECT_REFS", "ORBIT_ASK_USE_MODEL"];
const LOCAL_ONLY = ["SUPABASE_SERVICE_ROLE_KEY", "ORBIT_OLLAMA_BASE_URL", "ORBIT_LOCAL_MODEL", "SUPABASE_ACCESS_TOKEN", "SUPABASE_OWNER_ID"];

if (env.isVercel) {
  for (const name of REQUIRED_ON_VERCEL) {
    if (!process.env[name]) {
      blocker("environment", `${name} is not set in this Vercel environment.`, `Add ${name} in the Vercel project's Environment Variables.`);
    }
  }
} else {
  const present = REQUIRED_ON_VERCEL.filter((n) => process.env[n]);
  info("environment", `Locally present of the Vercel-required names: ${present.length ? present.join(", ") : "none"}.`);
  warn("environment", `Vercel Preview and Production must each define: ${REQUIRED_ON_VERCEL.join(", ")}.`,
    "Set them per-environment in the Vercel dashboard. This check cannot see the Vercel dashboard.");
}
info("environment", `Never set on Vercel unless a specific server-side need is documented: ${LOCAL_ONLY.join(", ")}.`);
info("environment", `Optional on Vercel: ${OPTIONAL_ON_VERCEL.join(", ")}.`);

if (env.isDeployed && env.hasServiceRoleKey) {
  blocker("security", "A service-role key is present in a deployed environment.",
    "Orbit's request paths use the signed-in user's own token and rely on row-level security. "
    + "Remove SUPABASE_SERVICE_ROLE_KEY from this Vercel environment unless a documented server-side "
    + "operation genuinely requires bypassing RLS.");
}

// ── 5. Vercel wiring: config, handler, static assets ────────────────────────
for (const [file, why] of [
  ["vercel.json", "Vercel routing configuration"],
  ["api/index.js", "the Vercel function entry point"],
  ["lib/server/create-app.js", "the shared request handler"],
  [".vercelignore", "the upload exclusion list"],
  ["public/index.html", "the frontend document"],
]) {
  if (!existsSync(join(REPO_ROOT, file))) {
    blocker("vercel", `${file} is missing — ${why}.`, `Restore ${file}.`);
  }
}

if (existsSync(join(REPO_ROOT, "vercel.json"))) {
  try {
    const cfg = JSON.parse(readFileSync(join(REPO_ROOT, "vercel.json"), "utf8"));
    if (cfg.framework !== null) warn("vercel", `vercel.json sets framework=${JSON.stringify(cfg.framework)}; Orbit expects null ("Other").`);
    if (cfg.outputDirectory !== "public") warn("vercel", `vercel.json outputDirectory is ${JSON.stringify(cfg.outputDirectory)}; Orbit serves static files from "public".`);
    const raw = readFileSync(join(REPO_ROOT, "vercel.json"), "utf8");
    if (/https?:\/\/(?!openapi\.vercel\.sh)/.test(raw)) {
      warn("vercel", "vercel.json appears to contain a hardcoded URL.", "Deployment URLs must not be hardcoded.");
    } else {
      info("vercel", "vercel.json contains no hardcoded deployment URL and no secret.");
    }
  } catch {
    blocker("vercel", "vercel.json is not valid JSON.", "Fix the syntax.");
  }
}

// The handler must be importable without side effects. Importing it here is
// itself the check: if importing bound a port or contacted a database, this
// script would hang or fail.
try {
  await import("../lib/server/create-app.js");
  info("vercel", "The Vercel handler module imports cleanly with no side effects.");
} catch (error) {
  blocker("vercel", `The Vercel handler module failed to import: ${error.message}`, "Fix the import error before deploying.");
}

// ── 6. Orbit Core runtime portability (rebuilt in Update 4.0.4) ─────────────
// Update 4.0.3 found that the only bundled executable was macOS/arm64 and
// blocked on it. That blocker clears only when a Linux x64 runtime genuinely
// exists, matches its checksum, passes a real calculation, and is actually
// packaged into the deployed function — four separate conditions, checked
// separately below so a partial fix cannot look like a complete one.
const manifest = runtimeManifest();
info("runtime", `Swiss Ephemeris ${manifest.swissEphemerisVersion}; declared runtimes: ${Object.keys(manifest.runtimes).join(", ")}.`);

const ephe = ephemerisCapability({ fresh: true, verifyChecksum: true });
if (ephe.ok) {
  info("runtime", `This machine (${ephe.runtime}): ${ephe.detail}`);
} else {
  blocker("runtime", `Astronomy engine unavailable on this machine (${ephe.runtime}): ${ephe.detail}`,
    "Every chart, current-sky, fortune, and Ask Orbit answer depends on it. Run npm run orbit:runtime:check.");
}

// The deployment target, which is not this machine. Resolved for linux-x64
// explicitly rather than inferred from whatever host happens to run the check.
const linux = resolveRuntime({ platform: "linux", arch: "x64", verifyChecksum: true });
if (!linux.ok) {
  blocker("runtime", `No usable linux-x64 Swiss Ephemeris runtime: ${linux.detail}`,
    "Vercel functions run Linux x64. Without this, every astrology feature fails on a deployment. "
    + "Build it from official Astrodienst source and record its checksum in "
    + "vendor/orbit-axis-engine/src/adapters/swiss-ephemeris/manifest.json.");
} else {
  info("runtime", `linux-x64 runtime present and checksum-verified (${linux.linkage}ally linked, ${manifest.runtimes["linux-x64"].version}).`);
  if (linux.linkage !== "static") {
    warn("runtime", "The linux-x64 executable is dynamically linked.",
      "It may fail on a host with a different glibc than the one it was built against. A static build avoids this entirely.");
  }
}

// Packaging: present in the repository is not the same as present in the
// deployed function. Vercel traces imports, and this binary is opened by path,
// so it only ships because vercel.json force-includes it.
const bundle = modelBundle(REPO_ROOT);
if (bundle.missing.length) {
  for (const missing of bundle.missing) {
    blocker("packaging", `${missing} would NOT be included in the deployed function.`,
      "Check vercel.json \"includeFiles\" and .vercelignore.");
  }
} else {
  info("packaging", `Deployment bundle models ${bundle.uploadedCount} file(s), ${(bundle.uploadedBytes / 1048576).toFixed(1)} MB; the linux-x64 executable, the .se1 data, and the runtime manifest are all included.`);
}
for (const leak of bundle.leaked) {
  blocker("security", `${leak.path} would be uploaded to Vercel — ${leak.why}.`, "Add it to .vercelignore.");
}
if (!bundle.leaked.length) info("security", "Nothing forbidden (env files, vault, Supabase state, tests, macOS binary) reaches the deployment bundle.");

// Linux execution evidence. This check runs on whatever machine invokes it, so
// it can confirm the artifact and the packaging but NOT that Linux execution
// was witnessed. That evidence comes from running this same command, and
// orbit:core:smoke, inside a Linux x64 container — recorded in the update note.
if (process.platform === "linux" && process.arch === "x64") {
  info("runtime", "Running ON linux-x64: the checks above are direct evidence for the deployment target.");
} else {
  info("runtime", `Running on ${process.platform}-${process.arch}. Linux execution is verified separately by running `
    + "`npm run orbit:runtime:check` and `npm run orbit:core:smoke` inside a linux/amd64 container. "
    + "See docs/deployment/orbit-core-runtime.md for the exact commands and recorded results.");
}
// ── 6b. AGPL licensing posture and the source offer ────────────────────────
// Orbit uses the Swiss Ephemeris under its AGPL option (recorded in
// docs/deployment/swiss-ephemeris-licensing.md). This verifies the repository
// artifacts implementing its source offer and is deliberately NOT a legal
// opinion — see the note below.
const posture = auditSourcePosture({
  root: REPO_ROOT, env: process.env, manifest,
  requireSourceUrls: Boolean(env.isDeployed || env.isVercel),
});
for (const finding of posture.findings) {
  if (finding.level === "BLOCKER") blocker("licensing", finding.message, finding.action);
  else warn("licensing", finding.message, finding.action);
}
if (!posture.findings.length) {
  info("licensing", "AGPL source offer intact: licence files, upstream notices, /source page and both "
    + "repository links are present and consistent with the recorded AGPL option.");
}
info("licensing", "These are source-availability and posture checks, NOT a legal compliance "
  + "certification. No script can determine licence compliance, and this one does not try.");

// ── 7. Vercel project link (added after the Update 4.0.4.1 incident) ────────
// `npx vercel link` run in this repository attached it to `the-lorehouse` — a
// different application — because no Orbit project existed to choose. Vercel
// then used that project's Vite preset, looked for an output directory named
// `dist`, and failed. Nothing inside Orbit could see the mismatch. Now it can.
//
// Only the project NAME is inspected. Project and org ids are never read.
const portable = checkoutPortability(REPO_ROOT);
if (!portable.ok) {
  blocker("checkout", portable.detail,
    "This source tree cannot produce a correct Vercel build. Run Vercel commands from the checkout "
    + "that contains the Update 4.0.4 portable runtime, not from an older branch.");
} else {
  info("checkout", portable.detail);
}

const link = inspectVercelLink({ root: REPO_ROOT });
switch (link.status) {
  case "foreign":
    blocker("vercel-link", `This checkout is linked to the Lorehouse Vercel project.`,
      `${link.detail} Orbit must never build against it: its framework preset expects a different `
      + `output directory, and pulling its settings downloads another application's environment into `
      + `this working tree. Fix: rm -rf .vercel, then link only to an approved Orbit project `
      + `(${link.approved.join(", ")}).`);
    break;
  case "unapproved":
    blocker("vercel-link", link.detail,
      `Approved Orbit project name(s): ${link.approved.join(", ")}. If this project really is Orbit's, `
      + "add its name to ORBIT_VERCEL_PROJECTS or to APPROVED_VERCEL_PROJECTS in lib/deploy/vercel-link.js.");
    break;
  case "malformed":
    blocker("vercel-link", link.detail,
      "Remove the local link and recreate it: rm -rf .vercel && npx vercel link");
    break;
  case "absent":
    blocker("vercel-build", "This checkout is not linked to a Vercel project, so `npx vercel build` cannot run.",
      "Owner action requiring your Vercel account. An Orbit project must exist first — do NOT link to "
      + "an existing unrelated project. Until a real Vercel build runs, it is UNVERIFIED; `npm run build` "
      + "is a local verification step, not a substitute.");
    break;
  default:
    info("vercel-link", link.detail);
    if (link.context?.outputDirectory && link.context.outputDirectory !== "public") {
      warn("vercel-link", `The linked project's output directory is "${link.context.outputDirectory}"; Orbit serves static files from "public".`,
        "vercel.json sets outputDirectory correctly, but the dashboard setting should agree.");
    }
    break;
}

// Build output, only meaningful once the link is correct. Read from the REAL
// output rather than modelled — Update 4.0.4.2 found the model and the build
// disagreeing about the function's contents, and the build was right.
const inspection = inspectVercelOutput(REPO_ROOT);
if (link.status === "ok") {
  if (!inspection.built) {
    warn("vercel-build", "The project is linked but no local Vercel build output exists.",
      "Run `npx vercel build` and re-run this check.");
  } else {
    info("vercel-build", `Local Vercel build output present: ${inspection.physicalCount} file(s) in the function `
      + `(${(inspection.functionBytes / 1048576).toFixed(1)} MB) plus ${inspection.mappedCount} mapped, `
      + `${inspection.staticCount} static file(s), runtime ${inspection.runtime}, maxDuration ${inspection.maxDuration}s.`);

    for (const missing of inspection.missing) {
      blocker("vercel-build", `The built function cannot reach ${missing}.`,
        "Check `includeFiles` in vercel.json — files opened by path are invisible to Vercel's import tracing.");
    }
    for (const bad of inspection.forbidden) {
      blocker("security", `The built function contains ${bad.path} — ${bad.why}.`,
        "Add an `excludeFiles` pattern in vercel.json. Note that .vercelignore does NOT affect function contents.");
    }
    if (inspection.ok) {
      info("vercel-build", "The built function reaches the linux-x64 executable, all three .se1 data files, and the "
        + "runtime manifest, and contains nothing forbidden.");
    }

    const archWarning = architectureWarning(inspection);
    if (archWarning) warn("vercel-build", archWarning, "Never deploy this output with --prebuilt.");
  }
} else if (inspection.built) {
  // Output from a build against the wrong project must not be mistaken for
  // evidence that Orbit builds correctly.
  blocker("vercel-build", "Local Vercel build output exists but the project link is not an approved Orbit project.",
    "That output was produced against the wrong project. Delete it with rm -rf .vercel and rebuild once "
    + "correctly linked.");
}

// Downloaded Vercel files must stay untracked.
const ignoreCheck = vercelArtifactsIgnored((p) => {
  const r = spawnSync("git", ["check-ignore", "-q", p], { cwd: REPO_ROOT });
  return r.status === 0;
});
if (!ignoreCheck.ok) {
  blocker("security", ignoreCheck.detail,
    "Vercel writes another project's environment values into .vercel/. They must never be committable.");
} else {
  info("security", ignoreCheck.detail);
}

// ── 8. Canonical Obsidian vault synchronisation ─────────────────────────────
// The repository carries a mirror of the Orbit App notes. The canonical vault
// lives outside the repository. Update 4.0.3 updated only the mirror, which is
// how documentation quietly drifts, so the gap is now reported.
// No default path. A hardcoded fallback would be one contributor's directory
// layout baked into a public repository, and it would silently "work" for
// nobody else while looking configured.
const VAULT_PATH = process.env.ORBIT_VAULT_PATH || "";
const mirrorDir = join(REPO_ROOT, "07 Orbit App");
if (!existsSync(mirrorDir)) {
  info("vault", "This checkout has no repository vault mirror.");
} else if (!existsSync(VAULT_PATH)) {
  warn("vault", `The canonical Obsidian vault was not found at ${VAULT_PATH}.`,
    "Set ORBIT_VAULT_PATH if it lives elsewhere. Vault synchronisation cannot be checked without it.");
} else {
  const listMd = (dir, base = dir, out = []) => {
    for (const name of readdirSync(dir, { withFileTypes: true })) {
      if (name.name.startsWith(".")) continue;
      const full = join(dir, name.name);
      if (name.isDirectory()) listMd(full, base, out);
      else if (name.name.endsWith(".md")) out.push(full.slice(base.length + 1));
    }
    return out;
  };
  const mirror = listMd(mirrorDir);
  const canonicalDir = join(VAULT_PATH, "07 Orbit App");
  const canonical = existsSync(canonicalDir) ? listMd(canonicalDir) : [];
  const onlyInMirror = mirror.filter((f) => !canonical.includes(f));
  if (onlyInMirror.length) {
    warn("vault", `${onlyInMirror.length} note(s) exist in the repository mirror but not in the canonical vault: ${onlyInMirror.slice(0, 5).join(", ")}${onlyInMirror.length > 5 ? ", …" : ""}.`,
      "The canonical vault is the source of truth for project documentation. Copy them across, or run the vault sync tooling.");
  } else {
    info("vault", `Repository mirror (${mirror.length} note(s)) is fully represented in the canonical vault.`);
  }
}

// ── 9. Git deployment state ─────────────────────────────────────────────────
const branch = git(["rev-parse", "--abbrev-ref", "HEAD"]);
info("git", `Current branch: ${branch || "unknown"}.`);
const dirty = git(["status", "--porcelain"]);
if (dirty) warn("git", "The working tree has uncommitted changes.", "Commit them before deploying — Vercel builds a commit, not your disk.");
else info("git", "The working tree is clean.");

const upstream = git(["rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{u}"]);
if (!upstream) {
  blocker("git", `Branch "${branch}" has not been pushed to a remote.`,
    `Vercel can only build a commit that exists on GitHub. Push it: git push -u origin ${branch}`);
} else {
  const counts = git(["rev-list", "--left-right", "--count", `${upstream}...HEAD`]);
  const [behind, ahead] = String(counts || "0\t0").split(/\s+/).map(Number);
  if (ahead > 0) {
    blocker("git", `Branch "${branch}" is ${ahead} commit(s) ahead of ${upstream}.`,
      `Vercel would build an older commit. Push first: git push origin ${branch}`);
  } else {
    info("git", `Branch "${branch}" is in sync with ${upstream} (behind ${behind}).`);
  }
}

// ── Report ──────────────────────────────────────────────────────────────────
const order = ["BLOCKER", "WARNING", "INFORMATIONAL"];
console.log("Orbit Axis deployment readiness");
console.log("");
console.log("Read-only. No deploy, no push, no migration, no database write, no secret printed.");
console.log("");

for (const level of order) {
  const items = findings.filter((f) => f.level === level);
  if (!items.length) continue;
  console.log(`${level} (${items.length})`);
  console.log("");
  for (const item of items) {
    console.log(`  [${item.area}] ${item.message}`);
    if (item.action) {
      for (const line of wrap(item.action, 88)) console.log(`      → ${line}`);
    }
  }
  console.log("");
}

function wrap(text, width) {
  const words = String(text).split(/\s+/);
  const lines = [];
  let line = "";
  for (const word of words) {
    if ((line + " " + word).trim().length > width) { lines.push(line.trim()); line = word; }
    else line = `${line} ${word}`;
  }
  if (line.trim()) lines.push(line.trim());
  return lines;
}

const blockers = findings.filter((f) => f.level === "BLOCKER").length;
const warnings = findings.filter((f) => f.level === "WARNING").length;
console.log("─".repeat(72));
console.log(`${blockers} blocker(s), ${warnings} warning(s).`);
if (blockers) {
  console.log("");
  console.log("NOT READY to deploy. Resolve every blocker above first.");
  process.exit(1);
}
console.log("");
console.log("No blockers found. Review the warnings before Production.");
