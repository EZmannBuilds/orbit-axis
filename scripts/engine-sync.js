#!/usr/bin/env node
// Orbit Axis :: vendored engine sync and drift detection (Update 5.0).
//
//   npm run engine:sync    # copy the engine repository into vendor/
//   npm run engine:check   # fail if vendor/ has drifted from the engine repo
//
// WHY VENDORING AT ALL
//
// Orbit consumes Orbit Axis Engine as a package. Until the engine is published,
// there is no registry or public Git URL to depend on, and the alternatives are
// worse:
//
//   - a `file:` dependency pointing outside the repository bakes an absolute
//     path like /Users/... into the install, which cannot work on Vercel
//   - a Git submodule is not fetched by Vercel's build and adds a second
//     checkout step for every contributor
//
// So the engine's published surface is copied into vendor/ and depended on with
// a RELATIVE `file:vendor/orbit-axis-engine`. That is reproducible under
// `npm ci`, contains no absolute path, and — crucially — the Swiss Ephemeris
// executable and .se1 data are opened BY PATH, so they must physically exist in
// the upload for Vercel's function to find them.
//
// The cost of vendoring is drift: two copies that can silently disagree. This
// script is the answer to that, and test/engine-vendor.test.js runs the same
// check — fully wherever the engine repository is checked out (or
// ORBIT_ENGINE_PATH points at one), and structurally everywhere else, so a
// missing or version-skewed vendor copy still fails CI.
//
// TEMPORARY. Once the engine is published this is deleted and the dependency
// becomes: "@ezmannbuilds/orbit-axis-engine": "github:EZmannBuilds/orbit-axis-engine#v0.1.0"

import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync, statSync, mkdirSync, copyFileSync, rmSync } from "node:fs";
import { join, relative, dirname, sep } from "node:path";
import { REPO_ROOT } from "../lib/local-llm/config.js";

export const VENDOR_DIR = join(REPO_ROOT, "vendor", "orbit-axis-engine");

// Where the engine repository lives during development. Configurable because
// not every contributor will check it out beside this one, and NEVER used at
// runtime or in a build — only by these two commands.
export function engineSourceDir(env = process.env) {
  // "Beside this repository" means one level up — ~/Projects/orbit and
  // ~/Projects/orbit-axis-engine. The old default climbed three levels and
  // landed outside anyone's checkout, so the check silently skipped on every
  // machine that had not set ORBIT_ENGINE_PATH.
  return env.ORBIT_ENGINE_PATH || join(REPO_ROOT, "..", "orbit-axis-engine");
}

// The engine's publishable surface. Tests, dev scripts, and git metadata are
// deliberately excluded: the application consumes the package, not the repo.
// CLAUDE.md is agent guidance for people working IN the engine repository; the
// application consumes the package, so it has no business in vendor/.
const EXCLUDED_TOP_LEVEL = new Set([".git", "node_modules", "tests", "scripts", ".gitignore", "CLAUDE.md"]);

function walk(dir, base, out = []) {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (dir === base && EXCLUDED_TOP_LEVEL.has(name)) continue;
    if (name === "node_modules" || name === ".git") continue;
    const st = statSync(full);
    if (st.isDirectory()) walk(full, base, out);
    else out.push(relative(base, full).split(sep).join("/"));
  }
  return out;
}

function digest(path) {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

/**
 * Compare the vendored copy against the engine repository.
 * Returns a structured verdict; never throws when the source is simply absent,
 * because a contributor without the engine checked out should still be able to
 * build and test the application.
 */
export function compareVendorToSource({ source = engineSourceDir(), vendor = VENDOR_DIR } = {}) {
  if (!existsSync(vendor)) {
    return { ok: false, code: "vendor_missing", detail: "vendor/orbit-axis-engine is missing. Run: npm run engine:sync" };
  }
  if (!existsSync(source)) {
    return {
      ok: true, code: "source_unavailable", skipped: true,
      detail: `The engine repository is not checked out at ${source}, so drift cannot be checked here. `
        + "The vendored copy is used as-is. Set ORBIT_ENGINE_PATH to enable this check.",
    };
  }

  const sourceFiles = new Set(walk(source, source));
  const vendorFiles = new Set(walk(vendor, vendor).filter((f) => f !== "VENDORED.md"));

  const missing = [...sourceFiles].filter((f) => !vendorFiles.has(f)).sort();
  const extra = [...vendorFiles].filter((f) => !sourceFiles.has(f)).sort();
  const changed = [...sourceFiles]
    .filter((f) => vendorFiles.has(f))
    .filter((f) => digest(join(source, f)) !== digest(join(vendor, f)))
    .sort();

  const ok = missing.length === 0 && extra.length === 0 && changed.length === 0;
  return {
    ok,
    code: ok ? "in_sync" : "drift",
    missing, extra, changed,
    fileCount: sourceFiles.size,
    detail: ok
      ? `vendor/orbit-axis-engine matches the engine repository (${sourceFiles.size} files).`
      : `vendor/orbit-axis-engine has drifted: ${missing.length} missing, ${extra.length} extra, ${changed.length} changed. Run: npm run engine:sync`,
  };
}

function sync({ source = engineSourceDir(), vendor = VENDOR_DIR } = {}) {
  if (!existsSync(source)) {
    console.error(`Engine repository not found at ${source}.`);
    console.error("Set ORBIT_ENGINE_PATH to its location, or clone it beside this repository.");
    process.exit(1);
  }
  rmSync(vendor, { recursive: true, force: true });
  mkdirSync(vendor, { recursive: true });
  const files = walk(source, source);
  for (const rel of files) {
    const dest = join(vendor, rel);
    mkdirSync(dirname(dest), { recursive: true });
    copyFileSync(join(source, rel), dest);
  }
  console.log(`Synced ${files.length} file(s) from ${source} into vendor/orbit-axis-engine.`);
  console.log("Re-run `npm ci` if package.json changed, then `npm run test:local`.");
}

// ── CLI ─────────────────────────────────────────────────────────────────────
if (import.meta.url === `file://${process.argv[1]}`) {
  const checkOnly = process.argv.includes("--check");
  if (!checkOnly) {
    sync();
  } else {
    const verdict = compareVendorToSource();
    console.log(verdict.detail);
    if (verdict.changed?.length) for (const f of verdict.changed) console.log(`  changed: ${f}`);
    if (verdict.missing?.length) for (const f of verdict.missing) console.log(`  missing: ${f}`);
    if (verdict.extra?.length) for (const f of verdict.extra) console.log(`  extra:   ${f}`);
    process.exit(verdict.ok ? 0 : 1);
  }
}
