// Orbit X :: the editorial language architecture (Dev Update 5.1).
//
// CAREFUL WITHOUT BEING ROBOTIC. The boundary between astronomical fact and
// astrological tradition is structural — the fact register is built from the
// verified packet, the symbolic register is ALWAYS attributed — but the
// attribution now rotates through an approved vocabulary instead of stamping
// "astrologers traditionally associate" on every post.
//
// SCAFFOLDS START PUBLISHABLE OR EMPTY, NEVER AS WORKSHEETS. Fields that can
// be derived from verified facts arrive as finished sentences. Fields that
// need a human's judgment (the symbolic layer, the reflection) arrive EMPTY,
// with helper text and deterministic suggestions carried BESIDE the copy —
// in the `suggestions` object the desk renders as UI — so no authoring
// instruction can ever reach a stored draft, an SVG, or an export.
//
// No AI anywhere in this file. Suggestions are built from the engine's facts
// and the Symbol Atlas themes the caller passes in; deterministic selection
// varies phrasing by event key so the feed doesn't repeat itself, without a
// random number generator.

import { FORMATS, ROLE_SEQUENCES, APPROVED_CTAS, EDITORIAL_CTAS } from "./formats.js";
import { TITLE_BANKS, humanDate, badgeFor } from "./templates.js";

/* ── Approved interpretive framing (§28): rotation, not repetition ───────── */
export const FRAMING_BANK = Object.freeze([
  "In astrology, {subject} is associated with {themes}.",
  "Astrological tradition links {subject} with {themes}.",
  "Symbolically, this points toward {themes}.",
  "The traditional theme here is {themes}.",
  "One way astrologers read this movement is through {themes}.",
  "Within astrology, this can represent {themes}.",
  "This symbolism often centers on {themes}.",
  "{subject} is traditionally connected with {themes}.",
]);

/* ── Reflection prompts (§30): style examples, offered — never auto-filled
      into unrelated events, and never exported unless the editor adopts one. */
export const REFLECTION_EXAMPLES = Object.freeze([
  "What feels easier to name now?",
  "Where could less force create more movement?",
  "What deserves another look?",
  "What are you holding onto after its usefulness has passed?",
  "Where are you asking for certainty when curiosity would be enough?",
  "What has become more visible recently?",
]);

/* ── CTA classes (§43) ───────────────────────────────────────────────────── */
export const CTA_CLASSES = Object.freeze({
  product: APPROVED_CTAS.filter(Boolean),
  editorial: EDITORIAL_CTAS,
});

/** Deterministic index from a string — variation without randomness. */
export function pick(list, seed, offset = 0) {
  let h = 0;
  for (const ch of String(seed || "")) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return list[(h + offset) % list.length];
}

function themesPhrase(themes) {
  const t = (themes || []).slice(0, 3);
  if (!t.length) return null;
  if (t.length === 1) return t[0];
  return `${t.slice(0, -1).join(", ")}, and ${t[t.length - 1]}`;
}

/** One attributed symbolic sentence from trusted Atlas themes — a SUGGESTION
 *  the editor can adopt, never silently inserted into the draft itself. */
export function symbolicSuggestions(subject, themes, seed) {
  const phrase = themesPhrase(themes);
  if (!subject || !phrase) return [];
  const first = pick(FRAMING_BANK, seed).replace("{subject}", subject).replace("{themes}", phrase);
  const second = pick(FRAMING_BANK, seed, 3).replace("{subject}", subject).replace("{themes}", phrase);
  return [...new Set([first, second])];
}

/* ── Headline patterns (§29, §34): short, active, feed-first ─────────────── */
export function headlineOptions(candidate) {
  const facts = candidate?.facts || {};
  const sky = facts.sky_at_event || {};
  const t = candidate?.eventType;
  if (t === "full_moon") {
    const inSign = sky.moon_sign ? ` in ${sky.moon_sign}` : "";
    return [`Full Moon${inSign}`, "The Moon is full", `A Full Moon${inSign}`];
  }
  if (t === "new_moon") {
    const inSign = sky.moon_sign ? ` in ${sky.moon_sign}` : "";
    return [`New Moon${inSign}`, "The sky goes dark", `A New Moon${inSign}`];
  }
  if (t === "sun_ingress") {
    const sign = signFromTitle(candidate.title);
    return sign ? [`${sign} season begins`, `The Sun enters ${sign}`, `Welcome to ${sign} season`]
      : [candidate.title];
  }
  if (t === "mercury_rx") return ["Mercury stations retrograde", "Mercury turns retrograde"];
  if (t === "mercury_direct") return ["Mercury is direct", "Mercury stations direct"];
  if (t === "daily_sky") {
    return facts.moon_phase_name ? [`Today's sky — ${facts.moon_phase_name}`, "The sky, right now"]
      : ["Today's sky"];
  }
  return [candidate?.title || ""].filter(Boolean);
}

export function signFromTitle(title) {
  const SIGNS = ["Aries", "Taurus", "Gemini", "Cancer", "Leo", "Virgo", "Libra",
    "Scorpio", "Sagittarius", "Capricorn", "Aquarius", "Pisces"];
  return SIGNS.find((s) => String(title || "").includes(s)) || null;
}

/* ── The verified-fact register, phrased for people (§34, §51, §52).
      Absolute dates always; "around" whenever the source says approximate. ── */
export function factSentence(candidate) {
  const facts = candidate?.facts || {};
  const sky = facts.sky_at_event || {};
  const when = humanDate(facts.date || facts.local_date);
  const around = candidate?.approximate ? "around " : "on ";
  switch (candidate?.eventType) {
    case "full_moon":
      return `The Moon reaches full illumination ${around}${when}`
        + (sky.moon_sign ? `, in ${sky.moon_sign}` : "")
        + (sky.sun_sign ? `, directly opposite the Sun in ${sky.sun_sign}` : ", directly opposite the Sun")
        + ". Calculated to the second, not estimated.";
    case "new_moon":
      return `The Moon and Sun align ${around}${when}`
        + (sky.moon_sign ? `, in ${sky.moon_sign}` : "")
        + ". The lunar cycle restarts — a dark sky, by calculation.";
    case "sun_ingress": {
      const sign = signFromTitle(candidate.title);
      return sign ? `The Sun enters ${sign} ${around}${when}. A new zodiac season begins — the same instant everywhere on Earth.`
        : `${candidate.title} ${around}${when}.`;
    }
    case "mercury_rx":
      return `Mercury stations retrograde ${around}${when}. Apparent backwards motion from Earth's frame — the planet never actually reverses.`;
    case "mercury_direct":
      return `Mercury stations direct ${around}${when}. The apparent backwards motion ends.`;
    case "daily_sky": {
      const bits = [];
      if (facts.moon_phase_name) bits.push(`${facts.moon_phase_name} today`);
      if (Number.isFinite(facts.illumination_percent)) {
        bits.push(`the Moon is ${Math.round(facts.illumination_percent)}% illuminated and ${facts.is_waxing ? "waxing" : "waning"}`);
      }
      if (facts.next_full_moon) bits.push(`next Full Moon ${humanDate(facts.next_full_moon)}`);
      return bits.length ? `${bits.join(" — ")}.` : "Today's positions, calculated from the ephemeris.";
    }
    case "educational":
      return facts.ground || "";
    default:
      return "";
  }
}

/* ── Alt text (§53): describes the actual graphic, not the symbolism ─────── */
export function altTextFor(candidate, headline, design = {}) {
  const facts = candidate?.facts || {};
  const when = humanDate(facts.date || facts.local_date);
  const visual = candidate?.eventType === "full_moon" ? "a bright full Moon disc"
    : candidate?.eventType === "new_moon" ? "a dark new Moon disc with a thin rim"
    : candidate?.eventType === "daily_sky" ? "a Moon phase disc and a grid of planet positions"
    : candidate?.eventType === "sun_ingress" ? "a Sun glyph moving toward a zodiac sign glyph"
    : ["mercury_rx", "mercury_direct"].includes(candidate?.eventType) ? "a Mercury glyph with a station marker"
    : "the Orbit Axis line motif";
  return `Orbit Axis carousel slide titled "${headline}", showing ${visual}`
    + (when ? `, the date ${when},` : "") + ` and dark navy Orbit Axis branding.`;
}

/* ── The scaffold (§32–§34): publishable or empty, never a worksheet ─────── */

const HELPERS = Object.freeze({
  hero: "The feed stop. Headline plus one short line at most — no paragraphs on slide one.",
  fact: "The calculated fact, stated plainly. This copy started from the engine packet — edit freely, but keep dates as the facts state them.",
  symbolic: "Explain the traditional association in 1–2 sentences. Keep it interpretive, not predictive — attributed to tradition, never stated as fate.",
  reflection: "One open question. Specific enough to be interesting; never predictive, never a diagnosis.",
  cta: "Optional. Only capabilities that exist. Delete the text to end on the final idea instead.",
  signal: "Today's notable movements, briefly. The instrument panel, opened — not one deterministic statement about everyone's day.",
  explain: "One idea per slide, plain English. Diagrams beat adjectives.",
  takeaway: "The concise landing: what the reader can carry away.",
  the_sky: "The collective positions — what everyone shares.",
  your_sky: "Why a natal chart changes the relationship to those positions. No private user data, ever.",
  method: "How the calculation actually works. Approachable, technical, honest.",
});

const PLACEHOLDERS = Object.freeze({
  symbolic: "How is this event traditionally understood?",
  reflection: "What question does this moment open?",
  signal: "What stands out in today's sky?",
  explain: "Explain one idea, simply.",
  takeaway: "What should the reader keep?",
  the_sky: "What is the shared sky doing?",
  your_sky: "What changes when a chart enters the picture?",
  method: "What does the instrument actually do?",
});

/**
 * Build the manual draft: a post whose derived fields are publishable and
 * whose interpretive fields are empty, plus the suggestion kit the desk
 * renders as helpers, placeholders, and one-tap inserts.
 *
 * @param {object} candidate  verified, engine-built
 * @param {string} formatId
 * @param {object} extras     { themes: { subject, list } } from the Symbol
 *                            Atlas via the server — trusted knowledge only.
 */
export function buildScaffold(candidate, formatId, { themes = null } = {}) {
  const format = FORMATS[formatId];
  if (!format) throw new Error(`unknown format "${formatId}"`);
  const roles = ROLE_SEQUENCES[formatId] || ["hero", "explain", "takeaway"];
  const seed = candidate.eventKey;
  const headline = headlineOptions(candidate)[0]?.slice(0, format.limits.headline) || candidate.title;
  const fact = factSentence(candidate);
  const badge = badgeFor(candidate.eventType, candidate.facts);
  const when = humanDate(candidate.facts?.date || candidate.facts?.local_date);

  const slides = roles.map((role) => {
    if (role === "hero") return { role, heading: headline, body: "" };
    if (role === "fact") return { role, heading: pick(TITLE_BANKS.fact, seed), body: fact };
    if (role === "signal") return { role, heading: pick(TITLE_BANKS.fact, seed, 5), body: fact };
    if (role === "symbolic") return { role, heading: pick(TITLE_BANKS.symbolic, seed), body: "" };
    if (role === "reflection") return { role, heading: pick(TITLE_BANKS.reflection, seed), body: "" };
    if (role === "cta") return { role, heading: "Orbit Axis", body: pick(CTA_CLASSES.product, seed) };
    if (role === "the_sky") return { role, heading: "The sky everyone shares", body: "" };
    if (role === "your_sky") return { role, heading: "The sky, through your chart", body: "" };
    if (role === "method" || role === "explain" || role === "takeaway") {
      return { role, heading: role === "takeaway" ? pick(TITLE_BANKS.reflection, seed, 1) : pick(TITLE_BANKS.fact, seed, roles.indexOf(role)),
        body: role === "explain" && fact && roles.indexOf(role) === roles.findIndex((r) => r === "explain") ? fact : "" };
    }
    return { role, heading: "", body: "" };
  });

  // Caption: hook + short factual context prefilled; the interpretive close
  // is the editor's. A compact fact variant so the caption never mirrors the
  // slide verbatim.
  const captionFact = candidate.eventType === "educational" ? fact
    : [badge, when].filter(Boolean).join(", ") + (fact ? ` — calculated by the Orbit Axis engine.` : "");
  const caption = `${headline}.\n\n${captionFact}`.trim();

  const post = {
    format: formatId,
    headline,
    subhead: "",
    slides,
    caption,
    cta: slides.some((s) => s.role === "cta") ? slides.find((s) => s.role === "cta").body : "",
    altText: altTextFor(candidate, headline),
    editorialNotes: ["manual draft"],
  };

  const suggestions = {
    headline: headlineOptions(candidate),
    slides: slides.map((s) => ({
      role: s.role,
      helper: HELPERS[s.role] || "",
      placeholder: PLACEHOLDERS[s.role] || "",
      suggestions: s.role === "symbolic" && themes
        ? symbolicSuggestions(themes.subject, themes.list, seed)
        : s.role === "reflection" || s.role === "takeaway"
          ? REFLECTION_EXAMPLES.slice(0, 3).map((r) => `${r}`)
          : [],
      styleExamples: s.role === "reflection" || s.role === "takeaway",
    })),
    caption: {
      helper: "Hook, short fact, symbolic context, reflection, optional CTA. Skimmable — paragraph breaks, no hashtag dumps.",
    },
    cta: CTA_CLASSES,
  };

  return { post, suggestions };
}
