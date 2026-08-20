#!/usr/bin/env node
// Orbit Axis :: write the native container's runtime configuration (1.1.1).
//
// The iOS app is served from capacitor://localhost, so a relative /api request
// resolves against the app bundle and 404s. It needs an absolute origin, and
// that origin differs between a laptop, a preview, and production — which makes
// it configuration, not source.
//
// Reads ORBIT_APP_API_BASE_URL and writes public/app-config.js. With no value
// set it restores the inert same-origin default, so running this on a web
// checkout is a safe no-op rather than a way to break the browser build.

import { writeFileSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { REPO_ROOT } from "../lib/local-llm/config.js";

const TARGET = join(REPO_ROOT, "public", "app-config.js");

/**
 * Validated because this value is written into a served script and used as a
 * fetch origin. An unvalidated string there is how a typo becomes a silent
 * request to somewhere nobody intended.
 *
 * @param {string} raw
 * @returns {string} a bare origin with no trailing slash, or "" for same-origin
 */
export function normalizeApiBase(raw) {
  const value = String(raw || "").trim();
  if (!value) return "";

  let url;
  try {
    url = new URL(value);
  } catch {
    throw new Error(`ORBIT_APP_API_BASE_URL is not a valid URL: ${value}`);
  }

  // http is allowed ONLY for localhost, where there is no transport to
  // protect. Anywhere else it would send session cookies and birth data in
  // clear text, so it is refused rather than warned about.
  const local = url.hostname === "localhost" || url.hostname === "127.0.0.1";
  if (url.protocol !== "https:" && !(url.protocol === "http:" && local)) {
    throw new Error(
      `ORBIT_APP_API_BASE_URL must use https (http is allowed only for localhost): ${value}`,
    );
  }
  if (url.pathname !== "/" || url.search || url.hash) {
    throw new Error(`ORBIT_APP_API_BASE_URL must be an origin with no path: ${value}`);
  }
  return url.origin;
}

export function renderConfig(apiBaseUrl) {
  const header = readFileSync(TARGET, "utf8").split("globalThis.ORBIT_APP_CONFIG")[0];
  return `${header}globalThis.ORBIT_APP_CONFIG = {\n  apiBaseUrl: ${JSON.stringify(apiBaseUrl)},\n};\n`;
}

/**
 * Judge the API origin on both sides of the git boundary.
 *
 * ONE FILE, TWO OPPOSITE REQUIREMENTS. The app-config.js that ships inside a
 * native bundle must carry a REAL origin — with the empty same-origin default,
 * every /api request resolves against capacitor://localhost and the bundle
 * answers them all itself with 200s and no data, which is how a phone got a
 * build on 2026-08-19 that looked deployed and talked to nobody. The
 * app-config.js that git holds must stay EMPTY, or the committed value
 * overrides every browser visitor's own origin.
 *
 * The old check asked only one of those questions, of the wrong copy: it read
 * the working tree and demanded it be empty — so the native build chain
 * REFUSED a configured checkout and happily shipped the broken default.
 *
 * Pure so the contract is testable: the caller supplies both file contents,
 * and `committed: null` means git could not answer, which is reported as a
 * skipped check rather than dressed up as a pass or a failure.
 *
 * @param {object} input
 * @param {string|null} input.workingTree  public/app-config.js as it will ship
 * @param {string|null} input.committed    the same file as git's index holds it
 * @returns {{problems: string[], notes: string[]}}
 */
export function auditApiOrigin({ workingTree, committed }) {
  const problems = [];
  const notes = [];
  // Anchored to the assignment — the same marker renderConfig() splits on —
  // because the file's own header COMMENT contains `apiBaseUrl: ""` as prose.
  // A whole-file regex finds the comment first and reports every config, real
  // origin included, as empty; the previous guard did exactly that and was
  // vacuous without anyone noticing.
  const originOf = (source) => {
    const declaration = String(source ?? "").split("globalThis.ORBIT_APP_CONFIG")[1];
    if (declaration == null) return null;
    const match = /apiBaseUrl:\s*"([^"]*)"/.exec(declaration);
    return match ? match[1] : null;
  };

  // What ships to the device.
  const shipping = originOf(workingTree);
  if (workingTree == null) {
    problems.push("public/app-config.js is missing — index.html references it and the build will fail.");
  } else if (shipping === null) {
    problems.push("public/app-config.js does not declare apiBaseUrl.");
  } else if (!shipping) {
    problems.push(
      "public/app-config.js still holds the empty same-origin apiBaseUrl. A native bundle "
      + "built from it sends every /api request to capacitor://localhost, where the bundle "
      + "answers them all itself — status 200, no data, no account. Run "
      + "`ORBIT_APP_API_BASE_URL=<https origin> npm run app:config` before building the app.",
    );
  } else {
    notes.push(`the native bundle will call ${shipping}.`);
  }

  // What the repository holds.
  const stored = originOf(committed);
  if (committed == null) {
    notes.push("commit-side origin check skipped — git did not answer for public/app-config.js.");
  } else if (stored === null) {
    problems.push("the committed public/app-config.js does not declare apiBaseUrl.");
  } else if (stored) {
    problems.push(
      `the committed public/app-config.js has apiBaseUrl "${stored}". The repository must hold `
      + "the inert same-origin default — restore it with `npm run app:config` (no "
      + "ORBIT_APP_API_BASE_URL set) and stage that before committing.",
    );
  } else {
    notes.push("the committed app config keeps the inert same-origin default.");
  }

  return { problems, notes };
}

function main() {
  const apiBaseUrl = normalizeApiBase(process.env.ORBIT_APP_API_BASE_URL);
  writeFileSync(TARGET, renderConfig(apiBaseUrl), "utf8");
  if (apiBaseUrl) {
    console.log(`Orbit Axis app config: API origin set to ${apiBaseUrl}`);
    console.log("Do not commit this value — `npm run app:check` refuses a staged or committed one.");
  } else {
    console.log("Orbit Axis app config: same-origin (browser default).");
    console.log("Set ORBIT_APP_API_BASE_URL before a native build.");
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  try {
    main();
  } catch (error) {
    console.error(`\n${error.message}\n`);
    process.exit(1);
  }
}
