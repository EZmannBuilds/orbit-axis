// Orbit Axis :: the Tarot service boundary.
//
// THE BROWSER OWNS NO DRAW AND NO AUTHORIZATION RULE.
//
// Every card that reaches a reader is selected here, on the server, from a
// deck the browser never receives in full. That is not paranoia about cheating
// — nobody is competing — it is what makes the daily card's stability a
// property of the system rather than of one device's localStorage. A client
// that drew its own card would produce a different "today" on a phone than on
// a laptop, and no amount of syncing afterwards would repair the fact that the
// reader saw two different cards.
//
// The same boundary carries authorization: saving and history are owner-scoped
// through the reader's own Supabase token, so RLS does the filtering in the
// database rather than in a filter this file has to remember to write. That is
// the rule the account export already follows, for the reason stated there —
// a forgotten filter should produce an empty result, not somebody else's data.

import { supabaseConfig } from "../local-llm/config.js";
import { resolveEnvironment } from "../env/environment.js";
import { DRAFT_CARDS, DRAFT_DECK_VERSION } from "./draft-deck.js";
import { localDateForZone } from "../fortune/engine.js";
import {
  DECK_VERSION, PRODUCTION_CARDS, SPREAD_POSITIONS, SPREAD_SIZES, SPREAD_TYPES,
  cardBySlug, deckStatus, presentCard,
} from "./deck.js";
import { DRAW_CONTRACT_VERSION, drawDailyCard, drawSpread, isLocalDate } from "./draw.js";

/** The longest question we will accept. Long enough to be a real question. */
export const MAX_QUESTION_LENGTH = 280;

/** Newest first, and bounded — history is a page, not a database dump. */
export const HISTORY_LIMIT = 50;

export class TarotError extends Error {
  constructor(code, message, { status = 400, details = null } = {}) {
    super(message);
    this.name = "TarotError";
    this.code = code;
    this.status = status;
    this.details = details;
  }
}

/**
 * The deck this instance may draw from.
 *
 * PRODUCTION HAS EXACTLY ONE ANSWER and it is the empty PRODUCTION_CARDS. No
 * environment variable swaps a deck in; reviewed content arrives by code change
 * and review, which is the ceremony the licensing note requires.
 *
 * Outside production the draft deck is served instead, so the feature can be
 * read, tested and argued with while the commissioned meanings are written.
 * The draft declares itself unreviewed, and `assertDeckReady` only tolerates
 * that outside production — so the draft cannot ship by being forgotten, only
 * by someone editing this function on purpose.
 */
export function resolveDeck({ deck, deckVersion, env = process.env } = {}) {
  // An explicit deck always wins — that is how the tests supply a fixture.
  if (deck) return { deck, deckVersion: deckVersion ?? DECK_VERSION };

  // Production reads the production deck, which is empty until real content is
  // authored and reviewed. Everywhere else reads the draft, so the feature can
  // actually be exercised. The draft carries its own version, so a card drawn
  // from it is openly a different draw from one drawn later from the
  // commissioned deck rather than silently the same.
  if (isProductionEnv(env)) return { deck: PRODUCTION_CARDS, deckVersion: DECK_VERSION };
  return { deck: DRAFT_CARDS, deckVersion: DRAFT_DECK_VERSION };
}

/** Production is the deployed production environment, per the app's resolver. */
export function isProductionEnv(env = process.env) {
  return resolveEnvironment({ env, loadEnvFiles: false }).isProduction === true;
}

/** Unreviewed content may be READ outside production, and never inside it. */
function unreviewedAllowed(env = process.env) {
  return !isProductionEnv(env);
}

/**
 * Readiness as this instance actually judges it.
 *
 * The status route used to call deckStatus() directly, which applies the
 * production rule everywhere — so a local instance happily served readings
 * while telling the panel it was not ready. One judgement, used by both the
 * gate and the thing that reports on the gate.
 */
export function deckReadiness({ deck, env = process.env } = {}) {
  const resolved = deck ?? resolveDeck({ env }).deck;
  return deckStatus(resolved, { allowUnreviewed: unreviewedAllowed(env) });
}

/**
 * Refuse to serve anything if the deck is not shippable.
 *
 * Called at the top of every read path. An incomplete deck produces a clean,
 * explainable refusal rather than a partial reading — showing three cards from
 * a nine-card deck would be worse than showing none, because it looks like it
 * worked.
 */
export function assertDeckReady({ deck = PRODUCTION_CARDS, env = process.env } = {}) {
  const status = deckStatus(deck, { allowUnreviewed: unreviewedAllowed(env) });
  if (!status.ready) {
    throw new TarotError(status.reason, status.message, { status: 503, details: { count: status.count } });
  }
  return status;
}

/* ── validation ────────────────────────────────────────────────────────────
   Every one of these runs on the SERVER against whatever arrived, not against
   what the interface believes it sent. The panel also validates, because a
   reader should learn a question is too long before submitting it, but that
   copy is a courtesy and this is the rule. */

export function validateSpreadType(value) {
  if (!SPREAD_TYPES.includes(value)) {
    throw new TarotError("invalid_spread_type",
      `Spread type must be one of ${SPREAD_TYPES.join(", ")}.`, { status: 400 });
  }
  return value;
}

/**
 * An optional question, normalized.
 *
 * Absent, null, and blank all mean the same thing — no question — and all
 * become null rather than "". A stored empty string would render as a question
 * that the reader never asked, complete with quotation marks around nothing.
 */
export function validateQuestion(value) {
  if (value === undefined || value === null) return null;
  if (typeof value !== "string") {
    throw new TarotError("invalid_question", "A question must be text.", { status: 400 });
  }
  const trimmed = value.replace(/\s+/g, " ").trim();
  if (!trimmed) return null;
  if (trimmed.length > MAX_QUESTION_LENGTH) {
    throw new TarotError("question_too_long",
      `A question can be up to ${MAX_QUESTION_LENGTH} characters.`, { status: 400 });
  }
  return trimmed;
}

export function validateTimezone(value) {
  if (value === undefined || value === null || value === "") return "UTC";
  if (typeof value !== "string") {
    throw new TarotError("invalid_timezone", "Timezone must be an IANA name.", { status: 400 });
  }
  try {
    new Intl.DateTimeFormat("en-CA", { timeZone: value });
    return value;
  } catch {
    throw new TarotError("invalid_timezone",
      "That timezone is not a name this server recognises.", { status: 400 });
  }
}

/**
 * Validate a reading payload arriving for save.
 *
 * The cards are re-resolved from the deck by slug rather than trusted: a saved
 * reading must contain a real card with the meaning the deck actually holds,
 * or history becomes a place where anyone can write their own tarot. Position
 * labels are likewise taken from SPREAD_POSITIONS and not from the request —
 * "What to consider next" is a product decision, and a client that sent
 * "Your future" would otherwise persist it.
 */
export function validateReadingPayload(payload, { deck, deckVersion = DECK_VERSION } = {}) {
  if (!payload || typeof payload !== "object") {
    throw new TarotError("invalid_payload", "A reading is required.", { status: 400 });
  }

  const spreadType = validateSpreadType(payload.spread_type);
  const question = validateQuestion(payload.question);
  const expectedSize = SPREAD_SIZES[spreadType];
  const positions = SPREAD_POSITIONS[spreadType];

  const cards = Array.isArray(payload.cards) ? payload.cards : null;
  if (!cards || cards.length !== expectedSize) {
    throw new TarotError("invalid_cards",
      `A ${spreadType.replace("_", "-")} reading holds ${expectedSize} card(s).`, { status: 400 });
  }

  const seen = new Set();
  const resolved = cards.map((entry, index) => {
    const slug = typeof entry === "string" ? entry : entry?.slug ?? entry?.card?.slug;
    if (typeof slug !== "string" || !slug) {
      throw new TarotError("invalid_cards", "Every card must name itself.", { status: 400 });
    }
    const card = cardBySlug(deck, slug);
    if (!card) {
      throw new TarotError("unknown_card", "That card is not in this deck.", { status: 400 });
    }
    if (seen.has(slug)) {
      throw new TarotError("duplicate_card", "A spread cannot repeat a card.", { status: 400 });
    }
    seen.add(slug);
    // The orientation is part of what was drawn. Dropping it would make every
    // saved reversal read as upright in history — the same card saying
    // something it did not say.
    const orientation = (typeof entry === "object" && entry?.orientation === "reversed") ? "reversed" : "upright";
    return { position: positions[index], card: presentCard(card, { orientation }) };
  });

  const draw = payload.draw && typeof payload.draw === "object" ? payload.draw : {};
  // The deck version is recorded from the SERVER's deck, not the client's
  // claim: a reading saved as drawn from a deck that was never in play would
  // be unauditable in exactly the way the contract exists to prevent.
  return {
    spread_type: spreadType,
    question,
    cards: resolved,
    draw: {
      spread_type: spreadType,
      contract_version: DRAW_CONTRACT_VERSION,
      deck_version: deckVersion,
      local_date: isLocalDate(draw.local_date) ? draw.local_date : null,
      timezone: typeof draw.timezone === "string" ? draw.timezone : null,
      reproducible: spreadType === "daily",
    },
  };
}

/* ── draw paths ────────────────────────────────────────────────────────────── */

/**
 * Today's card for this reader.
 *
 * `now` and `timezone` are separate parameters because they answer different
 * questions: `now` is the instant, `timezone` is whose midnight counts. The
 * local date is derived here with the same helper the fortune uses, so Tarot
 * and astrology agree about when the day turned over — two definitions of
 * "today" in one app is a bug that only shows up near midnight, to the people
 * least able to explain it.
 */
/**
 * Today's card: drawn once, then remembered for the rest of the local day.
 *
 * THE ORDER MATTERS. Read first, draw only if nothing is stored. A draw that
 * happened before the read would burn a fresh card on every page load and then
 * throw it away, which is invisible until someone notices their "daily" card
 * changing on refresh.
 *
 * `remembered` is the store: a signed-in reader's draw goes to the database so
 * a second device shows the same card; a signed-out reader has no account to
 * key a row to, so the browser remembers instead and a second device draws its
 * own. That difference is stated in the response rather than hidden, because it
 * is the honest consequence of having no account.
 */
export async function dailyCard({
  deck, deckVersion = DECK_VERSION, timezone = "UTC", now = new Date(),
  reversals = false, remembered = null, auth = null, fetchImpl = fetch,
} = {}) {
  assertDeckReady({ deck });
  const zone = validateTimezone(timezone);
  const localDate = localDateForZone(now, zone);

  const store = auth?.ownerId ? createDailyDrawStore({ auth, fetchImpl }) : null;

  // 1. Already drawn today? Then that is the card, whatever else happens.
  let existing = remembered && remembered.local_date === localDate ? remembered : null;
  if (!existing && store) existing = await store.read({ localDate, deckVersion });

  if (existing) {
    const card = cardBySlug(deck, existing.card_slug);
    // A stored slug that is no longer in the deck means the deck changed under
    // the reader. Falling through to a fresh draw is better than an error page
    // about a card that no longer exists.
    if (card) {
      return dailyReading({
        card, orientation: reversals ? existing.orientation : "upright",
        localDate, zone, deckVersion, reversals, source: "remembered",
      });
    }
  }

  // 2. Nothing stored: draw, genuinely at random.
  const { card, orientation, draw } = drawDailyCard({ deck, localDate, timezone: zone, deckVersion, reversals });

  // 3. Write it down. A failed write is not a failed reading — the reader gets
  //    their card either way, and the worst case is that it is redrawn later.
  if (store) {
    const stored = await store.write({
      localDate, deckVersion, cardSlug: card.slug, orientation,
    });
    // Lost a race with another tab? Then the other tab's card is the day's
    // card, and this one defers to it rather than both being "today's".
    if (stored && stored.card_slug !== card.slug) {
      const winner = cardBySlug(deck, stored.card_slug);
      if (winner) {
        return dailyReading({
          card: winner, orientation: reversals ? stored.orientation : "upright",
          localDate, zone, deckVersion, reversals, source: "remembered",
        });
      }
    }
  }

  return dailyReading({
    card, orientation, localDate, zone, deckVersion, reversals,
    source: store ? "drawn" : "drawn_local",
    draw,
  });
}

/** One shape for a daily reading, whether it was just drawn or read back. */
function dailyReading({ card, orientation, localDate, zone, deckVersion, reversals, source, draw = null }) {
  return {
    spread_type: "daily",
    question: null,
    cards: [{ position: SPREAD_POSITIONS.daily[0], card: presentCard(card, { orientation }) }],
    draw: draw ?? {
      spread_type: "daily",
      contract_version: DRAW_CONTRACT_VERSION,
      deck_version: deckVersion,
      local_date: localDate,
      timezone: zone,
      reversals,
      reproducible: false,
    },
    // What the browser needs in order to remember this card itself, which is
    // the only way a signed-out reader keeps the same card across a refresh.
    remember: { local_date: localDate, deck_version: deckVersion, card_slug: card.slug, orientation },
    source,
  };
}

/** Reads and writes the one-row-per-day record. Owner-scoped through RLS. */
function createDailyDrawStore({ auth, fetchImpl = fetch }) {
  return {
    async read({ localDate, deckVersion }) {
      try {
        const query = `tarot_daily_draws?owner_id=eq.${auth.ownerId}`
          + `&local_date=eq.${encodeURIComponent(localDate)}`
          + `&deck_version=eq.${encodeURIComponent(deckVersion)}&limit=1`;
        const rows = await rest(auth, "GET", query, null, {}, fetchImpl);
        return Array.isArray(rows) && rows.length ? rows[0] : null;
      } catch {
        // An unreachable store must not cost the reader their card. They get a
        // fresh draw, which is the same failure mode as a first visit.
        return null;
      }
    },

    async write({ localDate, deckVersion, cardSlug, orientation }) {
      try {
        // resolution=merge-duplicates makes the unique constraint the
        // arbiter: two tabs opening at once cannot produce two cards.
        const rows = await rest(auth, "POST", "tarot_daily_draws?on_conflict=owner_id,local_date,deck_version", {
          owner_id: auth.ownerId,
          local_date: localDate,
          deck_version: deckVersion,
          card_slug: cardSlug,
          orientation,
        }, { prefer: "return=representation,resolution=merge-duplicates" }, fetchImpl);
        return Array.isArray(rows) && rows.length ? rows[0] : null;
      } catch {
        return null;
      }
    },
  };
}

/** A manual one- or three-card reflection. Drawn now, not derived. */
export function manualReading({ deck, deckVersion = DECK_VERSION, spreadType, question = null, seed, timezone = "UTC", now = new Date(), reversals = false } = {}) {
  assertDeckReady({ deck });
  const type = validateSpreadType(spreadType);
  if (type === "daily") {
    throw new TarotError("invalid_spread_type",
      "The daily card is drawn for the day, not on request.", { status: 400 });
  }
  const cleanQuestion = validateQuestion(question);
  const zone = validateTimezone(timezone);
  const { cards, draw } = drawSpread({ deck, spreadType: type, deckVersion, reversals, ...(seed ? { seed } : {}) });
  return {
    spread_type: type,
    question: cleanQuestion,
    cards: cards.map(({ position, card, orientation }) => ({ position, card: presentCard(card, { orientation }) })),
    draw: { ...draw, local_date: localDateForZone(now, zone), timezone: zone },
  };
}

/* ── persistence ───────────────────────────────────────────────────────────
   Owner-scoped through the reader's own token. `owner_id` is written from the
   VERIFIED identity, never from the request body, so a client cannot file a
   reading under someone else's account even before RLS refuses it. */

function restBase(auth = null) {
  const config = supabaseConfig();
  const url = auth?.url || config.url;
  const anonKey = auth?.anonKey || config.anonKey;
  const accessToken = auth?.accessToken || config.accessToken;
  const ownerId = auth?.ownerId || config.ownerId;
  if (!url || !anonKey || !accessToken || !ownerId) return { ready: false };
  return {
    ready: true,
    ownerId,
    root: url.replace(/\/+$/, ""),
    headers: {
      apikey: anonKey,
      authorization: `Bearer ${accessToken}`,
      "content-type": "application/json",
    },
  };
}

async function rest(auth, method, pathQuery, body, extraHeaders = {}, fetchImpl = fetch) {
  const b = restBase(auth);
  if (!b.ready) {
    throw new TarotError("unauthorized", "Sign in to save and see your readings.", { status: 401 });
  }
  let res;
  try {
    res = await fetchImpl(`${b.root}/rest/v1/${pathQuery}`, {
      method,
      headers: { ...b.headers, ...extraHeaders },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(15000),
    });
  } catch (error) {
    throw new TarotError("unavailable",
      "Your readings could not be reached just now. Please try again.", { status: 503, details: String(error?.name || "") });
  }
  if (!res.ok) {
    // The database's own message can name policies and columns; it never
    // reaches the reader.
    throw new TarotError("unavailable",
      "Your readings could not be reached just now. Please try again.", { status: 502 });
  }
  const text = await res.text();
  return text ? JSON.parse(text) : null;
}

/**
 * Save a reading. Returns the stored row as the client should see it.
 *
 * `reading_data` holds card SLUGS and authored text, never a `tarot_cards`
 * uuid. That keeps a saved reading readable after the reference table is
 * re-seeded, and it is what lets the account export carry Tarot without
 * tripping its own audit — the export forbids raw uuids in server-written
 * fields, correctly.
 */
export async function saveReading({ auth, payload, deck, deckVersion = DECK_VERSION, fetchImpl = fetch }) {
  assertDeckReady({ deck });
  const clean = validateReadingPayload(payload, { deck, deckVersion });
  const b = restBase(auth);
  if (!b.ready) {
    throw new TarotError("unauthorized", "Sign in to save this reflection.", { status: 401 });
  }

  // The daily card is one reading per local day, so saving it is idempotent:
  // the day's existing row wins over a second insert. The check is read-then-
  // insert rather than a unique constraint because `tarot_readings` has no
  // local_date column to constrain — the date lives inside reading_data — and
  // the client already saves at most once per day per device, so this guard is
  // for the second device, not for a race. A failed read must not cost the
  // reader their save; it falls through to the insert.
  if (clean.spread_type === "daily" && clean.draw.local_date) {
    const existing = await findDailyReading({ auth, ownerId: b.ownerId, localDate: clean.draw.local_date, fetchImpl });
    if (existing) return presentReading(existing);
  }

  const row = {
    owner_id: b.ownerId,            // from the verified session, never the body
    question: clean.question,
    spread_type: clean.spread_type,
    reading_data: {
      cards: clean.cards,
      draw: clean.draw,
      saved_with: { contract_version: DRAW_CONTRACT_VERSION, deck_version: deckVersion },
    },
  };

  const data = await rest(auth, "POST", "tarot_readings", row,
    { prefer: "return=representation" }, fetchImpl);
  const saved = Array.isArray(data) ? data[0] : data;
  return presentReading(saved);
}

/** Today's already-saved daily reading, if the account holds one. */
async function findDailyReading({ auth, ownerId, localDate, fetchImpl }) {
  try {
    const query = `tarot_readings?owner_id=eq.${ownerId}&spread_type=eq.daily`
      + `&reading_data->draw->>local_date=eq.${encodeURIComponent(localDate)}`
      + `&order=created_at.asc&limit=1`;
    const rows = await rest(auth, "GET", query, null, {}, fetchImpl);
    return Array.isArray(rows) && rows.length ? rows[0] : null;
  } catch {
    return null;
  }
}

/** This account's saved readings, newest first. RLS does the scoping. */
export async function listReadings({ auth, limit = HISTORY_LIMIT, fetchImpl = fetch } = {}) {
  const b = restBase(auth);
  if (!b.ready) {
    throw new TarotError("unauthorized", "Sign in to see your saved reflections.", { status: 401 });
  }
  const capped = Math.max(1, Math.min(Number(limit) || HISTORY_LIMIT, HISTORY_LIMIT));
  const query = `tarot_readings?owner_id=eq.${b.ownerId}&order=created_at.desc&limit=${capped}`;
  const rows = await rest(auth, "GET", query, null, {}, fetchImpl);
  return (rows || []).map(presentReading).filter(Boolean);
}

/**
 * A stored row as the browser may see it.
 *
 * `id` is kept — the panel needs something to key a list on — but `owner_id`
 * and `source_note_path` are dropped. The first is the account's database
 * identity, which the client already knows implicitly and gains nothing from;
 * the second names a path in the owner's private vault sync and is not part of
 * a reading at all.
 */
export function presentReading(row) {
  if (!row || typeof row !== "object") return null;
  const data = row.reading_data && typeof row.reading_data === "object" ? row.reading_data : {};
  return {
    id: row.id ?? null,
    spread_type: row.spread_type ?? data.draw?.spread_type ?? null,
    question: row.question ?? null,
    cards: Array.isArray(data.cards) ? data.cards : [],
    draw: data.draw ?? null,
    created_at: row.created_at ?? null,
  };
}
