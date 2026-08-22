// Orbit Axis :: the brand mark, rasterised.
//
// WHY NOT A CONVERTER. The mark is a few vector primitives on a flat field, and
// every conversion path available on a Mac had a problem worth avoiding:
//
//   · `qlmanage` renders it correctly but emits an ALPHA CHANNEL, and an App
//     Store icon with one is rejected at validation. There is no reliable way
//     to strip it with the tools that ship with macOS.
//   · ImageMagick / rsvg would fix that, and neither is installed. Requiring
//     them would mean the icon could not be rebuilt from a clean checkout.
//   · `@capacitor/assets` pulls a Sharp toolchain in for a job that is a ring
//     and two circles.
//
// So the geometry is rasterised here, in plain Node, and encoded as an opaque
// 8-bit RGB PNG using zlib from the standard library. No dependencies, no alpha,
// byte-identical on every machine — the same rule public/icons.js follows.
//
// The SOURCE OF TRUTH is assets/icon.svg. The geometry below mirrors it, and
// assertSourceMatches() fails if the two disagree, so nobody can edit one and
// ship the other. Every surface that needs the mark as pixels — the iOS icon,
// the launch image, the social avatar — renders from THIS file, so they cannot
// drift into three slightly different marks.

import { readFileSync } from "node:fs";
import { deflateSync } from "node:zlib";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

export const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

/* ── The mark ───────────────────────────────────────────────────────────────
   Pure Orbit (A2.1.1): orbit, 62deg axis, observer, and orbital point. The
   observer gets the system's only icon-scale halo. Coordinates are on the same
   1024 grid as assets/icon.svg. */
export const CANVAS = 1024;
export const BG = [0x08, 0x0a, 0x12];        // Deep Space
export const ACTIVE = [0x76, 0x57, 0xe8];    // Active Violet
export const HIGHLIGHT = [0xb9, 0xa7, 0xff]; // Celestial Highlight
export const STAR = [0xf4, 0xf2, 0xfa];      // Star White

export const RING = { x: 512, y: 512, r: 250, stroke: 56 };
export const AXIS = { x1: 300, y1: 910, x2: 724, y2: 114, stroke: 48 };
export const OBSERVER = { x: 512, y: 512, r: 54, halo: 94, haloAlpha: 0.14 };
export const ORBITAL = { x: 689, y: 335, r: 64 };

/** Guard: the SVG and this file must describe the same mark. */
export function assertSourceMatches() {
  const svg = readFileSync(join(ROOT, "assets", "icon.svg"), "utf8");
  const expected = [
    `fill="#${BG.map((c) => c.toString(16).padStart(2, "0")).join("")}"`,
    `stroke="#${ACTIVE.map((c) => c.toString(16).padStart(2, "0")).join("")}"`,
    `fill="#${HIGHLIGHT.map((c) => c.toString(16).padStart(2, "0")).join("")}"`,
    `fill="#${STAR.map((c) => c.toString(16).padStart(2, "0")).join("")}"`,
    `cx="${RING.x}" cy="${RING.y}" r="${RING.r}"`,
    `stroke-width="${RING.stroke}"`,
    `M${AXIS.x1} ${AXIS.y1} ${AXIS.x2} ${AXIS.y2}`,
    `stroke-width="${AXIS.stroke}"`,
    `cx="${OBSERVER.x}" cy="${OBSERVER.y}" r="${OBSERVER.halo}"`,
    `cx="${OBSERVER.x}" cy="${OBSERVER.y}" r="${OBSERVER.r}"`,
    `cx="${ORBITAL.x}" cy="${ORBITAL.y}" r="${ORBITAL.r}"`,
  ];
  for (const fragment of expected) {
    if (!svg.includes(fragment)) {
      throw new Error(
        `assets/icon.svg no longer matches this script — missing ${fragment}.\n`
        + "Edit both, or the committed PNG stops being a render of the source.");
    }
  }
}

function blend(over, under, alpha) {
  return over.map((channel, i) => Math.round(channel * alpha + under[i] * (1 - alpha)));
}

function distanceToSegment(x, y, { x1, y1, x2, y2 }) {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const lengthSquared = dx * dx + dy * dy;
  const t = Math.max(0, Math.min(1, ((x - x1) * dx + (y - y1) * dy) / lengthSquared));
  return Math.hypot(x - (x1 + t * dx), y - (y1 + t * dy));
}

/** Colour at a point, in the same paint order as assets/icon.svg. */
function sample(x, y) {
  const dRing = Math.hypot(x - RING.x, y - RING.y);
  const dObserver = Math.hypot(x - OBSERVER.x, y - OBSERVER.y);
  const dOrbital = Math.hypot(x - ORBITAL.x, y - ORBITAL.y);
  if (dOrbital <= ORBITAL.r) return HIGHLIGHT;
  if (dObserver <= OBSERVER.r) return STAR;
  if (distanceToSegment(x, y, AXIS) <= AXIS.stroke / 2) return ACTIVE;
  const half = RING.stroke / 2;
  if (dRing >= RING.r - half && dRing <= RING.r + half) return ACTIVE;
  if (dObserver <= OBSERVER.halo) return blend(HIGHLIGHT, BG, OBSERVER.haloAlpha);
  return BG;
}

/**
 * Rasterise to raw RGB.
 *
 * `span` is the width of the WINDOW onto the 1024 design grid, and (x0, y0) its
 * top-left. span === CANVAS draws the mark edge to edge; a larger span pulls the
 * camera back and makes the mark smaller in frame. Expressed as a window rather
 * than as a "scale" because a scale factor is ambiguous about which direction it
 * goes — the first version of this took `scale: 3` to mean "a third the size"
 * and rendered a splash containing nothing but background.
 *
 * 4x4 supersampling per pixel. A ring at this size is almost all curve, and
 * without it the edges stair-step badly at the sizes iOS actually draws.
 */
export function raster(size, options = {}) {
  return rasterFrame(size, size, options);
}

/**
 * The rectangular form. A link-preview card is 1200x630, not a square, and
 * stretching a square to fit would distort a mark whose whole identity is a
 * circle. The window's SPAN is its width; the height follows from the aspect,
 * so the design grid is never scaled unevenly.
 */
export function rasterFrame(width, height, { x0 = 0, y0 = 0, span = CANVAS } = {}) {
  const SS = 4;
  const unit = span / width;          // design units per output pixel, both axes
  const rgb = Buffer.alloc(width * height * 3);
  for (let py = 0; py < height; py += 1) {
    for (let px = 0; px < width; px += 1) {
      let r = 0, g = 0, b = 0;
      for (let sy = 0; sy < SS; sy += 1) {
        for (let sx = 0; sx < SS; sx += 1) {
          const x = x0 + (px + (sx + 0.5) / SS) * unit;
          const y = y0 + (py + (sy + 0.5) / SS) * unit;
          const c = sample(x, y);
          r += c[0]; g += c[1]; b += c[2];
        }
      }
      const n = SS * SS;
      const i = (py * width + px) * 3;
      rgb[i] = Math.round(r / n);
      rgb[i + 1] = Math.round(g / n);
      rgb[i + 2] = Math.round(b / n);
    }
  }
  return rgb;
}

/* ── PNG encoding ───────────────────────────────────────────────────────────
   Colour type 2 (truecolour, no alpha) at 8 bits. Filter 0 on every scanline:
   the image is flat colour and smooth curves, so a predictor buys nothing that
   deflate does not already get. */
const CRC_TABLE = (() => {
  const table = new Int32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c;
  }
  return table;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (const byte of buf) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([length, body, crc]);
}

export function encodePng(rgb, width, height = width) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;   // bit depth
  ihdr[9] = 2;   // colour type 2 = truecolour, NO alpha
  // 10..12: deflate, adaptive filtering, no interlace — all zero.

  const stride = width * 3;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y += 1) {
    raw[y * (stride + 1)] = 0;                                   // filter: none
    rgb.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
  }

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

/* ── ICO ────────────────────────────────────────────────────────────────────
   Modern browsers accept a PNG payload inside an .ico container, which means
   the favicon needs no second encoder. The file exists at all because plenty
   of link-preview scrapers and older Safari builds request /favicon.ico by
   path and treat a 404 as "this site has no icon", regardless of what the
   document declares. */
export function encodeIco(images) {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0);              // reserved
  header.writeUInt16LE(1, 2);              // type 1 = icon
  header.writeUInt16LE(images.length, 4);
  let offset = 6 + images.length * 16;
  const entries = [];
  for (const { size, png } of images) {
    const entry = Buffer.alloc(16);
    entry[0] = size >= 256 ? 0 : size;     // 0 means 256
    entry[1] = size >= 256 ? 0 : size;
    entry[2] = 0;                          // palette colours
    entry[3] = 0;                          // reserved
    entry.writeUInt16LE(1, 4);             // colour planes
    entry.writeUInt16LE(32, 6);            // bits per pixel
    entry.writeUInt32BE(0, 8);
    entry.writeUInt32LE(png.length, 8);
    entry.writeUInt32LE(offset, 12);
    entries.push(entry);
    offset += png.length;
  }
  return Buffer.concat([header, ...entries, ...images.map((i) => i.png)]);
}
