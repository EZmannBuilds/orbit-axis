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

test("production ships a complete, reviewed deck", () => {
  // This asserted an EMPTY deck for the whole build, and that was the honest
  // state until the owner approved the content on 2026-08-15. The guard has
  // not moved — an empty, incomplete or unreviewed deck is still refused, and
  // the tests below prove it with fixtures. What changed is that the
  // production deck now passes it.
  assert.equal(PRODUCTION_CARDS.length, FULL_DECK_SIZE);
  const status = deckStatus();
  assert.equal(status.ready, true, status.findings.join("; "));
  assert.equal(status.count, FULL_DECK_SIZE);
});

test("the deck version and the deck move together", () => {
  // A real version beside an empty deck would be the first step toward
  // shipping one, so the two are asserted as a pair in both directions.
  assert.match(DECK_VERSION, /^\d+\.\d+\.\d+$/);
  assert.equal(PRODUCTION_CARDS.length, FULL_DECK_SIZE);
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

test("the deck states its provenance instead of claiming originality", () => {
  for (const card of DRAFT_CARDS) {
    // Approval did not turn derived prose into original prose. The licence is
    // unchanged and still says what this content actually is.
    assert.equal(card.provenance.license, "public-domain-derived");
    assert.match(card.provenance.source, /public domain/i);
    // And the review records WHICH KIND of review it was, rather than letting
    // a bare `true` imply somebody read all seventy-eight line by line.
    assert.equal(card.provenance.reviewed, true);
    assert.equal(card.provenance.review_kind, "owner_approval");
    assert.ok(card.provenance.reviewed_by, "an approval needs a name against it");
    assert.match(card.provenance.reviewed_at, /^\d{4}-\d{2}-\d{2}$/);
  }
});

test("an unreviewed deck still cannot ship, whatever else is true of it", () => {
  // The guard that held the deck back for the whole build, proved against a
  // fixture now that the real deck has passed it. Structurally perfect and
  // still refused, because review is a human act.
  const unreviewed = DRAFT_CARDS.map((c) => ({ ...c, provenance: { ...c.provenance, reviewed: false } }));
  assert.equal(validateDeck(unreviewed).ok, true, "well-formed");
  const status = deckStatus(unreviewed);
  assert.equal(status.ready, false);
  assert.equal(status.reason, "unreviewed_deck");
  // Readable where content can be reviewed and argued with.
  assert.equal(deckStatus(unreviewed, { allowUnreviewed: true }).ready, true);
});

test("every environment now reads the same approved deck", () => {
  // Production and preview diverged while the deck was unapproved: production
  // read an empty array, everywhere else read the draft. With one approved
  // deck there is nothing to diverge about, and a reader on the web sees the
  // same cards as a reader on a preview.
  const production = { VERCEL_ENV: "production", ORBIT_ENVIRONMENT: "production" };
  const preview = { VERCEL_ENV: "preview", ORBIT_ENVIRONMENT: "preview" };

  for (const env of [production, preview, {}]) {
    const resolved = resolveDeck({ env });
    assert.equal(resolved.deck.length, FULL_DECK_SIZE);
    assert.equal(resolved.deckVersion, DECK_VERSION);
  }
  assert.equal(DRAFT_DECK_VERSION, DECK_VERSION, "one deck, one version");
});

test("the deck version is recorded on a reading, so a replacement is visible", () => {
  // A saved reflection says which deck it was drawn from. When commissioned
  // meanings replace these, an old reading still reports the version it
  // actually came from rather than silently claiming the new one.
  assert.match(DECK_VERSION, /^1\.\d+\.\d+$/);
  assert.ok(!/draft|empty/.test(DECK_VERSION), "an approved deck is not a draft");
});
