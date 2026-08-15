// Orbit Axis :: compatibility orchestration and the ownership boundary.
//
// The one place that touches stored data. Everything below it (categories,
// weights, evidence, scoring, presentation) is pure and knows nothing about
// owners, requests, or Supabase — which is what lets the whole rating scheme be
// tested without a database.
//
// THE BOUNDARY, stated once:
//   Both chart ids are resolved through svc.profileFor(owner, id), the same
//   owner-scoped read the avatar path uses. A chart belonging to somebody else
//   does not 403 — it 404s, because "this exists but is not yours" is itself a
//   disclosure. That is the existing rule in lib/charts/api.js and this route
//   does not get to invent a different one.
//
// NOTHING IS PERSISTED. No table, no cache, no bucket. A comparison is derived
// on request from two rows the owner already has, and it disappears when the
// response is written.

import { ChartError } from "../charts/service.js";
import { computeSynastryAspects } from "@ezmannbuilds/orbit-axis-engine";
import { publicIdentity } from "../charts/identity.js";
import {
  isCalculableRelationship, BLOCKED_RELATIONSHIP_VALUES, COMPATIBILITY_MODES,
} from "./categories.js";
import { collectEvidence } from "./evidence.js";
import { scoreComparison, highlightCategories } from "./scoring.js";
import {
  presentCategory, presentOverall, methodology, modeFraming, CONTENT_VERSION,
} from "./presentation.js";

/** A refusal with a stable code, mapped to a status by the route. */
export class CompatibilityError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = "CompatibilityError";
    this.code = code;
    this.details = details;
  }
}

/**
 * The subject chart must be a Self chart.
 *
 * A relationship type is stored relative to the account owner: `partner` means
 * "this person is my partner", not "these two are partners". So a comparison
 * only means what it claims if one side is the owner. Comparing a saved friend
 * against a saved partner and labelling the result "partner compatibility"
 * would describe a relationship between two other people that nobody claimed
 * exists.
 */
const SUBJECT_RELATIONSHIP = "self";

/** Relationship values a person can choose on a chart, in the editor's order. */
const SETTABLE_RELATIONSHIPS = Object.freeze(["partner", "friend", "family", "self"]);

/**
 * Which chart decides the reading.
 *
 * The OTHER chart carries the relationship, so it picks the mode. Self mode is
 * the exception that proves it: both sides are Self, so there is no relationship
 * to read and the comparison is between two records rather than two people.
 */
function resolveMode(subject, other) {
  const raw = other.relationship_type ?? null;
  const subjectIsOwner = subject.relationship_type === SUBJECT_RELATIONSHIP;

  if (!isCalculableRelationship(raw)) {
    // Never guess. `other` and NULL mean nobody chose, and `public_figure` is a
    // real choice that is not one of the four modes — mapping any of them to a
    // mode would invent a relationship on the person's behalf.
    throw new CompatibilityError(
      "relationship_required",
      "This chart needs a relationship type before it can be compared.",
      {
        chart_id: other.id,
        chart_name: other.nickname || null,
        stored_value: raw,
        // What a person can actually SET on a chart. COMPATIBILITY_MODES now
        // includes `general`, which is a mode the server derives when neither
        // chart is the owner's — never a relationship anyone can choose. An
        // error that offers it would send someone looking for an option that
        // does not exist in the identity editor.
        allowed: SETTABLE_RELATIONSHIPS,
        // What the interface should offer: a link into the identity editor for
        // this specific chart, not a generic error.
        remedy: "set_relationship",
      });
  }

  if (raw === "self") {
    // Self mode compares two saved Self configurations — the same person
    // recorded twice, usually with a different birth time or place. It must
    // never be dressed up as a relationship.
    // Both sides Self: two of the owner's own configurations. Otherwise the
    // other chart is saved as Self but the subject is not, which is two
    // different people and therefore a general comparison.
    if (!subjectIsOwner) return "general";
    return "self";
  }

  if (!subjectIsOwner) {
    // Neither chart is the account holder. The comparison is still meaningful —
    // the geometry between two charts does not require anyone's permission —
    // but the RELATIONSHIP label cannot travel with it. `relationship_type`
    // records how each person relates to the OWNER, so calling this "partner
    // compatibility" would assert a relationship between two other people that
    // nobody has claimed exists. General mode compares the charts and says
    // plainly that it is not reading a relationship.
    return "general";
  }

  if (subject.relationship_type !== SUBJECT_RELATIONSHIP) {
    throw new CompatibilityError(
      "subject_must_be_self",
      "Compatibility is read from your own chart outward, so the first chart must be one you have saved as Self.",
      {
        chart_id: subject.id,
        chart_name: subject.nickname || null,
        stored_value: subject.relationship_type ?? null,
        remedy: isCalculableRelationship(subject.relationship_type)
          ? "choose_self_subject"
          : "set_relationship",
      });
  }

  return raw;
}

/**
 * What an unknown birth time costs here, and what it does not.
 *
 * Synastry between planets is longitude-only, so most of it survives an unknown
 * time untouched. The Moon does not: it moves about 13° a day, so a chart saved
 * without a time can put it anywhere in a half-sign range, and the Moon is in
 * the middle of the emotional categories. Saying that plainly is the difference
 * between a limitation and a silent error.
 */
export function timeAccuracyNotice(subjectChart, otherChart, labels) {
  const affected = [];
  if (subjectChart?.time_known === false) affected.push(labels.subject);
  if (otherChart?.time_known === false) affected.push(labels.other);
  if (!affected.length) return null;

  const who = affected.length === 2
    ? "Neither chart has a birth time"
    : `${affected[0]} has no birth time`;
  return Object.freeze({
    title: "Calculated without a birth time",
    body: `${who}, so the Moon's position is approximate — it moves about half a sign `
        + "per day. Contacts involving the Moon may shift once a time is added; the rest "
        + "of the comparison does not depend on it. Rising signs, houses, and angles are "
        + "never used in this comparison.",
    charts: affected,
  });
}

/**
 * Reduce a stored row to what a compatibility response may carry.
 *
 * publicIdentity already draws the line the export cleanup drew (no storage
 * path, no owner id). Birth data is deliberately NOT included: the person can
 * already see it in the chart itself, and a comparison does not need to restate
 * somebody's birth details to explain a score.
 */
function side(profile) {
  const identity = publicIdentity(profile);
  return Object.freeze({
    id: identity.id,
    name: identity.name,
    initials: identity.initials,
    relationship: identity.relationship,
    hasAvatar: identity.hasAvatar,
    avatarVersion: identity.avatarVersion,
    isPrimary: identity.isPrimary,
  });
}

/**
 * Compare two owned charts.
 *
 * `svc` is a chart service (createChartService), passed in rather than
 * constructed so tests can drive this with a fake store and no network.
 *
 * Order of operations is load-bearing: ownership first, then relationship
 * validity, then calculation. A caller probing another owner's chart id must be
 * refused before anything about it — including whether its relationship type is
 * set — can be inferred from the response.
 */
export async function compareCharts(svc, ownerId, subjectId, otherId) {
  if (!subjectId || !otherId) {
    throw new CompatibilityError("invalid_input", "Two chart ids are required.");
  }
  if (subjectId === otherId) {
    throw new CompatibilityError(
      "same_chart",
      "Choose two different charts to compare.",
      { remedy: "choose_other_chart" });
  }

  // Ownership. Either of these throws ChartError("not_found") for a chart that
  // is not this owner's, which the route maps to 404.
  const subject = await svc.profileFor(ownerId, subjectId);
  const other = await svc.profileFor(ownerId, otherId);

  const mode = resolveMode(subject, other);

  // Natal charts, through the service's own cache. get() returns the presented
  // profile plus the computed chart; only the chart is used here.
  //
  // Yes, this reads each row a second time. That is deliberate: the alternative
  // is calculating two natal charts BEFORE knowing whether the comparison is
  // even permitted, and an ephemeris subprocess costs far more than a row read.
  // Refusals stay cheap.
  const [subjectRead, otherRead] = await Promise.all([
    svc.get(ownerId, subjectId),
    svc.get(ownerId, otherId),
  ]);

  return buildComparison({
    mode,
    subject, other,
    subjectChart: subjectRead.chart,
    otherChart: otherRead.chart,
  });
}

/**
 * The pure half: two charts and a mode in, a full response out.
 *
 * Exported separately from compareCharts so tests can assert determinism on
 * fixed chart fixtures without a store, an owner, or a promise. Same inputs,
 * same output, every time.
 */
export function buildComparison({ mode, subject, other, subjectChart, otherChart }) {
  const aspects = computeSynastryAspects(subjectChart, otherChart);
  const evidence = collectEvidence(aspects, mode);
  const scored = scoreComparison(evidence, mode);
  const highlights = highlightCategories(scored.categories);

  const subjectSide = side(subject);
  const otherSide = side(other);

  return Object.freeze({
    version: scored.version,
    content_version: CONTENT_VERSION,
    mode,
    framing: modeFraming(mode),
    subject: subjectSide,
    other: otherSide,
    overall: presentOverall(scored, highlights, mode),
    categories: scored.categories.map((c) => presentCategory(c, mode)),
    limitations: [
      timeAccuracyNotice(subjectChart, otherChart, {
        subject: subjectSide.name, other: otherSide.name,
      }),
    ].filter(Boolean),
    methodology: methodology(mode, scored.version),
    // Counts, so the interface can say how much was actually looked at without
    // shipping the raw aspect list to the browser.
    evidence_summary: Object.freeze({
      contacts: aspects.length,
      contributions: evidence.length,
      coverage: scored.overall.coverage,
    }),
  });
}

/**
 * The charts that can be compared, and why the rest cannot.
 *
 * The interface needs this to build an honest picker: a chart that would be
 * refused should say so in the list rather than after a click. Every chart is
 * returned — one with a blocked relationship is listed as unavailable with the
 * reason, never hidden, because a chart vanishing from a list is a bug report
 * and a chart explaining itself is a prompt.
 */
export async function comparisonOptions(svc, ownerId, subjectId = null) {
  const { charts, active_chart_id } = await svc.list(ownerId);

  const selves = charts.filter((c) => c.relationship_type === SUBJECT_RELATIONSHIP);
  const subject = subjectId
    ? charts.find((c) => c.id === subjectId) || null
    : selves.find((c) => c.is_primary) || selves[0] || null;

  const options = charts.map((chart) => {
    const blocked = BLOCKED_RELATIONSHIP_VALUES.includes(chart.relationship_type ?? null);
    const isSubject = subject ? chart.id === subject.id : false;
    return {
      id: chart.id,
      name: chart.nickname,
      relationship_type: chart.relationship_type ?? null,
      is_primary: chart.is_primary === true,
      is_subject: isSubject,
      available: !blocked && !isSubject,
      unavailable_reason: blocked ? "relationship_required"
        : isSubject ? "same_chart"
          : null,
    };
  });

  // Self mode needs a second Self record. Reporting the count lets the
  // interface show the documented empty state up front instead of letting
  // somebody pick their way into a refusal.
  const selfComparable = selves.length >= 2;

  return Object.freeze({
    subject_id: subject?.id ?? null,
    subject_available: Boolean(subject) && subject.relationship_type === SUBJECT_RELATIONSHIP,
    active_chart_id,
    self_chart_count: selves.length,
    self_comparison_available: selfComparable,
    options,
  });
}

/** Status for each refusal code. Kept next to the codes that produce them. */
export function statusForCode(code) {
  return {
    invalid_input: 400,
    same_chart: 400,
    relationship_required: 409,
    self_requires_two: 409,
    subject_must_be_self: 409,
  }[code] || 400;
}

export { ChartError };
