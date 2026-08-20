// Orbit X :: the editorial constitution and its deterministic audit (Dev Update 5.0).
//
// TWO LAYERS, HONESTLY LABELLED. The constitution below travels in the AI
// system prompt — it is instruction. The audit underneath is enforcement: a
// deterministic scan that refuses representative violations regardless of
// what the model was told. Regex alone cannot moderate natural language, and
// this does not pretend to; it is a tripwire for the *worst* failure shapes
// (deterministic prediction, medical/financial/legal advice, fear bait) while
// schema validation, the fact-integrity check, and the human review step
// carry the rest. Layered, like the fortune engine's audit before it.

export const CONSTITUTION = `You write social copy for Orbit Axis, an astrology app whose astronomy is calculated, not generated.

FACTUAL AUTHORITY — absolute:
- Every astronomical fact comes from the "facts" object you are given. You never calculate positions, invent an ingress or aspect, change a timestamp or sign, or claim any event not present in the input.
- If a fact you want is missing, omit it or say it is unavailable. Never fill the gap.
- If the facts are marked approximate, say "around" the date; never state a precise instant.

FRAMING — astrology is symbolic reflection:
- Allowed: "may symbolize", "astrologers associate", "traditionally associated with", "can invite reflection on", "one way to consider this", "notice whether".
- Forbidden: "this will happen", "you are going to", "your relationship/money will", "this guarantees", "the universe is telling you", "this transit causes".

NEVER: medical, financial, or legal advice; diagnosis; investment guidance; relationship ultimatums; certain future outcomes; catastrophe or doom framing; fake urgency or scarcity; "you need to see this"; "this changes everything"; engagement bait of any shape. Do not make astrology more extreme to make it more clickable.

VOICE: measured, clear, curious, intelligent, contemporary, accessible, slightly atmospheric. The brand narrates — never a fake human persona, never "hey guys". No emoji strings, no horoscope clichés, no jargon walls, no condescension.

STRUCTURE: respond with ONLY the JSON object requested — no markdown fences, no commentary. Keep the three registers separate as instructed: the calculated fact stated plainly, the symbolic association clearly attributed to tradition, the reflection as an open question.`;

/** The tripwires. Each entry names why it refuses, for the UI and the tests. */
export const AUDIT_RULES = Object.freeze([
  { id: "deterministic_prediction",
    pattern: /\b(?:this )?(?:will|is going to) (?:happen|change your|bring you|make you|transform)\b|\byou (?:will|are going to) (?:meet|find|lose|receive|feel)\b/i,
    why: "states an outcome as certain" },
  { id: "causal_transit", pattern: /\btransit (?:causes|will cause|forces)\b|\bcauses? (?:your|you to)\b/i,
    why: "claims astrological causation" },
  { id: "medical", pattern: /\b(?:diagnos\w+|cure[sd]?\b|your (?:health|illness) will|stop taking|medication should)\b/i,
    why: "medical advice" },
  { id: "financial", pattern: /\b(?:invest(?:ing)? (?:in|now)|buy (?:stocks|crypto)|financial windfall is coming|your money will)\b/i,
    why: "financial advice" },
  { id: "legal", pattern: /\b(?:you should sue|legal advice|sign the contract now)\b/i,
    why: "legal advice" },
  { id: "fear_bait",
    pattern: /\b(?:you need to see this|this changes everything|your life is about to|the universe has a warning|in danger this (?:week|month)|brace yourself)\b/i,
    why: "fear or urgency bait" },
  { id: "fake_scarcity", pattern: /\b(?:last chance|act now|before it'?s too late|only \d+ (?:hours|days) left)\b/i,
    why: "manufactured urgency" },
  { id: "persona", pattern: /\bhey guys\b|\bI noticed\b|\bI've been feeling\b/i,
    why: "fake human persona — the brand narrates" },
  // Dev Update 5.1: worksheet language can never reach a stored draft again.
  // The old scaffold carried authoring instructions inside the copy; the new
  // one carries them in UI-only suggestions, and this tripwire guarantees the
  // regression is impossible rather than merely unlikely.
  { id: "worksheet", pattern: /\b(?:write th(?:e|is) (?:slide|symbolic layer|reflection)|edit this slide|edit before approving|write an open reflection|edit me\b|write this slide)\b/i,
    why: "authoring instruction left in the copy — this is scaffold text, not content" },
]);

/**
 * Scan every text field of a generated post. Returns findings, empty = clean.
 * Deterministic and format-agnostic; run BEFORE any draft is stored.
 */
export function auditCopy(post) {
  const findings = [];
  const texts = collectTexts(post);
  for (const { path, text } of texts) {
    for (const rule of AUDIT_RULES) {
      if (rule.pattern.test(text)) findings.push({ path, rule: rule.id, why: rule.why });
    }
  }
  return findings;
}

function collectTexts(post, prefix = "", out = []) {
  if (post == null) return out;
  if (typeof post === "string") { out.push({ path: prefix || ".", text: post }); return out; }
  if (Array.isArray(post)) { post.forEach((v, i) => collectTexts(v, `${prefix}[${i}]`, out)); return out; }
  if (typeof post === "object") {
    for (const [key, value] of Object.entries(post)) collectTexts(value, prefix ? `${prefix}.${key}` : key, out);
  }
  return out;
}

/* ── Social-copy advisories (Dev Update 5.1, §36) ───────────────────────────
   Warnings, not blockers: copy that satisfies schema and audit but publishes
   poorly. The desk shows these beside the draft; nothing here refuses a save,
   because "too academic" is an editorial judgment, not a safety violation.
   No engagement scoring masquerading as truth — every advisory names a rule
   a person can read. */

const GENERIC_REFLECTIONS = /\bwhat does this mean for you\b|\bhow does this make you feel\b|\bthink about it\b/i;
const RELATIVE_TIME = /\b(?:tonight|tomorrow|this week(?:end)?|later today)\b/i;

export function adviseCopy(post) {
  const advisories = [];
  const head = String(post?.headline || "");
  if (head.length > 40) {
    advisories.push({ path: "headline", rule: "headline_long", why: "over 40 characters reads small in the feed — the factual slide can hold the precision" });
  }
  const slides = post?.slides || [];
  const bodies = slides.map((s) => String(s?.body || "").trim()).filter(Boolean);
  const seen = new Map();
  bodies.forEach((body, i) => {
    for (const sentence of body.split(/(?<=[.!?])\s+/)) {
      const key = sentence.toLowerCase().trim();
      if (key.length < 25) continue;
      if (seen.has(key) && seen.get(key) !== i) {
        advisories.push({ path: `slides[${i}]`, rule: "duplicate_sentence", why: "repeats a sentence from another slide" });
        break;
      }
      seen.set(key, i);
    }
  });
  const traditionally = collectTexts(post).filter(({ text }) => /astrologers traditionally associate/i.test(text)).length;
  if (traditionally > 1) {
    advisories.push({ path: ".", rule: "repetitive_framing", why: `"astrologers traditionally associate" appears ${traditionally} times — rotate the approved framings` });
  }
  const caption = String(post?.caption || "").trim();
  if (caption.length > 60) {
    for (let i = 0; i < bodies.length; i += 1) {
      if (bodies[i].length > 60 && caption.includes(bodies[i])) {
        advisories.push({ path: "caption", rule: "caption_mirrors_slides", why: `caption repeats slide ${i + 1} verbatim — the caption is its own read` });
        break;
      }
    }
  }
  for (const { path, text } of collectTexts(post)) {
    if (GENERIC_REFLECTIONS.test(text)) {
      advisories.push({ path, rule: "generic_reflection", why: "reflection is generic — make it specific enough to be interesting" });
    }
    if (RELATIVE_TIME.test(text)) {
      advisories.push({ path, rule: "relative_time", why: "relative timing ('tonight', 'tomorrow') depends on when this is published — prefer the absolute date" });
    }
  }
  const cta = String(post?.cta || "");
  if (cta.length > 60) advisories.push({ path: "cta", rule: "cta_long", why: "CTA runs long — one short invitation" });
  return advisories;
}

/**
 * FACT INTEGRITY: generated copy may only reference dates/instants the packet
 * supplied. A timestamp in the copy that appears nowhere in the facts is the
 * model inventing astronomy, and the draft is refused whole.
 */
export function verifyFactIntegrity(post, facts) {
  const factText = JSON.stringify(facts || {});
  const findings = [];
  for (const { path, text } of collectTexts(post)) {
    for (const iso of text.matchAll(/\b(\d{4}-\d{2}-\d{2})(?:T[0-9:.]+Z?)?\b/g)) {
      if (!factText.includes(iso[1])) {
        findings.push({ path, rule: "invented_timestamp", why: `date ${iso[1]} appears in no supplied fact` });
      }
    }
  }
  return findings;
}
