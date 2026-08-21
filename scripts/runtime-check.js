#!/usr/bin/env node
// Orbit Core :: runtime verification (Update 4.0.4).
//
//   npm run orbit:runtime:check
//   npm run orbit:runtime:check -- --print-checksums   # regenerate manifest hashes
//   npm run orbit:runtime:check -- --json              # machine-readable
//
// Answers one question for the machine it is run on: can Orbit actually
// calculate astrology here, and is the runtime the one we think it is?
//
// This is the command to run inside a Linux container to prove portability.
// It contacts nothing — no Supabase, no Ollama, no Vercel, no network — and it
// prints no secret. Exit code 0 means this machine can do astrology.

import { existsSync, statSync } from "node:fs";
import { join } from "node:path";
import {
  runtimeManifest, resolveRuntime, runtimeKey, checkEphemerisData,
  sha256File, ASTRO_ROOT,
} from "../lib/astro/runtime/resolve.js";
import { ephemerisCapability, positionsAtUT, PLANETS } from "../lib/astro/ephemeris.js";

const args = process.argv.slice(2);
const asJson = args.includes("--json");
const printChecksums = args.includes("--print-checksums");

const manifest = runtimeManifest();
const key = runtimeKey();
const checks = [];
const record = (name, ok, detail) => { checks.push({ name, ok, detail }); return ok; };

// ── 1. Platform ─────────────────────────────────────────────────────────────
const entry = manifest.runtimes[key];
record("platform", Boolean(entry?.supported),
  entry?.supported
    ? `${key} is a supported Orbit Core runtime.`
    : `${key} is NOT a supported Orbit Core runtime. Supported: ${Object.keys(manifest.runtimes).filter((k) => manifest.runtimes[k].supported).join(", ")}.`);

// ── 2. Manifest integrity ───────────────────────────────────────────────────
let manifestOk = true;
const manifestProblems = [];
for (const [k, r] of Object.entries(manifest.runtimes)) {
  for (const field of ["os", "arch", "executable", "version", "sha256", "supported"]) {
    if (r[field] === undefined) { manifestOk = false; manifestProblems.push(`${k} is missing "${field}"`); }
  }
  if (typeof r.sha256 === "string" && !/^[0-9a-f]{64}$/.test(r.sha256)) {
    manifestOk = false; manifestProblems.push(`${k} has a sha256 that is not a real 64-hex digest`);
  }
  if (/placeholder|todo|xxx|verified-checksum/i.test(String(r.sha256))) {
    manifestOk = false; manifestProblems.push(`${k} has a PLACEHOLDER checksum`);
  }
}
record("manifest", manifestOk,
  manifestOk
    ? `${Object.keys(manifest.runtimes).length} runtime(s) declared, Swiss Ephemeris ${manifest.swissEphemerisVersion}, all checksums are real digests.`
    : manifestProblems.join("; "));

// ── 3. Every declared runtime is present on disk ────────────────────────────
// Checked for ALL platforms, not just this one, so a packaging mistake that
// dropped the Linux binary is caught while developing on a Mac.
for (const [k, r] of Object.entries(manifest.runtimes)) {
  const path = join(ASTRO_ROOT, r.executable);
  const present = existsSync(path) && statSync(path).isFile();
  const isCurrent = k === key;
  // A non-current runtime being absent is a WARNING on this machine but a
  // blocker for the platform it targets; deploy-check treats it accordingly.
  record(`artifact:${k}`, present,
    present ? `${r.executable} present (${statSync(path).size} bytes).`
      : `${r.executable} is MISSING${isCurrent ? " — this machine cannot calculate." : ""}`);
}

// ── 4. Resolution, permission, checksum for THIS platform ───────────────────
const resolved = resolveRuntime({ verifyChecksum: true });
record("resolution", resolved.ok, resolved.detail);
if (resolved.ok) {
  record("checksum", resolved.checksumVerified === true,
    `Executable matches its recorded sha256 (${resolved.expectedSha256.slice(0, 16)}…).`);
}

// ── 5. Ephemeris data ───────────────────────────────────────────────────────
const data = checkEphemerisData(manifest, { verifyChecksums: true });
record("ephemeris-data", data.ok,
  data.ok ? `${Object.keys(manifest.dataFiles).length} .se1 file(s) present and matching their checksums.` : data.detail);

// ── 6. Capability + version ─────────────────────────────────────────────────
const cap = ephemerisCapability({ fresh: true });
record("capability", cap.ok, cap.detail);

// ── 7. Smoke calculation + parser compatibility ─────────────────────────────
// A fixed, non-sensitive synthetic instant with a known answer. This proves the
// executable runs AND that its output still parses into Orbit's structures —
// a binary that runs but whose format drifted would otherwise pass silently.
const SMOKE = { year: 2000, month: 1, day: 1, hour: 12, minute: 0, second: 0, lat: 51.4769, lon: 0.0, withHouses: true };
const EXPECTED_SUN_LON = 280.3689187;      // degrees, verified on darwin-arm64
const SMOKE_TOLERANCE_DEG = 1e-4;          // 0.36 arcsec — see docs/deployment/orbit-core-runtime.md

let smoke = null;
if (resolved.ok) {
  try {
    const t0 = Date.now();
    const p = positionsAtUT(SMOKE);
    const ms = Date.now() - t0;
    const sunLon = p.planets?.Sun?.longitude;
    const planetsFound = Object.keys(p.planets || {}).length;
    const housesFound = (p.houses || []).length;
    const drift = typeof sunLon === "number" ? Math.abs(sunLon - EXPECTED_SUN_LON) : Infinity;

    const structureOk = planetsFound === PLANETS.length && housesFound === 12 && p.ascendant && p.midheaven;
    const valueOk = drift <= SMOKE_TOLERANCE_DEG;
    smoke = { ms, sunLon, drift, planetsFound, housesFound };

    record("smoke-structure", Boolean(structureOk),
      structureOk
        ? `${planetsFound} planets, ${housesFound} houses, Ascendant and Midheaven all parsed.`
        : `Parsed ${planetsFound}/${PLANETS.length} planets, ${housesFound}/12 houses, asc=${Boolean(p.ascendant)}, mc=${Boolean(p.midheaven)}.`);
    record("smoke-value", valueOk,
      valueOk
        ? `Sun longitude ${sunLon.toFixed(7)}° matches the reference within ${SMOKE_TOLERANCE_DEG}° (drift ${drift.toExponential(2)}°, ${ms}ms).`
        : `Sun longitude ${sunLon}° differs from the reference ${EXPECTED_SUN_LON}° by ${drift.toExponential(3)}°, beyond the ${SMOKE_TOLERANCE_DEG}° tolerance.`);
  } catch (error) {
    record("smoke-structure", false, `Calculation threw ${error.name} (${error.code || "no code"}).`);
    record("smoke-value", false, "Not reached.");
  }
} else {
  record("smoke-structure", false, "Skipped — the runtime did not resolve.");
  record("smoke-value", false, "Skipped — the runtime did not resolve.");
}

// ── Output ──────────────────────────────────────────────────────────────────
const failed = checks.filter((c) => !c.ok);
// A missing artifact for a platform other than this one does not stop THIS
// machine from calculating; it is reported, and deploy-check blocks on it.
const fatal = failed.filter((c) => !(c.name.startsWith("artifact:") && c.name !== `artifact:${key}`));

if (printChecksums) {
  console.log("Recomputed checksums (paste into vendor/orbit-axis-engine/src/adapters/swiss-ephemeris/manifest.json):\n");
  for (const [k, r] of Object.entries(manifest.runtimes)) {
    const path = join(ASTRO_ROOT, r.executable);
    if (existsSync(path)) console.log(`  ${k.padEnd(16)} ${sha256File(path)}`);
  }
  for (const name of Object.keys(manifest.dataFiles)) {
    const path = join(ASTRO_ROOT, manifest.dataDirectory, name);
    if (existsSync(path)) console.log(`  ${name.padEnd(16)} ${sha256File(path)}`);
  }
  console.log("");
}

if (asJson) {
  console.log(JSON.stringify({
    platform: key, swissEphemerisVersion: manifest.swissEphemerisVersion,
    ok: fatal.length === 0, checks, smoke,
  }, null, 2));
} else {
  console.log("Orbit Core runtime check");
  console.log("");
  console.log(`  Platform:          ${key}`);
  console.log(`  Swiss Ephemeris:   ${manifest.swissEphemerisVersion}`);
  console.log(`  Runtime selected:  ${resolved.ok ? resolved.executable.replace(ASTRO_ROOT, "vendor/orbit-axis-engine") : "none"}`);
  console.log("");
  for (const c of checks) {
    console.log(`  ${c.ok ? "ok  " : "FAIL"}  ${c.name.padEnd(18)} ${c.detail}`);
  }
  console.log("");
  console.log("  Contacted: nothing. No network, no database, no model, no secret printed.");
  console.log("");
}

if (fatal.length) {
  console.error(`RUNTIME NOT USABLE — ${fatal.length} check(s) failed on ${key}.`);
  process.exit(1);
}
if (failed.length) {
  console.log(`Runtime OK on ${key}. ${failed.length} artifact(s) for other platforms are missing — see deploy:check.`);
} else {
  console.log(`Runtime OK on ${key}. Orbit can calculate astrology here.`);
}
