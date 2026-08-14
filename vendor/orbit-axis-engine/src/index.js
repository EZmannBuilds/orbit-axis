// Orbit Axis Engine :: public entry point.
//
// A deterministic astrology calculation engine. Given an instant, a location,
// and a house system it returns planetary positions, houses, angles, aspects,
// retrograde state, lunar phase, transits, and structured evidence — the same
// answer every time, computed locally by Swiss Ephemeris with no network call.
//
// WHAT THIS ENGINE DELIBERATELY DOES NOT DO
//
//   - It does not know what a user is. No accounts, no Supabase, no auth.
//   - It does not persist anything.
//   - It does not talk to an AI provider, and it never asks one for a fact.
//     Interpretation layers may explain the evidence this engine produces;
//     they may not add to it.
//   - It does not log birth data.
//
// That separation is the point: the application owns identity, storage, and
// wording; the engine owns truth. Anything that calculates astrology lives
// here, so there is exactly one place where the numbers come from.
//
// LICENCE: AGPL-3.0-or-later. Swiss Ephemeris is used under its AGPL option,
// which requires the whole project to be AGPL-compatible and requires source
// to be offered to users of a network service. See LICENCE and NOTICE.

// ── contract ────────────────────────────────────────────────────────────────
export { CONTRACT_VERSION, engineVersion, buildMetadata } from "./contracts/v1/metadata.js";

// ── runtime and diagnostics ─────────────────────────────────────────────────
// Exposed so a host application can report which ephemeris it is actually
// running and fail loudly on an unsupported platform, rather than discovering
// it on the first user request.
export {
  runtimeManifest,
  runtimeKey,
  resolveRuntime,
  currentRuntimeStatus,
  requireRuntime,
  checkEphemerisData,
  ephemerisDataDir,
  sha256File,
  OrbitRuntimeError,
  ENGINE_ROOT,
} from "./adapters/swiss-ephemeris/paths.js";

export {
  runEphemeris,
  validateCalculationInput,
  assertSafeArgs,
  classifyExecutionError,
  customerSafeMessage,
  diagnosticRecord,
  OrbitCalculationError,
  HOUSE_SYSTEMS,
  DEFAULT_TIMEOUT_MS,
  MAX_OUTPUT_BYTES,
} from "./adapters/swiss-ephemeris/exec.js";

// ── raw ephemeris access ────────────────────────────────────────────────────
export {
  positionsAtUT,
  positionsNow,
  ephemerisCapability,
  EPHEMERIS_VERSION,
  PLANETS,
  POINTS,
  SIGNS,
  SIGN_ABBR,
  offsetToMinutes,
  zoneOffsetMinutes,
  localToUT,
  EphemerisUnavailableError,
} from "./adapters/swiss-ephemeris/client.js";

// ── domain calculations ─────────────────────────────────────────────────────
export {
  computeNatalChart,
  computeAspects,
  chartInputHash,
  elementOf,
  modalityOf,
  normalizePercentages,
  CALCULATION_VERSION,
  // Instrumentation: lets a host application assert that an unchanged active
  // chart is not recomputed on every request. Counts calls, never inputs.
  natalComputeCount,
  resetNatalComputeCount,
} from "./domain/natal-chart.js";

export {
  currentSky,
  moonPhase,
  nextLunarEvents,
  skySnapshotHash,
  SKY_VERSION,
  LUNAR_EVENTS_VERSION,
} from "./domain/current-sky.js";

export {
  personalTransits,
  TRANSIT_VERSION,
} from "./domain/transits.js";

export {
  nextStations,
  nextIngresses,
  STATION_BODIES,
  INGRESS_BODIES,
  UPCOMING_EVENTS_VERSION,
} from "./domain/upcoming-events.js";

export {
  computeSynastryAspects,
  summariseSynastry,
  SYNASTRY_ASPECTS,
  SYNASTRY_BODIES,
  SYNASTRY_VERSION,
} from "./domain/synastry.js";

/**
 * A single call that reports whether this machine can calculate at all.
 * Host applications should run it at startup and refuse to serve astrology
 * routes when it fails, instead of failing one user request at a time.
 *
 * @returns {{ ok: boolean, runtime: string, detail: string }}
 */
export function engineHealth() {
  // Imported lazily to keep module import side-effect free.
  return ephemerisCapabilityRef();
}

import { ephemerisCapability as ephemerisCapabilityRef } from "./adapters/swiss-ephemeris/client.js";
