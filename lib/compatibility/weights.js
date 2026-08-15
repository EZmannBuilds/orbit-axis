// Orbit Axis :: the compatibility rating contract — every number, in one file.
//
// WHY EVERY CONSTANT LIVES HERE
//
// A weighting scheme scattered through the code is a scheme nobody can audit,
// and an unexplained numeric constant is indistinguishable from a mistake. So
// every number that affects a result is in this file, next to the sentence
// explaining why it has that value. If a number cannot be explained, it should
// not be here.
//
// VERSIONED, because a scoring change silently altering past results is one of
// the named release risks. Bump COMPATIBILITY_VERSION whenever any number or
// mapping below changes, and say so in the release note. Results carry the
// version so a screenshot from six months ago can be explained.
//
// WHAT THE ENGINE GIVES US, AND WHAT IT DOES NOT
//
// vendor/orbit-axis-engine/src/domain/synastry.js returns, per aspect:
//   personA, personB   one of ten bodies (Sun … Pluto)
//   aspect             conjunction | sextile | square | trine | opposition
//   quality            easy | challenging | intense
//   orb                degrees from exact
//   involvesLuminary   Sun or Moon on either side
//
// It returns NO angles and NO houses, deliberately — those depend on an
// accurate birth time and the engine refuses to mix a time-known chart with a
// time-unknown one. That is why no category here depends on houses or angles:
// the honest ones cannot be built from what exists, so they are not offered.

export const COMPATIBILITY_VERSION = "compatibility-v1";

/**
 * How much each aspect type moves a category, before orb.
 *
 * THESE ARE NOT lib/interpretation/aspects.js `weight`, AND THE DIFFERENCE IS
 * THE POINT.
 *
 * That file's weight answers "how notable is this aspect" — squares and
 * oppositions score 4 there against 2 for trines and sextiles, because a hard
 * aspect is the more interesting thing to read about. Reusing those numbers
 * here looked obvious and was wrong: this weight answers a different question,
 * "how far does this move the score", and the two aspect families occupy
 * identical amounts of the circle.
 *
 * Work it out. Expected contribution per family is (positions × orb width) ×
 * weight, and the orb factor averages the same for every aspect, so it cancels:
 *
 *   hard  = opposition (1 position × ±8 = 16) + square (2 × ±6 = 24) = 40 units
 *   soft  = trine      (2 positions × ±6 = 24) + sextile (2 × ±4 = 16) = 40 units
 *
 * Equal windows. So weighting hard at 4 and soft at 2 does not express a view
 * about astrology — it hardcodes a 2:1 negative bias into every comparison ever
 * produced. Measured over 1,600 synthetic pairs it put the median at 43 and
 * landed 86% of comparisons in the bottom two bands. Almost every couple would
 * have been told their relationship is challenging, by arithmetic, before any
 * chart was consulted.
 *
 * Equal weights across the four remove it. A sextile still contributes less in
 * aggregate than a trine, because its orb is narrower and it qualifies less
 * often — the geometry already encodes that, and encoding it twice is what
 * caused the problem.
 *
 * Conjunction stays highest: two bodies acting as one is the strongest
 * statement the geometry makes. That is about volume, not about good news — its
 * DIRECTION is decided per planet pair, below.
 */
export const ASPECT_WEIGHTS = Object.freeze({
  conjunction: 5,
  opposition: 4,
  square: 4,
  trine: 4,
  sextile: 4,
});

/**
 * The orb the engine actually allowed for each aspect, so closeness can be
 * expressed as a fraction of the permitted range rather than a bare degree
 * count. Mirrors SYNASTRY_ASPECTS; a luminary widens each by 1.
 */
export const ASPECT_ORBS = Object.freeze({
  conjunction: 8, opposition: 8, square: 6, trine: 6, sextile: 4,
});
export const LUMINARY_ORB_BONUS = 1;

/**
 * The floor an aspect keeps at the very edge of its orb.
 *
 * A contact at 7.9° of an 8° orb is real but faint. Scaling linearly to zero
 * would make the widest aspects vanish entirely and let a single tight aspect
 * dominate a category; 0.25 keeps a wide aspect present without letting it
 * argue loudly.
 */
export const MIN_ORB_FACTOR = 0.25;

/**
 * Planet-pair meaning, and what a CONJUNCTION between them does.
 *
 * `themes` are the category families a pair speaks to. `conjunction` says
 * whether two bodies fusing is supportive or straining FOR THAT PAIR — the
 * engine calls every conjunction "intense" and leaves the reading to us, which
 * is correct: Venus conjunct Venus and Mars conjunct Saturn are both intense
 * and are not the same news.
 *
 * `intensity` scales pairs that are loud regardless of aspect (Saturn and Pluto
 * contacts are felt more than Jupiter ones).
 *
 * Pairs are unordered: Sun-Moon and Moon-Sun are the same row.
 */
const PAIR = (themes, conjunction, intensity = 1) => Object.freeze({ themes, conjunction, intensity });

export const PAIR_MEANINGS = Object.freeze({
  // ── Luminaries together: the core "do these two recognise each other" pairs.
  "Sun|Sun": PAIR(["identity", "direction"], "supportive"),
  "Moon|Moon": PAIR(["emotion", "safety"], "supportive"),
  "Sun|Moon": PAIR(["identity", "emotion", "safety"], "supportive", 1.2),

  // ── Luminary to personal planet.
  "Mercury|Sun": PAIR(["communication", "identity"], "supportive"),
  "Sun|Venus": PAIR(["affection", "identity", "values"], "supportive"),
  "Mars|Sun": PAIR(["drive", "identity"], "mixed", 1.1),
  "Mercury|Moon": PAIR(["communication", "emotion"], "supportive"),
  "Moon|Venus": PAIR(["affection", "emotion", "safety"], "supportive"),
  "Mars|Moon": PAIR(["drive", "emotion", "friction"], "mixed", 1.1),

  // ── Personal planets together.
  "Mercury|Mercury": PAIR(["communication"], "supportive"),
  "Mercury|Venus": PAIR(["communication", "affection"], "supportive"),
  "Mars|Mercury": PAIR(["communication", "drive", "friction"], "mixed"),
  "Venus|Venus": PAIR(["affection", "values"], "supportive"),
  "Mars|Venus": PAIR(["attraction", "affection", "drive"], "supportive", 1.2),
  "Mars|Mars": PAIR(["drive", "friction"], "mixed", 1.1),

  // ── Jupiter: expansion. Easy to over-read as pure good, so held at 1.
  "Jupiter|Sun": PAIR(["growth", "identity"], "supportive"),
  "Jupiter|Moon": PAIR(["growth", "emotion"], "supportive"),
  "Jupiter|Mercury": PAIR(["growth", "communication"], "supportive"),
  "Jupiter|Venus": PAIR(["growth", "affection"], "supportive"),
  "Jupiter|Mars": PAIR(["growth", "drive"], "supportive"),
  "Jupiter|Jupiter": PAIR(["growth"], "supportive"),

  // ── Saturn: structure, duration, and weight. A Saturn conjunction is
  //    commitment AND pressure; calling it simply supportive would be a lie,
  //    so it is mixed everywhere and carries the highest intensity.
  "Saturn|Sun": PAIR(["structure", "identity", "duration"], "mixed", 1.3),
  "Saturn|Moon": PAIR(["structure", "emotion", "safety"], "mixed", 1.3),
  "Mercury|Saturn": PAIR(["structure", "communication"], "mixed", 1.1),
  "Saturn|Venus": PAIR(["structure", "affection", "duration"], "mixed", 1.2),
  "Mars|Saturn": PAIR(["structure", "drive", "friction"], "mixed", 1.3),
  "Jupiter|Saturn": PAIR(["growth", "structure"], "mixed", 1.1),
  "Saturn|Saturn": PAIR(["structure", "duration"], "supportive", 1.1),

  // ── Outer planets: generational, and slower. Real but rarely the headline
  //    between two people, so intensity stays modest except Pluto.
  "Sun|Uranus": PAIR(["freedom", "identity"], "mixed"),
  "Moon|Uranus": PAIR(["freedom", "emotion"], "mixed"),
  "Uranus|Venus": PAIR(["freedom", "affection"], "mixed"),
  "Mars|Uranus": PAIR(["freedom", "drive", "friction"], "mixed", 1.1),
  "Mercury|Uranus": PAIR(["freedom", "communication"], "mixed"),

  "Neptune|Sun": PAIR(["idealisation", "identity"], "mixed"),
  "Moon|Neptune": PAIR(["idealisation", "emotion"], "mixed"),
  "Neptune|Venus": PAIR(["idealisation", "affection"], "mixed", 1.1),
  "Mars|Neptune": PAIR(["idealisation", "drive"], "mixed"),
  "Mercury|Neptune": PAIR(["idealisation", "communication"], "mixed"),

  "Pluto|Sun": PAIR(["intensity", "identity"], "mixed", 1.2),
  "Moon|Pluto": PAIR(["intensity", "emotion"], "mixed", 1.2),
  "Pluto|Venus": PAIR(["intensity", "affection", "attraction"], "mixed", 1.2),
  "Mars|Pluto": PAIR(["intensity", "drive", "friction"], "mixed", 1.3),
  "Mercury|Pluto": PAIR(["intensity", "communication"], "mixed", 1.1),
  "Pluto|Saturn": PAIR(["intensity", "structure"], "mixed", 1.2),

  // ── DELIBERATELY ABSENT: outer planet to outer planet (Uranus-Neptune,
  //    Neptune-Pluto, Pluto-Pluto, and the rest of that block), plus Jupiter
  //    and Saturn to the outers.
  //
  //    Those bodies move so slowly that everybody born within a few years of
  //    each other shares the same contacts. Scoring them would hand identical
  //    evidence to every same-generation pair and call it something about
  //    THEM. A pair with no row here contributes nothing, which is the honest
  //    outcome — not an oversight.
});

/**
 * A theme's weight inside each category, per mode.
 *
 * This is where "the same aspect, read for a different relationship" actually
 * happens. Mars-Venus carries the `attraction` theme; Partner routes attraction
 * into a category of its own, Friend does not have that category at all, and
 * Family does not either. The evidence is identical. The question is not.
 *
 * A theme may feed several categories with different weights — the same
 * contact legitimately says something about both communication and conflict.
 * Duplicate counting is prevented in scoring.js, not here.
 */
const T = Object.freeze;
export const THEME_TO_CATEGORY = Object.freeze({
  general: T({
    identity: T({ overall_dynamic: 1.0 }),
    emotion: T({ emotional_rhythm: 1.0, friction: 0.3 }),
    safety: T({ emotional_rhythm: 0.7, room_to_differ: 0.4 }),
    communication: T({ expression: 1.0 }),
    affection: T({ emotional_rhythm: 0.6, overall_dynamic: 0.3 }),
    attraction: T({ overall_dynamic: 0.5, friction: 0.4 }),
    values: T({ overall_dynamic: 0.5, room_to_differ: 0.4 }),
    drive: T({ pace_and_drive: 1.0, friction: 0.4 }),
    friction: T({ friction: 1.0, expression: 0.3 }),
    structure: T({ pace_and_drive: 0.8, room_to_differ: 0.5 }),
    duration: T({ overall_dynamic: 0.5, pace_and_drive: 0.3 }),
    growth: T({ room_to_differ: 0.6, overall_dynamic: 0.4 }),
    freedom: T({ room_to_differ: 1.0 }),
    idealisation: T({ emotional_rhythm: 0.4, expression: 0.3 }),
    intensity: T({ friction: 0.8, emotional_rhythm: 0.4 }),
    // `direction` is produced by Sun|Sun and is deliberately routed nowhere in
    // every mode; the rest of the vocabulary is covered above. Names not in
    // PAIR_MEANINGS are not routed at all — a route for a theme no pair
    // produces is dead weight that reads like coverage.
  }),
  partner: T({
    identity: T({ overall_dynamic: 1.0, long_term_rhythm: 0.4 }),
    emotion: T({ emotional_connection: 1.0, conflict_repair: 0.3 }),
    safety: T({ emotional_connection: 0.6, trust_reliability: 0.5 }),
    communication: T({ communication: 1.0, conflict_repair: 0.4 }),
    affection: T({ attraction_intimacy: 0.7, emotional_connection: 0.5 }),
    attraction: T({ attraction_intimacy: 1.0 }),
    values: T({ long_term_rhythm: 0.5, trust_reliability: 0.4 }),
    drive: T({ attraction_intimacy: 0.4, conflict_repair: 0.5 }),
    friction: T({ conflict_repair: 1.0, boundaries: 0.4 }),
    structure: T({ trust_reliability: 0.8, long_term_rhythm: 0.9, boundaries: 0.5 }),
    duration: T({ long_term_rhythm: 1.0 }),
    growth: T({ long_term_rhythm: 0.5, overall_dynamic: 0.4 }),
    freedom: T({ boundaries: 1.0, long_term_rhythm: 0.4 }),
    idealisation: T({ trust_reliability: 0.6, emotional_connection: 0.4 }),
    intensity: T({ attraction_intimacy: 0.6, conflict_repair: 0.5 }),
  }),

  friend: T({
    identity: T({ overall_dynamic: 1.0, growth_inspiration: 0.4 }),
    emotion: T({ mutual_support: 0.8, conflict_repair: 0.3 }),
    safety: T({ trust_reliability: 0.7, mutual_support: 0.5 }),
    communication: T({ communication: 1.0, conflict_repair: 0.4 }),
    // Affection between friends is warmth, not romance — it feeds support.
    affection: T({ mutual_support: 0.8, overall_dynamic: 0.3 }),
    // `attraction` deliberately has NO friend category. Friend mode does not
    // score sexual attraction, so the theme is dropped rather than renamed.
    values: T({ trust_reliability: 0.6, growth_inspiration: 0.4 }),
    drive: T({ shared_energy: 1.0, conflict_repair: 0.3 }),
    friction: T({ conflict_repair: 1.0, boundaries_independence: 0.4 }),
    structure: T({ trust_reliability: 0.9, boundaries_independence: 0.5 }),
    duration: T({ trust_reliability: 0.6 }),
    growth: T({ growth_inspiration: 1.0, shared_energy: 0.4 }),
    freedom: T({ boundaries_independence: 1.0, shared_energy: 0.4 }),
    idealisation: T({ mutual_support: 0.5, communication: 0.3 }),
    intensity: T({ conflict_repair: 0.6, growth_inspiration: 0.4 }),
  }),

  family: T({
    identity: T({ overall_dynamic: 1.0, family_roles: 0.5 }),
    emotion: T({ emotional_safety: 1.0, conflict_repair: 0.3 }),
    safety: T({ emotional_safety: 1.0, support_responsibility: 0.4 }),
    communication: T({ communication: 1.0, conflict_repair: 0.4 }),
    affection: T({ emotional_safety: 0.6, support_responsibility: 0.5 }),
    // No attraction category in family mode, and the theme is dropped.
    values: T({ generational_patterns: 0.6, support_responsibility: 0.4 }),
    drive: T({ conflict_repair: 0.5, family_roles: 0.4 }),
    friction: T({ conflict_repair: 1.0, boundaries: 0.5 }),
    // Saturn is the family-roles planet: authority, obligation, seniority.
    structure: T({ family_roles: 1.0, support_responsibility: 0.9, boundaries: 0.6 }),
    duration: T({ generational_patterns: 0.8, support_responsibility: 0.4 }),
    growth: T({ generational_patterns: 0.5, overall_dynamic: 0.4 }),
    freedom: T({ boundaries: 1.0, family_roles: 0.4 }),
    idealisation: T({ emotional_safety: 0.5, communication: 0.3 }),
    intensity: T({ generational_patterns: 0.8, conflict_repair: 0.5 }),
  }),

  self: T({
    identity: T({ overall_integration: 1.0, self_trust: 0.4 }),
    emotion: T({ emotional_needs: 1.0, inner_tension: 0.3 }),
    safety: T({ emotional_needs: 0.7, self_trust: 0.5 }),
    communication: T({ communication_style: 1.0 }),
    affection: T({ emotional_needs: 0.5, integration_opportunities: 0.4 }),
    // No attraction category in self mode.
    values: T({ self_trust: 0.5, growth_patterns: 0.4 }),
    drive: T({ drive_regulation: 1.0, inner_tension: 0.4 }),
    friction: T({ inner_tension: 1.0, integration_opportunities: 0.5 }),
    structure: T({ drive_regulation: 0.8, self_trust: 0.7 }),
    duration: T({ self_trust: 0.5 }),
    growth: T({ growth_patterns: 1.0, integration_opportunities: 0.4 }),
    freedom: T({ growth_patterns: 0.6, inner_tension: 0.4 }),
    idealisation: T({ integration_opportunities: 0.5, emotional_needs: 0.3 }),
    intensity: T({ inner_tension: 0.8, growth_patterns: 0.4 }),
  }),
});

/**
 * How much each category counts toward the overall result, per mode.
 *
 * Each mode's weights sum to 1 so the overall is a genuine weighted mean and
 * no mode can drift louder than another. The differences ARE the product
 * decision: partner leans on emotional connection, attraction, trust, and
 * long-term rhythm; friend on communication, shared energy, support, and
 * independence; family on emotional safety, roles, responsibility, and
 * boundaries; self on integration, regulation, inner tension, and growth.
 */
export const CATEGORY_WEIGHTS = Object.freeze({
  general: T({
    overall_dynamic: 0.20,
    emotional_rhythm: 0.18,
    expression: 0.17,
    pace_and_drive: 0.16,
    friction: 0.16,
    room_to_differ: 0.13,
  }),
  partner: T({
    overall_dynamic: 0.10,
    emotional_connection: 0.18,
    communication: 0.13,
    attraction_intimacy: 0.15,
    trust_reliability: 0.14,
    boundaries: 0.08,
    conflict_repair: 0.12,
    long_term_rhythm: 0.10,
  }),
  friend: T({
    overall_dynamic: 0.10,
    trust_reliability: 0.16,
    communication: 0.17,
    shared_energy: 0.15,
    mutual_support: 0.15,
    boundaries_independence: 0.10,
    conflict_repair: 0.10,
    growth_inspiration: 0.07,
  }),
  family: T({
    overall_dynamic: 0.10,
    emotional_safety: 0.18,
    communication: 0.14,
    support_responsibility: 0.15,
    family_roles: 0.13,
    boundaries: 0.12,
    conflict_repair: 0.11,
    generational_patterns: 0.07,
  }),
  self: T({
    overall_integration: 0.16,
    emotional_needs: 0.15,
    communication_style: 0.12,
    drive_regulation: 0.15,
    inner_tension: 0.14,
    self_trust: 0.12,
    growth_patterns: 0.09,
    integration_opportunities: 0.07,
  }),
});

/**
 * Result bands.
 *
 * The BAND is the headline; the number is available underneath for anyone who
 * wants it. That ordering is deliberate — the vault names "a percentage read as
 * a probability" as a release risk, and a bare 73% invites exactly that
 * reading. A band plus its contributing factors cannot be mistaken for a
 * forecast in the way a lone number can.
 *
 * No band is a verdict. "Highly Challenging" describes where the geometry is
 * loud, not whether a relationship should exist.
 */
export const BANDS = Object.freeze([
  { min: 72, id: "strongly_supportive", label: "Strongly Supportive" },
  { min: 62, id: "supportive", label: "Supportive" },
  { min: 48, id: "mixed_workable", label: "Mixed but Workable" },
  { min: 40, id: "growth_heavy", label: "Growth-Heavy" },
  { min: 0, id: "highly_challenging", label: "Highly Challenging" },
]);

/**
 * WHY THESE THRESHOLDS AND NOT ROUND NUMBERS
 *
 * They are measured, not chosen. Two unrelated people's planets sit at
 * effectively independent longitudes, so a sweep of synthetic pairs is not a
 * toy — it IS the population this feature will be used on. Across 1,600 such
 * pairs the score distribution runs roughly p10=41, p50=53, p90=66.
 *
 * The first draft used 40/55/70/85 and put the median at 53, two points under
 * a boundary. Half of all real comparisons would have flipped between "Mixed
 * but Workable" and "Growth-Heavy" on rounding noise, and the top band was
 * unreachable — a scale whose upper half nobody can occupy is a scale that
 * says nothing.
 *
 * These sit the median comfortably inside the middle band and give each of the
 * five a real share, so a band change means the charts changed rather than the
 * arithmetic wobbled.
 *
 * If any weight above is edited, RE-MEASURE. These numbers are downstream of
 * those ones, and bump COMPATIBILITY_VERSION when they move.
 */

/**
 * Self mode gets its own band labels, and this is not decoration.
 *
 * Self mode compares two saved configurations of ONE person — usually the same
 * birth with a different assumed time. The thresholds are the same arithmetic,
 * but the words cannot be: telling somebody their own two charts are "Highly
 * Challenging" is telling them they are a difficult relationship, which is both
 * meaningless and unkind. What the number actually measures here is how much
 * the two records AGREE, so that is what the labels say.
 */
export const SELF_BANDS = Object.freeze([
  { min: 72, id: "closely_aligned", label: "Closely Aligned" },
  { min: 62, id: "largely_aligned", label: "Largely Aligned" },
  { min: 48, id: "partly_aligned", label: "Partly Aligned" },
  { min: 40, id: "noticeably_different", label: "Noticeably Different" },
  { min: 0, id: "strongly_divergent", label: "Strongly Divergent" },
]);

/**
 * A SINGLE CATEGORY IS NOT AN OVERALL, AND THE SAME THRESHOLDS LIE ABOUT IT.
 *
 * An overall is a weighted mean of eight categories, so it concentrates. A
 * single category rests on whatever contacts happened to land in it, so it
 * spreads. Measured on the same sweep: overall sd = 10.0, category sd = 15.9.
 *
 * Reading both scales with one set of thresholds is not a simplification, it
 * is a distortion. It sent 19% of categories to the bottom band against 8% of
 * overalls, so a perfectly ordinary comparison displayed "Highly Challenging"
 * beside six of its eight categories while its overall read Growth-Heavy. That
 * was observed in a browser on real fixtures, and it reads as alarming because
 * it looks like a verdict when it is an artifact of counting.
 *
 * These are the SAME percentile cut points as BANDS, re-measured against the
 * category distribution. A category band now means the same thing about a
 * category that an overall band means about an overall — which is the only way
 * the two can honestly sit on one screen.
 */
export const CATEGORY_BANDS = Object.freeze([
  { min: 81, id: "strongly_supportive", label: "Strongly Supportive" },
  { min: 67, id: "supportive", label: "Supportive" },
  { min: 44, id: "mixed_workable", label: "Mixed but Workable" },
  { min: 31, id: "growth_heavy", label: "Growth-Heavy" },
  { min: 0, id: "highly_challenging", label: "Highly Challenging" },
]);

/** Self-mode category labels, on the category thresholds. */
export const CATEGORY_SELF_BANDS = Object.freeze(
  CATEGORY_BANDS.map((b, i) => Object.freeze({ ...b, id: SELF_BANDS[i].id, label: SELF_BANDS[i].label })));

/**
 * The band scale to read on.
 *
 * `mode` picks the words (self gets alignment language, not relationship
 * verdicts); `scope` picks the thresholds (a category spreads wider than an
 * overall). Both axes are real and neither substitutes for the other.
 */
export function bandsFor(mode, scope = "overall") {
  if (scope === "category") return mode === "self" ? CATEGORY_SELF_BANDS : CATEGORY_BANDS;
  return mode === "self" ? SELF_BANDS : BANDS;
}

/**
 * Below this much accumulated evidence a category reports "Limited evidence"
 * instead of a band. Two average contacts land near 1.0, so 0.75 is roughly
 * "at least one real contact" — enough to say something, and honest about
 * saying little when there is little.
 */
export const MIN_EVIDENCE_FOR_BAND = 0.75;

/** Neutral centre. A category with balanced evidence sits here, not at zero. */
export const NEUTRAL_SCORE = 50;

/**
 * How far the strongest realistic evidence can move a category from neutral.
 * Chosen so a category with several tight supportive contacts reaches the
 * Supportive band without every comparison pinning at 100 — a scale whose top
 * is unreachable is as useless as one where everything scores 90.
 */
export const SCORE_SWING = 45;

/** Unordered key for a planet pair, so Sun|Moon and Moon|Sun are one row. */
export function pairKey(a, b) {
  return [a, b].sort().join("|");
}

/** The documented meaning for a pair, or null when the pair carries no theme. */
export function pairMeaning(a, b) {
  return PAIR_MEANINGS[pairKey(a, b)] ?? null;
}
