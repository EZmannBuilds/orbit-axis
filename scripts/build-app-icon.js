#!/usr/bin/env node
// Orbit Axis :: render the iOS app icon and launch image from assets/icon.svg.
//
// The mark itself — geometry, rasteriser, PNG encoder — lives in
// lib/brand/mark-raster.js, so the icon, the launch image and the social
// avatar are all the same mark rather than three redrawings of it. This script
// is only the iOS build steps.
//
//   node scripts/build-app-icon.js

import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { ROOT, CANVAS, RING, assertSourceMatches, raster, encodePng } from "../lib/brand/mark-raster.js";

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
