#!/usr/bin/env node
// Orbit Axis :: generate public/icons.js from a local Phosphor Icons checkout.
//
// WHY A GENERATOR AND A COMMITTED OUTPUT. Orbit ships no icon font, no CDN link,
// and no npm icon package: the deployed app must render its interface from
// bytes it already serves, with no third-party request and no build step that a
// clone cannot reproduce. So the icons are inlined as path data into one small
// ES module, and that module is COMMITTED. Running this script is how you add or
// change an icon; a clone that never runs it still builds and still ships.
//
// The source is a downloaded Phosphor release (MIT — see THIRD_PARTY_NOTICES).
// It is not vendored in full: 1,512 icons at two weights is roughly 3 MB of path
// data to carry for the ~60 the interface actually draws.
//
//   node scripts/build-icons.js [path-to-phosphor-icons]
//
// The path defaults to ~/Downloads/phosphor-icons and may be overridden with
// ORBIT_PHOSPHOR_DIR. The script fails loudly if a name in MANIFEST is missing
// rather than emitting an icon that silently renders as nothing.

import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { homedir } from "node:os";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const SOURCE = process.argv[2]
  || process.env.ORBIT_PHOSPHOR_DIR
  || join(homedir(), "Downloads", "phosphor-icons");

/* ── The manifest ────────────────────────────────────────────────────────────
   Every icon the interface draws, and nothing else. `duo: true` also emits the
   solid variant under `<name>-fill`, which the navigation uses for the current
   tab — an iOS convention, and the one place Orbit needs two weights of the
   same glyph.

   Adding a name here is cheap. Adding one that no surface draws is not: it is
   dead weight in a file every visitor downloads, and the next person has to
   prove it is unused before deleting it. Keep this list honest. */
const MANIFEST = [
  // Primary navigation — the five destinations, both weights.
  { name: "sun-horizon", duo: true },        // Today
  { name: "compass-rose", duo: true },       // Chart
  { name: "planet", duo: true },             // Sky
  { name: "book-open-text", duo: true },     // Atlas
  { name: "user-circle", duo: true },        // You

  // Structure and movement
  "magnifying-glass", "x", "caret-right", "arrow-right", "arrow-clockwise",

  // Sky vocabulary. The Moon ships both weights: the outline crescent is a new
  // Moon and the solid disc is a full one, which is the one place in the app
  // where the icon carries the fact rather than decorating it.
  { name: "moon", duo: true },
  "sun", "star", "sparkle", "globe-hemisphere-west", "clock-counter-clockwise",

  // People and charts
  "user", "users", "trash",

  // Account, settings, legal
  "gear", "sign-out", "download-simple", "lock-key", "shield-check", "file-text",
  "lifebuoy", "code",

  // Settings controls
  "monitor", "circle-half",

  // Status
  "info",
];

/** Inner markup of a Phosphor SVG, with the transparent sizing rect dropped. */
function extract(file) {
  const svg = readFileSync(file, "utf8");
  const open = svg.indexOf(">", svg.indexOf("<svg")) + 1;
  const close = svg.lastIndexOf("</svg>");
  return svg
    .slice(open, close)
    .replace(/<rect\s+width="256"\s+height="256"\s+fill="none"\s*\/?>/g, "")
    // The stroke attributes are set once on the <svg> the renderer builds, so
    // repeating them on every path is bytes with no effect.
    .replace(/\s(?:stroke|stroke-linecap|stroke-linejoin|stroke-width)="[^"]*"/g, "")
    .replace(/\sfill="none"/g, "")
    .trim();
}

function sourceFile(weight, name) {
  const file = weight === "fill"
    ? join(SOURCE, "SVGs", "fill", `${name}-fill.svg`)
    : join(SOURCE, "SVGs", "regular", `${name}.svg`);
  if (!existsSync(file)) {
    throw new Error(`Phosphor icon not found: ${file}\nSet ORBIT_PHOSPHOR_DIR or pass the checkout path as the first argument.`);
  }
  return file;
}

const entries = [];
for (const item of MANIFEST) {
  const { name, duo } = typeof item === "string" ? { name: item, duo: false } : item;
  entries.push([name, extract(sourceFile("regular", name))]);
  if (duo) entries.push([`${name}-fill`, extract(sourceFile("fill", name))]);
}
entries.sort((a, b) => a[0].localeCompare(b[0]));

const body = entries.map(([name, markup]) => `  ${JSON.stringify(name)}: ${JSON.stringify(markup)},`).join("\n");

const out = `/* GENERATED FILE — do not edit by hand.
   Regenerate with: node scripts/build-icons.js [path-to-phosphor-icons]

   Phosphor Icons, MIT licensed. Copyright (c) 2020-2024 Phosphor Icons.
   https://phosphoricons.com — see THIRD_PARTY_NOTICES.md.

   Path data only, on Phosphor's native 256 grid. Stroke weight, colour, and
   size are applied by the renderer in app.js, so a single glyph serves every
   size the interface uses without a second copy.

   ${entries.length} icons. Names ending in "-fill" are the solid variant, used
   for the current navigation tab. */

export const ICON_PATHS = Object.freeze({
${body}
});

/** Icon names this module can draw. Exported for the icon-coverage test. */
export const ICON_NAMES = Object.freeze(Object.keys(ICON_PATHS));
`;

const target = join(ROOT, "public", "icons.js");
writeFileSync(target, out, "utf8");
console.log(`Wrote ${entries.length} icons to public/icons.js (source: ${SOURCE})`);
