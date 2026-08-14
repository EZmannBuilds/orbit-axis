// Orbit Core :: calculation parity across platforms (Update 4.0.4).
//
// One fixture, asserted on whatever platform runs the suite. It was generated
// on darwin-arm64; running the same assertions inside a linux-x64 container is
// what proves the two runtimes agree. If both pass, parity holds — no
// cross-platform diffing machinery required at test time.
//
// TOLERANCES ARE DELIBERATE AND TIGHT. Measured drift between the macOS
// (dynamically linked, clang) and Linux (statically linked, gcc 12) builds of
// Swiss Ephemeris 2.10.03 against the same .se1 data files was:
//
//   longitude : 0.0 degrees        (bit-identical across 440 compared values)
//   speed     : 1e-7 degrees/day   (last printed digit only)
//
// The tolerances below are therefore several orders of magnitude looser than
// the observed difference, purely to absorb last-digit formatting. They must
// NOT be widened to make a failing test pass — a real drift beyond these means
// the binaries, the data files, or the flags genuinely differ, and that is a
// bug to find, not a number to relax.
//
// An early smoke run DID show ~1e-6 degrees of drift; the cause was the build
// container's own bundled ephemeris data, not the compiler. With Orbit's .se1
// files the results are identical. That is exactly the kind of difference
// these tolerances exist to expose rather than hide.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { positionsAtUT, PLANETS } from "../lib/astro/ephemeris.js";
import { computeNatalChart } from "../lib/astro/natal.js";
import { currentSky } from "../lib/astro/current-sky.js";
import { personalTransits } from "../lib/fortune/engine.js";
import { runtimeKey, runtimeManifest } from "../lib/astro/runtime/resolve.js";
import { REPO_ROOT } from "../lib/local-llm/config.js";

const FIXTURE = JSON.parse(readFileSync(join(REPO_ROOT, "test/fixtures/calculation-parity.json"), "utf8"));

// Explicit, justified tolerances. See the header.
const TOL_LONGITUDE_DEG = 1e-6;   // 0.0036 arcsec
const TOL_SPEED_DEG_DAY = 1e-6;
const TOL_ILLUMINATION_PCT = 0.01;

const PLATFORM = runtimeKey();

const CASES = [
  { name: "normal_known_time",   year: 1990, month: 6,  day: 15, hour: 14, minute: 30, second: 0, lat: 41.8781,  lon: -87.6298,  withHouses: true },
  { name: "northern_high_lat",   year: 1985, month: 12, day: 21, hour: 6,  minute: 0,  second: 0, lat: 59.3293,  lon: 18.0686,   withHouses: true },
  { name: "southern_lat",        year: 1978, month: 3,  day: 3,  hour: 23, minute: 15, second: 0, lat: -33.8688, lon: 151.2093,  withHouses: true },
  { name: "eastern_lon",         year: 2001, month: 9,  day: 9,  hour: 8,  minute: 45, second: 0, lat: 35.6895,  lon: 139.6917,  withHouses: true },
  { name: "western_lon",         year: 2004, month: 2,  day: 28, hour: 19, minute: 5,  second: 0, lat: 37.7749,  lon: -122.4194, withHouses: true },
  { name: "day_boundary_before", year: 1999, month: 12, day: 31, hour: 23, minute: 59, second: 0, lat: 51.5072,  lon: 0.1276,    withHouses: true },
  { name: "day_boundary_after",  year: 2000, month: 1,  day: 1,  hour: 0,  minute: 1,  second: 0, lat: 51.5072,  lon: 0.1276,    withHouses: true },
  { name: "leap_day",            year: 2000, month: 2,  day: 29, hour: 12, minute: 0,  second: 0, lat: 48.8566,  lon: 2.3522,    withHouses: true },
  { name: "equator",             year: 1995, month: 6,  day: 1,  hour: 12, minute: 0,  second: 0, lat: 0,        lon: 0,         withHouses: true },
  { name: "far_past",            year: 1911, month: 11, day: 11, hour: 11, minute: 11, second: 0, lat: 52.5200,  lon: 13.4050,   withHouses: true },
  { name: "far_future",          year: 2040, month: 1,  day: 1,  hour: 0,  minute: 0,  second: 0, lat: 51.5074,  lon: -0.1278,   withHouses: true },
  { name: "no_houses",           year: 1988, month: 7,  day: 7,  hour: 12, minute: 0,  second: 0, lat: null,     lon: null,      withHouses: false },
];

function closeTo(actual, expected, tol, label) {
  const drift = Math.abs(actual - expected);
  assert.ok(drift <= tol,
    `${label}: ${actual} differs from the recorded ${expected} by ${drift.toExponential(3)}, beyond the ${tol} tolerance (platform ${PLATFORM})`);
}

test("the fixture was generated with the Swiss Ephemeris version this build declares", () => {
  assert.equal(FIXTURE.swissEphemerisVersion, runtimeManifest().swissEphemerisVersion,
    "a fixture from a different Swiss Ephemeris version cannot prove parity");
});

// ── planetary positions, signs, retrogrades, houses, angles ─────────────────

for (const testCase of CASES) {
  test(`positions match the recorded fixture: ${testCase.name}`, () => {
    const { name, ...input } = testCase;
    const expected = FIXTURE.positions[name];
    assert.ok(expected, `fixture is missing case ${name}`);

    const actual = positionsAtUT(input);

    for (const planet of PLANETS) {
      const e = expected.planets[planet];
      const a = actual.planets[planet];
      assert.ok(a, `${name}: ${planet} missing from the calculation`);
      closeTo(a.longitude, e.longitude, TOL_LONGITUDE_DEG, `${name} ${planet} longitude`);
      closeTo(a.speed, e.speed, TOL_SPEED_DEG_DAY, `${name} ${planet} speed`);
      // Sign, whole degrees, and retrograde state are discrete: they must match
      // exactly. A tolerance here would let a real sign-boundary error through.
      assert.equal(a.sign, e.sign, `${name} ${planet} sign`);
      assert.equal(a.degrees, e.degrees, `${name} ${planet} degree`);
      assert.equal(a.minutes, e.minutes, `${name} ${planet} minute`);
      assert.equal(a.retrograde, e.retrograde, `${name} ${planet} retrograde state`);
    }

    assert.equal(actual.houses.length, expected.houses.length, `${name} house count`);
    for (const eh of expected.houses) {
      const ah = actual.houses.find((h) => h.house === eh.house);
      assert.ok(ah, `${name}: house ${eh.house} missing`);
      closeTo(ah.longitude, eh.longitude, TOL_LONGITUDE_DEG, `${name} house ${eh.house} cusp`);
      assert.equal(ah.sign, eh.sign, `${name} house ${eh.house} sign`);
    }

    if (expected.ascendant) {
      closeTo(actual.ascendant.longitude, expected.ascendant.longitude, TOL_LONGITUDE_DEG, `${name} Ascendant`);
      assert.equal(actual.ascendant.sign, expected.ascendant.sign, `${name} Ascendant sign`);
      closeTo(actual.midheaven.longitude, expected.midheaven.longitude, TOL_LONGITUDE_DEG, `${name} Midheaven`);
      assert.equal(actual.midheaven.sign, expected.midheaven.sign, `${name} Midheaven sign`);
    } else {
      assert.equal(actual.ascendant, null, `${name} should have no Ascendant without houses`);
    }

    for (const [key, e] of Object.entries(expected.nodes)) {
      closeTo(actual.nodes[key].longitude, e.longitude, TOL_LONGITUDE_DEG, `${name} ${key} node`);
      assert.equal(actual.nodes[key].sign, e.sign, `${name} ${key} node sign`);
    }
  });
}

test("at least one fixture case contains a retrograde planet", () => {
  // Guards the guard: if no case ever had a retrograde, the retrograde
  // assertions above would be vacuously true on every platform.
  const anyRetrograde = Object.values(FIXTURE.positions)
    .some((c) => Object.values(c.planets).some((p) => p.retrograde));
  assert.ok(anyRetrograde, "the parity fixture must exercise retrograde motion");
});

// ── natal chart ─────────────────────────────────────────────────────────────

const PROFILE = {
  id: "00000000-0000-4000-8000-000000000001", nickname: "Parity Fixture",
  birth_date: "1990-06-15", birth_time: "14:30", time_accuracy: "exact",
  latitude: 41.8781, longitude: -87.6298, utc_offset_at_birth: "-05:00", house_system: "placidus",
};

test("natal chart matches the recorded fixture", () => {
  const chart = computeNatalChart(PROFILE);
  const e = FIXTURE.natal;
  closeTo(chart.planets.Sun.longitude, e.sun, TOL_LONGITUDE_DEG, "natal Sun");
  closeTo(chart.planets.Moon.longitude, e.moon, TOL_LONGITUDE_DEG, "natal Moon");
  closeTo(chart.angles.ascendant.longitude, e.ascendant, TOL_LONGITUDE_DEG, "natal Ascendant");
  closeTo(chart.angles.midheaven.longitude, e.midheaven, TOL_LONGITUDE_DEG, "natal Midheaven");
  assert.equal(chart.houses.length, e.houseCount, "natal house count");
  assert.equal(chart.aspects.length, e.aspectCount, "natal aspect count");
  assert.deepEqual(chart.retrogrades, e.retrogrades, "natal retrogrades");
  assert.deepEqual(chart.big_three, e.bigThree, "natal big three");
  assert.deepEqual(chart.element_balance, e.elementBalance, "element balance");
  assert.deepEqual(chart.modality_balance, e.modalityBalance, "modality balance");
  assert.equal(chart.calculation_status, e.calculationStatus, "calculation status");
});

test("unknown birth time filters houses and angles identically on every platform", () => {
  const chart = computeNatalChart({ ...PROFILE, birth_time: null, time_accuracy: "unknown" });
  const e = FIXTURE.natalUnknownTime;
  assert.equal(chart.time_known, e.timeKnown, "time_known");
  assert.equal(chart.houses.length, e.houseCount, "houses must not be produced without a birth time");
  assert.equal(Boolean(chart.angles?.ascendant), e.hasAscendant, "no Ascendant without a birth time");
  assert.deepEqual(chart.warnings, e.warnings, "warnings");
  // Planets are still computed — only time-dependent structures are withheld.
  closeTo(chart.planets.Sun.longitude, e.sun, TOL_LONGITUDE_DEG, "unknown-time natal Sun");
});

// ── current sky ─────────────────────────────────────────────────────────────

test("current sky matches the recorded fixture at a fixed instant", () => {
  const sky = currentSky(new Date(FIXTURE.instant));
  const e = FIXTURE.sky;
  closeTo(sky.planets.Sun.longitude, e.sun, TOL_LONGITUDE_DEG, "sky Sun");
  closeTo(sky.planets.Moon.longitude, e.moon, TOL_LONGITUDE_DEG, "sky Moon");
  assert.equal(sky.zodiac_season, e.zodiacSeason, "zodiac season");
  assert.equal(sky.moon.sign, e.moonSign, "moon sign");
  assert.equal(sky.moon.phase_name, e.moonPhase, "lunar phase");
  closeTo(sky.moon.illumination_percent, e.illumination, TOL_ILLUMINATION_PCT, "illumination");
  assert.deepEqual(sky.retrogrades, e.retrogrades, "sky retrogrades");
  assert.equal(sky.aspects.length, e.aspectCount, "sky aspect count");
  // The snapshot hash feeds the fortune seed. If it drifted between platforms,
  // the same user would get different readings on Mac and on Vercel.
  assert.equal(sky.snapshot_hash, e.snapshotHash, "sky snapshot hash must be platform-independent");
});

// ── transits: the evidence Ask Orbit stands on ──────────────────────────────

// The scope this fixture was recorded with, when the app carried its own copy
// of the transit calculation. It is passed explicitly so the fixture keeps
// proving what it was written to prove — that the numbers are identical — now
// that the engine's default scope has grown to include the outer planets,
// Chiron, the nodes, and the angles. Widening the fixture instead would have
// re-recorded it against the very code it exists to check.
const RECORDED_SCOPE = {
  bodies: ["Moon", "Sun", "Mercury", "Venus", "Mars", "Jupiter", "Saturn"],
  targets: ["Sun", "Moon", "Mercury", "Venus", "Mars", "Jupiter", "Saturn"],
};

test("personal transits match the recorded fixture, including applying state", () => {
  const chart = computeNatalChart(PROFILE);
  const sky = currentSky(new Date(FIXTURE.instant));
  const actual = personalTransits(sky, chart, 3, RECORDED_SCOPE);

  assert.equal(actual.length, FIXTURE.transits.length, "transit count");
  for (const [i, e] of FIXTURE.transits.entries()) {
    const a = actual[i];
    assert.equal(a.transiting, e.transiting, `transit ${i} transiting body`);
    assert.equal(a.natal, e.natal, `transit ${i} natal body`);
    assert.equal(a.aspect, e.aspect, `transit ${i} aspect type`);
    closeTo(a.orb, e.orb, TOL_LONGITUDE_DEG, `transit ${i} orb`);
    // applying vs separating is a discrete classification derived from speed;
    // a platform that disagreed here would tell users the opposite story.
    assert.equal(a.applying, e.applying, `transit ${i} applying/separating classification`);
  }
});

test("the transit fixture exercises both applying and separating aspects", () => {
  const applying = FIXTURE.transits.filter((t) => t.applying === true).length;
  const separating = FIXTURE.transits.filter((t) => t.applying === false).length;
  assert.ok(applying > 0 && separating > 0,
    `the fixture should contain both applying (${applying}) and separating (${separating}) transits`);
});
