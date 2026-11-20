// Orbit Axis :: source rows handed to the model in study mode.

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  agrippaDecanRow, cardRow, decanRow, lenainRow, liber777KeyRow, lillyRow, mansionRow, renderRows, starRow, suitPairRow, westcottRow,
} from "../lib/esoteric/retrieval.js";
import { BEHENIAN_STARS } from "../lib/esoteric/agrippa.js";
import { CORRESPONDENCE_SLUGS, SIGN_ORDER } from "../lib/tarot/correspondences.js";
import { YETZIRAH_LETTERS } from "../lib/esoteric/yetzirah.js";

test("every lookup returns a row for every real key, and null for an unknown one", () => {
  for (const slug of CORRESPONDENCE_SLUGS) assert.ok(cardRow(slug)?.lines.length, slug);
  for (const sign of SIGN_ORDER) {
    assert.ok(lillyRow(sign));
    for (const i of [0, 1, 2]) { assert.ok(decanRow(sign, i)); assert.ok(agrippaDecanRow(sign, i + 1)); }
  }
  for (let n = 1; n <= 28; n++) assert.ok(mansionRow(n));
  for (let k = 1; k <= 32; k++) assert.ok(liber777KeyRow(k));
  for (let n = 1; n <= 72; n++) assert.ok(lenainRow(n));
  for (const s of BEHENIAN_STARS) assert.ok(starRow(s.name));
  for (const id of Object.keys(YETZIRAH_LETTERS)) assert.ok(westcottRow(id));
  assert.equal(cardRow("nope"), null);
  assert.equal(lillyRow("Ophiuchus"), null);
  assert.equal(mansionRow(29), null);
  assert.equal(liber777KeyRow(33), null);
  assert.equal(lenainRow(73), null);
  assert.equal(suitPairRow("wands", null), null);
});

test("rows carry the facts from the tables", () => {
  const moon = cardRow("the-moon", "The Moon");
  assert.ok(moon.lines.some((l) => l.includes("sign Pisces")));
  assert.ok(moon.lines.some((l) => l.includes("Qoph")));
  assert.ok(decanRow("Gemini", 2, (s) => s).lines.includes("card: ten-of-swords"));
  assert.ok(lillyRow("Aries").lines.includes("exaltation: Sun at 19°"));
  assert.ok(suitPairRow("cups", "pentacles").lines[0].includes("not stated"));
});

test("Lenain rows give both placements in sign and degree, with sign ends read as 30°", () => {
  const first = lenainRow(1).lines;
  assert.ok(first.includes("Lenain's place: 0° Aries to 5° Aries"));
  assert.ok(first.includes("Book T's place for the same angel: 0° Leo to 5° Leo"));
  assert.ok(lenainRow(6).lines.includes("Lenain's place: 25° Aries to 30° Aries"));
  assert.ok(lenainRow(7).lines.includes("Lenain's place: 0° Taurus to 5° Taurus"));
});

test("rendered rows name their source", () => {
  const text = renderRows([lillyRow("Leo"), null, mansionRow(1)]);
  assert.match(text, /\[Lilly, Christian Astrology \(1647\): Leo\]/);
  assert.match(text, /\[Agrippa.*: mansion 1 of the Moon\]/);
});
