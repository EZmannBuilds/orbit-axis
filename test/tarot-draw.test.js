// Orbit Axis :: the Tarot draw contract, pinned.
//
// The daily card's stability is the promise this feature is built on: "refresh
// must not draw a new card". That promise is arithmetic, so it can be tested
// exactly rather than observed and hoped for.
//
// These run against the FIXTURE deck, which says in its own provenance that it
// is a fixture. The production deck is empty on purpose (see lib/tarot/deck.js),
// and testing the draw against real content is not what makes the draw correct.

import { test } from "node:test";
import assert from "node:assert/strict";

import { readFileSync } from "node:fs";
import {
  DRAW_CONTRACT_VERSION, drawCards, drawDailyCard, drawSpread,
  isLocalDate, manualSeed, unbiasedIndex,
} from "../lib/tarot/draw.js";
import { FULL_DECK_SIZE, SPREAD_POSITIONS } from "../lib/tarot/deck.js";
import { FIXTURE_DECK, FIXTURE_DECK_VERSION } from "./fixtures/tarot-deck.js";

const daily = (overrides = {}) => drawDailyCard({
  deck: FIXTURE_DECK,
  localDate: "2026-08-15",
  timezone: "UTC",
  deckVersion: FIXTURE_DECK_VERSION,
  ...overrides,
});

/* ── The daily draw ───────────────────────────────────────────────────────── */

test("today's card is drawn, not derived", () => {
  // It used to be a pure function of (local date, timezone, deck version,
  // account). That made it stable for free and made WHICH card you got a
  // function of who you are — so two people never shared a card and one
  // person's card was decided before they opened the app.
  //
  // It is a real draw now. Stability comes from writing it down (see
  // tarot_daily_draws), not from recomputing it.
  const slugs = new Set();
  for (let i = 0; i < 60; i += 1) slugs.add(daily().card.slug);
  assert.ok(slugs.size > 20,
    `60 draws produced only ${slugs.size} distinct cards — that is not a draw`);
});

test("nothing about the reader influences which card comes up", () => {
  // No account id, no timezone, no date, no history. drawDailyCard takes a
  // deck and a seed; there is no parameter that could weight the deck.
  const source = readFileSync(new URL("../lib/tarot/draw.js", import.meta.url), "utf8");
  const fn = source.slice(source.indexOf("export function drawDailyCard"));
  const signature = fn.slice(0, fn.indexOf(")"));
  for (const banned of ["subject", "owner", "history", "recent", "weight"]) {
    assert.ok(!signature.includes(banned),
      `drawDailyCard takes "${banned}", which could bias the deck`);
  }
  // And the seed builder that used to derive it is gone rather than deprecated.
  assert.ok(!/export function dailySeed/.test(source));
});

test("a drawn card does not claim to be reproducible", () => {
  const { draw } = daily();
  assert.equal(draw.spread_type, "daily");
  assert.equal(draw.reproducible, false,
    "the astrology side IS reproducible; both must not claim the same property");
  assert.equal(draw.deck_version, FIXTURE_DECK_VERSION);
  assert.equal(draw.local_date, "2026-08-15");
});

test("the same card can come up two days running", () => {
  // No exclusion of recently seen cards anywhere. Over many draws a repeat
  // must occur, or something is quietly filtering the deck.
  let repeats = 0;
  let previous = null;
  for (let i = 0; i < 2000; i += 1) {
    const slug = daily().card.slug;
    if (slug === previous) repeats += 1;
    previous = slug;
  }
  assert.ok(repeats > 0, "2000 consecutive draws with no repeat means the deck is being filtered");
});

test("every card in the deck can be today's card", () => {
  const seen = new Set();
  for (let i = 0; i < 40000 && seen.size < FULL_DECK_SIZE; i += 1) seen.add(daily().card.slug);
  assert.equal(seen.size, FULL_DECK_SIZE, "some cards are unreachable as a daily card");
});

/* ── Selection quality ────────────────────────────────────────────────────── */

test("index selection is unbiased across the whole deck", () => {
  // The naive `hash % 78` is biased because 2^32 is not a multiple of 78: the
  // first 34 indices would come up very slightly more often, forever. This is
  // a chi-square goodness-of-fit test against a uniform distribution.
  const N = 78 * 2000;
  const counts = new Array(FULL_DECK_SIZE).fill(0);
  for (let i = 0; i < N; i += 1) counts[unbiasedIndex(`seed-${i}`, "u", FULL_DECK_SIZE)] += 1;

  const expected = N / FULL_DECK_SIZE;
  const chiSquare = counts.reduce((sum, c) => sum + ((c - expected) ** 2) / expected, 0);
  // 77 degrees of freedom. The 0.999 critical value is ~124; a fair generator
  // exceeds it once in a thousand runs, which is rare enough for CI and loose
  // enough not to flake. A modulo-biased generator lands far above it.
  assert.ok(chiSquare < 124,
    `chi-square ${chiSquare.toFixed(1)} suggests a biased selection`);
  assert.ok(counts.every((c) => c > 0), "every card must be reachable");
});

test("selection is reproducible from the seed", () => {
  assert.equal(unbiasedIndex("seed", "label", 78), unbiasedIndex("seed", "label", 78));
  assert.notEqual(unbiasedIndex("seed", "a", 78), unbiasedIndex("seed", "b", 78));
});

test("a one-card deck needs no arithmetic at all", () => {
  assert.equal(unbiasedIndex("anything", "l", 1), 0);
});

test("an impossible size is refused, not guessed", () => {
  for (const bad of [0, -1, 1.5, NaN, "78"]) {
    assert.throws(() => unbiasedIndex("s", "l", bad), RangeError);
  }
});

/* ── Spreads ──────────────────────────────────────────────────────────────── */

test("a three-card spread never repeats a card", () => {
  // 2000 spreads. With independent draws and no exclusion, a duplicate would
  // appear in roughly 1 spread in 13 — so this would fail almost immediately
  // if the partial Fisher-Yates were replaced by three separate picks.
  for (let i = 0; i < 2000; i += 1) {
    const { cards } = drawSpread({ deck: FIXTURE_DECK, spreadType: "three_card" });
    const slugs = cards.map((entry) => entry.card.slug);
    assert.equal(new Set(slugs).size, 3, `duplicate in spread ${i}: ${slugs.join(", ")}`);
  }
});

test("three-card positions are the non-predictive ones, in reading order", () => {
  const { cards } = drawSpread({ deck: FIXTURE_DECK, spreadType: "three_card" });
  assert.deepEqual(cards.map((c) => c.position),
    ["What shaped this", "What is present", "What to consider next"]);
  // Stated again against the constant, so changing the labels in one place
  // without the other fails here rather than in someone's reading.
  assert.deepEqual([...SPREAD_POSITIONS.three_card],
    ["What shaped this", "What is present", "What to consider next"]);
});

test("a manual draw is a draw, and says so", () => {
  const { draw } = drawSpread({ deck: FIXTURE_DECK, spreadType: "one_card" });
  assert.equal(draw.reproducible, false,
    "a manual draw must not claim to be reproducible from a date");
  assert.match(draw.seed, /^[0-9a-f]{64}$/);
});

test("manual draws differ from one another", () => {
  const seen = new Set();
  for (let i = 0; i < 40; i += 1) {
    seen.add(drawSpread({ deck: FIXTURE_DECK, spreadType: "one_card" }).cards[0].card.slug);
  }
  // Forty draws from 78 cards landing on one card would mean the seed is not
  // fresh — which is exactly the bug that would make "draw again" do nothing.
  assert.ok(seen.size > 10, `only ${seen.size} distinct cards in 40 manual draws`);
});

test("manual seeds are fresh every time", () => {
  const seeds = new Set(Array.from({ length: 100 }, () => manualSeed()));
  assert.equal(seeds.size, 100);
});

test("drawing more cards than the deck holds is refused", () => {
  assert.throws(() => drawCards(FIXTURE_DECK.slice(0, 2), 3, "seed"), RangeError);
  assert.throws(() => drawSpread({ deck: [], spreadType: "one_card" }), RangeError);
  assert.throws(() => drawSpread({ deck: FIXTURE_DECK, spreadType: "tower_of_babel" }), RangeError);
});

test("a given seed reproduces a given spread", () => {
  const seed = "a".repeat(64);
  const first = drawSpread({ deck: FIXTURE_DECK, spreadType: "three_card", seed });
  const second = drawSpread({ deck: FIXTURE_DECK, spreadType: "three_card", seed });
  assert.deepEqual(first.cards.map((c) => c.card.slug), second.cards.map((c) => c.card.slug));
});
