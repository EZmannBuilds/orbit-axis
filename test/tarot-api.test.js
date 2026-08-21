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
  const check = (error) => {
    assert.ok(error instanceof TarotError);
    assert.equal(error.status, 503);
    assert.equal(error.code, "empty_deck");
    return true;
  };
  await assert.rejects(() => dailyCard({ deck: [] }), check);
  assert.throws(() => manualReading({ deck: [], spreadType: "one_card" }), check);
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

test("today's card is drawn once and then remembered", async () => {
  // Stability used to be arithmetic — recompute and get the same answer. It is
  // now a stored fact, so the test is about the store: draw once, and every
  // later request that day returns that card rather than a fresh one.
  const first = await dailyCard(ctx({ now: new Date("2026-08-15T14:00:00Z") }));
  const held = first.remember;
  assert.equal(first.source, "drawn_local", "no account, so the browser remembers it");
  assert.equal(held.local_date, "2026-08-15");

  // Handing the remembered card back returns the same card, not a new draw.
  for (let i = 0; i < 20; i += 1) {
    const again = await dailyCard(ctx({ now: new Date("2026-08-15T22:00:00Z"), remembered: held }));
    assert.equal(again.cards[0].card.slug, first.cards[0].card.slug);
    assert.equal(again.source, "remembered");
  }
});

test("the day belongs to the reader, and yesterday's card does not carry over", async () => {
  const held = { local_date: "2026-08-15", card_slug: "the-star", orientation: "upright" };

  // 2026-08-16T03:00Z is still the 15th in New York, so the card holds.
  const sameDay = await dailyCard(ctx({
    timezone: "America/New_York", now: new Date("2026-08-16T03:00:00Z"), remembered: held,
  }));
  assert.equal(sameDay.draw.local_date, "2026-08-15");
  assert.equal(sameDay.cards[0].card.name, "The Star");

  // 05:00Z is the 16th there: a new local day, so a fresh draw regardless of
  // what the browser is still holding.
  const nextDay = await dailyCard(ctx({
    timezone: "America/New_York", now: new Date("2026-08-16T05:00:00Z"), remembered: held,
  }));
  assert.equal(nextDay.draw.local_date, "2026-08-16");
  assert.notEqual(nextDay.source, "remembered");
});

/* A deck that offers both halves, which the plain fixture does not: presentCard
   refuses to show a card reversed unless the deck actually holds a reversed
   meaning, so a reversal test needs a deck that supports reversals. */
const REVERSIBLE_DECK = DECK.map((card) => ({
  ...card,
  reversed_meaning: `Fixture reversed meaning for ${card.name}.`,
  reversed_prompt: `Fixture reversed prompt for ${card.name}?`,
}));

test("a card that lands reversed is remembered as reversed, even with reversals off", async () => {
  // The bug this pins: orientation used to be decided by the reader's setting
  // at draw time, so with reversals off every card was written down as upright
  // and the reversal was gone for good — the daily seed is not kept, so
  // nothing could recover it. What is drawn is now recorded either way, and
  // only the display honours the setting.
  const drawn = [];
  for (let i = 0; i < 200; i += 1) {
    const reading = await dailyCard({
      deck: REVERSIBLE_DECK, deckVersion: FIXTURE_DECK_VERSION, reversals: false,
      now: new Date("2026-08-15T14:00:00Z"),
    });
    // Shown upright, always — that part is the reader's setting doing its job.
    assert.equal(reading.cards[0].card.orientation, "upright");
    drawn.push(reading.remember);
  }
  const reversed = drawn.find((r) => r.orientation === "reversed");
  assert.ok(reversed, "200 draws with reversals off recorded no reversal at all");

  // Turn the setting on and hand back the same remembered card: it comes back
  // the way it was actually drawn, not upright.
  const shown = await dailyCard({
    deck: REVERSIBLE_DECK, deckVersion: FIXTURE_DECK_VERSION, reversals: true,
    now: new Date("2026-08-15T14:00:00Z"), remembered: reversed,
  });
  assert.equal(shown.source, "remembered");
  assert.equal(shown.cards[0].card.slug, reversed.card_slug);
  assert.equal(shown.cards[0].card.orientation, "reversed");
  assert.equal(shown.remember.orientation, "reversed", "the record still holds the truth");
});

test("a remembered card that is no longer in the deck yields a fresh draw", async () => {
  // The deck changed under the reader. Better a new card than an error page
  // about one that no longer exists.
  const reading = await dailyCard(ctx({
    remembered: { local_date: "2026-08-15", card_slug: "a-card-that-was-removed", orientation: "upright" },
  }));
  assert.notEqual(reading.source, "remembered");
  assert.ok(reading.cards[0].card.slug);
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

/* ── The daily reading is filed once per local day ────────────────────────
   The client saves the revealed daily card automatically, so the server has
   to be the arbiter of "once": a second device, a cleared browser, or a
   repeated visit must find the day's existing row rather than file another.
   tarot_readings has no unique constraint to lean on — the local date lives
   inside reading_data — so the guard is read-then-insert, and these tests
   hold both halves of it. */

const DAILY_PAYLOAD = Object.freeze({
  spread_type: "daily",
  cards: ["the-fool"],
  draw: { local_date: "2026-08-15", timezone: "UTC" },
});

test("a second daily save the same day returns the existing reading, inserting nothing", async () => {
  const existing = {
    id: "row-daily",
    spread_type: "daily",
    question: null,
    reading_data: {
      cards: [{ position: "Today's card", card: { slug: "the-star", name: "The Star" } }],
      draw: { local_date: "2026-08-15" },
    },
    created_at: "2026-08-15T08:00:00Z",
  };
  const calls = [];
  const fetchImpl = async (url, options = {}) => {
    calls.push({ url: String(url), method: options.method });
    return { ok: true, status: 200, text: async () => JSON.stringify([existing]) };
  };

  const saved = await saveReading({
    auth: AUTH, payload: { ...DAILY_PAYLOAD }, deck: DECK, deckVersion: FIXTURE_DECK_VERSION, fetchImpl,
  });

  assert.equal(calls.length, 1, "found, so nothing may be inserted");
  assert.equal(calls[0].method, "GET");
  assert.ok(calls[0].url.includes("spread_type=eq.daily"));
  assert.ok(calls[0].url.includes(`owner_id=eq.${AUTH.ownerId}`), "the check is owner-scoped");
  assert.ok(calls[0].url.includes("local_date=eq.2026-08-15"));
  // The day's FIRST card is what history keeps — not whatever arrived second.
  assert.equal(saved.id, "row-daily");
  assert.equal(saved.cards[0].card.slug, "the-star");
});

test("the first daily save of the day checks, finds nothing, and inserts", async () => {
  const calls = [];
  const fetchImpl = async (url, options = {}) => {
    calls.push({ url: String(url), method: options.method, body: options.body });
    return {
      ok: true, status: 200,
      text: async () => JSON.stringify(calls.length === 1 ? [] : [{ id: "row-new", spread_type: "daily", reading_data: {} }]),
    };
  };

  const saved = await saveReading({
    auth: AUTH, payload: { ...DAILY_PAYLOAD }, deck: DECK, deckVersion: FIXTURE_DECK_VERSION, fetchImpl,
  });

  assert.equal(calls.length, 2);
  assert.equal(calls[0].method, "GET");
  assert.equal(calls[1].method, "POST");
  assert.equal(saved.id, "row-new");
});

test("a failed dedupe check must not cost the reader their save", async () => {
  const calls = [];
  const fetchImpl = async (url, options = {}) => {
    calls.push({ method: options.method });
    if (calls.length === 1) throw new Error("store unreachable");
    return { ok: true, status: 200, text: async () => JSON.stringify([{ id: "row-new", reading_data: {} }]) };
  };

  const saved = await saveReading({
    auth: AUTH, payload: { ...DAILY_PAYLOAD }, deck: DECK, deckVersion: FIXTURE_DECK_VERSION, fetchImpl,
  });

  assert.equal(calls.length, 2, "the check failing falls through to the insert");
  assert.equal(calls[1].method, "POST");
  assert.equal(saved.id, "row-new");
});

test("a manual reading is never deduped — drawing twice keeps both", async () => {
  const fetchImpl = stubFetch([{ id: "row-1", reading_data: {} }]);
  await saveReading({
    auth: AUTH,
    payload: { spread_type: "one_card", cards: ["the-star"], draw: { local_date: "2026-08-15" } },
    deck: DECK, deckVersion: FIXTURE_DECK_VERSION, fetchImpl,
  });
  assert.equal(fetchImpl.calls.length, 1, "no pre-check for a manual draw");
  assert.equal(fetchImpl.calls[0].options.method, "POST");
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

test("each account draws its own card, and nothing ties it to who they are", async () => {
  // This used to be guaranteed: the account id was in the seed, so two people
  // could never share a card. It is now simply a draw — two accounts usually
  // differ, sometimes match, and neither outcome is arranged.
  const draws = [];
  for (let i = 0; i < 40; i += 1) {
    const res = await handleTarotRoute("GET", "/api/tarot/daily", new URLSearchParams(), {},
      ctx({ auth: null, now: new Date("2026-08-15T10:00:00Z") }));
    draws.push(res.body.reading.cards[0].card.slug);
  }
  assert.ok(new Set(draws).size > 10,
    "40 requests produced too few distinct cards to be a draw");
});

test("a bad timezone is a 400, not a silent fallback to the server's clock", async () => {
  const res = await handleTarotRoute("GET", "/api/tarot/daily",
    new URLSearchParams({ timezone: "Nowhere/Fictional" }), {}, ctx());
  assert.equal(res.status, 400);
  assert.equal(res.body.code, "invalid_timezone");
});
