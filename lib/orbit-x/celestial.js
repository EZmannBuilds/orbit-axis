// Orbit X :: the celestial iconography system (Dev Update 5.1).
//
// EVERY MARK IS A DETERMINISTIC SVG PATH. No Unicode glyph rendering, no
// fonts, no external icon service: a planet glyph drawn from path data looks
// identical on every machine that ever rasterises it, which is the whole
// point of a brand system. Each glyph is authored in a 100×100 box, centred
// on (50,50), stroke-drawn at a shared weight — the "instrument" register of
// the Orbit visual language, not typography.
//
// THE MOON IS DATA, NEVER DECORATION. moonDisc() renders the illumination
// the engine calculated — continuously, not in eight steps — and refuses to
// invent a phase when none is supplied. This module is pure: no imports, no
// DOM, no clock, so it runs identically in Node tests and the desk browser.

const esc = (t) => String(t ?? "").replace(/[&<>"']/g,
  (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

/** Shared drawing constants: one stroke weight, one cap style, everywhere. */
export const GLYPH_BOX = 100;
export const GLYPH_STROKE = 7;

/* ── Planet glyphs ──────────────────────────────────────────────────────────
   Keys match the engine's planet names exactly (sky.planets). Each entry is
   { paths: [d…], circles: [{cx,cy,r,fill?}…], label } in the 100×100 box.  */
export const PLANET_GLYPHS = Object.freeze({
  Sun: {
    label: "Sun",
    circles: [{ cx: 50, cy: 50, r: 30 }, { cx: 50, cy: 50, r: 7, fill: true }],
    paths: [],
  },
  Moon: {
    label: "Moon",
    circles: [],
    // Crescent: outer arc left, inner arc back — filled, the one solid glyph.
    paths: ["M 60 12 A 40 40 0 1 0 60 88 A 31 31 0 1 1 60 12 Z"],
    filled: true,
  },
  Mercury: {
    label: "Mercury",
    circles: [{ cx: 50, cy: 48, r: 17 }],
    paths: ["M 50 65 V 92", "M 38 80 H 62", "M 33 12 A 17 17 0 0 0 67 12"],
  },
  Venus: {
    label: "Venus",
    circles: [{ cx: 50, cy: 36, r: 22 }],
    paths: ["M 50 58 V 92", "M 36 77 H 64"],
  },
  Mars: {
    label: "Mars",
    circles: [{ cx: 42, cy: 60, r: 22 }],
    paths: ["M 58 44 L 82 20", "M 62 18 H 84 V 40"],
  },
  Jupiter: {
    label: "Jupiter",
    circles: [],
    paths: ["M 16 66 H 76", "M 60 30 V 92", "M 16 66 C 16 44 26 18 44 18 C 56 18 60 32 58 44"],
  },
  Saturn: {
    label: "Saturn",
    circles: [],
    paths: ["M 36 10 V 46", "M 24 22 H 50",
      "M 36 46 C 44 34 66 36 68 52 C 70 68 52 72 50 84 C 49 90 54 94 60 92"],
  },
  Uranus: {
    label: "Uranus",
    circles: [{ cx: 50, cy: 76, r: 12 }, { cx: 50, cy: 76, r: 3.5, fill: true }],
    paths: ["M 28 12 V 50", "M 72 12 V 50", "M 28 32 H 72", "M 50 32 V 64"],
  },
  Neptune: {
    label: "Neptune",
    circles: [],
    paths: ["M 28 16 C 28 42 38 52 50 52 C 62 52 72 42 72 16",
      "M 50 12 V 70", "M 36 70 H 64", "M 50 70 V 92",
      "M 22 22 L 28 16 L 34 22", "M 44 18 L 50 12 L 56 18", "M 66 22 L 72 16 L 78 22"],
  },
  Pluto: {
    label: "Pluto",
    circles: [{ cx: 50, cy: 30, r: 11 }],
    paths: ["M 26 24 C 26 48 36 58 50 58 C 64 58 74 48 74 24",
      "M 50 58 V 80", "M 38 70 H 62"],
  },
});

/* ── Zodiac glyphs ─────────────────────────────────────────────────────────
   Keys are the engine's sign names. Geometric interpretations drawn through
   the Orbit instrument language, not typographic clones.                   */
export const ZODIAC_GLYPHS = Object.freeze({
  Aries: {
    label: "Aries",
    paths: ["M 50 90 V 38 C 50 20 40 12 31 12 C 19 12 14 24 17 34",
      "M 50 38 C 50 20 60 12 69 12 C 81 12 86 24 83 34"],
  },
  Taurus: {
    label: "Taurus",
    circles: [{ cx: 50, cy: 62, r: 24 }],
    paths: ["M 20 14 C 24 32 36 40 50 40 C 64 40 76 32 80 14"],
  },
  Gemini: {
    label: "Gemini",
    paths: ["M 20 16 C 32 25 68 25 80 16", "M 20 84 C 32 75 68 75 80 84",
      "M 37 23 V 77", "M 63 23 V 77"],
  },
  Cancer: {
    label: "Cancer",
    circles: [{ cx: 30, cy: 36, r: 13 }, { cx: 70, cy: 64, r: 13 }],
    paths: ["M 42 30 C 58 18 82 24 88 40", "M 58 70 C 42 82 18 76 12 60"],
  },
  Leo: {
    label: "Leo",
    circles: [{ cx: 30, cy: 66, r: 13 }],
    paths: ["M 42 60 C 36 32 48 14 60 14 C 72 14 78 28 71 42 C 65 54 60 64 64 74 C 67 82 78 82 82 74"],
  },
  Virgo: {
    label: "Virgo",
    paths: ["M 14 76 V 34 C 14 26 25 26 25 34 V 76",
      "M 25 42 C 25 26 36 26 36 34 V 76",
      "M 36 42 C 36 26 47 26 47 34 V 66",
      "M 47 42 C 47 30 60 28 64 40 C 68 52 62 66 48 76 C 56 80 66 80 72 74",
      "M 64 40 C 66 56 62 70 52 84"],
  },
  Libra: {
    label: "Libra",
    paths: ["M 16 84 H 84",
      "M 16 62 H 34 C 28 56 26 46 31 38 C 38 26 62 26 69 38 C 74 46 72 56 66 62 H 84"],
  },
  Scorpio: {
    label: "Scorpio",
    paths: ["M 14 72 V 30 C 14 22 25 22 25 30 V 72",
      "M 25 38 C 25 22 36 22 36 30 V 72",
      "M 36 38 C 36 22 47 22 47 30 V 62 C 47 76 56 82 66 78 L 80 70",
      "M 80 56 V 70 H 66"],
  },
  Sagittarius: {
    label: "Sagittarius",
    paths: ["M 20 80 L 80 20", "M 56 20 H 80 V 44", "M 34 46 L 56 68"],
  },
  Capricorn: {
    label: "Capricorn",
    circles: [{ cx: 68, cy: 68, r: 13 }],
    paths: ["M 12 26 C 18 18 28 20 30 30 L 36 54",
      "M 36 54 L 44 24 C 46 15 56 15 58 24 L 62 46 C 64 56 62 66 56 74 C 50 82 40 84 32 80"],
  },
  Aquarius: {
    label: "Aquarius",
    paths: ["M 14 42 L 30 28 L 46 42 L 62 28 L 78 42",
      "M 14 70 L 30 56 L 46 70 L 62 56 L 78 70"],
  },
  Pisces: {
    label: "Pisces",
    paths: ["M 32 12 C 16 32 16 68 32 88", "M 68 12 C 84 32 84 68 68 88", "M 24 50 H 76"],
  },
});

export const PLANET_NAMES = Object.freeze(Object.keys(PLANET_GLYPHS));
export const ZODIAC_NAMES = Object.freeze(Object.keys(ZODIAC_GLYPHS));

/** Retrograde mark: a drawn ℞ — R with the crossed leg, same box rules. */
const RETRO_GLYPH = Object.freeze({
  label: "retrograde",
  paths: ["M 30 88 V 14 H 54 C 74 14 74 48 54 48 H 30", "M 46 48 L 72 88", "M 52 66 L 78 44"],
});

function glyphBody(def, color) {
  const stroke = `stroke="${color}" stroke-width="${GLYPH_STROKE}" stroke-linecap="round" stroke-linejoin="round" fill="none"`;
  const circles = (def.circles || []).map((c) =>
    `<circle cx="${c.cx}" cy="${c.cy}" r="${c.r}" ${c.fill ? `fill="${color}" stroke="none"` : stroke}/>`).join("");
  const paths = (def.paths || []).map((d) =>
    `<path d="${d}" ${def.filled ? `fill="${color}" stroke="none"` : stroke}/>`).join("");
  return circles + paths;
}

/**
 * One glyph as a positioned SVG group.
 * Unknown names return an empty string — a missing mark, never an invented one.
 */
export function glyph(kind, name, { x = 0, y = 0, size = 44, color = "#f4f2fa", title = null } = {}) {
  const table = kind === "planet" ? PLANET_GLYPHS : kind === "zodiac" ? ZODIAC_GLYPHS
    : kind === "retro" ? { [name]: RETRO_GLYPH } : null;
  const def = table?.[name];
  if (!def) return "";
  const s = size / GLYPH_BOX;
  return `<g transform="translate(${x} ${y}) scale(${s})" role="img" aria-label="${esc(title || def.label)}">`
    + `<title>${esc(title || def.label)}</title>${glyphBody(def, color)}</g>`;
}

export const planetGlyph = (name, opts) => glyph("planet", name, opts);
export const zodiacGlyph = (name, opts) => glyph("zodiac", name, opts);
export const retroGlyph = (opts) => glyph("retro", "retro", { ...opts, title: "retrograde" });

/* ── The Moon, as calculated ──────────────────────────────────────────────── */

export const MOON_MODES = Object.freeze({
  hero: { r: 200 },
  inline: { r: 92 },
  mini: { r: 26 },
});

/**
 * A deterministic instrument-style lunar disc.
 *
 * @param {object} state  { illumination_percent: 0–100, waxing: boolean }
 * @param {object} opts   { mode, x, y, light, dark, rim }
 * Renders illumination continuously: the terminator is a half-ellipse whose
 * minor radius is |2f−1|·r, bulging toward or away from the lit limb.
 * Waxing lights the right limb (northern-hemisphere convention, stated in
 * the docs); waning lights the left.
 */
export function moonDisc(state, {
  mode = "inline", x = 0, y = 0,
  light = "#e8e4f6", dark = "#171b2c", rim = "#3a3f5c",
} = {}) {
  const pct = Number(state?.illumination_percent);
  if (!Number.isFinite(pct)) return ""; // no data, no moon — never a fake one
  const f = Math.max(0, Math.min(100, pct)) / 100;
  const waxing = state?.waxing !== false; // default waxing when unstated
  const { r } = MOON_MODES[mode] || MOON_MODES.inline;
  const rimW = Math.max(1.5, r * 0.02);

  let lit = "";
  if (f >= 0.995) {
    lit = `<circle cx="0" cy="0" r="${r}" fill="${light}"/>`;
  } else if (f > 0.005) {
    const side = waxing ? 1 : -1;              // +1 lights the right limb
    const rx = Math.abs(2 * f - 1) * r;        // terminator half-ellipse
    const termSweep = f > 0.5 ? (side === 1 ? 1 : 0) : (side === 1 ? 0 : 1);
    lit = `<path d="M 0 ${-r} A ${r} ${r} 0 0 ${side === 1 ? 1 : 0} 0 ${r}`
      + ` A ${rx} ${r} 0 0 ${termSweep} 0 ${-r} Z" fill="${light}"/>`;
  }
  const glow = mode === "hero" && f >= 0.995
    ? `<circle cx="0" cy="0" r="${r * 1.12}" fill="none" stroke="${light}" stroke-opacity="0.14" stroke-width="${r * 0.10}"/>`
    : "";
  return `<g transform="translate(${x} ${y})" role="img" aria-label="Moon, ${Math.round(pct)}% illuminated">`
    + `<title>Moon, ${Math.round(pct)}% illuminated, ${waxing ? "waxing" : "waning"}</title>`
    + glow
    + `<circle cx="0" cy="0" r="${r}" fill="${dark}"/>`
    + lit
    + `<circle cx="0" cy="0" r="${r}" fill="none" stroke="${rim}" stroke-width="${rimW}"/>`
    + `</g>`;
}

/* ── Current Sky strip ────────────────────────────────────────────────────── */

/**
 * Rows of "glyph + sign" for the supplied bodies, laid out in columns.
 *
 * @param {Array} planets   [{ name, sign, degrees, retrograde }] — engine data
 *                          passed through; nothing here computes astronomy.
 * @param {object} opts     bodies (names to show), columns, cell sizing,
 *                          showDegree, x, y, width
 * Missing bodies are skipped silently: an absent fact renders as absence.
 */
export function skyStrip(planets, {
  bodies = null, columns = 5, x = 0, y = 0, cellWidth = 168, cellHeight = 64,
  showDegree = false, color = "#f4f2fa", subColor = "#8e93a8", glyphSize = 30, font = 24,
} = {}) {
  const list = (planets || []).filter((p) => p && PLANET_GLYPHS[p.name] && p.sign
    && (!bodies || bodies.includes(p.name)));
  if (!list.length) return "";
  const cells = list.map((p, i) => {
    const col = i % columns, row = Math.floor(i / columns);
    const cx = col * cellWidth, cy = row * cellHeight;
    const label = `${p.sign}${showDegree && Number.isFinite(p.degrees) ? ` ${p.degrees}°` : ""}`;
    return `<g transform="translate(${cx} ${cy})">`
      + planetGlyph(p.name, { x: 0, y: 4, size: glyphSize, color })
      + `<text x="${glyphSize + 12}" y="${glyphSize * 0.72 + 4}" font-size="${font}" fill="${subColor}">${esc(label)}</text>`
      + (p.retrograde ? retroGlyph({ x: glyphSize + 16 + label.length * font * 0.52, y: 8, size: font * 0.72, color: subColor }) : "")
      + `</g>`;
  }).join("");
  const rows = Math.ceil(list.length / columns);
  return { markup: `<g transform="translate(${x} ${y})" aria-label="Current sky positions">${cells}</g>`,
    height: rows * cellHeight, count: list.length };
}

/* ── Small instrument furniture ──────────────────────────────────────────── */

/** Event badge: subordinate metadata label, letterspaced smallcaps style. */
export function eventBadge(text, { x = 0, y = 0, color = "#b9a7ff", font = 26 } = {}) {
  if (!text) return "";
  return `<text x="${x}" y="${y}" font-size="${font}" letter-spacing="6" fill="${color}">${esc(String(text).toUpperCase())}</text>`;
}

/** The 62° axis motif: Orbit's signature line, one dot at the origin. */
export function axisMotif({ x = 140, y = 940, length = 260, color = "#4a28b8", dot = "#7657e8" } = {}) {
  const rad = -62 * Math.PI / 180;
  const x2 = x - length * Math.cos(rad) * -1;
  const y2 = y + length * Math.sin(rad);
  return `<line x1="${x}" y1="${y}" x2="${x2}" y2="${y2}" stroke="${color}" stroke-width="3"/>`
    + `<circle cx="${x}" cy="${y}" r="10" fill="${dot}"/>`;
}

/** Sun–Moon opposition: the astronomical structure of a Full Moon, as a
 *  simple diagram — two glyphs, one measured line. Not a chart wheel. */
export function oppositionDiagram({ x = 0, y = 0, span = 420, color = "#8e93a8",
  accent = "#7657e8", glyphSize = 40 } = {}) {
  const half = span / 2;
  return `<g transform="translate(${x} ${y})" aria-label="Sun opposite Moon">`
    + `<line x1="${-half + glyphSize * 0.7}" y1="0" x2="${half - glyphSize * 0.7}" y2="0" stroke="${color}" stroke-width="2" stroke-dasharray="2 8"/>`
    + `<circle cx="0" cy="0" r="4" fill="${accent}"/>`
    + planetGlyph("Sun", { x: -half - glyphSize / 2, y: -glyphSize / 2, size: glyphSize, color })
    + planetGlyph("Moon", { x: half - glyphSize / 2, y: -glyphSize / 2, size: glyphSize, color })
    + `<text x="0" y="34" text-anchor="middle" font-size="22" fill="${color}">180°</text>`
    + `</g>`;
}

/** PLANET → SIGN movement grammar for ingress posts: two anchors on an arc. */
export function ingressDiagram(planetName, signName, { x = 0, y = 0, span = 460,
  color = "#8e93a8", accent = "#7657e8", ink = "#f4f2fa", glyphSize = 56 } = {}) {
  if (!PLANET_GLYPHS[planetName] || !ZODIAC_GLYPHS[signName]) return "";
  const half = span / 2;
  return `<g transform="translate(${x} ${y})" aria-label="${esc(planetName)} enters ${esc(signName)}">`
    + `<path d="M ${-half + glyphSize} 10 Q 0 ${-span * 0.22} ${half - glyphSize} 10" fill="none" stroke="${color}" stroke-width="2" stroke-dasharray="2 8"/>`
    + `<circle cx="${half - glyphSize}" cy="10" r="5" fill="${accent}"/>`
    + planetGlyph(planetName, { x: -half - glyphSize / 2 + glyphSize * 0.5, y: -glyphSize / 2 + 10, size: glyphSize, color: ink })
    + zodiacGlyph(signName, { x: half - glyphSize / 2, y: -glyphSize / 2 + 10, size: glyphSize, color: accent })
    + `</g>`;
}
