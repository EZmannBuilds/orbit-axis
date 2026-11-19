// Orbit Axis :: Book T's elemental dignities — how the cards beside a card
// strengthen or weaken it — and its tables of what several cards of one kind
// show together.
//
// Source: Book T — The Tarot (Golden Dawn), "Of the Dignities" and the table of
// majorities and of three and four of a rank. The Equinox I(7–8), 1912; public
// domain. See docs/tarot-correspondences-research.md.
//
// The dignity rule is structural and the composer may state it ("the Cups
// beside it are of an opposite nature, which weakens it"). The combination
// glosses ("Riches, success") are Book T's fortune-telling vocabulary, and
// several would fail Orbit's content rules; they are kept here as reference for
// the owner and for training context, with `display: false`, and the composer
// never shows them.

import { correspondenceFor } from "./correspondences.js";

export const DIGNITY_SOURCE = "book_t";

/**
 * Suit relations as Book T states them, verbatim in substance:
 *   "Swords are inimical to Pentacles. Wands are inimical to Cups.
 *    Swords are friendly with Cups and Wands.
 *    Wands are friendly with Swords and Pentacles."
 * Cups and Pentacles: Book T states no relation. It is left "unstated", not
 * guessed (later writers make them friendly; Book T does not).
 */
const INIMICAL = [["swords", "pentacles"], ["wands", "cups"]];
const FRIENDLY = [["swords", "cups"], ["swords", "wands"], ["wands", "pentacles"]];

const pair = (a, b, list) => list.some(([x, y]) => (x === a && y === b) || (x === b && y === a));

/** "same" | "inimical" | "friendly" | "unstated" | null (null when either card is a trump). */
export function suitRelation(suitA, suitB) {
  if (!suitA || !suitB) return null;
  if (suitA === suitB) return "same";
  if (pair(suitA, suitB, INIMICAL)) return "inimical";
  if (pair(suitA, suitB, FRIENDLY)) return "friendly";
  return "unstated";
}

function suitOf(slug) {
  const c = correspondenceFor(slug);
  return c && c.arcana === "minor" ? c.suit : null;
}

/**
 * The dignity of the card at `index` in a row of slugs, by its neighbours.
 *
 * Book T applies the rule to the suits. Trumps have no suit, so a trump is
 * neither strengthened nor weakened by it and does not act on its neighbours.
 * Extending the rule to trumps by their element is a later practice, not
 * Book T, and is not done here.
 *
 * Returns { state, neighbours: [{ slug, relation }], rule }, where state is:
 *   "strengthened"  a neighbour of the same suit
 *   "weakened"      a neighbour of an opposite nature
 *   "unaffected"    it sits between two cards that are contrary to each other
 *                   (which includes one of its own suit beside one opposed)
 *   "neutral"       nothing in the rule applies (trumps, friendly, unstated)
 */
export function dignityAt(slugs, index) {
  const own = suitOf(slugs[index]);
  const neighbours = [slugs[index - 1], slugs[index + 1]].filter(Boolean)
    .map((slug) => ({ slug, relation: own ? suitRelation(own, suitOf(slug)) : null }));

  if (!own) return { state: "neutral", neighbours, rule: "trump" };

  if (neighbours.length === 2 && suitRelation(suitOf(neighbours[0].slug), suitOf(neighbours[1].slug)) === "inimical") {
    return { state: "unaffected", neighbours, rule: "between_contraries" };
  }
  // No "same suit on one side, opposite on the other" case: those two
  // neighbours are always contrary to each other, so the rule above has
  // already answered.
  const same = neighbours.some((n) => n.relation === "same");
  const opposed = neighbours.some((n) => n.relation === "inimical");
  if (same) return { state: "strengthened", neighbours, rule: "same_suit" };
  if (opposed) return { state: "weakened", neighbours, rule: "opposite_nature" };
  return { state: "neutral", neighbours, rule: neighbours.some((n) => n.relation === "friendly") ? "friendly" : "none" };
}

// ── Several of a kind (reference only) ──────────────────────────────────────
//
// Book T's labels are King/Prince/Princess; this edition already glosses its
// "Kings" as Knights. Mapped to the Waite–Smith names used everywhere else:
// Book T King = Knight, Prince = King, Princess = Page.

export const MAJORITIES = Object.freeze({
  wands: "Energy, opposition, quarrel.",
  cups: "Pleasure, merriment.",
  swords: "Trouble, sadness, sickness, death.",
  pentacles: "Business, money, possessions.",
  trumps: "Strong forces beyond the Querent's control.",
  courts: "Society, meetings of many persons.",
  aces: "Strength generally. Aces are always strong cards.",
});

export const RANK_COMBINATIONS = Object.freeze({
  ace: { 4: "Great power and force.", 3: "Riches, success." },
  knight: { 4: "Swiftness, rapidity.", 3: "Unexpected meetings. Knights, in general, shew news." },
  queen: { 4: "Authority, influence.", 3: "Powerful friends." },
  king: { 4: "Meetings with the great.", 3: "Rank and honour." },
  page: { 4: "New ideas or plans.", 3: "Society of the young." },
  ten: { 4: "Anxiety, responsibility.", 3: "Buying and selling (commerce)." },
  nine: { 4: "Added responsibilities.", 3: "Much correspondence." },
  eight: { 4: "Much news.", 3: "Much journeying." },
  seven: { 4: "Disappointments.", 3: "Treaties and compacts." },
  six: { 4: "Pleasure.", 3: "Gain, success." },
  five: { 4: "Order, regularity.", 3: "Quarrels, fights." },
  four: { 4: "Rest, peace.", 3: "Industry." },
  three: { 4: "Resolution, determination.", 3: "Deceit." },
  two: { 4: "Conferences, conversations.", 3: "Reorganization, recommendation." },
});

/** Book T's court-card note, as reference. */
export const COURT_NOTE = Object.freeze({
  text: "Princes and Queens shew almost always actual men and women connected with the matter. But the Kings (Knights) sometime represent coming or going of a matter, according as they face. The Princesses shew opinions, thoughts, ideas, either in harmony with or opposed to, the subject.",
  mapping: "Book T Prince = Waite-Smith King; King = Knight; Princess = Page",
});

/**
 * Any rank appearing three or more times in a spread, with Book T's gloss.
 * Reference only (`display: false`): these are fortune-telling glosses.
 */
export function rankCombinations(slugs) {
  const counts = {};
  for (const slug of slugs) {
    const rank = slug.includes("-of-") ? slug.split("-of-")[0] : null;
    if (rank) counts[rank] = (counts[rank] || 0) + 1;
  }
  return Object.entries(counts)
    .filter(([rank, n]) => n >= 3 && RANK_COMBINATIONS[rank])
    .map(([rank, n]) => ({ rank, count: n, gloss: RANK_COMBINATIONS[rank][Math.min(n, 4)], source: DIGNITY_SOURCE, display: false }));
}
