// Orbit Axis :: the Tarot draw contract.
//
// Two different kinds of randomness live here and they must not be confused.
//
// THE DAILY CARD IS NOT RANDOM. It is a pure function of (local date, deck
// version, subject). Refreshing the page, closing the tab, coming back after
// dinner, or opening the app on a second device all recompute the same card
// from the same inputs. Storing the daily card would make it *look* stable
// while actually depending on whether the write succeeded; deriving it makes
// stability a property of the arithmetic. This mirrors the fortune engine's
// seed contract, which the app already relies on for the same reason.
//
// A MANUAL DRAW IS RANDOM. When someone asks for a one- or three-card
// reflection they are asking for a draw, and giving them the same three cards
// every time they press the button would be a bug, not determinism.
//
// The seam between them is the seed: daily seeds are derived, manual seeds are
// generated from a CSPRNG. Everything after the seed is shared, which is what
// keeps "no duplicates in a spread" and "unbiased selection" true of both.

import { createHash, randomBytes } from "node:crypto";
import { DECK_VERSION, SPREAD_SIZES, SPREAD_POSITIONS } from "./deck.js";

/**
 * The draw contract version.
 *
 * Separate from DECK_VERSION on purpose: re-authoring the deck and changing
 * the *selection arithmetic* are different events, and a reading records both
 * so a card drawn last year can be explained by the rules in force when it was
 * drawn. Bumping either changes future draws; neither rewrites a saved one.
 */
export const DRAW_CONTRACT_VERSION = "1.0.0";

/**
 * The seed for a person's daily card.
 *
 * `localDate` is a YYYY-MM-DD string already resolved in the reader's own
 * timezone by the caller — the boundary between one day's card and the next is
 * midnight where the READER is, never on the server. Passing the timezone name
 * in as well is not redundant: two readers on the same calendar date in
 * different zones are genuinely having different days, and a traveller who
 * changes zones should not be handed a second "today".
 *
 * `subject` is the account id for a signed-in reader and the literal string
 * "anonymous" for everyone else. Signed-out visitors therefore share one
 * card per day, which is a deliberate and stated property rather than an
 * accident: with no account there is nothing to key a personal draw to, and
 * inventing a device identifier to make one would be tracking.
 */
export function dailySeed({ localDate, timezone = "UTC", deckVersion = DECK_VERSION, subject = "anonymous" }) {
  if (!isLocalDate(localDate)) {
    throw new TypeError(`dailySeed: localDate must be YYYY-MM-DD, received ${JSON.stringify(localDate)}`);
  }
  return createHash("sha256")
    .update(["tarot-daily", DRAW_CONTRACT_VERSION, deckVersion, localDate, timezone, subject].join("|"))
    .digest("hex");
}

/** A fresh seed for a manual draw. Not derived from anything the caller controls. */
export function manualSeed() {
  return randomBytes(32).toString("hex");
}

/** YYYY-MM-DD, and a real date — "2026-02-31" is neither. */
export function isLocalDate(value) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [y, m, d] = value.split("-").map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  return date.getUTCFullYear() === y && date.getUTCMonth() === m - 1 && date.getUTCDate() === d;
}

/**
 * An index in [0, size) with no modulo bias.
 *
 * The naive version — `parseInt(hash.slice(0, 8), 16) % size` — is what the
 * fortune engine uses, and for picking a phrase from a bank of six it is
 * immaterial. Here it is worth doing properly: 2^32 is not a multiple of 78,
 * so a modulo would make the first 34 cards very slightly likelier than the
 * rest, forever, in a way no amount of testing at the interface would ever
 * surface. A deck that quietly favours the majors is the kind of defect that
 * is embarrassing precisely because it was avoidable.
 *
 * Rejection sampling: derive 32-bit words from the seed, discard any that fall
 * in the final partial block, and take the first that lands cleanly. Each
 * attempt uses its own counter so the stream is reproducible from the seed.
 * Termination is probabilistic but overwhelmingly fast — the rejection zone is
 * under one part in fifty million for a 78-card deck — and the loop is bounded
 * anyway so a pathological seed cannot hang a request.
 */
export function unbiasedIndex(seed, label, size) {
  if (!Number.isInteger(size) || size <= 0) {
    throw new RangeError(`unbiasedIndex: size must be a positive integer, received ${size}`);
  }
  if (size === 1) return 0;

  const LIMIT = 2 ** 32;
  const usable = LIMIT - (LIMIT % size);   // largest multiple of size that fits

  for (let attempt = 0; attempt < 64; attempt += 1) {
    const digest = createHash("sha256").update(`${seed}:${label}:${attempt}`).digest();
    const word = digest.readUInt32BE(0);
    if (word < usable) return word % size;
  }
  // Unreachable in practice. Falling back to a modulo is a vanishingly biased
  // answer, which is still better than throwing on a reading someone asked for.
  const digest = createHash("sha256").update(`${seed}:${label}:fallback`).digest();
  return digest.readUInt32BE(0) % size;
}

/**
 * Draw `count` distinct cards from `deck`.
 *
 * A partial Fisher-Yates over a copy of the index list. Drawing each card
 * independently and re-rolling on a collision would also work, but it makes
 * "no duplicates" a property of a retry loop rather than of the algorithm —
 * and a retry loop is exactly the sort of thing that gets a `break` added to
 * it during a later performance panic.
 *
 * Every swap uses its own labelled index, so the same seed yields the same
 * spread and a test can assert it.
 */
export function drawCards(deck, count, seed) {
  if (!Array.isArray(deck)) throw new TypeError("drawCards: deck must be an array");
  if (!Number.isInteger(count) || count < 1) {
    throw new RangeError(`drawCards: count must be a positive integer, received ${count}`);
  }
  if (count > deck.length) {
    throw new RangeError(`drawCards: cannot draw ${count} from a deck of ${deck.length}`);
  }

  const indices = deck.map((_, i) => i);
  const drawn = [];
  for (let position = 0; position < count; position += 1) {
    const remaining = indices.length - position;
    const offset = unbiasedIndex(seed, `draw-${position}`, remaining);
    const chosen = position + offset;
    [indices[position], indices[chosen]] = [indices[chosen], indices[position]];
    drawn.push(deck[indices[position]]);
  }
  return drawn;
}

/**
 * The whole daily draw: seed, card, and the evidence needed to reproduce it.
 *
 * The returned `draw` block is what makes the reading auditable. Someone
 * holding a saved reading can recompute it from these fields alone and get the
 * same card, which is the same promise the astrology side makes about a
 * fortune — and the reason Tarot can sit beside it without either one
 * borrowing the other's authority.
 */
export function drawDailyCard({ deck, localDate, timezone = "UTC", deckVersion = DECK_VERSION, subject = "anonymous" }) {
  const seed = dailySeed({ localDate, timezone, deckVersion, subject });
  const [card] = drawCards(deck, 1, seed);
  return {
    card,
    draw: {
      spread_type: "daily",
      contract_version: DRAW_CONTRACT_VERSION,
      deck_version: deckVersion,
      local_date: localDate,
      timezone,
      seed,
      reproducible: true,
    },
  };
}

/**
 * A manual one- or three-card draw.
 *
 * `seed` is injectable so a test can pin a spread; production always lets it
 * default to a fresh CSPRNG value. It is recorded on the reading for the same
 * reason the daily seed is — a saved spread should be explainable later — but
 * `reproducible: false` states plainly that nobody can regenerate it from the
 * date, because it was a draw and not a derivation.
 */
export function drawSpread({ deck, spreadType, deckVersion = DECK_VERSION, seed = manualSeed() }) {
  const size = SPREAD_SIZES[spreadType];
  const positions = SPREAD_POSITIONS[spreadType];
  if (!size || !positions) throw new RangeError(`drawSpread: unknown spread type ${JSON.stringify(spreadType)}`);

  const cards = drawCards(deck, size, seed);
  return {
    cards: cards.map((card, i) => ({ position: positions[i], card })),
    draw: {
      spread_type: spreadType,
      contract_version: DRAW_CONTRACT_VERSION,
      deck_version: deckVersion,
      seed,
      reproducible: false,
    },
  };
}
