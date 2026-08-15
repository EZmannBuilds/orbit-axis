// Orbit Axis :: compatibility copy. Composed on the server, always.
//
// Same rule as lib/transits/interpretation.js and lib/interpretation/compose.js:
// the browser renders sentences it was handed and never writes one. Two places
// composing the same evidence is how a product grows a second opinion about
// itself.
//
// Planet roles are IMPORTED from lib/interpretation/planets.js rather than
// restated. Mercury means the same thing in My Chart, in Today's Transits, and
// here, or the product contradicts itself.
//
// Pure: no clock, no randomness, no network.

import { PLANETS } from "../interpretation/planets.js";
import { ASPECTS } from "../interpretation/aspects.js";
import {
  MODE_TITLES, MODE_SUBTITLES, REFLECTION_PROMPTS,
} from "./categories.js";
import { NEUTRAL_SCORE } from "./weights.js";

export const CONTENT_VERSION = "compatibility-1.0.0";

/** How the two charts are named in copy, per mode. Never "the other person" in self. */
const SIDE_WORDS = Object.freeze({
  partner: { a: "your", b: "their" },
  friend: { a: "your", b: "their" },
  family: { a: "your", b: "their" },
  // Self mode compares two saved configurations, not two people. "This chart"
  // and "the other chart" keep it about the records, which is what it is.
  self: { a: "this chart's", b: "the other chart's" },
  // Neither chart is the reader, so neither gets "your". Naming them by
  // position keeps the copy about two records rather than addressing one of
  // two people who are not in the room.
  general: { a: "the first chart's", b: "the second chart's" },
});

/** The five aspect names the engine emits, mapped to the authored corpus. */
const ASPECT_KEY = Object.freeze({
  conjunction: "Conjunction", opposition: "Opposition",
  square: "Square", trine: "Trine", sextile: "Sextile",
});

/** Orb closeness in words. Mirrors lib/transits/interpretation.js intensity(). */
export function orbLabel(orb) {
  if (!Number.isFinite(orb)) return null;
  if (orb <= 0.5) return "exact";
  if (orb <= 1.5) return "close";
  if (orb <= 3) return "moderate";
  return "wide";
}

/**
 * One contributing factor, in a sentence a person can read.
 *
 * Names both bodies with their side, the aspect in plain language, and what
 * the two functions are actually doing. The technical detail (exact orb) is
 * carried separately so the interface can hold it behind Advanced rather than
 * putting degrees in front of someone who wanted a sentence.
 */
export function describeFactor(contribution, mode) {
  const sides = SIDE_WORDS[mode] || SIDE_WORDS.partner;
  const meaning = ASPECTS[ASPECT_KEY[contribution.aspect]];
  const roleA = PLANETS[contribution.bodyA];
  const roleB = PLANETS[contribution.bodyB];
  if (!meaning || !roleA || !roleB) return null;

  const closeness = orbLabel(contribution.orb);
  return Object.freeze({
    id: `${contribution.contact}-${contribution.aspect}`.toLowerCase(),
    // "Your Venus and their Mars support each other."
    headline: `${capitalise(sides.a)} ${contribution.bodyA} and ${sides.b} `
            + `${contribution.bodyB} ${meaning.interaction}.`,
    // What the two functions are, so the sentence is not two proper nouns.
    roles: `${roleA.function_} meeting ${roleB.function_.toLowerCase()}.`,
    aspect: meaning.name,
    bodies: [contribution.bodyA, contribution.bodyB],
    orb: contribution.orb,
    closeness,
    // Advanced-mode technical line. Never shown by default.
    technical: `${contribution.bodyA} ${contribution.aspect} ${contribution.bodyB}`
             + (Number.isFinite(contribution.orb) ? ` · ${contribution.orb.toFixed(1)}° orb (${closeness})` : ""),
    source_version: CONTENT_VERSION,
  });
}

function capitalise(word) {
  return word ? word[0].toUpperCase() + word.slice(1) : word;
}

/**
 * A category, presented.
 *
 * `summary` uses the category's own supportive/straining wording so the same
 * score reads as the right thing for the relationship. A category without
 * enough evidence says so plainly rather than reporting a confident middle.
 */
export function presentCategory(category, mode, { factorLimit = 3 } = {}) {
  const supporting = category.supporting.map((c) => describeFactor(c, mode)).filter(Boolean).slice(0, factorLimit);
  const straining = category.straining_factors.map((c) => describeFactor(c, mode)).filter(Boolean).slice(0, factorLimit);
  const mixed = category.mixed_factors.map((c) => describeFactor(c, mode)).filter(Boolean).slice(0, factorLimit);

  let summary;
  if (!category.hasBand) {
    summary = "There is little contact between these two charts in this area. "
            + "That is not a problem to solve — it means this comparison has less to say here.";
  } else if (category.score > NEUTRAL_SCORE) {
    summary = category.supportive;
  } else if (category.score < NEUTRAL_SCORE) {
    summary = category.straining;
  } else {
    summary = "Support and strain are evenly matched here, which tends to feel "
            + "like an area that rewards attention rather than one that runs itself.";
  }

  return Object.freeze({
    id: category.id,
    label: category.label,
    question: category.question,
    score: category.score,
    band: category.band ? { id: category.band.id, label: category.band.label } : null,
    hasEvidence: category.hasBand,
    evidenceStrength: category.evidence,
    summary,
    supporting,
    straining,
    mixed,
    source_version: CONTENT_VERSION,
  });
}

/**
 * The overall paragraph.
 *
 * Describes the pattern of categories, and stops there. No prediction, no
 * instruction, no verdict about whether the relationship should continue —
 * a chart cannot know any of that, and a sentence that implies otherwise is
 * the single worst thing this feature could ship.
 */
export function presentOverall(scored, highlights, mode) {
  const { overall } = scored;
  const strong = highlights.strengths.map((c) => c.label.toLowerCase());
  const growth = highlights.growth.map((c) => c.label.toLowerCase());

  if (!overall.hasBand) {
    return Object.freeze({
      band: null,
      score: null,
      summary: "These two charts make very few contacts with each other. That is a "
             + "real result rather than a missing one — it usually means the relationship "
             + "is shaped more by what the two of you decide than by anything the charts insist on.",
      strengths: [], growth: [],
      source_version: CONTENT_VERSION,
    });
  }

  const opener = {
    partner: "Read as a partner relationship, ",
    friend: "Read as a friendship, ",
    family: "Read as a family relationship, ",
    self: "Comparing these two saved configurations, ",
  }[mode] || "";

  // Self mode is not describing support between people, so it does not borrow
  // the relationship wording. It reports agreement and divergence between two
  // records, which is the only thing it can honestly claim.
  const isSelf = mode === "self";
  const strengthClause = strong.length
    ? (isSelf
      ? `the two agree most about ${list(strong)}`
      : `the clearest support shows up in ${list(strong)}`)
    : (isSelf
      ? "no area stands out as clearly consistent between them"
      : "no single area stands out as clearly supportive");
  const growthClause = growth.length
    ? (isSelf
      ? `, and they differ most about ${list(growth)}`
      : `, while ${list(growth)} ${growth.length === 1 ? "asks" : "ask"} for more deliberate attention`)
    : "";

  return Object.freeze({
    band: { id: overall.band.id, label: overall.band.label },
    score: overall.score,
    coverage: overall.coverage,
    summary: `${opener}${strengthClause}${growthClause}.`,
    strengths: highlights.strengths.map((c) => ({ id: c.id, label: c.label, score: c.score })),
    growth: highlights.growth.map((c) => ({ id: c.id, label: c.label, score: c.score })),
    source_version: CONTENT_VERSION,
  });
}

function list(items) {
  if (items.length === 1) return items[0];
  if (items.length === 2) return `${items[0]} and ${items[1]}`;
  return `${items.slice(0, -1).join(", ")}, and ${items[items.length - 1]}`;
}

/** The sentence that must appear wherever a result does. */
export const METHODOLOGY_NOTE =
  "Compatibility results describe astrological patterns, not guaranteed relationship "
  + "outcomes. Real relationships also depend on communication, choices, history, "
  + "safety, and circumstances.";

/** The expandable explanation of how the result was produced. */
export function methodology(mode, version) {
  return Object.freeze({
    note: METHODOLOGY_NOTE,
    points: Object.freeze([
      "The evidence is the set of aspects between the two charts' planets, "
      + "calculated by Orbit's own engine — the same geometry used everywhere else in the app.",
      "The relationship type changes which questions are asked of that evidence and how much "
      + "each question counts. It does not change the chart calculation itself.",
      "The same two charts and the same relationship type always produce the same result.",
      "Scores are interpretive weightings, not probabilities. A high score is not a prediction "
      + "that a relationship will succeed, and a low one is not a prediction that it will not.",
      "Nothing here is written by an AI. Every sentence comes from a fixed, reviewed library.",
    ]),
    ratingVersion: version,
    contentVersion: CONTENT_VERSION,
  });
}

/** Title, subtitle, and prompts for a mode. */
export function modeFraming(mode) {
  return Object.freeze({
    title: MODE_TITLES[mode] || "Compatibility",
    subtitle: MODE_SUBTITLES[mode] || "",
    prompts: REFLECTION_PROMPTS[mode] || [],
  });
}
