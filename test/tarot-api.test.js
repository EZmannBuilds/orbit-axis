// Orbit Axis :: the Tarot service and HTTP boundary.
//
// The rule these tests exist to hold: THE BROWSER OWNS NO DRAW AND NO
// AUTHORIZATION RULE. A client can ask for a card and can ask to keep one; it
// cannot decide which card it got, cannot write a meaning the deck does not
// contain, and cannot file a reading under another account.
//
// Supabase is stubbed rather than run. What is under test here is this
// module's contract with the database — which token it uses, which owner id it
// writes, what it refuses before asking — and a live database would make those
// assertions slower without making them stronger. Owner scoping in the
// DATABASE is RLS's job and is covered by the RLS suite.

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  MAX_QUESTION_LENGTH, TarotError, assertDeckReady, dailyCard, listReadings,
  manualReading, presentReading, saveReading, validateQuestion,
  validateReadingPayload, validateSpreadType, validateTimezone,
} from "../lib/tarot/service.js";
import { handleTarotRoute } from "../lib/tarot/api.js";
import { FIXTURE_DECK_REVIEWED, FIXTURE_DECK_VERSION } from "./fixtures/tarot-deck.js";

const DECK = FIXTURE_DECK_REVIEWED;
const ctx = (extra = {}) => ({ deck: DECK, deckVersion: FIXTURE_DECK_VERSION, ...extra });

const AUTH = Object.freeze({
  url: "https://stub.supabase.test",
  anonKey: "anon-key-stub",
  accessToken: "user-access-token-stub",
  ownerId: "11111111-1111-4111-8111-111111111111",
});

/** A fetch stub that records what it was asked to do. */
function stubFetch(response = []) {
  const calls = [];
  const impl = async (url, options = {}) => {
    calls.push({ url: String(url), options });
    return {
      ok: true,
      status: 200,
      text: async () => JSON.stringify(response),
    };
  };
  impl.calls = calls;
  return impl;
}

/* ── The deck gate, at the boundary ───────────────────────────────────────── */

test("an unauthored deck refuses every read path", async () => {
  // 503, not 500 and not an empty success. The panel renders this as a state,
  // so it has to be distinguishable from a failure that retrying would fix.
  for (const call of [
    () => dailyCard({ deck: [] }),
    () => manualReading({ deck: [], spreadType: "one_card" }),
  ]) {
    assert.throws(call, (error) => {
      assert.ok(error instanceof TarotError);
      assert.equal(error.status, 503);
      assert.equal(error.code, "empty_deck");
      return true;
    });
  }
});

test("the HTTP surface reports an unavailable deck rather than improvising", async () => {
  const res = await handleTarotRoute("GET", "/api/tarot/daily", new URLSearchParams(), {}, { deck: [] });
  assert.equal(res.status, 503);
  assert.equal(res.body.ok, false);
  assert.equal(res.body.code, "empty_deck");
});

test("status reports readiness without ever reporting content", async () => {
  const res = await handleTarotRoute("GET", "/api/tarot/status", new URLSearchParams(), {}, { deck: [] });
  assert.equal(res.status, 200);
  assert.equal(res.body.ready, false);
  assert.equal(res.body.reason, "empty_deck");
  assert.equal(res.body.card_count, 0);
  // No cards, no meanings, nothing that could leak an unreleased deck.
  assert.ok(!JSON.stringify(res.body).includes("upright_meaning"));
});

/* ── Validation ───────────────────────────────────────────────────────────── */

test("spread types outside the MVP are refused", () => {
  for (const good of ["daily", "one_card", "three_card"]) {
    assert.equal(validateSpreadType(good), good);
  }
  for (const bad of ["celtic_cross", "custom", "", null, undefined, 3, "DAILY"]) {
    assert.throws(() => validateSpreadType(bad), TarotError);
  }
});

test("a question is optional, normalized, and bounded", () => {
  assert.equal(validateQuestion(undefined), null);
  assert.equal(validateQuestion(null), null);
  // Blank in any form becomes null, so a reading never renders empty quotation
  // marks around a question nobody asked.
  assert.equal(validateQuestion("   "), null);
  assert.equal(validateQuestion("\n\t "), null);
  assert.equal(validateQuestion("  what   should I  notice? "), "what should I notice?");
  assert.equal(validateQuestion("a".repeat(MAX_QUESTION_LENGTH)).length, MAX_QUESTION_LENGTH);
  assert.throws(() => validateQuestion("a".repeat(MAX_QUESTION_LENGTH + 1)), TarotError);
  assert.throws(() => validateQuestion({ text: "no" }), TarotError);
});

test("a timezone must be one this server recognises", () => {
  assert.equal(validateTimezone(undefined), "UTC");
  assert.equal(validateTimezone("America/New_York"), "America/New_York");
  assert.throws(() => validateTimezone("Mars/Olympus_Mons"), TarotError);
  assert.throws(() => validateTimezone(42), TarotError);
});

test("a saved reading must hold real cards from the server's own deck", () => {
  const good = {
    spread_type: "three_card",
    cards: ["the-fool", "the-tower", "the-star"],
  };
  const clean = validateReadingPayload(good, { deck: DECK, deckVersion: FIXTURE_DECK_VERSION });
  assert.equal(clean.cards.length, 3);
  assert.equal(clean.cards[0].card.name, "The Fool");

  // Invented cards, wrong counts, and repeats are all refused.
  assert.throws(() => validateReadingPayload(
    { spread_type: "one_card", cards: ["the-card-of-infinite-wealth"] }, { deck: DECK }), TarotError);
  assert.throws(() => validateReadingPayload(
    { spread_type: "three_card", cards: ["the-fool", "the-tower"] }, { deck: DECK }), TarotError);
  assert.throws(() => validateReadingPayload(
    { spread_type: "three_card", cards: ["the-fool", "the-fool", "the-star"] }, { deck: DECK }), TarotError);
  assert.throws(() => validateReadingPayload(null, { deck: DECK }), TarotError);
});

test("position labels come from the product, not from the request", () => {
  // A client sending "Your future" must not get to persist it. This is the
  // difference between a non-predictive spread and a spread that happens to
  // have non-predictive defaults.
  const clean = validateReadingPayload({
    spread_type: "three_card",
    cards: [
      { slug: "the-fool", position: "Your past" },
      { slug: "the-tower", position: "Your present" },
      { slug: "the-star", position: "Your future" },
    ],
  }, { deck: DECK });
  assert.deepEqual(clean.cards.map((c) => c.position),
    ["What shaped this", "What is present", "What to consider next"]);
});

test("the meaning stored is the deck's, not the client's", () => {
  const clean = validateReadingPayload({
    spread_type: "one_card",
    cards: [{ slug: "the-star", upright_meaning: "You will inherit a fortune." }],
  }, { deck: DECK });
  assert.equal(clean.cards[0].card.upright_meaning, DECK.find((c) => c.slug === "the-star").upright_meaning);
  assert.ok(!clean.cards[0].card.upright_meaning.includes("inherit"));
});

test("the deck version recorded is the server's, not the client's claim", () => {
  const clean = validateReadingPayload({
    spread_type: "one_card",
    cards: ["the-star"],
    draw: { deck_version: "99.0.0-forged", reproducible: true },
  }, { deck: DECK, deckVersion: FIXTURE_DECK_VERSION });
  assert.equal(clean.draw.deck_version, FIXTURE_DECK_VERSION);
  // And a manual reading cannot claim to be reproducible from a date.
  assert.equal(clean.draw.reproducible, false);
});

/* ── Draw paths ───────────────────────────────────────────────────────────── */

test("the daily card is stable across requests and local-day aware", () => {
  const at = (iso) => dailyCard(ctx({ timezone: "America/New_York", now: new Date(iso) }));
  const morning = at("2026-08-15T14:00:00Z");   // 10:00 in New York
  const evening = at("2026-08-15T22:00:00Z");   // 18:00, same local day
  assert.equal(morning.cards[0].card.slug, evening.cards[0].card.slug);
  assert.equal(morning.draw.local_date, "2026-08-15");

  // 2026-08-16T03:00Z is 23:00 on the 15th in New York — still the same day
  // there, and the card must not have turned over at UTC midnight.
  const beforeLocalMidnight = at("2026-08-16T03:00:00Z");
  assert.equal(beforeLocalMidnight.draw.local_date, "2026-08-15");
  assert.equal(beforeLocalMidnight.cards[0].card.slug, morning.cards[0].card.slug);

  // 05:00Z is 01:00 on the 16th in New York: a new local day.
  const afterLocalMidnight = at("2026-08-16T05:00:00Z");
  assert.equal(afterLocalMidnight.draw.local_date, "2026-08-16");
});

test("the daily card cannot be requested as a manual draw", () => {
  assert.throws(() => manualReading(ctx({ spreadType: "daily" })), (error) => {
    assert.equal(error.code, "invalid_spread_type");
    return true;
  });
});

test("a manual reading carries its question and its positions", () => {
  const reading = manualReading(ctx({ spreadType: "three_card", question: "  What am I missing?  " }));
  assert.equal(reading.question, "What am I missing?");
  assert.deepEqual(reading.cards.map((c) => c.position),
    ["What shaped this", "What is present", "What to consider next"]);
  assert.equal(new Set(reading.cards.map((c) => c.card.slug)).size, 3);
});

/* ── Ownership ────────────────────────────────────────────────────────────── */

test("saving without a session is refused before any request is made", async () => {
  const fetchImpl = stubFetch();
  await assert.rejects(
    () => saveReading({ auth: null, payload: { spread_type: "one_card", cards: ["the-star"] }, deck: DECK, fetchImpl }),
    (error) => { assert.equal(error.status, 401); return true; },
  );
  assert.equal(fetchImpl.calls.length, 0, "an unauthenticated save must not reach the database");
});

test("a save is filed under the verified session, never the request body", async () => {
  const fetchImpl = stubFetch([{ id: "row-1", owner_id: AUTH.ownerId, spread_type: "one_card", reading_data: {} }]);
  await saveReading({
    auth: AUTH,
    payload: {
      spread_type: "one_card",
      cards: ["the-star"],
      // A client attempting to write into someone else's account.
      owner_id: "22222222-2222-4222-8222-222222222222",
    },
    deck: DECK, deckVersion: FIXTURE_DECK_VERSION, fetchImpl,
  });

  const [call] = fetchImpl.calls;
  const sent = JSON.parse(call.options.body);
  assert.equal(sent.owner_id, AUTH.ownerId, "owner_id must come from the session");
  assert.ok(!JSON.stringify(sent).includes("22222222"), "the forged owner must not survive");
  // The reader's own token does the talking, so RLS is the ownership check.
  assert.equal(call.options.headers.authorization, `Bearer ${AUTH.accessToken}`);
  assert.ok(!JSON.stringify(call.options.headers).includes("service_role"));
});

test("a saved reading stores slugs, never card row ids", async () => {
  const fetchImpl = stubFetch([{ id: "row-1", reading_data: {} }]);
  await saveReading({
    auth: AUTH,
    payload: { spread_type: "three_card", cards: ["the-fool", "the-tower", "the-star"] },
    deck: DECK, deckVersion: FIXTURE_DECK_VERSION, fetchImpl,
  });
  const sent = JSON.parse(fetchImpl.calls[0].options.body);
  const serialized = JSON.stringify(sent.reading_data);
  assert.ok(serialized.includes("the-tower"));
  assert.ok(!/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/.test(serialized),
    "no uuid may appear in a stored reading");
});

test("history is scoped to the owner and bounded", async () => {
  const fetchImpl = stubFetch([]);
  await listReadings({ auth: AUTH, limit: 5000, fetchImpl });
  const url = fetchImpl.calls[0].url;
  assert.ok(url.includes(`owner_id=eq.${AUTH.ownerId}`), "the query names its owner explicitly");
  assert.ok(url.includes("order=created_at.desc"));
  assert.ok(/limit=50\b/.test(url), "an unbounded limit is capped, not honoured");
});

test("history without a session is refused before any request", async () => {
  const fetchImpl = stubFetch();
  await assert.rejects(() => listReadings({ auth: null, fetchImpl }),
    (error) => { assert.equal(error.status, 401); return true; });
  assert.equal(fetchImpl.calls.length, 0);
});

test("a stored row is presented without the database's own bookkeeping", () => {
  const presented = presentReading({
    id: "row-1",
    owner_id: AUTH.ownerId,
    source_note_path: "/vault/private/note.md",
    spread_type: "one_card",
    question: "What now?",
    reading_data: { cards: [{ position: "Your card", card: { slug: "the-star", name: "The Star" } }] },
    created_at: "2026-08-15T12:00:00Z",
  });
  assert.equal(presented.owner_id, undefined);
  assert.equal(presented.source_note_path, undefined,
    "a private vault path is not part of a reading");
  assert.equal(presented.cards[0].card.name, "The Star");
});

test("a database failure never forwards the database's own words", async () => {
  const angry = async () => ({
    ok: false,
    status: 400,
    text: async () => 'permission denied for relation tarot_readings; policy "tarot_readings_insert_own"',
  });
  await assert.rejects(
    () => listReadings({ auth: AUTH, fetchImpl: angry }),
    (error) => {
      assert.ok(!/policy|relation|permission denied/i.test(error.message),
        `leaked database internals: ${error.message}`);
      return true;
    },
  );
});

/* ── Routing ──────────────────────────────────────────────────────────────── */

test("unknown tarot routes are not claimed", async () => {
  assert.equal(await handleTarotRoute("GET", "/api/tarot/nonsense", new URLSearchParams(), {}, ctx()), null);
  assert.equal(await handleTarotRoute("DELETE", "/api/tarot/daily", new URLSearchParams(), {}, ctx()), null);
});

test("the daily route answers a signed-out visitor", async () => {
  const res = await handleTarotRoute("GET", "/api/tarot/daily",
    new URLSearchParams({ timezone: "Europe/Berlin" }), {}, ctx({ auth: null, now: new Date("2026-08-15T10:00:00Z") }));
  assert.equal(res.status, 200);
  assert.equal(res.body.reading.cards.length, 1);
  assert.equal(res.body.reading.draw.timezone, "Europe/Berlin");
});

test("two accounts receive different daily cards on the same day", async () => {
  const forOwner = async (ownerId) => {
    const res = await handleTarotRoute("GET", "/api/tarot/daily", new URLSearchParams(), {},
      ctx({ auth: { ...AUTH, ownerId }, now: new Date("2026-08-15T10:00:00Z") }));
    return res.body.reading.draw.seed;
  };
  assert.notEqual(await forOwner("owner-a"), await forOwner("owner-b"));
});

test("a bad timezone is a 400, not a silent fallback to the server's clock", async () => {
  const res = await handleTarotRoute("GET", "/api/tarot/daily",
    new URLSearchParams({ timezone: "Nowhere/Fictional" }), {}, ctx());
  assert.equal(res.status, 400);
  assert.equal(res.body.code, "invalid_timezone");
});
