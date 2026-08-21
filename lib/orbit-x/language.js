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
import { TITLE_BANKS, humanDate, badgeFor, recommendTemplate } from "./templates.js";

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


/* ── The hook line (Dev Update 5.4) ─────────────────────────────────────────
   Retention on a carousel is decided between slide 1 and slide 2. A hero that
   only NAMES the post ("Full Moon in Pisces, August 27") is complete — it owes
   the reader nothing, so there is no reason to swipe. A hook line opens a
   loop the next slide closes.

   The honest form of an open loop is a COUNT, not a tease. "Three movements
   this week" promises exactly what slide 2 delivers and is checkable against
   the packet; "You won't believe what's coming" promises nothing and is
   forbidden by the constitution anyway. Every option below is derived from
   verified facts — the number of selected events, the sign the engine
   calculated, the phase — so a hook can never claim more than the sky did. */

const COUNT_WORDS = Object.freeze(["no", "one", "two", "three", "four", "five",
  "six", "seven", "eight", "nine", "ten"]);

/** Spell small numbers; a numeral at the start of a line reads as a list. */
export function countWord(n) {
  return Number.isInteger(n) && n >= 0 && n < COUNT_WORDS.length ? COUNT_WORDS[n] : String(n);
}

const capitalize = (t) => (t ? t[0].toUpperCase() + t.slice(1) : t);

/**
 * Deterministic hook options for one candidate — offered, never auto-filled.
 * @returns {string[]} zero or more one-line open loops, packet-derived.
 */
export function hookOptions(candidate) {
  const facts = candidate?.facts || {};
  const sky = facts.sky_at_event || {};
  const type = candidate?.eventType;
  const out = [];

  if (type === "collective_reading") {
    const events = Array.isArray(facts.selected_events) ? facts.selected_events : [];
    const n = events.length;
    const window = { daily: "today", weekly: "this week", monthly: "this month" }[candidate.readingType] || "ahead";
    if (n > 0) {
      out.push(`${capitalize(countWord(n))} ${n === 1 ? "movement" : "movements"} ${window}.`);
      out.push(`${capitalize(countWord(n))} ${n === 1 ? "date" : "dates"} worth knowing ${window}.`);
    }
    // A quiet sky is a real answer and makes an unusually good hook, because
    // it is the opposite of what this genre normally claims.
    if (n === 0) out.push(`A quiet sky ${window} — and that is the reading.`);
    if (facts.moon_phase_name && facts.moon_sign) {
      out.push(`The Moon starts ${window} ${facts.moon_phase_name.toLowerCase()} in ${facts.moon_sign}.`);
    }
    return out.slice(0, 3);
  }

  if (type === "full_moon" || type === "new_moon") {
    const moonSign = sky.moon_sign;
    const sunSign = sky.sun_sign;
    if (moonSign && sunSign && type === "full_moon") {
      // The opposition IS the astronomy of a full moon, and stating it as a
      // relationship rather than a label is the loop: it invites "why".
      out.push(`Full in ${moonSign}, opposite the Sun in ${sunSign}.`);
    }
    if (moonSign && type === "new_moon") {
      out.push(`The Moon goes dark in ${moonSign}, beside the Sun.`);
    }
    if (facts.instant_utc && !facts.approximate) {
      out.push(`One instant, calculated to the second.`);
    }
    out.push(type === "full_moon"
      ? "The one night a month the Moon hides nothing."
      : "The darkest sky of the month, by calculation.");
    return out.slice(0, 3);
  }

  return out;
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
  hero: "The feed stop. The headline names it; this HOOK LINE is what earns the swipe — one short line that opens a loop slide 2 closes. Optional, but a hero without one asks nothing of the reader.",
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
  cover: "Write one strong central theme. This is both the cover and the first hook.",
  one_sentence: "The thesis of the reading, separate from the cover theme. Keep it immediately understandable.",
  movements: "The small number of verified movements that matter today. Plain language first.",
  opening: "The most editorially relevant movement near the beginning of the period.",
  movement: "The strongest verified early-period change. Leave this section out if the sky does not support it.",
  pivot: "A verified turning point. Optional when there is no meaningful pivot.",
  landing: "Where the later-week sky lands. Select; do not list everything.",
  later: "How the second half changes the tone, grounded in the selected verified movements.",
  reading: "Synthesize the selected facts into one collective symbolic thread. Do not predict individual outcomes.",
  evidence: "Calculated detail belongs here: Moon, positions, selected timing, or a compact Current Sky view.",
  key_dates: "A curated date register, not a full ephemeris.",
  close: "Optional concise Orbit invitation or useful summary.",
});

const PLACEHOLDERS = Object.freeze({
  hero: "One line that makes slide 2 worth reaching.",
  symbolic: "How is this event traditionally understood?",
  reflection: "What question does this moment open?",
  signal: "What stands out in today's sky?",
  explain: "Explain one idea, simply.",
  takeaway: "What should the reader keep?",
  the_sky: "What is the shared sky doing?",
  your_sky: "What changes when a chart enters the picture?",
  method: "What does the instrument actually do?",
  cover: "What is the central theme?",
  one_sentence: "What is the reading's one-sentence thesis?",
  reading: "What symbolic thread connects the verified movements?",
  reflection: "What specific question follows from this reading?",
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
      suggestions: s.role === "hero" ? hookOptions(candidate)
        : s.role === "symbolic" && themes
          ? symbolicSuggestions(themes.subject, themes.list, seed)
          : s.role === "reflection" || s.role === "takeaway"
            ? REFLECTION_EXAMPLES.slice(0, 3).map((r) => `${r}`)
            : [],
      // Hook options are packet-derived and safe to adopt verbatim; reflection
      // prompts are STYLE examples and must be adapted to the event.
      styleExamples: s.role === "reflection" || s.role === "takeaway",
    })),
    caption: {
      helper: "Hook, short fact, symbolic context, reflection, optional CTA. Skimmable — paragraph breaks, no hashtag dumps.",
    },
    cta: CTA_CLASSES,
  };

  return { post, suggestions };
}

function selectedEvents(candidate) {
  return Array.isArray(candidate?.facts?.selected_events) ? candidate.facts.selected_events : [];
}

function eventLine(event) {
  if (!event) return "";
  const precision = event.approximate ? "Around " : "";
  return `${precision}${humanDate(event.date)} · ${event.title}`;
}

function eventGroup(events) {
  return events.filter(Boolean).map(eventLine).join("\n");
}

function skyEvidence(candidate) {
  const facts = candidate?.facts || {};
  const lines = [];
  if (facts.moon_phase_name) {
    const detail = [facts.moon_phase_name, facts.moon_sign ? `Moon in ${facts.moon_sign}` : "",
      Number.isFinite(facts.illumination_percent) ? `${Math.round(facts.illumination_percent)}% illuminated` : ""]
      .filter(Boolean).join(" · ");
    lines.push(detail);
  }
  for (const body of (facts.planets || []).slice(0, 5)) lines.push(`${body.name} · ${body.sign}${body.retrograde ? " · retrograde" : ""}`);
  return lines.join("\n");
}

/**
 * Manual collective-reading scaffold. Astronomical registers are populated
 * from the candidate; every symbolic/editorial judgment stays empty. Helper
 * copy is returned beside the post and can never leak into an export.
 */
export function buildReadingScaffold(candidate, formatId) {
  const format = FORMATS[formatId];
  const period = candidate?.facts?.period;
  if (!format?.readingType || candidate?.readingType !== format.readingType || !period) {
    throw new Error("collective reading candidate does not match format");
  }
  const roles = ROLE_SEQUENCES[formatId];
  const events = selectedEvents(candidate);
  const thirds = {
    opening: events[0] ? [events[0]] : [],
    movement: events[0] ? [events[0]] : [],
    pivot: events.length > 2 ? [events[Math.floor(events.length / 2)]] : [],
    landing: events.length > 1 ? [events[events.length - 1]] : [],
    later: events.length > 1 ? events.slice(Math.ceil(events.length / 2)) : [],
  };
  const headings = {
    cover: `${format.readingType.toUpperCase()} READING`,
    one_sentence: format.readingType === "daily" ? "Today in one sentence"
      : format.readingType === "weekly" ? "The week in one sentence" : "The month in one sentence",
    movements: "What's moving",
    opening: format.readingType === "weekly" ? "Opening tone" : "How the month opens",
    movement: "First major movement",
    pivot: "The turning point",
    landing: "Where the week lands",
    later: "The second half",
    reading: "The reading",
    reflection: "Carry this with you",
    key_dates: "Key dates",
    evidence: "Sky behind the reading",
    close: "Orbit Axis",
  };
  const slides = roles.map((role) => {
    let body = "";
    if (role === "movements") body = eventGroup(events.slice(0, 3)) || skyEvidence(candidate).split("\n").slice(0, 2).join("\n");
    else if (["opening", "movement", "pivot", "landing", "later"].includes(role)) body = eventGroup(thirds[role]);
    else if (role === "key_dates") body = eventGroup(events.slice(0, 5));
    else if (role === "evidence") body = skyEvidence(candidate);
    return { role, heading: headings[role] || role, body };
  });
  const post = {
    format: formatId,
    headline: "",
    subhead: period.label,
    reading: {
      type: format.readingType,
      periodKey: period.key,
      periodLabel: period.label,
      theme: "",
      oneSentence: "",
      selectedEventKeys: events.map((event) => event.key),
    },
    slides,
    caption: "",
    cta: "",
    altText: `Orbit Axis ${format.name} carousel for ${period.label}, using a calculated Moon graphic, celestial glyphs, editorial copy, and a late-carousel Current Sky register.`,
    editorialNotes: ["manual collective reading", "symbolic copy is editorial; astronomical facts are engine output"],
    design: { aspect: "portrait", template: recommendTemplate(candidate.eventType, formatId), density: "standard" },
  };
  const suggestions = {
    headline: [],
    slides: slides.map((slide) => ({
      role: slide.role,
      helper: HELPERS[slide.role] || "",
      placeholder: PLACEHOLDERS[slide.role] || "",
      suggestions: ["hero", "cover"].includes(slide.role) ? hookOptions(candidate)
        : slide.role === "reflection" ? REFLECTION_EXAMPLES.slice(0, 3) : [],
      styleExamples: slide.role === "reflection",
    })),
    caption: { helper: "Write a standalone social caption. Keep calculated facts distinct from editorial symbolism." },
    cta: CTA_CLASSES,
  };
  return { post, suggestions };
}
