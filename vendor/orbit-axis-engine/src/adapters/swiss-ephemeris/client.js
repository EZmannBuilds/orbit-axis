// Orbit :: deterministic ephemeris adapter.
//
// Parses Swiss Ephemeris output into Orbit's own structures. All astronomy is
// computed locally against the bundled `.se1` ephemeris files — no network, no
// external astrology API, no LLM. Output is fully deterministic for a given
// (UT instant, location, house system).
//
// This module only *shapes and parses*. Since Update 4.0.4 it does not know
// where the executable lives, which platform it was built for, or how it is
// invoked — lib/astro/runtime/ owns all of that. That separation is what makes
// the same calculations run on Apple Silicon locally and on Linux x64 in a
// Vercel function.
//
// Higher-level chart shaping (aspects, element balance, rulers) lives in
// natal.js / current-sky.js, both of which reach the ephemeris only through
// this module.

import { runtimeManifest, currentRuntimeStatus, requireRuntime, OrbitRuntimeError } from "./paths.js";
import {
  runEphemeris, validateCalculationInput, OrbitCalculationError,
  customerSafeMessage, diagnosticRecord,
} from "./exec.js";

export const EPHEMERIS_VERSION = `swisseph-${runtimeManifest().swissEphemerisVersion}`;

export const SIGNS = [
  "Aries", "Taurus", "Gemini", "Cancer", "Leo", "Virgo",
  "Libra", "Scorpio", "Sagittarius", "Capricorn", "Aquarius", "Pisces",
];
const SIGN_ABBR = {
  ar: "Aries", ta: "Taurus", ge: "Gemini", cn: "Cancer", le: "Leo", vi: "Virgo",
  li: "Libra", sc: "Scorpio", sa: "Sagittarius", cp: "Capricorn", aq: "Aquarius", pi: "Pisces",
};

// swetest -p body letters → our planet names (order matters for -p string)
//
// D is Chiron and A/B are the lunar apogee (Lilith), mean and osculating. They
// are requested alongside the planets in the same run — one subprocess either
// way — but returned under `points` rather than `planets`, because `planets`
// feeds aspects, element balance, and the sky snapshot hash. Folding new bodies
// into those would silently change every existing chart and every fortune seed.
const BODY_CODES = "0123456789mtDAB";
const BODY_NAMES = {
  "Sun": "Sun", "Moon": "Moon", "Mercury": "Mercury", "Venus": "Venus",
  "Mars": "Mars", "Jupiter": "Jupiter", "Saturn": "Saturn", "Uranus": "Uranus",
  "Neptune": "Neptune", "Pluto": "Pluto",
  "mean Node": "North Node", "true Node": "True Node",
  "Chiron": "Chiron", "mean Apogee": "Lilith", "osc. Apogee": "TrueLilith",
};

export const PLANETS = [
  "Sun", "Moon", "Mercury", "Venus", "Mars",
  "Jupiter", "Saturn", "Uranus", "Neptune", "Pluto",
];

/**
 * Bodies returned under `points`.
 *
 * Chiron needs `seas_18.se1`, which this package bundles and `runtime:check`
 * verifies. Parsing stays tolerant rather than throwing on their absence: a
 * caller pointing at a minimal ephemeris directory should lose Chiron, not
 * lose the ability to calculate a natal chart. `checkEphemerisData()` is where
 * a missing data file is reported.
 *
 * Lilith is offered both ways because the two disagree by degrees, not
 * arcseconds, and charts in the wild are drawn with either. `Lilith` is the
 * mean apogee (the common default); `TrueLilith` is the osculating apogee.
 */
export const POINTS = ["Chiron", "Lilith", "TrueLilith"];

// ── UT conversion ────────────────────────────────────────────────────────────

/**
 * The UTC offset an IANA time zone was on at a given LOCAL wall-clock time.
 *
 * WHY THIS EXISTS
 *
 * A birth chart is cast from a wall clock — "1:57 AM in Texas" — but the
 * ephemeris wants UT. Bridging the two requires knowing whether daylight time
 * was in force on that date in that place, which is a question about political
 * history, not arithmetic. Making the caller supply `utc_offset_at_birth` by
 * hand pushes that history onto them, and an off-by-one-hour offset is the most
 * common way a chart comes out subtly and unfalsifiably wrong: every angle
 * moves ~15°, the houses shift, and nothing in the output looks broken.
 *
 * Node ships the IANA database with ICU, so this needs no dependency and no
 * bundled tzdata to go stale.
 *
 * HOW
 *
 * `Intl` maps an instant to a zone's local time; we need the inverse. Guess
 * that the local time IS the UT time, ask the zone what local time that instant
 * actually shows, and correct by the difference. One correction is enough
 * except across a transition, where the corrected guess can land on the other
 * side of it — so it is applied twice and the result verified.
 *
 * AMBIGUOUS AND IMPOSSIBLE TIMES
 *
 * When clocks go back, a local hour happens twice; when they go forward, an
 * hour does not exist. Rather than guess, this returns the offset in force
 * BEFORE the transition — the earlier of two ambiguous readings, and for a
 * skipped hour the offset that was standing when the clock jumped. That is the
 * conventional reading of a birth certificate written during the gap, and it is
 * documented rather than silent.
 *
 * @param {string} timeZone IANA name, e.g. "America/Chicago"
 * @param {{year:number, month:number, day:number, hour?:number, minute?:number}} local
 * @returns {number} minutes east of UTC
 */
export function zoneOffsetMinutes(timeZone, local) {
  const { year, month, day, hour = 12, minute = 0 } = local ?? {};
  let formatter;
  try {
    formatter = new Intl.DateTimeFormat("en-US", {
      timeZone, hourCycle: "h23",
      year: "numeric", month: "2-digit", day: "2-digit",
      hour: "2-digit", minute: "2-digit", second: "2-digit",
    });
  } catch {
    const error = new TypeError(`Unknown time zone: ${timeZone}`);
    error.code = "invalid_input";
    throw error;
  }

  // What the zone's clock reads at a given instant, as a UTC-epoch number so
  // the two can be subtracted.
  const zoneClockAt = (ms) => {
    const parts = {};
    for (const part of formatter.formatToParts(new Date(ms))) {
      if (part.type !== "literal") parts[part.type] = Number(part.value);
    }
    return Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second);
  };

  const wanted = Date.UTC(year, month - 1, day, hour, minute, 0);
  let guess = wanted;
  for (let pass = 0; pass < 2; pass += 1) {
    guess = wanted - (zoneClockAt(guess) - guess);
  }

  // Across a spring-forward gap the requested local time never occurs, so the
  // loop cannot converge. Fall back to the offset in force just before it.
  if (zoneClockAt(guess) !== wanted) {
    const dayBefore = wanted - 86_400_000;
    return Math.round((zoneClockAt(dayBefore) - dayBefore) / 60_000);
  }
  return Math.round((wanted - guess) / 60_000);
}

// Parse a UTC offset ("-05:00", "+5.5", -300 minutes, 5) into minutes east.
export function offsetToMinutes(offset) {
  if (offset == null || offset === "") return 0;
  if (typeof offset === "number") return Math.abs(offset) > 16 ? offset : offset * 60;
  const s = String(offset).trim();
  const m = s.match(/^([+-]?)(\d{1,2}):(\d{2})$/);
  if (m) {
    const sign = m[1] === "-" ? -1 : 1;
    return sign * (parseInt(m[2], 10) * 60 + parseInt(m[3], 10));
  }
  const dec = parseFloat(s);
  if (!Number.isNaN(dec)) return Math.abs(dec) > 16 ? dec : dec * 60;
  return 0;
}

// Convert a local civil date/time + offset into UT calendar fields.
// Uses epoch math so date rollover across midnight is handled correctly.
export function localToUT({ year, month, day, hour = 12, minute = 0, offsetMinutes = 0 }) {
  const ms = Date.UTC(year, month - 1, day, hour, minute, 0) - offsetMinutes * 60000;
  const d = new Date(ms);
  return {
    year: d.getUTCFullYear(), month: d.getUTCMonth() + 1, day: d.getUTCDate(),
    hour: d.getUTCHours(), minute: d.getUTCMinutes(), second: d.getUTCSeconds(),
  };
}

// ── parsing ──────────────────────────────────────────────────────────────────
function signInfo(lonRaw) {
  const lon = ((lonRaw % 360) + 360) % 360;
  const idx = Math.floor(lon / 30);
  const within = lon - idx * 30;
  const deg = Math.floor(within);
  const minFloat = (within - deg) * 60;
  const min = Math.floor(minFloat);
  const sec = Math.round((minFloat - min) * 60);
  return { sign: SIGNS[idx], degrees: deg, minutes: min, seconds: sec };
}

function parseBodyLine(line) {
  // "Sun              84.9453382 24 ge 56'43.2176   0.9550264"
  const m = line.match(/^(.+?)\s{2,}(-?[\d.]+)\s+\d+\s+([a-z]{2})\s+\d+'[\d. ]+\s+(-?[\d.]+)\s*$/);
  if (!m) return null;
  const name = m[1].trim();
  const longitude = parseFloat(m[2]);
  const speed = parseFloat(m[4]);
  return { name, longitude, speed };
}

function parseHouseLine(line) {
  const m = line.match(/^house\s+(\d+)\s+(-?[\d.]+)/);
  if (!m) return null;
  return { house: parseInt(m[1], 10), longitude: parseFloat(m[2]) };
}

function parseAngleLine(line, keyword) {
  if (!line.startsWith(keyword)) return null;
  const m = line.match(/^\S+\s+(-?[\d.]+)/);
  if (!m) return null;
  return { longitude: parseFloat(m[1]) };
}

function body(name, longitude, speed) {
  return {
    name,
    longitude: ((longitude % 360) + 360) % 360,
    speed,
    retrograde: speed < 0,
    ...signInfo(longitude),
  };
}

// ── platform capability ──────────────────────────────────────────────────────
// Kept as the stable, human-readable capability answer that deploy-check and
// the runtime check both report. Since 4.0.4 it is a thin projection of the
// runtime resolver rather than its own path-and-exec logic, so there is exactly
// one definition of "can this machine do astrology?".
//
// This is a diagnostic, not a fallback: there is no second ephemeris to fall
// back to, and inventing positions would be worse than failing.
export class EphemerisUnavailableError extends Error {
  constructor(message, { code = "ephemeris_unavailable" } = {}) {
    super(message);
    this.name = "EphemerisUnavailableError";
    this.code = code;
  }
}

let capability = null;

export function ephemerisCapability({ fresh = false, verifyChecksum = false } = {}) {
  if (capability && !fresh) return capability;
  const status = currentRuntimeStatus({ verifyChecksum });
  capability = status.ok
    ? {
      ok: true,
      code: "ok",
      runtime: status.key,
      detail: `${EPHEMERIS_VERSION} is executable on ${status.key} (${status.linkage}ally linked).`,
    }
    : { ok: false, code: status.code, runtime: status.key, detail: status.detail };
  return capability;
}

// Re-exported so callers that already import from this module can classify and
// present failures without reaching into lib/astro/runtime themselves.
export { OrbitRuntimeError, OrbitCalculationError, customerSafeMessage, diagnosticRecord };

// ── core runner ──────────────────────────────────────────────────────────────
// Resolution, timeout, output caps, exit-code handling, and error
// classification all live in lib/astro/runtime/exec.js.
function run(args) {
  return runEphemeris(args);
}

// Compute raw positions at a UT instant. If lat/lon/withHouses given, also
// returns house cusps + Ascendant + MC. Deterministic.
//
// Inputs are validated before an argument string is built, so an out-of-range
// coordinate is rejected by name instead of producing silently wrong astrology.
export function positionsAtUT(input) {
  const { year, month, day, hour, minute, second, lat, lon, houseSystem, withHouses } =
    validateCalculationInput(input);
  const runtime = requireRuntime();

  const dateStr = `${String(day).padStart(2, "0")}.${String(month).padStart(2, "0")}.${year}`;
  const timeStr = `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}:${String(second).padStart(2, "0")}`;
  const args = [`-edir${runtime.ephemerisDir}`, `-b${dateStr}`, `-ut${timeStr}`, `-p${BODY_CODES}`, "-fPlZs", "-head"];
  if (withHouses && lat != null && lon != null) {
    args.push(`-house${lon},${lat},${houseSystem}`);
  }
  const raw = run(args);

  const planets = {};
  const points = {};
  const nodes = {};
  const houses = [];
  let asc = null, mc = null;

  for (const rawLine of raw.split("\n")) {
    const line = rawLine.replace(/\s+$/, "");
    if (!line.trim()) continue;

    if (line.startsWith("house ")) {
      const h = parseHouseLine(line);
      if (h) houses[h.house] = { house: h.house, longitude: h.longitude, ...signInfo(h.longitude) };
      continue;
    }
    if (line.startsWith("Ascendant")) { const a = parseAngleLine(line, "Ascendant"); if (a) asc = body("Ascendant", a.longitude, 0); continue; }
    if (line.startsWith("MC")) { const a = parseAngleLine(line, "MC"); if (a) mc = body("MC", a.longitude, 0); continue; }
    if (line.startsWith("ARMC") || line.startsWith("Vertex") || line.includes("Asc")) continue;

    const b = parseBodyLine(line);
    if (!b) continue;
    const mapped = BODY_NAMES[b.name];
    if (!mapped) continue;
    if (mapped === "North Node") { nodes.north = body("North Node", b.longitude, b.speed); nodes.south = body("South Node", b.longitude + 180, b.speed); }
    else if (mapped === "True Node") { nodes.trueNorth = body("True Node", b.longitude, b.speed); }
    else if (POINTS.includes(mapped)) points[mapped] = body(mapped, b.longitude, b.speed);
    else planets[mapped] = body(mapped, b.longitude, b.speed);
  }

  // Reject output that parsed into nothing usable. Without this a truncated or
  // malformed run would return an empty-but-valid-looking chart, which is worse
  // than an error: downstream code would treat "no planets" as a real chart and
  // Ask Orbit would build evidence from an absence.
  const found = Object.keys(planets).length;
  if (found < PLANETS.length) {
    throw new OrbitCalculationError(
      "The astronomy engine returned an incomplete result.",
      { code: "invalid_output", detail: { planets_found: found, planets_expected: PLANETS.length } },
    );
  }
  if (withHouses && lat != null && lon != null && (!asc || houses.filter(Boolean).length < 12)) {
    throw new OrbitCalculationError(
      "The astronomy engine returned an incomplete house result.",
      { code: "invalid_output", detail: { houses_found: houses.filter(Boolean).length } },
    );
  }

  return { planets, points, nodes, houses: houses.filter(Boolean), ascendant: asc, midheaven: mc };
}

// Current sky positions (no houses; angles need a location + exact time).
export function positionsNow(date = new Date()) {
  return positionsAtUT({
    year: date.getUTCFullYear(), month: date.getUTCMonth() + 1, day: date.getUTCDate(),
    hour: date.getUTCHours(), minute: date.getUTCMinutes(), second: date.getUTCSeconds(),
  });
}

export { SIGN_ABBR };
