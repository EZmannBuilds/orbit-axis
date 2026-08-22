#!/usr/bin/env node
// Orbit Axis :: render the social and link-preview images from assets/icon.svg.
//
// Four surfaces, one mark, four different framings — because each of them
// crops differently and a single square PNG cannot serve all four:
//
//   · THE AVATAR is masked to a circle by Instagram, Threads, X and YouTube.
//     The app icon's 62deg axis runs corner to corner, so the mask would clip
//     both tips; this pulls the camera back until the mark clears it.
//   · THE CARD is what unfurls when the link is pasted anywhere that shows a
//     preview — Threads, X, iMessage, WhatsApp, Slack. It is 1200x630, and a
//     square stretched to fit would distort a mark whose identity is a circle.
//   · THE APPLE TOUCH ICON is what iOS uses for "Add to Home Screen". Safari
//     applies its own rounding, so this is framed like the app icon, not the
//     avatar.
//   · FAVICON.ICO exists because scrapers and older Safari request that exact
//     path and read a 404 as "no icon", whatever the document declares.
//
//   node scripts/build-social-images.js
//
// The mark comes from lib/brand/mark-raster.js, which is checked against
// assets/icon.svg on every run — none of these can drift away from the icon.

import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  ROOT, CANVAS, RING, AXIS, OBSERVER, ORBITAL,
  assertSourceMatches, raster, rasterFrame, encodePng, encodeIco,
} from "../lib/brand/mark-raster.js";

/** How far the mark reaches from its own centre, stroke included. */
export function markExtent() {
  const from = (x, y) => Math.hypot(x - RING.x, y - RING.y);
  return Math.max(
    from(AXIS.x1, AXIS.y1) + AXIS.stroke / 2,
    from(AXIS.x2, AXIS.y2) + AXIS.stroke / 2,
    RING.r + RING.stroke / 2,
    from(ORBITAL.x, ORBITAL.y) + ORBITAL.r,
    OBSERVER.halo,
  );
}

/** A window of `span` design units, centred on the mark's own centre. */
const centred = (span) => ({ span, x0: RING.x - span / 2, y0: RING.y - span / 2 });

// The avatar's mark fills a little over three quarters of the circle's radius.
// Larger and the axis tips graze the mask; smaller and the ring stops being
// legible at feed scale, where this is drawn 32 pixels across.
export const AVATAR_SIZE = 1080;
export const FILL = 0.78;
export const SPAN = Math.round((markExtent() / FILL) * 2);

// The card is mostly field: a preview thumbnail sits beside the title and
// description, and a mark that fills it reads as a crop rather than a logo.
export const CARD = Object.freeze({ width: 1200, height: 630, fillOfHeight: 0.62 });
export const CARD_SPAN = Math.round(
  (markExtent() * 2) / (CARD.fillOfHeight * CARD.height) * CARD.width);

if (import.meta.url === `file://${process.argv[1]}`) {
  assertSourceMatches();

  const social = join(ROOT, "assets", "social");
  const publicDir = join(ROOT, "public");
  mkdirSync(social, { recursive: true });

  // 1. The circular-crop avatar.
  writeFileSync(join(social, "orbit-axis-avatar-1080.png"),
    encodePng(raster(AVATAR_SIZE, centred(SPAN)), AVATAR_SIZE));

  // 2. The link-preview card. Centred on the mark, height derived from the
  //    aspect so the design grid is never scaled unevenly.
  const cardY = RING.y - (CARD_SPAN / CARD.width) * CARD.height / 2;
  writeFileSync(join(publicDir, "brand", "orbit-axis-card.png"),
    encodePng(
      rasterFrame(CARD.width, CARD.height,
        { span: CARD_SPAN, x0: RING.x - CARD_SPAN / 2, y0: cardY }),
      CARD.width, CARD.height));

  // 3. The iOS home-screen icon: the app icon's framing, at Safari's size.
  writeFileSync(join(publicDir, "apple-touch-icon.png"), encodePng(raster(180), 180));

  // 4. /favicon.ico — the mark at tab scale, where the ring is the only part
  //    that survives. Framed like the avatar so the axis is not cut off.
  const ico = encodeIco([32, 64].map((size) => ({
    size, png: encodePng(raster(size, centred(SPAN)), size),
  })));
  writeFileSync(join(publicDir, "favicon.ico"), ico);

  console.log(`Wrote assets/social/orbit-axis-avatar-1080.png (${AVATAR_SIZE}x${AVATAR_SIZE}, `
    + `mark at ${Math.round(FILL * 100)}% of the circular crop)`);
  console.log(`Wrote public/brand/orbit-axis-card.png (${CARD.width}x${CARD.height})`);
  console.log("Wrote public/apple-touch-icon.png (180x180)");
  console.log(`Wrote public/favicon.ico (32 + 64, ${ico.length} bytes)`);
  if (CANVAS !== 1024) throw new Error("design grid changed; re-check every framing above");
}
