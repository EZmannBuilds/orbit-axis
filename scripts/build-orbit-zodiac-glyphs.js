// Build Orbit's adapted OpenMoji zodiac assets from the same canonical path
// library used by Orbit X. See public/brand/zodiac/ATTRIBUTION.md.

import { mkdirSync, writeFileSync } from "node:fs";
import { ZODIAC_NAMES, zodiacGlyph } from "../lib/orbit-x/celestial.js";

const outputDirectory = new URL("../public/brand/zodiac/", import.meta.url);
const sheetOutput = new URL("../public/brand/orbit-zodiac-glyphs.svg", import.meta.url);
const ink = "#f4f2fa";
const brand = "#b9a7ff";
const background = "#080a12";
const slug = (value) => value.toLowerCase();
const licenseMetadata = `<metadata>OpenMoji Zodiac artwork, adapted by Orbit. CC BY-SA 4.0. https://openmoji.org/ · https://creativecommons.org/licenses/by-sa/4.0/</metadata>`;

mkdirSync(outputDirectory, { recursive: true });

for (const sign of ZODIAC_NAMES) {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512" viewBox="0 0 200 200" role="img" aria-labelledby="title">`
    + `<title id="title">Orbit ${sign} zodiac sign</title>`
    + licenseMetadata
    + `<rect width="200" height="200" rx="28" fill="${background}"/>`
    + zodiacGlyph(sign, { x: 30, y: 30, size: 140, color: brand, title: sign })
    + `</svg>\n`;
  writeFileSync(new URL(`${slug(sign)}.svg`, outputDirectory), svg);
}

const cells = ZODIAC_NAMES.map((sign, index) => {
  const column = index % 4;
  const row = Math.floor(index / 4);
  const x = 36 + column * 240;
  const y = 34 + row * 250;
  return `<g data-zodiac-sign="${sign}">`
    + `<rect x="${x}" y="${y}" width="208" height="214" rx="22" fill="#101421" stroke="#232842"/>`
    + zodiacGlyph(sign, { x: x + 54, y: y + 28, size: 100, color: brand, title: sign })
    + `<text x="${x + 104}" y="${y + 178}" text-anchor="middle" font-family="-apple-system, 'Helvetica Neue', Arial, sans-serif" font-size="22" letter-spacing="3" fill="${ink}">${sign.toUpperCase()}</text>`
    + `</g>`;
}).join("");

const sheet = `<svg xmlns="http://www.w3.org/2000/svg" width="1080" height="810" viewBox="0 0 1028 790" role="img" aria-labelledby="title desc">`
  + `<title id="title">Orbit zodiac sign collection</title>`
  + `<desc id="desc">Twelve OpenMoji zodiac glyphs adapted to Orbit's deterministic SVG system.</desc>`
  + licenseMetadata
  + `<rect width="1028" height="790" fill="${background}"/>${cells}</svg>\n`;

writeFileSync(sheetOutput, sheet);
console.log(`Wrote ${ZODIAC_NAMES.length} standalone zodiac SVGs and ${sheetOutput.pathname}`);
