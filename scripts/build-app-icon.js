#!/usr/bin/env node
// Orbit Axis :: render the iOS app icon and launch image from assets/icon.svg.
//
// WHY NOT A CONVERTER. The icon is four shapes on a flat field, and every
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
   A ring with a body on it, on the app's own near-black canvas. Coordinates are
   on the same 1024 grid as assets/icon.svg.

   The body's cut-out is the background colour, so it reads as a separate object
   rather than a bump welded to the ring — the same relationship the mark has in
   the rail and on the sign-in card. */
const CANVAS = 1024;
const BG = [0x08, 0x08, 0x0a];        // --void-canvas
const ACCENT = [0xa1, 0x85, 0xff];    // --violet-sky, the on-dark accent

const RING = { x: 512, y: 512, r: 250, stroke: 64 };
const BODY = { x: 689, y: 335, r: 96, cut: 128 };

/** Guard: the SVG and this file must describe the same mark. */
function assertSourceMatches() {
  const svg = readFileSync(join(ROOT, "assets", "icon.svg"), "utf8");
  const expected = [
    `fill="#${BG.map((c) => c.toString(16).padStart(2, "0")).join("")}"`,
    `stroke="#${ACCENT.map((c) => c.toString(16).padStart(2, "0")).join("")}"`,
    `cx="${RING.x}" cy="${RING.y}" r="${RING.r}"`,
    `stroke-width="${RING.stroke}"`,
    `cx="${BODY.x}" cy="${BODY.y}" r="${BODY.cut}"`,
    `cx="${BODY.x}" cy="${BODY.y}" r="${BODY.r}"`,
  ];
  for (const fragment of expected) {
    if (!svg.includes(fragment)) {
      throw new Error(
        `assets/icon.svg no longer matches this script — missing ${fragment}.\n`
        + "Edit both, or the committed PNG stops being a render of the source.");
    }
  }
}

/** Colour at a point, in paint order: canvas, ring, the body's cut, the body. */
function sample(x, y) {
  const dRing = Math.hypot(x - RING.x, y - RING.y);
  const dBody = Math.hypot(x - BODY.x, y - BODY.y);
  if (dBody <= BODY.r) return ACCENT;
  if (dBody <= BODY.cut) return BG;
  const half = RING.stroke / 2;
  if (dRing >= RING.r - half && dRing <= RING.r + half) return ACCENT;
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
