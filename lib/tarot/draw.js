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
 * A keystream off the seed.
 *
 * The shuffle below asks for a few hundred small numbers. Hashing once per
 * decision — which is what `unbiasedIndex` does — costs a SHA-256 per card per
 * round and turns a draw into tens of thousands of hashes. Expanding the seed
 * into bytes once and spending them is the same arithmetic at a fraction of
 * the work, and the labelled prefix keeps it a distinct stream.
 */
function keystream(seed, label, bytes) {
  const blocks = [];
  for (let n = 0; blocks.length * 32 < bytes; n += 1) {
    blocks.push(createHash("sha256").update(`${seed}:${label}:${n}`).digest());
  }
  return Buffer.concat(blocks);
}

/** A bounded reader over a keystream, rejection-sampled like `unbiasedIndex`. */
function reader(buffer) {
  let cursor = 0;
  return function next(size) {
    if (!Number.isInteger(size) || size <= 1) return 0;
    const LIMIT = 65536;
    const usable = LIMIT - (LIMIT % size);
    for (;;) {
      if (cursor + 2 > buffer.length) cursor = 0;   // wrap rather than throw
      const word = buffer.readUInt16BE(cursor);
      cursor += 2;
      if (word < usable) return word % size;
    }
  };
}

/**
 * One riffle. Cards move; whichever way up they were, they stay that way.
 *
 * The split is near the middle rather than exactly on it, because hands are
 * not exact. What matters statistically is only that a riffle *reorders* and
 * never *flips* — that separation is what makes the model mean anything.
 */
function riffle(cards, next) {
  const size = cards.length;
  const cut = Math.floor(size / 2) + next(7) - 3;
  const left = cards.slice(0, cut);
  const right = cards.slice(cut);
  const out = [];
  let l = 0;
  let r = 0;
  while (l < left.length || r < right.length) {
    const remainingLeft = left.length - l;
    const remainingRight = right.length - r;
    if (r >= right.length || (l < left.length && next(remainingLeft + remainingRight) < remainingLeft)) {
      out.push(left[l]);
      l += 1;
    } else {
      out.push(right[r]);
      r += 1;
    }
  }
  return out;
}

/**
 * How often a shuffle includes a cut-and-turn: one round in three.
 *
 * This is the only real dial in the model and it is worth stating plainly.
 * Raising it pushes the deck toward an even split; lowering it makes reversals
 * scarce and makes wholly upright readings common. At one in three the deck
 * settles around 39% reversed, and roughly one sitting in six finds a deck
 * nobody happened to turn — which is the behaviour being modelled.
 */
export const TURN_FREQUENCY = 3;

/**
 * Which cards in the deck are upside down, and why it is not a coin toss.
 *
 * A COIN TOSS PER CARD IS NOT WHAT A DECK DOES. It gives every card an
 * independent even chance, which sounds fair and is wrong in two ways a reader
 * notices. It pins the reversal rate to exactly half forever, and it makes
 * every spread independent — so three reversals in a row is always precisely
 * one in eight, no matter what the deck has been through.
 *
 * A real deck reverses cards for one reason: somebody physically turned part
 * of it around. That is a *block* operation. It flips a contiguous run all at
 * once, so orientation arrives in clumps; riffling between turns spreads those
 * clumps around without ever flipping anything. The consequences are the whole
 * point of doing this properly:
 *
 *   - A FRESH DECK IS ENTIRELY UPRIGHT. Reversals have to enter from somewhere.
 *   - THE RATE DRIFTS. Some shuffles turn most of the deck, some turn a sliver,
 *     some turn nothing at all.
 *   - SPREADS ARE OVERDISPERSED. All-upright and all-reversed readings are both
 *     commoner than a coin flip predicts, and mixed readings rarer. That is the
 *     texture people mean when they say a deck feels like it is saying something.
 *
 * Derived entirely from the seed, so a saved reading still explains itself and
 * nothing has to be persisted between draws.
 */
export function deckOrientations(seed, size, { turnFrequency = TURN_FREQUENCY } = {}) {
  if (!Number.isInteger(size) || size <= 0) {
    throw new RangeError(`deckOrientations: size must be a positive integer, received ${size}`);
  }
  const next = reader(keystream(seed, "orientation-shuffle", 4096));
  let orientation = new Array(size).fill(false);   // a new deck is all one way up
  const rounds = 3 + next(4);                      // three to six, as a person shuffles
  for (let round = 0; round < rounds; round += 1) {
    orientation = riffle(orientation, next);
    if (next(turnFrequency) === 0) {
      // Cut, turn the portion in your hand end over end, put it back. Turning a
      // block flips every card in it AND reverses their order — both, or it is
      // not the gesture being modelled.
      const cut = 1 + next(size - 1);
      orientation = orientation
        .slice(0, cut)
        .map((reversed) => !reversed)
        .reverse()
        .concat(orientation.slice(cut));
    }
  }
  return orientation;
}

/**
 * Is the card that came off the deck at `deckIndex` upside down?
 *
 * Orientation is read from the shuffled deck rather than rolled per position,
 * which is what keeps the two streams separate: `draw-N` decides which card,
 * `orientation-shuffle` decides which way up the deck was. Toggling reversals
 * cannot change the card, because the card was already chosen by then.
 */
export function isReversed(orientations, deckIndex) {
  return orientations[deckIndex] === true;
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
export function drawCardIndices(deck, count, seed) {
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
    drawn.push(indices[position]);
  }
  return drawn;
}

/**
 * The cards themselves.
 *
 * `drawCardIndices` is the primitive because orientation is a property of
 * where a card sat in the shuffled deck, not of where it landed in the spread.
 * Callers that only want cards should use this and stay out of index arithmetic.
 */
export function drawCards(deck, count, seed) {
  return drawCardIndices(deck, count, seed).map((index) => deck[index]);
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
  const [index] = drawCardIndices(deck, 1, seed);
  const card = deck[index];
  const orientations = deckOrientations(seed, deck.length);
  return {
    card,
    orientation: reversals && isReversed(orientations, index) ? "reversed" : "upright",
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

  const indices = drawCardIndices(deck, size, seed);
  const orientations = deckOrientations(seed, deck.length);
  return {
    cards: indices.map((index, i) => ({
      position: positions[i],
      card: deck[index],
      orientation: reversals && isReversed(orientations, index) ? "reversed" : "upright",
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
