// Orbit Axis API v1 :: platform endpoints — health, version, source.
//
// All three are public and unauthenticated. They are the endpoints an uptime
// monitor, an app-store reviewer, and an AGPL recipient each need, and none of
// them should require an account.
//
// The discipline here is what they must NOT say. A health endpoint is reachable
// by anyone, so it reports capability, never configuration: no database URL, no
// environment values, no filesystem path, no user information.

import { ephemerisCapability, runtimeKey, runtimeManifest, CONTRACT_VERSION, engineVersion }
  from "@ezmannbuilds/orbit-axis-engine";
import { applicationVersion, buildIdentity } from "../contracts/versions.js";
import { checkReadiness } from "../../readiness.js";
import { safeSourceUrl, sourceRepositoryUrls } from "../../../legal/config.js";

/**
 * Cheap readiness: does this instance have a usable astronomy runtime?
 * Deliberately does NOT compute a chart — a health check that spawns a
 * subprocess on every poll is a self-inflicted load problem.
 */
export async function health({ now = () => new Date(), readiness = checkReadiness } = {}) {
  const capability = ephemerisCapability();
  const services = await readiness();

  // `status` reflects only what Orbit itself must do to answer a calculation
  // request. A database that is down does NOT make this "degraded": the
  // calculation endpoints are stateless and keep working without it, and an
  // uptime monitor that pages someone because saved charts are briefly
  // unavailable — while every chart still computes — is a monitor people learn
  // to ignore. The database's own state is reported alongside, honestly.
  return {
    status: capability.ok ? "ok" : "degraded",
    contractVersion: CONTRACT_VERSION,
    applicationVersion: applicationVersion(),
    engineVersion: engineVersion(),
    runtime: {
      platform: runtimeKey(),
      ephemerisAvailable: capability.ok,
      ephemerisVersion: runtimeManifest().swissEphemerisVersion,
    },
    // Capability only. Never which project, never which URL, never any key.
    database: services.database,
    authentication: services.authentication,
    timestamp: now().toISOString(),
  };
}

export function version(env = process.env) {
  return {
    applicationVersion: applicationVersion(),
    engineVersion: engineVersion(),
    contractVersion: CONTRACT_VERSION,
    ephemerisVersion: runtimeManifest().swissEphemerisVersion,
    build: buildIdentity(env),
  };
}

/**
 * AGPL source availability.
 *
 * Both repositories are public under AGPL-3.0-or-later. Their canonical URLs
 * are checked-in repository facts, with validated configuration overrides for
 * a future move. An invalid explicit override is reported as unavailable
 * rather than echoed: this endpoint must only advertise links it can vouch for.
 */
export function source(env = process.env) {
  const { application: appUrl, engine: engineUrl } = sourceRepositoryUrls(env);
  return {
    application: {
      license: "AGPL-3.0-or-later",
      version: applicationVersion(),
      repositoryStatus: appUrl ? "published" : "pending-publication",
      repositoryUrl: appUrl,
    },
    engine: {
      license: "AGPL-3.0-or-later",
      version: engineVersion(),
      repositoryStatus: engineUrl ? "published" : "pending-publication",
      repositoryUrl: engineUrl,
    },
    thirdParty: [
      {
        name: "Swiss Ephemeris",
        copyright: "Astrodienst AG",
        version: runtimeManifest().swissEphemerisVersion,
        license: "AGPL-3.0 (dual-licensed; Orbit uses the AGPL option)",
        url: "https://www.astro.com/swisseph/",
      },
    ],
    notice: "Orbit Axis is free software under the AGPL. If you interact with it over a "
      + "network you are entitled to its complete corresponding source code.",
  };
}

/** Only https URLs on known code-hosting origins are ever echoed. */
function safeRepositoryUrl(value) {
  return safeSourceUrl(value);
}

export { safeRepositoryUrl };
