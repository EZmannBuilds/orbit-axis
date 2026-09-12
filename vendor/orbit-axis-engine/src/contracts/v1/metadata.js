// Orbit Axis Engine :: calculation metadata (contract v1).
//
// Every calculation the engine returns carries this block. It exists so a
// stored reading stays reproducible: if the ephemeris version, house system, or
// engine version changes later, a past answer can still be explained by the
// exact inputs that produced it.
//
// Deliberately contains NO personal data. Birth date, birth time, and
// coordinates are inputs the caller already holds; repeating them in diagnostic
// metadata would spread them into logs and stored records for no benefit. The
// timezone is included because it is a calculation parameter, not an identifier.

import { runtimeManifest } from "../../adapters/swiss-ephemeris/paths.js";

export const CONTRACT_VERSION = "v1";

// Read from package.json at call time so the published version and the reported
// version cannot drift apart.
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const PACKAGE_PATH = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "package.json");

let cachedVersion = null;
export function engineVersion() {
  if (cachedVersion) return cachedVersion;
  try { cachedVersion = JSON.parse(readFileSync(PACKAGE_PATH, "utf8")).version; }
  catch { cachedVersion = "0.0.0-unknown"; }
  return cachedVersion;
}

/**
 * @typedef {object} CalculationMetadata
 * @property {string} engineVersion      Semantic version of this engine.
 * @property {string} contractVersion    Response contract, e.g. "v1".
 * @property {string} ephemerisProvider  Always "swiss-ephemeris" today.
 * @property {string} ephemerisVersion   Verified Swiss Ephemeris version.
 * @property {string} houseSystem        Requested house system.
 * @property {string} zodiacType         "tropical" or "sidereal".
 * @property {string|null} ayanamsha       Named ayanamsha when sidereal; null otherwise.
 * @property {string|null} timezone      IANA zone when supplied by the caller.
 * @property {string} calculatedAt       ISO-8601 timestamp.
 */

/**
 * Build the metadata block for a calculation response.
 * @param {{ houseSystem?: string, zodiacType?: string, ayanamsha?: string|null, timezone?: string|null, now?: () => Date }} [options]
 * @returns {CalculationMetadata}
 */
export function buildMetadata({ houseSystem = "placidus", zodiacType = "tropical", ayanamsha = null, timezone = null, now = () => new Date() } = {}) {
  return {
    engineVersion: engineVersion(),
    contractVersion: CONTRACT_VERSION,
    ephemerisProvider: "swiss-ephemeris",
    ephemerisVersion: runtimeManifest().swissEphemerisVersion,
    houseSystem,
    zodiacType,
    ayanamsha,
    timezone,
    calculatedAt: now().toISOString(),
  };
}
