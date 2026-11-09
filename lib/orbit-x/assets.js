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

/** A lit sphere: off-centre highlight, darker limb, optional cast shadow. */
export function sphere({ id, cx, cy, r, base, f, shadow = null, shadowId = null, ring = false }) {
  const t = tones(base, f);
  const parts = [];
  if (shadow) parts.push(castShadow(shadowId, shadow, (dx, dy) => `<ellipse cx="${round(cx + dx)}" cy="${round(cy + dy + r * 0.12)}" rx="${round(r * 0.98)}" ry="${round(r * 0.9)}"/>`));
  parts.push(`<defs><radialGradient id="${id}" cx="34%" cy="30%" r="82%"><stop offset="0" stop-color="${t.light}"/>`
    + `<stop offset="0.45" stop-color="${t.mid}"/><stop offset="1" stop-color="${t.dark}"/></radialGradient></defs>`);
  parts.push(`<circle cx="${round(cx)}" cy="${round(cy)}" r="${round(r)}" fill="url(#${id})"/>`);
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
 * The Moon as a sphere with the REAL phase: the lit part is the engine's
 * illumination (same terminator geometry as moonDisc), the unlit part is a
 * dark disc, craters sit on the lit part, and the sphere casts a shadow.
 * Returns "" with no illumination: no data, no moon.
 */
export function moonSphere({ id, cx, cy, r, state, f, seed = "moon", shadow = null, shadowId = null, lit = "#e9e4d6", night = null }) {
  const pct = Number(state?.illumination_percent);
  if (!Number.isFinite(pct)) return "";
  const frac = Math.max(0, Math.min(100, pct)) / 100;
  const waxing = state?.waxing !== false;
  const nightTone = night || mix(f.page, f.ink, 0.12);
  const parts = [];
  if (shadow) parts.push(castShadow(shadowId, shadow, (dx, dy) => `<ellipse cx="${round(cx + dx)}" cy="${round(cy + dy + r * 0.1)}" rx="${round(r)}" ry="${round(r * 0.94)}"/>`));
  // The unlit side is never pure black: a dim sphere (earthshine), faint
  // craters, and a thin rim, so a new Moon still reads as a Moon. The lit area
  // below is exactly the engine's illumination; nothing here adds light.
  const earth = mix(nightTone, lit, 0.1);
  parts.push(`<defs><radialGradient id="${id}-night" cx="40%" cy="36%" r="80%"><stop offset="0" stop-color="${earth}"/><stop offset="1" stop-color="${nightTone}"/></radialGradient></defs>`);
  parts.push(`<circle cx="${round(cx)}" cy="${round(cy)}" r="${round(r)}" fill="url(#${id}-night)"/>`);
  parts.push(craters(cx, cy, r, seed, mix(lit, nightTone, 0.2)).replace(/fill-opacity="[\d.]+"/g, 'fill-opacity="0.12"'));
  parts.push(`<circle cx="${round(cx)}" cy="${round(cy)}" r="${round(r - r * 0.012)}" fill="none" stroke="${mix(nightTone, lit, 0.4)}" stroke-width="${round(Math.max(2, r * 0.03))}" stroke-opacity="0.55"/>`);
  if (frac > 0.005) {
    let litPath;
    if (frac >= 0.995) litPath = `M${round(cx - r)} ${round(cy)}A${r} ${r} 0 1 0 ${round(cx + r)} ${round(cy)}A${r} ${r} 0 1 0 ${round(cx - r)} ${round(cy)}Z`;
    else {
      const side = waxing ? 1 : -1;
      const rx = Math.abs(2 * frac - 1) * r;
      const termSweep = frac > 0.5 ? (side === 1 ? 1 : 0) : (side === 1 ? 0 : 1);
      litPath = `M${round(cx)} ${round(cy - r)}A${r} ${r} 0 0 ${side === 1 ? 1 : 0} ${round(cx)} ${round(cy + r)}A${round(rx)} ${r} 0 0 ${termSweep} ${round(cx)} ${round(cy - r)}Z`;
    }
    const dark = mix(lit, nightTone, 0.5);
    parts.push(`<defs><clipPath id="${id}-clip"><path d="${litPath}"/></clipPath>`
      + `<radialGradient id="${id}" cx="${waxing ? 62 : 38}%" cy="40%" r="75%"><stop offset="0" stop-color="${mix(lit, "#ffffff", 0.35)}"/>`
      + `<stop offset="0.55" stop-color="${lit}"/><stop offset="1" stop-color="${dark}"/></radialGradient></defs>`);
    parts.push(`<g clip-path="url(#${id}-clip)"><circle cx="${round(cx)}" cy="${round(cy)}" r="${round(r)}" fill="url(#${id})"/>${craters(cx, cy, r, seed, mix(lit, "#2a2a2a", 0.55))}</g>`);
  }
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
  parts.push(sphere({ id, cx, cy, r, base, f }));
  // The planet's own shadow falls across the ring behind it; the front ring
  // passes over the sphere.
  parts.push(`<g clip-path="url(#${id}-front)">${ring(round(r * 0.34), ringColour, 1)}${ring(round(r * 0.08), mix(ringColour, "#ffffff", 0.45), 0.7)}</g>`);
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
