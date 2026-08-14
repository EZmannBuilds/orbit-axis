// Orbit :: natal chart composition.
//
// Deterministic. Turns raw ephemeris positions into a natal chart: planetary
// houses, aspects, element/modality balance, chart ruler, retrogrades. Honours
// unknown birth times — never fabricates a Rising sign or exact houses.

import { createHash } from "node:crypto";
import { positionsAtUT, localToUT, offsetToMinutes, zoneOffsetMinutes, SIGNS, PLANETS } from "../adapters/swiss-ephemeris/client.js";

export const CALCULATION_VERSION = "natal-v1";

// Instrumentation: counts how many times the Swiss Ephemeris natal computation
// actually runs. Used by tests + dev logging to prove that ordinary follow-up
// chat messages reuse the cached calculation instead of recomputing.
let NATAL_COMPUTE_COUNT = 0;
export function natalComputeCount() { return NATAL_COMPUTE_COUNT; }
export function resetNatalComputeCount() { NATAL_COMPUTE_COUNT = 0; }

const FIRE = ["Aries", "Leo", "Sagittarius"];
const EARTH = ["Taurus", "Virgo", "Capricorn"];
const AIR = ["Gemini", "Libra", "Aquarius"];
const WATER = ["Cancer", "Scorpio", "Pisces"];
const CARDINAL = ["Aries", "Cancer", "Libra", "Capricorn"];
const FIXED = ["Taurus", "Leo", "Scorpio", "Aquarius"];
const MUTABLE = ["Gemini", "Virgo", "Sagittarius", "Pisces"];

export function elementOf(sign) {
  if (FIRE.includes(sign)) return "Fire";
  if (EARTH.includes(sign)) return "Earth";
  if (AIR.includes(sign)) return "Air";
  if (WATER.includes(sign)) return "Water";
  return null;
}
export function modalityOf(sign) {
  if (CARDINAL.includes(sign)) return "Cardinal";
  if (FIXED.includes(sign)) return "Fixed";
  if (MUTABLE.includes(sign)) return "Mutable";
  return null;
}

// Traditional rulerships — used for "chart ruler" (ruler of the rising sign).
const RULER = {
  Aries: "Mars", Taurus: "Venus", Gemini: "Mercury", Cancer: "Moon",
  Leo: "Sun", Virgo: "Mercury", Libra: "Venus", Scorpio: "Mars",
  Sagittarius: "Jupiter", Capricorn: "Saturn", Aquarius: "Saturn", Pisces: "Jupiter",
};

// Weighting for element/modality balance. Luminaries + Ascendant count more.
const BALANCE_WEIGHTS = {
  Sun: 3, Moon: 3, Ascendant: 3,
  Mercury: 2, Venus: 2, Mars: 2,
  Jupiter: 1.5, Saturn: 1.5,
  Uranus: 1, Neptune: 1, Pluto: 1,
};

const ASPECTS = [
  { name: "Conjunction", angle: 0, orb: 8 },
  { name: "Sextile", angle: 60, orb: 6 },
  { name: "Square", angle: 90, orb: 7 },
  { name: "Trine", angle: 120, orb: 8 },
  { name: "Opposition", angle: 180, orb: 8 },
];

function angularSeparation(a, b) {
  const diff = Math.abs(a - b) % 360;
  return diff > 180 ? 360 - diff : diff;
}

export function computeAspects(bodies) {
  // bodies: [{name, longitude, isLuminary}]
  const out = [];
  for (let i = 0; i < bodies.length; i++) {
    for (let j = i + 1; j < bodies.length; j++) {
      const sep = angularSeparation(bodies[i].longitude, bodies[j].longitude);
      for (const asp of ASPECTS) {
        const luminaryBonus = (bodies[i].isLuminary || bodies[j].isLuminary) ? 1 : 0;
        const orb = asp.orb + luminaryBonus;
        const delta = Math.abs(sep - asp.angle);
        if (delta <= orb) {
          out.push({
            a: bodies[i].name, b: bodies[j].name, aspect: asp.name,
            orb: Math.round(delta * 100) / 100, exactAngle: asp.angle,
          });
          break;
        }
      }
    }
  }
  return out.sort((x, y) => x.orb - y.orb);
}

function whichHouse(longitude, cusps) {
  if (!cusps || cusps.length < 12) return null;
  const byNum = {};
  for (const c of cusps) byNum[c.house] = c.longitude;
  for (let h = 1; h <= 12; h++) {
    const start = byNum[h];
    const end = byNum[h === 12 ? 1 : h + 1];
    if (start == null || end == null) continue;
    const rel = ((longitude - start) % 360 + 360) % 360;
    const span = ((end - start) % 360 + 360) % 360;
    if (rel < span) return h;
  }
  return null;
}

// Normalize a set of weighted category counts to integer percentages summing 100.
export function normalizePercentages(counts, keys) {
  const total = keys.reduce((s, k) => s + (counts[k] || 0), 0);
  if (total === 0) return Object.fromEntries(keys.map((k) => [k, 0]));
  const raw = keys.map((k) => ({ k, exact: (counts[k] || 0) / total * 100 }));
  const floored = raw.map((r) => ({ ...r, floor: Math.floor(r.exact), frac: r.exact - Math.floor(r.exact) }));
  let remainder = 100 - floored.reduce((s, r) => s + r.floor, 0);
  floored.sort((a, b) => b.frac - a.frac);
  const result = {};
  for (let i = 0; i < floored.length; i++) {
    result[floored[i].k] = floored[i].floor + (i < remainder ? 1 : 0);
  }
  return Object.fromEntries(keys.map((k) => [k, result[k]]));
}

export function chartInputHash(input) {
  const norm = {
    d: input.birth_date || null,
    t: input.time_accuracy === "unknown" ? null : (input.birth_time || null),
    acc: input.time_accuracy || "unknown",
    lat: input.latitude != null ? Number(input.latitude).toFixed(4) : null,
    lon: input.longitude != null ? Number(input.longitude).toFixed(4) : null,
    tz: input.timezone_name || null,
    off: input.utc_offset_at_birth != null ? String(input.utc_offset_at_birth) : null,
    zod: input.zodiac_system || "tropical",
    hs: input.house_system || "placidus",
  };
  return createHash("sha256").update(JSON.stringify(norm)).digest("hex");
}

const HOUSE_SYSTEM_CODE = { placidus: "P", whole: "W", koch: "K", equal: "E", "whole-sign": "W" };

// Main entry. input uses birth_profile field names.
export function computeNatalChart(input) {
  NATAL_COMPUTE_COUNT += 1;
  const warnings = [];
  const timeAccuracy = input.time_accuracy || "unknown";
  const timeKnown = timeAccuracy !== "unknown" && !!input.birth_time;

  const [y, mo, d] = String(input.birth_date).split("-").map(Number);
  let hour = 12, minute = 0;
  if (timeKnown) {
    const [hh, mm] = String(input.birth_time).split(":").map(Number);
    hour = hh; minute = mm;
  } else {
    warnings.push("birth_time_unknown");
  }

  // An explicit offset wins: a caller that states one has asserted a fact about
  // this birth, and silently overriding it with a zone lookup would change
  // charts that already exist. `timezone_name` is the better input where it is
  // available — it knows whether daylight time was in force, which is the usual
  // source of a one-hour error — so it is used whenever no offset was given.
  let offsetMinutes;
  if (input.utc_offset_at_birth != null && input.utc_offset_at_birth !== "") {
    offsetMinutes = offsetToMinutes(input.utc_offset_at_birth);
  } else if (input.timezone_name) {
    offsetMinutes = zoneOffsetMinutes(input.timezone_name, {
      year: y, month: mo, day: d, hour, minute,
    });
  } else {
    // Neither given: the instant is read as UT. That is a real assumption and
    // it moves every angle if it is wrong, so it is reported rather than made
    // quietly.
    offsetMinutes = 0;
    warnings.push("utc_offset_assumed");
  }
  const ut = localToUT({ year: y, month: mo, day: d, hour, minute, offsetMinutes });
  const houseSystem = HOUSE_SYSTEM_CODE[(input.house_system || "placidus").toLowerCase()] || "P";

  const pos = positionsAtUT({
    ...ut, lat: input.latitude, lon: input.longitude,
    houseSystem, withHouses: timeKnown,
  });

  // planetary houses (only if we trust the time)
  const planetHouses = {};
  const pointHouses = {};
  if (timeKnown && pos.houses.length === 12) {
    for (const name of PLANETS) {
      if (pos.planets[name]) planetHouses[name] = whichHouse(pos.planets[name].longitude, pos.houses);
    }
    // Kept in their own map rather than merged into planet_houses: callers
    // iterate that expecting exactly the ten planets.
    for (const [name, point] of Object.entries(pos.points ?? {})) {
      pointHouses[name] = whichHouse(point.longitude, pos.houses);
    }
  } else if (!timeKnown) {
    warnings.push("houses_unavailable");
    warnings.push("rising_unavailable");
    warnings.push("moon_approximate"); // Moon can be off up to ~6.5° with unknown time
  }

  // aspects (planets + angles when available)
  const aspectBodies = PLANETS.filter((p) => pos.planets[p]).map((p) => ({
    name: p, longitude: pos.planets[p].longitude, isLuminary: p === "Sun" || p === "Moon",
  }));
  if (timeKnown && pos.ascendant) aspectBodies.push({ name: "Ascendant", longitude: pos.ascendant.longitude, isLuminary: false });
  if (timeKnown && pos.midheaven) aspectBodies.push({ name: "MC", longitude: pos.midheaven.longitude, isLuminary: false });
  const aspects = computeAspects(aspectBodies);

  // element / modality balance
  const elementCounts = { Fire: 0, Earth: 0, Air: 0, Water: 0 };
  const modalityCounts = { Cardinal: 0, Fixed: 0, Mutable: 0 };
  for (const name of PLANETS) {
    const b = pos.planets[name];
    if (!b) continue;
    const w = BALANCE_WEIGHTS[name] || 1;
    const el = elementOf(b.sign), mod = modalityOf(b.sign);
    if (el) elementCounts[el] += w;
    if (mod) modalityCounts[mod] += w;
  }
  if (timeKnown && pos.ascendant) {
    const w = BALANCE_WEIGHTS.Ascendant;
    const el = elementOf(pos.ascendant.sign), mod = modalityOf(pos.ascendant.sign);
    if (el) elementCounts[el] += w;
    if (mod) modalityCounts[mod] += w;
  }
  const elementPercentages = normalizePercentages(elementCounts, ["Fire", "Earth", "Air", "Water"]);
  const modalityPercentages = normalizePercentages(modalityCounts, ["Cardinal", "Fixed", "Mutable"]);

  const dominantElement = Object.entries(elementPercentages).sort((a, b) => b[1] - a[1])[0][0];
  const dominantModality = Object.entries(modalityPercentages).sort((a, b) => b[1] - a[1])[0][0];

  const bigThree = {
    sun: pos.planets.Sun ? { sign: pos.planets.Sun.sign, degrees: pos.planets.Sun.degrees, minutes: pos.planets.Sun.minutes } : null,
    moon: pos.planets.Moon ? { sign: pos.planets.Moon.sign, degrees: pos.planets.Moon.degrees, minutes: pos.planets.Moon.minutes } : null,
    rising: (timeKnown && pos.ascendant)
      ? { sign: pos.ascendant.sign, degrees: pos.ascendant.degrees, minutes: pos.ascendant.minutes }
      : { unavailable: true, reason: "Birth time required" },
  };

  const chartRuler = (timeKnown && pos.ascendant) ? (RULER[pos.ascendant.sign] || null) : null;

  const retrogrades = PLANETS.filter((p) => pos.planets[p]?.retrograde);

  return {
    calculation_version: CALCULATION_VERSION,
    time_known: timeKnown,
    time_accuracy: timeAccuracy,
    planets: pos.planets,
    // Chiron and Lilith. Deliberately outside `planets`: they do not enter
    // aspects, element balance, or the chart ruler, so adding them cannot
    // change a reading that already exists.
    points: pos.points ?? {},
    point_houses: pointHouses,
    nodes: pos.nodes,
    angles: timeKnown ? { ascendant: pos.ascendant, midheaven: pos.midheaven } : { ascendant: null, midheaven: null },
    houses: timeKnown ? pos.houses : [],
    planet_houses: planetHouses,
    aspects,
    big_three: bigThree,
    element_balance: { counts: elementCounts, percentages: elementPercentages, dominant: dominantElement },
    modality_balance: { counts: modalityCounts, percentages: modalityPercentages, dominant: dominantModality },
    chart_ruler: chartRuler,
    retrogrades,
    warnings,
    calculation_status: warnings.length ? "partial" : "complete",
  };
}
