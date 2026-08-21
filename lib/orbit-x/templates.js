// Orbit X :: the SVG template system (Dev Update 5.1).
//
// TEMPLATES ARE DATA DRIVING A RENDERER, not one giant string per post. A
// slide is (aspect × template × density × role × variant) bound to copy and
// verified facts; every coordinate derives from the aspect's safe zones so a
// future Template Studio edits definitions, not code. The renderer never
// invents astronomy: every celestial mark is drawn from facts the engine
// supplied, and a missing fact renders as absence.
//
// TEXT FITTING IS DETERMINISTIC AND HONEST. Copy that exceeds a region's
// designed tiers comes back flagged — the desk says "headline exceeds the
// safe area" instead of silently shrinking type into illegibility. Character
// widths are estimated by font-class factors, which is deliberate: the same
// string always fits (or fails) the same way on every machine.
//
// Pure module: no imports beyond celestial.js, no DOM, no clock. Runs in
// Node for tests and in the desk browser for preview/export.

import {
  planetGlyph, zodiacGlyph, retroGlyph, moonDisc, skyStrip, eventBadge,
  axisMotif, oppositionDiagram, ingressDiagram, orbitLogo, PLANET_GLYPHS, ZODIAC_GLYPHS,
} from "./celestial.js";

const esc = (t) => String(t ?? "").replace(/[&<>"']/g,
  (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

/* ── Design tokens: the Orbit brand, stated once ─────────────────────────── */
export const TOKENS = Object.freeze({
  bg: "#080a12",
  ink: "#f4f2fa",
  body: "#aab0c4",      // strengthened from #8e93a8 for feed-scale legibility
  muted: "#8e93a8",
  accent: "#7657e8",
  accentDeep: "#4a28b8",
  brand: "#b9a7ff",
  line: "#232842",
  moonLight: "#e8e4f6",
  moonDark: "#171b2c",
  moonRim: "#3a3f5c",
  serif: "Georgia, 'Times New Roman', serif",
  sans: "-apple-system, 'Helvetica Neue', Arial, sans-serif",
});

/* ── Aspects: each with its own designed safe zones, never scaled ────────── */
export const ASPECTS = Object.freeze({
  square: Object.freeze({
    id: "square", width: 1080, height: 1080, suffix: "",
    safe: Object.freeze({ x: 110, y: 130, w: 860, h: 700 }),
    footerY: 990,
  }),
  portrait: Object.freeze({
    id: "portrait", width: 1080, height: 1350, suffix: "_portrait",
    safe: Object.freeze({ x: 110, y: 150, w: 860, h: 940 }),
    footerY: 1256,
  }),
});
export const ASPECT_IDS = Object.freeze(Object.keys(ASPECTS));

/* ── Visual densities: designed presets, not a slider ────────────────────── */
export const DENSITIES = Object.freeze({
  minimal: Object.freeze({ id: "minimal", name: "Minimal",
    blurb: "Large type, one celestial anchor, maximum negative space." }),
  standard: Object.freeze({ id: "standard", name: "Standard",
    blurb: "Headline, body, celestial visual, metadata." }),
  data: Object.freeze({ id: "data", name: "Data",
    blurb: "More astronomical information — sky strips, positions, metadata." }),
});

export const LOGO_POSITIONS = Object.freeze({
  footer_left: "Footer Left",
  footer_center: "Footer Center",
  upper_corner: "Upper Corner",
});

export const HEADLINE_ALIGNMENTS = Object.freeze({ left: "Left", center: "Center" });

/** Founder-selected defaults (2026-08-20). Historical posts keep the family
 * stored on their own row; changing these never restyles saved artifacts. */
export const READING_TEMPLATE_DEFAULTS = Object.freeze({
  daily_reading: "lunar_field",
  weekly_reading: "planetary_grid",
  monthly_reading: "orbit_signal",
  special_reading: "orbit_signal",
});

/* ── Deterministic text fitting ──────────────────────────────────────────── */
const CHAR_FACTOR = Object.freeze({ serif: 0.54, sans: 0.50 });

/**
 * Wrap text into lines for a region, stepping down through designed type
 * tiers. Returns { lines, size, overflow } — overflow means even the
 * smallest tier could not hold it within maxLines, and the caller must SAY so.
 */
export function fitText(text, { tiers = [64, 56, 48], maxLines = 3, width = 860, font = "sans" } = {}) {
  const words = String(text || "").trim().split(/\s+/).filter(Boolean);
  if (!words.length) return { lines: [], size: tiers[tiers.length - 1], overflow: false };
  const factor = CHAR_FACTOR[font] || CHAR_FACTOR.sans;
  for (const size of tiers) {
    const budget = Math.max(4, Math.floor(width / (size * factor)));
    const lines = [[]];
    let fits = true;
    for (const word of words) {
      const line = lines[lines.length - 1];
      const candidate = [...line, word].join(" ");
      if (candidate.length <= budget || line.length === 0) line.push(word);
      else lines.push([word]);
      if (lines.length > maxLines) { fits = false; break; }
    }
    if (fits) return { lines: lines.map((l) => l.join(" ")), size, overflow: false };
  }
  // Smallest tier, hard-truncated at maxLines — flagged, never silent.
  const size = tiers[tiers.length - 1];
  const budget = Math.max(4, Math.floor(width / (size * factor)));
  const lines = [[]];
  for (const word of words) {
    const line = lines[lines.length - 1];
    if (([...line, word].join(" ").length <= budget) || line.length === 0) line.push(word);
    else if (lines.length < maxLines) lines.push([word]);
    else break;
  }
  return { lines: lines.map((l) => l.join(" ")), size, overflow: true };
}

/** Designed limits, surfaced to the desk as editorial constraints (§18). */
export const SAFE_LIMITS = Object.freeze({
  headlineLines: 3, bodyLines: 8, ctaChars: 60, metadataItems: 5,
});

/* ── Slide roles ─────────────────────────────────────────────────────────── */
export const SLIDE_ROLES = Object.freeze([
  "hero", "fact", "symbolic", "reflection", "cta",
  "signal", "explain", "takeaway", "the_sky", "your_sky", "method",
  "cover", "one_sentence", "movements", "opening", "movement", "pivot",
  "landing", "later", "reading", "evidence", "key_dates", "close",
]);

/** Which roles a finished draft must have an authored BODY before approval.
 *  hero is false because its required content is the headline (checked
 *  separately) — slide one carries no paragraphs by design (§41). */
export const REQUIRED_ROLES = Object.freeze({
  hero: false, fact: true, symbolic: true, reflection: true, signal: true,
  explain: true, takeaway: true, the_sky: true, your_sky: true, method: true,
  cta: false, // a post may end on the final idea instead of a pitch
  cover: false, one_sentence: true, movements: true, opening: true,
  movement: true, pivot: false, landing: true, later: true, reading: true,
  evidence: false, key_dates: false, close: false,
});

/* ── Slide-title banks: coherent sequences, chosen by template ───────────── */
export const TITLE_BANKS = Object.freeze({
  fact: Object.freeze(["What changed", "In the sky", "The timing", "What's happening", "The astronomy", "Right now"]),
  symbolic: Object.freeze(["Symbolically", "The traditional reading", "The theme", "In astrology", "What this can represent"]),
  reflection: Object.freeze(["Notice", "Consider", "A question", "Sit with this", "Reflect"]),
});

/* ── Template registry ───────────────────────────────────────────────────── */
export const TEMPLATES = Object.freeze({
  orbit_instrument: Object.freeze({
    id: "orbit_instrument", name: "Orbit Instrument", version: "v1", family: true,
    intendedUse: "Precise, minimal, observatory-like — the closest continuation of Orbit today.",
    eventTypes: Object.freeze(["collective_reading"]), density: "standard", variants: 2,
    visuals: Object.freeze(["moon", "strip", "axis", "badge"]),
    titles: Object.freeze({ fact: 1, symbolic: 2, reflection: 0 }),
  }),
  celestial_editorial: Object.freeze({
    id: "celestial_editorial", name: "Celestial Editorial", version: "v1", family: true,
    intendedUse: "Bold asymmetrical type and cropped celestial glyphs, with a contemporary editorial rhythm.",
    eventTypes: Object.freeze(["collective_reading"]), density: "minimal", variants: 2,
    visuals: Object.freeze(["planet", "zodiac", "badge"]),
    titles: Object.freeze({ fact: 0, symbolic: 3, reflection: 2 }),
  }),
  lunar_field: Object.freeze({
    id: "lunar_field", name: "Lunar Field", version: "v1", family: true,
    intendedUse: "Quiet, atmospheric lunar geometry driven by the calculated Moon state.",
    eventTypes: Object.freeze(["collective_reading"]), density: "standard", variants: 2,
    visuals: Object.freeze(["moon", "axis", "badge"]),
    titles: Object.freeze({ fact: 1, symbolic: 2, reflection: 4 }),
  }),
  planetary_grid: Object.freeze({
    id: "planetary_grid", name: "Planetary Grid", version: "v1", family: true,
    intendedUse: "Structured modernist modules for organizing several weekly or monthly movements.",
    eventTypes: Object.freeze(["collective_reading"]), density: "data", variants: 2,
    visuals: Object.freeze(["strip", "planet", "badge"]),
    titles: Object.freeze({ fact: 4, symbolic: 2, reflection: 1 }),
  }),
  orbit_signal: Object.freeze({
    id: "orbit_signal", name: "Orbit Signal", version: "v1", family: true,
    intendedUse: "The boldest social-native system: immediate contrast, oversized symbols, very limited opening copy.",
    eventTypes: Object.freeze(["collective_reading"]), density: "minimal", variants: 2,
    visuals: Object.freeze(["planet", "axis", "badge"]),
    titles: Object.freeze({ fact: 5, symbolic: 2, reflection: 0 }),
  }),
  lunar_hero: Object.freeze({
    id: "lunar_hero", name: "Lunar Hero",
    intendedUse: "Full and New Moon events — the Moon disc carries the post.",
    eventTypes: Object.freeze(["full_moon", "new_moon"]),
    density: "standard", variants: 2,
    visuals: Object.freeze(["moon", "opposition", "badge"]),
    titles: Object.freeze({ fact: 1, symbolic: 3, reflection: 0 }), // bank indexes
  }),
  planet_shift: Object.freeze({
    id: "planet_shift", name: "Planet Shift",
    intendedUse: "Ingresses and stations — PLANET → SIGN movement grammar.",
    eventTypes: Object.freeze(["sun_ingress", "mercury_rx", "mercury_direct"]),
    density: "standard", variants: 2,
    visuals: Object.freeze(["planet", "ingress", "badge"]),
    titles: Object.freeze({ fact: 0, symbolic: 4, reflection: 1 }),
  }),
  sky_grid: Object.freeze({
    id: "sky_grid", name: "Sky Grid",
    intendedUse: "Current-sky posts — the instrument panel, opened.",
    eventTypes: Object.freeze(["daily_sky"]),
    density: "data", variants: 1,
    visuals: Object.freeze(["moon", "strip", "badge"]),
    titles: Object.freeze({ fact: 5, symbolic: 2, reflection: 0 }),
  }),
  fog_panel: Object.freeze({
    id: "fog_panel", name: "Fog Panel",
    intendedUse: "Educational explainers — diagrams over decoration.",
    eventTypes: Object.freeze(["educational"]),
    density: "standard", variants: 2,
    visuals: Object.freeze(["badge"]),
    titles: Object.freeze({ fact: 4, symbolic: 2, reflection: 1 }),
  }),
  sky_contrast: Object.freeze({
    id: "sky_contrast", name: "Sky Contrast",
    intendedUse: "THE SKY versus YOUR SKY — the product-education split.",
    eventTypes: Object.freeze(["educational", "daily_sky"]),
    density: "standard", variants: 1,
    visuals: Object.freeze(["strip", "badge"]),
    titles: Object.freeze({ fact: 1, symbolic: 2, reflection: 3 }),
  }),
  instrument: Object.freeze({
    id: "instrument", name: "Instrument",
    intendedUse: "Calculated, Not Invented — Orbit's most technical face.",
    eventTypes: Object.freeze(["educational"]),
    density: "data", variants: 1,
    visuals: Object.freeze(["badge"]),
    titles: Object.freeze({ fact: 4, symbolic: 2, reflection: 1 }),
  }),
});
export const TEMPLATE_IDS = Object.freeze(Object.keys(TEMPLATES));
export const TEMPLATE_FAMILY_IDS = Object.freeze(Object.values(TEMPLATES).filter((t) => t.family).map((t) => t.id));

/** Deterministic recommendation: event type → template. Founder can override. */
export function recommendTemplate(eventType, formatId = null) {
  if (READING_TEMPLATE_DEFAULTS[formatId]) return READING_TEMPLATE_DEFAULTS[formatId];
  if (formatId === "something_changed") return READING_TEMPLATE_DEFAULTS.special_reading;
  if (eventType === "collective_reading" || String(formatId || "").endsWith("_reading")) return READING_TEMPLATE_DEFAULTS.daily_reading;
  if (formatId === "your_sky") return "sky_contrast";
  if (formatId === "calculated_not_invented") return "instrument";
  for (const t of Object.values(TEMPLATES)) {
    if (t.eventTypes.includes(eventType)) return t.id;
  }
  return "fog_panel";
}

/* ── Event badges (§13) ──────────────────────────────────────────────────── */
export function badgeFor(eventType, facts = {}) {
  const map = {
    full_moon: "Full Moon", new_moon: "New Moon", sun_ingress: "Ingress",
    mercury_rx: "Station · Retrograde", mercury_direct: "Station · Direct",
    daily_sky: "Current Sky", educational: "Calculated",
    collective_reading: facts.period?.type ? `${facts.period.type} reading` : "Collective Reading",
  };
  return map[eventType] || "Calculated";
}

/* ── Date presentation (§51): exact timestamps stay in facts; templates
      show human dates. No timezone is implied that the facts don't state. ── */
const MONTHS = Object.freeze(["January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December"]);

export function humanDate(iso, { style = "long" } = {}) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso || ""));
  if (!m) return "";
  const month = MONTHS[Number(m[2]) - 1] || "";
  const day = Number(m[3]);
  if (style === "short") return `${month.slice(0, 3).toUpperCase()} ${day}`;
  return `${month} ${day}`;
}

export function utcTime(instantIso) {
  const m = /T(\d{2}):(\d{2})/.exec(String(instantIso || ""));
  return m ? `${m[1]}:${m[2]} UTC` : "";
}

/* ── The renderer ────────────────────────────────────────────────────────── */

const sanitizeVisualToggles = (v = {}) => ({
  moon: v.moon !== false, strip: v.strip !== false, diagram: v.diagram !== false,
});
const sanitizeMetaToggles = (m = {}) => ({
  date: m.date !== false, time: m.time !== false, sign: m.sign !== false,
  illumination: m.illumination !== false, retro: m.retro !== false,
  calculated: m.calculated !== false,
});

/** Normalize + validate a design object; unknown values fall to defaults. */
export function normalizeDesign(design = {}, eventType = null, formatId = null) {
  const reading = String(formatId || "").endsWith("_reading") || eventType === "collective_reading";
  return Object.freeze({
    aspect: ASPECTS[design.aspect] ? design.aspect : (reading ? "portrait" : "square"),
    template: TEMPLATES[design.template] ? design.template : recommendTemplate(eventType, formatId),
    variant: Number.isInteger(design.variant) && design.variant >= 0
      && design.variant < (TEMPLATES[design.template]?.variants || 1) ? design.variant : 0,
    density: DENSITIES[design.density] ? design.density
      : (TEMPLATES[TEMPLATES[design.template] ? design.template : recommendTemplate(eventType, formatId)]?.density || "standard"),
    visuals: sanitizeVisualToggles(design.visuals),
    metadata: sanitizeMetaToggles(design.metadata),
    logoPosition: LOGO_POSITIONS[design.logoPosition] ? design.logoPosition : "footer_left",
    headlineAlignment: HEADLINE_ALIGNMENTS[design.headlineAlignment]
      ? design.headlineAlignment : (design.variant === 1 ? "center" : "left"),
  });
}

function textBlock(fit, { x, y, font, color, weight = null, anchor = "start", lineGap = 1.22 }) {
  return fit.lines.map((line, i) =>
    `<text x="${x}" y="${y + i * fit.size * lineGap}" font-family="${font}" font-size="${fit.size}"`
    + `${weight ? ` font-weight="${weight}"` : ""} text-anchor="${anchor}" fill="${color}">${esc(line)}</text>`).join("");
}

/** Footer: brand mark, compact calculated indicator, page count (§68–69). */
function footer(aspect, { page, total, dateShort, calculated, design }) {
  const A = ASPECTS[aspect];
  const y = A.footerY;
  const midParts = [];
  if (calculated) midParts.push("CALCULATED");
  if (dateShort) midParts.push(dateShort.toUpperCase());
  const pos = design?.logoPosition || "footer_left";
  const brand = pos === "upper_corner"
    ? orbitLogo({ x: A.width - A.safe.x - 8, y: 52, scale: 0.5, compact: true, anchor: "end" })
    : orbitLogo({ x: pos === "footer_center" ? A.width / 2 : A.safe.x,
      y: y - 76, scale: 0.64, compact: true, anchor: pos === "footer_center" ? "middle" : "start" });
  return brand
    + (midParts.length && pos !== "footer_center" ? `<text x="${A.width / 2}" y="${y}" text-anchor="middle" font-family="${TOKENS.sans}" font-size="27" letter-spacing="3" fill="${TOKENS.muted}">${esc(midParts.join(" · "))}</text>` : "")
    + (total > 1 ? `<text x="${A.width - A.safe.x - 10}" y="${y}" text-anchor="end" font-family="${TOKENS.sans}" font-size="26" fill="${TOKENS.muted}">${page}/${total}</text>` : "");
}

/** Metadata row (§45): only items the facts actually carry. */
function metadataRow(ctx, x, y, max = SAFE_LIMITS.metadataItems) {
  const { facts = {}, design } = ctx;
  const meta = design.metadata;
  const items = [];
  const sky = facts.sky_at_event || {};
  if (meta.date && (facts.date || facts.local_date)) items.push(humanDate(facts.date || facts.local_date, { style: "short" }));
  if (meta.time && facts.instant_utc && !facts.approximate) items.push(utcTime(facts.instant_utc));
  if (meta.sign && sky.moon_sign) items.push(`Moon in ${sky.moon_sign}`);
  if (meta.illumination && Number.isFinite(sky.moon_illumination_percent)) items.push(`${Math.round(sky.moon_illumination_percent)}% illuminated`);
  if (meta.illumination && !sky.moon_illumination_percent && Number.isFinite(facts.illumination_percent)) items.push(`${Math.round(facts.illumination_percent)}% illuminated`);
  if (meta.calculated) items.push("Orbit calculation");
  if (!items.length) return "";
  return `<text x="${x}" y="${y}" font-family="${TOKENS.sans}" font-size="26" letter-spacing="1" fill="${TOKENS.muted}">${esc(items.slice(0, max).join("  ·  "))}</text>`;
}

/** The event's moon state, from verified facts only. */
function moonStateFrom(facts = {}, eventType = null) {
  const sky = facts.sky_at_event || {};
  if (Number.isFinite(sky.moon_illumination_percent)) {
    return { illumination_percent: sky.moon_illumination_percent, waxing: sky.moon_waxing !== false };
  }
  if (Number.isFinite(facts.illumination_percent)) {
    return { illumination_percent: facts.illumination_percent, waxing: facts.is_waxing !== false };
  }
  if (eventType === "full_moon") return { illumination_percent: 100, waxing: true };
  if (eventType === "new_moon") return { illumination_percent: 0, waxing: true };
  return null;
}

function ingressPartsFrom(ctx) {
  const title = String(ctx.title || "");
  const planet = Object.keys(PLANET_GLYPHS).find((p) => title.includes(p)) || null;
  const sign = Object.keys(ZODIAC_GLYPHS).find((s) => title.includes(s))
    || ctx.facts?.sky_at_event?.sun_sign || null;
  return planet && sign ? { planet, sign } : null;
}

const READING_LAYOUT_ROLE = Object.freeze({
  cover: "hero",
  one_sentence: "takeaway",
  movements: "signal",
  opening: "fact",
  movement: "fact",
  pivot: "fact",
  landing: "fact",
  later: "fact",
  reading: "symbolic",
  evidence: "method",
  key_dates: "method",
  close: "cta",
});

function sunSeasonSign(ctx) {
  const planets = Array.isArray(ctx?.facts?.planets) ? ctx.facts.planets : [];
  return planets.find((planet) => planet?.name === "Sun")?.sign
    || ctx?.facts?.sky_at_event?.sun_sign || null;
}

function familyBackdrop(template, A, S, slideIndex, ctx) {
  if (!template?.family) return "";
  if (template.id === "orbit_instrument") {
    return `<g opacity="0.72">${axisMotif({ x: S.x + 8, y: A.height - 180, length: 300 })}`
      + `<circle cx="${A.width - 122}" cy="178" r="92" fill="none" stroke="${TOKENS.line}" stroke-width="2" stroke-dasharray="4 14"/>`
      + `<path d="M${S.x} ${S.y - 42}H${A.width - S.x}" stroke="${TOKENS.line}" stroke-width="2"/></g>`;
  }
  if (template.id === "celestial_editorial") {
    const side = slideIndex % 2 === 0 ? A.width - 260 : 0;
    return `<rect x="${side}" y="0" width="260" height="${A.height}" fill="${TOKENS.accentDeep}" opacity="0.36"/>`
      + `<text x="${slideIndex % 2 === 0 ? A.width - 112 : 112}" y="${A.height - 210}" text-anchor="middle" transform="rotate(-90 ${slideIndex % 2 === 0 ? A.width - 112 : 112} ${A.height - 210})" font-family="${TOKENS.sans}" font-size="28" letter-spacing="12" fill="${TOKENS.brand}" opacity="0.7">THE SHARED SKY</text>`;
  }
  if (template.id === "lunar_field") {
    return `<defs><radialGradient id="lunar-field-${slideIndex}" cx="70%" cy="28%" r="68%"><stop offset="0" stop-color="${TOKENS.accentDeep}" stop-opacity="0.34"/><stop offset="1" stop-color="${TOKENS.bg}" stop-opacity="0"/></radialGradient></defs>`
      + `<rect width="${A.width}" height="${A.height}" fill="url(#lunar-field-${slideIndex})"/>`
      + `<circle cx="${A.width - 130}" cy="${S.y + 110}" r="240" fill="none" stroke="${TOKENS.moonRim}" stroke-width="2" opacity="0.55"/>`;
  }
  if (template.id === "planetary_grid") {
    const vertical = Array.from({ length: 7 }, (_, i) => `<line x1="${S.x + i * S.w / 6}" y1="${S.y - 52}" x2="${S.x + i * S.w / 6}" y2="${A.footerY - 90}"/>`).join("");
    const horizontal = Array.from({ length: 9 }, (_, i) => `<line x1="${S.x}" y1="${S.y - 52 + i * 110}" x2="${S.x + S.w}" y2="${S.y - 52 + i * 110}"/>`).join("");
    return `<g stroke="${TOKENS.line}" stroke-width="1" opacity="0.75">${vertical}${horizontal}</g>`;
  }
  if (template.id === "orbit_signal") {
    const sign = sunSeasonSign(ctx);
    return `<path d="M0 0H${A.width}V${slideIndex === 0 ? 250 : 128}H0Z" fill="${TOKENS.accent}"/>`
      + `<path d="M${A.width - 330} 0H${A.width}V${A.height}H${A.width - 250}Z" fill="${TOKENS.accentDeep}" opacity="0.52"/>`
      + (slideIndex > 0 && sign && ZODIAC_GLYPHS[sign]
        ? `<g data-orbit-signal-season="${esc(sign)}" opacity="0.92">${zodiacGlyph(sign, {
          x: A.width - 196, y: A.height - 286, size: 164, color: TOKENS.brand,
          title: `${sign} season`,
        })}</g>` : "");
  }
  return "";
}

/**
 * Render one slide to a complete SVG string.
 *
 * @param {object} ctx {
 *   aspect, design (normalized), eventType, title, facts, sky (strip data),
 *   headline, slide {role, heading, body}, slideIndex, total, cta
 * }
 * @returns {{ svg: string, warnings: string[] }}
 */
export function renderSlide(ctx) {
  const design = ctx.design;
  const A = ASPECTS[design.aspect];
  const T = TEMPLATES[design.template];
  const warnings = [];
  const semanticRole = ctx.slide?.role || (ctx.slideIndex === 0 ? "hero" : "explain");
  const role = READING_LAYOUT_ROLE[semanticRole] || semanticRole;
  const centered = design.headlineAlignment === "center"
    || (T.id === "lunar_field" && semanticRole !== "evidence")
    || (design.variant === 1 && T.id !== "celestial_editorial");
  const S = A.safe;
  const parts = [`<rect width="${A.width}" height="${A.height}" fill="${TOKENS.bg}"/>`, familyBackdrop(T, A, S, ctx.slideIndex, ctx)];
  const dateShort = humanDate(ctx.facts?.date || ctx.facts?.local_date, { style: "short" });
  const periodLabel = ctx.reading?.periodLabel || humanDate(ctx.facts?.date || ctx.facts?.local_date);
  const moonState = moonStateFrom(ctx.facts, ctx.eventType);
  const ingress = ctx.eventType === "sun_ingress" ? ingressPartsFrom(ctx) : null;
  const anchorX = centered ? A.width / 2 : S.x;
  const anchor = centered ? "middle" : "start";

  const heading = ctx.slideIndex === 0 ? (ctx.headline || ctx.slide?.heading || "") : (ctx.slide?.heading || "");
  const body = ctx.slide?.body || "";

  if (role === "hero") {
    const periodBadge = ctx.reading?.type ? `${ctx.reading.type.toUpperCase()} READING` : badgeFor(ctx.eventType, ctx.facts);
    parts.push(eventBadge(periodBadge, { x: anchorX, y: S.y + 10, font: T.id === "orbit_signal" ? 34 : 26,
      color: T.id === "orbit_signal" ? TOKENS.bg : TOKENS.accent }));
    // Celestial anchor
    let visualBottom = S.y + 60;
    const signalSign = T.id === "orbit_signal" ? sunSeasonSign(ctx) : null;
    if (signalSign && ZODIAC_GLYPHS[signalSign]) {
      const size = design.aspect === "portrait" ? 300 : 250;
      const x = A.width / 2 - size / 2;
      const y = S.y + 160;
      parts.push(`<g data-orbit-signal-season="${esc(signalSign)}">${zodiacGlyph(signalSign, {
        x, y, size, color: TOKENS.brand, title: `${signalSign} season`,
      })}</g>`);
      visualBottom = y + size + 80;
    } else if (design.visuals.moon && moonState && ["full_moon", "new_moon", "daily_sky", "collective_reading"].includes(ctx.eventType)) {
      const r = design.aspect === "portrait" ? (T.id === "lunar_field" ? 285 : 230) : 200;
      const cy = S.y + r + (T.id === "orbit_signal" ? 140 : 90);
      parts.push(moonDisc(moonState, { mode: "hero", x: A.width / 2, y: cy,
        light: TOKENS.moonLight, dark: TOKENS.moonDark, rim: TOKENS.moonRim }));
      visualBottom = cy + r + 60;
    } else if (design.visuals.diagram && ingress) {
      const cy = S.y + 240;
      parts.push(ingressDiagram(ingress.planet, ingress.sign, { x: A.width / 2, y: cy,
        color: TOKENS.muted, accent: TOKENS.accent, ink: TOKENS.ink, glyphSize: 120, span: 560 }));
      visualBottom = cy + 180;
    } else if (["mercury_rx", "mercury_direct"].includes(ctx.eventType)) {
      const cy = S.y + 220;
      parts.push(planetGlyph("Mercury", { x: A.width / 2 - 80, y: cy - 80, size: 160, color: TOKENS.ink }));
      if (ctx.eventType === "mercury_rx") parts.push(retroGlyph({ x: A.width / 2 + 96, y: cy + 20, size: 56, color: TOKENS.accent }));
      visualBottom = cy + 160;
    } else {
      // Fallback anchor: the axis motif, kept below the badge line.
      if (T.id !== "orbit_signal") parts.push(axisMotif({ x: S.x + 30, y: S.y + 460, length: 260 }));
      visualBottom = S.y + 300;
    }
    const heroFont = ["celestial_editorial", "orbit_signal", "planetary_grid"].includes(T.id) ? "sans" : "serif";
    const heroTiers = T.id === "orbit_signal" ? [116, 98, 78]
      : T.id === "celestial_editorial" ? [106, 90, 72] : [96, 82, 68];
    const fit = fitText(heading, { tiers: heroTiers, maxLines: SAFE_LIMITS.headlineLines, width: S.w, font: heroFont });
    if (fit.overflow) warnings.push("Headline exceeds the hero safe area — shorten it or switch template.");
    // The headline block (plus its dateline) is CLAMPED above the footer: a
    // two-line headline must never push the dateline into the brand row.
    const hasDate = Boolean(periodLabel);
    const blockH = (fit.lines.length - 1) * fit.size * 1.18 + (hasDate ? 62 : 0);
    const headY = Math.min(Math.max(visualBottom + fit.size, A.footerY - 200 - blockH), A.footerY - 70 - blockH);
    parts.push(textBlock(fit, { x: anchorX, y: headY, font: heroFont === "sans" ? TOKENS.sans : TOKENS.serif,
      color: TOKENS.ink, anchor, lineGap: 1.18, weight: heroFont === "sans" ? "700" : null }));
    if (hasDate) {
      parts.push(`<text x="${anchorX}" y="${headY + (fit.lines.length - 1) * fit.size * 1.18 + 56}" text-anchor="${anchor}" font-family="${TOKENS.sans}" font-size="30" letter-spacing="2" fill="${TOKENS.body}">${esc(periodLabel)}${ctx.facts?.approximate ? " (approximate)" : ""}</text>`);
    }
  }

  else if (role === "fact" || role === "explain" || role === "method" || role === "signal") {
    parts.push(eventBadge(ctx.slide?.heading || "", { x: S.x, y: S.y + 10, color: TOKENS.brand, font: 30 }));
    let cursorY = S.y + 90;
    if (role === "signal" && design.visuals.moon && moonState) {
      parts.push(moonDisc(moonState, { mode: "inline", x: S.x + 92, y: cursorY + 70,
        light: TOKENS.moonLight, dark: TOKENS.moonDark, rim: TOKENS.moonRim }));
      const sky = ctx.facts?.sky_at_event || {};
      const phaseBits = [ctx.facts?.moon_phase_name, sky.moon_sign || ctx.facts?.moon_sign].filter(Boolean).join(" · ");
      if (phaseBits) parts.push(`<text x="${S.x + 210}" y="${cursorY + 60}" font-family="${TOKENS.serif}" font-size="44" fill="${TOKENS.ink}">${esc(phaseBits)}</text>`);
      if (Number.isFinite(ctx.facts?.illumination_percent)) {
        parts.push(`<text x="${S.x + 210}" y="${cursorY + 108}" font-family="${TOKENS.sans}" font-size="28" fill="${TOKENS.body}">${Math.round(ctx.facts.illumination_percent)}% illuminated · ${ctx.facts.is_waxing ? "waxing" : "waning"}</text>`);
      }
      cursorY += 230;
    } else if (role === "fact" && ctx.eventType === "full_moon" && design.visuals.diagram) {
      parts.push(oppositionDiagram({ x: A.width / 2, y: cursorY + 40, span: 460, color: TOKENS.muted, accent: TOKENS.accent }));
      cursorY += 140;
    } else if (role === "fact" && design.visuals.moon && moonState && ["full_moon", "new_moon"].includes(ctx.eventType)) {
      parts.push(moonDisc(moonState, { mode: "mini", x: S.x + 28, y: cursorY + 10,
        light: TOKENS.moonLight, dark: TOKENS.moonDark, rim: TOKENS.moonRim }));
      cursorY += 90;
    } else if (role === "fact" && ingress && design.visuals.diagram) {
      parts.push(ingressDiagram(ingress.planet, ingress.sign, { x: A.width / 2, y: cursorY + 40,
        color: TOKENS.muted, accent: TOKENS.accent, ink: TOKENS.ink, glyphSize: 72, span: 440 }));
      cursorY += 160;
    }
    const fit = fitText(body, { tiers: [44, 40, 36], maxLines: SAFE_LIMITS.bodyLines, width: S.w, font: "sans" });
    if (fit.overflow) warnings.push(`Slide ${ctx.slideIndex + 1} body exceeds the safe area — tighten the copy.`);
    parts.push(textBlock(fit, { x: S.x, y: cursorY + fit.size, font: TOKENS.sans, color: TOKENS.body, lineGap: 1.4 }));
    let stripShown = false;
    if ((design.density === "data" || role === "signal" || semanticRole === "evidence") && design.visuals.strip && Array.isArray(ctx.sky) && ctx.sky.length) {
      // The strip is sized from its own row count and sits clear of both the
      // footer and the body copy. Square shows six bodies — the template
      // decides what is appropriate (§10) — portrait has room for all ten.
      const maxBodies = design.aspect === "portrait" ? 10 : 6;
      const shown = ctx.sky.slice(0, maxBodies);
      const rows = Math.ceil(shown.length / 2);
      const stripY = A.footerY - 60 - rows * 66;
      const strip = skyStrip(shown, { x: S.x, y: stripY, columns: 2,
        cellWidth: S.w / 2, cellHeight: 66, showDegree: true, color: TOKENS.ink, subColor: TOKENS.muted, glyphSize: 34, font: 26 });
      if (strip) { parts.push(strip.markup); stripShown = true; }
    }
    // The metadata row yields to a rendered strip — the strip already IS the
    // astronomical metadata, and two layers of it collide.
    if (!stripShown) parts.push(metadataRow(ctx, S.x, A.footerY - 64));
  }

  else if (role === "symbolic") {
    const signName = ctx.facts?.sky_at_event?.moon_sign || (ingress && ingress.sign) || null;
    if (signName && ZODIAC_GLYPHS[signName]) {
      parts.push(`<g opacity="0.16">${zodiacGlyph(signName, { x: A.width - S.x - 300, y: S.y + 40, size: 320, color: TOKENS.accent })}</g>`);
      parts.push(zodiacGlyph(signName, { x: S.x, y: S.y - 10, size: 44, color: TOKENS.accent }));
      parts.push(`<text x="${S.x + 58}" y="${S.y + 24}" font-family="${TOKENS.sans}" font-size="30" letter-spacing="3" fill="${TOKENS.brand}">${esc(signName.toUpperCase())}</text>`);
    }
    parts.push(`<text x="${S.x}" y="${S.y + 110}" font-family="${TOKENS.serif}" font-size="52" fill="${TOKENS.ink}">${esc(ctx.slide?.heading || "")}</text>`);
    const fit = fitText(body, { tiers: [42, 38, 34], maxLines: SAFE_LIMITS.bodyLines, width: S.w - 60, font: "sans" });
    if (fit.overflow) warnings.push(`Slide ${ctx.slideIndex + 1} body exceeds the safe area — tighten the copy.`);
    parts.push(textBlock(fit, { x: S.x, y: S.y + 200, font: TOKENS.sans, color: TOKENS.body, lineGap: 1.45 }));
  }

  else if (role === "reflection" || role === "takeaway") {
    parts.push(eventBadge(ctx.slide?.heading || "Notice", { x: A.width / 2, y: S.y + 40, font: 28 })
      .replace("<text ", `<text text-anchor="middle" `));
    const fit = fitText(body, { tiers: [60, 52, 44], maxLines: 6, width: S.w - 80, font: "serif" });
    if (fit.overflow) warnings.push(`Slide ${ctx.slideIndex + 1} reflection exceeds the safe area.`);
    const blockH = fit.lines.length * fit.size * 1.3;
    const startY = (A.height - blockH) / 2 + fit.size * 0.6;
    parts.push(textBlock(fit, { x: A.width / 2, y: startY, font: TOKENS.serif, color: TOKENS.ink, anchor: "middle", lineGap: 1.3 }));
    if (T.id !== "orbit_signal") parts.push(axisMotif({ x: S.x + 30, y: A.footerY - 90, length: 180 }));
  }

  else if (role === "cta") {
    // Close on the canonical mark, without repeating the wordmark. The
    // footer follows the same mark-only treatment selected by the founder.
    parts.push(orbitLogo({ x: A.width / 2, y: A.height / 2 - 210,
      scale: 0.72, compact: true, anchor: "middle" }));
    const fit = fitText(body || ctx.cta || "", { tiers: [48, 42, 36], maxLines: 3, width: S.w - 120, font: "serif" });
    parts.push(textBlock(fit, { x: A.width / 2, y: A.height / 2 - 40, font: TOKENS.serif, color: TOKENS.ink, anchor: "middle", lineGap: 1.3 }));
    // The axis motif closes the arc from the lower-left, clear of the copy.
    if (T.id !== "orbit_signal") parts.push(axisMotif({ x: S.x + 30, y: A.footerY - 90, length: 200 }));
  }

  else if (role === "the_sky" || role === "your_sky") {
    const label = role === "the_sky" ? "THE SKY" : "YOUR SKY";
    parts.push(`<text x="${S.x}" y="${S.y + 20}" font-family="${TOKENS.sans}" font-size="34" letter-spacing="8" fill="${TOKENS.accent}">${esc(label)}</text>`);
    parts.push(`<line x1="${S.x}" y1="${S.y + 44}" x2="${S.x + 220}" y2="${S.y + 44}" stroke="${TOKENS.accentDeep}" stroke-width="3"/>`);
    if (role === "the_sky" && design.visuals.strip && Array.isArray(ctx.sky) && ctx.sky.length) {
      const strip = skyStrip(ctx.sky, { x: S.x, y: S.y + 90, columns: 2, cellWidth: S.w / 2,
        cellHeight: 66, color: TOKENS.ink, subColor: TOKENS.muted, glyphSize: 32, font: 26 });
      if (strip) parts.push(strip.markup);
    }
    if (role === "your_sky") {
      // Generic, clearly illustrative chart geometry — never real user data.
      const cx = A.width / 2, cy = S.y + 250, r = 130;
      parts.push(`<g aria-label="Illustrative chart wheel">`
        + `<circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="${TOKENS.line}" stroke-width="2"/>`
        + `<circle cx="${cx}" cy="${cy}" r="${r * 0.62}" fill="none" stroke="${TOKENS.line}" stroke-width="1.5"/>`
        + [0, 30, 60, 90, 120, 150].map((deg) => { const a = deg * Math.PI / 180;
          return `<line x1="${cx - r * Math.cos(a)}" y1="${cy - r * Math.sin(a)}" x2="${cx + r * Math.cos(a)}" y2="${cy + r * Math.sin(a)}" stroke="${TOKENS.line}" stroke-width="1"/>`; }).join("")
        + `<circle cx="${cx + r * 0.8}" cy="${cy - r * 0.35}" r="6" fill="${TOKENS.accent}"/>`
        + `<text x="${cx}" y="${cy + r + 40}" text-anchor="middle" font-family="${TOKENS.sans}" font-size="22" fill="${TOKENS.muted}">Illustrative chart — not a real person's data</text>`
        + `</g>`);
    }
    const bodyStart = role === "the_sky" ? A.footerY - 330 : S.y + 470;
    const fit = fitText(body, { tiers: [40, 36, 32], maxLines: 6, width: S.w, font: "sans" });
    if (fit.overflow) warnings.push(`Slide ${ctx.slideIndex + 1} body exceeds the safe area.`);
    parts.push(textBlock(fit, { x: S.x, y: bodyStart, font: TOKENS.sans, color: TOKENS.body, lineGap: 1.4 }));
  }

  parts.push(footer(design.aspect, { page: ctx.slideIndex + 1, total: ctx.total,
    dateShort, calculated: design.metadata.calculated, design }));

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${A.width} ${A.height}" width="${A.width}" height="${A.height}" role="img" aria-label="${esc(`Orbit Axis slide ${ctx.slideIndex + 1} of ${ctx.total}`)}">`
    + `<title>${esc(heading || `Slide ${ctx.slideIndex + 1}`)}</title>`
    + parts.join("") + `</svg>`;
  return { svg, warnings };
}

/**
 * Render a whole post. Returns { slides: [{svg, warnings}], warnings } —
 * per-slide warnings collected once for the desk's constraint panel.
 */
export function renderPost(post, ctx) {
  const design = normalizeDesign(post.design || ctx?.design || {}, ctx?.eventType, post.format);
  const slides = (post.slides || []).map((slide, i) => renderSlide({
    aspect: design.aspect, design,
    eventType: ctx?.eventType, title: ctx?.title, facts: ctx?.facts, sky: ctx?.sky,
    headline: post.reading?.theme || post.headline, cta: post.cta, reading: post.reading,
    slide, slideIndex: i, total: post.slides.length,
  }));
  return { design, slides, warnings: slides.flatMap((s, i) => s.warnings) };
}
