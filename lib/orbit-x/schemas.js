// Orbit X :: structured output validation (Dev Update 5.0).
//
// The model returns JSON or it returns nothing usable. Validation is
// server-side, before anything is stored, and rejection is CLEAN: the
// candidate survives, the admin sees why, and retry costs one click. Invalid
// output must never reach the drafts table — a malformed draft saved "to fix
// later" becomes a published mistake with a delay.

import { FORMATS } from "./formats.js";

export class OrbitXValidationError extends Error {
  constructor(problems) {
    super(`Generated output failed validation: ${problems.join("; ")}`);
    this.name = "OrbitXValidationError";
    this.problems = problems;
  }
}

const isStr = (v) => typeof v === "string" && v.trim().length > 0;

/**
 * Validate one generated post against its format's contract.
 * Returns the trimmed, frozen post; throws OrbitXValidationError otherwise.
 */
export function validateGeneratedPost(raw, formatId) {
  const format = FORMATS[formatId];
  const problems = [];
  if (!format) throw new OrbitXValidationError([`unknown format "${formatId}"`]);
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    throw new OrbitXValidationError(["output is not an object"]);
  }

  if (raw.format !== formatId) problems.push(`format field is "${raw.format}", expected "${formatId}"`);
  if (!isStr(raw.headline)) problems.push("headline missing");
  else if (raw.headline.length > format.limits.headline) {
    problems.push(`headline exceeds ${format.limits.headline} characters`);
  }
  if (!Array.isArray(raw.slides)) problems.push("slides missing");
  else {
    if (raw.slides.length < format.slides.min || raw.slides.length > format.slides.max) {
      problems.push(`${raw.slides.length} slides; ${format.name} takes ${format.slides.min}–${format.slides.max}`);
    }
    raw.slides.forEach((slide, i) => {
      if (!isStr(slide?.heading)) problems.push(`slide ${i + 1} heading missing`);
      if (!isStr(slide?.body)) problems.push(`slide ${i + 1} body missing`);
      else if (slide.body.length > format.limits.slideBody) {
        problems.push(`slide ${i + 1} body exceeds ${format.limits.slideBody} characters`);
      }
    });
  }
  if (!isStr(raw.caption)) problems.push("caption missing");
  else if (raw.caption.length > format.limits.caption) {
    problems.push(`caption exceeds ${format.limits.caption} characters`);
  }
  if (!isStr(raw.altText)) problems.push("altText missing — accessibility is not optional");
  if (typeof raw.cta !== "string") problems.push("cta missing (empty string is allowed)");

  if (problems.length) throw new OrbitXValidationError(problems);

  return Object.freeze({
    format: formatId,
    headline: raw.headline.trim(),
    subhead: isStr(raw.subhead) ? raw.subhead.trim() : "",
    slides: raw.slides.map((s) => Object.freeze({ heading: s.heading.trim(), body: s.body.trim() })),
    caption: raw.caption.trim(),
    cta: raw.cta.trim(),
    altText: raw.altText.trim(),
    editorialNotes: Array.isArray(raw.editorialNotes) ? raw.editorialNotes.filter(isStr) : [],
  });
}

/** Parse the model's text into JSON, tolerating nothing but JSON. */
export function parseModelJson(text) {
  const cleaned = String(text || "").trim()
    // The one liberty: strip a markdown fence if the model ignored the rule,
    // because refusing over decoration punishes the admin, not the model.
    .replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  try { return JSON.parse(cleaned); }
  catch { throw new OrbitXValidationError(["response was not valid JSON"]); }
}
