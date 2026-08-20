// Orbit X :: structured output validation (Dev Update 5.0).
//
// The model returns JSON or it returns nothing usable. Validation is
// server-side, before anything is stored, and rejection is CLEAN: the
// candidate survives, the admin sees why, and retry costs one click. Invalid
// output must never reach the drafts table — a malformed draft saved "to fix
// later" becomes a published mistake with a delay.

import { FORMATS } from "./formats.js";
import { SLIDE_ROLES, REQUIRED_ROLES, ASPECT_IDS, TEMPLATE_IDS, DENSITIES } from "./templates.js";

export class OrbitXValidationError extends Error {
  constructor(problems) {
    super(`Generated output failed validation: ${problems.join("; ")}`);
    this.name = "OrbitXValidationError";
    this.problems = problems;
  }
}

const isStr = (v) => typeof v === "string" && v.trim().length > 0;

/** The design object a post may carry (Dev Update 5.1): sanitized to known
 *  keys and known vocabularies; anything else is dropped, never stored. */
function sanitizeDesign(raw) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const design = {};
  if (ASPECT_IDS.includes(raw.aspect)) design.aspect = raw.aspect;
  if (TEMPLATE_IDS.includes(raw.template)) design.template = raw.template;
  if (Number.isInteger(raw.variant) && raw.variant >= 0 && raw.variant <= 4) design.variant = raw.variant;
  if (DENSITIES[raw.density]) design.density = raw.density;
  for (const group of ["visuals", "metadata"]) {
    if (raw[group] && typeof raw[group] === "object" && !Array.isArray(raw[group])) {
      design[group] = Object.fromEntries(Object.entries(raw[group])
        .filter(([, v]) => typeof v === "boolean").slice(0, 12));
    }
  }
  return Object.keys(design).length ? Object.freeze(design) : null;
}

/**
 * Validate one post against its format's contract.
 * Returns the trimmed, frozen post; throws OrbitXValidationError otherwise.
 *
 * `requireComplete: false` (Dev Update 5.1) is the DRAFT register: interpretive
 * slide bodies and the caption may still be empty, because a manual draft
 * starts with those fields deliberately blank rather than holding worksheet
 * instructions. Approval re-checks with draftCompleteness() — an unfinished
 * draft can be saved, previewed, and edited, but never approved or generated.
 */
export function validateGeneratedPost(raw, formatId, { requireComplete = true } = {}) {
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
      if (typeof slide?.body !== "string") problems.push(`slide ${i + 1} body missing`);
      else if (requireComplete && !isStr(slide.body) && REQUIRED_ROLES[slide?.role] !== false) {
        problems.push(`slide ${i + 1} body missing`);
      } else if (slide.body.length > format.limits.slideBody) {
        problems.push(`slide ${i + 1} body exceeds ${format.limits.slideBody} characters`);
      }
      if (slide?.role !== undefined && !SLIDE_ROLES.includes(slide.role)) {
        problems.push(`slide ${i + 1} role "${slide.role}" is not a known role`);
      }
    });
  }
  if (typeof raw.caption !== "string" || (requireComplete && !isStr(raw.caption))) {
    problems.push("caption missing");
  } else if (raw.caption.length > format.limits.caption) {
    problems.push(`caption exceeds ${format.limits.caption} characters`);
  }
  if (!isStr(raw.altText)) problems.push("altText missing — accessibility is not optional");
  if (typeof raw.cta !== "string") problems.push("cta missing (empty string is allowed)");

  if (problems.length) throw new OrbitXValidationError(problems);

  return Object.freeze({
    format: formatId,
    headline: raw.headline.trim(),
    subhead: isStr(raw.subhead) ? raw.subhead.trim() : "",
    slides: raw.slides.map((s) => Object.freeze({
      heading: s.heading.trim(), body: s.body.trim(),
      ...(SLIDE_ROLES.includes(s.role) ? { role: s.role } : {}),
    })),
    caption: raw.caption.trim(),
    cta: raw.cta.trim(),
    altText: raw.altText.trim(),
    editorialNotes: Array.isArray(raw.editorialNotes) ? raw.editorialNotes.filter(isStr) : [],
    ...(sanitizeDesign(raw.design) ? { design: sanitizeDesign(raw.design) } : {}),
  });
}

/**
 * The approval quality gate (Dev Update 5.1, §71): which required sections
 * still need the editor. Depends on slide roles; slides without a role are
 * treated as required, which is the strict direction to fail in.
 */
export function draftCompleteness(post) {
  const missing = [];
  if (!isStr(post?.headline)) missing.push("headline");
  (post?.slides || []).forEach((slide, i) => {
    const required = slide?.role ? REQUIRED_ROLES[slide.role] !== false : true;
    if (required && !isStr(slide?.body)) {
      missing.push(`slide ${i + 1}${slide?.role ? ` (${slide.role})` : ""}`);
    }
  });
  if (!isStr(post?.caption)) missing.push("caption");
  if (!isStr(post?.altText)) missing.push("alt text");
  return { complete: missing.length === 0, missing,
    requiredTotal: missing.length + countComplete(post),
    completeCount: countComplete(post) };
}

function countComplete(post) {
  let done = 0;
  if (isStr(post?.headline)) done += 1;
  (post?.slides || []).forEach((slide) => {
    const required = slide?.role ? REQUIRED_ROLES[slide.role] !== false : true;
    if (required && isStr(slide?.body)) done += 1;
  });
  if (isStr(post?.caption)) done += 1;
  if (isStr(post?.altText)) done += 1;
  return done;
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


/* ── Manual drafting (no AI) ────────────────────────────────────────────────
   Moved in Dev Update 5.1: the scaffold now lives in language.js as
   buildScaffold(), which starts publishable-or-empty instead of worksheet
   text — authoring guidance travels in a `suggestions` object the desk
   renders as UI, never inside the copy itself. The old worksheet phrases
   ("write the symbolic layer here…") are now an audit tripwire in
   editorial.js so they can never reach a stored draft again. */