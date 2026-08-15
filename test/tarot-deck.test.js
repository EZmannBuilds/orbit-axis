// Orbit Axis :: the Tarot content contract and its production gate.
//
// The single most important assertion in this file is that PRODUCTION CANNOT
// SHOW AN INCOMPLETE DECK. Everything else here supports it.
//
// That matters more than usual for this feature. The pressure on a tarot deck
// is to fill it — a page with no cards looks broken, and there are seventy-eight
// meanings a model would happily produce in a second. [[Tarot Data Model]]
// refuses that trade: meanings must be original structured interpretations with
// source and licensing metadata, not transcribed guidebooks and not improvised.
// These tests are what make the refusal enforceable rather than aspirational.

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  ARCANA, DECK_VERSION, FORBIDDEN_CONTENT_PATTERNS, FULL_DECK_SIZE,
  PRODUCTION_CARDS, REQUIRED_CARD_FIELDS, SPREAD_POSITIONS, SPREAD_SIZES,
  SPREAD_TYPES, SUITS, cardBySlug, deckStatus, presentCard, validateCard,
  validateDeck,
} from "../lib/tarot/deck.js";
import { FIXTURE_DECK, FIXTURE_DECK_REVIEWED } from "./fixtures/tarot-deck.js";
import { DRAFT_CARDS, DRAFT_DECK_VERSION } from "../lib/tarot/draft-deck.js";
import { resolveDeck } from "../lib/tarot/service.js";

/* ── The production gate ──────────────────────────────────────────────────── */

test("production ships no deck, and says so honestly", () => {
  assert.equal(PRODUCTION_CARDS.length, 0,
    "the production deck is empty until real content is authored and reviewed");
  const status = deckStatus();
  assert.equal(status.ready, false);
  assert.equal(status.reason, "empty_deck");
  assert.ok(status.message, "an unavailable feature must be able to explain itself");
});

test("the deck version admits the deck is empty", () => {
  // These two facts move together. A real version string beside an empty deck
  // would be the first step toward shipping one.
  assert.equal(DECK_VERSION, "0.0.0-empty");
  assert.equal(PRODUCTION_CARDS.length, 0);
});

test("a partial deck is refused, not served", () => {
  // The failure mode this prevents: nine cards authored, the page rendered
  // anyway, and every reader silently drawing from a ninth of a deck.
  const partial = FIXTURE_DECK_REVIEWED.slice(0, 9);
  const status = deckStatus(partial);
  assert.equal(status.ready, false);
  assert.equal(status.reason, "incomplete_deck");
  assert.equal(status.count, 9);
});

test("an unreviewed deck is refused even when it is structurally perfect", () => {
  // The fixture deck is a complete, well-formed 78 cards. It still must not
  // ship, because review is a human act and its provenance records that it has
  // not happened. This is the assertion that stops the fixture being promoted.
  const result = validateDeck(FIXTURE_DECK);
  assert.equal(result.ok, true, `fixture deck should be well-formed: ${result.findings.join("; ")}`);

  const status = deckStatus(FIXTURE_DECK);
  assert.equal(status.ready, false);
  assert.equal(status.reason, "unreviewed_deck");
});

test("a complete, reviewed deck opens the gate", () => {
  // The other direction: the gate is not simply welded shut. When real content
  // exists and has been reviewed, this is what passing looks like.
  const status = deckStatus(FIXTURE_DECK_REVIEWED);
  assert.equal(status.ready, true);
  assert.equal(status.count, FULL_DECK_SIZE);
  assert.deepEqual(status.findings, []);
});

test("the test fixture can never be mistaken for product content", () => {
  for (const card of FIXTURE_DECK) {
    assert.equal(card.provenance.reviewed, false);
    assert.equal(card.provenance.license, "test-fixture-not-for-release");
    assert.equal(card.provenance.author, "orbit-axis-test-fixture");
  }
});

/* ── The card contract ────────────────────────────────────────────────────── */

test("every required field is genuinely required", () => {
  const good = FIXTURE_DECK[0];
  for (const field of REQUIRED_CARD_FIELDS) {
    const missing = { ...good };
    delete missing[field];
    const findings = validateCard(missing);
    assert.ok(findings.some((f) => f.includes(field)),
      `dropping ${field} should be a finding, got: ${findings.join("; ") || "none"}`);
  }
});

test("a meaning with no provenance does not pass", () => {
  const card = { ...FIXTURE_DECK[0], provenance: { author: "someone", license: "" , reviewed: true } };
  assert.ok(validateCard(card).some((f) => f.includes("license")));
});

test("arcana and suit have to agree", () => {
  const major = FIXTURE_DECK.find((c) => c.arcana === "major");
  const minor = FIXTURE_DECK.find((c) => c.arcana === "minor");

  // A major card with a suit would sort into the wrong place and shift every
  // draw after it.
  assert.ok(validateCard({ ...major, suit: "cups" }).some((f) => f.includes("suit")));
  assert.ok(validateCard({ ...minor, suit: null }).some((f) => f.includes("suit")));
  assert.ok(validateCard({ ...minor, suit: "goblets" }).some((f) => f.includes("suit")));
  assert.ok(validateCard({ ...major, arcana: "trumps" }).some((f) => f.includes("arcana")));
  assert.deepEqual([...ARCANA], ["major", "minor"]);
  assert.deepEqual([...SUITS], ["wands", "cups", "swords", "pentacles"]);
});

test("a slug must be a stable name, not a uuid or prose", () => {
  const good = FIXTURE_DECK[0];
  for (const bad of ["The Tower", "the_tower", "550e8400-e29b-41d4-a716-446655440000", "-tower", ""]) {
    assert.ok(validateCard({ ...good, slug: bad }).some((f) => f.includes("slug")),
      `${JSON.stringify(bad)} should not pass as a slug`);
  }
});

test("predictive and advisory language is refused in authored content", () => {
  const base = FIXTURE_DECK[0];
  const refused = [
    "You will meet someone within three weeks.",
    "This is your destiny.",
    "A guaranteed outcome follows.",
    "Consider whether to leave him.",
    "Treat the symptom directly.",
    "Now is the time to buy shares.",
  ];
  for (const text of refused) {
    assert.ok(validateCard({ ...base, upright_meaning: text }).length > 0,
      `"${text}" should not pass content review`);
  }
  // And the ordinary reflective register passes, or the rule would be useless.
  assert.deepEqual(
    validateCard({ ...base, upright_meaning: "A pause before a decision, and what it makes room for." }),
    [],
  );
});

test("the forbidden-language rules each explain themselves", () => {
  for (const rule of FORBIDDEN_CONTENT_PATTERNS) {
    assert.ok(rule.why && typeof rule.why === "string",
      "a refusal has to be able to say why, or an author cannot act on it");
  }
});

/* ── Deck-level rules ─────────────────────────────────────────────────────── */

test("duplicate cards are caught", () => {
  const dupSlug = [...FIXTURE_DECK_REVIEWED];
  dupSlug[5] = { ...dupSlug[5], slug: dupSlug[4].slug };
  assert.ok(validateDeck(dupSlug).findings.some((f) => f.includes("duplicate")));

  const dupName = [...FIXTURE_DECK_REVIEWED];
  dupName[7] = { ...dupName[7], name: dupName[6].name };
  assert.ok(validateDeck(dupName).findings.some((f) => f.includes("duplicate")));
});

test("a deck is seventy-eight cards", () => {
  assert.equal(FULL_DECK_SIZE, 78);
  assert.equal(FIXTURE_DECK.length, 78);
  assert.equal(FIXTURE_DECK.filter((c) => c.arcana === "major").length, 22);
  assert.equal(FIXTURE_DECK.filter((c) => c.arcana === "minor").length, 56);
});

/* ── Spreads and presentation ─────────────────────────────────────────────── */

test("the MVP ships exactly three spreads and no custom ones", () => {
  assert.deepEqual([...SPREAD_TYPES].sort(), ["daily", "one_card", "three_card"]);
  assert.equal(SPREAD_SIZES.daily, 1);
  assert.equal(SPREAD_SIZES.one_card, 1);
  assert.equal(SPREAD_SIZES.three_card, 3);
  for (const type of SPREAD_TYPES) {
    assert.equal(SPREAD_POSITIONS[type].length, SPREAD_SIZES[type],
      `${type} needs one position label per card`);
  }
});

test("no spread position promises an outcome", () => {
  const predictive = /outcome|future|will|result|destiny|fate/i;
  for (const type of SPREAD_TYPES) {
    for (const position of SPREAD_POSITIONS[type]) {
      assert.ok(!predictive.test(position),
        `"${position}" reads as a prediction rather than a prompt`);
    }
  }
});

test("provenance never reaches the browser", () => {
  // Licensing metadata is about Orbit's content pipeline, not about a reading,
  // and it carries an author's name into every reveal if it leaks.
  const presented = presentCard(FIXTURE_DECK[0]);
  assert.equal(presented.provenance, undefined);
  assert.ok(presented.name && presented.upright_meaning && presented.reflection_prompt);
  assert.equal(presented.slug, FIXTURE_DECK[0].slug);
});

test("cards are found by slug, not by position", () => {
  const card = cardBySlug(FIXTURE_DECK, "the-tower");
  assert.equal(card?.name, "The Tower");
  assert.equal(cardBySlug(FIXTURE_DECK, "not-a-card"), null);
  assert.equal(cardBySlug(FIXTURE_DECK, null), null);
});


/* ── The draft deck ───────────────────────────────────────────────────────── */

test("the draft deck is a complete, well-formed 78 cards", () => {
  const result = validateDeck(DRAFT_CARDS);
  assert.equal(result.ok, true, result.findings.slice(0, 5).join("; "));
  assert.equal(DRAFT_CARDS.length, FULL_DECK_SIZE);
  assert.equal(DRAFT_CARDS.filter((c) => c.arcana === "major").length, 22);
  for (const suit of SUITS) {
    assert.equal(DRAFT_CARDS.filter((c) => c.suit === suit).length, 14, `${suit} needs fourteen cards`);
  }
});

test("every draft card carries a meaning and a prompt that is a question", () => {
  for (const card of DRAFT_CARDS) {
    assert.ok(card.upright_meaning.length > 60, `${card.slug}: meaning is too thin to be useful`);
    assert.ok(card.reflection_prompt.trim().endsWith("?"),
      `${card.slug}: a reflection prompt should ask something`);
  }
});

test("the draft states its provenance instead of claiming originality", () => {
  for (const card of DRAFT_CARDS) {
    // "public-domain-derived" is the honest description: the prose is written
    // for Orbit, the tradition it draws on is Waite-Smith, and both facts are
    // recorded rather than one being implied.
    assert.equal(card.provenance.license, "public-domain-derived");
    assert.match(card.provenance.source, /public domain/i);
    assert.equal(card.provenance.reviewed, false, `${card.slug} must not claim review`);
  }
});

test("the draft deck cannot ship, and says why", () => {
  // Structurally perfect and still refused, because review has not happened.
  assert.equal(validateDeck(DRAFT_CARDS).ok, true);
  const status = deckStatus(DRAFT_CARDS);
  assert.equal(status.ready, false);
  assert.equal(status.reason, "unreviewed_deck");
  // And it is readable where content can be reviewed and argued with.
  assert.equal(deckStatus(DRAFT_CARDS, { allowUnreviewed: true }).ready, true);
});

test("production reads the empty deck; everywhere else reads the draft", () => {
  const production = { VERCEL_ENV: "production", ORBIT_ENVIRONMENT: "production" };
  const preview = { VERCEL_ENV: "preview", ORBIT_ENVIRONMENT: "preview" };

  assert.equal(resolveDeck({ env: production }).deck.length, 0,
    "production must never resolve to the draft");
  assert.equal(resolveDeck({ env: production }).deckVersion, DECK_VERSION);

  assert.equal(resolveDeck({ env: preview }).deck.length, FULL_DECK_SIZE);
  assert.equal(resolveDeck({ env: preview }).deckVersion, DRAFT_DECK_VERSION);
  assert.equal(resolveDeck({ env: {} }).deckVersion, DRAFT_DECK_VERSION);
});

test("the draft draws under its own version, so replacing it changes the draw", () => {
  // A reader should not be handed the same "today's card" from two different
  // decks. The version is in the seed, so a replacement is visibly a new draw.
  assert.notEqual(DRAFT_DECK_VERSION, DECK_VERSION);
  assert.match(DRAFT_DECK_VERSION, /-draft$/);
});
