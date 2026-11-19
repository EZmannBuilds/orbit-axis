// Orbit Axis :: Westcott's Sepher Yetzirah letters, and the historical
// meanings kept for reference.

import { test } from "node:test";
import assert from "node:assert/strict";

import { YETZIRAH_LETTERS, yetzirahLetter } from "../lib/esoteric/yetzirah.js";
import { MATHERS_MEANINGS, PAPUS_MEANINGS, historicalMeanings } from "../lib/tarot/historical-meanings.js";
import { CORRESPONDENCES, HEBREW_LETTERS } from "../lib/tarot/correspondences.js";
import { DRAFT_CARDS } from "../lib/tarot/draft-deck.js";

const goldenDawnByLetter = Object.fromEntries(
  Object.values(CORRESPONDENCES).filter((c) => c.arcana === "major").map((c) => [c.hebrew_letter.id, c.attribution]),
);

test("all 22 letters, keyed to the same ids as the tarot table", () => {
  assert.deepEqual(Object.keys(YETZIRAH_LETTERS).sort(), Object.keys(HEBREW_LETTERS).sort());
  for (const l of Object.values(YETZIRAH_LETTERS)) assert.equal(l.class, HEBREW_LETTERS[l.id].kind, l.id);
});

test("mothers and simples agree with the Golden Dawn; doubles are a labelled second tradition", () => {
  for (const l of Object.values(YETZIRAH_LETTERS)) {
    const gd = goldenDawnByLetter[l.id];
    if (l.class === "mother") assert.equal(l.element, gd.name, l.id);
    if (l.class === "simple") assert.equal(l.sign, gd.name, l.id);
    if (l.class === "double") assert.equal(l.tradition, "kalisch", l.id);
  }
  // They genuinely differ on the doubles: keep the Golden Dawn for the tarot.
  const differing = Object.values(YETZIRAH_LETTERS).filter((l) => l.class === "double" && l.planet !== goldenDawnByLetter[l.id].name);
  assert.ok(differing.length > 0);
  assert.equal(yetzirahLetter("beth").planet, "Moon");
  assert.equal(goldenDawnByLetter.beth.name, "Mercury");
});

test("no letter claims a direction, and every entry is marked modern and not for display", () => {
  for (const l of Object.values(YETZIRAH_LETTERS)) {
    assert.equal(l.direction, null);
    assert.equal(l.modern_supplement, true);
    assert.equal(l.display, false);
  }
});

test("Mathers covers all 78 cards; Papus the 22 trumps; none for display", () => {
  const slugs = DRAFT_CARDS.map((c) => c.slug).sort();
  assert.deepEqual(Object.keys(MATHERS_MEANINGS).sort(), slugs);
  const majors = DRAFT_CARDS.filter((c) => c.arcana === "major").map((c) => c.slug).sort();
  assert.deepEqual(Object.keys(PAPUS_MEANINGS).sort(), majors);
  for (const m of [...Object.values(MATHERS_MEANINGS), ...Object.values(PAPUS_MEANINGS)]) assert.equal(m.display, false);
  assert.equal(historicalMeanings("the-magician").mathers.name_in_source, "The Juggler");
  assert.equal(historicalMeanings("two-of-cups").papus, null);
  assert.equal(historicalMeanings("nope"), null);
});

test("nothing in the reading composer imports the historical meanings", async () => {
  const { readFileSync } = await import("node:fs");
  const src = readFileSync(new URL("../lib/tarot/scan-reading.js", import.meta.url), "utf8");
  assert.ok(!src.includes("historical-meanings"));
});
