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

/** Canonical Orbit Axis mark + wordmark lockup. Geometry mirrors the shipped
 * brand SVG; templates may place or scale this group but never distort it. */
export function orbitLogo({ x = 0, y = 0, scale = 1, compact = false,
  mark = "#7657e8", ink = "#f4f2fa", brand = "#b9a7ff", anchor = "start" } = {}) {
  const wordX = compact ? 0 : 154;
  const width = compact ? 128 : 470;
  const shift = anchor === "middle" ? -width / 2 : anchor === "end" ? -width : 0;
  return `<g role="img" aria-label="Orbit Axis" transform="translate(${x + shift} ${y}) scale(${scale})">`
    + `<title>Orbit Axis</title>`
    + `<g fill="none" stroke="${esc(mark)}" stroke-linecap="round">`
    + `<circle cx="64" cy="64" r="35" stroke-width="8"/>`
    + `<path d="M37 115 91 13" stroke-width="7"/></g>`
    + `<circle cx="64" cy="64" r="7" fill="${esc(ink)}" stroke="#080a12" stroke-width="2"/>`
    + `<circle cx="89" cy="40" r="8" fill="${esc(brand)}"/>`
    + (compact ? "" : `<text x="${wordX}" y="79" font-family="-apple-system, 'Helvetica Neue', Arial, sans-serif" font-size="39" letter-spacing="5" fill="${esc(ink)}">ORBIT AXIS</text>`)
    + `</g>`;
}

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
   OpenMoji Zodiac line artwork, adapted from the official black SVG assets:
   https://github.com/hfg-gmuend/openmoji/tree/master/black/svg

   The original 72×72 SVGs are CC BY-SA 4.0. Orbit uses the exact sign paths
   from each SVG's `line-supplement` group, crops away the emoji container,
   and applies the caller's brand color. See public/brand/zodiac/ATTRIBUTION.md.
   These adapted glyph definitions remain CC BY-SA 4.0.                  */
const OPENMOJI_ZODIAC_BOX = Object.freeze({ x: 12, y: 12, size: 48 });
export const ZODIAC_GLYPHS = Object.freeze({
  Aries: {
    label: "Aries", codePoint: "2648", box: OPENMOJI_ZODIAC_BOX, strokeWidth: 3,
    paths: ["m36 48.84c3.087-16.36 6.337-26.33 11.64-25.68 2.611 0.586 3.711 3.609 2.58 5.817",
      "m36 48.84c-3.087-16.36-6.337-26.33-11.64-25.68-2.611 0.586-3.711 3.609-2.58 5.817"],
  },
  Taurus: {
    label: "Taurus", codePoint: "2649", box: OPENMOJI_ZODIAC_BOX, strokeWidth: 3,
    circles: [{ cx: 36.01, cy: 39.47, r: 8.651 }],
    paths: ["m51.42 24.1c-2.202-0.5966-4.541 0.248-5.854 2.113-2.709 5.178-9.561 4.558-9.561 4.558s-6.852 0.5902-9.561-4.588c-1.313-1.865-3.653-2.709-5.855-2.112"],
  },
  Gemini: {
    label: "Gemini", codePoint: "264A", box: OPENMOJI_ZODIAC_BOX, strokeWidth: 3,
    paths: ["m22.86 21.4s3.659 6.388 13.14 6.32c9.481 0.06785 13.14-6.32 13.14-6.32",
      "m49.14 50.6s-3.659-6.388-13.14-6.32c-9.481-0.0677-13.14 6.32-13.14 6.32"],
    lines: [{ x1: 40.32, x2: 40.32, y1: 44.16, y2: 27.85 },
      { x1: 30.32, x2: 30.32, y1: 44.85, y2: 27.85 }],
  },
  Cancer: {
    label: "Cancer", codePoint: "264B", box: OPENMOJI_ZODIAC_BOX, strokeWidth: 3,
    paths: ["m33.61 30.26a5.559 5.559 0 1 1-5.559-5.558 5.56 5.56 0 0 1 5.559 5.558z",
      "m25.7 25.26s10.84-4.787 23.81 3.012",
      "m38.39 41a5.559 5.559 0 1 1 5.56 5.56 5.561 5.561 0 0 1-5.56-5.56z",
      "m46.3 46s-10.84 4.787-23.81-3.012"],
  },
  Leo: {
    label: "Leo", codePoint: "264C", box: OPENMOJI_ZODIAC_BOX, strokeWidth: 3,
    circles: [{ cx: 29.13, cy: 39.22, r: 5.5 }],
    paths: ["m34.44 37.72c-0.735-3.912-1.132-7.879-1.186-11.86 0-5.93 9.487-8.301 11.86-2.372 1.888 7.085-11.79 27.93-2.372 28.46 4.744 0 3.988-5.356 3.988-5.356"],
  },
  Virgo: {
    label: "Virgo", codePoint: "264D", box: OPENMOJI_ZODIAC_BOX, strokeWidth: 3,
    paths: ["m35.23 44.91 0.125-13.68",
      "m26.31 44.91v-14.03c-0.1453-1.558-0.6264-3.32-2.212-5.754",
      "m26.31 31.22s.766-6.485 4.523-6.437 4.405 4.103 4.523 6.437c.1828-2.264.9161-6.54 4.478-6.544 3.562-.0042 4.31 3.958 4.478 6.544l.000115 13.68c.3653 2.829 2.394 5.11 3.829 5.112",
      "m48.141 50.012c3.042.4881 3.964-9.966 1.124-10.73-3.348-.5788-5.387 7.691-7.545 13.16"],
  },
  Libra: {
    label: "Libra", codePoint: "264E", box: OPENMOJI_ZODIAC_BOX, strokeWidth: 3,
    paths: ["m30.53 39.5h-10.53", "m52 39.5h-9.53", "m52 44.5h-32",
      "m30.53 39.5a8.443 8.443 0 0 1-1.83-9.201 8.443 8.443 0 0 1 7.8-5.212 8.443 8.443 0 0 1 7.8 5.212 8.443 8.443 0 0 1-1.83 9.201"],
  },
  Scorpio: {
    label: "Scorpio", codePoint: "264F", box: OPENMOJI_ZODIAC_BOX, strokeWidth: 3,
    paths: ["m49.97 47.17 3.731 3.757-3.731 3.757", "m35.23 44.91.125-13.68",
      "m26.31 44.91v-14.03c-.1453-1.558-.6264-3.32-2.212-5.754",
      "m26.31 31.23s.766-6.485 4.523-6.437 4.405 4.103 4.523 6.437c.1828-2.264.9161-6.54 4.478-6.544 3.562-.0042 4.31 3.958 4.478 6.544l.000142 13.68s.1299 6.155 5.921 6.004"],
  },
  Sagittarius: {
    label: "Sagittarius", codePoint: "2650", box: OPENMOJI_ZODIAC_BOX, strokeWidth: 3,
    paths: ["m37.81 24.19h9.996v9.996"],
    lines: [{ x1: 24.19, x2: 47.81, y1: 47.81, y2: 24.19 },
      { x1: 38.41, x2: 28.42, y1: 43.44, y2: 33.46 }],
  },
  Capricorn: {
    label: "Capricorn", codePoint: "2651", box: OPENMOJI_ZODIAC_BOX, strokeWidth: 3,
    circles: [{ cx: 45.09, cy: 44.55, r: 5.591 }],
    paths: ["m39.5 42.55c-1.351 4.101-1.244 3.865-3.324 8.743",
      "m28.06 44.89v-14.03c-.1453-1.558-.6264-3.32-2.212-5.754",
      "m28.06 30.86c.2335-2.264 1.17-6.54 5.72-6.544 4.55-.0042 5.505 3.958 5.719 6.544l.000182 13.68"],
  },
  Aquarius: {
    label: "Aquarius", codePoint: "2652", box: OPENMOJI_ZODIAC_BOX, strokeWidth: 3,
    paths: ["m52.05 41.23s-.0772-3.854-3.211-3.802c0 0-3.21-.0224-3.21 3.622s-3.211 3.622-3.211 3.622c-3.133.0508-3.21-3.763-3.21-3.763.0001-3.683-3.21-3.66-3.21-3.66-3.134-.0517-3.211 3.75-3.211 3.75-.0001 3.669-3.211 3.647-3.211 3.647-3.134.0508-3.211-3.776-3.211-3.776 0-3.695-3.209-3.673-3.209-3.673-3.135-.0508-3.211 3.802-3.211 3.802",
      "m52.05 31.36s-.0772-3.854-3.211-3.802c0 0-3.21-.0224-3.21 3.622s-3.211 3.622-3.211 3.622c-3.133.0508-3.21-3.763-3.21-3.763.0001-3.683-3.21-3.66-3.21-3.66-3.134-.0517-3.211 3.75-3.211 3.75-.0001 3.669-3.211 3.647-3.211 3.647-3.134.0508-3.211-3.776-3.211-3.776 0-3.695-3.209-3.673-3.209-3.673-3.135-.0508-3.211 3.802-3.211 3.802"],
  },
  Pisces: {
    label: "Pisces", codePoint: "2653", box: OPENMOJI_ZODIAC_BOX, strokeWidth: 3,
    paths: ["m23.39 50.52s7.057-4.043 6.983-14.52c.0732-10.48-6.983-14.52-6.983-14.52",
      "m48.61 21.48s-7.057 4.043-6.984 14.52c-.0719 10.48 6.984 14.52 6.984 14.52"],
    lines: [{ x1: 48.18, x2: 23.82, y1: 36.52, y2: 36.52 }],
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
  const stroke = `stroke="${color}" stroke-width="${def.strokeWidth || GLYPH_STROKE}" stroke-linecap="round" stroke-linejoin="round" fill="none"`;
  const circles = (def.circles || []).map((c) =>
    `<circle cx="${c.cx}" cy="${c.cy}" r="${c.r}" ${c.fill ? `fill="${color}" stroke="none"` : stroke}/>`).join("");
  const paths = (def.paths || []).map((d) =>
    `<path d="${d}" ${def.filled ? `fill="${color}" stroke="none"` : stroke}/>`).join("");
  const lines = (def.lines || []).map((line) =>
    `<line x1="${line.x1}" y1="${line.y1}" x2="${line.x2}" y2="${line.y2}" ${stroke}/>`).join("");
  return circles + paths + lines;
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
  const box = def.box || { x: 0, y: 0, size: GLYPH_BOX };
  const s = size / box.size;
  return `<g transform="translate(${x} ${y}) scale(${s}) translate(${-box.x} ${-box.y})" role="img" aria-label="${esc(title || def.label)}">`
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
