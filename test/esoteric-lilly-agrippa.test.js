// Orbit Axis :: Lilly's essential dignities and Agrippa's tables.
//
// Both were transcribed by reading the sources (see lib/esoteric/sources/*.json).
// These tests check the transcriptions against structure the tradition fixes,
// and against the Golden Dawn tables read independently from Book T: Lilly's
// "faces" and Book T's decan rulers are the same Chaldean sequence, so the two
// sources must agree on all 36.

import { test } from "node:test";
import assert from "node:assert/strict";

import { DIGNITY_TABLE, LILLY_SCORES, SIGN_ORDER as LILLY_SIGNS, essentialDignity, signStanding } from "../lib/esoteric/lilly.js";
import { BEHENIAN_STARS, DECAN_IMAGES, LUNAR_MANSIONS, decanImage, mansionAt } from "../lib/esoteric/agrippa.js";
import { DECANS, SIGN_ORDER } from "../lib/tarot/correspondences.js";

test("Lilly: twelve signs in zodiac order", () => {
  assert.deepEqual([...LILLY_SIGNS], [...SIGN_ORDER]);
});

test("Lilly: five terms per sign, increasing, ending at 30", () => {
  for (const sign of SIGN_ORDER) {
    const terms = DIGNITY_TABLE[sign].terms;
    assert.equal(terms.length, 5, sign);
    for (let i = 1; i < 5; i++) assert.ok(terms[i].to_degree > terms[i - 1].to_degree, sign);
    assert.equal(terms[4].to_degree, 30, sign);
  }
});

test("Lilly's faces agree with Book T's decan rulers on all 36", () => {
  for (const d of DECANS) assert.equal(DIGNITY_TABLE[d.sign].faces[d.index], d.ruler, `${d.sign} face ${d.index + 1}`);
});

test("Lilly: domiciles, detriments, exaltations and falls are the classical pattern", () => {
  const domicile = { Aries: "Mars", Taurus: "Venus", Gemini: "Mercury", Cancer: "Moon", Leo: "Sun", Virgo: "Mercury", Libra: "Venus", Scorpio: "Mars", Sagittarius: "Jupiter", Capricorn: "Saturn", Aquarius: "Saturn", Pisces: "Jupiter" };
  for (const [sign, planet] of Object.entries(domicile)) {
    assert.equal(DIGNITY_TABLE[sign].domicile, planet, sign);
    // Detriment is the domicile ruler of the opposite sign.
    const opposite = SIGN_ORDER[(SIGN_ORDER.indexOf(sign) + 6) % 12];
    assert.equal(DIGNITY_TABLE[opposite].detriment, planet, `${planet} in ${opposite}`);
  }
  // A planet's fall is the sign opposite its exaltation.
  for (const sign of SIGN_ORDER) {
    const ex = DIGNITY_TABLE[sign].exaltation;
    if (!ex || !["Saturn", "Jupiter", "Mars", "Sun", "Venus", "Mercury", "Moon"].includes(ex.planet)) continue;
    const opposite = SIGN_ORDER[(SIGN_ORDER.indexOf(sign) + 6) % 12];
    assert.equal(DIGNITY_TABLE[opposite].fall, ex.planet, `${ex.planet} falls in ${opposite}`);
  }
  assert.deepEqual(DIGNITY_TABLE.Aries.exaltation, { planet: "Sun", degree: 19 });
});

test("Lilly: scoring as printed on p. 115", () => {
  assert.deepEqual(
    [LILLY_SCORES.domicile, LILLY_SCORES.exaltation, LILLY_SCORES.triplicity, LILLY_SCORES.term, LILLY_SCORES.face, LILLY_SCORES.detriment, LILLY_SCORES.fall, LILLY_SCORES.peregrine],
    [5, 4, 3, 2, 1, -5, -4, -5],
  );
});

test("essentialDignity: worked examples", () => {
  // Mars at 3° Aries: house, and the first face. Term at 3° Aries is Jupiter's.
  const mars = essentialDignity("Mars", 3);
  assert.deepEqual(mars.dignities, ["house", "face"]);
  assert.equal(mars.score, 6);
  // The Sun at 19° Aries by day: exaltation, triplicity, and the second face.
  const sun = essentialDignity("Sun", 19, { day: true });
  assert.ok(sun.dignities.includes("exaltation") && sun.dignities.includes("triplicity") && sun.dignities.includes("face"));
  // Venus in Aries is in detriment; Saturn in Aries is in fall.
  assert.deepEqual(essentialDignity("Venus", 2).debilities, ["detriment"]);
  assert.deepEqual(essentialDignity("Saturn", 25).debilities, ["fall"]);
  assert.equal(essentialDignity("Pluto", 0), null);
  assert.equal(signStanding("Mars", "Aries"), "house");
  assert.equal(signStanding("Venus", "Scorpio"), "detriment");
  assert.equal(signStanding("Jupiter", "Aries"), null);
});

test("Agrippa: 36 decan images, 28 mansions, 15 Behenian stars, all marked not for display", () => {
  assert.equal(DECAN_IMAGES.length, 36);
  assert.equal(LUNAR_MANSIONS.length, 28);
  assert.equal(BEHENIAN_STARS.length, 15);
  for (const sign of SIGN_ORDER) for (const face of [1, 2, 3]) assert.ok(decanImage(sign, face)?.image, `${sign} ${face}`);
  assert.deepEqual(LUNAR_MANSIONS.map((m) => m.number), Array.from({ length: 28 }, (_, i) => i + 1));
  for (const x of [...DECAN_IMAGES, ...LUNAR_MANSIONS, ...BEHENIAN_STARS]) assert.equal(x.display, false);
});

test("Agrippa: mansionAt divides the zodiac into 28 equal parts from 0° Aries", () => {
  assert.equal(mansionAt(0).number, 1);
  assert.equal(mansionAt(12.8).number, 1);
  assert.equal(mansionAt(12.86).number, 2);
  assert.equal(mansionAt(359.9).number, 28);
  assert.equal(mansionAt(90).number, 8); // "begin from Cancer"
  assert.equal(mansionAt(180).number, 15); // "the head of Libra"
  assert.equal(mansionAt(270).number, 22); // "the head of Capricorn"
  assert.match(mansionAt(0).computed_by, /equal division/);
});
