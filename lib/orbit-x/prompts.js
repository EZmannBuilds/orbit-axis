// Orbit X :: prompt construction (Dev Update 5.0).
//
// The model is never asked what is happening in the sky. It is told what
// Orbit calculated and asked to explain it, inside the constitution's rules,
// in the format's structure. The packet is assembled here from verified
// candidate facts plus editorial context — and from NOTHING personal: no
// natal data, no account identifiers, no reading history. A test greps the
// packet builder to hold that line.

import { CONSTITUTION } from "./editorial.js";
import { FORMATS, APPROVED_CTAS } from "./formats.js";

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
    respondWith: {
      format: formatId, headline: "string", subhead: "string (optional)",
      slides: [{ heading: "string", body: "string" }],
      caption: "string", cta: "one of allowedCtas", altText: "string",
      editorialNotes: ["string (optional)"],
    },
  };
}

export function systemPrompt() { return CONSTITUTION; }
