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
 * NOTE: there is no daily seed any more.
 *
 * The daily card was once derived from (local date, timezone, deck version,
 * account). That function is gone rather than deprecated, because a seed
 * builder left lying around is an invitation to go back to deriving the card,
 * and the product decision is that it is drawn. Stability now comes from
 * writing the draw down — see tarot_daily_draws.
 */

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
 * anyway so a pathological seed cannot hang a request. Exhausting the bound
 * throws; see the end of the function for why it must not fall back.
 */
const ATTEMPT_LIMIT = 64;

export function unbiasedIndex(seed, label, size) {
  if (!Number.isInteger(size) || size <= 0) {
    throw new RangeError(`unbiasedIndex: size must be a positive integer, received ${size}`);
  }
  if (size === 1) return 0;

  const LIMIT = 2 ** 32;
  const usable = LIMIT - (LIMIT % size);   // largest multiple of size that fits

  for (let attempt = 0; attempt < ATTEMPT_LIMIT; attempt += 1) {
    const digest = createHash("sha256").update(`${seed}:${label}:${attempt}`).digest();
    const word = digest.readUInt32BE(0);
    if (word < usable) return word % size;
  }
  // Unreachable, and it has to FAIL rather than fall back.
  //
  // There was a modulo fallback here, on the reasoning that a vanishingly
  // biased card beats an error on a reading someone asked for. The trade is
  // not real. For a 78-card deck the rejection zone is 22 in 2^32, so 64
  // consecutive rejections has probability around 10^-534 — this branch will
  // not run before the heat death of the universe, and a fallback that never
  // runs buys no reliability at all. What it does buy is a line of code that
  // reintroduces the exact bias this function exists to remove, sitting where
  // a later reader could mistake it for a live path and widen it.
  //
  // So: if the impossible happens, something is wrong with the hash or the
  // arithmetic, and a 500 is the honest answer. `fail()` in api.js already
  // turns this into "Something went wrong drawing that card" with nothing
  // internal forwarded.
  throw new Error(
    `unbiasedIndex: ${ATTEMPT_LIMIT} rejections for size ${size} — this is statistically impossible, so the generator is broken`,
  );
}

/**
 * Is the card at this position reversed?
 *
 * Its own labelled stream off the same seed, which is the load-bearing detail:
 * turning reversals on or off must not change WHICH card was drawn. The card
 * comes from `draw-N`, the orientation from `orientation-N`, so a reader who
 * switches the setting mid-day sees the same card the right way up.
 *
 * ALWAYS CALLED, whatever the reader's setting. Which way the card landed is a
 * fact about the draw; whether the reader wants to be shown it is a
 * preference, and deciding the fact from the preference was a real bias — a
 * card drawn with reversals off recorded `upright` and, because the daily seed
 * is not kept, could never be told apart later from a card that genuinely
 * landed upright. Half the reversals in the product were lost at that seam.
 *
 * An even split. Weighting reversals rarer is a common house rule and it is
 * somebody's tradition rather than a fact, so it is not smuggled in here.
 */
export function isReversed(seed, position) {
  return unbiasedIndex(seed, `orientation-${position}`, 2) === 1;
}

/**
 * How a drawn orientation is SHOWN, given the reader's setting.
 *
 * The counterpart to always recording the orientation: the draw states which
 * way the card landed, and this is the one place that decides whether the
 * reader sees it. Reversals off shows every card upright without altering what
 * was drawn, so turning the setting on reveals the orientation the card
 * actually had rather than starting a fresh, upright-only history.
 */
export function shownOrientation(orientation, reversals) {
  return reversals && orientation === "reversed" ? "reversed" : "upright";
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
 * Draw today's card.
 *
 * A REAL DRAW, not a derivation. Earlier this was a pure function of the date,
 * the account and the deck version — stable for free, because every device
 * recomputed the same answer, but the card was decided by who you are and what
 * day it is rather than by chance.
 *
 * It is now seeded from the CSPRNG like any other draw, which means it cannot
 * be recomputed and has to be remembered instead. `rememberDailyDraw` in the
 * service is what makes it the same card for the rest of the day; this
 * function's only job is to make the first draw of the day genuinely random.
 *
 * Nothing about the reader influences which card comes up. No account id, no
 * timezone, no date, no history of what they have already seen — the deck is
 * flat, and the same card can come up two days running, because that is what
 * chance does.
 */
export function drawDailyCard({ deck, localDate, timezone = "UTC", deckVersion = DECK_VERSION, reversals = false, seed = manualSeed() }) {
  const [card] = drawCards(deck, 1, seed);
  return {
    card,
    // The orientation the card actually landed in, whatever the reader's
    // setting. This is what gets written down; `shownOrientation` decides what
    // they are shown. `reversals` still travels on the draw record because it
    // says how the card was presented on the day it was drawn.
    orientation: isReversed(seed, 0) ? "reversed" : "upright",
    draw: {
      spread_type: "daily",
      contract_version: DRAW_CONTRACT_VERSION,
      deck_version: deckVersion,
      local_date: localDate,
      timezone,
      reversals,
      // A drawn card cannot be regenerated from a date. Saying so is the
      // honest half of making it random: the astrology side IS reproducible
      // and says so, and these two must not both claim the same property.
      reproducible: false,
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
export function drawSpread({ deck, spreadType, deckVersion = DECK_VERSION, seed = manualSeed(), reversals = false }) {
  const size = SPREAD_SIZES[spreadType];
  const positions = SPREAD_POSITIONS[spreadType];
  if (!size || !positions) throw new RangeError(`drawSpread: unknown spread type ${JSON.stringify(spreadType)}`);

  const cards = drawCards(deck, size, seed);
  return {
    cards: cards.map((card, i) => ({
      position: positions[i],
      card,
      // As with the daily card: how it landed, not how it will be shown.
      orientation: isReversed(seed, i) ? "reversed" : "upright",
    })),
    draw: {
      spread_type: spreadType,
      contract_version: DRAW_CONTRACT_VERSION,
      deck_version: deckVersion,
      seed,
      reversals,
      reproducible: false,
    },
  };
}
