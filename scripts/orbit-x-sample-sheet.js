#!/usr/bin/env node
// Orbit X :: export the template sample sheet (Dev Update 6.2).
//
//   node scripts/orbit-x-sample-sheet.js [--out docs/orbit-x-samples] [--date 2026-11-09]
//
// Renders every styled family (Living Atlas, After Dark Observatory, Cosmic
// Press) with real Orbit engine facts for ONE FIXED EXAMPLE DATE, as PNG at the
// real export size (1080x1350, and 1080x1080 for the square sheet). Nothing is
// published and nothing is stored; the interpretive lines are example copy.
//
// Writes, per family: a covers sheet (3 cover layouts x the kinds of post), a
// carousel sheet, and full-size slides for review; plus overview.png, and the
// profile grid preview as HTML and PNG.

import { mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { exampleCandidates, renderExample, EXAMPLE_DATE, EXAMPLE_NOTE } from "../lib/orbit-x/samples.js";
import { STYLE_FAMILIES, STYLE_FAMILY_IDS, COVER_LAYOUTS, accentFor } from "../lib/orbit-x/styles.js";
import { fontPaths } from "../lib/orbit-x/raster.js";
import { gridPage } from "../lib/orbit-x/grid-preview.js";

const args = process.argv.slice(2);
const value = (name, fallback) => { const i = args.indexOf(`--${name}`); return i >= 0 ? args[i + 1] : fallback; };
const out = resolve(value("out", "docs/orbit-x-samples"));
const date = value("date", EXAMPLE_DATE);
mkdirSync(out, { recursive: true });

const { Resvg } = await import("@resvg/resvg-js");
const FONT = { loadSystemFonts: false, fontFiles: fontPaths(), defaultFontFamily: "Manrope" };
const png = (svg, width = null) => new Resvg(svg, { font: FONT, ...(width ? { fitTo: { mode: "width", value: width } } : {}) }).render().asPng();
const save = (name, bytes) => { writeFileSync(join(out, name), bytes); console.log(`  ${name} (${Math.round(bytes.length / 1024)} KB)`); };

/** Lay SVG slides on a labelled sheet. tiles: [{svg, w, h}] in rows. */
function sheet(rows, { tile = 330, gap = 14, label = "", scale = 1 } = {}) {
  const parts = [];
  let y = label ? 46 : 14;
  let width = 0;
  for (const row of rows) {
    let x = gap;
    for (const t of row) {
      const w = tile * scale;
      const h = (w * t.h) / t.w;
      parts.push(t.svg.replace(/ width="\d+" height="\d+"/, "").replace(/^<svg /, `<svg x="${x}" y="${y}" width="${w}" height="${h}" `));
      x += w + gap;
    }
    width = Math.max(width, x);
    y += Math.max(...row.map((t) => (tile * scale * t.h) / t.w)) + gap;
  }
  const text = label ? `<text x="${gap}" y="30" font-family="Manrope" font-size="20" font-weight="700" fill="#222">${label}</text>` : "";
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${y}" viewBox="0 0 ${width} ${y}"><rect width="100%" height="100%" fill="#ddd9d2"/>${text}${parts.join("")}</svg>`;
}

const example = exampleCandidates(date);
const KINDS = ["moon", "transit", "retrograde", "fact", "monthly"].filter((k) => example[k]);
const slideOf = (r, i) => ({ svg: r.rendered.slides[i].svg, w: 1080, h: r.design.aspect === "square" ? 1080 : 1350 });
const problems = [];

console.log(`Orbit X sample sheet · ${EXAMPLE_NOTE}`);
for (const family of STYLE_FAMILY_IDS) {
  const f = STYLE_FAMILIES[family];
  console.log(f.name);
  // Covers: three layouts down, kinds across.
  const coverRows = COVER_LAYOUTS.map((layout, variant) => KINDS.map((kind) => {
    const r = renderExample(example[kind], { template: family, variant });
    if (r.rendered.warnings.length) problems.push(`${family}/${layout}/${kind}: ${r.rendered.warnings.join("; ")}`);
    return slideOf(r, 0);
  }));
  save(`${family}-covers.png`, png(sheet(coverRows, { tile: 300, label: `${f.name}: cover layouts (numeral, diagram, type) by kind of post. ${EXAMPLE_NOTE}` })));

  // A whole carousel: the daily reading.
  const daily = renderExample(example.daily, { template: family, variant: 1 });
  const all = daily.rendered.slides.map((_, i) => slideOf(daily, i));
  save(`${family}-carousel-daily.png`, png(sheet([all.slice(0, 3), all.slice(3, 6)], { tile: 360, label: `${f.name}: a daily reading, diagram cover. ${EXAMPLE_NOTE}` })));

  // Full-size slides for close review.
  const full = [
    ["moon-numeral-cover", example.moon, 0, 0, "cover", 0], ["daily-diagram-cover", example.daily, 1, 0],
    ["fact-type-cover", example.fact, 2, 0], ["weekly-data-slide", example.weekly, 0, -2], ["weekly-reflection", example.weekly, 0, -3],
  ];
  for (const [name, entry, variant, index] of full) {
    if (!entry) continue;
    const r = renderExample(entry, { template: family, variant });
    const slides = r.rendered.slides;
    const i = index < 0 ? slides.length + index : index;
    save(`${family}-${name}.png`, png(slides[i].svg));
  }

  // Square (1080x1080).
  const sq = [example.moon, example.fact].filter(Boolean).flatMap((entry, k) => {
    const r = renderExample(entry, { template: family, variant: k === 0 ? 0 : 2, aspect: "square" });
    if (r.rendered.warnings.length) problems.push(`${family}/square: ${r.rendered.warnings.join("; ")}`);
    return [slideOf(r, 0), slideOf(r, 1), slideOf(r, r.rendered.slides.length - 2)];
  });
  save(`${family}-square.png`, png(sheet([sq.slice(0, 3), sq.slice(3, 6)], { tile: 360, label: `${f.name}: square 1080x1080. ${EXAMPLE_NOTE}` })));
}

// Overview: the three families' covers side by side, same posts.
const overview = STYLE_FAMILY_IDS.map((family) => ["moon", "daily", "fact"].filter((k) => example[k]).map((kind, i) =>
  slideOf(renderExample(example[kind], { template: family, variant: i }), 0)));
save("overview.png", png(sheet(overview, { tile: 280, label: `Living Atlas, After Dark Observatory, Cosmic Press: the same three posts. ${EXAMPLE_NOTE}` })));

// The profile grid: nine posts as they would sit on the profile, newest first.
const order = ["moon", "monthly", "fact", "transit", "daily", "retrograde", "method", "weekly", "moon"]
  .map((k) => example[k]).filter(Boolean);
const gridTiles = Array.from({ length: 9 }, (_, i) => {
  const entry = order[i % order.length];
  const family = STYLE_FAMILY_IDS[i % 3];
  const r = renderExample(entry, { template: family, variant: (i + Math.floor(i / 3)) % 3 });
  return { svg: r.rendered.slides[0].svg, label: `${STYLE_FAMILIES[family].name}`, accent: accentFor(family, "moon") };
});
const html = gridPage(gridTiles, { title: "Profile grid preview (example data)",
  subtitle: `${EXAMPLE_NOTE} Nine posts, newest first, cropped to the profile's 3:4 tile.` });
writeFileSync(join(out, "grid-preview.html"), html);
const tileW = 360;
const gridSvg = sheet([gridTiles.slice(0, 3), gridTiles.slice(3, 6), gridTiles.slice(6, 9)].map((row) => row.map((t) => ({ svg: t.svg, w: 1080, h: 1350 }))),
  { tile: tileW, gap: 4, label: "" });
save("grid-preview.png", png(gridSvg));

if (problems.length) { console.error(`\n${problems.length} rendering problem(s):\n- ${problems.join("\n- ")}`); process.exit(1); }
console.log("\nNo overflow, contrast or fitting warnings.");
