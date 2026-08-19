#!/usr/bin/env node
// Orbit Axis :: native application readiness checks (Update 1.1.1).
//
// Safe by design: contacts nothing, starts nothing, changes nothing. It reads
// files — and asks git, read-only, what the index holds for one of them — and
// answers whether this checkout could produce a sane iOS build, and whether
// anything that must never ship to a device is about to.
//
// It deliberately does NOT check that Xcode works. That is an environment
// question with an honest answer of its own, reported separately, and a
// readiness script that fails on a missing Xcode would be useless on the
// machines where most of this work happens.

import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { REPO_ROOT } from "../lib/local-llm/config.js";
import { auditApiOrigin } from "./app-config.js";

const problems = [];
const notes = [];

function read(relative) {
  const full = join(REPO_ROOT, relative);
  return existsSync(full) ? readFileSync(full, "utf8") : null;
}

// ── 1. Capacitor configuration ──────────────────────────────────────────────
const rawConfig = read("capacitor.config.json");
if (!rawConfig) {
  problems.push("capacitor.config.json is missing — the iOS target cannot be generated.");
} else {
  let config;
  try {
    config = JSON.parse(rawConfig);
  } catch (error) {
    problems.push(`capacitor.config.json is not valid JSON: ${error.message}`);
  }
  if (config) {
    if (!config.appId) problems.push("capacitor.config.json has no appId.");
    if (!config.appName) problems.push("capacitor.config.json has no appName.");

    // webDir must be the directory Vercel already serves, or the app and the
    // website are two different products built from one repository.
    const vercel = JSON.parse(read("vercel.json") || "{}");
    if (config.webDir !== vercel.outputDirectory) {
      problems.push(
        `capacitor.config.json webDir is "${config.webDir}" but vercel.json serves `
        + `"${vercel.outputDirectory}". The app and the website must ship the same files.`,
      );
    } else {
      notes.push(`webDir "${config.webDir}" matches the deployed web output directory.`);
    }

    if (!existsSync(join(REPO_ROOT, config.webDir || "public", "index.html"))) {
      problems.push(`webDir "${config.webDir}" has no index.html to load.`);
    }

    // A production bundle identifier is an Apple registration the owner makes
    // deliberately. Shipping one by accident is not something to discover in
    // App Store Connect.
    if (config.appId && !/^dev\./.test(config.appId)) {
      notes.push(`appId is "${config.appId}" — confirm this is the intended Apple bundle identifier.`);
    } else {
      notes.push(`appId is "${config.appId}" (reversible development identifier).`);
    }
  }
}

// ── 2. Nothing secret, and no production domain, in what ships to a device ──
// public/ is copied verbatim into the app bundle, where it is readable by
// anyone with the .ipa. This is the last gate before that happens.
const SECRET_PATTERNS = [
  [/SUPABASE_SERVICE_ROLE_KEY/, "a service-role key reference"],
  [/service_role/, "a service_role reference"],
  [/eyJhbGciOi[A-Za-z0-9._-]{20,}/, "what looks like a JWT"],
  [/sb_secret_[A-Za-z0-9_-]+/, "a Supabase secret key"],
  [/-----BEGIN [A-Z ]*PRIVATE KEY-----/, "a private key"],
];

function scan(dir) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) { scan(full); continue; }
    if (!/\.(js|html|css|json|webmanifest)$/.test(entry.name)) continue;
    const source = readFileSync(full, "utf8");
    const shown = full.replace(`${REPO_ROOT}/`, "");
    for (const [pattern, description] of SECRET_PATTERNS) {
      if (pattern.test(source)) problems.push(`${shown} contains ${description}.`);
    }
  }
}
scan(join(REPO_ROOT, "public"));
notes.push("public/ scanned for credentials; nothing shipped to a device may contain one.");

// ── 3. The API origin: real in the bundle, inert in the repository ──────────
// Two opposite requirements on one file, so both copies are judged. The
// WORKING TREE is what `cap sync` bundles into the device, and with the empty
// same-origin default every /api request would resolve against
// capacitor://localhost and be answered — 200, no data — by the bundle itself.
// The INDEX is what a commit would publish, where a real origin would override
// every browser visitor's own. The old version of this check asked only the
// commit question, of the working tree: it refused a correctly configured
// checkout and passed the broken default straight onto a phone.
function committedAppConfig() {
  try {
    return execFileSync("git", ["show", ":public/app-config.js"],
      { cwd: REPO_ROOT, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
  } catch {
    return null;   // not a git checkout: the audit reports the skip honestly
  }
}
const origin = auditApiOrigin({
  workingTree: read("public/app-config.js"),
  committed: committedAppConfig(),
});
problems.push(...origin.problems);
notes.push(...origin.notes);

// ── 4. The web build does not depend on the native container ────────────────
// The browser version is the source application. If it needs Capacitor to run,
// that relationship has quietly inverted.
const appJs = read("public/app.js") || "";
if (/window\.Capacitor|globalThis\.Capacitor/.test(appJs)) {
  problems.push(
    "public/app.js references Capacitor directly. Platform differences belong in "
    + "public/platform.js so the web build cannot break for a native reason.",
  );
} else {
  notes.push("public/app.js contains no direct Capacitor reference.");
}

// ── 5. The iOS project, if it has been generated ────────────────────────────
const iosDir = join(REPO_ROOT, "ios");
if (existsSync(iosDir) && statSync(iosDir).isDirectory()) {
  notes.push("ios/ exists. Regenerate it with `npx cap add ios` if it is ever inconsistent.");
} else {
  notes.push("ios/ has not been generated yet — run `npx cap add ios` (needs Xcode and CocoaPods).");
}

// ── Report ──────────────────────────────────────────────────────────────────
console.log("Orbit Axis application readiness");
console.log("");
for (const note of notes) console.log(`  ok    ${note}`);
if (problems.length) {
  console.log("");
  for (const problem of problems) console.log(`  FAIL  ${problem}`);
  console.log("");
  console.log(`${problems.length} problem(s) must be fixed before building the app.`);
  process.exit(1);
}
console.log("");
console.log("App check OK — the shared web output is safe to bundle into the iOS target.");
