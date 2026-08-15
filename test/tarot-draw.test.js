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

import {
  DRAW_CONTRACT_VERSION, dailySeed, drawCards, drawDailyCard, drawSpread,
  isLocalDate, manualSeed, unbiasedIndex,
} from "../lib/tarot/draw.js";
import { FULL_DECK_SIZE, SPREAD_POSITIONS } from "../lib/tarot/deck.js";
import { FIXTURE_DECK, FIXTURE_DECK_VERSION } from "./fixtures/tarot-deck.js";

const daily = (overrides = {}) => drawDailyCard({
  deck: FIXTURE_DECK,
  localDate: "2026-08-15",
  timezone: "UTC",
  deckVersion: FIXTURE_DECK_VERSION,
  subject: "anonymous",
  ...overrides,
});

/* ── Stability ────────────────────────────────────────────────────────────── */

test("the same day yields the same card, every time", () => {
  const first = daily();
  // Twenty draws stands in for twenty refreshes. One repeat could pass by luck
  // with a 78-card deck; twenty could not.
  for (let i = 0; i < 20; i += 1) {
    assert.equal(daily().card.slug, first.card.slug);
  }
});

test("a different local date yields a different draw", () => {
  // Not asserting the CARDS differ — with 78 cards two dates collide about 1.3%
  // of the time, and a test that fails on a legitimate collision is a test
  // people learn to re-run. The SEED must differ; that is the actual contract.
  assert.notEqual(
    dailySeed({ localDate: "2026-08-15" }),
    dailySeed({ localDate: "2026-08-16" }),
  );
});

test("the day boundary belongs to the reader, not the server", () => {
  // Same instant, two zones, two different local dates → two different cards.
  // This is the whole reason localDate is resolved in the caller's timezone.
  const tokyo = dailySeed({ localDate: "2026-08-16", timezone: "Asia/Tokyo" });
  const newYork = dailySeed({ localDate: "2026-08-15", timezone: "America/New_York" });
  assert.notEqual(tokyo, newYork);

  // And the same calendar date in two zones is still two different days.
  assert.notEqual(
    dailySeed({ localDate: "2026-08-15", timezone: "Asia/Tokyo" }),
    dailySeed({ localDate: "2026-08-15", timezone: "America/New_York" }),
  );
});

test("re-authoring the deck changes future draws", () => {
  // A card drawn from a different deck is a different card even if it shares a
  // name, so the deck version has to be inside the seed.
  assert.notEqual(
    dailySeed({ localDate: "2026-08-15", deckVersion: "1.0.0" }),
    dailySeed({ localDate: "2026-08-15", deckVersion: "1.0.1" }),
  );
});

test("two readers get their own daily card", () => {
  assert.notEqual(
    dailySeed({ localDate: "2026-08-15", subject: "owner-a" }),
    dailySeed({ localDate: "2026-08-15", subject: "owner-b" }),
  );
  // And every signed-out visitor shares one, deliberately: with no account
  // there is nothing to key a personal draw to, and minting a device id to
  // make one would be tracking.
  assert.equal(
    dailySeed({ localDate: "2026-08-15", subject: "anonymous" }),
    dailySeed({ localDate: "2026-08-15", subject: "anonymous" }),
  );
});

test("the daily draw reports how to reproduce it", () => {
  const { draw } = daily();
  assert.equal(draw.spread_type, "daily");
  assert.equal(draw.reproducible, true);
  assert.equal(draw.deck_version, FIXTURE_DECK_VERSION);
  assert.equal(draw.contract_version, DRAW_CONTRACT_VERSION);
  assert.equal(draw.local_date, "2026-08-15");
  assert.match(draw.seed, /^[0-9a-f]{64}$/);
});

test("a malformed local date is refused rather than coerced", () => {
  for (const bad of ["2026-8-15", "15/08/2026", "2026-02-31", "", null, undefined, 20260815]) {
    assert.throws(() => dailySeed({ localDate: bad }), TypeError,
      `expected ${JSON.stringify(bad)} to be refused`);
  }
  assert.equal(isLocalDate("2028-02-29"), true);   // 2028 is a leap year
  assert.equal(isLocalDate("2026-02-29"), false);  // 2026 is not
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
