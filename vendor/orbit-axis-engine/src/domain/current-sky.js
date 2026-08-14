// Orbit :: current sky.
//
// Deterministic snapshot of the real sky at an instant, computed locally from
// the Swiss Ephemeris. Moon phase + illumination are derived from the Sun–Moon
// elongation — no external astrology/weather API.

import { createHash } from "node:crypto";
import { positionsNow, PLANETS } from "../adapters/swiss-ephemeris/client.js";
import { computeAspects, elementOf } from "./natal-chart.js";

export const SKY_VERSION = "sky-v1";
export const LUNAR_EVENTS_VERSION = "lunar-events-v1";

const DAY_MS = 86_400_000;
const MEAN_LUNAR_ELONGATION_SPEED = 360 / 29.53058867;

const PHASES = [
  "New Moon",
  "Waxing Crescent",
  "First Quarter",
  "Waxing Gibbous",
  "Full Moon",
  "Waning Gibbous",
  "Last Quarter",
  "Waning Crescent",
];

// Sun–Moon elongation (0..360) → phase bucket + illumination fraction.
//
// Two call forms:
//   moonPhase(sunLon, moonLon) — longitudes already in hand (what currentSky uses).
//   moonPhase(date?)           — one instant; both longitudes come from the
//                                ephemeris. Defaults to now.
// A lone Date must not fall through to the longitude arithmetic — that yields
// NaN, which serialises as null while the waxing/waning booleans keep their
// NaN-comparison defaults. Invalid input fails loudly instead.
export function moonPhase(sunLonOrDate, moonLon) {
  let sunLon = sunLonOrDate;
  if (moonLon === undefined) {
    const date = validDate(sunLonOrDate ?? new Date(), "moonPhase");
    const positions = positionsNow(date);
    sunLon = positions.planets.Sun.longitude;
    moonLon = positions.planets.Moon.longitude;
  }
  if (!Number.isFinite(sunLon) || !Number.isFinite(moonLon)) {
    const error = new TypeError("moonPhase requires two finite longitudes or one valid instant");
    error.code = "invalid_input";
    throw error;
  }
  const elongation = ((moonLon - sunLon) % 360 + 360) % 360;
  const illumination = (1 - Math.cos((elongation * Math.PI) / 180)) / 2;
  // 8 buckets of 45°, centred so New Moon straddles 0/360.
  const idx = Math.floor(((elongation + 22.5) % 360) / 45);
  const waxing = elongation < 180;
  return {
    elongation: Math.round(elongation * 100) / 100,
    phase_name: PHASES[idx],
    waxing,
    waning: !waxing,
    illumination_percent: Math.round(illumination * 1000) / 10,
  };
}

export function currentSky(date = new Date()) {
  // Validate here so a bad instant fails as a sky-snapshot error, not as the
  // adapter's natal-flavoured "Birth year must be a whole number".
  const instant = validDate(date, "currentSky");
  const pos = positionsNow(instant);
  const sun = pos.planets.Sun;
  const moon = pos.planets.Moon;

  const phase = moonPhase(sun.longitude, moon.longitude);

  const retrogrades = PLANETS.filter((p) => pos.planets[p]?.retrograde);

  const aspectBodies = PLANETS.filter((p) => pos.planets[p]).map((p) => ({
    name: p, longitude: pos.planets[p].longitude, isLuminary: p === "Sun" || p === "Moon",
  }));
  const aspects = computeAspects(aspectBodies).filter((a) => a.orb <= 3); // tightest "major current aspects"

  const snapshot = {
    sky_version: SKY_VERSION,
    instant_utc: instant.toISOString(),
    zodiac_season: sun.sign,
    sun: { sign: sun.sign, degrees: sun.degrees, minutes: sun.minutes, longitude: sun.longitude },
    moon: {
      sign: moon.sign, degrees: moon.degrees, minutes: moon.minutes, longitude: moon.longitude,
      phase_name: phase.phase_name, illumination_percent: phase.illumination_percent,
      phase_fraction: Math.round((phase.elongation / 360) * 1_000_000) / 1_000_000,
      elongation_degrees: phase.elongation,
      waxing: phase.waxing, waning: phase.waning,
    },
    dominant_element: sun ? elementOf(sun.sign) : null,
    retrogrades,
    aspects,
    planets: pos.planets,
    // Chiron and Lilith travel with the snapshot but stay out of `retrogrades`
    // and `aspects`, and so out of skySnapshotHash — that hash seeds daily
    // fortunes, and it must not shift because the engine learned a new body.
    points: pos.points ?? {},
  };
  snapshot.snapshot_hash = skySnapshotHash(snapshot);
  return snapshot;
}

/**
 * Find the next new and full Moon from one UTC instant.
 *
 * This deliberately samples Swiss Ephemeris positions rather than projecting a
 * mean synodic month. Orbit's application used to carry a second mean-cycle
 * helper; near a lunation that helper could disagree with `currentSky()` about
 * both the phase and whether the Moon was waxing. Keeping event search here
 * makes the engine the calculation authority for the snapshot and its next
 * boundaries.
 *
 * Results are normalised to the nearest UTC second after a millisecond search,
 * so callers starting at different instants in the same lunation receive the
 * same public event instant.
 *
 * @param {Date} date
 * @returns {{
 *   events_version: string,
 *   calculated_from_utc: string,
 *   full_moon: { kind: "full_moon", instant_utc: string },
 *   new_moon: { kind: "new_moon", instant_utc: string }
 * }}
 */
export function nextLunarEvents(date = new Date()) {
  const start = validDate(date, "nextLunarEvents");
  const startPositions = positionsNow(start);
  const startElongation = elongation(
    startPositions.planets.Sun.longitude,
    startPositions.planets.Moon.longitude,
  );

  return {
    events_version: LUNAR_EVENTS_VERSION,
    calculated_from_utc: start.toISOString(),
    full_moon: {
      kind: "full_moon",
      instant_utc: findNextElongation(start, startElongation, 180).toISOString(),
    },
    new_moon: {
      kind: "new_moon",
      instant_utc: findNextElongation(start, startElongation, 0).toISOString(),
    },
  };
}

function validDate(value, caller) {
  const date = value instanceof Date ? new Date(value.getTime()) : new Date(value);
  if (Number.isNaN(date.getTime())) {
    const error = new TypeError(`${caller} requires a valid instant`);
    error.code = "invalid_input";
    throw error;
  }
  return date;
}

function elongation(sunLongitude, moonLongitude) {
  return ((moonLongitude - sunLongitude) % 360 + 360) % 360;
}

function elongationAt(date) {
  const positions = positionsNow(date);
  return elongation(
    positions.planets.Sun.longitude,
    positions.planets.Moon.longitude,
  );
}

/**
 * Convert the wrapped 0..360 elongation into a monotonically advancing value
 * relative to the search start. The expected mean motion is used only to pick
 * the correct 360-degree turn; the event itself is located from ephemeris
 * positions.
 */
function unwrappedAdvance(rawElongation, startElongation, elapsedMs) {
  const rawAdvance = rawElongation - startElongation;
  const expectedAdvance = (elapsedMs / DAY_MS) * MEAN_LUNAR_ELONGATION_SPEED;
  const turns = Math.round((expectedAdvance - rawAdvance) / 360);
  return rawAdvance + (turns * 360);
}

function findNextElongation(start, startElongation, targetDegrees) {
  let targetAdvance = ((targetDegrees - startElongation) % 360 + 360) % 360;
  // "Next" means strictly after the requested instant. If the instant is
  // already exactly on the boundary, find the following lunation.
  if (targetAdvance < 1e-7) targetAdvance = 360;

  const estimatedMs = (targetAdvance / MEAN_LUNAR_ELONGATION_SPEED) * DAY_MS;
  let lowMs = Math.max(start.getTime(), start.getTime() + estimatedMs - (2 * DAY_MS));
  let highMs = start.getTime() + estimatedMs + (2 * DAY_MS);

  const advanceAt = (instantMs) => unwrappedAdvance(
    elongationAt(new Date(instantMs)),
    startElongation,
    instantMs - start.getTime(),
  );

  if (advanceAt(lowMs) >= targetAdvance) lowMs = start.getTime();

  // The estimate is deliberately generous, but expand safely if an unusual
  // month falls outside it. A hard bound prevents an engine/runtime defect from
  // becoming an unbounded loop.
  for (let expansions = 0; advanceAt(highMs) < targetAdvance; expansions += 1) {
    if (expansions >= 5) {
      const error = new Error("Could not bracket the next lunar event");
      error.code = "calculation_failed";
      throw error;
    }
    highMs += 2 * DAY_MS;
  }

  // Forty-eight hours down to millisecond precision. Normalising the result to
  // a whole second keeps the public contract stable across independent calls
  // whose search brackets begin at different instants.
  for (let step = 0; step < 32 && highMs - lowMs > 1; step += 1) {
    const midMs = Math.floor((lowMs + highMs) / 2);
    if (advanceAt(midMs) < targetAdvance) lowMs = midMs;
    else highMs = midMs;
  }

  return new Date(Math.round(highMs / 1_000) * 1_000);
}

// Stable hash of the *coarse* sky state (sign-level + phase + retrogrades), so
// it only changes when something astrologically meaningful changes — suitable
// as a fortune-seed input without churning every minute.
export function skySnapshotHash(sky) {
  const coarse = {
    season: sky.zodiac_season,
    moonSign: sky.moon.sign,
    phase: sky.moon.phase_name,
    retro: [...sky.retrogrades].sort(),
  };
  return createHash("sha256").update(JSON.stringify(coarse)).digest("hex");
}
