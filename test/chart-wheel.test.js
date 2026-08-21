// Orbit Axis :: the natal wheel's geometry, pinned.
//
// A wrongly drawn wheel is the worst kind of defect this app could ship: it
// looks authoritative, it prints, someone keeps it — and it is mirrored, or
// rotated, or has Mercury in the wrong house. None of that is visible without
// a second chart to compare against, so the comparison lives here instead.
//
// The chart is computed from the real engine rather than hand-written, because
// the numbers that matter (an Ascendant at 163.88°, a Placidus cusp that is not
// 30° from its neighbour) are exactly the ones a fixture would round into
// something too convenient to catch anything.

import { test } from "node:test";
import assert from "node:assert/strict";

import { computeNatalChart } from "@ezmannbuilds/orbit-axis-engine";
import {
  RADII, WHEEL_CENTRE, SIGN_GLYPHS, BODY_GLYPHS, BODY_ORDER, ASPECT_STYLE,
  angularDelta, chartWheelBodies, normalizeDegrees, pointOnWheel,
  renderChartWheel, spreadBodies, wheelAngle, wheelDescription, formatDegree,
} from "../public/chart-wheel.js";

const PROFILE = {
  birth_date: "1990-06-15",
  birth_time: "12:00",
  time_accuracy: "exact",
  latitude: 40.7128,
  longitude: -74.006,
  utc_offset_at_birth: "-04:00",
  house_system: "placidus",
};

const CHART = computeNatalChart(PROFILE);
const TIMELESS = computeNatalChart({ ...PROFILE, birth_time: undefined, time_accuracy: "unknown" });

const ASC = CHART.angles.ascendant.longitude;

/* ── Orientation ──────────────────────────────────────────────────────────────
   A natal wheel is not a compass, and the mirrored version of it looks entirely
   plausible. These four assertions are the whole defence against shipping one. */

test("the Ascendant sits at the left of the wheel", () => {
  const p = pointOnWheel(RADII.outer, wheelAngle(ASC, ASC));
  assert.ok(p.x < WHEEL_CENTRE - RADII.outer + 1, `Ascendant drawn at x=${p.x}, expected the left rim`);
  assert.ok(Math.abs(p.y - WHEEL_CENTRE) < 1, `Ascendant drawn at y=${p.y}, expected the vertical centre`);
});

test("the zodiac runs counterclockwise, so a quarter past the Ascendant is the bottom", () => {
  // SVG's y-axis points down, so "counterclockwise on screen" is the direction
  // a naive cos/sin sweep gets backwards. +90° of longitude is the IC.
  const p = pointOnWheel(RADII.outer, wheelAngle(ASC + 90, ASC));
  assert.ok(Math.abs(p.x - WHEEL_CENTRE) < 1, `expected the horizontal centre, got x=${p.x}`);
  assert.ok(p.y > WHEEL_CENTRE + RADII.outer - 1, `expected the bottom, got y=${p.y}`);
});

test("the Descendant is opposite the Ascendant, and the MC is near the top", () => {
  const dsc = pointOnWheel(RADII.outer, wheelAngle(ASC + 180, ASC));
  assert.ok(dsc.x > WHEEL_CENTRE + RADII.outer - 1, `Descendant should be at the right rim, got x=${dsc.x}`);

  // "Near" the top, not at it: only in a whole-sign or equal-house chart is the
  // MC exactly 90° from the Ascendant. Placidus at 40°N puts it some way off,
  // and a test demanding exactness would be asserting the wrong astrology.
  const mc = pointOnWheel(RADII.outer, wheelAngle(CHART.angles.midheaven.longitude, ASC));
  assert.ok(mc.y < WHEEL_CENTRE, `MC should be in the upper half, got y=${mc.y}`);
});

test("a body's angle depends only on its distance from the Ascendant", () => {
  // Rotating the whole chart must move everything together — the relationship
  // between two placements is the thing a wheel exists to show.
  for (const asc of [0, 47.5, 163.886, 359.9]) {
    assert.equal(
      Math.round(angularDelta(wheelAngle(100, asc), wheelAngle(130, asc)) * 1e6) / 1e6,
      -30,
      "30° of longitude must always be 30° of wheel, whatever the rotation",
    );
  }
});

/* ── Bodies ───────────────────────────────────────────────────────────────── */

test("every planet and point the reading discusses is on the wheel", () => {
  const bodies = chartWheelBodies(CHART, ASC);
  const keys = bodies.map((b) => b.key);
  for (const planet of Object.keys(CHART.planets)) {
    assert.ok(keys.includes(planet), `${planet} is missing from the wheel`);
  }
  assert.ok(keys.includes("Chiron"), "Chiron is discussed in the reading and must be drawn");
  assert.ok(keys.includes("TrueLilith"), "True Lilith is discussed in the reading and must be drawn");
  // The mean Lilith is deliberately absent: two Liliths a few degrees apart
  // reads as an error rather than as a choice.
  assert.ok(!keys.includes("Lilith"), "the mean Lilith must not be drawn alongside the true one");
});

test("bodies carry their house, and True Lilith is labelled readably", () => {
  const bodies = chartWheelBodies(CHART, ASC);
  const sun = bodies.find((b) => b.key === "Sun");
  assert.equal(sun.house, CHART.planet_houses.Sun);
  assert.equal(bodies.find((b) => b.key === "TrueLilith").label, "True Lilith");
});

test("a body's true angle matches its longitude", () => {
  const bodies = chartWheelBodies(CHART, ASC);
  for (const body of bodies) {
    assert.equal(body.trueAngle, wheelAngle(body.longitude, ASC));
  }
});

/* ── Crowding ─────────────────────────────────────────────────────────────── */

test("glyphs that would overlap are nudged apart", () => {
  // A stellium: four bodies inside three degrees, which drawn honestly is an
  // inkblot. This is the single most likely way a printed wheel becomes
  // useless, so it gets the most direct test in the file.
  const crowded = [
    { key: "Sun", trueAngle: 100 },
    { key: "Mercury", trueAngle: 101 },
    { key: "Venus", trueAngle: 102 },
    { key: "Mars", trueAngle: 102.5 },
  ];
  const placed = spreadBodies(crowded, { minSeparation: 8 });
  assert.equal(placed.length, 4);

  for (let i = 0; i < placed.length; i += 1) {
    for (let j = i + 1; j < placed.length; j += 1) {
      const gap = Math.abs(angularDelta(placed[i].angle, placed[j].angle));
      assert.ok(gap > 7.9, `${placed[i].key} and ${placed[j].key} are only ${gap.toFixed(2)}° apart`);
    }
  }
});

test("nudging keeps the true angle, so the drawing can admit it moved", () => {
  const placed = spreadBodies([
    { key: "Sun", trueAngle: 100 },
    { key: "Mercury", trueAngle: 101 },
  ], { minSeparation: 10 });
  for (const body of placed) {
    assert.ok(Number.isFinite(body.trueAngle), "the true angle must survive the nudge");
  }
  assert.deepEqual(placed.map((b) => b.trueAngle).sort(), [100, 101]);
});

test("an uncrowded chart is left exactly where it belongs", () => {
  const spaced = [
    { key: "Sun", trueAngle: 0 },
    { key: "Moon", trueAngle: 90 },
    { key: "Mars", trueAngle: 180 },
    { key: "Pluto", trueAngle: 270 },
  ];
  for (const body of spreadBodies(spaced, { minSeparation: 8 })) {
    assert.equal(body.angle, body.trueAngle, `${body.key} was moved for no reason`);
  }
});

test("crowding across 0° is not a special case", () => {
  // The wrap-around pair is where an implementation that sorts and walks
  // forwards without closing the circle silently stops separating.
  const placed = spreadBodies([
    { key: "a", trueAngle: 358 },
    { key: "b", trueAngle: 359 },
    { key: "c", trueAngle: 1 },
  ], { minSeparation: 8 });
  for (let i = 0; i < placed.length; i += 1) {
    for (let j = i + 1; j < placed.length; j += 1) {
      const gap = Math.abs(angularDelta(placed[i].angle, placed[j].angle));
      assert.ok(gap > 7.9, `${placed[i].key}/${placed[j].key} only ${gap.toFixed(2)}° apart across the wrap`);
    }
  }
});

test("more bodies than the circle can hold still terminates", () => {
  // 60 bodies at 8° apart needs 480° of circle. The separation shrinks rather
  // than the loop spinning: a slightly imperfect wheel beats a hung page.
  const many = Array.from({ length: 60 }, (_, i) => ({ key: `b${i}`, trueAngle: 100 + i * 0.1 }));
  const placed = spreadBodies(many, { minSeparation: 8 });
  assert.equal(placed.length, 60);
  for (const body of placed) assert.ok(Number.isFinite(body.angle));
});

test("the spread is deterministic", () => {
  const bodies = chartWheelBodies(CHART, ASC);
  const a = spreadBodies(bodies).map((b) => `${b.key}:${b.angle.toFixed(6)}`);
  const b = spreadBodies(bodies).map((x) => `${x.key}:${x.angle.toFixed(6)}`);
  assert.deepEqual(a, b);
});

/* ── The drawn SVG ────────────────────────────────────────────────────────── */

test("the wheel renders every body, sign and house", () => {
  const svg = renderChartWheel(CHART);
  for (const key of BODY_ORDER) {
    assert.ok(svg.includes(`data-body="${key}"`), `${key} is not in the rendered wheel`);
  }
  for (const glyph of Object.values(SIGN_GLYPHS)) {
    assert.ok(svg.includes(glyph), `the ${glyph} sign glyph is missing`);
  }
  // Twelve house numbers, as their own text nodes.
  for (let house = 1; house <= 12; house += 1) {
    assert.ok(svg.includes(`class="ow-house-number"`), "house numbers must be drawn");
  }
  assert.ok(svg.includes(">ASC<") && svg.includes(">MC<"), "the angles must be named in words");
});

test("every glyph carries the text-presentation selector", () => {
  // Without U+FE0E these arrive as colour emoji tiles on Apple platforms —
  // the exact failure tokens.css documents for the rest of the interface.
  const svg = renderChartWheel(CHART);
  for (const glyph of [...Object.values(SIGN_GLYPHS), ...Object.values(BODY_GLYPHS)]) {
    if (!svg.includes(glyph)) continue;
    assert.ok(svg.includes(`${glyph}︎`), `${glyph} is missing its text-presentation selector`);
  }
});

test("aspect type is carried by line style, not by colour alone", () => {
  // The wheel is built to be printed, including in greyscale, and to be read by
  // people who do not distinguish the two aspect colours.
  const byDash = new Map();
  for (const [name, style] of Object.entries(ASPECT_STYLE)) {
    const signature = `${style.dash}|${style.width}`;
    assert.ok(!byDash.has(signature),
      `${name} and ${byDash.get(signature)} are distinguishable only by colour`);
    byDash.set(signature, name);
  }
});

test("aspects are only drawn between bodies that are actually on the wheel", () => {
  // The engine aspects the Ascendant and MC too. Those are cusps, not points
  // inside the circle, so a chord to one would be a line from nowhere.
  const svg = renderChartWheel(CHART);
  const chords = svg.match(/class="ow-aspect [^"]*"/g) || [];
  const drawable = CHART.aspects.filter((a) => ASPECT_STYLE[a.aspect]
    && BODY_ORDER.includes(a.a) && BODY_ORDER.includes(a.b));
  assert.equal(chords.length, drawable.length);
  assert.ok(CHART.aspects.some((a) => a.a === "Ascendant" || a.b === "Ascendant"
    || a.a === "MC" || a.b === "MC"), "this chart should exercise the exclusion");
});

test("the wheel is valid, self-contained SVG", () => {
  const svg = renderChartWheel(CHART);
  assert.ok(svg.startsWith("<svg "), "must be an svg element");
  assert.ok(svg.endsWith("</svg>"), "must be closed");
  assert.ok(svg.includes('xmlns="http://www.w3.org/2000/svg"'), "needs a namespace to stand alone");
  assert.equal((svg.match(/<svg/g) || []).length, 1);
  // No external references: a printed wheel cannot fetch anything.
  assert.ok(!/(?:href|src)=/.test(svg), "the wheel must not reference anything external");
});

test("two wheels on one page do not collide over ids", () => {
  const a = renderChartWheel(CHART, { titleId: "print-t", descId: "print-d" });
  assert.ok(a.includes('id="print-t"') && a.includes('aria-labelledby="print-t print-d"'));
});

/* ── The chart nobody has a birth time for ────────────────────────────────── */

test("a chart with no birth time is drawn without houses, not with fake ones", () => {
  // `houses: []` is what the engine returns, and twelve equal sectors would
  // imply a precision nobody has. The placements are still exactly right
  // relative to one another; only the houses are unavailable.
  assert.equal(TIMELESS.houses.length, 0, "the fixture must actually be timeless");
  const svg = renderChartWheel(TIMELESS);
  assert.ok(!svg.includes("ow-cusp"), "no house cusps may be drawn without a birth time");
  assert.ok(!svg.includes("ow-house-number"), "no house numbers may be drawn without a birth time");
  // Everything else still renders.
  assert.ok(svg.includes('data-body="Sun"'), "the Sun is known whether or not the time is");
  for (const glyph of Object.values(SIGN_GLYPHS)) assert.ok(svg.includes(glyph));
});

test("a timeless wheel says why it has no houses", () => {
  const bodies = chartWheelBodies(TIMELESS, 0);
  const description = wheelDescription(TIMELESS, bodies);
  assert.match(description, /birth time is not known/);
  assert.match(description, /Aries is at the left/);
});

test("a missing Ascendant falls back to 0° Aries rather than throwing", () => {
  assert.doesNotThrow(() => renderChartWheel(TIMELESS));
  assert.equal(wheelAngle(0, 0), 180, "0° Aries belongs at the left when there is no Ascendant");
});

/* ── The wheel for someone who cannot see it ──────────────────────────────── */

test("the description carries the same facts as the drawing", () => {
  const bodies = chartWheelBodies(CHART, ASC);
  const description = wheelDescription(CHART, bodies);
  for (const body of bodies) {
    assert.ok(description.includes(body.label), `${body.label} is missing from the description`);
    assert.ok(description.includes(formatDegree(body)), `${body.label}'s degree is missing`);
  }
  assert.ok(description.includes(CHART.angles.ascendant.sign), "the rising sign must be stated");
});

test("retrogrades are stated in words, not only as a symbol", () => {
  const bodies = chartWheelBodies(CHART, ASC);
  const retro = bodies.filter((b) => b.retrograde);
  assert.ok(retro.length > 0, "this chart should have a retrograde to exercise the branch");
  const description = wheelDescription(CHART, bodies);
  assert.ok(description.includes("retrograde"));
});

/* ── Housekeeping ─────────────────────────────────────────────────────────── */

test("degrees wrap rather than run off the end", () => {
  assert.equal(normalizeDegrees(370), 10);
  assert.equal(normalizeDegrees(-10), 350);
  assert.equal(normalizeDegrees(0), 0);
  assert.equal(normalizeDegrees(NaN), 0);
});

test("a null chart renders nothing rather than half a wheel", () => {
  assert.equal(renderChartWheel(null), "");
  assert.deepEqual(chartWheelBodies(null), []);
});
