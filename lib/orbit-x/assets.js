// Orbit X :: depth assets for the styled families (Dev Update 6.2, follow-up).
//
// Shaded spheres, a ringed planet, an armillary sphere, a Moon sphere with the
// REAL phase shadow, cast shadows, and star accents. They are drawn as
// 3D-looking forms but they are vector SVG: they export as flat 2D, with no
// raster file, no stock, and no licence to carry. (Blender is not part of the
// build; a modelled asset can replace one of these later without touching the
// templates, because every asset is one function returning an SVG group.)
//
// WHAT IS DATA AND WHAT IS NOT. The Moon sphere's lit part is the engine's
// illumination, drawn with the same terminator geometry as moonDisc. A planet
// sphere is chosen when the post is about that body. The armillary, the ringed
// planet and the stars are ILLUSTRATION: they sit apart from the wheel (the
// only diagram), are never placed inside it, and the stars are a deterministic
// scatter in empty margins seeded by the post, so the same post always draws
// the same sky. Nothing here is positioned to look like a measurement.
//
// SHADOW IS PART OF EACH FAMILY'S VOICE (see shadowFor): Living Atlas casts a
// soft paper shadow, After Dark a deep contact shadow, Cosmic Press a hard
// offset print shadow with no blur.
//
// Isomorphic and deterministic: no clock, no Math.random.

import { mix } from "./styles-colour.js";

const round = (n) => Math.round(n * 100) / 100;

/** A small deterministic generator from a string seed. */
export function seeded(seed) {
  let h = 2166136261;
  for (const ch of String(seed)) { h ^= ch.charCodeAt(0); h = Math.imul(h, 16777619) >>> 0; }
  return () => {
    h ^= h << 13; h >>>= 0; h ^= h >>> 17; h ^= h << 5; h >>>= 0;
    return (h >>> 0) / 4294967296;
  };
}

/* ── Shadows ──────────────────────────────────────────────────────────────── */

/**
 * The shadow style of a family.
 * @returns {{ kind: "soft"|"contact"|"hard", dx: number, dy: number, blur: number, colour: string, opacity: number }}
 */
export function shadowFor(family, f) {
  if (family === "cosmic_press") return { kind: "hard", dx: 12, dy: 12, blur: 0, colour: f.ink, opacity: 0.9 };
  if (family === "after_dark") return { kind: "contact", dx: 10, dy: 16, blur: 14, colour: "#05090f", opacity: 0.75 };
  return { kind: "soft", dx: 8, dy: 14, blur: 12, colour: mix(f.ink, f.page, 0.35), opacity: 0.42 };
}

/** A blur filter definition (unique id), or "" for the hard shadow. */
export function shadowDef(id, sh) {
  if (!sh.blur) return "";
  return `<filter id="${id}" x="-40%" y="-40%" width="180%" height="180%"><feGaussianBlur stdDeviation="${sh.blur}"/></filter>`;
}

/** Draw `shapeFn(offsetX, offsetY)` as a cast shadow, then nothing else. */
export function castShadow(id, sh, shapeFn) {
  const shape = shapeFn(sh.dx, sh.dy).replace("/>", ` fill="${sh.colour}" fill-opacity="${sh.opacity}"${sh.blur ? ` filter="url(#${id})"` : ""}/>`);
  return shape;
}

/* ── Stars ────────────────────────────────────────────────────────────────── */

/** A four-point star as a path, centred, with concave sides. */
function fourPoint(cx, cy, r, waist = 0.22) {
  const w = r * waist;
  return `M${round(cx)} ${round(cy - r)}L${round(cx + w)} ${round(cy - w)}L${round(cx + r)} ${round(cy)}L${round(cx + w)} ${round(cy + w)}`
    + `L${round(cx)} ${round(cy + r)}L${round(cx - w)} ${round(cy + w)}L${round(cx - r)} ${round(cy)}L${round(cx - w)} ${round(cy - w)}Z`;
}

/**
 * A scatter of stars in a rectangle, avoiding rectangles that hold type or the
 * wheel. A few four-point stars, a few eight-point compass stars, and fine
 * dots; sizes vary; the same seed always gives the same sky.
 *
 * @param {{ x:number, y:number, w:number, h:number }} area
 * @param {{ seed: string, count: number, colour: string, avoid?: Array, accent?: string, opacity?: number }} opts
 */
export function starField(area, { seed, count, colour, avoid = [], accent = null, opacity = 0.9 }) {
  const rnd = seeded(`stars:${seed}`);
  const out = [];
  const blocked = (x, y, r) => avoid.some((a) => x + r > a.x && x - r < a.x + a.w && y + r > a.y && y - r < a.y + a.h);
  let tries = 0;
  while (out.length < count && tries < count * 20) {
    tries += 1;
    const x = area.x + rnd() * area.w;
    const y = area.y + rnd() * area.h;
    const roll = rnd();
    const r = roll > 0.86 ? 15 + rnd() * 11 : roll > 0.55 ? 8 + rnd() * 6 : 1.6 + rnd() * 2.4;
    if (blocked(x, y, r + 8)) continue;
    if (r < 5) out.push(`<circle cx="${round(x)}" cy="${round(y)}" r="${round(r)}" fill="${colour}" fill-opacity="${round(0.5 + rnd() * 0.4)}"/>`);
    else {
      const pick = accent && roll > 0.93 ? accent : colour;
      out.push(`<path d="${fourPoint(x, y, r, 0.2 + rnd() * 0.1)}" fill="${pick}" fill-opacity="${round(opacity)}"/>`);
      if (r > 14) out.push(`<path d="${fourPoint(x, y, r * 0.55, 0.3).replace(/Z$/, "Z")}" fill="${pick}" fill-opacity="0.9" transform="rotate(45 ${round(x)} ${round(y)})"/>`);
    }
  }
  return `<g data-orbit-asset="stars" aria-hidden="true">${out.join("")}</g>`;
}

/* ── Shaded forms ─────────────────────────────────────────────────────────── */

/** Light and dark tones around a base colour, inside the family's range. */
function tones(base, f) {
  return { light: mix(base, "#ffffff", 0.38), mid: base, dark: mix(base, f.dark || "#10131a", 0.55), deep: mix(base, f.dark || "#10131a", 0.8) };
}

/**
 * A lit sphere: off-centre highlight, darker limb, optional cast shadow, and
 * an optional surface. "rock" adds a crater field (Mercury), "sun" adds
 * granulation and a hot limb, "gas" adds soft cloud bands. Surfaces are
 * illustration of the body, not data. `texture: false` draws no filter.
 */
export function sphere({ id, cx, cy, r, base, f, shadow = null, shadowId = null, ring = false, surface = null, texture = true, seed = "body" }) {
  const t = tones(base, f);
  const parts = [];
  if (shadow) parts.push(castShadow(shadowId, shadow, (dx, dy) => `<ellipse cx="${round(cx + dx)}" cy="${round(cy + dy + r * 0.12)}" rx="${round(r * 0.98)}" ry="${round(r * 0.9)}"/>`));
  const defs = [`<radialGradient id="${id}" cx="34%" cy="30%" r="82%"><stop offset="0" stop-color="${t.light}"/>`
    + `<stop offset="0.45" stop-color="${t.mid}"/><stop offset="1" stop-color="${t.dark}"/></radialGradient>`,
  `<clipPath id="${id}-disc"><circle cx="${round(cx)}" cy="${round(cy)}" r="${round(r)}"/></clipPath>`,
  `<radialGradient id="${id}-term" cx="34%" cy="30%" r="86%"><stop offset="0.5" stop-color="${t.deep}" stop-opacity="0"/><stop offset="1" stop-color="${t.deep}" stop-opacity="0.55"/></radialGradient>`];
  const box = `x="${round(cx - r)}" y="${round(cy - r)}" width="${round(r * 2)}" height="${round(r * 2)}" filterUnits="userSpaceOnUse"`;
  if (surface === "sun" && texture) {
    defs.push(`<filter id="${id}-gran" ${box}><feTurbulence type="fractalNoise" baseFrequency="${round(26 / r)}" numOctaves="3" seed="9"/><feColorMatrix values="0 0 0 0 0.45  0 0 0 0 0.12  0 0 0 0 0.02  1.7 0 0 0 -0.62"/></filter>`);
  }
  parts.push(`<defs>${defs.join("")}</defs>`);
  parts.push(`<circle cx="${round(cx)}" cy="${round(cy)}" r="${round(r)}" fill="url(#${id})"/>`);
  const inner = [];
  if (surface === "rock") {
    inner.push(craterField(cx, cy, r, seed, 1, { dark: t.deep, rim: t.light }));
  } else if (surface === "sun" && texture) {
    inner.push(`<rect x="${round(cx - r)}" y="${round(cy - r)}" width="${round(r * 2)}" height="${round(r * 2)}" filter="url(#${id}-gran)" opacity="0.7"/>`);
  } else if (surface === "gas") {
    const rnd = seeded(`bands:${seed}`);
    for (let i = 0; i < 9; i += 1) {
      const y = cy - r + (i + rnd() * 0.6) * (r * 2 / 9);
      inner.push(`<rect x="${round(cx - r)}" y="${round(y)}" width="${round(r * 2)}" height="${round(r * (0.07 + rnd() * 0.1))}" fill="${i % 2 ? t.deep : t.light}" fill-opacity="${round(0.16 + rnd() * 0.18)}" transform="rotate(-18 ${round(cx)} ${round(cy)})"/>`);
    }
  }
  if (inner.length) parts.push(`<g clip-path="url(#${id}-disc)">${inner.join("")}</g>`);
  // The terminator side darkens toward the limb, so the form reads round.
  parts.push(`<circle cx="${round(cx)}" cy="${round(cy)}" r="${round(r)}" fill="url(#${id}-term)"/>`);
  if (ring) parts.push(`<circle cx="${round(cx)}" cy="${round(cy)}" r="${round(r)}" fill="none" stroke="${t.deep}" stroke-width="${round(Math.max(1.5, r * 0.02))}" stroke-opacity="0.6"/>`);
  return `<g data-orbit-asset="sphere" aria-hidden="true">${parts.join("")}</g>`;
}

/** A few craters, deterministic, as soft darker ellipses on a sphere. */
function craters(cx, cy, r, seed, tone) {
  const rnd = seeded(`craters:${seed}`);
  const out = [];
  for (let i = 0; i < 9; i += 1) {
    const a = rnd() * Math.PI * 2;
    const d = Math.sqrt(rnd()) * r * 0.78;
    const x = cx + Math.cos(a) * d;
    const y = cy + Math.sin(a) * d;
    const cr = r * (0.05 + rnd() * 0.09);
    out.push(`<ellipse cx="${round(x)}" cy="${round(y)}" rx="${round(cr)}" ry="${round(cr * 0.86)}" fill="${tone}" fill-opacity="${round(0.16 + rnd() * 0.14)}"/>`);
  }
  return out.join("");
}

/**
 * Lunar near-side features in lunar-disc units (u: east is +, v: north is +,
 * both in [-1, 1]), as seen from the northern hemisphere. Positions follow the
 * real Moon: Mare Crisium upper right, Imbrium upper left, Tranquillitatis
 * centre right, Oceanus Procellarum the broad dark sweep on the left.
 * [name, u, v, rx, ry, rotation-degrees]
 */
export const LUNAR_MARIA = Object.freeze([
  ["Oceanus Procellarum", -0.60, 0.04, 0.24, 0.36, 12],
  ["Mare Imbrium", -0.30, 0.42, 0.30, 0.25, -8],
  ["Mare Serenitatis", 0.12, 0.40, 0.16, 0.15, 0],
  ["Mare Tranquillitatis", 0.30, 0.16, 0.22, 0.15, -18],
  ["Mare Crisium", 0.64, 0.31, 0.11, 0.08, 8],
  ["Mare Fecunditatis", 0.55, -0.10, 0.10, 0.17, 20],
  ["Mare Nectaris", 0.38, -0.14, 0.065, 0.065, 0],
  ["Mare Nubium", -0.18, -0.38, 0.17, 0.13, 6],
  ["Mare Humorum", -0.52, -0.36, 0.08, 0.075, 0],
  ["Mare Vaporum", 0.0, 0.12, 0.07, 0.055, 0],
  ["Mare Frigoris", -0.04, 0.80, 0.36, 0.045, -4],
]);

/** Named craters that read on the disc: [name, u, v, radius]. */
const LUNAR_BRIGHT = Object.freeze([
  ["Tycho", -0.12, -0.72, 0.045],
  ["Copernicus", -0.34, 0.12, 0.04],
  ["Aristarchus", -0.62, 0.28, 0.03],
  ["Kepler", -0.52, 0.17, 0.022],
  ["Plato", -0.10, 0.84, 0.045],
]);

/** Seeded crater field with a power-law size spread (many small, few large). */
function craterField(cx, cy, r, seed, sun, tones) {
  const rnd = seeded(`craterfield:${seed}`);
  const out = [];
  for (let i = 0; i < 110; i += 1) {
    const a = rnd() * Math.PI * 2;
    const d = Math.sqrt(rnd()) * r * 0.94;
    const cr = r * (0.008 + 0.05 * Math.pow(rnd(), 3));
    const x = cx + Math.cos(a) * d;
    const y = cy + Math.sin(a) * d;
    // Foreshortening near the limb: craters squash along the radius.
    const squash = Math.max(0.3, Math.sqrt(Math.max(0, 1 - (d / r) ** 2)));
    const ang = Math.atan2(y - cy, x - cx) * 180 / Math.PI;
    // Sunlight from the right (waxing) or left (waning): the floor beside the
    // sun-side rim is shadowed, the far inner wall and the rim catch light.
    const px = x + sun * cr * 0.22;
    out.push(`<ellipse cx="${round(x)}" cy="${round(y)}" rx="${round(cr * squash)}" ry="${round(cr)}" fill="none" stroke="${tones.rim}" stroke-width="${round(Math.max(0.5, cr * 0.2))}" stroke-opacity="0.3" transform="rotate(${round(ang)} ${round(x)} ${round(y)})"/>`
      + `<ellipse cx="${round(px)}" cy="${round(y)}" rx="${round(cr * squash * 0.8)}" ry="${round(cr * 0.8)}" fill="${tones.dark}" fill-opacity="${round(0.2 + cr / r * 3)}" transform="rotate(${round(ang)} ${round(px)} ${round(y)})"/>`);
  }
  for (const [, u, v, rr] of LUNAR_BRIGHT) {
    const x = cx + u * r;
    const y = cy - v * r;
    out.push(`<circle cx="${round(x)}" cy="${round(y)}" r="${round(rr * r * 1.5)}" fill="${tones.rim}" fill-opacity="0.22"/>`
      + `<circle cx="${round(x)}" cy="${round(y)}" r="${round(rr * r)}" fill="${tones.rim}" fill-opacity="0.6"/>`
      + `<circle cx="${round(x + sun * rr * r * 0.2)}" cy="${round(y)}" r="${round(rr * r * 0.5)}" fill="${tones.dark}" fill-opacity="0.4"/>`);
  }
  return out.join("");
}

/** Bright ejecta rays running from Tycho, the most recognisable feature. */
function tychoRays(cx, cy, r, seed, tone) {
  const rnd = seeded(`rays:${seed}`);
  const x0 = cx - 0.12 * r;
  const y0 = cy + 0.72 * r;
  const out = [];
  for (let i = 0; i < 16; i += 1) {
    const a = rnd() * Math.PI * 2;
    const len = r * (0.35 + rnd() * 0.85);
    out.push(`<line x1="${round(x0)}" y1="${round(y0)}" x2="${round(x0 + Math.cos(a) * len)}" y2="${round(y0 + Math.sin(a) * len)}" stroke="${tone}" stroke-width="${round(r * (0.006 + rnd() * 0.012))}" stroke-opacity="${round(0.16 + rnd() * 0.16)}" stroke-linecap="round"/>`);
  }
  return out.join("");
}

/** The side of the disc that is NOT lit, drawn for a waxing Moon (lit on the
 *  right). A waning Moon mirrors it. Extends past the limb so a blur softens
 *  only the terminator, never the edge of the disc. */
function unlitShape(cx, cy, r, frac, fill) {
  const k = Math.abs(2 * frac - 1) * r;
  const rect = `M${round(cx - 1.5 * r)} ${round(cy - 1.5 * r)}H${round(cx)}V${round(cy + 1.5 * r)}H${round(cx - 1.5 * r)}Z`;
  if (frac <= 0.5) {
    return `<path d="${rect}" fill="${fill}"/><path d="M${round(cx)} ${round(cy - r * 1.02)}A${round(k)} ${round(r * 1.02)} 0 0 1 ${round(cx)} ${round(cy + r * 1.02)}Z" fill="${fill}"/>`;
  }
  return `<path fill-rule="evenodd" fill="${fill}" d="${rect}M${round(cx)} ${round(cy - r * 1.02)}A${round(k)} ${round(r * 1.02)} 0 0 0 ${round(cx)} ${round(cy + r * 1.02)}Z"/>`;
}

/**
 * The Moon as a lit sphere with the REAL phase. The illumination is the
 * engine's; everything else is the Moon's own face, drawn the way a person
 * would paint it: cream highlands, the real maria in their real places with
 * rough shores, Tycho's rays, a crater field with sunlit rims, a fine grain,
 * a soft terminator and a gentle limb. The unlit part keeps a trace of
 * earthshine, so even a new Moon reads as a Moon. Vector only, no raster.
 *
 * `texture: false` draws no filter (the two-ink press family).
 * Returns "" with no illumination: no data, no moon.
 */
export function moonSphere({ id, cx, cy, r, state, f, seed = "moon", shadow = null, shadowId = null, lit = "#e9e4d6", night = null, texture = true }) {
  const pct = Number(state?.illumination_percent);
  if (!Number.isFinite(pct)) return "";
  const frac = Math.max(0, Math.min(100, pct)) / 100;
  const waxing = state?.waxing !== false;
  const sun = waxing ? 1 : -1;
  const nightTone = night || mix(f.page, f.ink, 0.12);
  const highland = mix(lit, "#d9cfb8", 0.28);
  const maria = mix(lit, "#43444c", 0.56);
  const tones = { dark: mix(lit, "#2c2d33", 0.62), rim: mix(lit, "#ffffff", 0.45) };
  const parts = [];
  if (shadow) parts.push(castShadow(shadowId, shadow, (dx, dy) => `<ellipse cx="${round(cx + dx)}" cy="${round(cy + dy + r * 0.1)}" rx="${round(r)}" ry="${round(r * 0.94)}"/>`));

  const box = `x="${round(cx - r * 1.3)}" y="${round(cy - r * 1.3)}" width="${round(r * 2.6)}" height="${round(r * 2.6)}" filterUnits="userSpaceOnUse"`;
  const defs = [`<clipPath id="${id}-disc"><circle cx="${round(cx)}" cy="${round(cy)}" r="${round(r)}"/></clipPath>`];
  defs.push(`<radialGradient id="${id}-face" cx="${waxing ? 58 : 42}%" cy="42%" r="70%"><stop offset="0" stop-color="${mix(highland, "#ffffff", 0.18)}"/><stop offset="0.7" stop-color="${highland}"/><stop offset="1" stop-color="${mix(highland, nightTone, 0.28)}"/></radialGradient>`);
  defs.push(`<radialGradient id="${id}-limb" cx="50%" cy="50%" r="50%"><stop offset="0.72" stop-color="${nightTone}" stop-opacity="0"/><stop offset="1" stop-color="${nightTone}" stop-opacity="0.42"/></radialGradient>`);
  if (texture) {
    defs.push(`<filter id="${id}-shore" ${box}><feTurbulence type="fractalNoise" baseFrequency="${round(5 / r)}" numOctaves="3" seed="11" result="n"/><feDisplacementMap in="SourceGraphic" in2="n" scale="${round(r * 0.2)}" xChannelSelector="R" yChannelSelector="G" result="d"/><feGaussianBlur in="d" stdDeviation="${round(r * 0.013)}"/></filter>`);
    defs.push(`<filter id="${id}-grain" ${box}><feTurbulence type="fractalNoise" baseFrequency="${round(70 / r)}" numOctaves="2" seed="5"/><feColorMatrix values="0 0 0 0 0.12  0 0 0 0 0.12  0 0 0 0 0.14  1.4 0 0 0 -0.5"/></filter>`);
    defs.push(`<filter id="${id}-mottle" ${box}><feTurbulence type="fractalNoise" baseFrequency="${round(2.2 / r)}" numOctaves="4" seed="23"/><feColorMatrix values="0 0 0 0 0.1  0 0 0 0 0.1  0 0 0 0 0.12  2.2 0 0 0 -0.95"/></filter>`);
    defs.push(`<filter id="${id}-fall" ${box}><feGaussianBlur stdDeviation="${round(r * 0.2)}"/></filter>`);
    defs.push(`<filter id="${id}-term" ${box}><feTurbulence type="fractalNoise" baseFrequency="${round(7 / r)}" numOctaves="3" seed="31" result="n"/><feDisplacementMap in="SourceGraphic" in2="n" scale="${round(r * 0.1)}" xChannelSelector="R" yChannelSelector="G" result="d"/><feGaussianBlur in="d" stdDeviation="${round(r * 0.016)}"/></filter>`);
  }
  parts.push(`<defs>${defs.join("")}</defs>`);

  const mariaShapes = LUNAR_MARIA.map(([, u, v, rx, ry, rot]) => {
    const x = cx + u * r;
    const y = cy - v * r;
    return `<ellipse cx="${round(x)}" cy="${round(y)}" rx="${round(rx * r)}" ry="${round(ry * r)}" transform="rotate(${-rot} ${round(x)} ${round(y)})"/>`;
  }).join("");

  const face = [];
  face.push(`<circle cx="${round(cx)}" cy="${round(cy)}" r="${round(r)}" fill="url(#${id}-face)"/>`);
  face.push(`<g fill="${maria}" fill-opacity="0.88"${texture ? ` filter="url(#${id}-shore)"` : ""}>${mariaShapes}</g>`);
  if (texture) face.push(`<rect x="${round(cx - r)}" y="${round(cy - r)}" width="${round(r * 2)}" height="${round(r * 2)}" filter="url(#${id}-mottle)" opacity="0.55"/>`);
  face.push(tychoRays(cx, cy, r, seed, mix(lit, "#ffffff", 0.5)));
  face.push(craterField(cx, cy, r, seed, sun, tones));
  if (texture) face.push(`<rect x="${round(cx - r)}" y="${round(cy - r)}" width="${round(r * 2)}" height="${round(r * 2)}" filter="url(#${id}-grain)" opacity="0.28"/>`);

  // Shade: everything not lit by the Sun, with a soft terminator.
  const shade = frac >= 0.995 ? "" : unlitShape(cx, cy, r, frac, nightTone);
  const flip = waxing ? "" : ` transform="translate(${round(2 * cx)} 0) scale(-1 1)"`;
  const falloff = shade && texture ? `<g${flip}><g opacity="0.75" filter="url(#${id}-fall)">${shade}</g></g>` : "";
  const shadeGroup = shade ? falloff + `<g${flip}><g opacity="${frac <= 0.005 ? 0.9 : 0.93}"${texture ? ` filter="url(#${id}-term)"` : ""}>${shade}</g></g>` : "";

  parts.push(`<g clip-path="url(#${id}-disc)" data-lit="${frac > 0.005 ? Math.round(pct) : 0}">${face.join("")}${shadeGroup}<circle cx="${round(cx)}" cy="${round(cy)}" r="${round(r)}" fill="url(#${id}-limb)"/></g>`);
  parts.push(`<circle cx="${round(cx)}" cy="${round(cy)}" r="${round(r)}" fill="none" stroke="${mix(nightTone, f.ink, 0.35)}" stroke-width="${round(Math.max(1.5, r * 0.016))}"/>`);
  return `<g data-orbit-asset="moon" role="img" aria-label="Moon, ${Math.round(pct)}% illuminated"><title>Moon, ${Math.round(pct)}% illuminated, ${waxing ? "waxing" : "waning"}</title>${parts.join("")}</g>`;
}

/** A ringed planet: back ring, sphere, ring shadow across it, front ring. */
export function ringedPlanet({ id, cx, cy, r, base, ringColour, f, shadow = null, shadowId = null, tilt = -18 }) {
  const t = tones(base, f);
  const rx = r * 2.05;
  const ry = r * 0.5;
  const parts = [];
  if (shadow) parts.push(castShadow(shadowId, shadow, (dx, dy) => `<ellipse cx="${round(cx + dx)}" cy="${round(cy + dy + r * 0.2)}" rx="${round(rx)}" ry="${round(r * 0.78)}" transform="rotate(${tilt} ${round(cx)} ${round(cy)})"/>`));
  parts.push(`<defs><clipPath id="${id}-front"><rect x="${round(cx - rx - 6)}" y="${round(cy)}" width="${round(rx * 2 + 12)}" height="${round(ry + r)}" transform="rotate(${tilt} ${round(cx)} ${round(cy)})"/></clipPath></defs>`);
  const ring = (w, col, op) => `<ellipse cx="${round(cx)}" cy="${round(cy)}" rx="${round(rx)}" ry="${round(ry)}" fill="none" stroke="${col}" stroke-width="${w}" stroke-opacity="${op}" transform="rotate(${tilt} ${round(cx)} ${round(cy)})"/>`;
  parts.push(ring(round(r * 0.34), mix(ringColour, f.dark || "#10131a", 0.5), 1));
  parts.push(sphere({ id, cx, cy, r, base, f, surface: "gas", seed: id }));
  // The planet's own shadow falls across the ring behind it; the front ring
  // passes over the sphere.
  parts.push(`<g clip-path="url(#${id}-front)">${ring(round(r * 0.34), ringColour, 1)}${ring(round(r * 0.08), mix(ringColour, "#ffffff", 0.45), 0.7)}${ring(round(r * 0.025), mix(ringColour, f.dark || "#10131a", 0.75), 0.9)}</g>`);
  parts.push(`<ellipse cx="${round(cx)}" cy="${round(cy)}" rx="${round(rx)}" ry="${round(ry)}" fill="none" stroke="${t.deep}" stroke-width="2" stroke-opacity="0.5" transform="rotate(${tilt} ${round(cx)} ${round(cy)})"/>`);
  return `<g data-orbit-asset="ringed-planet" aria-hidden="true">${parts.join("")}</g>`;
}

/** An armillary sphere: tilted rings with a lit edge, an axis, and a bead. */
export function armillary({ cx, cy, r, f, colour, accent, shadow = null, shadowId = null }) {
  const parts = [];
  if (shadow) parts.push(castShadow(shadowId, shadow, (dx, dy) => `<ellipse cx="${round(cx + dx)}" cy="${round(cy + dy + r * 0.25)}" rx="${round(r * 0.95)}" ry="${round(r * 0.9)}"/>`));
  const edge = mix(colour, "#ffffff", 0.45);
  const shade = mix(colour, f.dark || "#10131a", 0.5);
  const ring = (rx, ry, rot, w) => `<g transform="rotate(${rot} ${round(cx)} ${round(cy)})">`
    + `<ellipse cx="${round(cx)}" cy="${round(cy)}" rx="${round(rx)}" ry="${round(ry)}" fill="none" stroke="${shade}" stroke-width="${w + 5}"/>`
    + `<ellipse cx="${round(cx)}" cy="${round(cy)}" rx="${round(rx)}" ry="${round(ry)}" fill="none" stroke="${colour}" stroke-width="${w}"/>`
    + `<ellipse cx="${round(cx - 1.5)}" cy="${round(cy - 1.5)}" rx="${round(rx)}" ry="${round(ry)}" fill="none" stroke="${edge}" stroke-width="${round(w * 0.28)}" stroke-opacity="0.8"/></g>`;
  parts.push(ring(r, r, 0, 9));
  parts.push(ring(r * 0.98, r * 0.36, -23, 8));
  parts.push(ring(r * 0.98, r * 0.36, 23, 8));
  parts.push(ring(r * 0.62, r * 0.62, 0, 6));
  parts.push(`<line x1="${round(cx)}" y1="${round(cy - r * 1.12)}" x2="${round(cx)}" y2="${round(cy + r * 1.12)}" stroke="${shade}" stroke-width="6" stroke-linecap="round" transform="rotate(23 ${round(cx)} ${round(cy)})"/>`);
  parts.push(sphere({ id: `arm-${Math.round(cx)}-${Math.round(cy)}`, cx, cy, r: r * 0.17, base: accent, f }));
  return `<g data-orbit-asset="armillary" aria-hidden="true">${parts.join("")}</g>`;
}

/** Which depth asset a post gets, from what the post is about. */
export function assetFor({ kind, eventType, title, facts }) {
  const sky = facts?.sky_at_event || {};
  const moonState = Number.isFinite(sky.moon_illumination_percent)
    ? { illumination_percent: sky.moon_illumination_percent, waxing: sky.moon_waxing !== false }
    : Number.isFinite(facts?.illumination_percent) ? { illumination_percent: facts.illumination_percent, waxing: facts.is_waxing !== false }
      : eventType === "full_moon" ? { illumination_percent: 100, waxing: true }
        : eventType === "new_moon" ? { illumination_percent: 0, waxing: true } : null;
  if (kind === "moon" && moonState) return { type: "moon", state: moonState };
  if (eventType === "sun_ingress") return { type: "sphere", body: "Sun" };
  if (["mercury_rx", "mercury_direct"].includes(eventType)) return { type: "sphere", body: "Mercury" };
  if (kind === "monthly") return { type: "ringed" };
  return { type: "armillary" };
}
