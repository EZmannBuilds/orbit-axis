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

function main() {
  const apiBaseUrl = normalizeApiBase(process.env.ORBIT_APP_API_BASE_URL);
  writeFileSync(TARGET, renderConfig(apiBaseUrl), "utf8");
  if (apiBaseUrl) {
    console.log(`Orbit Axis app config: API origin set to ${apiBaseUrl}`);
    console.log("Do not commit this value — `npm run app:check` will refuse it.");
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
