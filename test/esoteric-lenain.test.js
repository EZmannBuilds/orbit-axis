// Orbit Axis :: Lenain's 72 angels, and how they line up with Book T.

import { test } from "node:test";
import assert from "node:assert/strict";

import { LENAIN_ANGELS, bookTStartLongitude, lenainAngel } from "../lib/esoteric/lenain.js";
import { DECANS, SHEM_ANGELS } from "../lib/tarot/correspondences.js";

test("72 angels, numbered 1–72, each with an attribute and a psalm", () => {
  assert.equal(LENAIN_ANGELS.length, 72);
  LENAIN_ANGELS.forEach((a, i) => {
    assert.equal(a.number, i + 1);
    assert.ok(a.attribute_fr && a.attribute_en, `n° ${a.number}`);
    assert.ok(a.psalm, `n° ${a.number}`);
    assert.equal(a.display, false);
  });
});

test("the same names in the same order as Book T (allowing for spelling)", () => {
  // Compare a rough skeleton: first letter, ignoring the I/J/Y and C/K variants.
  const skeleton = (s) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/^[ijy]/, "i").replace(/^[ck]/, "k")[0];
  let agree = 0;
  for (const a of LENAIN_ANGELS) if (skeleton(a.name_lenain) === skeleton(SHEM_ANGELS[a.number - 1].name)) agree++;
  assert.ok(agree >= 68, `only ${agree}/72 names agree on their first letter`);
  assert.equal(lenainAngel(1).name_lenain, "Vehuiah");
});

test("Lenain starts at 0° Aries; Book T places the same angel 120° later", () => {
  assert.equal(lenainAngel(1).lenain_start_longitude, 0);
  assert.equal(lenainAngel(72).lenain_start_longitude, 355);
  // Book T: angels 1 and 2 are the decan from 0° Leo, the Five of Wands.
  assert.equal(bookTStartLongitude(1), 120);
  for (const d of DECANS) {
    const [a, b] = d.angels.map((x) => x.number);
    assert.equal(bookTStartLongitude(a), d.start_longitude, `angel ${a}`);
    assert.equal(bookTStartLongitude(b), d.start_longitude + 5, `angel ${b}`);
  }
});
