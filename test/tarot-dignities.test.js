// Orbit Axis :: Book T's elemental dignities.
//
// The rule, from Book T "Of the Dignities": same suit beside a card
// strengthens it; an opposite nature beside it weakens it; Swords oppose
// Pentacles and Wands oppose Cups; a card between two mutual contraries is not
// much affected. Book T states no relation between Cups and Pentacles, and
// these tests hold that it stays unstated rather than guessed.

import { test } from "node:test";
import assert from "node:assert/strict";

import { RANK_COMBINATIONS, dignityAt, rankCombinations, suitRelation } from "../lib/tarot/dignities.js";
import { composeScanReading, dignityLine } from "../lib/tarot/scan-reading.js";

test("suit relations are exactly Book T's", () => {
  assert.equal(suitRelation("wands", "wands"), "same");
  assert.equal(suitRelation("swords", "pentacles"), "inimical");
  assert.equal(suitRelation("pentacles", "swords"), "inimical");
  assert.equal(suitRelation("wands", "cups"), "inimical");
  assert.equal(suitRelation("swords", "cups"), "friendly");
  assert.equal(suitRelation("swords", "wands"), "friendly");
  assert.equal(suitRelation("wands", "pentacles"), "friendly");
  assert.equal(suitRelation("cups", "pentacles"), "unstated");
  assert.equal(suitRelation("cups", null), null);
});

test("strengthened, weakened, unaffected, neutral", () => {
  assert.equal(dignityAt(["two-of-cups", "five-of-cups", "the-fool"], 1).state, "strengthened");
  assert.equal(dignityAt(["two-of-wands", "five-of-cups", "the-fool"], 1).state, "weakened");
  // Its own suit on one side and an opposed suit on the other: those two are
  // contrary to each other, so Book T's "not much affected" governs.
  assert.equal(dignityAt(["two-of-cups", "five-of-cups", "six-of-wands"], 1).state, "unaffected");
  // Swords and Pentacles on either side are contrary to each other.
  assert.equal(dignityAt(["two-of-swords", "five-of-cups", "six-of-pentacles"], 1).state, "unaffected");
  assert.equal(dignityAt(["two-of-swords", "five-of-cups", "the-fool"], 1).state, "neutral");
  assert.equal(dignityAt(["the-fool", "five-of-cups", "six-of-pentacles"], 1).state, "neutral");
  // A trump is outside the rule, and so is anything beside only trumps.
  assert.equal(dignityAt(["two-of-cups", "the-magician", "six-of-cups"], 1).state, "neutral");
  // End cards have one neighbour.
  assert.equal(dignityAt(["five-of-cups", "two-of-wands", "the-fool"], 0).state, "weakened");
});

test("dignity sentences appear only in multi-card spreads, and name the rule", () => {
  assert.equal(dignityLine(["two-of-wands", "five-of-cups", "the-fool"], 1),
    "By Book T's rule of elemental dignities, the Wands card beside it is of an opposite nature, which weakens it.");
  assert.equal(dignityLine(["two-of-wands", "five-of-cups", "three-of-wands"], 1),
    "By Book T's rule of elemental dignities, the Wands cards on both sides are of an opposite nature, which weakens it.");
  const three = composeScanReading({ cards: [{ slug: "two-of-cups", reversed: false }, { slug: "five-of-cups", reversed: false }, { slug: "the-fool", reversed: false }], spreadType: "three_card" });
  assert.match(three.positions[1].dignity, /strengthens it/);
  assert.ok(three.text.includes("strengthens it"));
  const one = composeScanReading({ cards: [{ slug: "five-of-cups", reversed: false }], spreadType: "one_card" });
  assert.equal(one.positions[0].dignity, null);
});

test("rank combinations are reference only, and use Waite-Smith names", () => {
  assert.equal(Object.keys(RANK_COMBINATIONS).length, 14);
  const found = rankCombinations(["ace-of-cups", "ace-of-wands", "ace-of-swords"]);
  assert.deepEqual(found, [{ rank: "ace", count: 3, gloss: "Riches, success.", source: "book_t", display: false }]);
  assert.deepEqual(rankCombinations(["ace-of-cups", "the-fool", "ace-of-swords"]), []);
  assert.equal(RANK_COMBINATIONS.knight[3], "Unexpected meetings. Knights, in general, shew news.");
});
