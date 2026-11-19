// Orbit Axis :: Tarot correspondences.
//
// The table is long and hand-transcribed, so these tests check it against the
// structure the tradition itself guarantees: the decans tile the zodiac once,
// the rulers cycle in Chaldean order, the 72 angels run in sequence from 0° Leo,
// every trump's letter class matches its attribution (Sepher Yetzirah), and the
// court ranges tile the zodiac once. A single wrong row breaks one of these.
//
// Values asserted literally (e.g. "Two of Wands is Mars in Aries") were read
// from Book T and Liber 777; see docs/tarot-correspondences-research.md.

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  CHALDEAN_ORDER, CORRESPONDENCES, CORRESPONDENCE_SLUGS, DECANS, HEBREW_LETTERS,
  SHEM_ANGELS, SIGN_ELEMENT, SIGN_ORDER, SOURCES, correspondenceFor, courtAt,
  decanAt, longitudeTouchesCard, zodiacPosition,
} from "../lib/tarot/correspondences.js";
import { DRAFT_CARDS } from "../lib/tarot/draft-deck.js";

const majors = () => Object.values(CORRESPONDENCES).filter((c) => c.arcana === "major");
const courts = () => Object.values(CORRESPONDENCES).filter((c) => c.kind === "court");

test("every card in the deck has correspondences, and nothing else does", () => {
  const deckSlugs = DRAFT_CARDS.map((c) => c.slug).sort();
  assert.deepEqual([...CORRESPONDENCE_SLUGS].sort(), deckSlugs);
  assert.equal(CORRESPONDENCE_SLUGS.length, 78);
});

test("every entry names only known sources", () => {
  for (const c of Object.values(CORRESPONDENCES)) {
    assert.ok(c.sources.length > 0, c.slug);
    for (const s of c.sources) assert.ok(SOURCES[s], `${c.slug} cites unknown source ${s}`);
  }
});

test("the table is frozen", () => {
  assert.ok(Object.isFrozen(CORRESPONDENCES));
  assert.ok(Object.isFrozen(correspondenceFor("the-fool").path));
  assert.equal(correspondenceFor("not-a-card"), null);
  assert.equal(correspondenceFor("constructor"), null);
});

// ── Decans ──────────────────────────────────────────────────────────────────

test("36 decans tile the zodiac exactly once, 10° each, from 0° Aries", () => {
  assert.equal(DECANS.length, 36);
  DECANS.forEach((d, i) => {
    assert.equal(d.start_longitude, i * 10);
    assert.equal(d.end_longitude, i * 10 + 10);
    assert.equal(d.sign, SIGN_ORDER[Math.floor(i / 3)]);
  });
  assert.equal(new Set(DECANS.map((d) => d.slug)).size, 36);
});

test("decan rulers follow the Chaldean order unbroken from Mars at 0° Aries", () => {
  // 36 decans and 7 planets: the chain cannot close, so Mars rules both the
  // last decan of Pisces and the first of Aries. Book T's table starts at Leo
  // (with Saturn), but the chain itself runs from 0° Aries.
  const start = CHALDEAN_ORDER.indexOf("Mars");
  DECANS.forEach((d, k) => assert.equal(d.ruler, CHALDEAN_ORDER[(start + k) % 7], `${d.slug} at ${d.start_longitude}°`));
  assert.equal(DECANS[35].ruler, "Mars");
  assert.equal(DECANS[0].ruler, "Mars");
  assert.equal(DECANS[12].ruler, "Saturn"); // 0° Leo, where Book T begins
});

test("each sign's three decans are the 2–4, 5–7 or 8–10 of the suit of its element", () => {
  const suitOf = { Fire: "wands", Water: "cups", Air: "swords", Earth: "pentacles" };
  const numbers = { Cardinal: ["two", "three", "four"], Fixed: ["five", "six", "seven"], Mutable: ["eight", "nine", "ten"] };
  for (const d of DECANS) {
    const c = correspondenceFor(d.slug);
    assert.equal(c.suit, suitOf[SIGN_ELEMENT[d.sign]], d.slug);
    assert.equal(d.slug.split("-of-")[0], numbers[c.decan.modality][d.index], d.slug);
  }
});

test("Book T values, spot-checked", () => {
  const two = correspondenceFor("two-of-wands");
  assert.equal(two.title, "The Lord of Dominion");
  assert.deepEqual([two.decan.ruler, two.decan.sign, two.decan.start_longitude], ["Mars", "Aries", 0]);
  assert.equal(two.sephirah.name, "Chokmah");
  assert.equal(two.world, "Atziluth");
  assert.equal(correspondenceFor("five-of-wands").decan.ruler, "Saturn");
  assert.equal(correspondenceFor("three-of-swords").title, "The Lord of Sorrow");
  assert.equal(correspondenceFor("ten-of-cups").decan.ruler, "Mars");
  assert.equal(correspondenceFor("eight-of-swords").decan.ruler, "Jupiter");
  assert.equal(correspondenceFor("ten-of-pentacles").sephirah.name, "Malkuth");
  assert.equal(correspondenceFor("ten-of-pentacles").world, "Assiah");
});

test("the 72 angels run in order, two per decan, from 0° Leo", () => {
  assert.equal(SHEM_ANGELS.length, 72);
  SHEM_ANGELS.forEach((a, i) => assert.equal(a.number, i + 1));
  const leo = SIGN_ORDER.indexOf("Leo") * 3;
  for (let k = 0; k < 36; k++) {
    const d = DECANS[(leo + k) % 36];
    assert.deepEqual(d.angels.map((a) => a.number), [2 * k + 1, 2 * k + 2], d.slug);
  }
  assert.deepEqual(correspondenceFor("five-of-wands").angels.map((a) => a.name), ["Vehuiah", "Jeliel"]);
  assert.deepEqual(correspondenceFor("four-of-cups").angels.map((a) => a.name), ["Haiaiel", "Mumiah"]);
});

test("decanAt finds the right card, including at the wrap", () => {
  assert.equal(decanAt(0).slug, "two-of-wands");
  assert.equal(decanAt(9.999).slug, "two-of-wands");
  assert.equal(decanAt(10).slug, "three-of-wands");
  assert.equal(decanAt(120).slug, "five-of-wands");
  assert.equal(decanAt(359.99).slug, "ten-of-cups");
  assert.equal(decanAt(360).slug, "two-of-wands");
  assert.equal(decanAt(-5).slug, "ten-of-cups");
  assert.equal(decanAt(NaN), null);
});

// ── Trumps ──────────────────────────────────────────────────────────────────

test("22 trumps, 22 letters, paths 11–32, each used once", () => {
  const m = majors();
  assert.equal(m.length, 22);
  assert.deepEqual(m.map((c) => c.path.number).sort((a, b) => a - b), Array.from({ length: 22 }, (_, i) => i + 11));
  assert.equal(new Set(m.map((c) => c.hebrew_letter.id)).size, 22);
  assert.equal(Object.keys(HEBREW_LETTERS).length, 22);
});

test("Sepher Yetzirah: mothers carry elements, doubles planets, simples signs", () => {
  const byKind = { mother: [], double: [], simple: [] };
  for (const c of majors()) {
    const expected = { mother: "element", double: "planet", simple: "sign" }[c.hebrew_letter.kind];
    assert.equal(c.attribution.kind, expected, c.slug);
    byKind[c.hebrew_letter.kind].push(c.attribution.name);
  }
  assert.deepEqual(byKind.mother.sort(), ["Air", "Fire", "Water"]);
  assert.deepEqual(byKind.double.sort(), [...CHALDEAN_ORDER].sort());
  assert.deepEqual(byKind.simple.sort(), [...SIGN_ORDER].sort());
});

test("the simple letters run through the zodiac in order, Heh (Aries) to Qoph (Pisces)", () => {
  const signs = majors().filter((c) => c.attribution.kind === "sign")
    .sort((a, b) => a.path.number - b.path.number).map((c) => c.attribution.name);
  assert.deepEqual(signs, SIGN_ORDER);
});

test("paths join the Sephiroth given in Liber 777", () => {
  const joins = {
    11: [1, 2], 12: [1, 3], 13: [1, 6], 14: [2, 3], 15: [2, 6], 16: [2, 4], 17: [3, 6], 18: [3, 5],
    19: [4, 5], 20: [4, 6], 21: [4, 7], 22: [5, 6], 23: [5, 8], 24: [6, 7], 25: [6, 9], 26: [6, 8],
    27: [7, 8], 28: [7, 9], 29: [7, 10], 30: [8, 9], 31: [8, 10], 32: [9, 10],
  };
  for (const c of majors()) assert.deepEqual(c.path.joins.map((s) => s.number), joins[c.path.number], c.slug);
});

test("Golden Dawn order: Strength is Leo, Justice is Libra, the World also carries Earth", () => {
  assert.equal(correspondenceFor("strength").attribution.name, "Leo");
  assert.equal(correspondenceFor("justice").attribution.name, "Libra");
  assert.equal(correspondenceFor("the-fool").hebrew_letter.name, "Aleph");
  assert.equal(correspondenceFor("the-world").attribution.name, "Saturn");
  assert.equal(correspondenceFor("the-world").secondary_attribution.name, "Earth");
  assert.equal(correspondenceFor("judgement").secondary_attribution.name, "Spirit");
});

// ── Courts ──────────────────────────────────────────────────────────────────

test("Waite–Smith names follow Book T: Knight is Fire, Queen Water, King Air, Page Earth", () => {
  const expected = { knight: ["King", "Fire"], queen: ["Queen", "Water"], king: ["Prince", "Air"], page: ["Princess", "Earth"] };
  for (const c of courts()) {
    const [bookRank, element] = expected[c.rank];
    assert.equal(c.book_t_rank, bookRank, c.slug);
    assert.equal(c.sub_element.element, element, c.slug);
    assert.equal(c.sub_element.of, c.element, c.slug);
  }
  assert.equal(correspondenceFor("knight-of-wands").sub_element.label, "Fire of Fire");
  assert.equal(correspondenceFor("king-of-cups").sub_element.label, "Air of Water");
});

test("Knights, Queens and Kings tile the zodiac once, each from 20° of a sign, three decans each", () => {
  const ruling = courts().filter((c) => c.rules);
  assert.equal(ruling.length, 12);
  assert.deepEqual(ruling.map((c) => c.rules.start_longitude).sort((a, b) => a - b), SIGN_ORDER.map((_, i) => i * 30 + 20));
  for (const c of ruling) {
    assert.equal(c.rules.from.degree, 20);
    assert.equal(c.rules.decans.length, 3, c.slug);
  }
  const covered = ruling.flatMap((c) => c.rules.decans);
  assert.equal(new Set(covered).size, 36);
});

test("court ranges match Book T, including the one that wraps past 0° Aries", () => {
  assert.deepEqual([correspondenceFor("queen-of-wands").rules.from.sign, correspondenceFor("queen-of-wands").rules.to.sign], ["Pisces", "Aries"]);
  assert.deepEqual([correspondenceFor("king-of-wands").rules.from.sign, correspondenceFor("king-of-wands").rules.to.sign], ["Cancer", "Leo"]);
  assert.deepEqual([correspondenceFor("knight-of-pentacles").rules.from.sign, correspondenceFor("knight-of-pentacles").rules.to.sign], ["Leo", "Virgo"]);
  assert.equal(courtAt(355).slug, "queen-of-wands");
  assert.equal(courtAt(5).slug, "queen-of-wands");
  assert.equal(courtAt(19.99).slug, "queen-of-wands");
  assert.equal(courtAt(20).slug, "king-of-pentacles");
});

test("Pages rule no zodiac range; each is the throne of its suit's ace", () => {
  for (const s of ["wands", "cups", "swords", "pentacles"]) {
    const page = correspondenceFor(`page-of-${s}`);
    assert.equal(page.rules, null);
    assert.equal(page.throne_of, `ace-of-${s}`);
    assert.equal(correspondenceFor(`ace-of-${s}`).throne, `page-of-${s}`);
  }
});

// ── Helpers ─────────────────────────────────────────────────────────────────

test("zodiacPosition and longitudeTouchesCard", () => {
  assert.deepEqual(zodiacPosition(237.2), { sign: "Scorpio", degree: 27, longitude: 237.2 });
  assert.ok(longitudeTouchesCard("two-of-wands", 5));
  assert.ok(!longitudeTouchesCard("two-of-wands", 15));
  assert.ok(longitudeTouchesCard("the-emperor", 15));
  assert.ok(longitudeTouchesCard("queen-of-wands", 355));
  assert.ok(!longitudeTouchesCard("the-magician", 15));
  assert.ok(!longitudeTouchesCard("page-of-cups", 15));
});
