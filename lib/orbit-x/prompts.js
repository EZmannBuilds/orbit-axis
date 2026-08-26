// Orbit X :: prompt construction (Dev Update 5.0).
//
// The model is never asked what is happening in the sky. It is told what
// Orbit calculated and asked to explain it, inside the constitution's rules,
// in the format's structure. The packet is assembled here from verified
// candidate facts plus editorial context — and from NOTHING personal: no
// natal data, no account identifiers, no reading history. A test greps the
// packet builder to hold that line.

import { CONSTITUTION } from "./editorial.js";
import { FORMATS, APPROVED_CTAS, ROLE_SEQUENCES } from "./formats.js";
import { bodyCapacity } from "./templates.js";

/**
 * The user-turn packet for one generation.
 *
 * @param {object} candidate       verified facts included verbatim
 * @param {string} formatId
 * @param {Array}  recentTopics    titles to avoid repeating (strings only)
 * @param {string} [instruction]   optional admin steering for regeneration
 */
export function buildPacket(candidate, formatId, recentTopics = [], instruction = "") {
  const format = FORMATS[formatId];
  return {
    task: "Write one social post from the calculated facts below.",
    format: formatId,
    formatName: format.name,
    formatPurpose: format.purpose,
    slideRange: format.slides,
    limits: format.limits,
    audience: "astrology-curious beginner",
    allowedCtas: APPROVED_CTAS,
    event: {
      type: candidate.eventType,
      title: candidate.title,
      timestamp: candidate.timestamp,
      facts: candidate.facts,
      source: candidate.source,
      approximate: candidate.approximate === true,
    },
    recentTopicsToAvoid: recentTopics.slice(0, 10).map(String),
    registers: "Keep three registers distinct across the slides: (1) the calculated fact, stated plainly; (2) the symbolic association, attributed to tradition; (3) a reflection, as an open question.",
    adminInstruction: String(instruction || "").slice(0, 500),
    slideRoles: ROLE_SEQUENCES[formatId] || null,
    // Per-slot budgets, measured from the template that will draw them. The
    // flat `limits.slideBody` above is the format's editorial ceiling; these
    // are what each slide can physically keep, and a cover hook keeps far
    // less than a body slide. Given both, copy arrives fitting.
    slideBudgets: slideBudgets(formatId),
    // Readings are one period's collective copy, and two of their slides are
    // structural rather than free: the cover carries the headline and the
    // one-sentence slide carries the thesis the rest of the post answers to.
    // The period's own metadata is NOT here to be echoed — the server grafts
    // it from the candidate after generation, because a period key is a fact
    // and facts are not the model's to retype.
    ...(format.readingType ? { reading: readingBrief(candidate, format) } : {}),
    respondWith: {
      format: formatId, headline: "string", subhead: "string (optional)",
      slides: [{ heading: "string", body: "string", role: "the matching entry from slideRoles, in order" }],
      caption: "string", cta: "one of allowedCtas", altText: "string",
      editorialNotes: ["string (optional)"],
    },
  };
}

/** What a reading's writer needs, and nothing it could get wrong by echoing. */
function readingBrief(candidate, format) {
  return {
    readingType: format.readingType,
    periodLabel: String(candidate?.facts?.period?.label || ""),
    structure: [
      "The headline IS the theme of the reading. Write it once, in the headline field.",
      "The slide with role \"cover\" repeats nothing the headline already says — leave its body empty, or give it one short hook line under 72 characters.",
      "The slide with role \"one_sentence\" is the thesis: one sentence naming what this period holds, which every later slide stays consistent with.",
      "Do not output a \"reading\" object. Period keys, labels and event keys are engine facts and are attached server-side.",
    ],
  };
}

export function systemPrompt() { return CONSTITUTION; }

/** Characters per role for a format, from the renderer's own geometry.
 *  Readings are drawn portrait; everything else is square. */
function slideBudgets(formatId) {
  const roles = ROLE_SEQUENCES[formatId];
  if (!roles) return null;
  const aspect = String(formatId || "").endsWith("_reading") ? "portrait" : "square";
  const ceiling = FORMATS[formatId]?.limits?.slideBody ?? 240;
  const budgets = {};
  for (const role of roles) budgets[role] = Math.min(ceiling, bodyCapacity(role, { aspect }));
  return budgets;
}
