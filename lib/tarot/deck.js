// Orbit Axis :: the Tarot deck content contract.
//
// WHY THIS FILE HOLDS A CONTRACT AND NOT A DECK
//
// [[Tarot Data Model]] records the state plainly: the `tarot_cards` table
// exists and is NOT populated, and that is deliberate — "an honest shell
// rather than fabricated content". Two things could close that gap. One is to
// author seventy-eight original meanings and have them reviewed. The other is
// to paste a guidebook, or to let a model improvise, and call the result
// authored.
//
// The second is not slower to do badly, it is *impossible* to do correctly:
// the meanings in circulation descend from copyrighted twentieth-century
// guidebooks, and a generated meaning has no provenance to record because
// nothing produced it but a prior over other people's words.
//
// So this module defines what a card MUST carry to be shippable, validates
// any deck against it, and reports whether the production deck is complete.
// The production deck is currently EMPTY. Everything downstream — the draw,
// the API, the panel — is built and tested against that contract using a
// fixture deck that says, in its own data, that it is a fixture. When real
// content is authored it drops into PRODUCTION_CARDS and the gate opens with
// no other change.
//
// The gate is not a formality. `deckStatus()` is consulted by the API before
// any card is served, so an incomplete deck cannot be revealed even if a flag
// is switched on by accident.

/**
 * The deck version. It is part of the daily-draw seed, so changing it changes
 * every future draw — which is the point: a deck that has been re-authored is
 * a different deck, and yesterday's card was drawn from the old one.
 *
 * `0.0.0-empty` says what is true today. Authoring the deck is what earns a
 * real version, and a test asserts these two facts move together.
 */
export const DECK_VERSION = "0.0.0-empty";

/** A full deck. Seventy-eight is not a preference; it is what a tarot deck is. */
export const FULL_DECK_SIZE = 78;

export const ARCANA = Object.freeze(["major", "minor"]);
export const SUITS = Object.freeze(["wands", "cups", "swords", "pentacles"]);

/**
 * Every field a card must carry, and why each one is required rather than nice.
 *
 * `slug`             a stable name that is NOT a database uuid. Readings store
 *                    slugs, so a saved reading survives a re-seeded table and
 *                    an export can name a card without exposing a row id.
 * `name`             what the reader sees and what a screen reader announces.
 * `arcana` / `suit` / `number`
 *                    the card's identity in the deck, and what the typographic
 *                    face is drawn from — there is no artwork to fall back on.
 * `upright_meaning`  the authored interpretation. MVP has no reversals, so
 *                    `reversed_meaning` is deliberately not required.
 * `reflection_prompt`
 *                    the question the card leaves the reader with. This is the
 *                    difference between "a prompt, not a prediction" as a
 *                    slogan and as a data requirement.
 * `provenance`       who wrote it and under what licence. A meaning with no
 *                    provenance is indistinguishable from a transcribed one.
 */
export const REQUIRED_CARD_FIELDS = Object.freeze([
  "slug", "name", "arcana", "upright_meaning", "reflection_prompt", "provenance",
]);

export const REQUIRED_PROVENANCE_FIELDS = Object.freeze(["author", "license", "reviewed"]);

/**
 * Language a reflection tool does not use.
 *
 * Checked against authored content rather than trusted to the author's memory.
 * The list is about GRAMMAR OF CLAIM, not vocabulary: "will happen", "destined",
 * "guaranteed" all assert knowledge of the future, which is the one thing the
 * product says it does not have. Medical, financial, and relationship advice
 * are separate categories of harm and are refused on their own terms.
 */
export const FORBIDDEN_CONTENT_PATTERNS = Object.freeze([
  { pattern: /\bwill (?:happen|occur|come true|be yours)\b/i, why: "predicts an outcome" },
  { pattern: /\b(?:destiny|destined|fated|fate has)\b/i, why: "asserts fate" },
  { pattern: /\bguarantee[sd]?\b/i, why: "promises certainty" },
  { pattern: /\byou (?:will|shall) (?:meet|marry|receive|inherit|win)\b/i, why: "predicts an event" },
  { pattern: /\bwithin (?:\d+|one|two|three|six) (?:days?|weeks?|months?)\b/i, why: "predictive timing" },
  // Medical terms need medical CONTEXT. The first version of this rule was
  // /\b(?:diagnos|cure|treat|medication|symptom)\w*\b/ and it fired on "what
  // are you treating as your fault" — ordinary English, in a prompt that has
  // nothing to do with medicine. A content rule that flags good prose is a
  // rule authors learn to write around, which leaves the real cases uncaught.
  { pattern: /\b(?:diagnos(?:e|es|ed|is|ing)|medication|prescription|symptoms?)\b/i, why: "medical advice" },
  { pattern: /\b(?:cure|treat|treating|treatment)\b[^.?!]{0,40}\b(?:illness|condition|disease|pain|anxiety|depression|insomnia)\b/i, why: "medical advice" },
  { pattern: /\b(?:invest|stocks?|crypto|buy shares|financial advice)\b/i, why: "financial advice" },
  { pattern: /\b(?:leave (?:him|her|them)|divorce|break up with)\b/i, why: "relationship advice" },
]);

/**
 * Three-card position labels, in two named sets.
 *
 * `reflective` is the default and the one the product leads with: the same
 * three moments described as a prompt rather than a forecast.
 *
 * `timeline` is Past / Present / Future — the labels most readers already know
 * — and it is an OPT-IN setting rather than the default. "Future" makes a
 * claim the rest of this feature is careful not to make, so it is offered
 * because readers ask for it by name, chosen deliberately, and never arrived
 * at by accident. The card meanings do not change between the two: the same
 * card says the same thing, and only the label over it differs.
 */
export const POSITION_SETS = Object.freeze({
  reflective: Object.freeze(["What shaped this", "What is present", "What to consider next"]),
  timeline: Object.freeze(["Past", "Present", "Future"]),
});

export const POSITION_SET_IDS = Object.freeze(Object.keys(POSITION_SETS));
export const DEFAULT_POSITION_SET = "reflective";

/** The position labels for a spread, under a chosen set. */
export function spreadPositions(spreadType, positionSet = DEFAULT_POSITION_SET) {
  if (spreadType !== "three_card") return SPREAD_POSITIONS[spreadType];
  return POSITION_SETS[positionSet] || POSITION_SETS[DEFAULT_POSITION_SET];
}

/** The default labels. Three-card entries are the reflective set. */
export const SPREAD_POSITIONS = Object.freeze({
  daily: Object.freeze(["Today's card"]),
  one_card: Object.freeze(["Your card"]),
  three_card: POSITION_SETS.reflective,
});

export const SPREAD_TYPES = Object.freeze(Object.keys(SPREAD_POSITIONS));

/** How many cards each spread draws. */
export const SPREAD_SIZES = Object.freeze({ daily: 1, one_card: 1, three_card: 3 });

/**
 * THE PRODUCTION DECK.
 *
 * Empty, and that is the honest state of the content. See the header: this is
 * a content and review gap, not an implementation gap. Filling this array with
 * seventy-eight validated cards is the entire remaining work for release, and
 * `deckStatus()` below will say so until it happens.
 */
export const PRODUCTION_CARDS = Object.freeze([]);

/**
 * Validate one card against the contract.
 *
 * @returns {string[]} findings; empty means the card is shippable.
 */
export function validateCard(card, { index = 0 } = {}) {
  const at = `card[${index}]`;
  if (!card || typeof card !== "object") return [`${at}: not an object`];
  const findings = [];

  for (const field of REQUIRED_CARD_FIELDS) {
    const value = card[field];
    if (value === undefined || value === null) { findings.push(`${at}.${field}: missing`); continue; }
    if (field !== "provenance" && typeof value === "string" && !value.trim()) {
      findings.push(`${at}.${field}: empty`);
    }
  }

  if (card.slug !== undefined) {
    const slug = String(card.slug ?? "");
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug)) {
      findings.push(`${at}.slug: "${card.slug}" is not a stable kebab-case slug`);
    } else if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(slug)) {
      // A uuid passes the kebab-case test — lowercase hex and hyphens — which
      // makes it the one malformed slug the shape rule cannot catch. It is also
      // the exact value a slug exists to replace: a database row id, which
      // would break the moment the reference deck were re-seeded and would trip
      // the account export's own audit for a raw uuid in a server-written
      // field. Refused by name.
      findings.push(`${at}.slug: a uuid is a row id, not a stable card name`);
    }
  }
  if (card.arcana !== undefined && !ARCANA.includes(card.arcana)) {
    findings.push(`${at}.arcana: "${card.arcana}" is not ${ARCANA.join(" or ")}`);
  }
  // A minor card has a suit; a major card must not, because "The Tower of Cups"
  // is not a card and a stray suit would sort it into the wrong place.
  if (card.arcana === "minor" && !SUITS.includes(card.suit)) {
    findings.push(`${at}.suit: minor arcana needs one of ${SUITS.join(", ")}`);
  }
  if (card.arcana === "major" && card.suit != null) {
    findings.push(`${at}.suit: major arcana must not carry a suit`);
  }
  if (!Number.isInteger(card.number)) {
    findings.push(`${at}.number: must be an integer (the face is drawn from it)`);
  }

  // Imagery is OPTIONAL — a deck with no images is complete, and every card
  // renders a typographic face. When an image IS declared it must carry its
  // dimensions, because they are rendered as attributes to reserve the layout
  // before the file arrives. An image without them is a card that jumps when
  // it loads.
  if (card.image !== undefined && card.image !== null) {
    const image = card.image;
    if (typeof image !== "object") {
      findings.push(`${at}.image: must be an object`);
    } else {
      if (typeof image.path !== "string" || !image.path.trim()) {
        findings.push(`${at}.image.path: missing`);
      } else if (/^https?:\/\//i.test(image.path)) {
        // The client never builds a storage URL and the deck never hardcodes
        // one: the server resolves paths against the configured bucket, so the
        // storage layout stays a server concern and can move.
        findings.push(`${at}.image.path: must be a bucket-relative path, not a URL`);
      }
      if (!image.license) findings.push(`${at}.image.license: missing`);
      const { width, height } = image;
      if (!Number.isInteger(width) || !Number.isInteger(height) || width <= 0 || height <= 0) {
        findings.push(`${at}.image: width and height are required`);
      } else {
        // A TAROT CARD IS NOT 2:3.
        //
        // The frame was specified as 2:3 before there was any artwork to put
        // in it. A physical tarot card is 70x120mm — 7:12, or 0.583 — and the
        // Waite-Smith scans come in between 0.567 and 0.596 depending on how
        // each plate was trimmed. A strict 2:3 rule would have rejected the
        // entire deck.
        //
        // So the check is a BAND: portrait, and in the proportion a tarot card
        // actually has. It still refuses a square, a landscape image, or a
        // scan cropped so hard it is no longer a card.
        const ratio = width / height;
        if (ratio < 0.52 || ratio > 0.65) {
          findings.push(`${at}.image: ${width}x${height} is not a tarot-card proportion `
            + `(expected roughly 7:12; got ${ratio.toFixed(3)})`);
        }
      }
    }
  }

  const prov = card.provenance;
  if (prov && typeof prov === "object") {
    for (const field of REQUIRED_PROVENANCE_FIELDS) {
      if (prov[field] === undefined || prov[field] === null || prov[field] === "") {
        findings.push(`${at}.provenance.${field}: missing`);
      }
    }
    if (prov.reviewed !== true && prov.reviewed !== false) {
      findings.push(`${at}.provenance.reviewed: must be a boolean, not a claim`);
    }
  } else if (prov !== undefined) {
    findings.push(`${at}.provenance: must be an object`);
  }

  for (const field of ["upright_meaning", "reflection_prompt"]) {
    const text = typeof card[field] === "string" ? card[field] : "";
    for (const { pattern, why } of FORBIDDEN_CONTENT_PATTERNS) {
      if (pattern.test(text)) findings.push(`${at}.${field}: ${why}`);
    }
  }

  return findings;
}

/**
 * Validate a whole deck: every card, plus the things only a set can be wrong
 * about — duplicate slugs, duplicate names, and the wrong number of cards.
 */
export function validateDeck(cards, { requireFullDeck = true } = {}) {
  const findings = [];
  if (!Array.isArray(cards)) return { ok: false, findings: ["deck: not an array"], count: 0 };

  cards.forEach((card, index) => findings.push(...validateCard(card, { index })));

  const seenPaths = new Map();
  cards.forEach((card, index) => {
    const path = card?.image?.path;
    if (!path) return;
    // A reused path is an overwritten image, which a one-year immutable cache
    // will serve stale for up to a year. New artwork is a new path.
    if (seenPaths.has(path)) {
      findings.push(`card[${index}].image.path: duplicate of card[${seenPaths.get(path)}]`);
    } else {
      seenPaths.set(path, index);
    }
  });

  const seenSlugs = new Map();
  const seenNames = new Map();
  cards.forEach((card, index) => {
    for (const [field, seen] of [["slug", seenSlugs], ["name", seenNames]]) {
      const key = card?.[field];
      if (key === undefined || key === null) continue;
      const normalized = String(key).toLowerCase();
      if (seen.has(normalized)) {
        findings.push(`card[${index}].${field}: duplicate of card[${seen.get(normalized)}]`);
      } else {
        seen.set(normalized, index);
      }
    }
  });

  if (requireFullDeck && cards.length !== FULL_DECK_SIZE) {
    findings.push(`deck: has ${cards.length} cards, a complete deck has ${FULL_DECK_SIZE}`);
  }

  return { ok: findings.length === 0, findings, count: cards.length };
}

/**
 * Is the production deck complete enough to show anyone?
 *
 * Consulted by the API before a card is ever served. Returns the reason as
 * text, because "the deck is not ready" is something the interface has to be
 * able to SAY — an empty-deck state that explains itself is honest; a spinner
 * that never resolves is not.
 *
 * @param {object[]} [cards] the deck to judge (injectable for tests)
 */
export function deckStatus(cards = PRODUCTION_CARDS, { allowUnreviewed = false } = {}) {
  const result = validateDeck(cards, { requireFullDeck: true });
  if (cards.length === 0) {
    return {
      ready: false,
      reason: "empty_deck",
      message: "The Tarot deck has not been authored yet.",
      count: 0,
      findings: [],
    };
  }
  if (!result.ok) {
    return {
      ready: false,
      reason: "incomplete_deck",
      message: "The Tarot deck is incomplete or has not passed review.",
      count: result.count,
      findings: result.findings,
    };
  }
  // A deck can be structurally perfect and still unreviewed. Review is a human
  // act; the data records whether it happened, and an unreviewed deck does not
  // ship regardless of how well-formed it is.
  // A draft deck may be read in development and preview so the feature can be
  // tested and argued with. Production never passes allowUnreviewed, so the
  // only way an unreviewed deck ships is for someone to edit the call site —
  // a deliberate act, not an oversight.
  const unreviewed = cards.filter((card) => card?.provenance?.reviewed !== true).length;
  if (unreviewed > 0 && !allowUnreviewed) {
    return {
      ready: false,
      reason: "unreviewed_deck",
      message: "The Tarot deck has not completed content review.",
      count: result.count,
      findings: [`${unreviewed} card(s) are not marked reviewed`],
    };
  }
  return { ready: true, reason: null, message: null, count: result.count, findings: [] };
}

/** Look a card up by its stable slug. */
export function cardBySlug(cards, slug) {
  if (!slug) return null;
  return cards.find((card) => card.slug === slug) ?? null;
}

/**
 * The card as the browser is allowed to see it.
 *
 * Provenance stays on the server: it is licensing metadata about Orbit's
 * content pipeline, not part of a reading, and shipping it would put an
 * author's name in every reveal.
 */
export function presentCard(card) {
  if (!card) return null;
  return {
    slug: card.slug,
    name: card.name,
    arcana: card.arcana,
    suit: card.suit ?? null,
    number: card.number,
    upright_meaning: card.upright_meaning,
    reflection_prompt: card.reflection_prompt,
    // Dimensions travel with the URL so the client can reserve the box before
    // the bytes arrive. Null when the deck has no artwork, which is the state
    // today and a state the interface handles as a first-class case.
    image: card.image
      ? { url: imageUrl(card.image.path), width: card.image.width, height: card.image.height }
      : null,
  };
}

/**
 * Where card artwork is served from.
 *
 * Resolved on the SERVER against a configured bucket, so the client never
 * builds a storage URL out of a card id and the bucket layout can change
 * without a client release. Absent configuration yields null, and a card with
 * no resolvable image simply renders its typographic face.
 */
export function imageUrl(path, env = process.env) {
  const base = env.ORBIT_TAROT_IMAGE_BASE_URL;
  if (!base || !path) return null;
  return `${String(base).replace(/\/+$/, "")}/${String(path).replace(/^\/+/, "")}`;
}
