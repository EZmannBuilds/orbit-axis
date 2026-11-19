// Orbit Axis :: Liber 777 columns.

import { test } from "node:test";
import assert from "node:assert/strict";

import { LIBER777, liber777Row } from "../lib/esoteric/liber777.js";
import { CORRESPONDENCES, SEPHIROTH } from "../lib/tarot/correspondences.js";

test("keys 1–32, Sephiroth then paths, named to match the tarot table", () => {
  assert.deepEqual(Object.keys(LIBER777).map(Number), Array.from({ length: 32 }, (_, i) => i + 1));
  for (let n = 1; n <= 10; n++) assert.equal(liber777Row(n).name, SEPHIROTH[n].name, `key ${n}`);
  const byPath = Object.fromEntries(Object.values(CORRESPONDENCES).filter((c) => c.arcana === "major").map((c) => [c.path.number, c.hebrew_letter]));
  // 777 spells some letters differently (Beth/Beth, Zain/Zayin, Teth/Teth ...); compare the first letter and the path.
  for (let n = 11; n <= 32; n++) assert.equal(liber777Row(n).name[0].toLowerCase(), byPath[n].name[0].toLowerCase(), `key ${n}`);
});

test("the colour scales and correspondences are filled for every key", () => {
  for (const row of Object.values(LIBER777)) {
    for (const col of ["king_scale", "queen_scale", "prince_scale", "princess_scale", "stones", "plants", "animals", "perfumes", "weapons"]) {
      assert.ok(row[col], `key ${row.key} ${col}`);
    }
    assert.equal(row.display, false);
  }
});

test("spot checks read from the 1909 scan", () => {
  assert.equal(liber777Row(11).weapons, "The Dagger or Fan");
  assert.equal(liber777Row(11).stones, "Topaz, Chalcedony");
  assert.equal(liber777Row(3).roman_gods, "Juno, Cybele, Saturn, Hecate, &c.");
  assert.equal(liber777Row(1).archangel !== null, true);
  assert.equal(liber777Row(11).archangel, null); // archangels are given for the Sephiroth only
});

test("no 777 Revised (1955) additions are in the data", () => {
  for (const row of Object.values(LIBER777)) {
    assert.equal(row.revised_additions, undefined);
    for (const v of Object.values(row)) if (typeof v === "string") assert.ok(!v.includes("[["), `key ${row.key}`);
  }
  assert.equal(liber777Row(33), null);
});
