// Orbit Axis :: study-only language must not leak into readings.

import { test } from "node:test";
import assert from "node:assert/strict";

import { STUDY_PHRASE_COUNT, studyLeaks } from "../lib/esoteric/study-language.js";
import { PRODUCTION_CARDS } from "../lib/tarot/deck.js";
import { checkWovenText, composeScanReading } from "../lib/tarot/scan-reading.js";

test("thousands of study phrases are indexed", () => {
  assert.ok(STUDY_PHRASE_COUNT > 1000, String(STUDY_PHRASE_COUNT));
});

test("no false alarms on any approved card text, or on any composed reading", () => {
  for (const card of PRODUCTION_CARDS) {
    for (const t of [card.upright_meaning, card.reversed_meaning, card.reflection_prompt, card.reversed_prompt]) {
      assert.deepEqual(studyLeaks(t), [], `${card.slug}: ${t}`);
    }
    for (const reversed of [false, true]) {
      const r = composeScanReading({ cards: [{ slug: card.slug, reversed }], spreadType: "one_card" });
      assert.deepEqual(studyLeaks(r.text), [], card.slug);
    }
  }
});

test("Agrippa, Lenain and Book T's glosses are caught in a rewrite", () => {
  assert.ok(studyLeaks("It signifieth and causeth boldness, fortitude, loftiness and shamelesness.").length > 0);
  assert.ok(studyLeaks("Society of the young gathers here.").length > 0);
  const r = composeScanReading({ cards: [{ slug: "two-of-wands", reversed: false }], spreadType: "one_card" });
  const bad = checkWovenText(r, `${r.text} It causeth boldness, fortitude, loftiness and shamelesness.`);
  assert.equal(bad.ok, false);
  assert.match(bad.reasons.join(), /study-only language/);
  assert.equal(checkWovenText(r, r.text).ok, true);
});
