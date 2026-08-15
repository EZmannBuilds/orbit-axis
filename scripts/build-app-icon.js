#!/usr/bin/env node
// Orbit Axis :: render the iOS app icon and launch image from assets/icon.svg.
//
// WHY NOT A CONVERTER. The icon is a few vector primitives on a flat field, and every
// conversion path available on a Mac had a problem worth avoiding:
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
//   node scripts/build-app-icon.js
//
// The SOURCE OF TRUTH is assets/icon.svg. The geometry below mirrors it, and
// the script fails if the two disagree, so nobody can edit one and ship the
// other.

import { readFileSync, writeFileSync } from "node:fs";
import { deflateSync } from "node:zlib";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

/* ── The mark ───────────────────────────────────────────────────────────────
   Pure Orbit (A2.1.1): orbit, 62deg axis, observer, and orbital point. The
   observer gets the system's only icon-scale halo. Coordinates are on the same
   1024 grid as assets/icon.svg. */
const CANVAS = 1024;
const BG = [0x08, 0x0a, 0x12];        // Deep Space
const ACTIVE = [0x76, 0x57, 0xe8];    // Active Violet
const HIGHLIGHT = [0xb9, 0xa7, 0xff]; // Celestial Highlight
const STAR = [0xf4, 0xf2, 0xfa];      // Star White

const RING = { x: 512, y: 512, r: 250, stroke: 56 };
const AXIS = { x1: 300, y1: 910, x2: 724, y2: 114, stroke: 48 };
const OBSERVER = { x: 512, y: 512, r: 54, halo: 94, haloAlpha: 0.14 };
const ORBITAL = { x: 689, y: 335, r: 64 };

/** Guard: the SVG and this file must describe the same mark. */
function assertSourceMatches() {
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
function raster(size, { x0 = 0, y0 = 0, span = CANVAS } = {}) {
  const SS = 4;
  const rgb = Buffer.alloc(size * size * 3);
  for (let py = 0; py < size; py += 1) {
    for (let px = 0; px < size; px += 1) {
      let r = 0, g = 0, b = 0;
      for (let sy = 0; sy < SS; sy += 1) {
        for (let sx = 0; sx < SS; sx += 1) {
          const x = x0 + ((px + (sx + 0.5) / SS) / size) * span;
          const y = y0 + ((py + (sy + 0.5) / SS) / size) * span;
          const c = sample(x, y);
          r += c[0]; g += c[1]; b += c[2];
        }
      }
      const n = SS * SS;
      const i = (py * size + px) * 3;
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

function encodePng(rgb, size) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8;   // bit depth
  ihdr[9] = 2;   // colour type 2 = truecolour, NO alpha
  // 10..12: deflate, adaptive filtering, no interlace — all zero.

  const stride = size * 3;
  const raw = Buffer.alloc((stride + 1) * size);
  for (let y = 0; y < size; y += 1) {
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

// ── Build ───────────────────────────────────────────────────────────────────
assertSourceMatches();

const ICONSET = join(ROOT, "ios", "App", "App", "Assets.xcassets", "AppIcon.appiconset");
const SPLASHSET = join(ROOT, "ios", "App", "App", "Assets.xcassets", "Splash.imageset");

// The app icon: one 1024 square, which is the only size modern iOS asks for.
writeFileSync(join(ICONSET, "AppIcon-512@2x.png"), encodePng(raster(1024), 1024));
console.log("Wrote AppIcon-512@2x.png (1024x1024, no alpha)");

// The launch image. Same mark on the same field, but a third the size in frame
// and centred — a splash is a whole screen, and an icon blown up to 2732px would
// be a ring as wide as an iPad.
//
// A window three times the design grid, centred on the mark's own centre.
const SPLASH_SPAN = CANVAS * 3;
const splash = encodePng(
  raster(2732, {
    span: SPLASH_SPAN,
    x0: RING.x - SPLASH_SPAN / 2,
    y0: RING.y - SPLASH_SPAN / 2,
  }),
  2732);
for (const name of ["splash-2732x2732.png", "splash-2732x2732-1.png", "splash-2732x2732-2.png"]) {
  writeFileSync(join(SPLASHSET, name), splash);
}
console.log("Wrote 3 splash images (2732x2732, no alpha)");
