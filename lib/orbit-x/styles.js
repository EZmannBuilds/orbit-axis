// Orbit X :: the three styled template families (Dev Update 6.2).
//
//   living_atlas   light paper, ink and terracotta line art: an astrolabe
//   after_dark     midnight, ivory and bright accents: a precise star map
//   cosmic_press   cream, charcoal and one spot colour: two-ink riso print
//
// WHAT THEY ARE FOR. The first look was one dark violet card repeated; a grid
// of it reads as a single post. These families give the profile rhythm while
// still reading as one brand: every post carries the same mark, the same
// facts, the same calculated label, and a colour that MEANS something.
//
// COLOUR MEANS A KIND OF POST (KIND_ACCENTS below), so a 3x3 alternates on its
// own: Moon phase and the daily reading, transit or ingress and the weekly
// reading, retrograde, methodology and fact, and the monthly reading.
//
// EVERY DIAGRAM IS GEOMETRY OF ENGINE FACTS. The wheel places each body at its
// ecliptic longitude (the engine's own number, or sign plus degree for packets
// saved before longitudes were passed through), draws real aspects between
// them, and highlights the Sun and Moon signs of a lunation. With no positions
// there is no wheel: the layout falls back to type. Nothing is decoration that
// looks like data, and there is no random starfield.
//
// THREE COVER LAYOUTS PER FAMILY (design.variant): 0 a big numeral from the
// post's own date, 1 a diagram, 2 type alone. A layout with nothing real to
// show (no date, no positions) falls back to type, never to an invented
// figure.
//
// ACCESSIBILITY IS CHECKED WHEN DRAWN. Every text run states its background;
// a ratio under 4.5:1 for body text or 3:1 for large text comes back as a
// named warning, which refuses a proposal and fails a test. Text that sits on
// a colour fill is always large; small text sits on the page colour.
//
// WHAT THEY AVOID, DELIBERATELY: purple-to-navy gradients, glass panels,
// sparkles, glossy 3D planets, a centred headline above three cards, and one
// typeface everywhere. Type is set from the real faces' metrics
// (font-metrics.js), not a guessed width factor.
//
// Isomorphic like templates.js: no DOM, no clock, no randomness. The server's
// PNGs use the bundled fonts; the desk preview falls back to system fonts
// (named in each stack), so it is approximate where the PNG is exact.

import { FONT_METRICS } from "./font-metrics.js";
import { luminance, contrastRatio, mix, softOf, isLargeText, requiredContrast } from "./styles-colour.js";
import { shadowFor, shadowDef, castShadow, starField, sphere, moonSphere, ringedPlanet, armillary, assetFor } from "./assets.js";
export { luminance, contrastRatio, mix, softOf, isLargeText, requiredContrast };
import { planetGlyph, zodiacGlyph, retroGlyph, moonDisc, orbitLogo, PLANET_GLYPHS, ZODIAC_GLYPHS } from "./celestial.js";

const esc = (t) => String(t ?? "").replace(/[&<>"']/g,
  (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const round = (n) => Math.round(n * 100) / 100;

/* ── Colour (in styles-colour.js, shared with the depth assets) ──────────── */

/* ── Post kinds, and the colour each one means ────────────────────────────── */

export const KINDS = Object.freeze(["moon", "transit", "retrograde", "fact", "monthly"]);

export function kindFor({ eventType, facts, reading } = {}) {
  if (["full_moon", "new_moon"].includes(eventType)) return "moon";
  if (eventType === "sun_ingress") return "transit";
  if (["mercury_rx", "mercury_direct"].includes(eventType)) return "retrograde";
  if (eventType === "collective_reading") {
    const type = reading?.type || facts?.period?.type;
    if (type === "monthly") return "monthly";
    if (type === "weekly") return "transit";
    return "moon"; // the daily reading is led by the Moon
  }
  return "fact"; // methodology, explainers, the shared sky
}

export const KIND_LABELS = Object.freeze({
  moon: "Moon", transit: "Transit", retrograde: "Retrograde", fact: "Method", monthly: "Month",
});

/* ── The families ─────────────────────────────────────────────────────────── */

const FONT = Object.freeze({
  Fraunces: ["Fraunces", "Fraunces, Georgia, 'Times New Roman', serif"],
  "DM Sans": ["DM Sans", "'DM Sans', Arial, Helvetica, sans-serif"],
  "Orbit Coord Mono": ["Orbit Coord Mono", "'Orbit Coord Mono', 'Courier New', monospace"],
  Manrope: ["Manrope", "Manrope, Arial, Helvetica, sans-serif"],
  Newsreader: ["Newsreader", "Newsreader, Georgia, 'Times New Roman', serif"],
  "Space Grotesk": ["Space Grotesk", "'Space Grotesk', Arial, Helvetica, sans-serif"],
});

export const STYLE_FAMILIES = Object.freeze({
  living_atlas: Object.freeze({
    id: "living_atlas", name: "Living Atlas", version: "v1",
    blurb: "Light paper, ink and terracotta line art: an astrolabe drawn from the real chart geometry.",
    page: "#F6F1E7", ink: "#182C39", paper: "#F6F1E7", dark: "#182C39",
    palette: Object.freeze({ terracotta: "#C65B43", cobalt: "#2859A6", sage: "#6C8669", yellow: "#F1C75B", rose: "#E8B5C0" }),
    accents: Object.freeze({ moon: "yellow", transit: "cobalt", retrograde: "terracotta", fact: "sage", monthly: "rose" }),
    display: "Fraunces", text: "DM Sans", mono: "Orbit Coord Mono",
  }),
  after_dark: Object.freeze({
    id: "after_dark", name: "After Dark Observatory", version: "v1",
    blurb: "Midnight, ivory and bright accents: a precise star map with hairline geometry.",
    page: "#101B29", ink: "#F7F0DE", paper: "#101B29", dark: "#070D14",
    palette: Object.freeze({ coral: "#F28C69", ice: "#9CC9DB", orchid: "#D9B9E8", amber: "#EBC95D", mint: "#8FB89F" }),
    accents: Object.freeze({ moon: "amber", transit: "ice", retrograde: "coral", fact: "mint", monthly: "orchid" }),
    display: "Newsreader", text: "Manrope", mono: "Orbit Coord Mono",
  }),
  cosmic_press: Object.freeze({
    id: "cosmic_press", name: "Cosmic Press", version: "v1",
    blurb: "Cream, charcoal and one spot colour: a two-ink risograph with registration offset and halftone.",
    page: "#FFF8E9", ink: "#242020", paper: "#FFF8E9", dark: "#242020",
    palette: Object.freeze({ vermilion: "#C43D3B", blue: "#285D83", ochre: "#D9A72E", forest: "#53765A", lilac: "#D9B5E8" }),
    accents: Object.freeze({ moon: "ochre", transit: "blue", retrograde: "vermilion", fact: "forest", monthly: "lilac" }),
    display: "Newsreader", text: "Space Grotesk", mono: "Orbit Coord Mono",
  }),
});
export const STYLE_FAMILY_IDS = Object.freeze(Object.keys(STYLE_FAMILIES));

export const COVER_LAYOUTS = Object.freeze(["numeral", "diagram", "type"]);

export function accentFor(family, kind) {
  const f = STYLE_FAMILIES[family];
  return f.palette[f.accents[kind] || f.accents.fact];
}

/** The colour a text run on `bg` should use, among the family's two inks. */
function onColor(family, bg) {
  const f = STYLE_FAMILIES[family];
  return contrastRatio(f.ink, bg) >= contrastRatio(f.paper, bg) ? f.ink : f.paper;
}

/* ── Measured type ────────────────────────────────────────────────────────── */

const metricFor = (family, weight) => FONT_METRICS[`${family}|${weight >= 600 ? 700 : 400}`];

export function measure(text, family, weight, size, letterSpacing = 0) {
  const m = metricFor(family, weight);
  let w = 0;
  for (const ch of String(text)) w += (m.w[ch] ?? m.def) * size + letterSpacing;
  return w;
}

/**
 * Fit text into a box with the real face's widths. Tries each size, widest
 * first; overflow comes back as a flag, never as silent shrinking.
 */
export function fit(text, { family, weight = 400, tiers, width, maxLines, lineHeight = 1.25,
  letterSpacing = 0, maxHeight = Infinity }) {
  const paragraphs = String(text || "").split("\n");
  const wrap = (size) => {
    const lines = [];
    for (const para of paragraphs) {
      const words = para.trim().split(/\s+/).filter(Boolean);
      if (!words.length) { if (para === "" && lines.length) lines.push(""); continue; }
      let line = "";
      for (const word of words) {
        const trial = line ? `${line} ${word}` : word;
        if (!line || measure(trial, family, weight, size, letterSpacing) <= width * 0.985) line = trial;
        else { lines.push(line); line = word; }
      }
      if (line) lines.push(line);
    }
    return lines;
  };
  for (const size of tiers) {
    const lines = wrap(size);
    const widest = Math.max(0, ...lines.map((l) => measure(l, family, weight, size, letterSpacing)));
    const height = lines.length * size * lineHeight;
    if (lines.length <= maxLines && height <= maxHeight && widest <= width) return { lines, size, overflow: false, height };
  }
  const size = tiers[tiers.length - 1];
  const lines = wrap(size).slice(0, Math.min(maxLines, Math.max(1, Math.floor(maxHeight / (size * lineHeight)))));
  return { lines, size, overflow: true, height: lines.length * size * lineHeight };
}

/* ── Geometry of engine facts ─────────────────────────────────────────────── */

const SIGNS = Object.freeze(["Aries", "Taurus", "Gemini", "Cancer", "Leo", "Virgo", "Libra", "Scorpio", "Sagittarius", "Capricorn", "Aquarius", "Pisces"]);
export const WHEEL_BODIES = Object.freeze(["Sun", "Moon", "Mercury", "Venus", "Mars", "Jupiter", "Saturn", "Uranus", "Neptune", "Pluto"]);

/** Ecliptic longitude of a body, in degrees: the engine's number when the
 *  packet carries it, otherwise sign plus degree (older packets). Null when
 *  there is nothing real to place. */
export function longitudeOf(p) {
  if (Number.isFinite(p?.longitude)) return p.longitude >= 0 && p.longitude < 360 ? p.longitude : ((p.longitude % 360) + 360) % 360;
  const i = SIGNS.indexOf(p?.sign);
  if (i < 0 || !Number.isFinite(p?.degrees)) return null;
  return i * 30 + p.degrees + (Number.isFinite(p.minutes) ? p.minutes / 60 : 0.5);
}

export function wheelBodies(planets) {
  const list = Array.isArray(planets) ? planets : [];
  return WHEEL_BODIES.map((name) => list.find((p) => p?.name === name)).filter(Boolean)
    .map((p) => ({ name: p.name, sign: p.sign, degrees: p.degrees, retrograde: p.retrograde === true, lon: longitudeOf(p) }))
    .filter((p) => p.lon !== null);
}

const ASPECTS = Object.freeze([
  { name: "conjunction", angle: 0, orb: 3 }, { name: "sextile", angle: 60, orb: 2 },
  { name: "square", angle: 90, orb: 3 }, { name: "trine", angle: 120, orb: 3 }, { name: "opposition", angle: 180, orb: 3 },
]);

/** The real aspects among the bodies: angular separation against fixed orbs.
 *  Arithmetic on the engine's longitudes, nothing more. Tightest first. */
export function aspectsAmong(bodies, limit = 8) {
  const found = [];
  for (let i = 0; i < bodies.length; i += 1) {
    for (let j = i + 1; j < bodies.length; j += 1) {
      let d = Math.abs(bodies[i].lon - bodies[j].lon) % 360;
      if (d > 180) d = 360 - d;
      for (const a of ASPECTS) {
        const off = Math.abs(d - a.angle);
        if (off <= a.orb) found.push({ a: bodies[i], b: bodies[j], aspect: a.name, orb: off });
      }
    }
  }
  return found.sort((x, y) => x.orb - y.orb).slice(0, limit);
}

/** Longitude to a point on a circle: 0 degrees Aries at 9 o'clock, increasing
 *  counterclockwise, the convention of a printed chart. */
const at = (cx, cy, r, lon) => [cx - r * Math.cos((lon * Math.PI) / 180), cy + r * Math.sin((lon * Math.PI) / 180)];

/** Spread display angles so glyphs do not overlap; the true longitude is
 *  still marked on the ring by a tick. */
function spread(bodies, minGap) {
  const items = [...bodies].sort((a, b) => a.lon - b.lon).map((b) => ({ ...b, shown: b.lon }));
  for (let pass = 0; pass < 24; pass += 1) {
    for (let i = 0; i < items.length; i += 1) {
      const a = items[i];
      const b = items[(i + 1) % items.length];
      let gap = (b.shown - a.shown + 360) % 360;
      if (items.length === 1) gap = 360;
      if (gap < minGap) {
        const push = (minGap - gap) / 2;
        a.shown = (a.shown - push + 360) % 360;
        b.shown = (b.shown + push) % 360;
      }
    }
  }
  return items;
}

function dayNumber(iso) { const m = /^\d{4}-\d{2}-(\d{2})/.exec(String(iso || "")); return m ? Number(m[1]) : null; }
const MONTH3 = Object.freeze(["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"]);
const MONTHS = Object.freeze(["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"]);

/** The big figure of a numeral cover, from the post's own date. Null when the
 *  post has no date of its own (methodology), so the layout falls back. */
export function numeralFor({ facts, reading, eventType } = {}) {
  const period = facts?.period;
  if (period?.type === "monthly" || reading?.type === "monthly") {
    const m = /^\d{4}-(\d{2})/.exec(period?.start_date || "");
    return m ? { big: MONTH3[Number(m[1]) - 1], note: String(Number(period.start_date.slice(0, 4))) } : null;
  }
  if (period?.type === "weekly" || reading?.type === "weekly") {
    const a = dayNumber(period?.start_date);
    const b = dayNumber(period?.end_date);
    const m = /^\d{4}-(\d{2})/.exec(period?.start_date || "");
    return a && b && m ? { big: `${a}–${b}`, note: MONTHS[Number(m[1]) - 1] } : null;
  }
  const iso = facts?.date || facts?.local_date || period?.start_date;
  const d = dayNumber(iso);
  const m = /^\d{4}-(\d{2})/.exec(iso || "");
  if (!d || !m || eventType === "educational") return null;
  return { big: String(d), note: MONTHS[Number(m[1]) - 1] };
}

/* ── The renderer ─────────────────────────────────────────────────────────── */

const DIMS = Object.freeze({ portrait: { w: 1080, h: 1350 }, square: { w: 1080, h: 1080 } });
const MARGIN = 84;

class Canvas {
  constructor(family, accent, dims, warnings) {
    this.f = STYLE_FAMILIES[family];
    this.family = family;
    this.accent = accent;
    this.w = dims.w;
    this.h = dims.h;
    this.parts = [];
    this.defs = [];
    this.warnings = warnings;
    this.bg = this.f.page;
    this.soft = softOf(this.f.ink, this.f.page);
  }
  add(svg) { this.parts.push(svg); }
  /** A unique id inside this slide. */
  uid(prefix) { this.n = (this.n || 0) + 1; return `${prefix}${this.n}`; }
  /** This family's cast shadow, with its filter registered. */
  shadow() {
    if (this._shadow) return this._shadow;
    const sh = shadowFor(this.family, this.f);
    const id = this.uid("orbit-shadow-");
    const def = shadowDef(id, sh);
    if (def) this.defs.push(def);
    this._shadow = { sh, id };
    return this._shadow;
  }
  /** Draw one text block and check its contrast against what it sits on. */
  text(lines, { x, y, role, size, weight = 400, fill, on, anchor = "start", lineHeight = 1.25, letterSpacing = 0, upper = false, label = "text" }) {
    const family = this.f[role];
    const fillColor = fill || onColor(this.family, on || this.bg);
    const bg = on || this.bg;
    const need = requiredContrast(size, weight);
    const got = contrastRatio(fillColor, bg);
    if (got < need) this.warnings.push(`Low contrast for ${label}: ${got.toFixed(1)}:1 where ${need}:1 is needed.`);
    const [, stack] = FONT[family];
    const out = [].concat(lines).map((line, i) => `<text x="${round(x)}" y="${round(y + i * size * lineHeight)}" font-family="${esc(stack)}"`
      + ` font-size="${size}" font-weight="${weight}"${letterSpacing ? ` letter-spacing="${letterSpacing}"` : ""}`
      + `${anchor !== "start" ? ` text-anchor="${anchor}"` : ""} fill="${fillColor}">${esc(upper ? String(line).toUpperCase() : line)}</text>`).join("");
    this.add(out);
  }
}

/** Header: a colour chip and the kind label, in ink on the page. */
function header(c, ctx, h) {
  const y = MARGIN + 6;
  const accent = c.accent;
  const chip = c.family === "cosmic_press"
    ? `<rect x="${MARGIN}" y="${y - 20}" width="26" height="26" fill="${accent}" stroke="${c.f.ink}" stroke-width="2"/>`
    : c.family === "after_dark"
      ? `<circle cx="${MARGIN + 11}" cy="${y - 7}" r="11" fill="${accent}"/>`
      : `<circle cx="${MARGIN + 11}" cy="${y - 7}" r="11" fill="${accent}" stroke="${c.f.ink}" stroke-width="2"/>`;
  c.add(c.bg === accent ? `<circle cx="${MARGIN + 11}" cy="${y - 7}" r="11" fill="none" stroke="${onColor(c.family, accent)}" stroke-width="3"/>` : chip);
  c.text(h.label, { x: MARGIN + 42, y, role: "mono", size: 24, weight: 700, letterSpacing: 3, upper: true, label: "the kind label" });
  const markInk = onColor(c.family, c.markOn || c.bg);
  c.add(orbitLogo({ x: c.w - MARGIN, y: y - 32, scale: 0.5, compact: true, anchor: "end",
    mark: markInk, ink: markInk, brand: c.bg === accent ? markInk : accent }));
}

function footer(c, ctx, h) {
  const y = c.h - MARGIN + 18;
  const parts = [];
  if (ctx.design?.metadata?.calculated !== false) parts.push("calculated");
  if (h.dateShort) parts.push(h.dateShort);
  c.text(parts.join(" · "), { x: MARGIN, y, role: "mono", size: 22, weight: 700, upper: true, letterSpacing: 2, label: "the footer", fill: c.soft });
  if (ctx.total > 1) c.text(`${String(ctx.slideIndex + 1).padStart(2, "0")}/${String(ctx.total).padStart(2, "0")}`,
    { x: c.w - MARGIN, y, role: "mono", size: 22, weight: 700, anchor: "end", letterSpacing: 2, label: "the page number", fill: c.soft });
}

/** Family ornament drawn first, under everything. */
function ground(c, kind) {
  const { f, w, h, accent } = c;
  c.add(`<rect width="${w}" height="${h}" fill="${f.page}"/>`);
  if (c.family === "living_atlas") {
    // A ruled paper margin and registration ticks, like a survey sheet.
    c.add(`<rect x="36" y="36" width="${w - 72}" height="${h - 72}" fill="none" stroke="${f.ink}" stroke-width="2"/>`);
    for (let i = 1; i < 12; i += 1) {
      const x = 36 + ((w - 72) / 12) * i;
      c.add(`<line x1="${round(x)}" y1="36" x2="${round(x)}" y2="${i % 3 === 0 ? 54 : 46}" stroke="${f.ink}" stroke-width="2"/>`);
      c.add(`<line x1="${round(x)}" y1="${h - 36}" x2="${round(x)}" y2="${h - (i % 3 === 0 ? 54 : 46)}" stroke="${f.ink}" stroke-width="2"/>`);
    }
  } else if (c.family === "after_dark") {
    // Corner brackets and a hairline: a plate in an observatory log.
    const L = 56;
    for (const [x, y, dx, dy] of [[40, 40, 1, 1], [w - 40, 40, -1, 1], [40, h - 40, 1, -1], [w - 40, h - 40, -1, -1]]) {
      c.add(`<path d="M${x} ${y + dy * L}V${y}H${x + dx * L}" fill="none" stroke="${f.ink}" stroke-width="2" opacity="0.6"/>`);
    }
  } else {
    // Cosmic Press: print marks and a halftone ready to be used as a fill.
    c.defs.push(`<pattern id="ht-${c.family}" width="14" height="14" patternUnits="userSpaceOnUse" patternTransform="rotate(22)">`
      + `<circle cx="7" cy="7" r="3.2" fill="${f.ink}" fill-opacity="0.55"/></pattern>`);
    for (const [x, y] of [[48, 48], [w - 48, 48], [48, h - 48], [w - 48, h - 48]]) {
      c.add(`<g stroke="${f.ink}" stroke-width="2" opacity="0.7"><line x1="${x - 11}" y1="${y}" x2="${x + 11}" y2="${y}"/><line x1="${x}" y1="${y - 11}" x2="${x}" y2="${y + 11}"/><circle cx="${x}" cy="${y}" r="6" fill="none"/></g>`);
    }
  }
}

/* ── The wheel ────────────────────────────────────────────────────────────── */

function wheel(c, { cx, cy, r, bodies, highlight = [], aspects = true, glyphSize = null }) {
  const { f, accent } = c;
  const ring = r * 0.80;
  const inner = r * 0.52;
  const line = f.ink;
  const gs = glyphSize || Math.max(24, r * 0.1);
  const press = c.family === "cosmic_press";
  const dark = c.family === "after_dark";
  const g = [];
  // Highlighted signs (a lunation's Sun and Moon signs): real, sign-level.
  for (const sign of highlight) {
    const i = SIGNS.indexOf(sign);
    if (i < 0) continue;
    const a0 = i * 30;
    const [x0, y0] = at(cx, cy, r, a0);
    const [x1, y1] = at(cx, cy, r, a0 + 30);
    const [x2, y2] = at(cx, cy, ring, a0 + 30);
    const [x3, y3] = at(cx, cy, ring, a0);
    g.push(`<path d="M${round(x0)} ${round(y0)}A${r} ${r} 0 0 0 ${round(x1)} ${round(y1)}L${round(x2)} ${round(y2)}A${ring} ${ring} 0 0 1 ${round(x3)} ${round(y3)}Z" fill="${accent}"${press ? ' opacity="0.9"' : ""}/>`);
  }
  g.push(`<circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="${line}" stroke-width="${dark ? 1.5 : 2.5}"/>`);
  g.push(`<circle cx="${cx}" cy="${cy}" r="${ring}" fill="none" stroke="${line}" stroke-width="${dark ? 1 : 2}"/>`);
  g.push(`<circle cx="${cx}" cy="${cy}" r="${inner}" fill="none" stroke="${line}" stroke-width="${dark ? 1 : 2}"${dark ? ' opacity="0.7"' : ""}/>`);
  // Degree scale: ticks every 5 degrees, longer every 10, on the inside of the sign ring.
  for (let d = 0; d < 360; d += 5) {
    const [x0, y0] = at(cx, cy, ring, d);
    const [x1, y1] = at(cx, cy, ring - (d % 10 === 0 ? r * 0.045 : r * 0.025), d);
    g.push(`<line x1="${round(x0)}" y1="${round(y0)}" x2="${round(x1)}" y2="${round(y1)}" stroke="${line}" stroke-width="${dark ? 1 : 1.5}"/>`);
  }
  for (let i = 0; i < 12; i += 1) {
    const [x0, y0] = at(cx, cy, r, i * 30);
    const [x1, y1] = at(cx, cy, ring, i * 30);
    g.push(`<line x1="${round(x0)}" y1="${round(y0)}" x2="${round(x1)}" y2="${round(y1)}" stroke="${line}" stroke-width="${dark ? 1.5 : 2.5}"/>`);
    const [gx, gy] = at(cx, cy, (r + ring) / 2, i * 30 + 15);
    const hi = highlight.includes(SIGNS[i]);
    g.push(zodiacGlyph(SIGNS[i], { x: round(gx - gs * 0.5), y: round(gy - gs * 0.5), size: gs,
      color: hi ? onColor(c.family, accent) : line, title: SIGNS[i] }));
  }
  // Aspect lines between the true positions, on the inner circle.
  if (aspects && bodies.length > 1) {
    for (const a of aspectsAmong(bodies)) {
      const [x0, y0] = at(cx, cy, inner, a.a.lon);
      const [x1, y1] = at(cx, cy, inner, a.b.lon);
      g.push(`<line x1="${round(x0)}" y1="${round(y0)}" x2="${round(x1)}" y2="${round(y1)}" stroke="${a.aspect === "opposition" || a.aspect === "square" ? accent : line}" stroke-width="${a.orb < 1 ? 3 : 2}" opacity="${dark ? 0.85 : 0.9}"><title>${esc(`${a.a.name} ${a.aspect} ${a.b.name}`)}</title></line>`);
    }
  }
  // Bodies: a tick at the true longitude, a glyph at a displaced angle.
  const placed = spread(bodies, Math.max(9, (gs * 1.25 * 180) / (Math.PI * (inner + ring) / 2)));
  for (const b of placed) {
    const [tx0, ty0] = at(cx, cy, inner, b.lon);
    const [tx1, ty1] = at(cx, cy, inner - r * 0.05, b.lon);
    g.push(`<line x1="${round(tx0)}" y1="${round(ty0)}" x2="${round(tx1)}" y2="${round(ty1)}" stroke="${line}" stroke-width="3"/>`);
    const [px, py] = at(cx, cy, (inner + ring) / 2 - r * 0.02, b.shown);
    g.push(`<line x1="${round(tx0)}" y1="${round(ty0)}" x2="${round(px)}" y2="${round(py)}" stroke="${line}" stroke-width="1" opacity="0.5"/>`);
    g.push(`<circle cx="${round(px)}" cy="${round(py)}" r="${round(gs * 0.78)}" fill="${accent}" stroke="${line}" stroke-width="${dark ? 1.5 : 2.5}"/>`);
    g.push(planetGlyph(b.name, { x: round(px - gs * 0.5), y: round(py - gs * 0.5), size: gs, color: onColor(c.family, accent),
      title: `${b.name} in ${b.sign} ${b.degrees}°${b.retrograde ? " retrograde" : ""}` }));
  }
  c.add(`<g role="img" aria-label="Zodiac wheel of the calculated positions">${g.join("")}</g>`);
}

/** Draw the depth asset a post earns, centred at (cx, cy) with radius r. */
function drawAsset(c, ctx, { cx, cy, r }) {
  const spec = assetFor({ kind: c.kind, eventType: ctx.eventType, title: ctx.title, facts: ctx.facts });
  const { sh, id: shId } = c.shadow();
  const f = c.f;
  const base = c.accent;
  const idBase = c.uid("orbit-form-");
  const lit = c.family === "after_dark" ? f.ink : mix(f.paper, "#ffffff", 0.3);
  if (spec.type === "moon") {
    c.add(moonSphere({ id: idBase, cx, cy, r, state: spec.state, f, seed: ctx.facts?.date || ctx.eventType || "moon",
      shadow: sh, shadowId: shId, lit, night: mix(f.dark, base, 0.12), texture: c.family !== "cosmic_press" }));
  } else if (spec.type === "sphere") {
    // The Sun is always the family's gold, whatever the post's own colour.
    const body = spec.body === "Sun" ? accentFor(c.family, "moon") : mix(f.ink, f.page, 0.45);
    c.add(sphere({ id: idBase, cx, cy, r: r * 0.86, base: body, f, shadow: sh, shadowId: shId, ring: true,
      surface: spec.body === "Sun" ? "sun" : "rock", texture: c.family !== "cosmic_press", seed: spec.body }));
  } else if (spec.type === "ringed") {
    c.add(ringedPlanet({ id: idBase, cx, cy, r: r * 0.52, base: mix(base, f.dark, 0.15), ringColour: mix(base, "#ffffff", 0.25), f, shadow: sh, shadowId: shId }));
  } else {
    c.add(armillary({ cx, cy, r: r * 0.92, f, colour: c.family === "after_dark" ? f.ink : mix(f.ink, f.page, 0.1), accent: base, shadow: sh, shadowId: shId }));
  }
}

/** Stars in the empty margins, never over type or the wheel. */
function addStars(c, ctx, { area, avoid = [], count, colour = null, opacity = 0.9 }) {
  const dark = c.family === "after_dark";
  const tone = colour || (dark ? c.f.ink : mix(c.f.ink, c.f.page, 0.15));
  c.add(starField(area, { seed: `${ctx.title || ""}|${ctx.facts?.date || ctx.facts?.period?.key || ""}|${ctx.slideIndex}`,
    count: Math.round(count * (dark ? 1 : 0.55)), colour: tone, accent: c.accent, avoid, opacity }));
}

/* ── Slide layouts ────────────────────────────────────────────────────────── */

const COVER_ROLES = new Set(["hero", "cover"]);
const REFLECT_ROLES = new Set(["reflection", "takeaway", "one_sentence", "close"]);
const DATA_ROLES = new Set(["evidence", "movements", "key_dates", "the_sky"]);

function slideClass(ctx) {
  const role = ctx.slide?.role || (ctx.slideIndex === 0 ? "hero" : "explain");
  if (ctx.total === 1 || role === "signal") return "single";
  if (COVER_ROLES.has(role) || ctx.slideIndex === 0) return "cover";
  if (role === "cta") return "cta";
  if (REFLECT_ROLES.has(role)) return "reflect";
  if (DATA_ROLES.has(role)) return "data";
  return "body";
}

/** The two-ink print: the spot colour laid flat, the charcoal ink as a
 *  halftone shifted a few pixels out of register, and a keyline. `shape` draws
 *  the open tag of the same shape at an offset. */
function pressFill(c, shape) {
  c.add(`${shape({ dx: 0, dy: 0 })} fill="${c.accent}"/>`);
  c.add(`${shape({ dx: 10, dy: -9 })} fill="url(#ht-${c.family})"/>`);
  c.add(`${shape({ dx: 0, dy: 0 })} fill="none" stroke="${c.f.ink}" stroke-width="3"/>`);
}

function accentBlock(c, { x, y, w, h }) {
  if (c.family === "cosmic_press") {
    pressFill(c, (a) => `<rect x="${x + a.dx}" y="${y + a.dy}" width="${w}" height="${h}"`, { cx: x + w / 2, cy: y + h / 2 });
  } else if (c.family === "after_dark") {
    c.add(`<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="${c.accent}"/>`);
  } else {
    c.add(`<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="${c.accent}" stroke="${c.f.ink}" stroke-width="2.5"/>`);
  }
}

function coverNumeral(c, ctx, h, num) {
  const pad = MARGIN;
  const wide = c.w - pad * 2;
  const blockH = c.h > 1200 ? 560 : 400;
  const top = c.h > 1200 ? 190 : 170;
  const { sh, id: shId } = c.shadow();
  // The colour block casts a shadow onto the page, like a cut paper plate.
  c.add(castShadow(shId, sh, (dx, dy) => `<rect x="${pad + dx}" y="${top + dy}" width="${wide}" height="${blockH}"/>`));
  accentBlock(c, { x: pad, y: top, w: wide, h: blockH });
  const fitted = fit(num.big, { family: c.f.display, weight: 700, tiers: [440, 380, 320, 270, 230, 190], width: wide - 70, maxLines: 1 });
  if (fitted.overflow) c.warnings.push("Numeral exceeds the cover width.");
  const numeralW = measure(num.big, c.f.display, 700, fitted.size);
  const free = wide - 36 - numeralW;
  if (free > 250) {
    // Room beside a short numeral: the post's depth asset sits on the block.
    drawAsset(c, ctx, { cx: pad + wide - free / 2 - 6, cy: top + blockH * 0.56, r: Math.min(free / 2 - 22, 150) });
  }
  addStars(c, ctx, { area: { x: pad, y: top, w: wide, h: blockH }, avoid: [{ x: pad, y: top, w: numeralW + 70, h: blockH }], count: 6, colour: c.f.dark, opacity: 0.55 });
  const baseY = top + blockH - 70;
  c.text(fitted.lines, { x: pad + 36, y: baseY, role: "display", size: fitted.size, weight: 700, on: c.accent, lineHeight: 1, label: "the cover numeral" });
  c.text(num.note, { x: pad + 40, y: top + 62, role: "mono", size: 28, weight: 700, letterSpacing: 4, upper: true, on: c.accent, label: "the numeral note" });
  return top + blockH;
}

function coverDiagram(c, ctx, h, bodies, highlight) {
  const r = Math.min(c.w / 2 - MARGIN - 20, c.h > 1200 ? 360 : 300);
  const cy = (c.h > 1200 ? 218 : 190) + r;
  // Stars in the margins only: outside the wheel's square, the header, and the text zone.
  addStars(c, ctx, { area: { x: 30, y: 120, w: c.w - 60, h: cy + r + 40 - 120 },
    avoid: [{ x: c.w / 2 - r - 24, y: cy - r - 24, w: r * 2 + 48, h: r * 2 + 48 }], count: 22 });
  wheel(c, { cx: c.w / 2, cy, r, bodies, highlight, glyphSize: r * 0.085 });
  return cy + r + 18;
}

function coverType(c, ctx, h, hook) {
  // Type alone, left aligned, with a flat field of the kind's colour cropped
  // by the edge: no diagram, nothing that could be mistaken for data.
  const cropR = c.h > 1200 ? 330 : 220;
  const cx = c.w - 110;
  const cy = c.h > 1200 ? 330 : 250;
  c.markOn = c.accent; // the mark sits on this field
  const assetR = c.h > 1200 ? 150 : 100;
  const drawOnField = () => drawAsset(c, ctx, { cx: cx - cropR * 0.5, cy: cy + 40, r: assetR });
  if (c.family === "cosmic_press") {
    pressFill(c, (a) => `<circle cx="${cx + a.dx}" cy="${cy + a.dy}" r="${cropR}"`, { cx, cy });
    drawOnField();
    return c.h > 1200 ? 640 : 440;
  } else {
    c.add(`<circle cx="${cx}" cy="${cy}" r="${cropR}" fill="${c.accent}"${c.family === "living_atlas" ? ` stroke="${c.f.ink}" stroke-width="2.5"` : ""}/>`);
    drawOnField();
  }
  addStars(c, ctx, { area: { x: 30, y: 300, w: c.w - 60, h: c.h > 1200 ? 330 : 150 }, avoid: [{ x: cx - cropR - 20, y: cy - cropR - 20, w: cropR * 2 + 40, h: cropR * 2 + 40 }], count: 14 });
  return c.h > 1200 ? 640 : 440;
}

function drawCover(c, ctx, h) {
  const layoutIdx = Number.isInteger(ctx.design?.variant) ? ctx.design.variant : 0;
  let layout = COVER_LAYOUTS[layoutIdx % COVER_LAYOUTS.length];
  const bodies = wheelBodies(h.planets);
  const sky = ctx.facts?.sky_at_event || {};
  const highlight = ["full_moon", "new_moon"].includes(ctx.eventType) ? [sky.moon_sign, sky.sun_sign].filter(Boolean) : [];
  const lunation = highlight.length > 0 && (Number.isFinite(sky.moon_longitude) || Number.isFinite(sky.sun_longitude));
  const lunationBodies = lunation
    ? [["Sun", sky.sun_sign, sky.sun_longitude], ["Moon", sky.moon_sign, sky.moon_longitude]]
      .filter(([, sign, lon]) => sign && Number.isFinite(lon)).map(([name, sign, lon]) => ({ name, sign, degrees: Math.floor(lon % 30), retrograde: false, lon }))
    : [];
  const numeral = numeralFor(ctx);
  const diagramBodies = bodies.length ? bodies : lunationBodies;
  if (layout === "numeral" && !numeral) layout = "type";
  if (layout === "diagram" && !diagramBodies.length && !highlight.length) layout = "type";
  c.layout = layout;

  let bottom;
  if (layout === "numeral") bottom = coverNumeral(c, ctx, h, numeral);
  else if (layout === "diagram") bottom = coverDiagram(c, ctx, h, diagramBodies, highlight);
  else bottom = coverType(c, ctx, h);

  const headline = String(ctx.headline || ctx.slide?.heading || "");
  const room = c.h - MARGIN - 70 - (layout === "type" ? 190 : bottom + 40);
  const hookText = String(ctx.slide?.body || "").trim();
  const hookFit = hookText ? fit(hookText, { family: c.f.text, weight: 400, tiers: [34, 30, 27], width: c.w - MARGIN * 2, maxLines: 2, lineHeight: 1.3 }) : null;
  const hookH = hookFit ? hookFit.height + 26 : 0;
  const type = layout === "type"
    ? fit(headline, { family: c.f.display, weight: 700, tiers: [112, 98, 86, 74, 64, 54], width: c.w - MARGIN * 2 - 40, maxLines: 5, lineHeight: 1.04,
      // From the bottom of the colour field to the footer, less the date line and the hook.
      maxHeight: c.h - MARGIN - 110 - bottom - hookH - (h.periodLabel ? 56 : 0) })
    : fit(headline, { family: c.f.display, weight: 700, tiers: [72, 62, 54, 46], width: c.w - MARGIN * 2, maxLines: 3, lineHeight: 1.08, maxHeight: Math.max(120, room - hookH) });
  if (type.overflow) c.warnings.push("Headline exceeds the hero safe area.");
  const blockH = type.height + hookH + (h.periodLabel ? 56 : 0);
  const startY = layout === "type"
    ? Math.max(bottom, c.h - MARGIN - 80 - blockH) + type.size * 0.86
    : Math.max(bottom + 40 + type.size * 0.86, c.h - MARGIN - 70 - blockH + type.size * 0.86);
  const lh = layout === "type" ? 1.04 : 1.08;
  c.text(type.lines, { x: MARGIN, y: startY, role: "display", size: type.size, weight: 700, lineHeight: lh, label: "the headline" });
  let y = startY + (type.lines.length - 1) * type.size * lh;
  if (h.periodLabel) {
    y += 54;
    c.text(h.periodLabel, { x: MARGIN, y, role: "mono", size: 26, letterSpacing: 2, upper: true, label: "the date line" });
  }
  if (hookFit) {
    y += 52;
    c.text(hookFit.lines, { x: MARGIN, y, role: "text", size: hookFit.size, lineHeight: 1.3, label: "the hook" });
  }
}

/** A line of real coordinates for the foot of a text slide: the Sun and the
 *  Moon as the engine placed them. Empty when the packet carries neither. */
export function coordinateLine(ctx, planets) {
  const find = (name) => (Array.isArray(planets) ? planets : []).find((p) => p?.name === name);
  const sky = ctx.facts?.sky_at_event || {};
  const bit = (name, p, sign, lon) => {
    if (p?.sign && Number.isFinite(p.degrees)) return `${name} ${p.sign} ${String(p.degrees).padStart(2, "0")}°`;
    if (sign && Number.isFinite(lon)) return `${name} ${sign} ${String(Math.floor(lon % 30)).padStart(2, "0")}°`;
    if (sign) return `${name} in ${sign}`;
    return null;
  };
  return [bit("Sun", find("Sun"), sky.sun_sign, sky.sun_longitude), bit("Moon", find("Moon"), sky.moon_sign, sky.moon_longitude)]
    .filter(Boolean).join("  ·  ");
}

function drawBody(c, ctx, h) {
  const heading = String(ctx.slide?.heading || "");
  const top = 230;
  const hf = fit(heading, { family: c.f.display, weight: 700, tiers: [60, 54, 48, 42], width: c.w - MARGIN * 2 - 44, maxLines: 2, lineHeight: 1.1 });
  if (hf.overflow) c.warnings.push("A slide heading is too long.");
  const coords = coordinateLine(ctx, h.planets);
  const footReserve = coords ? 150 : 110;
  // A vertical rule in the kind's colour carries the slide.
  c.add(`<rect x="${MARGIN}" y="${top - 56}" width="10" height="${c.h - top - MARGIN - footReserve + 56}" fill="${c.accent}"${c.family === "cosmic_press" ? ` stroke="${c.f.ink}" stroke-width="2"` : ""}/>`);
  const x = MARGIN + 44;
  c.text(hf.lines, { x, y: top, role: "display", size: hf.size, weight: 700, lineHeight: 1.1, label: "a slide heading" });
  const headBottom = top + (hf.lines.length - 1) * hf.size * 1.1;
  const body = String(ctx.slide?.body || "");
  const room = c.h - MARGIN - footReserve - (headBottom + 56);
  const bf = fit(body, { family: c.f.text, weight: 400, tiers: [62, 56, 50, 44, 40, 36, 32, 30], width: c.w - x - MARGIN, maxLines: 14, lineHeight: 1.38, maxHeight: room });
  if (bf.overflow) c.warnings.push("A slide body is too long for its room.");
  const bodyBottom = headBottom + 56 + bf.size * 0.92 + (bf.lines.length - 1) * bf.size * 1.38;
  c.text(bf.lines, { x, y: headBottom + 56 + bf.size * 0.92, role: "text", size: bf.size, lineHeight: 1.38, label: "a slide body" });
  // What the copy leaves empty gets the depth asset and a few stars, so a
  // short slide is not a void. Only drawn when there is real room.
  const space = c.h - MARGIN - footReserve - bodyBottom - 40;
  if (space > 300) {
    const r = Math.min(space / 2 - 10, 170);
    drawAsset(c, ctx, { cx: c.w - MARGIN - r - 30, cy: bodyBottom + 40 + space / 2, r });
    addStars(c, ctx, { area: { x: x, y: bodyBottom + 30, w: c.w - x - MARGIN, h: space },
      avoid: [{ x: c.w - MARGIN - r * 2 - 70, y: bodyBottom, w: r * 2 + 90, h: space + 40 }], count: 10 });
  }
  if (coords) {
    c.text(coords, { x, y: c.h - MARGIN - 56, role: "mono", size: 24, letterSpacing: 1, upper: true, label: "the coordinates" });
  }
}

function drawReflect(c, ctx, h) {
  // Full-bleed colour: the carousel's turn. Text sits on the fill and is large.
  c.add(`<rect width="${c.w}" height="${c.h}" fill="${c.accent}"/>`);
  if (c.family === "cosmic_press") c.add(`<rect width="${c.w}" height="${c.h}" fill="url(#ht-${c.family})" opacity="0.28"/>`);
  const ink = onColor(c.family, c.accent);
  c.bg = c.accent;
  c.soft = ink;
  const heading = String(ctx.slide?.heading || "");
  c.text(heading, { x: MARGIN, y: 230, role: "mono", size: 26, weight: 700, letterSpacing: 4, upper: true, on: c.accent, fill: ink, label: "a reflection heading" });
  const body = String(ctx.slide?.body || ctx.headline || "");
  const bf = fit(body, { family: c.f.display, weight: 700, tiers: [76, 66, 58, 50, 44], width: c.w - MARGIN * 2, maxLines: 9, lineHeight: 1.16, maxHeight: c.h - 330 - MARGIN - 110 });
  const textBottom = 330 + bf.height;
  if (c.h - MARGIN - 110 - textBottom > 220) {
    addStars(c, ctx, { area: { x: 50, y: textBottom + 30, w: c.w - 100, h: c.h - MARGIN - 110 - textBottom - 30 }, count: 12, colour: ink, opacity: 0.75 });
  }
  if (bf.overflow) c.warnings.push("A reflection is too long for its slide.");
  c.text(bf.lines, { x: MARGIN, y: 330 + bf.size * 0.8, role: "display", size: bf.size, weight: 700, lineHeight: 1.16, on: c.accent, fill: ink, label: "a reflection" });
}

function drawData(c, ctx, h) {
  const bodies = wheelBodies(h.planets);
  const heading = String(ctx.slide?.heading || "");
  const portrait = c.h > 1200;
  const hf = fit(heading, { family: c.f.display, weight: 700, tiers: [52, 46, 40], width: c.w - MARGIN * 2, maxLines: 1, lineHeight: 1.1 });
  c.text(hf.lines, { x: MARGIN, y: 200, role: "display", size: hf.size, weight: 700, label: "a data heading" });
  let body = String(ctx.slide?.body || "").trim();
  // With the wheel and table drawn from the same facts, a text line that only
  // repeats a body's position ("Sun · Scorpio") is redundant; keep the rest
  // (the Moon state, key dates).
  if (bodies.length) {
    body = body.split("\n").filter((line) => !/^(Sun|Moon|Mercury|Venus|Mars|Jupiter|Saturn|Uranus|Neptune|Pluto)\s·/.test(line.trim())).join("\n").trim();
  }
  let y = 250;
  // Body lines (for example the key dates), in mono: they are listings.
  if (body) {
    const bf = fit(body, { family: c.f.mono, weight: 400, tiers: [30, 27, 24], width: c.w - MARGIN * 2, maxLines: portrait ? 7 : 4, lineHeight: 1.45, maxHeight: portrait ? 330 : 150 });
    if (bf.overflow) c.warnings.push("A data slide's listing is too long.");
    c.text(bf.lines, { x: MARGIN, y: y + 22, role: "mono", size: bf.size, lineHeight: 1.45, label: "a listing" });
    y += bf.height + 44;
  }
  if (!bodies.length) return;
  if (portrait) {
    // The wheel centred, the positions in two columns under it.
    const rowH = 46;
    const r = Math.max(120, Math.min(300, (c.h - y - MARGIN - 70 - 5 * rowH - 70) / 2));
    wheel(c, { cx: c.w / 2, cy: y + r + 6, r, bodies, glyphSize: r * 0.095 });
    tableAt(c, bodies, { x: MARGIN, y: y + r * 2 + 76, rows: 5, rowH, cols: 2, colW: (c.w - MARGIN * 2) / 2 });
  } else {
    const r = Math.min(190, (c.h - y - MARGIN - 70) / 2);
    wheel(c, { cx: MARGIN + r + 6, cy: y + r + 10, r, bodies, glyphSize: r * 0.1 });
    tableAt(c, bodies, { x: MARGIN + r * 2 + 70, y: y + 24, rows: 10, rowH: Math.min(36, (2 * r - 10) / 10), cols: 1, colW: 0 });
  }
}

function tableAt(c, bodies, { x, y, rowH, rows, cols, colW }) {
  const size = Math.round(rowH * 0.58);
  bodies.slice(0, rows * cols).forEach((b, i) => {
    const col = Math.floor(i / rows);
    const yy = y + (i % rows) * rowH;
    const xx = x + col * colW;
    c.add(planetGlyph(b.name, { x: round(xx), y: round(yy - rowH * 0.62), size: Math.round(rowH * 0.72), color: c.f.ink, title: b.name }));
    const pos = `${b.sign} ${String(b.degrees).padStart(2, "0")}°`;
    c.text(pos, { x: xx + rowH * 1.1, y: yy, role: "mono", size, label: "a position" });
    if (b.retrograde) c.add(retroGlyph({ x: round(xx + rowH * 1.1 + measure(pos, c.f.mono, 400, size) + 12), y: round(yy - rowH * 0.6), size: Math.round(rowH * 0.62), color: c.f.ink }));
  });
}

function drawCta(c, ctx, h) {
  // The invitation is the one slide set in the ink colour: a quiet full stop.
  c.add(`<rect width="${c.w}" height="${c.h}" fill="${c.f.ink}"/>`);
  c.bg = c.f.ink;
  c.soft = softOf(c.f.page, c.f.ink);
  const text = String(ctx.cta || ctx.slide?.body || ctx.slide?.heading || "Explore the current sky.");
  const bf = fit(text, { family: c.f.display, weight: 700, tiers: [84, 72, 62, 52], width: c.w - MARGIN * 2, maxLines: 5, lineHeight: 1.12, maxHeight: c.h * 0.5 });
  if (bf.overflow) c.warnings.push("The invitation is too long for its slide.");
  const y0 = c.h * 0.36;
  c.text(bf.lines, { x: MARGIN, y: y0, role: "display", size: bf.size, weight: 700, lineHeight: 1.12, fill: c.f.page, label: "the invitation" });
  const ruleY = round(y0 + (bf.lines.length - 1) * bf.size * 1.12 + 44);
  c.add(`<rect x="${MARGIN}" y="${ruleY}" width="220" height="14" fill="${c.accent}"/>`);
  const room = c.h - MARGIN - 110 - (ruleY + 40);
  if (room > 260) {
    const r = Math.min(room / 2 - 10, 190);
    // On the ink slide the asset is drawn in the page colours, shadowless.
    const { sh } = c.shadow();
    const flat = { ...sh, opacity: 0 };
    void flat;
    c.add(armillary({ cx: c.w - MARGIN - r - 20, cy: ruleY + 40 + room / 2, r, f: c.f, colour: c.f.page, accent: c.accent }));
    addStars(c, ctx, { area: { x: MARGIN, y: ruleY + 50, w: c.w - MARGIN * 2 - r * 2 - 60, h: room }, count: 12, colour: c.f.page, opacity: 0.8 });
  }
}

function drawSingle(c, ctx, h) {
  // One image carrying one fact: the wheel (or numeral) over a headline and a body line.
  const bodies = wheelBodies(h.planets);
  const sky = ctx.facts?.sky_at_event || {};
  const highlight = ["full_moon", "new_moon"].includes(ctx.eventType) ? [sky.moon_sign, sky.sun_sign].filter(Boolean) : [];
  let bottom = 150;
  if (bodies.length || highlight.length) {
    const r = Math.min(260, c.w / 2 - MARGIN - 40);
    wheel(c, { cx: c.w / 2, cy: 160 + r, r, bodies, highlight, glyphSize: r * 0.09 });
    bottom = 160 + r * 2 + 40;
  } else {
    const num = numeralFor(ctx);
    if (num) bottom = coverNumeral(c, ctx, h, num) + 10; else bottom = 240;
  }
  const hf = fit(String(ctx.headline || ctx.slide?.heading || ""), { family: c.f.display, weight: 700, tiers: [64, 54, 46], width: c.w - MARGIN * 2, maxLines: 2, lineHeight: 1.08 });
  c.text(hf.lines, { x: MARGIN, y: bottom + hf.size * 0.9, role: "display", size: hf.size, weight: 700, lineHeight: 1.08, label: "the headline" });
  const body = String(ctx.slide?.body || "");
  const by = bottom + hf.size * 0.9 + (hf.lines.length - 1) * hf.size * 1.08 + 52;
  const bf = fit(body, { family: c.f.text, weight: 400, tiers: [34, 30, 27], width: c.w - MARGIN * 2, maxLines: 4, lineHeight: 1.38, maxHeight: c.h - by - MARGIN - 40 });
  if (bf.overflow) c.warnings.push("The fact is too long for a single image.");
  c.text(bf.lines, { x: MARGIN, y: by, role: "text", size: bf.size, lineHeight: 1.38, label: "the fact" });
}

/**
 * Render one slide of a styled family.
 *
 * @param {object} ctx      renderSlide's context (design, facts, slide, ...)
 * @param {object} T        the template entry ({ style: "living_atlas", ... })
 * @param {object} helpers  { badge, dateShort, periodLabel, planets }
 * @returns {{ svg: string, warnings: string[], layout: string, kind: string }}
 */
export function renderStyledSlide(ctx, T, helpers = {}) {
  const family = T.style;
  const warnings = [];
  const dims = DIMS[ctx.design?.aspect] || DIMS.portrait;
  const kind = kindFor(ctx);
  const c = new Canvas(family, accentFor(family, kind), dims, warnings);
  c.kind = kind;
  const label = helpers.badge || KIND_LABELS[kind];
  const h = { label, dateShort: helpers.dateShort || "", periodLabel: helpers.periodLabel || "", planets: helpers.planets || ctx.facts?.planets || ctx.sky || [] };
  const cls = slideClass(ctx);

  ground(c, kind);
  if (cls === "reflect") drawReflect(c, ctx, h);
  else if (cls === "cta") { drawCta(c, ctx, h); }
  else if (cls === "cover") drawCover(c, ctx, h);
  else if (cls === "single") drawSingle(c, ctx, h);
  else if (cls === "data") drawData(c, ctx, h);
  else drawBody(c, ctx, h);

  header(c, ctx, h);
  footer(c, ctx, h);
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${dims.w} ${dims.h}" width="${dims.w}" height="${dims.h}" role="img"`
    + ` aria-label="Orbit Axis slide ${ctx.slideIndex + 1} of ${ctx.total}"><title>${esc(ctx.headline || ctx.title || "Orbit Axis")}</title>`
    + `${c.defs.length ? `<defs>${c.defs.join("")}</defs>` : ""}${c.parts.join("")}</svg>`;
  return { svg, warnings, layout: c.layout || cls, kind };
}

export { PLANET_GLYPHS, ZODIAC_GLYPHS, moonDisc };
