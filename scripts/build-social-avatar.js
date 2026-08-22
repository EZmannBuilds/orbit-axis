#!/usr/bin/env node
// Orbit Axis :: render the social profile picture from assets/icon.svg.
//
// A PROFILE PICTURE IS A CIRCLE, NOT A SQUARE. Instagram, Threads, X and
// YouTube all mask the upload to the inscribed circle, so the app icon cannot
// simply be reused: its 62deg axis runs corner to corner and the mask would
// clip both ends. The same mark is rendered here with the camera pulled back,
// so the axis clears the crop with room to spare and the ring is not pressed
// against the edge at the 32px the feed actually draws.
//
//   node scripts/build-social-avatar.js
//
// The mark comes from lib/brand/mark-raster.js, which is checked against
// assets/icon.svg on every run — the avatar cannot drift away from the icon.

import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { ROOT, RING, AXIS, OBSERVER, ORBITAL, assertSourceMatches, raster, encodePng } from "../lib/brand/mark-raster.js";

const SIZE = 1080; // What every platform asks to be given; each downsamples it.

/** How far the mark reaches from its own centre, stroke included. */
export function markExtent() {
  const half = (x1, y1, x2, y2) => Math.hypot(x2 - x1, y2 - y1);
  return Math.max(
    half(RING.x, RING.y, AXIS.x1, AXIS.y1) + AXIS.stroke / 2,
    half(RING.x, RING.y, AXIS.x2, AXIS.y2) + AXIS.stroke / 2,
    RING.r + RING.stroke / 2,
    half(RING.x, RING.y, ORBITAL.x, ORBITAL.y) + ORBITAL.r,
    OBSERVER.halo,
  );
}

// The mark fills a little over three quarters of the circle's radius. Larger
// and the axis tips graze the mask; smaller and the ring stops being legible
// at feed scale, where this is drawn 32 pixels across.
export const FILL = 0.78;
export const SPAN = Math.round((markExtent() / FILL) * 2);

if (import.meta.url === `file://${process.argv[1]}`) {
  assertSourceMatches();
  const dir = join(ROOT, "assets", "social");
  mkdirSync(dir, { recursive: true });
  const png = encodePng(
    raster(SIZE, { span: SPAN, x0: RING.x - SPAN / 2, y0: RING.y - SPAN / 2 }),
    SIZE);
  writeFileSync(join(dir, "orbit-axis-avatar-1080.png"), png);
  console.log(`Wrote assets/social/orbit-axis-avatar-1080.png (${SIZE}x${SIZE}, no alpha, `
    + `mark at ${Math.round(FILL * 100)}% of the circular crop)`);
}
