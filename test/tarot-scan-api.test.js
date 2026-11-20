// Orbit Axis :: the camera flow's server half.
//
// The rule: the client says WHICH cards are on the table; the server says what
// they mean. Slugs and orientations are checked against the deck, the reading
// is composed server-side, and the sky comes from the server's engine context,
// never from the request body.

import { test } from "node:test";
import assert from "node:assert/strict";

import { handleTarotRoute } from "../lib/tarot/api.js";
import { PRODUCTION_CARDS } from "../lib/tarot/deck.js";
import { validateReadingPayload } from "../lib/tarot/service.js";

const ctx = (extra = {}) => ({ deck: PRODUCTION_CARDS, deckVersion: "test", ...extra });
const SKY = { instant_utc: "2026-11-19T12:00:00.000Z", planets: { Mars: { longitude: 3 }, Sun: { longitude: 237.2 } }, retrogrades: [] };

test("GET /api/tarot/cards lists the deck for manual picking, with images and no meanings", async () => {
  const res = await handleTarotRoute("GET", "/api/tarot/cards", new URLSearchParams(), {}, ctx());
  assert.equal(res.status, 200);
  assert.equal(res.body.cards.length, 78);
  const fool = res.body.cards.find((c) => c.slug === "the-fool");
  assert.equal(fool.name, "The Fool");
  assert.ok(fool.image?.url);
  assert.equal(fool.upright_meaning, undefined);
});

test("POST /api/tarot/scan-reading composes from the server's deck and the server's sky", async () => {
  const res = await handleTarotRoute("POST", "/api/tarot/scan-reading", null, {
    spread_type: "three_card",
    cards: [{ slug: "two-of-wands", reversed: false }, { slug: "the-magician", reversed: true }, { slug: "death", reversed: false }],
  }, ctx({ getSky: async () => SKY }));
  assert.equal(res.status, 200);
  assert.equal(res.body.reading.positions.length, 3);
  assert.equal(res.body.cards[1].orientation, "reversed");
  assert.match(res.body.reading.text, /Today Mars is in this card's decan/);
  assert.equal(res.body.reading.sky_instant_utc, SKY.instant_utc);
});

test("a sky in the request body is ignored", async () => {
  const res = await handleTarotRoute("POST", "/api/tarot/scan-reading", null, {
    spread_type: "one_card", cards: [{ slug: "two-of-wands", reversed: false }],
    sky: { planets: { Mars: { longitude: 5 } } },
  }, ctx());
  assert.equal(res.status, 200);
  assert.deepEqual(res.body.reading.positions[0].sky_links, []);
  assert.equal(res.body.reading.sky_instant_utc, null);
});

test("a failing sky lookup still gives a complete reading", async () => {
  const res = await handleTarotRoute("POST", "/api/tarot/scan-reading", null, {
    spread_type: "one_card", cards: [{ slug: "the-star", reversed: false }],
  }, ctx({ getSky: async () => { throw new Error("engine down"); } }));
  assert.equal(res.status, 200);
  assert.ok(res.body.reading.text.includes("The Star"));
});

test("bad cards are refused with a reason, never repaired", async () => {
  const post = (body) => handleTarotRoute("POST", "/api/tarot/scan-reading", null, body, ctx());
  const cases = [
    [{ spread_type: "daily", cards: [] }, "invalid_spread"],
    [{ spread_type: "one_card", cards: [{ slug: "the-joker", reversed: false }] }, "unknown_card"],
    [{ spread_type: "one_card", cards: [{ slug: "the-fool", reversed: "maybe" }] }, "invalid_orientation"],
    [{ spread_type: "three_card", cards: [{ slug: "the-fool", reversed: false }] }, "wrong_card_count"],
    [{ spread_type: "three_card", cards: [{ slug: "the-fool", reversed: false }, { slug: "the-fool", reversed: true }, { slug: "death", reversed: false }] }, "duplicate_card"],
  ];
  for (const [body, code] of cases) {
    const res = await post(body);
    assert.equal(res.status, 400, code);
    assert.equal(res.body.code, code);
    assert.ok(res.body.error.length > 0);
  }
});

test("a saved reading records how its cards were chosen", () => {
  const base = { spread_type: "one_card", cards: [{ slug: "the-fool", orientation: "upright" }] };
  assert.equal(validateReadingPayload({ ...base, source: "scan" }, { deck: PRODUCTION_CARDS }).draw.method, "scan");
  assert.equal(validateReadingPayload({ ...base, source: "manual" }, { deck: PRODUCTION_CARDS }).draw.method, "manual");
  assert.equal(validateReadingPayload({ ...base }, { deck: PRODUCTION_CARDS }).draw.method, "draw");
  assert.equal(validateReadingPayload({ ...base, source: "anything" }, { deck: PRODUCTION_CARDS }).draw.method, "draw");
});
