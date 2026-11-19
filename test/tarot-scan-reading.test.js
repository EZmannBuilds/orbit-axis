// Orbit Axis :: the scan-reading composer.
//
// The rules these tests hold:
//   - the same input gives the same reading, byte for byte
//   - the meaning comes from the approved deck, in the card's orientation
//   - every card in both orientations passes the forbidden-content audit
//   - sky facts appear only when an engine snapshot is supplied
//   - a model's rewrite is refused if it adds a card or a forbidden claim
//   - bad input is refused, never repaired

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  ScanReadingError, auditReadingText, checkWovenText, composeScanReading,
  correspondenceLine, skyLinks, validateScanCards,
} from "../lib/tarot/scan-reading.js";
import { PRODUCTION_CARDS, cardBySlug } from "../lib/tarot/deck.js";

// A fixed snapshot in the shape of the engine's currentSky(). Hand-written, so
// the tests run anywhere, including platforms the engine does not support.
const SKY = Object.freeze({
  instant_utc: "2026-11-19T12:00:00.000Z",
  planets: {
    Sun: { longitude: 237.2 }, // 27° Scorpio: the Seven of Cups' decan
    Moon: { longitude: 5.5 }, // 5° Aries
    Mercury: { longitude: 250.1, retrograde: true },
    Venus: { longitude: 220 },
    Mars: { longitude: 3 }, // 3° Aries: inside the Two of Wands' decan
    Jupiter: { longitude: 110 },
    Saturn: { longitude: 355 },
    Uranus: { longitude: 57 }, // ignored: no card in this system
  },
  retrogrades: ["Mercury"],
});

const three = (cards, extra = {}) => composeScanReading({ cards, spreadType: "three_card", ...extra });

test("deterministic: same input, identical output", () => {
  const cards = [{ slug: "two-of-wands", reversed: false }, { slug: "the-magician", reversed: true }, { slug: "queen-of-wands", reversed: false }];
  assert.deepEqual(three(cards, { sky: SKY }), three(cards, { sky: SKY }));
  assert.equal(JSON.stringify(three(cards, { sky: SKY })), JSON.stringify(three(cards, { sky: SKY })));
});

test("the meaning is the deck's own text, in the card's orientation", () => {
  const r = three([{ slug: "the-magician", reversed: true }, { slug: "the-fool", reversed: false }, { slug: "death", reversed: false }]);
  const magician = cardBySlug(PRODUCTION_CARDS, "the-magician");
  const fool = cardBySlug(PRODUCTION_CARDS, "the-fool");
  assert.equal(r.positions[0].orientation, "reversed");
  assert.equal(r.positions[0].meaning, magician.reversed_meaning);
  assert.equal(r.positions[0].reflection_prompt, magician.reversed_prompt);
  assert.equal(r.positions[1].meaning, fool.upright_meaning);
  assert.ok(!r.text.includes(fool.reversed_meaning));
  assert.ok(r.text.includes("The Magician, reversed."));
});

test("every card, upright and reversed, composes and passes the content audit", () => {
  for (const card of PRODUCTION_CARDS) {
    for (const reversed of [false, true]) {
      const r = composeScanReading({ cards: [{ slug: card.slug, reversed }], spreadType: "one_card", sky: SKY });
      assert.deepEqual(auditReadingText(r.text), [], `${card.slug} ${reversed ? "reversed" : "upright"}`);
      assert.ok(r.positions[0].correspondence, card.slug);
    }
  }
});

test("positions use the deck's labels, reflective by default", () => {
  const cards = [{ slug: "the-fool", reversed: false }, { slug: "the-sun", reversed: false }, { slug: "the-moon", reversed: false }];
  assert.deepEqual(three(cards).positions.map((p) => p.position), ["What shaped this", "What is present", "What to consider next"]);
  assert.deepEqual(three(cards, { positionSet: "timeline" }).positions.map((p) => p.position), ["Past", "Present", "Future"]);
  assert.equal(composeScanReading({ cards: [cards[0]], spreadType: "daily" }).positions[0].position, "Today's card");
});

test("correspondence lines state facts from the table", () => {
  assert.match(correspondenceLine("two-of-wands"), /The Lord of Dominion\. Mars \(drive and assertion\) in the first decan of Aries, 0° to 10° Aries, in Chokmah \(Wisdom\) of Atziluth\./);
  assert.match(correspondenceLine("the-fool"), /element Air.*letter Aleph \(ox\).*path 11.*between Kether and Chokmah/);
  assert.match(correspondenceLine("queen-of-wands"), /Water of Fire, ruling 20° Pisces to 20° Aries/);
  assert.match(correspondenceLine("page-of-cups"), /Earth of Water, the throne of the Ace of Cups/);
  assert.match(correspondenceLine("ace-of-swords"), /Root of the Powers of the Air.*Yetzirah/);
  assert.match(correspondenceLine("the-world"), /planet Saturn and to Earth/);
});

test("sky links appear only with a sky, and name only real positions", () => {
  assert.deepEqual(skyLinks("two-of-wands", null), []);
  assert.deepEqual(skyLinks("two-of-wands", {}), []);
  const two = skyLinks("two-of-wands", SKY);
  assert.ok(two.includes("Today Mars is in this card's decan (3° Aries)."));
  assert.ok(two.includes("Today the Moon is in this card's decan (5° Aries)."));
  // Mars is already named as being in the decan; it is not repeated as "the ruler".
  assert.equal(two.filter((l) => l.includes("Mars")).length, 1);
  assert.deepEqual(skyLinks("seven-of-cups", SKY), ["Today the Sun is in this card's decan (27° Scorpio).", "Venus, the ruler of this card's decan, is at 10° Scorpio today."]);
  assert.deepEqual(skyLinks("the-magician", SKY), ["Mercury, this card's planet, is at 10° Sagittarius, retrograde today."]);
  assert.deepEqual(skyLinks("death", SKY), ["Today the Sun is in Scorpio, this card's sign (27° Scorpio).", "Today Venus is in Scorpio, this card's sign (10° Scorpio)."]);
  // Outer planets have no card here, so Uranus at 27° Taurus links nothing.
  assert.ok(!skyLinks("the-hierophant", SKY).some((l) => l.includes("Uranus")));
});

test("a reading without a sky has no engine source and no sky sentences", () => {
  const r = composeScanReading({ cards: [{ slug: "two-of-wands", reversed: false }], spreadType: "one_card" });
  assert.deepEqual(r.positions[0].sky_links, []);
  assert.ok(!r.sources.includes("engine"));
  assert.equal(r.sky_instant_utc, null);
  const s = composeScanReading({ cards: [{ slug: "two-of-wands", reversed: false }], spreadType: "one_card", sky: SKY });
  assert.ok(s.sources.includes("engine"));
  assert.equal(s.sky_instant_utc, SKY.instant_utc);
});

test("bad input is refused with a code, never repaired", () => {
  const code = (fn) => { try { fn(); } catch (e) { assert.ok(e instanceof ScanReadingError); return e.code; } return "no error"; };
  const ok = { slug: "the-fool", reversed: false };
  assert.equal(code(() => validateScanCards([ok], "nope")), "invalid_spread");
  assert.equal(code(() => validateScanCards("x", "one_card")), "invalid_cards");
  assert.equal(code(() => validateScanCards([ok, ok], "one_card")), "wrong_card_count");
  assert.equal(code(() => validateScanCards([{ slug: "the-joker", reversed: false }], "one_card")), "unknown_card");
  assert.equal(code(() => validateScanCards([{ slug: "the-fool", reversed: "yes" }], "one_card")), "invalid_orientation");
  assert.equal(code(() => validateScanCards([ok, ok, { slug: "death", reversed: false }], "three_card")), "duplicate_card");
  assert.equal(code(() => validateScanCards([null], "one_card")), "invalid_cards");
});

test("woven text: accepted when faithful, refused when it adds a card or a claim", () => {
  const r = three([{ slug: "two-of-wands", reversed: false }, { slug: "the-magician", reversed: true }, { slug: "death", reversed: false }], { sky: SKY });
  assert.deepEqual(checkWovenText(r, "Two of Wands, the Magician reversed, and Death sit together; the Sun is in Scorpio."), { ok: true, reasons: [] });
  const added = checkWovenText(r, "Two of Wands and the Magician, and the Tower looms behind Death.");
  assert.equal(added.ok, false);
  assert.match(added.reasons.join(), /the-tower/);
  const claim = checkWovenText(r, "Two of Wands: success will happen soon.");
  assert.equal(claim.ok, false);
  assert.match(claim.reasons.join(), /predicts an outcome/);
  assert.equal(checkWovenText(r, "   ").ok, false);
});

test("ordinary words that are also card names are not mistaken for added cards", () => {
  const r = composeScanReading({ cards: [{ slug: "seven-of-cups", reversed: false }], spreadType: "one_card", sky: SKY });
  // The composed text already says "the Sun"; repeating it is not adding The Sun card.
  assert.ok(r.text.includes("the Sun"));
  assert.equal(checkWovenText(r, "The Seven of Cups, with the Sun in its decan.").ok, true);
});
