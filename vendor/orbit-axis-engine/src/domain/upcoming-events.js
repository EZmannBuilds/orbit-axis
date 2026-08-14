// Orbit :: upcoming planetary events.
//
// Retrograde/direct stations and sign ingresses, located the same way
// nextLunarEvents locates lunations: coarse sampling of real Swiss Ephemeris
// positions to bracket a crossing, then bisection down to the millisecond,
// normalised to a whole UTC second so independent callers in the same window
// agree on the public instant. No mean-motion projections — the ephemeris is
// the only authority.

import { positionsNow, SIGNS } from "../adapters/swiss-ephemeris/client.js";

export const UPCOMING_EVENTS_VERSION = "upcoming-v1";

const DAY_MS = 86_400_000;

// The Sun and Moon never station. Everything else does.
export const STATION_BODIES = Object.freeze([
  "Mercury", "Venus", "Mars", "Jupiter", "Saturn", "Uranus", "Neptune", "Pluto",
]);

// Ingress search is bounded by a horizon; slow outer planets can sit in one
// sign for years to decades, so their next ingress is often legitimately
// outside any reasonable window and is simply omitted from the result.
export const INGRESS_BODIES = Object.freeze([
  "Sun", "Moon", "Mercury", "Venus", "Mars", "Jupiter", "Saturn", "Uranus", "Neptune", "Pluto",
]);

// Longest wait between consecutive stations of any body is Mars: ~24 months
// from its direct station to the next retrograde station. 800 days brackets it.
const STATION_HORIZON_DAYS = 800;
const INGRESS_HORIZON_DAYS = 400;

// Coarse sampling steps. Stations: retrograde periods last weeks (Mercury's
// ~21 days is the shortest), so a 5-day grid cannot skip a speed sign change
// and its reversal. Ingresses: the Moon changes sign every ~2.3 days, so it
// gets a finer grid; no planet can enter and leave a sign inside 5 days
// (forward transit of 30° needs >13 days even at Mercury's fastest, and
// re-exit near a station happens at near-zero speed).
const STATION_STEP_MS = 5 * DAY_MS;
const INGRESS_STEP_MS = 5 * DAY_MS;
const MOON_INGRESS_STEP_MS = DAY_MS;

function validDate(value, caller) {
  const date = value instanceof Date ? new Date(value.getTime()) : new Date(value);
  if (Number.isNaN(date.getTime())) {
    const error = new TypeError(`${caller} requires a valid instant`);
    error.code = "invalid_input";
    throw error;
  }
  return date;
}

// One ephemeris call serves every body at that instant; memoise per search so
// the per-body loops below don't multiply subprocess calls.
function samplerFor() {
  const cache = new Map();
  return (ms) => {
    let hit = cache.get(ms);
    if (!hit) {
      hit = positionsNow(new Date(ms)).planets;
      cache.set(ms, hit);
    }
    return hit;
  };
}

/**
 * Bisect a boundary crossing between lowMs (state A) and highMs (state B).
 * `stateAt(ms)` must be two-valued over the bracket. Returns the first
 * millisecond inside the bracket whose state differs from the state at lowMs.
 */
function bisectCrossing(lowMs, highMs, stateAt) {
  const startState = stateAt(lowMs);
  let lo = lowMs, hi = highMs;
  for (let step = 0; step < 48 && hi - lo > 1; step += 1) {
    const mid = Math.floor((lo + hi) / 2);
    if (stateAt(mid) === startState) lo = mid;
    else hi = mid;
  }
  return hi;
}

function toPublicInstant(ms) {
  return new Date(Math.round(ms / 1_000) * 1_000);
}

/**
 * Next station (retrograde or direct) for each body, sorted chronologically.
 *
 * @param {Date|string|number} [date]
 * @param {{ bodies?: readonly string[], horizonDays?: number }} [options]
 * @returns {{
 *   events_version: string,
 *   calculated_from_utc: string,
 *   horizon_days: number,
 *   stations: Array<{
 *     body: string,
 *     kind: "station_retrograde" | "station_direct",
 *     instant_utc: string,
 *     sign: string, degrees: number, minutes: number, longitude: number,
 *   }>,
 * }}
 */
export function nextStations(date = new Date(), { bodies = STATION_BODIES, horizonDays = STATION_HORIZON_DAYS } = {}) {
  const start = validDate(date, "nextStations");
  const sample = samplerFor();
  const startMs = start.getTime();
  const endMs = startMs + horizonDays * DAY_MS;

  const stations = [];
  for (const body of bodies) {
    if (!STATION_BODIES.includes(body)) {
      const error = new TypeError(`nextStations: ${body} does not station`);
      error.code = "invalid_input";
      throw error;
    }
    let prevMs = startMs;
    let prevRetro = sample(prevMs)[body].speed < 0;
    for (let ms = startMs + STATION_STEP_MS; ms <= endMs + STATION_STEP_MS; ms += STATION_STEP_MS) {
      const retro = sample(ms)[body].speed < 0;
      if (retro !== prevRetro) {
        const crossMs = bisectCrossing(prevMs, ms, (t) => sample(t)[body].speed < 0);
        const instant = toPublicInstant(crossMs);
        const at = positionsNow(instant).planets[body];
        stations.push({
          body,
          kind: retro ? "station_retrograde" : "station_direct",
          instant_utc: instant.toISOString(),
          sign: at.sign, degrees: at.degrees, minutes: at.minutes, longitude: at.longitude,
        });
        break;
      }
      prevMs = ms;
      prevRetro = retro;
    }
  }
  stations.sort((a, b) => a.instant_utc.localeCompare(b.instant_utc));

  return {
    events_version: UPCOMING_EVENTS_VERSION,
    calculated_from_utc: start.toISOString(),
    horizon_days: horizonDays,
    stations,
  };
}

/**
 * Next sign ingress for each body within the horizon, sorted chronologically.
 * A retrograde body re-entering the previous sign counts — an ingress is any
 * sign-boundary crossing. Bodies whose next ingress lies beyond the horizon
 * (slow outer planets, most of the time) are omitted.
 *
 * @param {Date|string|number} [date]
 * @param {{ bodies?: readonly string[], horizonDays?: number }} [options]
 * @returns {{
 *   events_version: string,
 *   calculated_from_utc: string,
 *   horizon_days: number,
 *   ingresses: Array<{
 *     body: string,
 *     from_sign: string,
 *     to_sign: string,
 *     retrograde: boolean,
 *     instant_utc: string,
 *   }>,
 * }}
 */
export function nextIngresses(date = new Date(), { bodies = INGRESS_BODIES, horizonDays = INGRESS_HORIZON_DAYS } = {}) {
  const start = validDate(date, "nextIngresses");
  const sample = samplerFor();
  const startMs = start.getTime();
  const endMs = startMs + horizonDays * DAY_MS;
  const signIndexAt = (ms, body) => Math.floor(((sample(ms)[body].longitude % 360) + 360) % 360 / 30);

  const ingresses = [];
  for (const body of bodies) {
    const stepMs = body === "Moon" ? MOON_INGRESS_STEP_MS : INGRESS_STEP_MS;
    let prevMs = startMs;
    let prevIdx = signIndexAt(prevMs, body);
    for (let ms = startMs + stepMs; ms <= endMs + stepMs; ms += stepMs) {
      const idx = signIndexAt(ms, body);
      if (idx !== prevIdx) {
        const crossMs = bisectCrossing(prevMs, ms, (t) => signIndexAt(t, body) === prevIdx);
        const instant = toPublicInstant(crossMs);
        const after = positionsNow(instant).planets[body];
        ingresses.push({
          body,
          from_sign: SIGNS[prevIdx],
          to_sign: after.sign,
          retrograde: after.speed < 0,
          instant_utc: instant.toISOString(),
        });
        break;
      }
      prevMs = ms;
      prevIdx = idx;
    }
  }
  ingresses.sort((a, b) => a.instant_utc.localeCompare(b.instant_utc));

  return {
    events_version: UPCOMING_EVENTS_VERSION,
    calculated_from_utc: start.toISOString(),
    horizon_days: horizonDays,
    ingresses,
  };
}
