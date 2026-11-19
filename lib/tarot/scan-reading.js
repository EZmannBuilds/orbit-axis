// Orbit Axis :: compose a reading for cards the camera (or the reader) laid out.
//
// Pure and deterministic: no clock, no randomness, no network, no model. The
// same cards, spread and sky always give the same reading, byte for byte, so it
// runs on Vercel, it can be tested, and it can generate LoRA training pairs.
//
// What a reading is made of, and where each part comes from:
//   meaning and prompt  the owner-approved deck (presentCard), per orientation
//   correspondence      lib/tarot/correspondences.js (Book T / Liber 777 facts)
//   planet function     lib/interpretation/planets.js (approved Orbit text)
//   sky links           the `sky` argument, which must come from the engine
//                       (currentSky). This module never computes positions and
//                       never accepts invented ones from a model.
//
// Nothing here writes a meaning. The correspondence and sky sentences are
// factual ("Mars rules this decan", "the Sun is in this card's decan today");
// the only interpretive text is the deck's own.

import {
  FORBIDDEN_CONTENT_PATTERNS, PRODUCTION_CARDS, SPREAD_SIZES, cardBySlug,
  presentCard, spreadPositions,
} from "./deck.js";
import { correspondenceFor, longitudeTouchesCard, zodiacPosition } from "./correspondences.js";
import { dignityAt } from "./dignities.js";
import { DIGNITY_TABLE, signStanding } from "../esoteric/lilly.js";
import { PLANETS } from "../interpretation/planets.js";

export const SCAN_COMPOSER_VERSION = "1.0.0";

/** The planets a sky link may name. Outer planets have no card in this system. */
const LINK_PLANETS = Object.freeze(["Sun", "Moon", "Mercury", "Venus", "Mars", "Jupiter", "Saturn"]);

export class ScanReadingError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "ScanReadingError";
    this.code = code;
  }
}

function fail(code, message) {
  throw new ScanReadingError(code, message);
}

// ── Input ───────────────────────────────────────────────────────────────────

/**
 * Validate what a client (or the recogniser) sends. A card is `{ slug, reversed }`.
 * Unknown slugs, duplicates, a wrong count and non-boolean orientation are all
 * refused rather than repaired: a reading is only as honest as its cards.
 */
export function validateScanCards(cards, spreadType, deck = PRODUCTION_CARDS) {
  const size = SPREAD_SIZES[spreadType];
  if (!size) fail("invalid_spread", `Unknown spread type: ${spreadType}`);
  if (!Array.isArray(cards)) fail("invalid_cards", "cards must be an array");
  if (cards.length !== size) fail("wrong_card_count", `${spreadType} takes ${size} card(s), got ${cards.length}`);
  const seen = new Set();
  return cards.map((c, i) => {
    if (!c || typeof c !== "object") fail("invalid_cards", `card ${i} is not an object`);
    if (typeof c.slug !== "string" || !cardBySlug(deck, c.slug)) fail("unknown_card", `card ${i} has an unknown slug`);
    if (typeof c.reversed !== "boolean") fail("invalid_orientation", `card ${i} needs reversed: true or false`);
    if (seen.has(c.slug)) fail("duplicate_card", `${c.slug} appears twice`);
    seen.add(c.slug);
    return { slug: c.slug, reversed: c.reversed };
  });
}

// ── Correspondence sentences (facts only) ───────────────────────────────────

function planetFunction(name) {
  const p = PLANETS[name];
  return p ? p.function_.toLowerCase() : null;
}

function degreeRange(start, end) {
  const from = zodiacPosition(start);
  const to = zodiacPosition(end === 360 ? 0 : end);
  if (from.sign === zodiacPosition(end - 0.0001).sign) {
    return `${from.degree}° to ${from.degree + (end - start)}° ${from.sign}`;
  }
  return `${from.degree}° ${from.sign} to ${to.degree}° ${to.sign}`;
}

/** One short factual line about a card's place in the system. */
export function correspondenceLine(slug) {
  const c = correspondenceFor(slug);
  if (!c) return null;
  if (c.arcana === "major") {
    const a = c.attribution;
    const what = a.kind === "planet" ? `the planet ${a.name}` : a.kind === "sign" ? `the sign ${a.name}` : `the element ${a.name}`;
    const second = c.secondary_attribution ? ` and to ${c.secondary_attribution.name}` : "";
    const [from, to] = c.path.joins;
    return `In the Golden Dawn system this card belongs to ${what}${second}, to the letter ${c.hebrew_letter.name} (${c.hebrew_letter.meaning}), and to path ${c.path.number} on the Tree of Life, between ${from.name} and ${to.name}.`;
  }
  if (c.kind === "ace") {
    return `${c.title}: the ace holds ${c.element} as a whole, in Kether, in ${c.world}, ${c.world_gloss}.`;
  }
  if (c.kind === "pip") {
    const fn = planetFunction(c.decan.ruler);
    const ruler = fn ? `${c.decan.ruler} (${fn})` : c.decan.ruler;
    return `${c.title}. ${ruler} in the ${c.decan.ordinal} decan of ${c.decan.sign}, ${degreeRange(c.decan.start_longitude, c.decan.end_longitude)}, in ${c.sephirah.name} (${c.sephirah.gloss}) of ${c.world}.`;
  }
  const range = c.rules ? `, ruling ${degreeRange(c.rules.start_longitude, c.rules.start_longitude + 30)}` : `, the throne of the Ace of ${capitalise(c.suit)}`;
  return `${c.title}: ${c.sub_element.label}${range}.`;
}

function capitalise(s) {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

// ── Sky links (facts from the engine only) ──────────────────────────────────

function skyPlanets(sky) {
  if (!sky || typeof sky !== "object" || !sky.planets || typeof sky.planets !== "object") return [];
  const retro = new Set(Array.isArray(sky.retrogrades) ? sky.retrogrades : []);
  return LINK_PLANETS
    .filter((name) => Number.isFinite(sky.planets[name]?.longitude))
    .map((name) => ({ name, longitude: sky.planets[name].longitude, retrograde: retro.has(name) || sky.planets[name].retrograde === true }));
}

function where(p) {
  const z = zodiacPosition(p.longitude);
  return `${z.degree}° ${z.sign}${p.retrograde ? ", retrograde" : ""}`;
}

/**
 * Sentences linking a card to today's sky. Empty when there is no sky, so the
 * reading still works with no engine (the web demo, tests, a failed lookup).
 */
export function skyLinks(slug, sky) {
  const c = correspondenceFor(slug);
  const planets = skyPlanets(sky);
  if (!c || planets.length === 0) return [];
  const links = [];

  // A planet standing in this card's own stretch of the zodiac.
  for (const p of planets) {
    if (!longitudeTouchesCard(slug, p.longitude)) continue;
    const span = c.kind === "pip" ? "this card's decan" : c.kind === "court" ? "the part of the zodiac this card rules" : `${c.attribution.name}, this card's sign`;
    links.push(`Today ${p.name === "Sun" || p.name === "Moon" ? "the " + p.name : p.name} is in ${span} (${where(p)}).`);
  }

  // The card's own planet, wherever it is.
  const own = c.arcana === "major" && c.attribution.kind === "planet" ? c.attribution.name
    : c.kind === "pip" ? c.decan.ruler : null;
  const ownPos = own && planets.find((p) => p.name === own);
  if (ownPos && !longitudeTouchesCard(slug, ownPos.longitude)) {
    const label = c.arcana === "major" ? "this card's planet" : "the ruler of this card's decan";
    const subject = own === "Sun" || own === "Moon" ? `The ${own}` : own;
    links.push(`${subject}, ${label}, is at ${where(ownPos)} today.`);
  }
  return links;
}

// ── Essential dignity (Lilly) ───────────────────────────────────────────────

const SEVEN = new Set(["Saturn", "Jupiter", "Mars", "Sun", "Venus", "Mercury", "Moon"]);

/**
 * A sentence from Lilly's table about the card's planet and sign, or null.
 * Small cards: how the decan's ruler stands in that sign. Sign trumps: which
 * planets rule and are exalted in the sign.
 */
export function standingLine(slug) {
  const c = correspondenceFor(slug);
  if (!c) return null;
  const lilly = "In Lilly's table of essential dignities";
  if (c.kind === "pip") {
    const { ruler, sign } = c.decan;
    const name = ruler === "Sun" || ruler === "Moon" ? `the ${ruler}` : ruler;
    switch (signStanding(ruler, sign)) {
      case "house": return `${lilly}, ${sign} is ${name}'s own house.`;
      case "exaltation": return `${lilly}, ${name} is exalted in ${sign}.`;
      case "detriment": return `${lilly}, ${name} is in its detriment in ${sign}.`;
      case "fall": return `${lilly}, ${name} is in its fall in ${sign}.`;
      default: return null;
    }
  }
  if (c.arcana === "major" && c.attribution.kind === "sign") {
    const row = DIGNITY_TABLE[c.attribution.name];
    const the = (p) => (p === "Sun" || p === "Moon" ? `the ${p}` : p);
    const ex = row.exaltation && SEVEN.has(row.exaltation.planet) ? ` and the exaltation of ${the(row.exaltation.planet)}` : "";
    return `${lilly}, ${c.attribution.name} is the house of ${the(row.domicile)}${ex}.`;
  }
  return null;
}

// ── Elemental dignity (Book T) ──────────────────────────────────────────────

const SUIT_LABEL = { wands: "Wands", cups: "Cups", swords: "Swords", pentacles: "Pentacles" };

/** A sentence stating how Book T's rule of dignities applies, or null. */
export function dignityLine(slugs, index) {
  const d = dignityAt(slugs, index);
  const suitOfSlug = (s) => SUIT_LABEL[correspondenceFor(s)?.suit] ?? null;
  const by = (relation) => d.neighbours.filter((n) => n.relation === relation).map((n) => suitOfSlug(n.slug));
  const rule = "By Book T's rule of elemental dignities";
  switch (d.state) {
    case "strengthened":
      return `${rule}, the card of its own suit beside it strengthens it.`;
    case "weakened":
      return by("inimical").length > 1
        ? `${rule}, the ${by("inimical")[0]} cards on both sides are of an opposite nature, which weakens it.`
        : `${rule}, the ${by("inimical")[0]} card beside it is of an opposite nature, which weakens it.`;
    case "unaffected":
      return `${rule}, it sits between two cards that oppose each other, so neither affects it much.`;
    default:
      return null;
  }
}

// ── The reading ─────────────────────────────────────────────────────────────

/** Every forbidden pattern a text trips. Empty when clean. */
export function auditReadingText(text) {
  return FORBIDDEN_CONTENT_PATTERNS.filter(({ pattern }) => pattern.test(text)).map(({ why }) => why);
}

/**
 * Compose a reading.
 *   cards       [{ slug, reversed }], in spread order
 *   spreadType  "one_card" | "daily" | "three_card"
 *   positionSet "reflective" | "timeline" (three-card only)
 *   sky         an engine currentSky() snapshot, or null
 */
export function composeScanReading({ cards, spreadType, positionSet, sky = null, deck = PRODUCTION_CARDS } = {}) {
  const clean = validateScanCards(cards, spreadType, deck);
  const labels = spreadPositions(spreadType, positionSet);

  const slugs = clean.map((c) => c.slug);
  const positions = clean.map(({ slug, reversed }, i) => {
    const card = cardBySlug(deck, slug);
    const shown = presentCard(card, { orientation: reversed ? "reversed" : "upright" });
    return {
      position: labels[i],
      slug,
      name: card.name,
      orientation: shown.orientation,
      meaning: shown.upright_meaning,
      reflection_prompt: shown.reflection_prompt,
      correspondence: correspondenceLine(slug),
      standing: standingLine(slug),
      dignity: slugs.length > 1 ? dignityLine(slugs, i) : null,
      sky_links: skyLinks(slug, sky),
    };
  });

  const text = positions.map((p) => [
    `${p.position}: ${p.name}${p.orientation === "reversed" ? ", reversed" : ""}.`,
    p.meaning,
    p.correspondence,
    p.standing,
    p.dignity,
    ...p.sky_links,
    p.reflection_prompt,
  ].filter(Boolean).join(" ")).join("\n\n");

  // The deck's text passed this audit when it was approved and the facts are
  // templated, so a failure here is a bug in this file, not a reader's input.
  const problems = auditReadingText(text);
  if (problems.length) fail("forbidden_content", `composed text failed the content audit: ${problems.join(", ")}`);

  return {
    composer_version: SCAN_COMPOSER_VERSION,
    spread_type: spreadType,
    position_set: spreadType === "three_card" ? (positionSet === "timeline" ? "timeline" : "reflective") : null,
    sky_instant_utc: sky?.instant_utc ?? null,
    positions,
    text,
    sources: ["deck", "book_t", "liber_777", ...(positions.some((p) => p.standing) ? ["lilly"] : []), ...(positions.some((p) => p.sky_links.length) ? ["engine"] : [])],
  };
}

// ── Guard for an optional local model's rewrite ─────────────────────────────

/**
 * Decide whether a model's smoothed version of a reading may be shown. It is
 * refused if it trips a forbidden pattern or names any card not in the
 * reading. On refusal the caller shows the composed text instead.
 */
export function checkWovenText(reading, woven, deck = PRODUCTION_CARDS) {
  if (typeof woven !== "string" || woven.trim().length === 0) return { ok: false, reasons: ["empty"] };
  const reasons = auditReadingText(woven);
  // Several card names are ordinary words ("the Sun", "Strength", "Justice"),
  // and the composed text itself says "the Sun is in ...". So a name counts as
  // added only when the rewrite uses it MORE often than the composed text did.
  const inReading = new Set(reading.positions.map((p) => p.slug));
  const count = (text, name) => (text.match(new RegExp(`\\b${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "gi")) || []).length;
  const added = deck
    .filter((c) => !inReading.has(c.slug))
    .filter((c) => count(woven, c.name) > count(reading.text, c.name))
    .map((c) => c.slug);
  if (added.length) reasons.push(`names cards not in the reading: ${added.join(", ")}`);
  return { ok: reasons.length === 0, reasons };
}
