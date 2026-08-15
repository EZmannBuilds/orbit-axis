// Orbit Axis :: TEST FIXTURE Tarot deck — NOT PRODUCT CONTENT.
//
// This deck exists so the draw contract, the API, the panel, and the export
// can be tested end to end while the real deck is unauthored. Every card says
// so in its own provenance: author "orbit-axis-test-fixture", licence
// "test-fixture-not-for-release", and `reviewed: false`.
//
// That last field is load-bearing. `deckStatus()` refuses an unreviewed deck,
// so if this file were ever imported by production code the gate would still
// close — the fixture cannot be shipped by accident, only by someone editing
// the provenance to lie, which is a different and much louder act.
//
// The meanings are deliberately flat and generic. They are placeholders whose
// job is to be well-formed, not to be good tarot: writing evocative fixture
// meanings would produce exactly the fabricated content the real deck is being
// withheld to avoid, and someone would eventually promote them.
//
// It lives under test/ rather than lib/ so the production bundle has no path
// to it at all.

import { FULL_DECK_SIZE, SUITS } from "../../lib/tarot/deck.js";

const MAJOR_NAMES = [
  "The Fool", "The Magician", "The High Priestess", "The Empress", "The Emperor",
  "The Hierophant", "The Lovers", "The Chariot", "Strength", "The Hermit",
  "Wheel of Fortune", "Justice", "The Hanged One", "Death", "Temperance",
  "The Devil", "The Tower", "The Star", "The Moon", "The Sun",
  "Judgement", "The World",
];

const RANKS = [
  "Ace", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine", "Ten",
  "Page", "Knight", "Queen", "King",
];

function slugify(name) {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

function fixtureProvenance() {
  return {
    author: "orbit-axis-test-fixture",
    license: "test-fixture-not-for-release",
    // False on purpose, and asserted by a test. An unreviewed deck never ships.
    reviewed: false,
  };
}

/** The 22 major arcana, numbered 0–21. */
const MAJORS = MAJOR_NAMES.map((name, index) => ({
  slug: slugify(name),
  name,
  arcana: "major",
  suit: null,
  number: index,
  upright_meaning: `Fixture meaning for ${name}. A placeholder used to exercise the reading layout.`,
  reflection_prompt: `Fixture prompt for ${name}. What does this bring to mind today?`,
  provenance: fixtureProvenance(),
}));

/** The 56 minor arcana: four suits of fourteen. */
const MINORS = SUITS.flatMap((suit) =>
  RANKS.map((rank, index) => {
    const name = `${rank} of ${suit.charAt(0).toUpperCase()}${suit.slice(1)}`;
    return {
      slug: slugify(name),
      name,
      arcana: "minor",
      suit,
      number: index + 1,
      upright_meaning: `Fixture meaning for ${name}. A placeholder used to exercise the reading layout.`,
      reflection_prompt: `Fixture prompt for ${name}. What does this bring to mind today?`,
      provenance: fixtureProvenance(),
    };
  }),
);

/** A structurally complete 78-card deck that is explicitly not for release. */
export const FIXTURE_DECK = Object.freeze([...MAJORS, ...MINORS]);

/** A fixture deck whose provenance is reviewed, for testing the OPEN gate. */
export const FIXTURE_DECK_REVIEWED = Object.freeze(
  FIXTURE_DECK.map((card) => ({
    ...card,
    provenance: { ...card.provenance, reviewed: true },
  })),
);

/** The version string a fixture deck draws under. Never a real release version. */
export const FIXTURE_DECK_VERSION = "0.0.0-fixture";

if (FIXTURE_DECK.length !== FULL_DECK_SIZE) {
  // A fixture that is quietly the wrong size would make every "no duplicates"
  // and "unbiased selection" test weaker than it looks.
  throw new Error(`fixture deck is ${FIXTURE_DECK.length} cards, expected ${FULL_DECK_SIZE}`);
}
