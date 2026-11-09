// Orbit X :: the post-type registry (Dev Update 6.1).
//
// APPROVE ONCE, THEN ROTATE. A post type is a versioned, declarative design:
// one of the five visual families, the formats it may carry, a constrained
// design object, at most one motif from the closed library in templates.js,
// and the hook and caption structures its copy may use. The founder approves a type
// once in the desk; after that the channel may post with it without asking
// per post. A rejected type never posts.
//
// AN APPROVAL BINDS TO WHAT WAS SEEN, NOT TO A NAME. Two hashes pin it:
//
//   spec_hash          the canonical spec itself. Any edit to an approved type
//                      is a different hash, so it is a NEW VERSION that lands
//                      as `proposed` and needs approval again.
//   render_fingerprint the SVG the renderer draws for a fixed, engine-shaped
//                      fixture in every format the type claims. If the
//                      renderer changes underneath an approved type, the
//                      fingerprint moves, the old version is superseded, and
//                      the new rendering waits for approval like anything new.
//
// Nothing here can describe a Red format: CHANNEL_FORMATS holds only Green and
// Yellow formats, and the validator refuses anything else. Approving a type
// never approves content either; every post still runs the per-post checks in
// policy.js, and Red content is refused there whatever type carries it.
//
// THE VOCABULARY IS CLOSED. An AI-proposed type (design-proposals.js) is JSON
// validated against these lists; unknown keys and values are refused, never
// coerced. No model ever writes SVG, colours, or coordinates.

import { createHash } from "node:crypto";
import { FORMATS } from "./formats.js";
import {
  TEMPLATES, TEMPLATE_FAMILY_IDS, DENSITIES, LOGO_POSITIONS, HEADLINE_ALIGNMENTS,
  MOTIF_KINDS, MOTIF_TONES, MOTIF_PLACEMENTS, MOTIF_INTENSITIES, normalizeDesign, renderPost,
} from "./templates.js";
import { buildScaffold, buildReadingScaffold } from "./language.js";
import { calculateReadingPeriod, buildReadingCandidate } from "./readings.js";
import { buildCandidates } from "./candidates.js";
import { validateGeneratedPost } from "./schemas.js";
import { postCollisions } from "./layout-check.js";

/** The formats the channel may ever carry. Green and Yellow only, and only
 *  formats the channel has a candidate source for (daily_signal's daily_sky
 *  candidate was retired in Dev Update 5.3). Red formats do not exist; if one
 *  is ever added to FORMATS it is not on this list, and a test holds that. */
export const CHANNEL_FORMATS = Object.freeze([
  "daily_reading", "weekly_reading", "monthly_reading",
  "something_changed", "calculated_not_invented",
  "without_the_fog", "your_sky",
]);

export const READING_FORMAT_IDS = Object.freeze(CHANNEL_FORMATS.filter((id) => FORMATS[id]?.readingType));

/** Which templates a post type may be built on, and what each may carry.
 *
 * Measured, not assumed (Dev Update 6.1 contact sheets): the five visual
 * families were founder-reviewed for READINGS, and on the other formats they
 * collide (Orbit Signal's band covers the fact label, Celestial Editorial's
 * vertical "THE SHARED SKY" runs into the footer metadata). The 5.1 event
 * templates were designed for one format each and render it cleanly. So a
 * family carries readings only, and an event template carries its own format
 * only. Both rules are enforced on every spec, built-in or AI-proposed. */
export const TEMPLATE_FORMATS = Object.freeze({
  ...Object.fromEntries(TEMPLATE_FAMILY_IDS.map((id) => [id, READING_FORMAT_IDS])),
  lunar_hero: Object.freeze(["something_changed"]),
  instrument: Object.freeze(["calculated_not_invented"]),
  fog_panel: Object.freeze(["without_the_fog"]),
  sky_contrast: Object.freeze(["your_sky"]),
});
export const POST_TYPE_TEMPLATES = Object.freeze(Object.keys(TEMPLATE_FORMATS));

/** Renderer version of a template. The 5.1 event templates predate the
 *  version field and are their first version. */
export function templateVersion(id) {
  return TEMPLATES[id]?.version || "v1";
}

/** How slide one opens. Quoted to the writer as an instruction; never copy. */
export const HOOK_STYLES = Object.freeze({
  quiet_observation: "Slide 1 opens with one calm, concrete observation about the calculated sky.",
  open_question: "Slide 1 opens with one short, genuine question that the carousel goes on to answer.",
  plain_fact: "Slide 1 opens with the single most striking calculated fact, stated plainly.",
  contrast: "Slide 1 opens with a contrast: a common assumption set against what the calculation actually shows.",
  invitation: "Slide 1 opens with an unhurried invitation to notice something.",
});

/** How the caption is built. Also an instruction, never copy. */
export const CAPTION_STRUCTURES = Object.freeze({
  three_beats: "Three short paragraphs: the calculated fact; the symbolic association, attributed to tradition; one open reflective question.",
  short_note: "One compact paragraph of two or three sentences.",
  fact_then_question: "One sentence of calculated fact, a blank line, then one open question.",
  key_dates: "One framing sentence, then the dates that appear in the facts as a short plain list, one per line.",
  slow_read: "Two paragraphs: what the sky is doing, then how astrologers have traditionally read it. End without a question.",
});

export const TYPE_STATUSES = Object.freeze(["proposed", "approved", "rejected", "superseded", "retired"]);

/** Which status changes the desk may make. A rejected type is final: trying
 *  again is a new proposal and a new version, never a resurrection. */
export const TYPE_TRANSITIONS = Object.freeze({
  proposed: Object.freeze(["approved", "rejected"]),
  approved: Object.freeze(["retired", "rejected"]),
  rejected: Object.freeze([]),
  superseded: Object.freeze([]),
  retired: Object.freeze(["approved"]),
});

const SPEC_KEYS = Object.freeze(["family", "familyVersion", "formats", "aspect", "design", "motif", "voice"]);
const DESIGN_KEYS = Object.freeze(["density", "variant", "headlineAlignment", "logoPosition", "visuals", "metadata"]);
const VISUAL_KEYS = Object.freeze(["moon", "strip", "diagram"]);
const META_KEYS = Object.freeze(["date", "time", "sign", "illumination", "retro", "calculated"]);
const TYPE_KEY = /^[a-z][a-z0-9_]{2,31}(?:\.[a-z][a-z0-9_]{1,23})?$/;

const plainObject = (v) => Boolean(v) && typeof v === "object" && !Array.isArray(v);

/**
 * Validate a spec against the closed vocabulary.
 *
 * `allowRetiredFamilyVersion` lets the registry READ a stored spec whose
 * family has since moved to a new renderer version, so it can be superseded;
 * nothing new may be proposed against a retired version.
 *
 * @returns {{ ok: boolean, spec: object|null, problems: string[] }}
 */
export function validatePostTypeSpec(raw, { allowRetiredFamilyVersion = false } = {}) {
  const problems = [];
  if (!plainObject(raw)) return { ok: false, spec: null, problems: ["spec is not an object"] };
  for (const key of Object.keys(raw)) if (!SPEC_KEYS.includes(key)) problems.push(`unknown spec key "${key}"`);

  const family = POST_TYPE_TEMPLATES.includes(raw.family) ? raw.family : null;
  if (!family) problems.push(`family "${raw.family}" is not one of ${POST_TYPE_TEMPLATES.join(", ")}`);
  else if (raw.familyVersion !== templateVersion(family) && !allowRetiredFamilyVersion) {
    problems.push(`family version "${raw.familyVersion}" is not the current ${family}/${templateVersion(family)}`);
  }

  const formats = Array.isArray(raw.formats) ? [...new Set(raw.formats)] : [];
  if (!formats.length) problems.push("formats must list at least one channel format");
  for (const id of formats) {
    if (!CHANNEL_FORMATS.includes(id)) problems.push(`format "${id}" is not a channel format`);
    else if (family && !TEMPLATE_FORMATS[family].includes(id)) {
      problems.push(`${family} is not designed for ${id} (it carries ${TEMPLATE_FORMATS[family].join(", ")})`);
    }
  }

  if (!["portrait", "square"].includes(raw.aspect)) problems.push(`aspect "${raw.aspect}" is not portrait or square`);
  if (raw.aspect === "square" && formats.some((id) => READING_FORMAT_IDS.includes(id))) {
    problems.push("readings are designed portrait; a square type cannot carry them");
  }

  const d = raw.design;
  if (!plainObject(d)) problems.push("design is required");
  else {
    for (const key of Object.keys(d)) if (!DESIGN_KEYS.includes(key)) problems.push(`unknown design key "${key}"`);
    if (!DENSITIES[d.density]) problems.push(`density "${d.density}" is unknown`);
    const variants = family ? TEMPLATES[family].variants || 1 : 1;
    if (!Number.isInteger(d.variant) || d.variant < 0 || d.variant >= variants) {
      problems.push(`variant must be an integer from 0 to ${variants - 1}`);
    }
    if (!HEADLINE_ALIGNMENTS[d.headlineAlignment]) problems.push(`headline alignment "${d.headlineAlignment}" is unknown`);
    if (!LOGO_POSITIONS[d.logoPosition]) problems.push(`logo position "${d.logoPosition}" is unknown`);
    // Fact, method and explainer slides draw a metadata line along the footer;
    // a footer logo sits on top of it. Measured, not a taste call.
    else if (d.logoPosition !== "upper_corner" && formats.some((id) => !READING_FORMAT_IDS.includes(id))) {
      problems.push("a type carrying a non-reading format must place the logo in the upper corner");
    }
    if (!plainObject(d.visuals)) problems.push("design.visuals is required");
    else {
      for (const [k, v] of Object.entries(d.visuals)) {
        if (!VISUAL_KEYS.includes(k) || typeof v !== "boolean") problems.push(`design.visuals.${k} is not a known boolean toggle`);
      }
      // A type with every celestial visual off is a wall of type: the
      // retention advisory warns a human about that; a type cannot bake it in.
      if (!VISUAL_KEYS.some((k) => d.visuals[k] !== false)) problems.push("at least one celestial visual must stay on");
    }
    if (!plainObject(d.metadata)) problems.push("design.metadata is required");
    else {
      for (const [k, v] of Object.entries(d.metadata)) {
        if (!META_KEYS.includes(k) || typeof v !== "boolean") problems.push(`design.metadata.${k} is not a known boolean toggle`);
      }
      // The "calculated" label is a statement about where the facts came
      // from. A type may not switch it off.
      if (d.metadata.calculated === false) problems.push("the calculated label cannot be switched off");
    }
  }

  let motif = null;
  if (raw.motif !== null && raw.motif !== undefined) {
    if (!plainObject(raw.motif)) problems.push("motif must be an object or null");
    else {
      for (const key of Object.keys(raw.motif)) {
        if (!["kind", "tone", "placement", "intensity"].includes(key)) problems.push(`unknown motif key "${key}"`);
      }
      if (!MOTIF_KINDS[raw.motif.kind]) problems.push(`motif kind "${raw.motif.kind}" is unknown`);
      if (!MOTIF_TONES[raw.motif.tone]) problems.push(`motif tone "${raw.motif.tone}" is not a brand token`);
      if (!MOTIF_PLACEMENTS.includes(raw.motif.placement)) problems.push(`motif placement "${raw.motif.placement}" is unknown`);
      if (!MOTIF_INTENSITIES[raw.motif.intensity]) problems.push(`motif intensity "${raw.motif.intensity}" is unknown`);
      motif = { kind: raw.motif.kind, tone: raw.motif.tone, placement: raw.motif.placement, intensity: raw.motif.intensity };
    }
  }

  const v = raw.voice;
  let voice = null;
  if (!plainObject(v)) problems.push("voice is required");
  else {
    for (const key of Object.keys(v)) if (!["hookStyles", "captionStructures"].includes(key)) problems.push(`unknown voice key "${key}"`);
    const hooks = Array.isArray(v.hookStyles) ? [...new Set(v.hookStyles)] : [];
    const captions = Array.isArray(v.captionStructures) ? [...new Set(v.captionStructures)] : [];
    if (!hooks.length) problems.push("voice.hookStyles must list at least one hook style");
    if (!captions.length) problems.push("voice.captionStructures must list at least one caption structure");
    for (const h of hooks) if (!HOOK_STYLES[h]) problems.push(`hook style "${h}" is unknown`);
    for (const c of captions) if (!CAPTION_STRUCTURES[c]) problems.push(`caption structure "${c}" is unknown`);
    voice = { hookStyles: hooks, captionStructures: captions };
  }

  if (problems.length) return { ok: false, spec: null, problems };
  const spec = canonicalSpec({
    family, familyVersion: raw.familyVersion, formats, aspect: raw.aspect,
    design: {
      density: d.density, variant: d.variant, headlineAlignment: d.headlineAlignment, logoPosition: d.logoPosition,
      visuals: Object.fromEntries(VISUAL_KEYS.map((k) => [k, d.visuals[k] !== false])),
      metadata: Object.fromEntries(META_KEYS.map((k) => [k, d.metadata[k] !== false])),
    },
    motif, voice,
  });
  return { ok: true, spec, problems: [] };
}

/** Stable form: sorted keys, sorted set-like arrays, frozen. Two specs that
 *  mean the same thing hash the same. */
export function canonicalSpec(spec) {
  const sortArrays = (key, value) => (["formats", "hookStyles", "captionStructures"].includes(key)
    ? [...value].sort((a, b) => CHANNEL_ORDER(a) - CHANNEL_ORDER(b) || String(a).localeCompare(String(b))) : value);
  const walk = (value, key = "") => {
    if (Array.isArray(value)) return Object.freeze(sortArrays(key, value).map((v) => walk(v)));
    if (plainObject(value)) {
      return Object.freeze(Object.fromEntries(Object.keys(value).sort().map((k) => [k, walk(value[k], k)])));
    }
    return value;
  };
  return walk(spec);
}
const CHANNEL_ORDER = (id) => { const i = CHANNEL_FORMATS.indexOf(id); return i < 0 ? 99 : i; };

const sha256 = (text) => createHash("sha256").update(text).digest("hex");

export function specHash(spec) {
  return sha256(JSON.stringify(canonicalSpec(spec)));
}

export function typeLabel(row) {
  return `${row?.type_key || "?"}/v${row?.version ?? "?"}`;
}

/** The design object a post carries when rendered with this type. */
export function designForType(spec) {
  return {
    aspect: spec.aspect, template: spec.family,
    density: spec.design.density, variant: spec.design.variant,
    headlineAlignment: spec.design.headlineAlignment, logoPosition: spec.design.logoPosition,
    visuals: { ...spec.design.visuals }, metadata: { ...spec.design.metadata },
    ...(spec.motif ? { motif: { ...spec.motif } } : {}),
  };
}

/* ── Built-in types ────────────────────────────────────────────────────────
   Readings: four founder-reviewed families, twice each (the default design,
   and an alternate with the family's second variant, a centred headline, and
   one motif). Green and evergreen formats: the 5.1 event template made for
   each, with the mark in the upper corner, square and portrait. Fourteen
   looks before any AI proposal exists, every one of them clean under the
   layout check. Built-ins still land as `proposed`: posting
   automatically is a new power, and the founder approves each look once. */
const ALL_HOOKS = Object.freeze(Object.keys(HOOK_STYLES));
const ALL_CAPTIONS = Object.freeze(Object.keys(CAPTION_STRUCTURES));
const ALL_ON_VISUALS = Object.freeze({ moon: true, strip: true, diagram: true });
const ALL_ON_META = Object.freeze({ date: true, time: true, sign: true, illumination: true, retro: true, calculated: true });

const ALT_MOTIFS = Object.freeze({
  orbit_instrument: { kind: "star_field", tone: "brand", placement: "top_right", intensity: "subtle" },
  celestial_editorial: { kind: "meridian_lines", tone: "line", placement: "bottom_right", intensity: "present" },
  lunar_field: { kind: "orbit_rings", tone: "moonRim", placement: "top_right", intensity: "subtle" },
  planetary_grid: { kind: "horizon_band", tone: "accentDeep", placement: "bottom_left", intensity: "subtle" },
  orbit_signal: { kind: "axis_ray", tone: "brand", placement: "bottom_left", intensity: "subtle" },
});

function builtin(key, name, description, raw) {
  const { ok, spec, problems } = validatePostTypeSpec(raw);
  if (!ok) throw new Error(`built-in post type ${key} is invalid: ${problems.join("; ")}`);
  return Object.freeze({ key, name, description, spec });
}

/** Families seeded as built-ins, and where each puts the mark. The layout
 *  check (layout-check.js) found the footer metadata line printed across a
 *  footer mark in four families, so those use the upper corner; Planetary
 *  Grid draws positions there instead and keeps the founder's footer mark.
 *  Celestial Editorial is NOT seeded: its vertical "THE SHARED SKY" label
 *  crosses its own page counter in every placement. It rejoins as a new
 *  family version once the renderer fixes that, and until then it is still
 *  available, unchanged, in the desk. */
const READING_LOGOS = Object.freeze({
  orbit_instrument: ["upper_corner", "upper_corner"],
  lunar_field: ["upper_corner", "upper_corner"],
  planetary_grid: ["footer_left", "footer_center"],
  orbit_signal: ["upper_corner", "upper_corner"],
});

const READING_BUILTINS = Object.keys(READING_LOGOS).flatMap((family) => {
  const T = TEMPLATES[family];
  const [logo, altLogo] = READING_LOGOS[family];
  const base = {
    family, familyVersion: T.version, formats: [...READING_FORMAT_IDS], aspect: "portrait",
    voice: { hookStyles: [...ALL_HOOKS], captionStructures: [...ALL_CAPTIONS] },
  };
  return [
    builtin(family, T.name, `${T.name} as the founder reviewed it, for readings: ${T.intendedUse}`, {
      ...base, motif: null,
      design: { density: T.density, variant: 0, headlineAlignment: "left", logoPosition: logo,
        visuals: { ...ALL_ON_VISUALS }, metadata: { ...ALL_ON_META } } }),
    builtin(`${family}.alt`, `${T.name} · Alternate`,
      `${T.name} for readings, second variant: centred headline and a ${MOTIF_KINDS[ALT_MOTIFS[family].kind].toLowerCase().replace(/\.$/, "")}`, {
        ...base, motif: { ...ALT_MOTIFS[family] },
        design: { density: T.density, variant: Math.min(1, T.variants - 1), headlineAlignment: "center",
          logoPosition: altLogo, visuals: { ...ALL_ON_VISUALS }, metadata: { ...ALL_ON_META } } }),
  ];
});

const EVENT_BUILTINS = [
  ["lunar_hero", "square", "Lunar Hero", "Full and New Moons on their day: the calculated Moon disc carries the post. Square."],
  ["lunar_hero", "portrait", "Lunar Hero · Tall", "Full and New Moons on their day, in the taller feed format."],
  ["instrument", "square", "Instrument", "Calculated, Not Invented: Orbit's method, plainly. Square."],
  ["instrument", "portrait", "Instrument · Tall", "Calculated, Not Invented, in the taller feed format."],
  ["fog_panel", "square", "Fog Panel", "Astrology Without the Fog: one idea, explained without jargon. Square."],
  ["sky_contrast", "square", "Sky Contrast", "Your Sky is not The Sky: the shared sky beside a personal chart. Square."],
].map(([template, aspect, name, description]) => builtin(aspect === "square" ? template : `${template}.tall`, name, description, {
  family: template, familyVersion: templateVersion(template), formats: [...TEMPLATE_FORMATS[template]], aspect,
  motif: null, voice: { hookStyles: [...ALL_HOOKS], captionStructures: [...ALL_CAPTIONS] },
  design: { density: TEMPLATES[template].density, variant: 0, headlineAlignment: "left", logoPosition: "upper_corner",
    visuals: { ...ALL_ON_VISUALS }, metadata: { ...ALL_ON_META } },
}));

export const BUILTIN_POST_TYPES = Object.freeze([...READING_BUILTINS, ...EVENT_BUILTINS]);

/* ── Fixtures: engine-SHAPED, fixed, never presented as live sky ──────────
   The fingerprint must not move with the calendar, so it renders a frozen
   packet. These values are a plausible August 2026 sky written out by hand
   for the renderer to draw; they are never published and never shown as a
   real reading. Samples the desk shows use live engine facts instead. */
const FIXTURE_TZ = "America/Chicago";
const FIXTURE_CONTEXT = Object.freeze({
  context_version: 1, local_date: "2026-08-20", moon_phase_name: "Waxing Crescent",
  illumination_percent: 31, is_waxing: true, moon: { sign: "Libra" },
  planets: {
    sun: { name: "Sun", sign: "Leo", degrees: 27.6 }, moon: { name: "Moon", sign: "Libra", degrees: 4.2 },
    mercury: { name: "Mercury", sign: "Leo", degrees: 12.9 }, venus: { name: "Venus", sign: "Libra", degrees: 1.4 },
    mars: { name: "Mars", sign: "Cancer", degrees: 23.1 }, jupiter: { name: "Jupiter", sign: "Cancer", degrees: 21.8 },
    saturn: { name: "Saturn", sign: "Aries", degrees: 4.9, retrograde: true },
    uranus: { name: "Uranus", sign: "Gemini", degrees: 1.7 }, neptune: { name: "Neptune", sign: "Aries", degrees: 1.9, retrograde: true },
    pluto: { name: "Pluto", sign: "Aquarius", degrees: 2.9, retrograde: true },
  },
});
const FIXTURE_EVENTS = Object.freeze([
  { date: "2026-08-20", kind: "mercury_direct", title: "Mercury stations direct", detail: "Retrograde ends. (approximate)" },
  { date: "2026-08-22", kind: "sun_ingress", title: "Sun enters Virgo", detail: "Virgo season begins." },
  { date: "2026-08-28", instant_utc: "2026-08-28T04:18:00Z", kind: "full_moon", title: "Full Moon", detail: "Peak illumination.", source: "orbit-axis-engine" },
]);
const FIXTURE_SKY = Object.freeze({ moon: { sign: "Pisces", illumination_percent: 100, waxing: false }, sun: { sign: "Virgo" } });

export const FIXTURE_EDUCATIONAL = Object.freeze({
  eventKey: "educational:fixture", eventType: "educational", title: "What an ephemeris does", timestamp: null,
  facts: Object.freeze({ ground: "Positions come from Swiss Ephemeris data, not from language models." }),
  source: "orbit-editorial", approximate: false,
});

let fixtureCache = null;
/** One fixed candidate per channel format. */
export function fixtureCandidates() {
  if (fixtureCache) return fixtureCache;
  const reading = (type) => buildReadingCandidate({
    type, period: calculateReadingPeriod(type, "2026-08-20", FIXTURE_TZ), events: FIXTURE_EVENTS, context: FIXTURE_CONTEXT,
  });
  const moon = buildCandidates(FIXTURE_EVENTS, FIXTURE_CONTEXT, { skyAt: () => FIXTURE_SKY }).candidates[0];
  fixtureCache = Object.freeze({
    daily_reading: reading("daily"), weekly_reading: reading("weekly"), monthly_reading: reading("monthly"),
    something_changed: moon, calculated_not_invented: FIXTURE_EDUCATIONAL,
    without_the_fog: FIXTURE_EDUCATIONAL, your_sky: FIXTURE_EDUCATIONAL,
  });
  return fixtureCache;
}

/* Sample copy. Short on purpose, so the fingerprint measures the DESIGN and a
   sample never trips a fitting warning that real copy would not. Labelled
   wherever it can be seen. */
const SAMPLE_LINES = Object.freeze({
  headline: "Sample headline for review",
  theme: "Sample theme for review",
  oneSentence: "Sample thesis line: real facts, placeholder interpretation.",
  body: "Sample copy. The facts on this slide are calculated; this sentence is a placeholder.",
  caption: "Sample caption for template review. Not for publication.",
});

/**
 * A complete, valid post for a candidate and format, using the scaffold's
 * derived fields and SAMPLE_LINES for anything interpretive.
 */
export function samplePost(candidate, formatId, design) {
  const isReading = Boolean(FORMATS[formatId]?.readingType);
  const { post } = isReading ? buildReadingScaffold(candidate, formatId) : buildScaffold(candidate, formatId);
  const fill = (slide) => {
    if (slide.role === "one_sentence") return { ...slide, body: SAMPLE_LINES.oneSentence };
    if (String(slide.body || "").trim()) return slide;
    if (["hero", "cover", "cta", "pivot", "evidence", "key_dates", "close"].includes(slide.role)) return slide;
    return { ...slide, body: SAMPLE_LINES.body };
  };
  const headline = isReading ? SAMPLE_LINES.theme : (String(post.headline || "").trim() || SAMPLE_LINES.headline);
  const filled = {
    ...post, headline, slides: post.slides.map(fill),
    caption: String(post.caption || "").trim() || SAMPLE_LINES.caption,
    altText: String(post.altText || "").trim() || "Orbit Axis sample carousel for template review.",
    design,
    ...(isReading ? { reading: { ...post.reading, theme: headline, oneSentence: SAMPLE_LINES.oneSentence } } : {}),
  };
  return validateGeneratedPost(filled, formatId, { requireComplete: true });
}

/** Render a type in one format against a candidate (fixture by default). */
export function renderTypeSample(spec, formatId, candidate = null) {
  const c = candidate || fixtureCandidates()[formatId];
  const design = normalizeDesign(designForType(spec), c.eventType, formatId);
  const post = samplePost(c, formatId, designForType(spec));
  const rendered = renderPost({ ...post, design }, {
    eventType: c.eventType, title: c.title, facts: c.facts,
    sky: c.facts?.planets || c.facts?.sky || [], design,
  });
  return { post, rendered };
}

/**
 * The render fingerprint: every format the type claims, drawn against the
 * fixed fixtures, hashed. Deterministic because the renderer has no clock and
 * no randomness.
 *
 * @returns {{ fingerprint: string, warnings: string[], layout: string[] }}
 *   `layout` lists text that lands on the brand mark or on other text
 *   (layout-check.js), measured on the same fixture renders.
 */
const fingerprintMemo = new Map();
export function renderFingerprint(spec) {
  // The renderer cannot change inside a running process, so a spec's
  // fingerprint is memoized by its hash for the life of the process.
  const key = specHash(spec);
  if (fingerprintMemo.has(key)) return fingerprintMemo.get(key);
  const result = computeFingerprint(spec);
  if (fingerprintMemo.size > 500) fingerprintMemo.clear();
  fingerprintMemo.set(key, result);
  return result;
}

function computeFingerprint(spec) {
  const hash = createHash("sha256");
  const warnings = [];
  const layout = [];
  hash.update(`${spec.family}/${templateVersion(spec.family)}`);
  for (const formatId of spec.formats) {
    const { rendered } = renderTypeSample(spec, formatId);
    for (const slide of rendered.slides) hash.update(slide.svg);
    warnings.push(...rendered.warnings.map((w) => `${formatId}: ${w}`));
    layout.push(...postCollisions(rendered).map((c) => `${formatId} ${c}`));
  }
  return { fingerprint: hash.digest("hex"), warnings, layout };
}

/** Is a stored row safe to post with right now? Returns a reason when not. */
export function usability(row, fingerprintOf = (spec) => renderFingerprint(spec).fingerprint) {
  if (row?.status !== "approved") return { usable: false, reason: `status is ${row?.status || "unknown"}` };
  const checked = validatePostTypeSpec(row.spec, { allowRetiredFamilyVersion: true });
  if (!checked.ok) return { usable: false, reason: `stored spec no longer validates: ${checked.problems[0]}` };
  if (specHash(checked.spec) !== row.spec_hash) return { usable: false, reason: "spec hash does not match the approved spec" };
  if (checked.spec.familyVersion !== templateVersion(checked.spec.family)) {
    return { usable: false, reason: `${checked.spec.family}/${checked.spec.familyVersion} is no longer the current renderer` };
  }
  if (fingerprintOf(checked.spec) !== row.render_fingerprint) {
    return { usable: false, reason: "the renderer draws this type differently from what was approved" };
  }
  return { usable: true, reason: null, spec: checked.spec };
}

/**
 * Plan the registry sync: which rows to insert as new proposed versions and
 * which approved rows to mark superseded. Pure, so it is tested directly.
 *
 * @param {Array} rows      stored registry rows
 * @param {object} [opts]   { builtins, fingerprintOf, now }
 * @returns {{ inserts: Array<object>, supersede: Array<{id:string, reason:string}> }}
 */
export function planRegistrySync(rows = [], {
  builtins = BUILTIN_POST_TYPES,
  fingerprintOf = (spec) => renderFingerprint(spec).fingerprint,
} = {}) {
  const inserts = [];
  const supersede = [];
  const byKey = new Map();
  for (const row of rows) {
    if (!byKey.has(row.type_key)) byKey.set(row.type_key, []);
    byKey.get(row.type_key).push(row);
  }
  const nextVersion = (key) => 1 + Math.max(0, ...(byKey.get(key) || []).map((r) => Number(r.version) || 0),
    ...inserts.filter((i) => i.type_key === key).map((i) => i.version));
  const fingerprints = new Map();
  const fp = (spec) => {
    const h = specHash(spec);
    if (!fingerprints.has(h)) fingerprints.set(h, fingerprintOf(spec));
    return fingerprints.get(h);
  };

  const propose = (key, base, spec, source, reason) => {
    inserts.push({
      type_key: key, version: nextVersion(key), name: base.name, description: base.description,
      spec, spec_hash: specHash(spec), render_fingerprint: fp(spec), status: "proposed", source,
      proposal_notes: reason,
    });
  };

  // Built-ins: the code is the source of truth. The current code spec, as the
  // current renderer draws it, must exist as some row; if it does not, it is
  // proposed, and any approved built-in row that no longer matches is retired
  // from use by being superseded.
  for (const builtin of builtins) {
    const existing = byKey.get(builtin.key) || [];
    const hash = specHash(builtin.spec);
    const print = fp(builtin.spec);
    const current = existing.find((r) => r.spec_hash === hash && r.render_fingerprint === print
      && !["superseded"].includes(r.status));
    if (!current) {
      const changed = existing.length ? (existing.some((r) => r.spec_hash === hash) ? "renderer changed" : "spec changed") : "new built-in";
      propose(builtin.key, builtin, builtin.spec, "builtin", changed);
    }
    for (const row of existing) {
      if (row.status === "approved" && (row.spec_hash !== hash || row.render_fingerprint !== print)) {
        supersede.push({ id: row.id, reason: "a newer built-in version replaces this one" });
      }
    }
  }

  // Everything else (AI-proposed): an approved row the renderer now draws
  // differently, or whose family moved on, is re-proposed as a new version.
  const builtinKeys = new Set(builtins.map((b) => b.key));
  for (const row of rows) {
    if (builtinKeys.has(row.type_key) || row.status !== "approved") continue;
    const checked = validatePostTypeSpec(row.spec, { allowRetiredFamilyVersion: true });
    if (!checked.ok) { supersede.push({ id: row.id, reason: "stored spec no longer validates" }); continue; }
    let spec = checked.spec;
    let reason = null;
    if (spec.familyVersion !== templateVersion(spec.family)) {
      spec = canonicalSpec({ ...spec, familyVersion: templateVersion(spec.family) });
      reason = `family moved to ${spec.family}/${spec.familyVersion}`;
    } else if (fp(spec) !== row.render_fingerprint) {
      reason = "renderer changed";
    }
    if (!reason) continue;
    supersede.push({ id: row.id, reason });
    const already = rows.some((r) => r.type_key === row.type_key && r.spec_hash === specHash(spec)
      && r.render_fingerprint === fp(spec) && r.status !== "superseded");
    if (!already) propose(row.type_key, row, spec, row.source || "ai", reason);
  }

  return { inserts, supersede };
}

/** Name and description rules for a proposal; the spec is checked separately. */
export function validateTypeMetadata({ key, name, description }) {
  const problems = [];
  if (!TYPE_KEY.test(String(key || ""))) problems.push("key must look like family.short_name (lowercase, digits, underscores)");
  if (typeof name !== "string" || !name.trim() || name.length > 48) problems.push("name must be 1 to 48 characters");
  if (typeof description !== "string" || !description.trim() || description.length > 280) {
    problems.push("description must be 1 to 280 characters");
  }
  return problems;
}

/**
 * Apply planRegistrySync() through a channel store (either credential lane).
 * Returns the registry as it stands afterwards.
 */
export async function syncRegistry(store) {
  const rows = await store.listPostTypes();
  const { inserts, supersede } = planRegistrySync(rows);
  for (const s of supersede) {
    await store.updatePostType(s.id, { status: "superseded", decision_reason: s.reason }).catch(() => {});
  }
  if (inserts.length) await store.insertPostTypes(inserts);
  return inserts.length || supersede.length ? store.listPostTypes() : rows;
}
